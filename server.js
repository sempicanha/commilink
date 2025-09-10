// server.js
// Relay WebSocket com: store-and-forward, rooms (namespaces), ACKs, TOMBSTONE.
// Persistência simples em arquivo opcional.

const WebSocket = require('ws');
const cbor = require('cbor-x');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
const PERSIST_FILE = path.join(__dirname, 'opp_store.json'); // opcional

// In-memory store:
// clients metadata mapped by ws
// store: { byClientDid: {pending: [msg,...]}, rooms: { roomName: [msg,...] } }
const store = {
  byClientDid: {}, // did -> { pending: [msg], ws?: ws }
  rooms: {},       // room -> [msg]
};

function saveStore() {
  try {
    fs.writeFileSync(PERSIST_FILE, JSON.stringify(store, null, 2));
    console.log('[relay] store persisted.');
  } catch (e) {
    console.error('[relay] falha ao persistir store:', e.message);
  }
}

function loadStore() {
  try {
    if (fs.existsSync(PERSIST_FILE)) {
      const raw = fs.readFileSync(PERSIST_FILE, 'utf8');
      const s = JSON.parse(raw);
      Object.assign(store, s);
      console.log('[relay] store carregado do disco.');
    }
  } catch (e) {
    console.error('[relay] falha ao carregar store:', e.message);
  }
}

loadStore();

const wss = new WebSocket.Server({ port: PORT });
console.log(`[relay] OPP relay rodando em ws://localhost:${PORT}`);

