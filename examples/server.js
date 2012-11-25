// Copyright 2012 Mark Cavage.  All rights reserved.

var fast = require('../lib');


var server = fast.createServer();

server.rpc('echo', function (name, res) {
        res.write({user: name});
        res.end();
});

server.listen(1234);

var client = fast.createClient({host: '127.0.0.1', port: 1234});
client.on('connect', function client_run() {
        var req = client.rpc('echo', process.env.USER);
        req.on('message', function (obj) {
                if (process.env.DEBUG)
                        console.log(JSON.stringify(obj, null, 2));
        });
        req.on('end', function () {
                client_run();
        });
});
