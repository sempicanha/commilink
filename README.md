# CommiLink Protocol (CMLK) — README

> Documentação completa do **CommiLink Protocol (CMLK)**  
> Protocolo híbrido, multi-transporte, E2EE (end-to-end encryption), com suporte a relay, store-and-forward/DTN, salas (rooms) e tombstones.

---

## Sumário

- [Visão geral](#visão-geral)  
- [Diferenciais do CMLK](#diferenciais-do-cmlk)  
- [Arquitetura e fluxos](#arquitetura-e-fluxos)  
- [Mensagens e especificação](#mensagens-e-especificação)  
- [Implementação de referência](#implementação-de-referência)  
  - [Dependências](#dependências)  
  - [Relay WebSocket (`server.js`)](#relay-websocket-serverjs)  
  - [Cliente Node.js (`client.js`)](#cliente-nodejs-clientjs)  
  - [Rodando localmente — passo a passo](#rodando-localmente---passo-a-passo)  
- [Handshakes E2EE e derivação de chaves](#handshakes-e2ee-e-derivação-de-chaves)  
- [Rooms / grupos](#rooms--grupos)  
- [ACKs e Tombstones](#acks-e-tombstones)  
- [Persistência e store-and-forward](#persistência-e-store-and-forward)  
- [Segurança, limitações e próximos passos](#segurança-limitações-e-próximos-passos)  
- [Licença / Contribuições](#licença--contribuições)  

---

## Visão geral

O **CommiLink Protocol (CMLK)** é um protocolo de comunicação descentralizado que:

- Suporta **comunicação ponto-a-ponto (1:1)** e **comunicação em grupo (rooms)**.  
- É **adaptativo** e preparado para múltiplos meios de transporte: WebSocket, QUIC, BLE, LoRa, SMS.  
- Garante **end-to-end encryption** usando **Curve25519** e derivação de chaves simétricas.  
- Permite **relay / store-and-forward** para dispositivos offline ou intermitentes.  
- Inclui **capability tokens, tombstones e persistência opcional** para controle de mensagens e revogação.  

Este repositório implementa um **MVP**:

- Relay WebSocket simples (`server.js`)  
- Cliente Node.js CLI (`client.js`)  

O relay **não acessa o conteúdo das mensagens cifradas**, apenas roteia e armazena temporariamente.  

---

## Diferenciais do CMLK

| Característica | Descrição |
|----------------|-----------|
| Multi-transporte | Funciona via WebSocket, BLE, LoRa, QUIC, SMS. |
| E2EE | Mensagens cifradas ponta-a-ponta (Curve25519 + symmetric key). |
| Identidade descentralizada | DID baseado em Ed25519. |
| Rooms | Salas de grupo com chave opcional para decriptação. |
| Store-and-forward | Relay armazena mensagens para dispositivos offline. |
| Tombstones | Revogação de mensagens antigas ou comprometidas. |
| ACKs | Confirmação de entrega, atualização de store. |

---

## Arquitetura e fluxos

### Fluxo básico 1:1

```mermaid
flowchart LR
  A[Cliente A] -->|HELLO| R[Relay]
  R --> B[Cliente B]
  B -->|ACCEPT| R
  R --> A
  A -->|ENC (mensagem cifrada)| R
  R --> B
```

### Fluxo básico em sala (room)

```mermaid
flowchart LR
  A[Cliente A] -->|HELLO| R[Relay]
  B[Cliente B] -->|HELLO| R
  C[Cliente C] -->|HELLO| R
  A -->|ENC (room)| R
  B & C -->|ENC recebido| Local decriptação com groupKey
```

### Componentes

- **Cliente**: gera DID, chave de box (Curve25519), conecta e envia HELLO.  
- **Relay**: roteia mensagens, armazena temporariamente, envia backlog a novos subscribers de rooms.  
- **Rooms**: canais lógicos com chave de grupo opcional.  

---

## Mensagens e especificação

### Formato
- **CBOR** (`cbor-x` em Node.js) — compacto e eficiente.  

### Tipos de mensagem

| Tipo       | Descrição |
|------------|-----------|
| HELLO      | Inicia contato, envia DID e chave pública para derivar chave simétrica. |
| ACCEPT     | Aceita conexão, envia chave pública do peer. |
| ENC        | Mensagem cifrada (1:1 ou sala). |
| SUBSCRIBE  | Solicita backlog de sala. |
| ACK        | Confirma recebimento de mensagem (`mid`). |
| TOMBSTONE  | Revoga mensagem (`mid`) ou instruções de remoção. |

### Exemplo HELLO (conceitual)

```json
{
  "type": "HELLO",
  "from": "did:cmlk:ed25519:BASE64PUB",
  "pub": "BASE64BOXPK",
  "name": "Alice"
}
```

### Exemplo ACCEPT

```json
{
  "type": "ACCEPT",
  "from": "did:cmlk:ed25519:BASE64PUB",
  "to": "did:cmlk:ed25519:BASE64PUB",
  "pub": "BASE64BOXPK",
  "name": "Bob"
}
```

### Exemplo ENC 1:1

```json
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

### Exemplo ENC sala

```json
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

### Exemplo TOMBSTONE

```json
{
  "type": "TOMBSTONE",
  "from": "did:cmlk:ed25519:BASE64PUB",
  "target_mid": "timestamp-random",
  "ts": 1690000000000
}
```

---

## Implementação de referência

### Dependências

```bash
npm install ws cbor-x libsodium-wrappers readline
```

### Relay WebSocket (`server.js`)

- Gerencia conexões de clientes.  
- Store-and-forward por DID e por rooms.  
- Persistência opcional em arquivo JSON (`opp_store.json`).  
- Encaminha HELLO, ACCEPT, ENC, SUBSCRIBE, ACK, TOMBSTONE.  

**Exemplo de execução:**

```bash
node server.js
```

Relay em `ws://localhost:8080`.  

### Cliente Node.js (`client.js`)

- CLI interativa: `/join <room> [groupKey]`, `/publish <room> <msg>`, `/send <peer> <msg>`, `/tombstone <mid>`.  
- Deriva chave simétrica via `crypto_scalarmult` com chave pública do peer.  
- Mensagens cifradas com `crypto_secretbox_easy`.  
- Recebe e processa ACKs e TOMBSTONES.  

**Exemplo de execução:**

```bash
node client.js Alice
node client.js Bob
```

---

## Rodando localmente — passo a passo

1. Inicie relay:

```bash
node server.js
```

2. Abra dois terminais e execute clientes:

```bash
node client.js Alice
node client.js Bob
```

3. No CLI do cliente:

```text
/join room1 QWxhZGRpbjpPcGVuU2VzYW1l  # opcional groupKey Base64
/publish room1 "Olá sala!"
/send did:cmlk:ed25519:BASE64PUB "Mensagem 1:1"
/tombstone 1690000000000-rnd
/peers
/listrooms
```

---

## Handshakes E2EE e derivação de chaves

1. Cada peer gera:
   - `sign keypair` (Ed25519) para assinatura/verificação.  
   - `box keypair` (Curve25519) para derivar chave simétrica.  
2. HELLO enviado com `pub`.  
3. Peer responde ACCEPT com seu `pub`.  
4. Cada peer calcula:

```text
shared = crypto_scalarmult(privateKey, peerPub)
symKey = crypto_generichash(32, shared)
```

5. `symKey` é usada para cifrar/decifrar mensagens ENC.  

Relay não acessa conteúdo cifrado.  

---

## Rooms / grupos

- `/join <room> [groupKeyBase64]` entra em sala.  
- `/publish <room> <msg>` publica mensagem cifrada com **groupKey** local.  
- Relay armazena backlog de sala e envia aos novos subscribers.  
- Mensagens não podem ser lidas sem a **groupKey** correta.  

---

## ACKs e Tombstones

- **ACK**: confirma recebimento de `mid`. Remove da fila do relay e rooms.  
- **TOMBSTONE**: revoga mensagem. Remove de pending e rooms. Propaga para todos.  

---

## Persistência e store-and-forward

- Relay mantém `store` em memória (`byClientDid`, `rooms`).  
- Pode salvar e carregar de `opp_store.json`.  
- Garante entrega mesmo que cliente esteja offline no momento do envio.  

---

## Segurança, limitações e próximos passos

- Relay não deve acessar mensagens cifradas.  
- Limitações do MVP: apenas WebSocket, rooms simples.  
- Futuro: multi-transporte, compressão, capabilities, revogação de chaves, suporte a IoT.  
- Evitar exposição de groupKeys fora do cliente.  
- Monitorar tamanho do backlog em rooms grandes.  

---

## Licença / Contribuições

- Licença MIT.  
- Contribuições via pull request ou issues bem-vindas.

