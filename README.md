`fast` is a very small JSON over TCP messaging framework.  Effectively, it lets
you write RPC systems that "stream" many results back for a single message (not in
the sense of a streaming JSON parser, but in the sense of many objects that are
correlated).  For example:

    var fast = require('fast');
    var server = fast.createServer();

    server.rpc('echo', function (fname, lname, res) {
	    res.write({first: fname});
		res.end({last: lname});
    });

	server.listen(1234);

    /// Client
    var client = fast.createClient({host: 'localhost', port: 1234});
	client.on('connect', function () {
	    var req = client.rpc('echo', 'mark', 'cavage');
		req.on('message', function (obj) {
		    console.log(JSON.stringify(obj, null, 2));
        });
		req.on('end', function () {
		    client.close();
			server.close();
        });
    });


While does what you think it does.  A few things to note:

* There's a "gentlemen's agreement" in argument reconstruction.  Whatever you
  pass client side as arguments shows up, in that order, server side.  So in
  the example above, note that `server.rpc('echo', function (f, l, res) {})`,
  gave us the client's set of strings and a `res` object you use to kick back
  results on as the last argument.  It just does that.
* Whatever you send back server side shows up on the client `.on('message')`
  the same as the server.  So above, I sent back an object, but you can send
  back anything, and the arguments will "line up".
* Server-side, you can send data either via write or end (as above).  Also, if
  you pass something that `instanceof Error` returns true on, that gets
  spit out as a `req.on('error', function (err) {})` client-side.

That's pretty much it.  This needs a lot more docs, but for now, I'm throwing
this up on github as-is, and I'll add more over time.

# Installation

    npm install fast

# Protocol

Basically, I cooked a small header+data payload like this:

```
Byte/     0       |       1       |       2       |       3       |
   /              |               |               |               |
  |0 1 2 3 4 5 6 7|0 1 2 3 4 5 6 7|0 1 2 3 4 5 6 7|0 1 2 3 4 5 6 7|
  +---------------+---------------+---------------+---------------+
 0|Version        |Type           |Status         |MessageID
  +---------------+---------------+---------------+---------------+
 4|                                               |CRC16
  +---------------+---------------+---------------+---------------+
 8|                                               |DataLen
  +---------------+---------------+---------------+---------------+
12|                                               |Data...
  +---------------+---------------+---------------+---------------+
16|...
```

Where:

* Version: Currently always `0x01`
* Type: Currently always `0x01` (Means JSON -> may add GZIP JSON, etc., later)
* Status: An enum to reflect the what this message is in the sequence:
** 0x01: `data`: More messages to come
** 0x02: `end`: No more messages to come (All is well)
** 0x03: `error`: No more messages to come; error returned from server in `data`
* MessageID: A 32-bit UInt32 (big endian encoded) from 1 - (2^32 − 1).  A client
  sets this initially, and all messages returned from the server to the client
  that correspond to the request must carry the same messageID.
* CRC16: CRC16 of the data, encoded as a 32bit signed integer (big endian)
* DataLen: 32-bit UInt32, encoded big endian.
* Data: JSON-encoded data payload.

On top of that, there is "moar gentlemenly agreement" of what "data" looks like
to facilitate RPC.  Basically, `data` is a JSON object like this:

    {
	    m: {
		    name: 'echo',
			uts: gettimeofday(2) // microseconds since epoch
        },
		d: [] // "arguments" to JS function
    }

That's pretty much it.  Note there is effectively no try/catch or anything like
that in this framework, as it's intended to be run "carefully".  If it's too
problematic I'll add that, but clearly this is meant to do one thing: go fast
from internal service A to internal service B.  YMMV.
# Licence

MIT
