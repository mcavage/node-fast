// Copyright 2012, Mark Cavage

var EventEmitter = require('events').EventEmitter;
var net = require('net');
var util = require('util');

var assert = require('assert-plus');
var clone = require('clone');
var retry = require('retry');
var WError = require('verror').WError;

var protocol  = require('./protocol');



///--- Globals

var slice = Function.prototype.call.bind(Array.prototype.slice);

var MAX_MSGID = Math.pow(2, 31) - 1;
var MSGID = 0;



///--- Helpers

function ConnectionTimeoutError(time) {
        WError.call(this, 'failed to establish connection after %dms', time);
}
util.inherits(ConnectionTimeoutError, WError);


function NoConnectionError() {
        WError.call(this, 'no connection');
}
util.inherits(NoConnectionError, WError);


function UnsolicitedMessageError(message) {
        WError.call(this, 'unsolicited message');
        this.msg = message;
}
util.inherits(UnsolicitedMessageError, WError);


function cleanupListener(l) {
        l.removeAllListeners('close');
        l.removeAllListeners('data');
        l.removeAllListeners('drain');
        l.removeAllListeners('end');
        l.removeAllListeners('error');
        l.removeAllListeners('timeout');
}


function nextMessageId() {
        if (++MSGID >= MAX_MSGID)
                MSGID = 1;

        return (MSGID);
}


function connect(options, callback) {
        assert.object(options, 'options');
        assert.number(options.connectTimeout, 'options.connectTimeout');
        assert.string(options.host, 'options.host');
        assert.number(options.port, 'options.port');
        assert.object(options.retry, 'options.retry');
        assert.func(callback, 'callback');

        var _to = options.connectTimeout;
        var op = retry.operation(options.retry);

        op.attempt(function () {
                var c = net.connect(options);
                c.setTimeout(_to || 0);

                c.once('connect', function onConnect() {
                        c.setTimeout(0);
                        c.removeAllListeners('error');
                        c.removeAllListeners('timeout');
                        callback(null, c);
                });

                c.once('error', function onError(err) {
                        c.removeAllListeners('connect');
                        c.removeAllListeners('timeout');
                        if (op.retry(err))
                                return (undefined);

                        return (callback(op.mainError()));
                });

                c.once('timeout', function onTimeout() {
                        c.removeAllListeners('connect');
                        c.removeAllListeners('error');
                        c.destroy();

                        if (op.retry(new ConnectionTimeoutError(_to)))
                                return (undefined);

                        return (callback(op.mainError()));
                });

        });
}



///--- API

function Client(options) {
        EventEmitter.call(this);

        var self = this;

        this.conn = null;
        this.reconnect = options.reconnect;
        this.requests = {};

        function onConnect(connectErr, conn) {
                if (connectErr)
                        return (self.emit('error', connectErr));

                if (!self.reconnect) {
                        conn.on('close', function (had_err) {
                                self.emit('close', had_err);
                                cleanupListener(conn);
                        });
                        conn.on('error', function (err) {
                                self.emit('error', err);
                        });
                } else {
                        conn.once('close', function (had_err) {
                                cleanupListener(conn);
                                self.conn = null;
                                if (self.reconnect) {
                                        setTimeout(function () {
                                                connect(options, onConnect);
                                        }, 1000);
                                }
                        });

                        conn.once('error', function (err) {
                                if (self.listeners('error').length > 0)
                                        self.emit('error', err);
                                // Otherwise NOOP - close will fire next
                        });
                }
                self.conn = conn;

                self.messageDecoder = new protocol.MessageDecoder();
                self.messageEncoder = new protocol.MessageEncoder();

                self.conn.pipe(self.messageDecoder);
                self.messageEncoder.pipe(self.conn);
                self.messageDecoder.on('message', function onResponse(msg) {
                        if (!msg.data || !msg.data.m || !msg.data.d) {
                                self.emit('error',
                                          new Error('invalid message'));
                                return (undefined);

                        }
                        var args;
                        var err;
                        var req;

                        if ((req = self.requests[msg.msgid])) {
                                switch (msg.status) {

                                case protocol.STATUS.DATA:
                                        args = msg.data.d;
                                        args.unshift('message');
                                        req.emit.apply(req, args);
                                        break;

                                case protocol.STATUS.END:
                                        if (msg.data.d.length) {
                                                args = msg.data.d;
                                                args.unshift('message');
                                                req.emit.apply(req, args);
                                                process.nextTick(function () {
                                                        req.emit('end');
                                                        cleanupListener(req);
                                                });
                                        } else {
                                                req.emit('end');
                                                cleanupListener(req);
                                        }
                                        self.requests[msg.msgid] = null;
                                        break;

                                default:
                                        err = new WError({
                                                name: msg.data.d.name
                                        }, msg.data.d.message);
                                        err.stack = msg.data.d.stack;
                                        req.emit('error', err);
                                        self.requests[msg.msgid] = null;
                                        cleanupListener(req);
                                        break;
                                }
                        } else {
                                self.emit('error',
                                          new UnsolicitedMessageError(msg));
                        }

                        return (undefined);
                });

                self.emit('connect');
                return (undefined);
        }

        connect(options, onConnect);
}
util.inherits(Client, EventEmitter);


Client.prototype.close = function close() {
        this.reconnect = false;
        if (this.conn)
                this.conn.end();
};


Client.prototype.rpc = function rpc(method) {
        assert.string(method, 'method');

        var req = new EventEmitter();
        if (!this.conn) {
                process.nextTick(function () {
                        req.emit('error', new NoConnectionError());
                });
                return (req);
        }

        var msgid = nextMessageId();
        var self = this;
        var encoder = new protocol.RpcEncoder({
                encoder: self.messageEncoder,
                msgid: msgid,
                method: method
        });

        encoder.encode.apply(encoder, slice(arguments, 1));

        this.requests[msgid] = req;

        return (req);
};


Client.prototype.setTimeout = function setTimeout(timeout) {
        assert.number(timeout, 'timeout');

        if (!this.conn)
                throw new NoConnectionError();

        this.conn.setTimeout(timeout);
};



///--- Exports

module.exports = {
        createClient: function createClient(options) {
                var opts = clone(options);
                opts.connectTimeout = opts.connectTimeout || 1000;
                opts.host = opts.host || '127.0.0.1';
                if (opts.reconnect === undefined)
                        opts.reconnect = 1000;

                opts.retry = opts.retry || {
                        retries: 3
                };
                return (new Client(opts));
        }
};
