var cluster = require('../lib/cluster');
var freq = require('../lib/freq');

var test = require('tape');
var fs = require('fs');
var pg = require('pg');
var Queue = require('d3-queue').queue;

var pool = new pg.Pool({
    max: 10,
    user: 'postgres',
    database: 'pt_test',
    idleTimeoutMillis: 30000
});

test('cluster.name', function(t) {
    var popQ = Queue(1);

    //CREATE pt2itp TABLES
    popQ.defer(function(done) {
        pool.query(`
            BEGIN;
            CREATE TABLE address (id SERIAL, text TEXT, _text TEXT, number INT, geom GEOMETRY(POINT, 4326));
            CREATE TABLE address_cluster (id SERIAL, text TEXT, _text TEXT, number TEXT, geom GEOMETRY(MULTIPOINT, 4326));
            CREATE TABLE network (id SERIAL, text TEXT, _text TEXT, named BOOLEAN, geom GEOMETRY(LINESTRING, 4326));
            CREATE TABLE network_cluster (id SERIAL, text TEXT, _text TEXT, address INT, geom GEOMETRY(MULTILINESTRING, 4326));
            COMMIT;
        `, function(err, res) {
            t.error(err);
            return done();
        });
    });

    //POPULATE NETWORK
    popQ.defer(function(done) {
        pool.query(`
            BEGIN;
            INSERT INTO network (id, geom) VALUES (1, ST_SetSRID(ST_GeomFromGeoJSON('{ "type": "LineString", "coordinates": [ [ -66.05180561542511, 45.26869136632906 ], [ -66.05007290840149, 45.268982070325656 ] ] }'), 4326));
            COMMIT;
        `, function(err, res) {
            t.error(err);
            return done();
        });
    });

    //POPULATE ADDRESS
    popQ.defer(function(done) {
        pool.query(`
            BEGIN;
            INSERT INTO address (id, text, _text, number, geom) VALUES (1, 'main st', 'Main Street', 10, ST_SetSRID(ST_GeomFromGeoJSON('{ "type": "Point", "coordinates": [ -66.05154812335967, 45.26861208316249 ] }'), 4326));
            INSERT INTO address (id, text, _text, number, geom) VALUES (2, 'main st', 'Main Street', 10, ST_SetSRID(ST_GeomFromGeoJSON('{ "type": "Point", "coordinates": [ -66.05125308036804, 45.26868759094269 ] }'), 4326));
            INSERT INTO address (id, text, _text, number, geom) VALUES (3, 'main st', 'Main Street', 10, ST_SetSRID(ST_GeomFromGeoJSON('{ "type": "Point", "coordinates": [ -66.05092048645020, 45.26872912017898 ] }'), 4326));
            INSERT INTO address (id, text, _text, number, geom) VALUES (4, 'main st', 'Main Street', 10, ST_SetSRID(ST_GeomFromGeoJSON('{ "type": "Point", "coordinates": [ -66.05050742626190, 45.26880462780347 ] }'), 4326));
            COMMIT;
        `, function(err, res) {
            t.error(err);
            return done();
        });
    });

    popQ.defer(function(done) {
        cluster.name(1, pool, function(err) {
            t.error(err);
            return done();
        });
    });

    popQ.defer(function(done) {
        pool.query(`
            SELECT id, _text, text, named FROM network;
        `, function(err, res) {
            t.error(err);

            t.deepEquals(res.rows[0], {
                id: 1,
                _text: 'Main Street',
                text: 'main st',
                named: true
            });
            return done();
        });
    });

    popQ.await(function(err) {
        t.error(err);

        pool.query(`
            BEGIN;
            DROP TABLE address;
            DROP TABLE address_cluster;
            DROP TABLE network;
            DROP TABLE network_cluster;
            COMMIT;
        `, function(err, res) {
            t.error(err);
            t.end();
        });
    });
});

