// client.js
// CLI: node client.js <name>
// interage por stdin: /join <room>, /publish <room> <texto>, /tombstone <mid>, /listrooms, /peers
// mensagens 1:1 via HELLO/ACCEPT/ENC

const WebSocket = require('ws');
const cbor = require('cbor-x');
const sodium = require('libsodium-wrappers');
const readline = require('readline');

(async () => {
  await sodium.ready;

  const name = process.argv[2] || ('client-' + Math.floor(Math.random()*1000));
  // keypair for box (curve25519)
  const boxKP = sodium.crypto_box_keypair();
  const did = `did:opp:ed25519:${Buffer.from(boxKP.publicKey).toString('base64')}`;
  console.log(`[${name}] DID: ${did}`);

  const RELAY = process.env.OPP_RELAY || 'ws://localhost:8080';
  const ws = new WebSocket(RELAY);
  ws.binaryType = 'arraybuffer';

  // session symmetric keys by peer DID
  const sessionKeys = {}; // did -> Uint8Array (32)

  // rooms joined map -> (optionally local groupKey)
  const joinedRooms = {}; // room -> {groupKeyBase64?}

  function send(obj) {
    ws.send(cbor.encode(obj));
  }

  ws.on('open', () => {
    console.log(`[${name}] conectado ao relay ${RELAY}`);
    const hello = { type: 'HELLO', from: did, pub: Buffer.from(boxKP.publicKey).toString('base64'), name };
    send(hello);
    console.log(`[${name}] HELLO enviado`);
    showHelp();
  });

  ws.on('message', (raw) => {
    const data = raw instanceof ArrayBuffer ? Buffer.from(raw) : raw;
    const msg = cbor.decode(data);

    // ignore echoes from self (relay may broadcast)
    if (msg.from === did) return;

    switch (msg.type) {
      case 'HELLO':
        console.log(`[${name}] HELLO de ${msg.from} (${msg.name || ''})`);
        // derive symmetric and store
        try {
          const peerPub = Buffer.from(msg.pub, 'base64');
          const shared = sodium.crypto_scalarmult(boxKP.privateKey, peerPub);
          const symKey = sodium.crypto_generichash(32, shared);
          sessionKeys[msg.from] = symKey;
          console.log(`[${name}] chave simétrica criada com ${msg.from}`);
        } catch (e) { console.warn('erro derivando:', e.message); }
        // send ACCEPT
        send({ type: 'ACCEPT', from: did, to: msg.from, pub: Buffer.from(boxKP.publicKey).toString('base64'), name });
        console.log(`[${name}] ACCEPT -> ${msg.from}`);
        break;

      case 'ACCEPT':
        if (msg.to !== did) break;
        console.log(`[${name}] ACCEPT recebido de ${msg.from}`);
        // derive symmetric
        try {
          const peerPub = Buffer.from(msg.pub, 'base64');
          const shared = sodium.crypto_scalarmult(boxKP.privateKey, peerPub);
          const symKey = sodium.crypto_generichash(32, shared);
          sessionKeys[msg.from] = symKey;
          console.log(`[${name}] chave simétrica criada com ${msg.from}`);
        } catch (e) { console.warn('erro derivando:', e.message); }
        break;

      case 'ENC':
        // it can be 1:1 or room
        if (msg.to && msg.to !== did && !msg.room) break;
        if (msg.room) {
          // room encrypted: try groupKey if available
          const room = msg.room;
          const gk = joinedRooms[room] && joinedRooms[room].groupKey;
          if (!gk) {
            console.log(`[${name}] Mensagem de sala ${room} recebida, sem groupKey local. Mid=${msg.mid}`);
            // still ack? skip
            break;
          }
          try {
            const nonce = Buffer.from(msg.nonce, 'base64');
            const ct = Buffer.from(msg.data, 'base64');
            const gkey = Buffer.from(gk, 'base64');
            const pt = sodium.crypto_secretbox_open_easy(ct, nonce, gkey);
            const text = Buffer.from(pt).toString('utf8');
            console.log(`[${name}] [room:${room}] ${msg.from}: ${text} (mid=${msg.mid})`);
            // ACK back
            send({ type: 'ACK', from: did, mid: msg.mid, ack_for: msg.to || msg.from, room });
          } catch (e) { console.warn('[room] falha decrypt:', e.message); }
        } else {
          // direct 1:1
          const peer = msg.from;
          if (!sessionKeys[peer]) {
            console.log(`[${name}] ENC de ${peer} recebido mas não há chave, ignorando`);
            break;
          }
          const sym = sessionKeys[peer];
          try {
            const nonce = Buffer.from(msg.nonce, 'base64');
            const ct = Buffer.from(msg.data, 'base64');
            const pt = sodium.crypto_secretbox_open_easy(ct, nonce, sym);
            const text = Buffer.from(pt).toString('utf8');
            console.log(`[${name}] (direct) ${peer}: ${text} (mid=${msg.mid})`);
            // send ACK
            send({ type: 'ACK', from: did, mid: msg.mid, ack_for: peer });
          } catch (e) {
            console.warn('[direct] falha decrypt:', e.message);
          }
        }
        break;

      case 'SUBSCRIBE':
        // ignore (server handles)
        break;

      case 'ACK':
        console.log(`[${name}] ACK recebido para mid=${msg.mid} from=${msg.from}`);
        break;

      case 'TOMBSTONE':
        console.log(`[${name}] TOMBSTONE recebido: target_mid=${msg.target_mid} by=${msg.from}`);
        break;

      default:
        // untyped broadcast
        console.log('[relay] mensagem não tipada recebida:', msg);
        break;
    }
  });

  ws.on('close', () => console.log(`[${name}] desconectado do relay`));

  // CLI
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: `${name}> ` });
  rl.prompt();

  function showHelp() {
    console.log('Comandos:');
    console.log('/join <room> [groupKeyBase64]   -> entrar na sala; opcionalmente setar group key base64 para decriptar mensagens da sala');
    console.log('/publish <room> <texto>         -> publica (criptografado com groupKey local)');
    console.log('/send <peerDid> <texto>         -> envia mensagem 1:1 cifrada');
    console.log('/tombstone <mid>                -> publica tombstone (revoga mensagem)');
    console.log('/listrooms                       -> mostra rooms locais');
    console.log('/peers                           -> mostra peers com chave simétrica');
    console.log('/help                            -> mostra este help');
  }

  rl.on('line', (line) => {
    const parts = line.trim().split(' ');
    const cmd = parts[0];

    if (cmd === '/help') { showHelp(); rl.prompt(); return; }
    if (cmd === '/peers') { console.log('peers:', Object.keys(sessionKeys)); rl.prompt(); return; }
    if (cmd === '/listrooms') { console.log('joined rooms:', Object.keys(joinedRooms)); rl.prompt(); return; }

    if (cmd === '/join') {
      const room = parts[1];
      const groupKeyBase64 = parts[2]; // optional
      if (!room) { console.log('usage: /join <room> [groupKeyBase64]'); rl.prompt(); return; }
      joinedRooms[room] = { groupKey: groupKeyBase64 || null };
      // request backlog from relay
      send({ type: 'SUBSCRIBE', from: did, room });
      console.log(`[${name}] subscribed to room ${room}`);
      rl.prompt(); return;
    }

    if (cmd === '/publish') {
      const room = parts[1];
      const rest = parts.slice(2).join(' ');
      if (!room || !rest) { console.log('usage: /publish <room> <texto>'); rl.prompt(); return; }
      const gk = joinedRooms[room] && joinedRooms[room].groupKey;
      if (!gk) { console.log('no groupKey for room; use /join <room> <groupKeyBase64> to set'); rl.prompt(); return; }
      const nonce = sodium.randombytes_buf(24);
      const ct = sodium.crypto_secretbox_easy(Buffer.from(rest,'utf8'), nonce, Buffer.from(gk,'base64'));
      const mid = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
      const msg = { type:'ENC', from: did, room, mid, nonce: Buffer.from(nonce).toString('base64'), data: Buffer.from(ct).toString('base64'), ts: Date.now() };
      send(msg);
      console.log(`[${name}] published to ${room} mid=${mid}`);
      rl.prompt(); return;
    }

    if (cmd === '/send') {
      const peer = parts[1];
      const rest = parts.slice(2).join(' ');
      if (!peer || !rest) { console.log('usage: /send <peerDid> <texto>'); rl.prompt(); return; }
      if (!sessionKeys[peer]) { console.log('no session key for peer; wait for HELLO/ACCEPT or exchange keys'); rl.prompt(); return; }
      const sym = sessionKeys[peer];
      const nonce = sodium.randombytes_buf(24);
      const ct = sodium.crypto_secretbox_easy(Buffer.from(rest,'utf8'), nonce, sym);
      const mid = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
      send({ type:'ENC', from: did, to: peer, mid, nonce: Buffer.from(nonce).toString('base64'), data: Buffer.from(ct).toString('base64'), ts: Date.now() });
      console.log(`[${name}] message sent to ${peer} mid=${mid}`);
      rl.prompt(); return;
    }

    if (cmd === '/tombstone') {
      const mid = parts[1];
      if (!mid) { console.log('usage: /tombstone <mid>'); rl.prompt(); return; }
      send({ type:'TOMBSTONE', from: did, target_mid: mid, ts: Date.now() });
      console.log(`[${name}] tombstone published for mid=${mid}`);
      rl.prompt(); return;
    }

    console.log('comando desconhecido. /help para ajuda.');
    rl.prompt();
  });

})();
