// Copyright 2012 Mark Cavage, Inc.  All rights reserved.
//
// Just a simple wrapper over nodeunit's exports syntax. Also exposes
// a common logger for all tests.
//



///--- Exports

module.exports = {

        after: function after(callback) {
                module.parent.tearDown = callback;
        },

        before: function before(callback) {
                module.parent.setUp = callback;
        },

        test: function test(name, tester) {
                module.parent.exports[name] = tester;
        }
};
