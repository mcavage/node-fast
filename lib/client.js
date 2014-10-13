// Copyright 2013 Mark Cavage.  All rights reserved.

var dns = require('dns');
var EventEmitter = require('events').EventEmitter;
var net = require('net');
var util = require('util');

var assert = require('assert-plus');
var backoff = require('backoff');
var once = require('once');
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

function ConnectionClosedError(msg) {
    WError.call(this, msg || 'the underlying connection has been closed');
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

function clone(obj) {
    if (!obj) {
        return (obj);
    }
    var copy = {};
    Object.keys(obj).forEach(function (k) {
        copy[k] = obj[k];
    });
    return (copy);
}


function cleanupListener(l) {
    l.removeAllListeners('close');
    l.removeAllListeners('data');
    l.removeAllListeners('drain');
    l.removeAllListeners('end');
    l.removeAllListeners('error');
    l.removeAllListeners('timeout');
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





///--- API

function Client(options) {
    assert.object(options, 'options');
    assert.number(options.connectTimeout, 'options.connectTimeout');
    assert.string(options.host, 'options.host');
    assert.number(options.port, 'options.port');
    assert.object(options.retry, 'options.retry');

    EventEmitter.call(this);

    var self = this;
    this.fast_msgid = 0;
    this.fast_conn = null;
    this.fast_requests = {};
    this._pending_requests = 0;
    this._options = options;

    this.__defineGetter__('countPending', function () {
        return (self._pending_requests);
    });

    if (options.reconnect) {
        var r = options.reconnect;
        var num = (typeof (r) === 'number' ? r : 1000);

        this.fast_reconnect = function () {
            self.fast_timer = setTimeout(function () {
                self.connect();
            }, num);
        };
    } else {
        this.fast_reconnect = false;
    }

    this.connect();
}
util.inherits(Client, EventEmitter);


Client.prototype.close = function close() {
    var self = this;
    this.closed = true;

    this._cleanup();
    this.fast_conn = null;
    this.fast_reconnect = false;
    process.nextTick(function () {
        self.cancelRequests(new ConnectionClosedError('client.close() called'));
        self.emit('close');
    });
};


Client.prototype.connect = function connect() {
    if (this._fast_retry)
        throw new Error('already connecting');

    var self = this;
    this.closed = false;
    var max = Infinity;
    var opts = this._options;
    var retry = backoff.call(this._createSocket.bind(this), {},
    function (err, conn) {
        self._onConnection(err, conn);
    });

    retry.on('backoff', this.emit.bind(this, 'connectAttempt'));
    retry.setStrategy(new backoff.ExponentialStrategy({
        initialDelay: opts.retry.minTimeout || 1000,
        maxDelay: opts.retry.maxTimeout || Infinity
    }));

    if (typeof (opts.retry.retries) === 'number')
        max = opts.retry.retries;

    retry.failAfter(max);

    this._fast_retry = retry;
    this._fast_retry.start();
};


Client.prototype._createSocket = function _createSocket(_, cb) {
    var self = this;
    var options = this._options;
    var callback = once(function (err, res) {
        if (self.closed) {
            // If the client is closed mid-connection, discard any results
            return;
        }
        if (err) {
            self.emit('connectError', err);
        }
        cb(err, res);
    });

    function _socket() {
        var c = net.connect(options);
        var timer = null;
        var to = options.connectTimeout;

        if (options.connectTimeout > 0) {
            timer = setTimeout(function () {
                c.removeAllListeners('connect');
                c.removeAllListeners('error');
                c.destroy();
                callback(new ConnectionTimeoutError(to));
            }, to);
        }

        function done(err, res) {
            if (timer) {
                clearTimeout(timer);
            }
            callback(err, res);
        }

        c.once('connect', function onConnect() {
            c.removeAllListeners('error');
            done(null, c);
        });

        c.once('error', function onError(err) {
            c.removeAllListeners('connect');
            done(err);
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
                callback(new DNSError(err, options.host));
                return;
            } else if (!addrs || addrs.length === 0) {
                callback(new DNSError(options.host));
                return;
            }

            options = clone(options);
            options.host = shuffle(addrs).pop();
            _socket();
        });
    }
};


Client.prototype.cancelRequests = function cancelRequests(err) {
    var self = this;
    Object.keys(this.fast_requests).forEach(function (msgid) {
        self.cancel(msgid, err);
    });
};


Client.prototype.cancel = function cancel(msgid, err) {
    var req = this.fast_requests[msgid];
    if (!err) {
        err = new Error('RPC canceled');
        err.name = 'RPCCanceled';
    }
    if (req) {
        req.emit('error', err);
        cleanupListener(req);
        if (this.fast_conn && this.fast_conn.writable) {
            // notify server of canceled RPC
            req._encoder.encode(err);
        }
        // blackhole further responses for this RPC
        req.removeAllListeners();
        var blackhole = new EventEmitter();
        blackhole.on('error', function () {});
        this.fast_requests[msgid] = blackhole;
    }
};


Client.prototype.rpc = function rpc(method) {
    assert.string(method, 'method');

    var req = new EventEmitter();
    if (!this.fast_conn ||
        !this.fast_conn.readable ||
        !this.fast_conn.writable) {

        process.nextTick(function onNoConnection() {
            req.emit('error', new NoConnectionError());
        });
        return (req);
    }

    var msgid = this._nextMessageId();
    var self = this;
    var encoder = new protocol.RpcEncoder({
        connection: self.fast_conn,
        encoder: self.messageEncoder,
        msgid: msgid,
        method: method
    });
    req._encoder = encoder;
    req.cancel = this.cancel.bind(this, msgid);

    encoder.encode.apply(encoder, slice(arguments, 1));

    this.fast_requests[msgid] = req;
    this._pending_requests++;

    return (req);
};


Client.prototype.setTimeout = function setTimeout(timeout) {
    assert.number(timeout, 'timeout');

    if (!this.fast_conn)
        throw new NoConnectionError();

    this.fast_conn.setTimeout(timeout);
};


Client.prototype.toString = function toString() {
    var c = this.fast_conn;
    var str = sprintf('[object FastClient<remote=%s:%s>]',
                      c ? c.remoteAddress : 'no_host',
                      c ? c.remotePort : 'no_port');

    return (str);
};


//-- "private" methods

Client.prototype._cleanup = function _cleanup() {
    clearTimeout(this.fast_timer);

    if (this.fast_conn) {
        this.fast_conn.destroy();
        cleanupListener(this.fast_conn);
        this.fast_conn = null;
    }

    if (this._fast_retry)
        this._fast_retry.abort();
};


Client.prototype._handleMessage = function _handleMessage(msg) {
    if (!this.fast_conn) {
        this.emit('unhandledMessage', msg);
        return;
    }

    if (!msg.data || !msg.data.m || !msg.data.d) {
        this.emit('error', new Error('bad message'));
        return;
    }

    var args;
    var err;
    var req;

    if ((req = this.fast_requests[msg.msgid])) {
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
            delete this.fast_requests[msg.msgid];
            this._pending_requests--;
            break;

        default:
            err = new Error(msg.data.d.message);
            err.name = msg.data.d.name;
            err.stack = msg.data.d.stack;
            err.context = msg.data.d.context || {};
            err.ase_errors = msg.data.d.ase_errors || [];
            delete this.fast_requests[msg.msgid];
            this._pending_requests--;
            req.emit('error', err);
            cleanupListener(req);
            break;
        }
    } else {
        this.emit('error', new UnsolicitedMessageError(msg));
    }
};


