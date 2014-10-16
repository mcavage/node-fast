# node-fast Changelog

## 0.4.1

- Update dtrace-provider to 0.3.0

## 0.4.0

 - Add support for canceling in-progress RPCs
 - Force missing RPC endpoint errors in server
   * This was formerly optional behavior enabled by checkDefined in versions
     0.3.9 and 0.3.10.  Now, any RPC to a missing endpoint will result in an
     error emitted to the client.
 - Change dtrace-provider to optional dependency
 - Update microtime to 1.0.1
 - Add client property for pending request count

## 0.3.10

 - MANTA-2315: Simplify socket error/close events

## 0.3.9

 - Add optional error when calling undefined RPC
   * When server is created with checkDefined parameter enabled, RPC calls to
     non-existent endpoint will result in an error being emitted to the client.
 - Change tests to tape/faucet/istanbul
 - Update node-backoff to 2.4.0
 - MANTA-2315: Improve connect attempt error events
 - Fix #8: server throwing EPIPE when connection is closed
 - Expose connection for requests

## 0.3.8

 - MANTA-1987: Fix race in connection close
