// Copyright 2014 Joyent, Inc.  All rights reserved.

var fast = require('../lib');
var test = require('tape').test;


///--- Globals

var HOST = process.env.TEST_HOST || '127.0.0.1';
var PORT = process.env.TEST_PORT || 12345;
// a bogus loopback address should work for testing connect timeout
var TIMEOUT_HOST = process.env.TEST_TIMEOUT_HOST || '127.1.1.1';
var TIMEOUT_MS = 1000;

var client;
var server;



///--- Tests

test('connect timeout', function (t) {
    function done() {
        client.removeAllListeners();
        client.close();
        t.end();
    }

    client = fast.createClient({
        host: TIMEOUT_HOST,
        port: PORT,
        connectTimeout: TIMEOUT_MS
    });
    var failTimer = setTimeout(function () {
        t.ok(false, 'timeout failed');
        done();
    }, TIMEOUT_MS * 2);
    client.once('connectError', function (err) {
        t.equal(err.name, 'ConnectionTimeoutError', 'timeout error');
        clearTimeout(failTimer);
        done();
    });
});

test('close suppress connectErrors', function (t) {
    client = fast.createClient({
        host: TIMEOUT_HOST,
        port: PORT,
        connectTimeout: TIMEOUT_MS
    });
    client.on('connectError', function (err) {
        t.fail('error not suppressed');
    });
    process.nextTick(function () {
        client.close();
        setTimeout(function () {
            t.ok(true);
            t.end();
        }, TIMEOUT_MS);
    });
});

test('connect retry limit', function (t) {
    var targetCount = 3;
    var realCount = 0;

    client = fast.createClient({
        host: HOST,
        port: PORT,
        retry: {
            retries: targetCount
        }
    });
    client.on('connectError', function (err) {
        realCount++;
    });
    client.once('error', function (err) {
        // The first failure is not a retry
        t.equal(realCount, targetCount+1, 'retry count');
        client.close();
        t.end();
    });
});
