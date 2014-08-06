// Copyright 2012 Mark Cavage.  All rights reserved.

var fast = require('../lib');
var test = require('tape').test;



///--- Tests

test('serialize ok', function (t) {
    var encoder = new fast.MessageEncoder();

    encoder.on('readable', function onReadable() {
        var buf = encoder.read();
        t.ok(buf);
        t.equal(buf[0], 0x01); // v
        t.equal(buf[1], 0x01); // t
        t.equal(buf[2], 0x01); //s
        t.equal(buf.readUInt32BE(3), 123); // id
        t.ok(buf.readInt32BE(7)); // crc
        t.equal(buf.readUInt32BE(11), 17); // len
        t.deepEqual(JSON.parse(buf.slice(15, 32).toString()), {
            hello: 'world'
        });
        t.end();
    });
    encoder.send({
        msgid: 123,
        data: {
            hello: 'world'
        },
        status: 0x01,
        type: 0x01,
        version: 0x01
    });
});


test('deserialize ok', function (t) {
    var encoder = new fast.MessageEncoder();
    var decoder = new fast.MessageDecoder();


    var msg1 = {
        msgid: 123,
        data: {
            hello: 'world'
        },
        status: 0x01,
        type: 0x01,
        version: 0x01
    };

    decoder.on('message', function (msg2) {
        t.ok(msg2);
        t.equal(msg2.msgid, msg1.msgid);
        t.equal(msg2.status, msg1.status);
        t.equal(msg2.type, msg1.type);
        t.equal(msg2.version, msg1.version);
        t.deepEqual(msg2.data, msg1.data);
        t.end();
    });

    encoder.pipe(decoder);
    encoder.send(msg1);
});
