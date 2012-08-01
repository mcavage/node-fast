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

        var op = retry.operation(options.retry);
        op.attempt(function () {
                var c = net.connect(options);
                var t;

                c.once('connect', function onConnect() {
                        clearTimeout(t);
                        t = -1;
                        c.removeAllListeners('error');
                        callback(null, c);
                });

                c.once('error', function onError(err) {
                        clearTimeout(t);
                        t = -1;
                        c.removeAllListeners('connect');
                        if (op.retry(err))
                                return (undefined);

                        return (callback(op.mainError()));
                });

                if (options.connectTimeout > 0) {
                        t = setTimeout(function onConnectTimeout() {
                                if (c && t !== -1) {
                                        c.removeAllListeners('connect');
                                        c.removeAllListeners('error');
                                        c.destroy();

                                        var e = new Error('connect timeout');
                                        if (op.retry(e))
                                                return (undefined);

                                        return (callback(op.mainError()));
                                }
                                return (undefined);
                        }, options.connectTimeout);
                }
        });
}



///--- API

function Client(options) {
        EventEmitter.call(this);

        var self = this;

        this.requests = {};

        connect(options, function (connectErr, conn) {
                if (connectErr)
                        return (self.emit('error', connectErr));

                self.conn = conn;
                self.conn.on('close', function onClose(had_err) {
                        self.emit('close', had_err);
                        cleanupListener(self.conn);
                });
                self.conn.on('error', function onError(err) {
                        self.emit('error', err);
                        cleanupListener(self.conn);
                });
                self.conn.on('timeout', function onTimeout() {
                        self.emit('close', true);
                        cleanupListener(self.conn);
                });

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
                                err = new Error('unsolicited message');
                                err.msg = msg;
                                req.emit('error', err);
                        }

                        return (undefined);
                });

                self.emit('connect');
                return (undefined);
        });
}
util.inherits(Client, EventEmitter);


Client.prototype.close = function close() {
        this.conn.end();
};


Client.prototype.rpc = function rpc(method) {
        assert.string(method, 'method');

        var msgid = nextMessageId();
        var self = this;
        var encoder = new protocol.RpcEncoder({
                encoder: self.messageEncoder,
                msgid: msgid,
                method: method
        });

        encoder.encode.apply(encoder, slice(arguments, 1));

        var req = new EventEmitter();
        this.requests[msgid] = req;

        return (req);
};



///--- Exports

module.exports = {
        createClient: function createClient(options) {
                var opts = clone(options);
                opts.connectTimeout = opts.connectTimeout || 1000;
                opts.host = opts.host || '127.0.0.1';
                opts.retry = opts.retry || {
                        retries: 3
                };
                return (new Client(opts));
        }
};
