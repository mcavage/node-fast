// Copyright 2013 Mark Cavage.  All rights reserved.

var Readable = require('readable-stream').Readable;
var util = require('util');

var assert = require('assert-plus');
var crc = require('crc');

var proto = require('./protocol');



///--- Globals

var MSGID = 0;



///--- Internal Functions

function nextMessageId() {
    if (++MSGID >= proto.MAX_MSGID)
        MSGID = 1;

    return (MSGID);
}


function serialize(object) {
    assert.object(object, 'object');

    var buf;
    var data = JSON.stringify(object.data);
    var len = Buffer.byteLength(data);
    var msgid = object.msgid || nextMessageId();
    var offset = 0;
    var status = object.status || proto.VERSION.DATA;
    var type = object.type || proto.TYPE_JSON;
    var version = object.version || proto.VERSION;

    buf = new Buffer(proto.HEADER_LEN + len);
    buf.writeUInt8(version, offset++, true);
    buf.writeUInt8(type, offset++, true);
    buf.writeUInt8(status, offset++, true);
    buf.writeUInt32BE(msgid, offset, true);
    offset += 4;
    buf.writeInt32BE(crc.crc16(data), offset, true);
    offset += 4;
    buf.writeUInt32BE(len, offset, true);
    offset += 4;
    buf.write(data, offset, len, 'utf8');

    return (buf);
}


function emitAfter(object) {
    var req = object._arguments || [];
    var diff = process.hrtime(object.start);
    object.elapsed = Math.round((diff[0] * 1e6) + (diff[1] / 1000));
    this.emit('after', object.data.m.name, req, object);
}



///--- API

function MessageEncoder() {
    Readable.call(this);
    this._outbound = [];
}
util.inherits(MessageEncoder, Readable);

MessageEncoder.prototype.toString = function toString() {
    return ('[stream MessageEncoder]');
};


MessageEncoder.prototype.send = function send(object) {
    var buf = serialize(object);

    this._outbound.push(buf);

    this.read(0);

    if (object.start) {
        process.nextTick(emitAfter.bind(this, object));
    }
};

MessageEncoder.prototype._read = function (n) {
    if (this._outbound.length === 0) {
        this.push('');
        return;
    }

    var chunk;

    while (this._outbound.length > 0) {
        chunk = this._outbound.shift();
        if (!this.push(chunk)) {
            break;
        }
    }
};


///--- Exports

module.exports = {

    MessageEncoder: MessageEncoder,

    createMessageEncoder: function createMessageEncoder() {
        return (new MessageEncoder());
    }

};
