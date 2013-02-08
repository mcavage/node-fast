// Copyright 2012 Mark Cavage.  All rights reserved.

var Stream = require('stream').Stream;
var util = require('util');

var assert = require('assert-plus');
var crc = require('crc');
var microtime = require('microtime');
var WError = require('verror').WError;

var proto = require('./protocol');



///--- Errors

function ChecksumError(exp, actual, msg) {
        WError.call(this, {}, 'checksum error(%d): caclulated %d', exp, actual);

        this.context = {
                expected_crc: exp,
                actual_crc: actual,
                message: msg
        };
        this.name = this.constructor.name;
}
util.inherits(ChecksumError, WError);


function InvalidContentError(cause, msg) {
        WError.call(this, cause, 'invalid JSON encountered');

        this.context = {
                message: msg
        };
        this.name = this.constructor.name;
}
util.inherits(InvalidContentError, WError);



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


function shutdown(stream, event) {
        stream.readable = false;
        stream.writable = false;
        stream.emit(event);
}



///--- API

function MessageDecoder() {
        Stream.call(this);

        this.writable = true;

        this._buf = null;
        this._msg = null;
}
util.inherits(MessageDecoder, Stream);


MessageDecoder.prototype.destroy = function destroy() {
        shutdown(this, 'close');
};


MessageDecoder.prototype.destroySoon = function destroySoon() {
        this.destroy();
};


MessageDecoder.prototype.end = function end(buf) {
        if (buf) {
                this.write(buf);
                process.nextTick(shutdown.bind(null, this, 'end'));
        } else {
                shutdown(this, 'end');
        }
};


MessageDecoder.prototype.pause = function pause() {
        return (this._src.pause());
};


MessageDecoder.prototype.write = function write(buf) {
        var checksum;
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
                self.emit('error',
                          new ChecksumError(msg.checksum, checksum, msg));
                return (false);
        }

        try {
                msg.data = JSON.parse(msg.data);
        } catch (e) {
                self.emit('error', new InvalidContentError(e));
                return (false);
        }

        msg.start = microtime.now();
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
