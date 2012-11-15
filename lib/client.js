// Copyright 2012, Mark Cavage

var dns = require('dns');
var EventEmitter = require('events').EventEmitter;
var net = require('net');
var util = require('util');

var assert = require('assert-plus');
var backoff = require('backoff');
var clone = require('clone');
var WError = require('verror').WError;

var protocol  = require('./protocol');



///--- Globals

var slice = Function.prototype.call.bind(Array.prototype.slice);
var sprintf = util.format;

/* JSSTYLED */
var IP_RE = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
var MAX_MSGID = Math.pow(2, 31) - 1;
var MSGID = 0;



///--- Errors

function ConnectionClosedError() {
        WError.call(this, 'the underlying connection has been closed');
}
util.inherits(ConnectionClosedError, WError);
ConnectionClosedError.prototype.name = 'ConnectionClosedError';


function ConnectionTimeoutError(time) {
        WError.call(this, 'failed to establish connection after %dms', time);
}
util.inherits(ConnectionTimeoutError, WError);
ConnectionTimeoutError.prototype.name = 'ConnectionTimeoutError';


function DNSError(err, host) {
        WError.call(this, err, host + ' could not be found in DNS');
}
util.inherits(DNSError, WError);
DNSError.prototype.name = 'DNSError';


function NoConnectionError() {
        WError.call(this, 'no connection');
}
util.inherits(NoConnectionError, WError);
NoConnectionError.prototype.name = 'NoConnectionError';


function UnsolicitedMessageError(message) {
        WError.call(this, 'unsolicited message');
        this.msg = message;
}
util.inherits(UnsolicitedMessageError, WError);



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


function shuffle(array) {
        var current;
        var tmp;
        var top = array.length;

        if (top) {
                while (--top) {
                        current = Math.floor(Math.random() * (top + 1));
                        tmp = array[current];
                        array[current] = array[top];
                        array[top] = tmp;
                }
        }

        return (array);
}


function createSocket(options, cb) {

        function _socket() {
                var c = net.connect(options);
                var to = options.connectTimeout || 0;
                c.setTimeout(to);

                c.once('connect', function onConnect() {
                        c.setTimeout(0);
                        c.removeAllListeners('error');
                        c.removeAllListeners('timeout');
                        cb(null, c);
                });

                c.once('error', function onError(err) {
                        c.removeAllListeners('connect');
                        c.removeAllListeners('timeout');
                        cb(err);
                });

                c.once('timeout', function onTimeout() {
                        c.removeAllListeners('connect');
                        c.removeAllListeners('error');
                        c.destroy();
                        cb(new ConnectionTimeoutError(to));
                });
        }

        if (IP_RE.test(options.host)) {
                _socket();
        } else if (options.host === 'localhost' || options.host === '::1') {
                options.host = '127.0.0.1';
                _socket();
        } else {
                dns.resolve4(options.host, function (err, addrs) {
                        if (err) {
                                cb(new DNSError(err, options.host));
                                return;
                        } else if (!addrs || addrs.length === 0) {
                                cb(new DNSError(options.host));
                                return;
                        }

                        options = clone(options);
                        options.host = shuffle(addrs).pop();
                        _socket();
                });
        }
}


function connect(client, options, callback) {
        assert.object(client, 'client');
        assert.object(options, 'options');
        assert.number(options.connectTimeout, 'options.connectTimeout');
        assert.string(options.host, 'options.host');
        assert.number(options.port, 'options.port');
        assert.object(options.retry, 'options.retry');
        assert.func(callback, 'callback');

        var retry = backoff.call(createSocket, options, callback);

        retry.setStrategy(new backoff.ExponentialStrategy({
                initialDelay: options.retry.minTimeout || 1000,
                maxDelay: options.retry.maxTimeout || Infinity
        }));

        var maxRetries = options.retry.retries;
        if (typeof (maxRetries) === 'number' && maxRetries !== Infinity) {
                retry.failAfter(maxRetries);
        } else {
                retry.failAfter(10);
        }

        retry.on('backoff', client.emit.bind(client, 'connectAttempt'));

        return (retry);
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

                                // Clean up any pending requests with an error
                                var _keys = Object.keys(self.requests);
                                var _err = new ConnectionClosedError();
                                _keys.forEach(function (k) {
                                        var r = self.requests[k];
                                        r.emit('error', _err);
                                        cleanupListener(r);
                                        delete self.requests[k];
                                });

                                self.emit('close', had_err);
                                if (self.reconnect) {
                                        var num = (typeof (self.reconnect) ===
                                                   'number');
                                        setTimeout(connect.bind(null,
                                                                self,
                                                                options,
                                                                onConnect),
                                                   num ? self.reconnect : 1000);
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
                                        delete self.requests[msg.msgid];
                                        break;

                                default:
                                        err = new WError(msg.data.d.message);
                                        err.name = msg.data.d.name;
                                        err.stack = msg.data.d.stack;
                                        req.emit('error', err);
                                        delete self.requests[msg.msgid];
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

        connect(this, options, onConnect);
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


Client.prototype.toString = function toString() {
        var c = this.conn;
        var str = sprintf('[object FastClient<remote=%s:%s>]',
                          c ? c.remoteAddress : 'no_host',
                          c ? c.remotePort : 'no_port');

        return (str);
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
