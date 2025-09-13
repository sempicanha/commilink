# CommiLink Protocol (CMLK) --- README

> Complete documentation of the **CommiLink Protocol (CMLK)**\
> Hybrid, multi-transport, E2EE (end-to-end encryption) protocol with
> support for relay, store-and-forward/DTN, rooms, and tombstones.

------------------------------------------------------------------------

## Table of Contents

-   [Overview](#overview)\
-   [CMLK Differentiators](#cmlk-differentiators)\
-   [Architecture and Flows](#architecture-and-flows)\
-   [Messages and Specification](#messages-and-specification)\
-   [Reference Implementation](#reference-implementation)
    -   [Dependencies](#dependencies)\
    -   [Relay WebSocket (`server.js`)](#relay-websocket-serverjs)\
    -   [Node.js Client (`client.js`)](#nodejs-client-clientjs)\
    -   [Running Locally --- Step by
        Step](#running-locally--step-by-step)\
-   [E2EE Handshakes and Key
    Derivation](#e2ee-handshakes-and-key-derivation)\
-   [Rooms / Groups](#rooms--groups)\
-   [ACKs and Tombstones](#acks-and-tombstones)\
-   [Persistence and
    Store-and-Forward](#persistence-and-store-and-forward)\
-   [Security, Limitations, and Next
    Steps](#security-limitations-and-next-steps)\
-   [License / Contributions](#license--contributions)

------------------------------------------------------------------------

## Overview

The **CommiLink Protocol (CMLK)** is a decentralized communication
protocol that:

-   Supports **peer-to-peer (1:1)** and **group (rooms)**
    communication.\
-   Is **adaptive** and prepared for multiple transports: WebSocket,
    QUIC, BLE, LoRa, SMS.\
-   Ensures **end-to-end encryption** using **Curve25519** and symmetric
    key derivation.\
-   Allows **relay / store-and-forward** for offline or intermittent
    devices.\
-   Includes **capability tokens, tombstones, and optional persistence**
    for message control and revocation.

This repository provides an **MVP**:

-   Simple WebSocket relay (`server.js`)\
-   Node.js CLI client (`client.js`)

The relay **does not access encrypted message contents**, only routes
and temporarily stores them.

------------------------------------------------------------------------

## CMLK Differentiators

  Feature                  Description
  ------------------------ -------------------------------------------------------------
  Multi-transport          Works over WebSocket, BLE, LoRa, QUIC, SMS.
  E2EE                     End-to-end encrypted messages (Curve25519 + symmetric key).
  Decentralized identity   DID based on Ed25519.
  Rooms                    Group rooms with optional decryption key.
  Store-and-forward        Relay stores messages for offline devices.
  Tombstones               Revocation of old or compromised messages.
  ACKs                     Delivery confirmation, store update.

------------------------------------------------------------------------

## Architecture and Flows

### Basic 1:1 Flow

``` mermaid
flowchart LR
  A[Client A] -->|HELLO| R[Relay]
  R --> B[Client B]
  B -->|ACCEPT| R
  R --> A
  A -->|ENC (encrypted message)| R
  R --> B
```

### Basic Room Flow

``` mermaid
flowchart LR
  A[Client A] -->|HELLO| R[Relay]
  B[Client B] -->|HELLO| R
  C[Client C] -->|HELLO| R
  A -->|ENC (room)| R
  B -->|ENC received| D[Local decryption with groupKey]
  C -->|ENC received| D
```

### Components

-   **Client**: generates DID, box key (Curve25519), connects and sends
    HELLO.\
-   **Relay**: routes messages, temporarily stores them, sends backlog
    to new room subscribers.\
-   **Rooms**: logical channels with optional group key.

------------------------------------------------------------------------

## Messages and Specification

### Format

-   **CBOR** (`cbor-x` in Node.js) --- compact and efficient.

### Message Types

  -----------------------------------------------------------------------
  Type                               Description
  ---------------------------------- ------------------------------------
  HELLO                              Starts contact, sends DID and public
                                     key for symmetric key derivation.

  ACCEPT                             Accepts connection, sends peer's
                                     public key.

  ENC                                Encrypted message (1:1 or room).

  SUBSCRIBE                          Requests room backlog.

  ACK                                Confirms message receipt (`mid`).

  TOMBSTONE                          Revokes message (`mid`) or removal
                                     instructions.
  -----------------------------------------------------------------------

### Example HELLO

``` json
{
  "type": "HELLO",
  "from": "did:cmlk:ed25519:BASE64PUB",
  "pub": "BASE64BOXPK",
  "name": "Alice"
}
```

### Example ACCEPT

``` json
{
  "type": "ACCEPT",
  "from": "did:cmlk:ed25519:BASE64PUB",
  "to": "did:cmlk:ed25519:BASE64PUB",
  "pub": "BASE64BOXPK",
  "name": "Bob"
}
```

### Example ENC 1:1

``` json
{
  "type": "ENC",
  "from": "did:cmlk:ed25519:BASE64PUB",
  "to": "did:cmlk:ed25519:BASE64PUB",
  "nonce": "BASE64",
  "data": "BASE64_CIPHERTEXT",
  "mid": "timestamp-random",
  "ts": 1690000000000
}
```

### Example ENC Room

``` json
{
  "type": "ENC",
  "from": "did:cmlk:ed25519:BASE64PUB",
  "room": "room-abc",
  "nonce": "BASE64",
  "data": "BASE64_CIPHERTEXT",
  "mid": "timestamp-random",
  "ts": 1690000000000
}
```

### Example TOMBSTONE

``` json
{
  "type": "TOMBSTONE",
  "from": "did:cmlk:ed25519:BASE64PUB",
  "target_mid": "timestamp-random",
  "ts": 1690000000000
}
```

------------------------------------------------------------------------

## Reference Implementation

### Dependencies

``` bash
npm install ws cbor-x libsodium-wrappers readline
```

### Relay WebSocket (`server.js`)

-   Manages client connections.\
-   Store-and-forward by DID and by rooms.\
-   Optional persistence in JSON file (`opp_store.json`).\
-   Forwards HELLO, ACCEPT, ENC, SUBSCRIBE, ACK, TOMBSTONE.

**Run:**

``` bash
node server.js
```

Relay at `ws://localhost:8080`.

### Node.js Client (`client.js`)

-   Interactive CLI: `/join <room> [groupKey]`, `/publish <room> <msg>`,
    `/send <peer> <msg>`, `/tombstone <mid>`.\
-   Derives symmetric key via `crypto_scalarmult` with peer's public
    key.\
-   Encrypts messages with `crypto_secretbox_easy`.\
-   Receives and processes ACKs and TOMBSTONES.

**Run:**

``` bash
node client.js Alice
node client.js Bob
```

------------------------------------------------------------------------

## Running Locally --- Step by Step

1.  Start relay:

``` bash
node server.js
```

2.  Open two terminals and run clients:

``` bash
node client.js Alice
node client.js Bob
```

3.  In client CLI:

``` text
/join room1 QWxhZGRpbjpPcGVuU2VzYW1l  # optional Base64 groupKey
/publish room1 "Hello room!"
/send did:cmlk:ed25519:BASE64PUB "Message 1:1"
/tombstone 1690000000000-rnd
/peers
/listrooms
```

------------------------------------------------------------------------

## E2EE Handshakes and Key Derivation

1.  Each peer generates:
    -   `sign keypair` (Ed25519) for signing/verification.\
    -   `box keypair` (Curve25519) for symmetric key derivation.\
2.  HELLO sent with `pub`.\
3.  Peer responds ACCEPT with its `pub`.\
4.  Each peer computes:

``` text
shared = crypto_scalarmult(privateKey, peerPub)
symKey = crypto_generichash(32, shared)
```

5.  `symKey` is used for ENC message encryption/decryption.

Relay does not access encrypted content.

------------------------------------------------------------------------

## Rooms / Groups

-   `/join <room> [groupKeyBase64]` joins a room.\
-   `/publish <room> <msg>` publishes encrypted message with local
    **groupKey**.\
-   Relay stores room backlog and delivers to new subscribers.\
-   Messages cannot be read without the correct **groupKey**.

------------------------------------------------------------------------

## ACKs and Tombstones

-   **ACK**: confirms receipt of `mid`. Removes from relay and rooms
    queue.\
-   **TOMBSTONE**: revokes message. Removes from pending and rooms.
    Propagates to all.

------------------------------------------------------------------------

## Persistence and Store-and-Forward

-   Relay keeps `store` in memory (`byClientDid`, `rooms`).\
-   Can save/load from `opp_store.json`.\
-   Ensures delivery even if client was offline at send time.

------------------------------------------------------------------------

## Security, Limitations, and Next Steps

-   Relay must not access encrypted messages.\
-   MVP limitations: WebSocket only, simple rooms.\
-   Future: multi-transport, compression, capabilities, key revocation,
    IoT support.\
-   Avoid exposing groupKeys outside the client.\
-   Monitor backlog size in large rooms.

------------------------------------------------------------------------

## License / Contributions

-   MIT License.\
-   Contributions via pull request or issues welcome.
