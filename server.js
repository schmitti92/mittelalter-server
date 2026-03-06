const express = require('express');
const http = require('http');
const cors = require('cors');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || '*';
const MAX_PLAYERS = 4;

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN === '*' ? true : CLIENT_ORIGIN }));
app.use(express.json());

app.get('/', (_req, res) => {
  res.json({
    ok: true,
    game: 'mittelalter',
    serverTime: new Date().toISOString(),
    rooms: rooms.size,
  });
});

app.get('/health', (_req, res) => {
  res.status(200).send('ok');
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

/** @type {Map<string, Room>} */
const rooms = new Map();
/** @type {Map<WebSocket, {playerId: string|null, roomCode: string|null}>} */
const socketMeta = new Map();

function randomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i += 1) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function createRoomCode() {
  let code = randomCode();
  while (rooms.has(code)) code = randomCode();
  return code;
}

function makePlayerId() {
  return `p_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   isHost: boolean,
 *   connected: boolean,
 *   joinedAt: string,
 *   socket: WebSocket|null
 * }} Player
 */

/**
 * @typedef {{
 *   roomCode: string,
 *   status: 'waiting'|'running'|'finished',
 *   createdAt: string,
 *   hostId: string,
 *   players: Player[],
 *   gameState: {
 *     started: boolean,
 *     turnIndex: number,
 *     phase: 'lobby'|'needRoll'|'choosePiece'|'chooseTarget'|'finished'
 *   }
 * }} Room
 */

function publicRoomState(room) {
  return {
    roomCode: room.roomCode,
    status: room.status,
    createdAt: room.createdAt,
    hostId: room.hostId,
    playerCount: room.players.length,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      isHost: p.isHost,
      connected: p.connected,
      joinedAt: p.joinedAt,
    })),
    gameState: room.gameState,
  };
}

function send(ws, type, payload = {}) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type, ...payload }));
}

function broadcastRoom(room, type = 'room_state', extra = {}) {
  const payload = {
    type,
    room: publicRoomState(room),
    ...extra,
  };

  for (const player of room.players) {
    if (player.socket && player.socket.readyState === WebSocket.OPEN) {
      player.socket.send(JSON.stringify(payload));
    }
  }
}

function findPlayer(room, playerId) {
  return room.players.find((p) => p.id === playerId) || null;
}

function cleanupRoomIfEmpty(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;
  const anyConnected = room.players.some((p) => p.connected);
  if (!anyConnected) {
    rooms.delete(roomCode);
    console.log(`[ROOM] deleted empty room ${roomCode}`);
  }
}

function handleCreateRoom(ws, msg) {
  const name = String(msg.name || '').trim() || 'Spieler';
  const roomCode = createRoomCode();
  const playerId = makePlayerId();

  const room = {
    roomCode,
    status: 'waiting',
    createdAt: new Date().toISOString(),
    hostId: playerId,
    players: [
      {
        id: playerId,
        name,
        isHost: true,
        connected: true,
        joinedAt: new Date().toISOString(),
        socket: ws,
      },
    ],
    gameState: {
      started: false,
      turnIndex: 0,
      phase: 'lobby',
    },
  };

  rooms.set(roomCode, room);
  socketMeta.set(ws, { playerId, roomCode });

  send(ws, 'room_created', {
    room: publicRoomState(room),
    self: { playerId, name, isHost: true },
  });

  console.log(`[ROOM] created ${roomCode} by ${name} (${playerId})`);
}

function handleJoinRoom(ws, msg) {
  const roomCode = String(msg.roomCode || '').trim().toUpperCase();
  const name = String(msg.name || '').trim() || 'Spieler';

  if (!roomCode || !rooms.has(roomCode)) {
    send(ws, 'error_message', { message: 'Raum nicht gefunden.' });
    return;
  }

  const room = rooms.get(roomCode);
  if (room.status !== 'waiting') {
    send(ws, 'error_message', { message: 'Spiel läuft bereits.' });
    return;
  }

  if (room.players.length >= MAX_PLAYERS) {
    send(ws, 'error_message', { message: 'Raum ist voll.' });
    return;
  }

  const playerId = makePlayerId();
  room.players.push({
    id: playerId,
    name,
    isHost: false,
    connected: true,
    joinedAt: new Date().toISOString(),
    socket: ws,
  });

  socketMeta.set(ws, { playerId, roomCode });

  send(ws, 'room_joined', {
    room: publicRoomState(room),
    self: { playerId, name, isHost: false },
  });

  broadcastRoom(room, 'room_state', {
    info: `${name} ist beigetreten.`,
  });

  console.log(`[ROOM] ${name} joined ${roomCode} (${playerId})`);
}

function handleStartGame(ws, msg) {
  const meta = socketMeta.get(ws);
  if (!meta?.roomCode || !meta?.playerId) {
    send(ws, 'error_message', { message: 'Nicht mit einem Raum verbunden.' });
    return;
  }

  const room = rooms.get(meta.roomCode);
  if (!room) {
    send(ws, 'error_message', { message: 'Raum nicht gefunden.' });
    return;
  }

  const self = findPlayer(room, meta.playerId);
  if (!self?.isHost) {
    send(ws, 'error_message', { message: 'Nur der Host darf starten.' });
    return;
  }

  if (room.players.length < 2) {
    send(ws, 'error_message', { message: 'Mindestens 2 Spieler benötigt.' });
    return;
  }

  room.status = 'running';
  room.gameState.started = true;
  room.gameState.phase = 'needRoll';
  room.gameState.turnIndex = 0;

  broadcastRoom(room, 'game_started', {
    info: 'Das Spiel wurde gestartet.',
  });

  console.log(`[GAME] started in room ${room.roomCode}`);
}

function handleSyncRequest(ws) {
  const meta = socketMeta.get(ws);
  if (!meta?.roomCode) {
    send(ws, 'error_message', { message: 'Kein Raum aktiv.' });
    return;
  }
  const room = rooms.get(meta.roomCode);
  if (!room) {
    send(ws, 'error_message', { message: 'Raum nicht gefunden.' });
    return;
  }
  send(ws, 'room_state', { room: publicRoomState(room) });
}

function handleLeave(ws) {
  const meta = socketMeta.get(ws);
  if (!meta?.roomCode || !meta?.playerId) return;

  const room = rooms.get(meta.roomCode);
  if (!room) return;

  const player = findPlayer(room, meta.playerId);
  if (!player) return;

  player.connected = false;
  player.socket = null;

  if (player.isHost) {
    const nextHost = room.players.find((p) => p.id !== player.id && p.connected);
    if (nextHost) {
      nextHost.isHost = true;
      room.hostId = nextHost.id;
    }
    player.isHost = false;
  }

  broadcastRoom(room, 'room_state', {
    info: `${player.name} hat den Raum verlassen.`,
  });

  cleanupRoomIfEmpty(meta.roomCode);
  socketMeta.delete(ws);
}

wss.on('connection', (ws) => {
  socketMeta.set(ws, { playerId: null, roomCode: null });
  send(ws, 'hello', {
    ok: true,
    game: 'mittelalter',
    version: 1,
    message: 'Verbindung hergestellt.',
  });

  ws.on('message', (raw) => {
    let msg;
    try {

      if (data.type === "roll_request") {
        const value = Math.floor(Math.random()*6)+1;
        const msg = JSON.stringify({type:"roll_result",value});
        wss.clients.forEach(c=>{
          if(c.readyState===WebSocket.OPEN) c.send(msg);
        });
      }

      msg = JSON.parse(raw.toString());
    } catch (_err) {
      send(ws, 'error_message', { message: 'Ungültiges JSON.' });
      return;
    }

    const type = msg.type;
    if (!type) {
      send(ws, 'error_message', { message: 'Nachricht ohne Typ.' });
      return;
    }

    try {
      switch (type) {
        case 'create_room':
          handleCreateRoom(ws, msg);
          break;
        case 'join_room':
          handleJoinRoom(ws, msg);
          break;
        case 'start_game':
          handleStartGame(ws, msg);
          break;
        case 'sync_request':
          handleSyncRequest(ws);
          break;
        case 'leave_room':
          handleLeave(ws);
          break;
        default:
          send(ws, 'error_message', { message: `Unbekannter Typ: ${type}` });
          break;
      }
    } catch (err) {
      console.error('[WS ERROR]', err);
      send(ws, 'error_message', { message: 'Serverfehler bei der Aktion.' });
    }
  });

  ws.on('close', () => {
    handleLeave(ws);
  });

  ws.on('error', (err) => {
    console.error('[WS SOCKET ERROR]', err);
  });
});

server.listen(PORT, () => {
  console.log(`Mittelalter server listening on port ${PORT}`);
});
