// Copyright 2012 Mark Cavage.  All rights reserved.

var Stream = require('stream').Stream;
var util = require('util');

var assert = require('assert-plus');
var crc = require('crc');
var VError = require('verror').VError;

var proto = require('./protocol');



///--- Internal Functions

function parseBuffer(buf, msg) {
        assert.object(buf, 'buffer');
        assert.object(msg, 'message');

        if (buf.length < proto.HEADER_LEN)
                return (false);

        msg._offset = msg._offset || 0;
        if (msg._offset === 0) {
                msg.version = buf.readUInt8(msg._offset++, true);
                msg.type = buf.readUInt8(msg._offset++, true);
                msg.status = buf.readUInt8(msg._offset++, true);
                msg.msgid = buf.readUInt32BE(msg._offset, true);
                msg._offset += 4;
                msg.checksum = buf.readInt32BE(msg._offset, true);
                msg._offset += 4;
                msg.length = buf.readUInt32BE(msg._offset, true);
                msg._offset += 4;
        }

        var remain = msg._offset + msg.length;
        if (buf.length < remain)
                return (false);

        msg.data = buf.slice(msg._offset, remain).toString('utf8');
        msg._offset += msg.length;
        return (true);
}



///--- API

function MessageDecoder() {
        Stream.call(this);

        this.writable = true;

        this._buf = null;
        this._msg = null;
}
util.inherits(MessageDecoder, Stream);


MessageDecoder.prototype.end = function end(buf) {
        var self = this;

        function shutdown() {
                self.readable = false;
                self.writable = false;
                self.emit('end');
        }

        if (buf) {
                this.write(buf);
                process.nextTick(shutdown);
        } else {
                shutdown();
        }
};


MessageDecoder.prototype.pause = function pause() {
        return (this._src.pause());
};


MessageDecoder.prototype.write = function write(buf) {
        var checksum;
        var err;
        var msg;
        var self = this;

        if (this._buf) {
                if (buf) {
                        // Wed Underrun data on a previous call
                        var len = this._buf.length + buf.length;
                        buf = Buffer.concat([this._buf, buf], len);
                } else {
                        // Commonly happens from overflow data, below
                        buf = this._buf;
                }
        } else if (!buf) {
                // This case rarely, if ever happens, but would occur
                // if we had extra bytes, but by the time .nextTick was
                // invoked the extra bytes + the remaining message were
                // already processed and there was now zero data in the pipe
                return (true);
        }

        assert.ok(Buffer.isBuffer(buf));
        msg = this._msg || {};

        if (!parseBuffer(buf, msg)) {
                this._buf = buf;
                this._msg = msg;
                return (true);
        }

        // Reset and look for extra
        this._buf = null;
        this._msg = null;
        if (buf.length > msg._offset) {
                this._buf = buf.slice(msg._offset);
                process.nextTick(function () {
                        self.write();
                });
        }

        checksum = crc.crc16(msg.data);
        if (msg.checksum !== checksum) {
                err = new VError('checksum error(%d): caclulated %d',
                                 msg.checksum, checksum);
                self.emit('error', err);
                return (false);
        }

        try {
                msg.data = JSON.parse(msg.data);
        } catch (e) {
                err = new VError(e, 'Client Error: invalid JSON');
                self.emit('error', err);
                return (false);
        }

        this.emit('message', msg);
        return (true);
};



///--- Exports

module.exports = {

        MessageDecoder: MessageDecoder,

        createMessageDecoder: function createMessageDecoder() {
                return (new MessageDecoder());
        }

};
