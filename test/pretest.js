#! /usr/bin/env node

'use strict';

const files = [
    'counties.geojson'
]

const Q = require('d3-queue').queue;
const AWS = require('aws-sdk');
const fs = require('fs');
const s3 = new AWS.S3({
    region: 'us-east-1'
});

const q = new Q();

for (const file of files) {
    try {
        fs.accessSync('/tmp/counties');
    } catch (err) {
        q.defer((file, done) => {
            const output = fs.createWriteStream(`/tmp/${file}`).on('close', done);
            s3.getObject({
                Bucket: 'mapbox',
                Key: `pt2itp/fixtures/${file}`
            }).createReadStream().pipe(output);
        }, file);
    }
}

q.awaitAll((err) => {
    if (err) throw err;
});