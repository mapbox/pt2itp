const Queue = require('d3-queue').queue;
const turf = require('@turf/turf');
const pg = require('pg');
const readline = require('readline');
const tokenize = require('../util/tokenize');
const tokens = require('@mapbox/geocoder-abbreviations');
const fs = require('fs');

let tokenRegex = tokenize.createGlobalReplacer(tokens().global);

let opts, pool;
let num = 0;

process.on('message', (message) => {
    if (message.type && (message.type === 'end')) {
        kill();

        process.send({
            type: 'end',
            id: id
        });
    } else {
        init(message);

        id = message.id;
        process.send({
            type: 'ready',
            id: id
        });

        split((err) => {
            if (err) throw err;

            process.send({
                type: 'end',
                id: id
            });
        });
    }
});

/**
 * Intilize the split child process with given arguments and then wait for data messages to process
 * @param {Object} o Argument object
 * @param {number} o.id Assigned id of the process
 * @param {number} o.total total number of parallel processes to distribute work
 * @param {Object} o.context Object containing country/region codes
 * @param {String} o.context.country ISO 3166-1 Alpha 2 Country Code
 * @param {String} o.context.region ISO 3166-2 Region Code
 * @param {String} o.read A path to the input GeoJSON file
 * @param {String} o.map Name of map file to use in lib/map/
 * @param {Stream} o.output A stream to output to, defaults to process.stdout
 * @param {Object} o.tokens Token replacement object
 * @param {Object} o.pool PG Pool Instance to use to communicate with the database
 * @return {boolean} Returns true after split is initialized
 */
function init(o) {
    opts = o;

    //Enforce opts namespace to avoid undocumented opts
    let keys = ['id', 'total', 'context', 'output', 'pool', 'map', 'read', 'tokens']
    for (let key of Object.keys(opts)) {
        if (keys.indexOf(key) === -1) throw new Error(`${key} is not a valid conflate/compare option`);
    }

    if (!opts.output) opts.output = process.stdout;
    opts.read = fs.createReadStream(opts.read);

    opts.map = require(`../map/${opts.map}`).map;

    pool = new pg.Pool(opts.pool);

    return true;
}

/**
 * Given an address, compare it to the persistent table to see if it exists
 * @param {Function} cb Callback function (err, res)
 * @return {Function} Return cb function
 */
function split(cb) {
    const rl = new readline.createInterface({
        input: opts.read,
        output: opts.output
    }).on('error', (err) => {
        return cb(err);
    }).on('line', (data) => {
        if (!data || !data.length) return;

        num++;
        if (num % opts.total !== opts.id) return; //Distribute tasks evenly accross workers

        //The new GeoJSONSeq schema uses record separators
        data = data.replace(RegExp(String.fromCharCode(30), 'g'), '');

        let feat;
        try {
            if (opts.map) {
                feat = opts.map(JSON.parse(data), opts.context);
            } else {
                feat = JSON.parse(data);
            }
        } catch (err) {
            process.stderr.write(`Unable to parse: ${err.toString()}\t${data}\n`);
        }

        if (feat instanceof Error) {
            return process.stderr.write(`${feat.message}: ${data}\n`);
        }

        pool.query(`
            SELECT
                name,
                json_build_object(
                    'id', p.id,
                    'properties', p.props,
                    'geometry', ST_AsGeoJSON(p.geom)::JSON
                )
            FROM
                persistent p
            WHERE
                p.number = '${feat.properties.number}'
                AND ST_DWithin(ST_SetSRID(ST_GeomFromGeoJSON('${JSON.stringify(feat.geometry)}'), 4326), p.geom, 0.02);
        `, (err, res) => {
            if (err) return cb(err);

            //The address does not exist in the database and should be created
            if (res.rows.length === 0) return opts.output.write(JSON.stringify(create(feat)) + '\n');

            const potentials = feat.properties.street.map((name) => {
                return tokenize.replaceToken(tokenRegex, tokenize.main(name.display, opts.tokens, true).tokens.join(' '));
            });

            for (let r of res.rows) {
                let known = r.name.map((name) => { return name.tokenized; });

                for (let potential of potentials) {
                    if (known.indexOf(potential) !== -1) {
                        let m = modify(res.feat, feat);
                    }
                }
            }
        });
    }).on('close', (close) => {
        return cb();
    });
}

function create(feat) {
    return {
        action: 'create',
        properties: {
            number: feat.properties.number,
            street: feat.properties.display,
            source: feat.properties.source
        },
        geometry: feat.geometry
    };
}

function modify(known, potential) {
    console.error('modify');
    return known;
}

/**
 * Only called by tests - child process kills this automatically
 * @return {boolean} Returns true after pool is ended.
 */
function kill() {
    pool.end();

    return true;
}


module.exports = {
    compare: split,
    init: init,
    kill: kill
}