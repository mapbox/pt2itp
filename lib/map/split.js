const Post = require('./post');

const interpolize = require('./interpolize');
const Explode = require('./explode');
const Cluster = require('./cluster');
const diacritics = require('diacritics').remove;
const Queue = require('d3-queue').queue;
const turf = require('@turf/turf');
const pg = require('pg');

const Misc = require('../util/misc');

/**
 * An individual feature that will be processed by the Split class
 * @class SplitFeat
 */
class SplitFeat {
    /**
     * Intilize the split child process with given arguments and then wait for data messages to process
     *
     * @param {Number} id Network Cluster ID for debugging
     * @param {Array} name Array of display objects pertaining to this feature
     * @param {Object} props Lookup array from id => properties
     * @param {Object} network Network LineString Geometry
     * @param {Object} address Address MultiPoint Geometry
     */
    constructor(id, name, props, network, address) {
        if (!name) throw new Error('name array required');
        if (!props) throw new Error('props object required');
        if (!network) throw new Error('network geometry required');
        if (!address) throw new Error('address geometry required');

        //Legacy Conversion
        for (let id of Object.keys(props)) {
            if (!props[id].props) props[id].props = {};
            props[id].number = String(props[id].number);
        }

        this.id = id;
        this.name = name;

        // id => { id, number, props } Object
        this.props = props;

        this.network = network;
        this.address = address;
    }

    /**
     * Create a new SplitFeat object given a network_cluster id & database connection
     *
     * @param {Object} pool Postgres Pool Object
     * @param {Number} nid network_cluster id to build a SplitFeat from
     * @param {Function} cb (err, res) style callback
     */
    static from_id(pool, nid, cb) {
        pool.query(`
            SELECT
                network_cluster.name || address_cluster.name    AS name,
                ST_AsGeoJSON(network_cluster.geom)::JSON        AS network,
                ST_AsGeoJSON(address_cluster.geom)::JSON        AS address,
                (
                    SELECT
                        json_agg(json_build_object(
                             'id', r.id,
                             'number', r.number,
                             'props', r.props,
                             'output', r.output
                        ))
                    FROM (
                        SELECT
                            a.id AS id,
                            address.number AS number,
                            address.props AS props,
                            address.output as output
                        FROM
                            (
                                SELECT ST_Z((ST_Dump(address_cluster.geom)).geom) AS id
                            ) a,
                            address
                        WHERE
                            a.id = address.id
                    ) r
                )                                               AS address_props
            FROM
                network_cluster,
                address_cluster
            WHERE
                network_cluster.id = ${nid}
                AND network_cluster.address = address_cluster.id;
        `, (err, res) => {
            if (err) return cb(err);

            res = res.rows[0];

            let lookup = {};
            for (let prop of res.address_props) {
                lookup[prop.id] = prop;
            }

            const feat = new SplitFeat(nid, res.name, lookup, res.network, res.address);

            return cb(null, feat);
        });
    }
}

/**
 * @class Split
 */
class Split {
    /**
     * Intilize the split child process with given arguments and then wait for data messages to process
     * @param {Object} o Argument object
     * @param {boolean} o.stdout Turn off stdout - true by default
     * @param {Array} o.post Array of non-default post operations to perform on output
     * @param {string} o.label Use non-default label formatter - ./label/titlecase is default
     * @return {boolean} Returns true after split is initialized
     */
    constructor(o) {
        this.opts = o;

        this.id = this.opts.id;

        this.explode = new Explode();

        if (this.opts.stdout === undefined) this.opts.stdout = true; //Output to STDOUT by default - set to false for tests and (err, res) callback will be used

        this.opts.post = new Post(this.opts);
    }

