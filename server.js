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

const rooms = new Map();
const socketMeta = new Map();
const roomDeleteTimers = new Map();

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

function clampTurnIndex(room, idx) {
  const max = Math.max(0, room.players.length - 1);
  const n = Number(idx);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(max, Math.trunc(n)));
}

function sanitizePhase(phase) {
  const allowed = new Set(['lobby', 'needRoll', 'choosePiece', 'chooseTarget', 'placeBarricade', 'usePortal', 'bossPhase', 'gameOver', 'resolveMove']);
  const p = String(phase || '').trim();
  return allowed.has(p) ? p : 'needRoll';
}

function randomDie() {
  return Math.floor(Math.random() * 6) + 1;
}

function send(ws, type, payload = {}) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type, ...payload }));
}

function broadcastRoom(room, type = 'room_state', extra = {}) {
  const payload = JSON.stringify({ type, room: publicRoomState(room), ...extra });
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
  if (anyConnected) {
    const oldTimer = roomDeleteTimers.get(roomCode);
    if (oldTimer) {
      clearTimeout(oldTimer);
      roomDeleteTimers.delete(roomCode);
    }
    return;
  }

  if (roomDeleteTimers.has(roomCode)) return;

  const timer = setTimeout(() => {
    const latest = rooms.get(roomCode);
    if (!latest) return;
    const stillEmpty = latest.players.every((p) => !p.connected);
    if (stillEmpty) {
      rooms.delete(roomCode);
      console.log(`[ROOM] deleted empty room ${roomCode} after grace period`);
    }
    roomDeleteTimers.delete(roomCode);
  }, 15 * 60 * 1000);

  roomDeleteTimers.set(roomCode, timer);
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

  console.log(`[ROOM] created ${roomCode} by ${name} (${playerId})`);
}

