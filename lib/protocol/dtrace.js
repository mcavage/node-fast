// Copyright 2013 Mark Cavage.  All rights reserved.




///--- Globals

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
        try {
            var dtrace = require('dtrace-provider');
            PROVIDER = dtrace.createDTraceProvider('fast');

            Object.keys(PROBES).forEach(function (p) {
                var args = PROBES[p].splice(0);
                args.unshift(p);

                PROVIDER.addProbe.apply(PROVIDER, args);
            });
            PROVIDER.enable();
        } catch (e) {
            PROVIDER = {
                fire: function () {},
                enable: function () {},
                addProbe: function () {
                    return ({fire: function () {}});
                },
                removeProbe: function () {},
                disable: function () {}
            };
        }
    }

    return (PROVIDER);
}();