test('cluster.match', function(t) {
    var popQ = Queue(1);

    //CREATE pt2itp TABLES
    popQ.defer(function(done) {
        pool.query(`
            BEGIN;
            CREATE TABLE address_cluster (id SERIAL, text TEXT, _text TEXT, number TEXT, geom GEOMETRY(MULTIPOINT, 4326));
            CREATE TABLE network_cluster (id SERIAL, text TEXT, _text TEXT, address INT, geom GEOMETRY(MULTILINESTRING, 4326));
            COMMIT;
        `, function(err, res) {
            t.error(err);
            return done();
        });
    });

    //POPULATE NETWORK_CLUSTER
    popQ.defer(function(done) {
        pool.query(`
            BEGIN;
            INSERT INTO network_cluster (id, text, _text, geom) VALUES (1, 'main st', 'Main Street', ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON('{ "type": "LineString", "coordinates": [ [ -66.05180561542511, 45.26869136632906 ], [ -66.05007290840149, 45.268982070325656 ] ] }'), 4326)));
            COMMIT;
        `, function(err, res) {
            t.error(err);
            return done();
        });
    });

    //POPULATE ADDRESS_CLUSTER
    popQ.defer(function(done) {
        pool.query(`
            BEGIN;
            INSERT INTO address_cluster (id, text, _text, number, geom) VALUES (1, 'main st', 'Main Street', 10, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON('{ "type": "Point", "coordinates": [ -66.05154812335967, 45.26861208316249 ] }'), 4326)));
            INSERT INTO address_cluster (id, text, _text, number, geom) VALUES (2, 'fake av', 'Fake Avenue', 12, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON('{ "type": "Point", "coordinates": [ -66.05154812335967, 45.26861208316249 ] }'), 4326)));
            COMMIT;
        `, function(err, res) {
            t.error(err);
            return done();
        });
    });

    popQ.defer(function(done) {
        var calc = freq(['main st'], ['main st', 'fake av'])

        cluster.match(1, calc, pool, function(err) {
            t.error(err);
            return done();
        });
    });

    popQ.defer(function(done) {
        pool.query(`
            SELECT id, text, address FROM network_cluster;
        `, function(err, res) {
            t.error(err);

            t.deepEquals(res.rows[0], {
                id: 1,
                text: 'main st',
                address: 1
            });
            return done();
        });
    });

    popQ.await(function(err) {
        t.error(err);

        pool.query(`
            BEGIN;
            DROP TABLE address_cluster;
            DROP TABLE network_cluster;
            COMMIT;
        `, function(err, res) {
            t.error(err);
            t.end();
        });
    });
});

test('cluster.address', function(t) {
    var popQ = Queue(1);

    //CREATE pt2itp TABLES
    popQ.defer(function(done) {
        pool.query(`
            BEGIN;
            CREATE TABLE address (id SERIAL, text TEXT, _text TEXT, number INT, geom GEOMETRY(POINT, 4326));
            CREATE TABLE address_cluster (id SERIAL, text TEXT, _text TEXT, number TEXT, geom GEOMETRY(MULTIPOINT, 4326));
            COMMIT;
        `, function(err, res) {
            t.error(err);
            return done();
        });
    });

    //POPULATE ADDRESS
    popQ.defer(function(done) {
        pool.query(`
            BEGIN;
            INSERT INTO address (id, text, _text, number, geom) VALUES (1, 'main st', 'Main Street', 10, ST_SetSRID(ST_GeomFromGeoJSON('{ "type": "Point", "coordinates": [-66.97265625,43.96119063892024] }'), 4326));
            INSERT INTO address (id, text, _text, number, geom) VALUES (2, 'main st', 'Main Street', 11, ST_SetSRID(ST_GeomFromGeoJSON('{ "type": "Point", "coordinates": [-66.26953125,43.197167282501276] }'), 4326));
            INSERT INTO address (id, text, _text, number, geom) VALUES (3, 'main st', 'Main Street', 13, ST_SetSRID(ST_GeomFromGeoJSON('{ "type": "Point", "coordinates": [-105.46875,56.36525013685606] }'), 4326));
            INSERT INTO address (id, text, _text, number, geom) VALUES (4, 'main st', 'Main Street', 15, ST_SetSRID(ST_GeomFromGeoJSON('{ "type": "Point", "coordinates": [-104.765625,55.677584411089526] }'), 4326));
            INSERT INTO address (id, text, _text, number, geom) VALUES (5, 'fake av', 'Fake Avenue', 10, ST_SetSRID(ST_GeomFromGeoJSON('{ "type": "Point", "coordinates": [-85.25390625,52.908902047770255] }'), 4326));
            COMMIT;
        `, function(err, res) {
            t.error(err);
            return done();
        });
    });

    popQ.defer(function(done) {
        cluster.address('main st', pool, function(err) {
            t.error(err);
            return done();
        });
    });

    popQ.defer(function(done) {
        pool.query(`
            SELECT id, text, ST_AsGeoJSON(geom) FROM address_cluster;
        `, function(err, res) {
            t.error(err);

            t.equals(res.rows.length, 2);
            return done();
        });
    });

    popQ.await(function(err) {
        t.error(err);

        pool.query(`
            BEGIN;
            DROP TABLE address;
            DROP TABLE address_cluster;
            COMMIT;
        `, function(err, res) {
            t.error(err);
            t.end();
        });
    });
});

test('cluster.network', function(t) {
    t.end();
});

test('end connection', function(t) {
    pool.end();
    t.end();
});
