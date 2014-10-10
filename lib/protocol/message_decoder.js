// Copyright 2013 Mark Cavage.  All rights reserved.

var Writable = require('readable-stream').Writable;
var util = require('util');

var assert = require('assert-plus');
var crc = require('crc');
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



///--- API

function MessageDecoder() {
    Writable.call(this);

    this._buf = null;
    this._msg = null;
}
util.inherits(MessageDecoder, Writable);


MessageDecoder.prototype._write = function _write(buf, encoding, cb) {
    var checksum;
    var msg;
    var self = this;

    if (this._buf) {
        // Wed Underrun data on a previous call
        var len = this._buf.length + buf.length;
        buf = Buffer.concat([this._buf, buf], len);
    }

    assert.ok(Buffer.isBuffer(buf));
    msg = this._msg || {};

    while (buf.length > 0) {
        if (!parseBuffer(buf, msg)) {
            this._buf = buf;
            this._msg = msg;
            cb();
            return;
        }

        checksum = crc.crc16(msg.data);
        if (msg.checksum !== checksum) {
            var e = new ChecksumError(msg.checksum, checksum, msg);
            self.emit('error', e);
        }

        try {
            msg.data = JSON.parse(msg.data);
        } catch (parse_err) {
            self.emit('error', new InvalidContentError(parse_err));
        }

        msg.start = process.hrtime();
        this.emit('message', msg);

        buf = buf.slice(msg._offset);
        msg = {};
    }

    this._buf = null;
    this._msg = null;
    cb();
};

///--- Exports

module.exports = {

    MessageDecoder: MessageDecoder,

    createMessageDecoder: function createMessageDecoder() {
        return (new MessageDecoder());
    }

};
