// Copyright 2012 Mark Cavage, Inc.  All rights reserved.

var EventEmitter = require('events').EventEmitter;
var net = require('net');
var util = require('util');

var assert = require('assert-plus');

var protocol = require('./protocol');



///--- Globals

var slice = Function.prototype.call.bind(Array.prototype.slice);



///--- Helpers

function cleanup(conn, decoder, encoder) {
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
        conn.removeAllListeners('error');
        conn.removeAllListeners('timeout');
        conn.destroy();
}



///--- API

function Server(options) {
        EventEmitter.call(this);

        var self = this;

        this._rpc = null;
        this.srv = net.createServer(function onConnection(conn) {
                var messageDecoder = new protocol.MessageDecoder();
                var messageEncoder = new protocol.MessageEncoder();
                conn.rpcDecoder = new protocol.RpcDecoder({
                        decoder: messageDecoder,
                        emitter: self,
                        encoder: messageEncoder
                });

                conn.pipe(messageDecoder);
                messageEncoder.pipe(conn);

                conn.once('error', function onError(err) {
                        self.emit('clientError', err);
                        cleanup(conn, messageDecoder, messageEncoder);
                });

                conn.once('end', function onEnd() {
                        messageDecoder.emit('end');
                        cleanup(conn, messageDecoder, messageEncoder);
                });


                messageEncoder.on('after', function (m, req, res) {
                        if (res.status === 0x02) // END
                                self.emit('after', m, req, res);
                });
        });

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


//-- Direct wrappers
['close', 'listen', 'address'].forEach(function (m) {
        Server.prototype[m] = function () {
                this.srv[m].apply(this.srv, arguments);
        };
});


Server.prototype.rpc = function rpc(name, callback) {
        assert.string(name, 'name');
        assert.func(callback, 'callback');

        this.on(name, callback);

        return (this);
};



///--- Exports

module.exports = {
        createServer: function createServer(options) {
                return (new Server(options));
        }
};
