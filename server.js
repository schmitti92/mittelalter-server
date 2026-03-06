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

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

/** @type {Map<string, Room>} */
const rooms = new Map();
/** @type {Map<WebSocket, {playerId: string|null, roomCode: string|null}>} */
const socketMeta = new Map();

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

function randomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i += 1) code += chars[Math.floor(Math.random() * chars.length)];
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
  const payload = JSON.stringify({
    type,
    room: publicRoomState(room),
    ...extra,
  });

  for (const player of room.players) {
    if (player.socket && player.socket.readyState === WebSocket.OPEN) {
      player.socket.send(payload);
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

function ensureSocketNotInOtherRoom(ws) {
  const meta = socketMeta.get(ws);
  if (!meta?.roomCode) return;
  handleLeave(ws);
}

function handleCreateRoom(ws, msg) {
  ensureSocketNotInOtherRoom(ws);

  const name = String(msg.name || '').trim() || 'Spieler';
  const roomCode = createRoomCode();
  const playerId = makePlayerId();

  /** @type {Room} */
  const room = {
    roomCode,
    status: 'waiting',
    createdAt: new Date().toISOString(),
    hostId: playerId,
    players: [{
      id: playerId,
      name,
      isHost: true,
      connected: true,
      joinedAt: new Date().toISOString(),
      socket: ws,
    }],
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

  broadcastRoom(room, 'room_state', { info: `${name} hat den Raum erstellt.` });
  console.log(`[ROOM] created ${roomCode} by ${name} (${playerId})`);
}

function handleJoinRoom(ws, msg) {
  ensureSocketNotInOtherRoom(ws);

  const roomCode = String(msg.roomCode || msg.room || '').trim().toUpperCase();
  const name = String(msg.name || msg.player || '').trim() || 'Spieler';

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

  broadcastRoom(room, 'room_state', { info: `${name} ist beigetreten.` });
  console.log(`[ROOM] ${name} joined ${roomCode} (${playerId})`);
}

function handleStartGame(ws) {
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

  broadcastRoom(room, 'game_started', { info: 'Das Spiel wurde gestartet.' });
  console.log(`[GAME] started in room ${room.roomCode}`);
}

function attachSocketToRoom(ws, roomCode, name, wantHost = false) {
  const normalizedRoomCode = String(roomCode || '').trim().toUpperCase();
  const normalizedName = String(name || '').trim() || 'Spieler';

  if (!normalizedRoomCode || !rooms.has(normalizedRoomCode)) {
    send(ws, 'error_message', { message: 'Raum nicht gefunden.' });
    return null;
  }

  const room = rooms.get(normalizedRoomCode);

  let player = room.players.find((p) => p.name === normalizedName);
  if (!player && wantHost) {
    player = room.players.find((p) => p.isHost);
  }

  if (!player && room.status === 'waiting' && room.players.length < MAX_PLAYERS) {
    const playerId = makePlayerId();
    player = {
      id: playerId,
      name: normalizedName,
      isHost: false,
      connected: true,
      joinedAt: new Date().toISOString(),
      socket: ws,
    };
    room.players.push(player);
  }

  if (!player) {
    send(ws, 'error_message', { message: 'Spieler im Raum nicht gefunden.' });
    return null;
  }

  player.connected = true;
  player.socket = ws;

  if (wantHost && room.hostId === player.id) {
    player.isHost = true;
  }

  socketMeta.set(ws, { playerId: player.id, roomCode: room.roomCode });
  return room;
}

function handleSyncRequest(ws, msg = {}) {
  let meta = socketMeta.get(ws);
  let room = null;

  if (!meta?.roomCode && msg.roomCode) {
    room = attachSocketToRoom(ws, msg.roomCode, msg.name, !!msg.isHost);
    if (!room) return;
    meta = socketMeta.get(ws);
    broadcastRoom(room, 'room_state', { info: `${String(msg.name || 'Spieler')} ist verbunden.` });
  } else {
    if (!meta?.roomCode) {
      send(ws, 'error_message', { message: 'Kein Raum aktiv.' });
      return;
    }
    room = rooms.get(meta.roomCode);
    if (!room) {
      send(ws, 'error_message', { message: 'Raum nicht gefunden.' });
      return;
    }
  }

  send(ws, 'room_state', { room: publicRoomState(room) });
}

function handleRollRequest(ws) {
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

  const value = Math.floor(Math.random() * 6) + 1;
  broadcastRoom(room, 'roll_result', { value });
  console.log(`[ROLL] room=${room.roomCode} value=${value}`);
}

function handleLeave(ws) {
  const meta = socketMeta.get(ws);
  if (!meta?.roomCode || !meta?.playerId) return;

  const room = rooms.get(meta.roomCode);
  if (!room) {
    socketMeta.set(ws, { playerId: null, roomCode: null });
    return;
  }

  const player = findPlayer(room, meta.playerId);
  if (!player) {
    socketMeta.set(ws, { playerId: null, roomCode: null });
    return;
  }

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

  broadcastRoom(room, 'room_state', { info: `${player.name} hat den Raum verlassen.` });
  socketMeta.set(ws, { playerId: null, roomCode: null });
  cleanupRoomIfEmpty(meta.roomCode);
}

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

wss.on('connection', (ws) => {
  socketMeta.set(ws, { playerId: null, roomCode: null });
  send(ws, 'hello', {
    ok: true,
    game: 'mittelalter',
    version: 2,
    message: 'Verbindung hergestellt.',
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
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
          handleStartGame(ws);
          break;
        case 'sync_request':
          handleSyncRequest(ws, msg);
          break;
        case 'roll_request':
          handleRollRequest(ws);
          break;
        case 'leave_room':
          handleLeave(ws);
          break;
        default:
          send(ws, 'error_message', { message: `Unbekannter Typ: ${type}` });
      }
    } catch (err) {
      console.error('[WS] handler error', err);
      send(ws, 'error_message', { message: 'Serverfehler bei der Verarbeitung.' });
    }
  });

  ws.on('close', () => {
    handleLeave(ws);
    socketMeta.delete(ws);
  });

  ws.on('error', () => {
    handleLeave(ws);
    socketMeta.delete(ws);
  });
});

server.listen(PORT, () => {
  console.log(`Mittelalter server listening on port ${PORT}`);
});
