// Copyright 2013 Mark Cavage.  All rights reserved.

var domain = require('domain');
var EventEmitter = require('events').EventEmitter;
var net = require('net');
var util = require('util');

var assert = require('assert-plus');

var DTrace = require('./protocol/dtrace');
var protocol = require('./protocol');
var STATUS = protocol.STATUS;



///--- Globals

var slice = Function.prototype.call.bind(Array.prototype.slice);



///--- Helpers

function cleanup(conn, decoder, encoder, isEnd) {
    if (conn.rpcDecoder)
        delete conn.rpcDecoder;

    decoder.removeAllListeners('data');
    decoder.removeAllListeners('drain');
    encoder.removeAllListeners('after');
    encoder.removeAllListeners('data');
    encoder.removeAllListeners('drain');

    conn.removeAllListeners('close');
    conn.removeAllListeners('data');
    conn.removeAllListeners('drain');
    conn.removeAllListeners('end');
    if (isEnd) {
        // Until node#7015 is fixed, don't remove the error listener until
        // the end event - otherwise, we could get a second unhandled error
        // event (and throw instead of logging it)
        conn.removeAllListeners('error');
    }
    conn.removeAllListeners('timeout');
    conn.destroy();
}


function cancelRequest(rpcEncoder, err) {
    if (err) {
        rpcEncoder.end(err);
    }
    // set canceled flag so no more traffic is sent
    rpcEncoder.canceled = true;
    rpcEncoder.emit('cancel');
}


///--- API

function Server(options) {
    EventEmitter.call(this);

    var self = this;
    options = options || {};

    this._rpc = null;
    this.srv = net.createServer(this.onConnection.bind(this));

    //-- Properties
    ['connections', 'maxConnections'].forEach(function (p) {
        self.__defineSetter__(p, function (v) {
            self.srv[p] = v;
        });
        self.__defineGetter__(p, function () {
            return (self.srv[p]);
        });
    });

    //-- Events
    ['close', 'connection', 'error', 'listening'].forEach(function (e) {
        self.srv.on(e, function () {
            var args = slice(arguments);
            args.unshift(e);
            self.emit.apply(self, args);
        });
    });
}
util.inherits(Server, EventEmitter);

Server.prototype.onConnection = function onConnection(conn) {
    var self = this;
    var messageDecoder = new protocol.MessageDecoder();
    var messageEncoder = new protocol.MessageEncoder();
    var rpcDecoder = new protocol.RpcDecoder({
        decoder: messageDecoder,
        encoder: messageEncoder
    });

    conn.msgs = {};
    conn.rpcDecoder = rpcDecoder;

    messageDecoder.on('message', function (msg) {
        if (msg.status === STATUS.ERROR) {
            // cancel pending RPCs on client request
            if (conn.msgs[msg.msgid]) {
                var err = new Error('RPC request canceled');
                err.name = 'RPCCanceledError';
                cancelRequest(conn.msgs[msg.msgid], err);
                delete conn.msgs[msg.msgid];
            }
        } else {
            rpcDecoder.decode(msg);
        }
    });

    rpcDecoder.on('rpc', function (name, args, msg) {
        var encoder = new protocol.RpcEncoder({
            encoder: messageEncoder,
            method: name,
            msgid: msg.msgid,
            start: msg.start,
            _arguments: args
        });

        if (self.listeners(name).length === 0) {
            // complain about missing RPC handler
            var err = new Error('no handler for ' + name);
            err.name = 'RPCNotDefinedError';
            encoder.end(err);
        } else {
            DTrace.fire('rpc-start', function (p) {
                return ([msg.data.m.name,
                        msg.msgid,
                        JSON.stringify(msg.data.d)]);
            });
            // track rpc "session"
            conn.msgs[msg.msgid] = encoder;
            self.emit.apply(self, [].concat(name, args, encoder));
        }
    });

    messageEncoder.on('after', function (method, req, msg) {
        if (msg.status === STATUS.END) {
            self.emit('after', method, req, msg);
        }
        // cease rpc tracking after sending end/error response
        if (msg.status === STATUS.END || msg.status === STATUS.ERROR) {
            if (conn.msgs[msg.msgid]) {
                delete conn.msgs[msg.msgid];
            }
        }
    });

    conn.pipe(messageDecoder);
    messageEncoder.pipe(conn);

    function cancelAll() {
        // Inform all active RPCs that connection has been lost
        Object.keys(conn.msgs).forEach(function (msgid) {
            cancelRequest(conn.msgs[msgid]);
        });
        conn.msgs = {};
    }

    conn.once('error', function onError(err) {
        self.emit('clientError', err);
        cancelAll();
        cleanup(conn, messageDecoder, messageEncoder, false);
        // ignore further errors
        conn.on('error', function () {});
    });
    conn.once('end', function onEnd() {
        messageDecoder.emit('end');
        cancelAll();
        cleanup(conn, messageDecoder, messageEncoder, true);
    });
};



//-- Direct wrappers
['close', 'listen', 'address'].forEach(function (m) {
    Server.prototype[m] = function () {
        this.srv[m].apply(this.srv, arguments);
    };
});


Server.prototype.rpc = function rpc(name, cb) {
    assert.string(name, 'name');
    assert.func(cb, 'callback');

    var self = this;

    this.on(name, function onRpcRequest() {
        var args = arguments;
        var d = domain.create();

        d.once('error', function onServerError(err) {
            var _args = slice(args);
            _args.unshift(err);
            if (self.listeners('uncaughtException').length) {
                _args.unshift('uncaughtException');
            } else {
                _args.unshift('error');
            }
            self.emit.apply(self, _args);
        });

        d.run(function runRpcHandler() {
            cb.apply(self, args);
        });
    });

    return (this);
};



///--- Exports

module.exports = {
    createServer: function createServer(options) {
        return (new Server(options));
    }
};
