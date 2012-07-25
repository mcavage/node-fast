// Copyright 2012, Mark Cavage

var EventEmitter = require('events').EventEmitter;
var net = require('net');
var util = require('util');

var assert = require('assert-plus');
var clone = require('clone');
var WError = require('verror').WError;

var protocol  = require('./protocol');



///--- Globals

var slice = Function.prototype.call.bind(Array.prototype.slice);

var MAX_MSGID = Math.pow(2, 31) - 1;
var MSGID = 0;



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



///--- API

function Client(options) {
        EventEmitter.call(this);

        var self = this;

        this.requests = {};

        this.conn = net.connect(options, function onConnection() {
                self.emit('connect');
        });

        this.conn.on('error', function onError(err) {
                self.emit('error', err);
                cleanupListener(self.conn);
        });

        this.conn.on('end', function onEnd() {
                cleanupListener(self.conn);
        });

        this.messageDecoder = new protocol.MessageDecoder();
        this.messageEncoder = new protocol.MessageEncoder();

        this.conn.pipe(this.messageDecoder);
        this.messageEncoder.pipe(this.conn);
        this.messageDecoder.on('message', function onResponse(msg) {
                if (!msg.data || !msg.data.m || !msg.data.d) {
                        self.emit('error', new Error('invalid message'));
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
                                self.requests[msg.msgid] = null;
                                break;

                        default:
                                err = new Error(msg.data.d.message);
                                err.stack = msg.data.d.stack;
                                err = new WError(err, msg.data.d.message);
                                req.emit('error', err);
                                self.requests[msg.msgid] = null;
                                cleanupListener(req);
                                break;
                        }
                } else {
                        err = new Error('unsolicited message');
                        err.msg = msg;
                        req.emit('error', err);
                }
                return (undefined);
        });
}
util.inherits(Client, EventEmitter);


Client.prototype.close = function close() {
        this.conn.end();
};


Client.prototype.rpc = function rpc(method) {
        assert.string(method, 'method');

        var msgid = nextMessageId();
        var self = this;
        var encoder = new protocol.RpcEncoder({
                encoder: self.messageEncoder,
                msgid: msgid,
                method: method
        });

        encoder.encode.apply(encoder, slice(arguments, 1));

        var req = new EventEmitter();
        this.requests[msgid] = req;

        return (req);
};



///--- Exports

module.exports = {
        createClient: function createClient(options) {
                return (new Client(options));
        }
};