wss.on('connection', (ws, req) => {
  console.log('[relay] novo cliente conectado');

  // store did on ws when HELLO received
  ws.oppDid = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = cbor.decode(raw);
    } catch (e) {
      console.warn('[relay] mensagem inválida recebida, ignorando.');
      return;
    }

    // Logging básico por tipo
    console.log('[relay] tipo=', msg.type, 'from=', msg.from || '-', 'to=', msg.to || '-', 'room=', msg.room || '-');

    // Generic rebroadcast for messages that are not room specific or addressed
    // But we also implement store-and-forward and room semantics
    switch (msg.type) {
      case 'HELLO':
        // register client DID -> ws
        if (msg.from) {
          ws.oppDid = msg.from;
          store.byClientDid[msg.from] = store.byClientDid[msg.from] || { pending: [], ws: null };
          store.byClientDid[msg.from].ws = ws;
          console.log(`[relay] registrado DID ${msg.from}`);
          // deliver pending messages if any
          const pending = store.byClientDid[msg.from].pending || [];
          if (pending.length) {
            console.log(`[relay] entregando ${pending.length} mensagens pendentes para ${msg.from}`);
            pending.forEach(m => {
              try { ws.send(cbor.encode(m)); } catch (e) {}
            });
            store.byClientDid[msg.from].pending = [];
            saveStore();
          }
        }
        // broadcast HELLO to all others (optional)
        for (const client of wss.clients) {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            try { client.send(raw); } catch (e) {}
          }
        }
        break;

      case 'ACCEPT':
        // forward ACCEPT directly to 'to' if online; otherwise enqueue
        if (msg.to && store.byClientDid[msg.to] && store.byClientDid[msg.to].ws) {
          try { store.byClientDid[msg.to].ws.send(cbor.encode(msg)); } catch (e) {}
        } else if (msg.to) {
          store.byClientDid[msg.to] = store.byClientDid[msg.to] || { pending: [], ws: null };
          store.byClientDid[msg.to].pending.push(msg);
          saveStore();
        } else {
          // no 'to' -> broadcast
          for (const client of wss.clients) if (client.readyState === WebSocket.OPEN) try { client.send(raw); } catch {}
        }
        break;

      case 'ENC':
        // Direct encrypted message 1:1 (to field) or broadcast to a room (room field)
        if (msg.to) {
          // direct
          if (store.byClientDid[msg.to] && store.byClientDid[msg.to].ws) {
            try { store.byClientDid[msg.to].ws.send(cbor.encode(msg)); } catch (e) {}
          } else {
            // enqueue
            store.byClientDid[msg.to] = store.byClientDid[msg.to] || { pending: [], ws: null };
            store.byClientDid[msg.to].pending.push(msg);
            saveStore();
          }
        } else if (msg.room) {
          // publish to room: store and broadcast to subscribers (online clients who subscribed)
          store.rooms[msg.room] = store.rooms[msg.room] || [];
          store.rooms[msg.room].push(msg);
          saveStore();
          // broadcast to all connected clients (simple approach: everyone can subscribe client-side and filter)
          for (const client of wss.clients) {
            if (client.readyState === WebSocket.OPEN) {
              try { client.send(cbor.encode(msg)); } catch (e) {}
            }
          }
        } else {
          // fallback broadcast
          for (const client of wss.clients) {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              try { client.send(cbor.encode(msg)); } catch (e) {}
            }
          }
        }
        break;

      case 'SUBSCRIBE':
        // client asks to receive backlog for a room
        if (!msg.room) break;
        store.rooms[msg.room] = store.rooms[msg.room] || [];
        // send entire backlog to requester
        if (msg.from && store.byClientDid[msg.from] && store.byClientDid[msg.from].ws) {
          const targetWs = store.byClientDid[msg.from].ws;
          const backlog = store.rooms[msg.room];
          console.log(`[relay] enviando backlog (${backlog.length}) da sala ${msg.room} para ${msg.from}`);
          backlog.forEach(m => {
            try { targetWs.send(cbor.encode(m)); } catch (e) {}
          });
        }
        break;

      case 'ACK':
        // acknowledgement for a message ID: remove from store.byClientDid pending or store.rooms
        if (msg.mid && msg.ack_for) {
          // remove from recipient pending
          const ackTarget = msg.ack_for; // the DID who had pending
          if (store.byClientDid[ackTarget]) {
            store.byClientDid[ackTarget].pending = (store.byClientDid[ackTarget].pending || [])
              .filter(m => m.mid !== msg.mid);
            saveStore();
            console.log(`[relay] ACK processed: removed mid ${msg.mid} from pending of ${ackTarget}`);
          }
          // also remove from rooms
          if (msg.room && store.rooms[msg.room]) {
            store.rooms[msg.room] = store.rooms[msg.room].filter(m => m.mid !== msg.mid);
            saveStore();
          }
        }
        // broadcast ack to interested parties (optional)
        for (const client of wss.clients) if (client.readyState === WebSocket.OPEN) try { client.send(raw); } catch {}
        break;

      case 'TOMBSTONE':
        // tombstone: msg.target_mid or target_room - instruct removal
        if (msg.target_mid) {
          // remove from rooms and from byClient pending
          for (const r of Object.keys(store.rooms)) {
            store.rooms[r] = store.rooms[r].filter(m => m.mid !== msg.target_mid);
          }
          for (const did of Object.keys(store.byClientDid)) {
            store.byClientDid[did].pending = (store.byClientDid[did].pending || []).filter(m => m.mid !== msg.target_mid);
          }
          saveStore();
          console.log(`[relay] tombstone applied for mid ${msg.target_mid}`);
        }
        // broadcast tombstone
        for (const client of wss.clients) if (client.readyState === WebSocket.OPEN) try { client.send(raw); } catch {}
        break;

      default:
        // default: broadcast for backwards compatibility
        for (const client of wss.clients) {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            try { client.send(raw); } catch (e) {}
          }
        }
        break;
    }
  });

  ws.on('close', () => {
    console.log('[relay] cliente saiu');
    // clear ws reference from store.byClientDid if any
    if (ws.oppDid && store.byClientDid[ws.oppDid]) {
      store.byClientDid[ws.oppDid].ws = null;
    }
  });

});

process.on('SIGINT', () => {
  console.log('[relay] encerrando, salvando store...');
  saveStore();
  process.exit();
});
