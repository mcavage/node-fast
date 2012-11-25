// Copyright 2012 Mark Cavage.  All rights reserved.

var dtrace = require('dtrace-provider');



///--- Globals

var DTraceProvider = dtrace.DTraceProvider;

var PROBES = {
        // method_name, message_id, JSON.stringify(arguments)
        'rpc-start': ['char *', 'int', 'char *'],

        // method_name, message_id, status, JSON.stringify(arguments)
        'rpc-msg': ['char *', 'int', 'int', 'char *'],

        // method_name, message_id
        'rpc-done': ['char *', 'int']
};
var PROVIDER;



///--- API

module.exports = function exportStaticProvider() {
        if (!PROVIDER) {
                PROVIDER = dtrace.createDTraceProvider('fast');

                PROVIDER._fast_probes = {};

                Object.keys(PROBES).forEach(function (p) {
                        var args = PROBES[p].splice(0);
                        args.unshift(p);

                        var probe = PROVIDER.addProbe.apply(PROVIDER, args);
                        PROVIDER._fast_probes[p] = probe;
                });

                PROVIDER.enable();
        }

        return (PROVIDER);
}();
