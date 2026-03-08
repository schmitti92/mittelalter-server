const express = require('express');
const http = require('http');
const cors = require('cors');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || '*';
const MAX_PLAYERS = 4;
const SERVER_FORCE_EVENT_EVERY_LANDING = true;

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN === '*' ? true : CLIENT_ORIGIN }));
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const rooms = new Map();
const socketMeta = new Map();
const roomDeleteTimers = new Map();

const boardAuthority = loadBoardAuthority();

function loadBoardAuthority() {
  const candidates = [
    process.env.BOARD_JSON_PATH,
    path.join(process.cwd(), 'Mittelalter.board.json'),
    path.join(__dirname, 'Mittelalter.board.json'),
  ].filter(Boolean);

  for (const filePath of candidates) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const nodes = Array.isArray(raw.nodes) ? raw.nodes : [];
      const edges = Array.isArray(raw.edges) ? raw.edges : [];
      const nodesById = new Map(nodes.map((n) => [n.id, n]));
      const adj = new Map();
      for (const n of nodes) adj.set(n.id, []);
      for (const e of edges) {
        if (!nodesById.has(e.a) || !nodesById.has(e.b)) continue;
        if (!adj.has(e.a)) adj.set(e.a, []);
        if (!adj.has(e.b)) adj.set(e.b, []);
        adj.get(e.a).push(e.b);
        adj.get(e.b).push(e.a);
      }
      console.log(`[BOARD] authority enabled from ${filePath}`);
      return { enabled: true, filePath, nodesById, adj };
    } catch (err) {
      console.warn('[BOARD] failed to load authority board', filePath, err?.message || err);
    }
  }

  console.warn('[BOARD] authority disabled - board json not found, using legacy move validation');
  return { enabled: false, filePath: null, nodesById: new Map(), adj: new Map() };
}

function computeServerMoveTargets(snapshot, pieceId, steps) {
  if (!boardAuthority.enabled) return null;
  const pieceMap = new Map((snapshot?.pieces || []).map((p) => [p.id, p]));
  const piece = pieceMap.get(pieceId);
  if (!piece?.node) return [];

  const occupied = new Map();
  for (const p of (snapshot?.pieces || [])) {
    if (p?.node) occupied.set(p.node, p.id);
  }
  const barricades = new Set(Array.isArray(snapshot?.barricades) ? snapshot.barricades : []);
  const ignoreBarricadesThisTurn = !!snapshot?.ignoreBarricadesThisTurn;
  const start = piece.node;
  const highlighted = new Set();
  const q = [{ id: start, d: 0, from: null }];
  const visited = new Set([`${start}|0|null`]);

  while (q.length) {
    const cur = q.shift();
    if (cur.d === steps) {
      if (cur.id !== start) {
        const occ = occupied.get(cur.id);
        if (!occ) {
          highlighted.add(cur.id);
        } else {
          const op = pieceMap.get(occ);
          if (op && op.team !== piece.team && !op.shielded) {
            const nodeMeta = boardAuthority.nodesById.get(cur.id);
            if (nodeMeta?.type !== 'portal') highlighted.add(cur.id);
          }
        }
      }
      continue;
    }

    for (const nb of (boardAuthority.adj.get(cur.id) || [])) {
      if (cur.from && nb === cur.from) continue;

      if (!ignoreBarricadesThisTurn && barricades.has(nb) && (cur.d + 1) < steps) continue;

      if ((cur.d + 1) < steps) {
        const occ = occupied.get(nb);
        if (occ) {
          const op = pieceMap.get(occ);
          if (op && op.shielded) continue;
        }
      }

      const key = `${nb}|${cur.d + 1}|${cur.id}`;
      if (visited.has(key)) continue;
      visited.add(key);
      q.push({ id: nb, d: cur.d + 1, from: cur.id });
    }
  }

  return Array.from(highlighted);
}


function getStartNodesForTeam(team) {
  if (!boardAuthority.enabled) return [];
  const out = [];
  for (const node of boardAuthority.nodesById.values()) {
    if (node?.type === 'start' && Number(node?.props?.startTeam || 0) === Number(team || 0)) {
      out.push(node.id);
    }
  }
  return out;
}

