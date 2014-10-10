// Copyright 2013 Mark Cavage.  All rights reserved.

var EventEmitter = require('events').EventEmitter;
var util = require('util');

var assert = require('assert-plus');

var DTrace = require('./dtrace');
var RpcEncoder = require('./rpc_encoder').RpcEncoder;



///--- API

function RpcDecoder(options) {
    assert.object(options, 'options');
    assert.object(options.connection, 'options.connection');
    assert.object(options.decoder, 'options.decoder');
    assert.object(options.encoder, 'options.encoder');
    assert.object(options.emitter, 'options.emitter');

    var decoder = options.decoder;
    var emitter = options.emitter;
    var checkDefined = options.checkDefined;
    var self = this;

    decoder.on('message', function onMessage(msg) {
        if (!msg.data || !msg.data.m || !msg.data.d) {
            self.emit('error', new Error('invalid message'));
            return (undefined);
        }

        var args = msg.data.d.slice();
        args.unshift(msg.data.m.name);
        var encoder = new RpcEncoder({
            connection: options.connection,
            encoder: options.encoder,
            method: msg.data.m.name,
            msgid: msg.msgid,
            start: msg.start,
            _arguments: msg.data.d
        });
        args.push(encoder);

        // decoder.once('end', function onEnd() {
        //     encoder.emit('end');
        // });

        DTrace.fire('rpc-start', function (p) {
            return ([msg.data.m.name,
                     msg.msgid,
                     JSON.stringify(msg.data.d)]);
        });
        if (checkDefined && emitter.listeners(args[0]).length === 0) {
            // complain about missing RPC, if requested
            var err = new Error('no handler for ' + args[0]);
            err.name = 'RPCNotDefinedError';
            encoder.end(err);
        } else {
            emitter.emit.apply(emitter, args);
        }
        return (undefined);
    });
}
util.inherits(RpcDecoder, EventEmitter);



///--- Exports

module.exports = {
    RpcDecoder: RpcDecoder
};
