// Copyright 2012 Mark Cavage.  All rights reserved.

var Stream = require('stream').Stream;
var util = require('util');

var assert = require('assert-plus');
var crc = require('crc');
var microtime = require('microtime');

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



///--- API

function MessageEncoder() {
        Stream.call(this);

        this.paused = null;
        this.readable = true;
}
util.inherits(MessageEncoder, Stream);


MessageEncoder.prototype.pause = function pause() {
        if (!this.paused)
                this.paused = [];
};


MessageEncoder.prototype.resume = function resume() {
        var self = this;

        (this.paused || []).forEach(function (p) {
                self.emit('data', p);
                if (p.start) {
                        process.nextTick(function () {
                                p.elapsed = microtime.now() - p.start;
                                self.emit('after', p);
                        });
                }
        });

        this.emit('drain');
        this.paused = null;
};


MessageEncoder.prototype.toString = function toString() {
        return ('[stream MessageEncoder]');
};


MessageEncoder.prototype.send = function send(object) {
        var buf = serialize(object);
        var self = this;

        if (this.paused) {
                this.paused.push(buf);
        } else {
                this.emit('data', buf);
                if (object.start) {
                        process.nextTick(function () {
                                object.elapsed = microtime.now() - object.start;
                                self.emit('after', object);
                        });
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