function buildInitialRoomSnapshot(room) {
  if (!boardAuthority.enabled) return null;
  const players = Array.isArray(room?.players) ? room.players : [];
  const activeTeams = new Set(players.map((_p, idx) => idx + 1));
  const pieces = [];
  let seq = 0;
  for (const node of boardAuthority.nodesById.values()) {
    const team = Number(node?.props?.startTeam || 0);
    if (node?.type === 'start' && activeTeams.has(team)) {
      seq += 1;
      pieces.push({ id: `p${seq}`, team, node: node.id, prev: null, shielded: false });
    }
  }
  const barricades = [];
  const eventActive = [];
  for (const node of boardAuthority.nodesById.values()) {
    if (node?.type === 'barricade') barricades.push(node.id);
    if (node?.type === 'event') eventActive.push(node.id);
  }
  const snapshot = {
    pieces,
    barricades,
    eventActive,
    carry: { 1: 0, 2: 0, 3: 0, 4: 0 },
    goalScores: { 1: 0, 2: 0, 3: 0, 4: 0 },
    goalNodeId: null,
    bonusGoalNodeId: null,
    bonusGoalValue: 2,
    bonusLightNodeId: null,
    goalToWin: 10,
    gameOver: false,
    winnerTeam: null,
    ignoreBarricadesThisTurn: false,
    roll: 0,
    phase: 'lobby',
    turnIndex: 0,
  };
  snapshot.goalNodeId = respawnGoalNodeServer(snapshot, null);
  return snapshot;
}

function cloneSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  return JSON.parse(JSON.stringify(snapshot));
}

function applyMoveToSnapshot(snapshot, pieceId, targetId) {
  const snap = cloneSnapshot(snapshot) || {};
  const pieces = Array.isArray(snap.pieces) ? snap.pieces : [];
  const piece = pieces.find((p) => String(p?.id || '') === String(pieceId || ''));
  if (!piece || !piece.node) return snap;

  const occupant = pieces.find((p) => p && p.id !== piece.id && p.node === targetId) || null;
  if (occupant && occupant.team !== piece.team) {
    const starts = getStartNodesForTeam(occupant.team);
    const freeStart = starts.find((id) => !pieces.some((p) => p && p.id !== occupant.id && p.node === id)) || starts[0] || null;
    occupant.prev = occupant.node || null;
    occupant.node = freeStart;
    occupant.shielded = false;
  }

  piece.prev = piece.node || null;
  piece.node = targetId;
  piece.shielded = false;
  return snap;
}

function pickServerEventCard() {
  const deck = [
    { id: 'joker_pick6', title: 'Zufälliger Joker', text: 'Ein Ereignis wurde ausgelöst. Die servergesteuerten Effekte bauen wir als Nächstes komplett ein.' },
    { id: 'extra_roll_event', title: 'Nochmal würfeln', text: 'Ereigniskarte gezogen. Die volle servergesteuerte Event-Auflösung folgt im nächsten Schritt.' },
    { id: 'spawn_barricades3', title: 'Barrikaden-Verstärkung', text: 'Ereigniskarte gezogen. Die sichtbare Karte ist jetzt synchron.' },
    { id: 'spawn_one_boss', title: 'Ein Boss erscheint', text: 'Ereigniskarte gezogen. Boss-/Event-Effekte folgen serverseitig im nächsten Patch.' },
  ];
  return deck[Math.floor(Math.random() * deck.length)];
}

function isFreeGoalNodeServer(snapshot, id) {
  if (!id) return false;
  const node = boardAuthority.nodesById.get(id);
  if (!node) return false;
  if (node.type === 'start' || node.type === 'portal') return false;
  return !Array.isArray(snapshot?.pieces) || !snapshot.pieces.some((p) => p && p.node === id);
}

function respawnGoalNodeServer(snapshot, previousId = null) {
  if (!boardAuthority.enabled) return previousId || null;
  const candidates = [];
  for (const node of boardAuthority.nodesById.values()) {
    if (!node?.id) continue;
    if (!isFreeGoalNodeServer(snapshot, node.id)) continue;
    candidates.push(node.id);
  }
  if (!candidates.length) return previousId || null;
  let pick = candidates[Math.floor(Math.random() * candidates.length)];
  if (previousId && candidates.length > 1) {
    let tries = 0;
    while (pick === previousId && tries < 10) {
      pick = candidates[Math.floor(Math.random() * candidates.length)];
      tries += 1;
    }
  }
  return pick;
}

