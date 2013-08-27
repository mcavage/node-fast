// Copyright 2013 Mark Cavage.  All rights reserved.

// The protocol looks like this (rougly):
//
// version|type|status|msgid|crc16|data_len|data
//
// There are no actual '|' separators. The first 3 fields are
// one byte UInts.  `msgid` is 4 bytes encoded Big Endian uint32
// CRC16 is 4 bytes, encoded big endian (so, take the 17 bit number
// and just write it out to all 4 bytes).  data_len is 4 bytes BE
// uint32, and data is just encoded JSON. There you go.
//
// Version is currently 1, and type is currently 1 (which means JSON).
// I may tack in GZIP'd JSON or some such later.
//
// Status byte is one of:
//   1 -> data
//   2 -> end
//   3 -> error
//
module.exports = {
    HEADER_LEN: 15,
    MAX_MSGID: Math.pow(2, 31) -1,
    STATUS: {
        DATA: 0x01,
        END: 0x02,
        ERROR: 0x03
    },
    TYPE_JSON: 0x01,
    VERSION: 0x01
};
