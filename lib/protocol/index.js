// Copyright 2012 Mark Cavage, Inc.  All rights reserved.

var MessageDecoder = require('./message_decoder').MessageDecoder;
var MessageEncoder = require('./message_encoder').MessageEncoder;
var RpcDecoder = require('./rpc_decoder').RpcDecoder;
var RpcEncoder = require('./rpc_encoder').RpcEncoder;



module.exports = {
        MessageDecoder: MessageDecoder,
        MessageEncoder: MessageEncoder,
        RpcDecoder: RpcDecoder,
        RpcEncoder: RpcEncoder
};

var proto = require('./protocol');
Object.keys(proto).forEach(function (k) {
        module.exports[k] = proto[k];
});
