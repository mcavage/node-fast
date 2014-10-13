// Copyright 2013 Mark Cavage.  All rights reserved.

var EventEmitter = require('events').EventEmitter;
var util = require('util');

var assert = require('assert-plus');
var microtime = require('microtime');

var DTrace = require('./dtrace');
var proto = require('./protocol');


///--- Globals

var slice = Function.prototype.call.bind(Array.prototype.slice);



///--- API

function RpcEncoder(options) {
    assert.object(options, 'options');
    assert.object(options.encoder, 'options.encoder');
    assert.string(options.method, 'options.method');
    assert.number(options.msgid, 'options.msgid');

    this.encoder = options.encoder;
    this.method = options.method;
    this.msgid = options.msgid;
    this.start = options.start; // optional
    this.status = proto.STATUS.DATA;

    this.canceled = false;

    // This is ghetto - we'll need to shift()/pop() these
    // later (in message_encoder) - really these exist for the 'after'
    // event on a server
    this._arguments = options._arguments;
}
util.inherits(RpcEncoder, EventEmitter);


RpcEncoder.prototype.end = function end() {
    if (this.canceled) {
        // end() is a no-op after RPC is canceled
        return (null);
    }
    var self = this;

    this.status = proto.STATUS.END;

    process.nextTick(function () {
        DTrace.fire('rpc-done', function (p) {
            return ([self.method, self.msgid]);
        });
    });

    return (this.encode.apply(this, arguments));
};


RpcEncoder.prototype.encode = function encode() {
    if (this.canceled) {
        // write()/encode() are a no-op after RPC is canceled
        return (null);
    }
    var data;
    var now = microtime.now();
    var self = this;

    function encodeError(err) {
        self.status = proto.STATUS.ERROR;
        return {
            name: err.name || 'Error',
            message: err.message || 'error',
            stack: err.stack,
            context: err.context || {}
        };
    }

    if (arguments[0] && arguments[0] instanceof Error) {
        data = encodeError(arguments[0]);

        // Parse verror.MultiError -- the multiple errors are on the
        // MultiError.ase_error field
        var ase_errors = arguments[0].ase_errors;
        if (ase_errors) {
            data.ase_errors = [];
            ase_errors.forEach(function (err) {
                data.ase_errors.push(encodeError(err));
            });
        }
    } else {
        data = slice(arguments);
    }

    var msg = {
        msgid: self.msgid,
        data: {
            m: {
                name: self.method,
                uts: now
            },
            d: data
        },
        start: self.start,
        status: self.status
    };

    msg._arguments = this._arguments;
    this.encoder.send(msg);

    DTrace.fire('rpc-msg', function (p) {
        return ([self.method,
                 self.msgid,
                 self.status,
                 JSON.stringify(data)]);
    });

    return (msg);
};
RpcEncoder.prototype.write = RpcEncoder.prototype.encode;



///--- Exports

module.exports = {
    RpcEncoder: RpcEncoder
};
