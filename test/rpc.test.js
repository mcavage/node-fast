// Copyright 2012 Mark Cavage.  All rights reserved.

var fast = require('../lib');
var test = require('tape').test;



////--- Globals

var PORT = process.env.TEST_PORT || 12345;

var client;
var server;



///--- Tests

test('createServer', function (t) {
    server = fast.createServer();
    t.ok(server);
    t.end();
});


test('listen', function (t) {
    server.listen(PORT, function () {
        t.end();
    });
});


test('createClient', function (t) {
    client = fast.createClient({
        host: 'localhost',
        port: PORT
    });
    client.on('connect', function () {
        t.end();
    });
});


test('echo RPC handler', function (t) {
    server.rpc('echo', function (message, res) {
        res.end(message);
    });
    var req = client.rpc('echo', 'hello world');
    t.ok(req);
    req.on('message', function (msg) {
        t.equal(msg, 'hello world');
    });
    req.on('end', function () {
        t.end();
    });
});


test('error RPC handler', function (t) {
    server.rpc('err', function (res) {
        var e = new Error('suck it, mr. client');
        e.context = {
            foo: 'bar'
        };
        res.write(e);
    });
    var req = client.rpc('err');
    t.ok(req);
    req.on('error', function (err) {
        t.ok(err);
        t.equal(err.message, 'suck it, mr. client');
        t.ok(err.context);
        if (err.context)
            t.equal(err.context.foo, 'bar');
        t.end();
    });
});


test('cancelled RPC', function (t) {
    server.rpc('cancelMe', function (message, res) {
        var timer = setTimeout(function () {
            t.fail('not canceled');
            res.end({woe: 'is me'});
        }, 500);
        res.on('cancel', function () {
            t.pass('canceled');
            clearTimeout(timer);
        });
    });
    var req = client.rpc('cancelMe', 'test');
    t.ok(req);
    req.once('error', function (err) {
        t.ok(err);
        t.equal(err.name, 'RPCCanceled');
    });
    setTimeout(req.cancel.bind(req), 200);
    setTimeout(t.end.bind(t), 1000);
});


test('cancel on disconnect', function (t) {
    t.plan(4);
    var port = PORT+1;
    var cServer = fast.createServer();
    var cClient;
    cServer.rpc('toCancel', function (arg, res) {
        res.on('cancel', function () {
            t.pass('rpc cancel');
            cClient.close();
            cServer.close();
        });
    });
    t.ok(cServer);
    cServer.listen(port, function () {
        cClient = fast.createClient({
            host: 'localhost',
            port: port
        });
        t.ok(cClient);
        cClient.once('connect', function () {
            t.pass('connected');
            var req = cClient.rpc('toCancel', 'test');
            setTimeout(function () {
                // simulate disconnect
                cClient.fast_conn.destroy();
            }, 100);
            req.once('error', function () {});
        });
    });
});


test('streaming RPC handler', function (t) {
    server.rpc('stream', function (res) {
        for (var i = 1; i <= 10; i++)
            res.write({i: i});
        res.end();
    });
    var req = client.rpc('stream');
    var seen = 0;
    t.ok(req);
    req.on('message', function (obj) {
        t.ok(obj);
        t.ok(obj.i);
        seen++;
    });
    req.on('end', function () {
        t.equal(seen, 10);
        t.end();
    });
});


test('RPC handler with thrown error #1', function (t) {
    server.rpc('echo2', function (message, res) {
        process.nextTick(function () {
            throw new Error('boom');
        });
    });

    server.once('error', function (err, msg, res) {
        t.ok(err);
        t.ok(msg);
        t.ok(res);
        res.end(err);
    });

    client.rpc('echo2', 'foo').once('error', function (err) {
        t.ok(err);
        t.end();
    });

});


test('RPC handler with thrown error #2', function (t) {
    server.rpc('echo3', function (message, res) {
        process.nextTick(function () {
            throw new Error('boom');
        });
    });

    server.once('uncaughtException', function (err, msg, res) {
        t.ok(err);
        t.ok(msg);
        t.ok(res);
        res.end(err);
    });

    client.rpc('echo3', 'foo').once('error', function (err) {
        t.ok(err);
        t.end();
    });
});


test('undefined RPC - checkDefined', function (t) {
    var port = PORT+1;
    var cServer = fast.createServer({
        checkDefined: true
    });
    t.ok(cServer);
    cServer.listen(port, function () {
        var cClient = fast.createClient({
            host: 'localhost',
            port: port
        });
        t.ok(cClient);
        cClient.on('connect', function () {
            t.pass('connected');
            var req = cClient.rpc('notdefined', 'test');
            req.once('error', function (err) {
                t.ok(err);
                t.equal(err.name, 'RPCNotDefinedError');
                cClient.close();
                cServer.close();
                t.end();
            });
        });
    });
});


test('teardown', function (t) {
    var serverClosed = false;
    var clientClosed = false;
    function tryEnd() {
        if (serverClosed && clientClosed) {
            t.end();
        }
    }
    server.on('close', function () {
        serverClosed = true;
        tryEnd();
    });
    client.on('close', function () {
        clientClosed = true;
        tryEnd();
    });
    client.close();
    server.close();
});