Client.prototype._nextMessageId = function _nextMessageId() {
    if (++this.fast_msgid >= MAX_MSGID)
        this.fast_msgid = 1;

    return (this.fast_msgid);
};


Client.prototype._onConnection = function _onConnection(connect_err, conn) {
    if (connect_err) {
        this.emit('error', connect_err);
        return;
    }

    var self = this;

    conn.on('close', function (had_err) {
        self._cleanup();
        // Clean up any pending requests with an error
        self.cancelRequests(new ConnectionClosedError());

        // Queue up a reconnection, if requested
        if (self.fast_reconnect)
            self.fast_reconnect();

        self.emit('close', had_err);
    });
    conn.on('error', function (err) {
        conn.end();
        if (self.listeners('error').length > 0)
            self.emit('error', err);
    });

    this.fast_conn = conn;
    this.fast_conn.setKeepAlive(true, 60000);

    this.messageDecoder = new protocol.MessageDecoder();
    this.messageEncoder = new protocol.MessageEncoder();

    this.fast_conn.pipe(this.messageDecoder);
    this.messageEncoder.pipe(this.fast_conn);

    this.messageDecoder.on('message', function onMessage(msg) {
        self._handleMessage(msg);
    });

    this._fast_retry = null;
    this.emit('connect');
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