function relocateEventFieldServer(snapshot, fromId) {
  if (!boardAuthority.enabled || !snapshot || !fromId) return;
  const eventActive = new Set(Array.isArray(snapshot.eventActive) ? snapshot.eventActive : []);
  eventActive.delete(fromId);

  const occupied = new Set((snapshot.pieces || []).map((p) => p?.node).filter(Boolean));
  const candidates = [];
  for (const node of boardAuthority.nodesById.values()) {
    if (!node?.id) continue;
    if (node.type === 'start' || node.type === 'portal' || node.type === 'boss' || node.type === 'obstacle') continue;
    if (eventActive.has(node.id)) continue;
    if (occupied.has(node.id)) continue;
    candidates.push(node.id);
  }
  if (!candidates.length) {
    snapshot.eventActive = Array.from(eventActive);
    return;
  }
  const toId = candidates[Math.floor(Math.random() * candidates.length)];
  eventActive.add(toId);
  snapshot.eventActive = Array.from(eventActive);
}


function bossBlocksGoalServer(snapshot, nodeId) {
  return Array.isArray(snapshot?.bosses) && snapshot.bosses.some((b) => b && b.alive !== false && b.type === 'guardian' && b.node === nodeId);
}

function awardGoalPointsServer(snapshot, team, amount = 1) {
  const scores = Object.assign({ 1: 0, 2: 0, 3: 0, 4: 0 }, snapshot.goalScores || {});
  scores[team] = Number(scores[team] || 0) + Number(amount || 0);
  snapshot.goalScores = scores;
  const goalToWin = Number(snapshot.goalToWin || 10);
  if (scores[team] >= goalToWin) {
    snapshot.gameOver = true;
    snapshot.winnerTeam = team;
    snapshot.phase = 'gameOver';
  }
  return scores[team];
}

