##CMLK Protocol Documentation

## 📂 Message Structure

### HELLO
# Sent to connect to relay.

```json
{
  "type": "HELLO",
  "from": "did:opp:ed25519:abc...",
  "pub": "base64-publicKey",
  "name": "client42"
}
```

### ACCEPT
# Sent in response to a HELLO to establish a symmetric key.

```json
{
  "type": "ACCEPT",
  "from": "did:opp:ed25519:def...",
  "to": "did:opp:ed25519:abc...",
  "pub": "base64-publicKey",
  "name": "client99"
}
```

### Send Messages Format Object

# ENC (1:1 encrypted message) Bob and Alice
```json
{
  "type": "ENC",
  "from": "did:opp:ed25519:abc...",
  "to": "did:opp:ed25519:def...",
  "mid": "1694630172000-xyz123",
  "nonce": "base64-nonce",
  "data": "base64-ciphertext",
  "ts": 1694630172000
}
```


# ENC (encrypted message in room)
to create a room, a room name and a shared message description key are recommended

```json
{
  "type": "ENC",
  "from": "did:opp:ed25519:abc...",
  "room": "sala-chat",
  "mid": "1694630172000-xyz123",
  "nonce": "base64-nonce",
  "data": "base64-ciphertext",
  "ts": 1694630172000
}
```
# ACK
Confirmation of shipping and receipt

```json
{
  "type": "ACK",
  "from": "did:opp:ed25519:def...",
  "ack_for": "did:opp:ed25519:abc...",
  "mid": "1694630172000-xyz123",
  "room": "sala-chat"
}
```

# SUBSCRIBE
sign up for rooms

```json
{
  "type": "SUBSCRIBE",
  "from": "did:opp:ed25519:def...",
  "room": "sala-chat"
}
```

# TOMBSTONE
mark message as invalid and remove from other peers

```json
{
  "type": "TOMBSTONE",
  "from": "did:opp:ed25519:def...",
  "target_mid": "1694630172000-xyz123",
  "ts": 1694630200000
}
```

#Persistence
Generic storage structure:

- byClientDid: Message queue for offline clients.

- Rooms: Backlog of messages published in rooms.

```json
{
  "byClientDid": {
    "did:example:client1": {
      "pending": [ { ...mensagem... } ]
    }
  },
  "rooms": {
    "sala-chat": [ { ...mensagem... } ]
  }
}
```


# Lifecycle

Client connects and sends HELLO.

Relay records pending DID and delivery.

Client sends ENC (to another client or room).

Recipient sends ACK upon receipt.

Relay removes message from queue.

Message can be manually removed with TOMBSTONE.

# Transport

The protocol is transport-agnostic.

Reference implementation uses WebSocket.

Possible alternatives: QUIC, pure TCP, WebRTC.

# Security Considerations

The payload should be considered opaque to the relay.

End-to-end encryption is recommended.

Relays should not trust from fields without external authentication.

# Extensibility

New message types can be added.

Clients that do not recognize types should ignore them.
