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
    setImmediate(function () {
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


test('countPending', function (t) {
    server = fast.createServer();
    server.rpc('sleep', function (timeout, res) {
        setTimeout(function () {
            res.end(null);
        }, parseInt(timeout, 10));
    });
    server.listen(PORT, function () {
        client = fast.createClient({
            host: 'localhost',
            port: PORT
        });
        client.once('connect', function () {
            client.rpc('sleep', 900);
            client.rpc('sleep', 1900);
            client.rpc('sleep', 2900);

            var expected = 3;
            function check() {
                t.equal(expected, client.countPending);
                if (expected === 0) {
                    client.close();
                    server.close();
                    t.end();
                } else {
                    expected--;
                    setTimeout(check, 1000);
                }
            }
            check();
        });
    });
    //test
});


test('RPC error on close', function (t) {
    server = fast.createServer();
    server.rpc('slow', function (res) {
        // Don't respond to simulate indefinite hang
    });
    server.listen(PORT, function () {
        client = fast.createClient({
            host: HOST,
            port: PORT
        });
        client.once('connect', function () {
            t.pass('connected');
            var res = client.rpc('slow');
            res.on('error', function (err) {
                t.equal(err.name, 'ConnectionClosedError');
                server.close();
                t.end();
            });
            setImmediate(function () {
                t.pass('closing');
                client.close();
            });
        });
    });
});


test('RPC error when not connected', function (t) {
    server = fast.createServer();
    server.rpc('pass', function (res) {
        res.end(null);
    });
    server.listen(PORT, function () {
        client = fast.createClient({
            host: HOST,
            port: PORT,
            reconnect: false
        });
        client.once('connect', function () {
            // Simulate server close
            client.fast_conn.destroy();
        });
        client.once('close', function () {
            var res = client.rpc('pass');
            res.once('error', function (err) {
                t.ok(err);
                t.equal(err.name, 'NoConnectionError');
                server.close();
                client.close();
                t.end();

            });
            res.on('end', t.fail.bind(t, 'end called'));
        });
    });
});

// Regression test for https://smartos.org/bugview/MORAY-324.
test('socket properly hangs up via close', function (t) {
        var client1EmittedClose = false;

        server = fast.createServer();
        server.listen(PORT, function () {
            // Create a first client that we'll close right away.
            // The goal is to reproduce the issue described by MORAY-324 where
            // a client that would be immediately closed before establishing
            // a connection would _not_ be closed, and would still connect
            // to the server.
            client = fast.createClient({
                host: HOST,
                port: PORT
            });

            client.close();

            client.on('connect', function onClosedClientConnect() {
                t.ok(false, 'closed client should not emit connect event');
            });

            client.on('close', function onClient1Close() {
                client1EmittedClose = true;
            });

            // Create a second client, only for the purpose of making
            // sure that the first one has the time to connect if the bug
            // described in MORAY-324 is still present.
            var client2 = fast.createClient({
                host: HOST,
                port: PORT
            });

            // Close the second client as soon as it connects so that it
            // doesn't hold the libuv event loop open and allows the server
            // to close (and thus the test to end) if the first client
            // manages to close its connection.
            client2.on('connect', function onClient2Connected() {
                client2.close();
            });

            client2.on('close', function onClient2Closed() {
                // When the second client closes, if the bug described by
                // MORAY-324 is still present, the first client will have
                // established a connection, and the server won't be able to
                // close since the first client will never close.
                // If MORAY-324 is fixed, the first client will have closed its
                // connection before it's established, and thus as soon as the
                // second client closes its connection, the server can close
                // and the test can end.
                server.close();

                t.equal(client1EmittedClose, true, 'first client should ' +
                    'have emitted close');

                // Use a timeout to check for the number of current connections
                // on the server, as when client2 closed its connection, the
                // other end of the connection may not have closed yet.
                // Delay of 1000ms is arbitrary, but should be enough to let
                // the server side of the connection to close, and the
                // net.Server's .connections property to be updated.
                setTimeout(function waitForClientsClose() {
                    server.srv.getConnections(function (err, nbConnections) {
                        t.ifError(err, 'getConnections should not result in ' +
                            'an error');
                        t.equal(nbConnections, 0,
                            'after second client closed, server should have ' +
                            'no remaining client connected');
                    });
                }, 1000);
            });
        });

        server.on('close', function onServerClosed() {
            t.end();
        });
    });
