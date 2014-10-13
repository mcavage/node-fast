// Copyright 2013 Mark Cavage.  All rights reserved.

var EventEmitter = require('events').EventEmitter;
var util = require('util');

///--- API

function RpcDecoder() {
    EventEmitter.call(this);
}
util.inherits(RpcDecoder, EventEmitter);


RpcDecoder.prototype.decode = function decode(msg) {
    if (!msg.data || !msg.data.m || !msg.data.d) {
        this.emit('error', new Error('invalid message'));
        return (undefined);
    }

    var name = msg.data.m.name;
    var args = msg.data.d.slice();

    this.emit('rpc', name, args, msg);
    return (undefined);
};


///--- Exports

module.exports = {
    RpcDecoder: RpcDecoder
};