    /**
     * Get a given cluster by nid and split into matched addr=>network segments and interpolize
     * @param {SplitFeat} feat SplitFeat to process
     * @param {Function} cb Callback function (err, res)
     * @return {Function} Return cb function
     */
    split(feat, cb) {
        if (!(feat instanceof SplitFeat)) return cb(new Error('feat param must be SplitFeat class'));

        if (!feat.name.some(name => { return name.display.trim().length })) return cb();

        let props = [];

        //Sort coords for consistent input into interpolate
        feat.address.coordinates.sort((a, b) => {
            if (parseInt(feat.props[a[2]].number) > parseInt(feat.props[b[2]].number)) return 1;
            if (parseInt(feat.props[a[2]].number) < parseInt(feat.props[b[2]].number)) return -1;

            if (a[0] > b[0]) return 1;
            if (a[0] < b[0]) return -1;

            if (a[1] > b[1]) return 1;
            if (a[1] < b[1]) return -1;

            return 0;
        })
            
        const coords = feat.address.coordinates.map((coords) => {
            props.push(feat.props[coords[2]])
            return coords;
        });

        let network = this.explode.join({
            type: 'FeatureCollection',
            features: [ turf.feature(feat.network) ]
        });

        let segs = [];

        /*
         * If there are duplicate addresses - ensure they are actual duplicates and not distinct addresses
         * with the same number. If they are distinct, break network into 2 distinct features.
         */
        if (Misc.hasDupAddressWithin(props.map((prop) => { return prop.number }), coords)) {
            let tmpSegs = this.distribute(network, coords, props);

            let potentialSegs = Cluster.break(tmpSegs, feat.id);

            if (potentialSegs) {
                segs = potentialSegs.map((seg) => {
                    return this.distribute(this.explode.split(seg.network), seg.address, seg.number)
                });
            } else {
                segs = [ this.distribute(this.explode.split(network), coords, props) ];
            }
        } else {
            segs = [ this.distribute(this.explode.split(network), coords, props) ];
        }

        let itpFinal = [];
        for (let seg of segs) {
            let itp = interpolize(seg, { debug: this.opts.debug });

            if (!itp) continue;

            feat.name = feat.name.filter(name => {
                if (!name.display) return false;
                return true;
            });

            itp.properties['carmen:text'] = feat.name;
            if (this.opts.country) itp.properties['carmen:geocoder_stack'] = this.opts.country;

            itp = this.opts.post.feat(itp);

            itpFinal.push(itp);
        }

        let output = itpFinal.map((itp) => {
            return JSON.stringify(itp);
        }).join('\n') + '\n';

        if (this.opts.stdout) return process.stdout.write(output, cb);
        else return cb(null, itpFinal);
    }

    /**
     * Join addresses from a single MultiPoint collection into an array of [ Address, Corresponding Network Segments, Numbers ]
     * @param {Object} network GeoJSON FeatureCollection of network segments
     * @param {Array} coords Coordinates for address points
     * @param {Array} props Corresponding address properties - parallel to coordinates array
     * @return {Array} Return array of matched segments
     */
    distribute(network, coords, props) {
        let addressCluster = [];
        let numberCluster = [];

        network.features = network.features.filter((feat) => {
            if (turf.lineDistance(feat) > 0.001) return true;
            return false;
        });

        for (let it = 0; it < coords.length; it++) {
            let pt = turf.point(coords[it]);

            let currentMatch = {
                dist: Infinity,
                ln: false
            };

            for (let ln_it = 0; ln_it < network.features.length; ln_it++) {
                let ln = network.features[ln_it].geometry;

                let dist = turf.distance(turf.pointOnLine(ln, pt), pt);

                if (dist < currentMatch.dist) {
                    currentMatch = { dist: dist, ln: ln_it, num: props[it] };
                }
            }

            if (!addressCluster[currentMatch.ln]) addressCluster[currentMatch.ln] = [];
            if (!numberCluster[currentMatch.ln]) numberCluster[currentMatch.ln] = [];
            addressCluster[currentMatch.ln].push(pt.geometry.coordinates);
            numberCluster[currentMatch.ln].push(props[it]);
        }

        let segs = [];

        for (let it = 0; it < addressCluster.length; it++) {
            segs.push({
                address: addressCluster[it] ? turf.multiPoint(addressCluster[it]) : null,
                number: numberCluster[it] ? numberCluster[it] : null,
                network: turf.feature(network.features[it].geometry)
            });
        }

        return segs;
    }
}

let split, pool;
process.on('message', (message) => {
    if (Array.isArray(message)) {
        const splitQ = new Queue();

        for (let nid of message) {
            if (!nid) continue;
            splitQ.defer((nid, done) => {
                SplitFeat.from_id(pool, nid, (err, feat) => {
                    if (err) return done(err);

                    split.split(feat, done);
                });
            }, nid);
        }

        splitQ.await((err) => {
            process.send({
                id: split.id,
                error: err ? err.message : false,
                jobs: message.length
            });
        });
    } else {
        if (message.type && (message.type === 'end')) {
            pool.end();
        } else {
            pool = new pg.Pool(message.pool);
            split = new Split(message);
        }

        process.send({
            type: message.type || false,
            id: split.id,
            jobs: 0
        });
    }
});


module.exports.Split = Split;
module.exports.SplitFeat = SplitFeat;