function handleJoinRoom(ws, msg) {
  const roomCode = String(msg.roomCode || '').trim().toUpperCase();
  const name = String(msg.name || '').trim() || 'Spieler';
  const requestedPlayerId = String(msg.playerId || '').trim();

  if (!roomCode || !rooms.has(roomCode)) {
    send(ws, 'error_message', { message: 'Raum nicht gefunden.' });
    return;
  }

  const room = rooms.get(roomCode);

  // Reconnect / Seitenwechsel erlauben: gleicher Spieler darf auch in laufendes Spiel zurück.
  let existing = null;
  if (requestedPlayerId) {
    existing = room.players.find((p) => p.id === requestedPlayerId) || null;
  }
  if (!existing && room.status === 'running') {
    existing = room.players.find((p) => p.name === name) || null;
  }

  if (existing) {
    existing.connected = true;
    existing.socket = ws;
    socketMeta.set(ws, { playerId: existing.id, roomCode });

    send(ws, 'room_joined', {
      room: publicRoomState(room),
      self: { playerId: existing.id, name: existing.name, isHost: !!existing.isHost },
      reconnect: true,
    });

    broadcastRoom(room, 'room_state', { info: `${existing.name} ist wieder verbunden.` });
    console.log(`[ROOM] ${existing.name} reconnected ${roomCode} (${existing.id})`);
    return;
  }

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
  room.gameState.lastRoll = null;
  room.gameState.lastRollAt = null;
  room.gameState.lastRollBy = null;

  broadcastRoom(room, 'game_started', { info: 'Das Spiel wurde gestartet.' });
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


function handleServerAction(ws, msg) {
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
  if (!self) {
    send(ws, 'error_message', { message: 'Spieler nicht gefunden.' });
    return;
  }

  const action = String(msg.action || msg.kind || '').trim();
  const currentTurnIndex = clampTurnIndex(room, room.gameState?.turnIndex ?? 0);
  const currentPlayer = room.players[currentTurnIndex] || null;

  if (action === 'roll_request') {
    if (room.status !== 'running' || !room.gameState?.started) {
      send(ws, 'error_message', { message: 'Spiel läuft noch nicht.' });
      return;
    }
    if (!currentPlayer || currentPlayer.id !== self.id) {
      send(ws, 'error_message', { message: 'Du bist gerade nicht am Zug.' });
      return;
    }
    if (sanitizePhase(room.gameState?.phase) !== 'needRoll') {
      send(ws, 'error_message', { message: 'Gerade darf nicht gewürfelt werden.' });
      return;
    }

    const a = randomDie();
    const wantsDouble = !!msg.double;
    const b = wantsDouble ? randomDie() : null;
    const value = wantsDouble ? (a + b) : a;
    const roll = {
      value,
      parts: wantsDouble ? [a, b] : [a],
      double: wantsDouble,
      byPlayerId: self.id,
      byName: self.name,
      turnIndex: currentTurnIndex,
      team: currentTurnIndex + 1,
      reason: String(msg.reason || 'main'),
      at: new Date().toISOString(),
    };

    room.gameState.turnIndex = currentTurnIndex;
    room.gameState.phase = 'choosePiece';
    room.gameState.lastRoll = value;
    room.gameState.lastRollAt = roll.at;
    room.gameState.lastRollBy = self.id;
    room.gameState.lastRollMeta = roll;

    broadcastRoom(room, 'game_roll', {
      room: publicRoomState(room),
      roll,
      info: `${self.name} würfelt ${value}.`,
    });
    return;
  }

  if (action === 'move_request') {
    if (room.status !== 'running' || !room.gameState?.started) {
      send(ws, 'error_message', { message: 'Spiel läuft noch nicht.' });
      return;
    }
    if (!currentPlayer || currentPlayer.id !== self.id) {
      send(ws, 'error_message', { message: 'Du bist gerade nicht am Zug.' });
      return;
    }
    if (!['choosePiece', 'chooseTarget'].includes(sanitizePhase(room.gameState?.phase))) {
      send(ws, 'error_message', { message: 'Gerade darf keine Figur bewegt werden.' });
      return;
    }

    const pieceId = String(msg.pieceId || '').trim();
    const targetId = String(msg.targetId || '').trim();
    const legalTargets = Array.isArray(msg.legalTargets) ? msg.legalTargets.map((x) => String(x || '').trim()).filter(Boolean) : [];

    if (!pieceId || !targetId) {
      send(ws, 'error_message', { message: 'Ungültige Bewegungsdaten.' });
      return;
    }
    if (!legalTargets.includes(targetId)) {
      send(ws, 'error_message', { message: 'Zielfeld nicht erlaubt.' });
      return;
    }

    room.gameState.phase = 'resolveMove';
    room.gameState.lastMove = {
      pieceId,
      targetId,
      byPlayerId: self.id,
      byName: self.name,
      turnIndex: currentTurnIndex,
      roll: Number(room.gameState?.lastRoll || 0),
      legalTargets,
      at: new Date().toISOString(),
    };

    broadcastRoom(room, 'game_move', {
      room: publicRoomState(room),
      move: room.gameState.lastMove,
      info: `${self.name} bewegt eine Figur.`,
    });
    return;
  }

  if (action === 'turn_update') {
    if (!currentPlayer || currentPlayer.id !== self.id) {
      send(ws, 'error_message', { message: 'Nur der aktuelle Spieler darf den Zugstatus ändern.' });
      return;
    }

    const nextTurnIndex = clampTurnIndex(room, msg.turnIndex);
    const nextPhase = sanitizePhase(msg.phase);

    room.gameState.turnIndex = nextTurnIndex;
    room.gameState.phase = nextPhase;
    room.gameState.lastMove = null;

    if (nextPhase === 'needRoll') {
      room.gameState.lastRoll = null;
      room.gameState.lastRollAt = null;
      room.gameState.lastRollBy = null;
      room.gameState.lastRollMeta = null;
    }

    broadcastRoom(room, 'game_turn_state', {
      room: publicRoomState(room),
      gameState: room.gameState,
      info: typeof msg.info === 'string' && msg.info.trim() ? msg.info.trim() : null,
    });
    return;
  }

  send(ws, 'noop', { ignored: true, reason: 'unknown_server_action', action: action || null });
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

  broadcastRoom(room, 'room_state', { info: `${player.name} hat den Raum verlassen.` });
  cleanupRoomIfEmpty(meta.roomCode);
  socketMeta.delete(ws);
}

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
          handleStartGame(ws);
          break;
        case 'sync_request':
          handleSyncRequest(ws);
          break;
        case 'leave_room':
          handleLeave(ws);
          break;
        case 'ping':
          send(ws, 'pong', { ts: Date.now() });
          break;
        case 'server_action':
          handleServerAction(ws, msg);
          break;
        default:
          // keine harte Fehlermeldung für unbekannte alte Nachrichten, damit Legacy-Clients nicht spammen
          send(ws, 'noop', { ignored: true, reason: 'unknown_type', typeReceived: type });
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
