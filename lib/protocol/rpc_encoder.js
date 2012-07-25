// Copyright 2012 Mark Cavage.  All rights reserved.

var EventEmitter = require('events').EventEmitter;
var util = require('util');

var assert = require('assert-plus');
var microtime = require('microtime');

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
}


RpcEncoder.prototype.end = function end() {
        this.status = proto.STATUS.END;
        return (this.encode.apply(this, arguments));
};


RpcEncoder.prototype.encode = function encode() {
        var data;
        var now = microtime.now();
        var self = this;

        if (arguments[0] && arguments[0] instanceof Error) {
                this.status = proto.STATUS.ERROR;
                data = {
                        name: arguments[0].name || 'Error',
                        message: arguments[0].message || 'error',
                        stack: arguments[0].stack
                };
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

        this.encoder.send(msg);

        return (msg);
};
RpcEncoder.prototype.write = RpcEncoder.prototype.encode;



///--- Exports

module.exports = {
        RpcEncoder: RpcEncoder
};