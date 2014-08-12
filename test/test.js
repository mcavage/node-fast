// Copyright 2014 Joyent, Inc.  All rights reserved.


var fs = require('fs');
var path = require('path');

function runTests(directory) {
    fs.readdir(directory, function (err, files) {
        files.filter(function (f) {
            return (/\.test\.js$/.test(f));
        }).map(function (f) {
            return (path.join(directory, f));
        }).forEach(require);
    });
}

///--- Run All Tests

(function main() {
    runTests(__dirname);
})();