function resolveMoveServer(room, actor, requestId) {
  const snap = cloneSnapshot(room?.gameState?.snapshot);
  const move = room?.gameState?.lastMove || null;
  if (!snap || !move) return;
  const currentTurnIndex = clampTurnIndex(room, room.gameState?.turnIndex ?? 0);
  const movedPiece = Array.isArray(snap.pieces) ? snap.pieces.find((p) => String(p?.id || '') === String(move.pieceId || '')) : null;

  let info = `${actor?.name || 'Spieler'} hat gezogen.`;
  let eventCard = null;

  if (movedPiece && movedPiece.node) {
    const landedNodeId = movedPiece.node;
    const barricades = new Set(Array.isArray(snap.barricades) ? snap.barricades : []);
    const blockedByBarricade = barricades.has(landedNodeId);
    const blockedByGuardian = bossBlocksGoalServer(snap, landedNodeId);
    const team = Number(movedPiece.team || (currentTurnIndex + 1));

    if (!blockedByBarricade && !blockedByGuardian) {
      if (snap.bonusLightNodeId && landedNodeId === snap.bonusLightNodeId) {
        const score = awardGoalPointsServer(snap, team, 1);
        snap.bonusLightNodeId = null;
        info = `✨ Team ${team} sammelt das Lichtfeld! Stand: ${score}/${snap.goalToWin || 10}`;
      } else if (snap.bonusGoalNodeId && landedNodeId === snap.bonusGoalNodeId) {
        const value = Number(snap.bonusGoalValue || 2);
        const score = awardGoalPointsServer(snap, team, value);
        snap.bonusGoalNodeId = null;
        info = `🌟 Team ${team} sammelt das Doppel-Zielfeld! +${value}. Stand: ${score}/${snap.goalToWin || 10}`;
      } else if (snap.goalNodeId && landedNodeId === snap.goalNodeId) {
        const score = awardGoalPointsServer(snap, team, 1);
        snap.goalNodeId = respawnGoalNodeServer(snap, landedNodeId);
        info = `🎯 Team ${team} sammelt einen Zielpunkt! Stand: ${score}/${snap.goalToWin || 10}`;
      }
    }

    const eventActive = new Set(Array.isArray(snap.eventActive) ? snap.eventActive : []);
    const eventTriggered = !snap.gameOver && (SERVER_FORCE_EVENT_EVERY_LANDING || eventActive.has(landedNodeId));
    if (eventTriggered) {
      eventCard = pickServerEventCard();
      if (eventActive.has(landedNodeId)) {
        relocateEventFieldServer(snap, landedNodeId);
      }
    }
  }

  if (snap.gameOver) {
    snap.turnIndex = currentTurnIndex;
    snap.roll = 0;
    room.gameState.snapshot = snap;
    room.gameState.phase = 'gameOver';
    room.gameState.turnIndex = currentTurnIndex;
    room.gameState.lastMove = null;
    room.gameState.lastRoll = null;
    room.gameState.lastRollAt = null;
    room.gameState.lastRollBy = null;
    room.gameState.lastRollMeta = null;
    broadcastRoom(room, 'game_turn_state', {
      room: publicRoomState(room),
      gameState: room.gameState,
      requestId,
      info: `🏆 Team ${snap.winnerTeam || (currentTurnIndex + 1)} gewinnt!`,
    });
    return;
  }

  const sameTeamAgain = Number(room.gameState?.lastRoll || 0) === 6;
  const nextTurnIndex = sameTeamAgain ? currentTurnIndex : ((currentTurnIndex + 1) % room.players.length);
  snap.turnIndex = nextTurnIndex;
  snap.phase = 'needRoll';
  snap.roll = 0;
  room.gameState.snapshot = snap;
  room.gameState.turnIndex = nextTurnIndex;
  room.gameState.phase = 'needRoll';
  room.gameState.lastMove = null;
  room.gameState.lastRoll = null;
  room.gameState.lastRollAt = null;
  room.gameState.lastRollBy = null;
  room.gameState.lastRollMeta = null;

  if (eventCard) {
    broadcastRoom(room, 'event_card', {
      room: publicRoomState(room),
      requestId,
      card: eventCard,
      info: `${actor?.name || 'Spieler'} hat eine Ereigniskarte gezogen.`,
    });
  }

  const nextTeam = nextTurnIndex + 1;
  const turnInfo = sameTeamAgain
    ? `Team ${nextTeam} hat eine 6 gewürfelt und ist nochmal dran.`
    : `Team ${nextTeam} ist dran: Würfeln.`;

  broadcastRoom(room, 'game_turn_state', {
    room: publicRoomState(room),
    gameState: room.gameState,
    requestId,
    info: info !== `${actor?.name || 'Spieler'} hat gezogen.` ? `${info} ${turnInfo}` : turnInfo,
  });
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

function sendTrace(ws, stage, data = {}) {
  send(ws, 'trace_event', {
    stage: String(stage || 'trace'),
    at: new Date().toISOString(),
    ...data,
  });
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
      snapshot: null,
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
  room.gameState.snapshot = buildInitialRoomSnapshot(room);
  if (room.gameState.snapshot) {
    room.gameState.snapshot.phase = 'needRoll';
    room.gameState.snapshot.turnIndex = 0;
    room.gameState.snapshot.roll = 0;
  }

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
  const requestId = String(msg.requestId || '').trim() || null;
  const currentTurnIndex = clampTurnIndex(room, room.gameState?.turnIndex ?? 0);
  const currentPlayer = room.players[currentTurnIndex] || null;

  if (action) {
    send(ws, 'action_ack', {
      action,
      requestId,
      roomCode: room.roomCode,
      phase: room.gameState?.phase || null,
      turnIndex: currentTurnIndex,
      at: new Date().toISOString(),
    });
  }

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
    if (room.gameState.snapshot) {
      room.gameState.snapshot.turnIndex = currentTurnIndex;
      room.gameState.snapshot.phase = 'choosePiece';
      room.gameState.snapshot.roll = value;
    }
    room.gameState.lastRoll = value;
    room.gameState.lastRollAt = roll.at;
    room.gameState.lastRollBy = self.id;
    room.gameState.lastRollMeta = roll;

    broadcastRoom(room, 'game_roll', {
      room: publicRoomState(room),
      roll,
      requestId,
      info: `${self.name} würfelt ${value}.`,
    });
    return;
  }

  if (action === 'move_request') {
    sendTrace(ws, 'move_request.received', {
      requestId,
      roomCode: room.roomCode,
      phase: room.gameState?.phase || null,
      turnIndex: currentTurnIndex,
      byPlayerId: self.id,
      byName: self.name,
    });

    if (room.status !== 'running' || !room.gameState?.started) {
      sendTrace(ws, 'move_request.reject', { requestId, reason: 'game_not_running' });
      send(ws, 'error_message', { message: 'Spiel läuft noch nicht.' });
      return;
    }
    if (!currentPlayer || currentPlayer.id !== self.id) {
      sendTrace(ws, 'move_request.reject', { requestId, reason: 'not_players_turn', currentPlayerId: currentPlayer?.id || null });
      send(ws, 'error_message', { message: 'Du bist gerade nicht am Zug.' });
      return;
    }
    if (!['choosePiece', 'chooseTarget'].includes(sanitizePhase(room.gameState?.phase))) {
      sendTrace(ws, 'move_request.reject', { requestId, reason: 'phase_not_movable', phase: room.gameState?.phase || null });
      send(ws, 'error_message', { message: 'Gerade darf keine Figur bewegt werden.' });
      return;
    }

    const pieceId = String(msg.pieceId || '').trim();
    const targetId = String(msg.targetId || '').trim();
    const legacyLegalTargets = Array.isArray(msg.legalTargets) ? msg.legalTargets.map((x) => String(x || '').trim()).filter(Boolean) : [];
    const snapshot = msg.stateSnapshot && typeof msg.stateSnapshot === 'object' ? msg.stateSnapshot : null;
    const turnTeam = currentTurnIndex + 1;

    sendTrace(ws, 'move_request.payload', {
      requestId,
      pieceId,
      targetId,
      legacyTargetCount: legacyLegalTargets.length,
      hasSnapshot: !!snapshot,
      serverPhase: room.gameState?.phase || null,
      serverLastRoll: Number(room.gameState?.lastRoll || 0),
    });

    if (!pieceId || !targetId) {
      sendTrace(ws, 'move_request.reject', { requestId, reason: 'invalid_move_payload', pieceId, targetId });
      send(ws, 'error_message', { message: 'Ungültige Bewegungsdaten.' });
      return;
    }

    let legalTargets = legacyLegalTargets;
    if (snapshot) {
      const piece = Array.isArray(snapshot.pieces) ? snapshot.pieces.find((p) => String(p?.id || '') === pieceId) : null;
      sendTrace(ws, 'move_request.snapshot_info', {
        requestId,
        snapshotPhase: snapshot?.phase || null,
        snapshotRoll: Number(snapshot?.roll || 0),
        snapshotTurnIndex: Number(snapshot?.turnIndex || 0),
        pieceFound: !!piece,
        pieceTeam: Number(piece?.team || 0),
        pieceNode: piece?.node || null,
      });
      if (!piece) {
        sendTrace(ws, 'move_request.reject', { requestId, reason: 'piece_not_found_in_snapshot', pieceId });
        send(ws, 'error_message', { message: 'Figur nicht gefunden.' });
        return;
      }
      if (Number(piece.team || 0) !== turnTeam) {
        sendTrace(ws, 'move_request.reject', { requestId, reason: 'piece_team_mismatch', turnTeam, pieceTeam: Number(piece.team || 0) });
        send(ws, 'error_message', { message: 'Du darfst nur deine eigene Figur bewegen.' });
        return;
      }
      const roll = Number(snapshot.roll || room.gameState?.lastRoll || 0);
      if (roll !== Number(room.gameState?.lastRoll || 0)) {
        sendTrace(ws, 'move_request.reject', { requestId, reason: 'roll_mismatch', snapshotRoll: roll, serverRoll: Number(room.gameState?.lastRoll || 0) });
        send(ws, 'error_message', { message: 'Wurf passt nicht zum Serverstand.' });
        return;
      }

      const computed = computeServerMoveTargets(snapshot, pieceId, roll);
      if (Array.isArray(computed)) legalTargets = computed;
      sendTrace(ws, 'move_request.computed_targets', {
        requestId,
        computedCount: Array.isArray(legalTargets) ? legalTargets.length : -1,
        targetId,
        containsTarget: Array.isArray(legalTargets) ? legalTargets.includes(targetId) : false,
        sample: Array.isArray(legalTargets) ? legalTargets.slice(0, 12) : [],
        boardValidated: !!boardAuthority.enabled,
      });
    } else {
      sendTrace(ws, 'move_request.no_snapshot', {
        requestId,
        legacyTargetCount: legacyLegalTargets.length,
        boardValidated: !!boardAuthority.enabled,
      });
    }

    if (!Array.isArray(legalTargets) || !legalTargets.includes(targetId)) {
      sendTrace(ws, 'move_request.reject', {
        requestId,
        reason: 'target_not_allowed',
        targetId,
        legalTargetCount: Array.isArray(legalTargets) ? legalTargets.length : -1,
        sample: Array.isArray(legalTargets) ? legalTargets.slice(0, 12) : [],
      });
      send(ws, 'error_message', { message: boardAuthority.enabled ? 'Zielfeld laut Server nicht erlaubt.' : 'Zielfeld nicht erlaubt.' });
      return;
    }

    const baseSnapshot = snapshot || room.gameState?.snapshot || null;
    const nextSnapshot = applyMoveToSnapshot(baseSnapshot, pieceId, targetId);
    if (nextSnapshot) {
      nextSnapshot.turnIndex = currentTurnIndex;
      nextSnapshot.phase = 'resolveMove';
      nextSnapshot.roll = Number(room.gameState?.lastRoll || 0);
      room.gameState.snapshot = nextSnapshot;
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
      boardValidated: !!boardAuthority.enabled,
      at: new Date().toISOString(),
      snapshot: cloneSnapshot(room.gameState.snapshot),
    };

    sendTrace(ws, 'move_request.broadcast', {
      requestId,
      pieceId,
      targetId,
      roll: Number(room.gameState?.lastRoll || 0),
      phaseAfter: room.gameState.phase,
      snapshotPieces: Array.isArray(room.gameState?.snapshot?.pieces) ? room.gameState.snapshot.pieces.length : 0,
    });

    broadcastRoom(room, 'game_move', {
      room: publicRoomState(room),
      move: room.gameState.lastMove,
      snapshot: cloneSnapshot(room.gameState.snapshot),
      requestId,
      info: `${self.name} bewegt eine Figur.`,
    });
    resolveMoveServer(room, self, requestId);
    return;
  }


  if (action === 'finish_move') {
    const moveActorId = room.gameState?.lastMove?.byPlayerId || null;
    if (!moveActorId || moveActorId !== self.id) {
      send(ws, 'error_message', { message: 'Nur der Spieler der die Figur bewegt hat darf den Zug beenden.' });
      return;
    }

    const nextTurnIndex = clampTurnIndex(room, msg.turnIndex);
    const nextPhase = sanitizePhase(msg.phase);
    const snapshot = msg.stateSnapshot && typeof msg.stateSnapshot === 'object' ? cloneSnapshot(msg.stateSnapshot) : null;
    if (snapshot) room.gameState.snapshot = snapshot;

    room.gameState.turnIndex = nextTurnIndex;
    room.gameState.phase = nextPhase;
    room.gameState.lastMove = null;
    if (room.gameState.snapshot) {
      room.gameState.snapshot.turnIndex = nextTurnIndex;
      room.gameState.snapshot.phase = nextPhase;
      if (nextPhase === 'needRoll') room.gameState.snapshot.roll = 0;
    }

    if (nextPhase === 'needRoll') {
      room.gameState.lastRoll = null;
      room.gameState.lastRollAt = null;
      room.gameState.lastRollBy = null;
      room.gameState.lastRollMeta = null;
    }

    broadcastRoom(room, 'game_turn_state', {
      room: publicRoomState(room),
      gameState: room.gameState,
      requestId,
      info: typeof msg.info === 'string' && msg.info.trim() ? msg.info.trim() : null,
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
    const snapshot = msg.stateSnapshot && typeof msg.stateSnapshot === 'object' ? cloneSnapshot(msg.stateSnapshot) : null;
    if (snapshot) room.gameState.snapshot = snapshot;

    room.gameState.turnIndex = nextTurnIndex;
    room.gameState.phase = nextPhase;
    room.gameState.lastMove = null;
    if (room.gameState.snapshot) {
      room.gameState.snapshot.turnIndex = nextTurnIndex;
      room.gameState.snapshot.phase = nextPhase;
      if (nextPhase === 'needRoll') room.gameState.snapshot.roll = 0;
    }

    if (nextPhase === 'needRoll') {
      room.gameState.lastRoll = null;
      room.gameState.lastRollAt = null;
      room.gameState.lastRollBy = null;
      room.gameState.lastRollMeta = null;
    }

    broadcastRoom(room, 'game_turn_state', {
      room: publicRoomState(room),
      gameState: room.gameState,
      requestId,
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
