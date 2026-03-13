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
    bosses: [],
    bossIdSeq: 1,
    roll: 0,
    phase: 'lobby',
    turnIndex: 0,
    bossTick: 0,
    bossRoundNum: 0,
    jokers: { 1: baseJokerLoadoutServer(), 2: baseJokerLoadoutServer(), 3: baseJokerLoadoutServer(), 4: baseJokerLoadoutServer() },
    jokerFlags: { double: false, allcolors: false },
  };
  snapshot.goalNodeId = respawnGoalNodeServer(snapshot, null);
  ensureJokerStateServer(snapshot);
  return snapshot;
}

function cloneSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  return JSON.parse(JSON.stringify(snapshot));
}

function applyMoveToSnapshot(snapshot, pieceId, targetId) {
  const snap = cloneSnapshot(snapshot) || {};
  ensureJokerStateServer(snap);
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


function randomFrom(list) {
  return Array.isArray(list) && list.length ? list[Math.floor(Math.random() * list.length)] : null;
}

const SERVER_JOKER_MAX_PER_TYPE = 3;
const SERVER_JOKER_IDS = ['double', 'moveBarricade', 'swap', 'reroll', 'shield', 'allcolors'];

function baseJokerLoadoutServer() {
  const inv = {};
  for (const id of SERVER_JOKER_IDS) inv[id] = 1;
  return inv;
}

function ensureJokerStateServer(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return;
  if (!snapshot.jokers || typeof snapshot.jokers !== 'object') snapshot.jokers = {};
  for (let t = 1; t <= 4; t += 1) {
    const cur = snapshot.jokers[t] && typeof snapshot.jokers[t] === 'object' ? snapshot.jokers[t] : {};
    const next = baseJokerLoadoutServer();
    for (const id of SERVER_JOKER_IDS) {
      if (typeof cur[id] === 'number') next[id] = Math.max(0, Math.min(SERVER_JOKER_MAX_PER_TYPE, Math.trunc(cur[id])));
    }
    snapshot.jokers[t] = next;
  }
  if (!snapshot.jokerFlags || typeof snapshot.jokerFlags !== 'object') snapshot.jokerFlags = {};
  if (typeof snapshot.jokerFlags.double !== 'boolean') snapshot.jokerFlags.double = false;
  if (typeof snapshot.jokerFlags.allcolors !== 'boolean') snapshot.jokerFlags.allcolors = false;
}

function jokerCountServer(snapshot, team, jokerId) {
  ensureJokerStateServer(snapshot);
  return Number(snapshot?.jokers?.[team]?.[jokerId] || 0);
}

function consumeJokerServer(snapshot, team, jokerId) {
  ensureJokerStateServer(snapshot);
  if (jokerCountServer(snapshot, team, jokerId) <= 0) return false;
  snapshot.jokers[team][jokerId] = Math.max(0, jokerCountServer(snapshot, team, jokerId) - 1);
  return true;
}

function normalizeTurnSnapshotServer(room, snapshot, turnIndex, phase) {
  if (!snapshot) return;
  ensureJokerStateServer(snapshot);
  snapshot.turnIndex = clampTurnIndex(room, turnIndex);
  snapshot.phase = sanitizePhase(phase || snapshot.phase || room?.gameState?.phase || 'needRoll');
}

function isOccupiedNodeServer(snapshot, nodeId) {
  return Array.isArray(snapshot?.pieces) && snapshot.pieces.some((p) => p && p.node === nodeId);
}

function isBossNodeServer(snapshot, nodeId) {
  return Array.isArray(snapshot?.bosses) && snapshot.bosses.some((b) => b && b.alive !== false && b.node === nodeId);
}

function isFreeBarricadeNodeServer(snapshot, nodeId) {
  if (!nodeId) return false;
  const node = boardAuthority.nodesById.get(nodeId);
  if (!node) return false;
  if (node.type === 'start' || node.type === 'portal' || node.type === 'boss' || node.type === 'obstacle') return false;
  if (Array.isArray(snapshot?.barricades) && snapshot.barricades.includes(nodeId)) return false;
  if (isOccupiedNodeServer(snapshot, nodeId)) return false;
  if (isBossNodeServer(snapshot, nodeId)) return false;
  return true;
}

function spawnExtraBarricadesServer(snapshot, count = 3) {
  if (!boardAuthority.enabled || !snapshot) return 0;
  const candidates = [];
  for (const node of boardAuthority.nodesById.values()) {
    if (isFreeBarricadeNodeServer(snapshot, node.id)) candidates.push(node.id);
  }
  let placed = 0;
  while (candidates.length && placed < count) {
    const idx = Math.floor(Math.random() * candidates.length);
    const [pick] = candidates.splice(idx, 1);
    snapshot.barricades.push(pick);
    placed += 1;
  }
  return placed;
}

function spawnBonusGoalServer(snapshot) {
  if (!boardAuthority.enabled || !snapshot) return null;
  const candidates = [];
  for (const node of boardAuthority.nodesById.values()) {
    if (!node?.id) continue;
    if (node.type === 'start' || node.type === 'portal' || node.type === 'boss' || node.type === 'obstacle') continue;
    if (node.id === snapshot.goalNodeId || node.id === snapshot.bonusGoalNodeId || node.id === snapshot.bonusLightNodeId) continue;
    if (isOccupiedNodeServer(snapshot, node.id) || isBossNodeServer(snapshot, node.id)) continue;
    candidates.push(node.id);
  }
  const pick = randomFrom(candidates);
  if (pick) snapshot.bonusGoalNodeId = pick;
  return pick;
}

function spawnBonusLightServer(snapshot) {
  if (!boardAuthority.enabled || !snapshot) return null;
  const candidates = [];
  for (const node of boardAuthority.nodesById.values()) {
    if (!node?.id) continue;
    if (node.type === 'start' || node.type === 'portal' || node.type === 'boss' || node.type === 'obstacle') continue;
    if (node.id === snapshot.goalNodeId || node.id === snapshot.bonusGoalNodeId || node.id === snapshot.bonusLightNodeId) continue;
    if (isOccupiedNodeServer(snapshot, node.id) || isBossNodeServer(snapshot, node.id)) continue;
    candidates.push(node.id);
  }
  const pick = randomFrom(candidates);
  if (pick) snapshot.bonusLightNodeId = pick;
  return pick;
}

function sendAllPlayersToStartServer(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.pieces)) return 0;
  const usedStarts = new Set();
  let moved = 0;
  for (const piece of snapshot.pieces) {
    const starts = getStartNodesForTeam(piece.team);
    const target = starts.find((id) => !usedStarts.has(id)) || starts[0] || null;
    if (piece.node !== target) moved += 1;
    piece.prev = piece.node || null;
    piece.node = target;
    piece.shielded = false;
    if (target) usedStarts.add(target);
  }
  return moved;
}

function ensureBossStateServer(snapshot) {
  if (!Array.isArray(snapshot.bosses)) snapshot.bosses = [];
  if (typeof snapshot.bossIdSeq !== 'number') snapshot.bossIdSeq = 1;
}

function spawnRandomBossServer(snapshot) {
  if (!boardAuthority.enabled || !snapshot) return { ok: false, reason: 'no_snapshot' };
  ensureBossStateServer(snapshot);
  const alive = snapshot.bosses.filter((b) => b && b.alive !== false);
  if (alive.length >= 2) return { ok: false, reason: 'max_active' };

  const bossTypes = [
    { type: 'hunter', name: 'Der Jäger' },
    { type: 'destroyer', name: 'Der Zerstörer' },
    { type: 'reaper', name: 'Der Räuber' },
    { type: 'guardian', name: 'Der Wächter' },
    { type: 'magnet', name: 'Der Magnet' },
  ];
  const freeBossNodes = [];
  for (const node of boardAuthority.nodesById.values()) {
    if (node?.type !== 'boss') continue;
    if (isOccupiedNodeServer(snapshot, node.id)) continue;
    if (Array.isArray(snapshot.barricades) && snapshot.barricades.includes(node.id)) continue;
    if (isBossNodeServer(snapshot, node.id)) continue;
    freeBossNodes.push(node.id);
  }
  const nodeId = randomFrom(freeBossNodes);
  if (!nodeId) return { ok: false, reason: 'no_free_boss_field' };
  const bossDef = randomFrom(bossTypes);
  const boss = {
    id: `b${snapshot.bossIdSeq++}`,
    type: bossDef.type,
    name: bossDef.name,
    node: nodeId,
    alive: true,
    visible: true,
    hits: 0,
    meta: {},
  };
  snapshot.bosses.push(boss);
  return { ok: true, boss };
}



function spawnBossByTypeServer(snapshot, wantedType) {
  if (!boardAuthority.enabled || !snapshot) return { ok: false, reason: 'no_snapshot' };
  ensureBossStateServer(snapshot);
  const defs = {
    hunter: { type: 'hunter', name: 'Der Jäger' },
    destroyer: { type: 'destroyer', name: 'Der Zerstörer' },
    reaper: { type: 'reaper', name: 'Der Räuber' },
    guardian: { type: 'guardian', name: 'Der Wächter' },
    magnet: { type: 'magnet', name: 'Der Magnet' },
  };
  const bossType = String(wantedType || '').trim();
  const def = defs[bossType] || null;
  if (!def) return spawnRandomBossServer(snapshot);

  const alive = snapshot.bosses.filter((b) => b && b.alive !== false);
  if (alive.length >= 2) return { ok: false, reason: 'max_active' };

  const freeBossNodes = [];
  for (const node of boardAuthority.nodesById.values()) {
    if (node?.type !== 'boss') continue;
    if (isOccupiedNodeServer(snapshot, node.id)) continue;
    if (Array.isArray(snapshot.barricades) && snapshot.barricades.includes(node.id)) continue;
    if (isBossNodeServer(snapshot, node.id)) continue;
    freeBossNodes.push(node.id);
  }
  const nodeId = randomFrom(freeBossNodes);
  if (!nodeId) return { ok: false, reason: 'no_free_boss_field' };

  const boss = {
    id: `b${snapshot.bossIdSeq++}`,
    type: def.type,
    name: def.name,
    node: nodeId,
    alive: true,
    visible: true,
    hits: 0,
    meta: {},
  };
  snapshot.bosses.push(boss);
  return { ok: true, boss };
}

function ensureBossRuntimeServer(snapshot) {
  ensureBossStateServer(snapshot);
  if (typeof snapshot.bossTick !== 'number') snapshot.bossTick = 0;
  if (typeof snapshot.bossRoundNum !== 'number') snapshot.bossRoundNum = 0;
}

function getPieceByNodeServer(snapshot, nodeId) {
  return Array.isArray(snapshot?.pieces) ? snapshot.pieces.find((p) => p && p.node === nodeId) || null : null;
}

function isStartNodeServer(nodeId) {
  const node = boardAuthority.nodesById.get(nodeId);
  return !!node && node.type === 'start';
}

function getActivePieceNodesServer(snapshot, team = null) {
  const pieces = Array.isArray(snapshot?.pieces) ? snapshot.pieces : [];
  return pieces
    .filter((p) => p && p.node && (team == null || Number(p.team || 0) === Number(team || 0)))
    .map((p) => p.node)
    .filter((id) => !isStartNodeServer(id));
}

function kickPieceToStartServer(snapshot, piece) {
  if (!snapshot || !piece) return false;
  const starts = getStartNodesForTeam(piece.team);
  const target = starts.find((id) => !snapshot.pieces.some((p) => p && p.id !== piece.id && p.node === id)) || starts[0] || null;
  piece.prev = piece.node || null;
  piece.node = target;
  piece.shielded = false;
  return true;
}

function leadingTeamServer(snapshot, playerCount = 4) {
  const scores = Object.assign({ 1: 0, 2: 0, 3: 0, 4: 0 }, snapshot?.goalScores || {});
  let bestTeam = 1;
  let best = -Infinity;
  for (let t = 1; t <= Math.max(1, Number(playerCount || 4)); t += 1) {
    const val = Number(scores[t] || 0);
    if (val > best) {
      best = val;
      bestTeam = t;
    }
  }
  return bestTeam;
}

function computeBossNextStepServer(snapshot, boss, goalIds) {
  if (!boardAuthority.enabled || !snapshot || !boss?.node || !Array.isArray(goalIds) || !goalIds.length) return null;
  const goals = new Set(goalIds.filter(Boolean));
  if (goals.has(boss.node)) return boss.node;

  const q = [boss.node];
  const prev = new Map([[boss.node, null]]);
  const barricades = new Set(Array.isArray(snapshot?.barricades) ? snapshot.barricades : []);

  while (q.length) {
    const cur = q.shift();
    for (const nb of (boardAuthority.adj.get(cur) || [])) {
      if (prev.has(nb)) continue;
      const meta = boardAuthority.nodesById.get(nb);
      if (!meta || meta.type === 'start') continue;

      const occ = getPieceByNodeServer(snapshot, nb);
      if (occ?.shielded) continue;

      if (boss.type !== 'reaper' && barricades.has(nb)) continue;

      prev.set(nb, cur);
      if (goals.has(nb)) {
        let step = nb;
        let parent = prev.get(step);
        while (parent && parent !== boss.node) {
          step = parent;
          parent = prev.get(step);
        }
        return step;
      }
      q.push(nb);
    }
  }
  return null;
}

function relocateBarricadeServer(snapshot, fromNodeId) {
  if (!snapshot) return null;
  const blocked = new Set();
  for (const p of (snapshot.pieces || [])) if (p?.node) blocked.add(p.node);
  for (const b of (snapshot.bosses || [])) if (b && b.alive !== false && b.node) blocked.add(b.node);

  const candidates = [];
  for (const node of boardAuthority.nodesById.values()) {
    if (!node?.id) continue;
    if (node.type === 'start' || node.type === 'portal' || node.type === 'boss' || node.type === 'obstacle') continue;
    if (fromNodeId && node.id === fromNodeId) continue;
    if (blocked.has(node.id)) continue;
    if (Array.isArray(snapshot.barricades) && snapshot.barricades.includes(node.id)) continue;
    candidates.push(node.id);
  }
  return randomFrom(candidates);
}

function collideBossAtNodeServer(snapshot, boss, nodeId) {
  const piece = getPieceByNodeServer(snapshot, nodeId);
  if (!piece || piece.shielded) return null;

  if (boss.type === 'reaper') {
    if (snapshot.goalNodeId && nodeId === snapshot.goalNodeId) {
      kickPieceToStartServer(snapshot, piece);
      return `🗡 ${boss.name} wirft Team ${piece.team} vom Zielfeld zurück.`;
    }
    return null;
  }

  kickPieceToStartServer(snapshot, piece);
  return `👹 ${boss.name} schickt Team ${piece.team} zurück auf Start.`;
}

function maybeDefeatBossAtNodeServer(snapshot, nodeId, byTeam) {
  ensureBossStateServer(snapshot);
  const boss = snapshot.bosses.find((b) => b && b.alive !== false && b.node === nodeId) || null;
  if (!boss) return null;

  if (boss.type !== 'reaper') {
    boss.alive = false;
    boss.node = null;
    return `⚔ Team ${byTeam} besiegt ${boss.name}.`;
  }

  boss.hits = Number(boss.hits || 0) + 1;
  if (boss.hits >= 2) {
    boss.alive = false;
    boss.node = null;
    return `⚔ Team ${byTeam} besiegt ${boss.name}.`;
  }

  const bossFields = [];
  for (const node of boardAuthority.nodesById.values()) {
    if (node?.type !== 'boss') continue;
    if (isBossNodeServer(snapshot, node.id)) continue;
    if (isOccupiedNodeServer(snapshot, node.id)) continue;
    bossFields.push(node.id);
  }
  const teleportTo = randomFrom(bossFields);
  if (teleportTo) boss.node = teleportTo;
  return `⚔ Team ${byTeam} trifft ${boss.name} (1/2).`;
}

function moveBossOneStepServer(snapshot, boss, playerCount = 4, force = false) {
  if (!snapshot || !boss || boss.alive === false || !boss.node) return { moved: false, info: null };
  ensureBossRuntimeServer(snapshot);

  let goalIds = [];
  if (boss.type === 'hunter') {
    const lead = leadingTeamServer(snapshot, playerCount);
    goalIds = getActivePieceNodesServer(snapshot, lead);
    if (!goalIds.length) goalIds = getActivePieceNodesServer(snapshot, null);
  } else if (boss.type === 'destroyer') {
    goalIds = Array.isArray(snapshot.barricades) ? snapshot.barricades.filter((id) => !isStartNodeServer(id)) : [];
    if (!goalIds.length) {
      const lead = leadingTeamServer(snapshot, playerCount);
      goalIds = getActivePieceNodesServer(snapshot, lead);
      if (!goalIds.length) goalIds = getActivePieceNodesServer(snapshot, null);
    }
  } else if (boss.type === 'reaper') {
    if (snapshot.goalNodeId && !isStartNodeServer(snapshot.goalNodeId)) goalIds = [snapshot.goalNodeId];
    if (!goalIds.length) {
      const lead = leadingTeamServer(snapshot, playerCount);
      goalIds = getActivePieceNodesServer(snapshot, lead);
      if (!goalIds.length) goalIds = getActivePieceNodesServer(snapshot, null);
    }
  } else {
    return { moved: false, info: null };
  }

  const step = computeBossNextStepServer(snapshot, boss, goalIds);
  if (!step || step === boss.node) return { moved: false, info: `🛑 ${boss.name} ist blockiert.` };

  let info = null;
  if (boss.type === 'reaper') {
    if (Array.isArray(snapshot.barricades) && snapshot.barricades.includes(step)) {
      snapshot.barricades = snapshot.barricades.filter((id) => id !== step);
      const relocated = relocateBarricadeServer(snapshot, step);
      if (relocated) snapshot.barricades.push(relocated);
    }
  } else if (Array.isArray(snapshot.barricades) && snapshot.barricades.includes(step)) {
    snapshot.barricades = snapshot.barricades.filter((id) => id !== step);
  }

  boss.node = step;
  const collideInfo = collideBossAtNodeServer(snapshot, boss, step);
  if (collideInfo) info = collideInfo;
  return { moved: true, info: info || `👹 ${boss.name} bewegt sich nach ${step}.` };
}

function runBossPhaseServer(snapshot, options = {}) {
  if (!snapshot) return { info: '' };
  ensureBossRuntimeServer(snapshot);

  const playerCount = Math.max(1, Number(options.playerCount || 4));
  const roundEnd = !!options.roundEnd;
  const forceAll = !!options.forceAll;
  const infoParts = [];

  snapshot.bossTick += 1;
  if (roundEnd) snapshot.bossRoundNum += 1;

  const phaseTick = Number(snapshot.bossTick || 0);
  const alive = (snapshot.bosses || []).filter((b) => b && b.alive !== false);

  for (const boss of alive) {
    if (boss.type === 'hunter') {
      const res = moveBossOneStepServer(snapshot, boss, playerCount, forceAll);
      if (res.info) infoParts.push(res.info);
      continue;
    }

    if (boss.type === 'guardian') {
      const extra = relocateBarricadeServer(snapshot, null);
      if (extra) {
        if (!Array.isArray(snapshot.barricades)) snapshot.barricades = [];
        snapshot.barricades.push(extra);
        infoParts.push(`🛡 ${boss.name} setzt eine zusätzliche Barrikade.`);
      }
      if (phaseTick > 0 && phaseTick % 2 === 0) {
        const bossFields = [];
        for (const node of boardAuthority.nodesById.values()) {
          if (node?.type !== 'boss') continue;
          if (isOccupiedNodeServer(snapshot, node.id)) continue;
          if ((snapshot.bosses || []).some((b) => b && b.id !== boss.id && b.alive !== false && b.node === node.id)) continue;
          bossFields.push(node.id);
        }
        const to = randomFrom(bossFields);
        if (to) {
          boss.node = to;
          const collideInfo = collideBossAtNodeServer(snapshot, boss, to);
          infoParts.push(collideInfo || `🛡 ${boss.name} teleportiert nach ${to}.`);
        }
      }
      continue;
    }

    if (boss.type === 'magnet') {
      const dist = new Map([[boss.node, 0]]);
      const q = [boss.node];
      while (q.length) {
        const cur = q.shift();
        const d = dist.get(cur);
        for (const nb of (boardAuthority.adj.get(cur) || [])) {
          if (dist.has(nb)) continue;
          dist.set(nb, d + 1);
          q.push(nb);
        }
      }
      const pieces = (snapshot.pieces || []).filter((p) => p && p.node).slice().sort((a, b) => Number(a.team || 0) - Number(b.team || 0));
      let movedCount = 0;
      for (const piece of pieces) {
        const here = piece.node;
        const hereDist = dist.get(here);
        if (typeof hereDist !== 'number') continue;
        let best = null;
        let bestDist = hereDist;
        for (const nb of (boardAuthority.adj.get(here) || [])) {
          const d = dist.get(nb);
          if (typeof d !== 'number' || d >= bestDist) continue;
          if (isStartNodeServer(nb)) continue;
          if (getPieceByNodeServer(snapshot, nb)) continue;
          bestDist = d;
          best = nb;
        }
        if (!best) continue;
        piece.prev = piece.node || null;
        piece.node = best;
        piece.shielded = false;
        movedCount += 1;
      }
      if (movedCount > 0) infoParts.push(`🧲 ${boss.name} zieht ${movedCount} Figuren näher.`);
      else infoParts.push(`🧲 ${boss.name} zieht, aber niemanden näher.`);
      continue;
    }

    const steps = boss.type === 'destroyer' ? 3 : 5;
    for (let i = 0; i < steps; i += 1) {
      const res = moveBossOneStepServer(snapshot, boss, playerCount, forceAll);
      if (res.info && i === 0) infoParts.push(res.info);
      if (!res.moved) break;
    }

    if (boss.type === 'destroyer' && Array.isArray(snapshot.barricades) && snapshot.barricades.length) {
      const pick = randomFrom(snapshot.barricades);
      if (pick) {
        snapshot.barricades = snapshot.barricades.filter((id) => id !== pick);
        infoParts.push(`⚔ ${boss.name} zerstört eine Barrikade.`);
      }
    }
  }

  return { info: infoParts.join(' ') };
}

function finalizeTurnAfterBossServer(room, snapshot, currentTurnIndex, requestId, info, eventCard, eventResult) {
  const sameTeamAgain = Number(room.gameState?.lastRoll || 0) === 6;
  const keepTurnBecauseEvent = !!eventResult?.keepTurn;
  const preventBossPhase = !!eventResult?.preventBossPhase;
  const nextTurnIndex = (sameTeamAgain || keepTurnBecauseEvent)
    ? currentTurnIndex
    : ((currentTurnIndex + 1) % room.players.length);

  let combinedInfo = String(info || '').trim();

  if (!preventBossPhase) {
    const roundEnd = (!sameTeamAgain && !keepTurnBecauseEvent && nextTurnIndex === 0 && room.players.length > 1);
    const bossPhase = runBossPhaseServer(snapshot, {
      playerCount: room.players.length,
      roundEnd,
      forceAll: false,
    });
    if (bossPhase.info) combinedInfo = `${combinedInfo} ${bossPhase.info}`.trim();
  }

  if (snapshot.gameOver) {
    snapshot.turnIndex = currentTurnIndex;
    snapshot.roll = 0;
    snapshot.phase = 'gameOver';
    room.gameState.snapshot = snapshot;
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
      info: `🏆 Team ${snapshot.winnerTeam || (currentTurnIndex + 1)} gewinnt!`,
    });
    return;
  }

  ensureJokerStateServer(snapshot);
  snapshot.turnIndex = nextTurnIndex;
  snapshot.phase = sanitizePhase(eventResult?.setPhase || 'needRoll');
  snapshot.roll = Number(eventResult?.setRoll || 0);
  snapshot.ignoreBarricadesThisTurn = !!eventResult?.setIgnoreBarricadesThisTurn;
  snapshot.jokerFlags.double = false;
  snapshot.jokerFlags.allcolors = false;

  room.gameState.snapshot = snapshot;
  room.gameState.turnIndex = nextTurnIndex;
  room.gameState.phase = snapshot.phase;
  room.gameState.lastMove = null;
  room.gameState.lastRoll = (typeof eventResult?.setLastRoll === 'number') ? Number(eventResult.setLastRoll || 0) : null;
  room.gameState.lastRollAt = room.gameState.lastRoll ? new Date().toISOString() : null;
  room.gameState.lastRollBy = room.gameState.lastRoll ? (room.players[currentTurnIndex]?.id || null) : null;
  room.gameState.lastRollMeta = eventResult?.clearLastRollMeta ? null : room.gameState.lastRollMeta;

  const nextTeam = nextTurnIndex + 1;
  let turnInfo = '';
  if (snapshot.phase === 'choosePiece' && snapshot.roll > 0) {
    turnInfo = `Team ${nextTeam} wählt jetzt eine Figur für ${snapshot.roll} Felder.`;
  } else if (snapshot.phase === 'needRoll') {
    turnInfo = (sameTeamAgain || keepTurnBecauseEvent)
      ? `Team ${nextTeam} ist nochmal dran.`
      : `Team ${nextTeam} ist dran: Würfeln.`;
  } else {
    turnInfo = `Team ${nextTeam} ist dran.`;
  }
  combinedInfo = `${combinedInfo} ${turnInfo}`.trim();

  if (eventCard) {
    broadcastRoom(room, 'event_card', {
      room: publicRoomState(room),
      requestId,
      card: eventCard,
      info: combinedInfo,
    });
  }

  broadcastRoom(room, 'game_turn_state', {
    room: publicRoomState(room),
    gameState: room.gameState,
    requestId,
    info: combinedInfo,
  });
}

function adjustGoalPointsServer(snapshot, team, delta) {
  const scores = Object.assign({ 1: 0, 2: 0, 3: 0, 4: 0 }, snapshot.goalScores || {});
  const next = Math.max(0, Number(scores[team] || 0) + Number(delta || 0));
  scores[team] = next;
  snapshot.goalScores = scores;
  const goalToWin = Number(snapshot.goalToWin || 10);
  if (next >= goalToWin) {
    snapshot.gameOver = true;
    snapshot.winnerTeam = team;
    snapshot.phase = 'gameOver';
  }
  return next;
}

const SERVER_EVENT_DECK = [
  { id: 'joker_pick6', title: 'Zufälliger Joker', text: 'Du erhältst einen zufälligen Joker.', count: 50 },
  { id: 'joker_wheel', title: 'Joker-Glücksrad', text: 'Du erhältst einen zufälligen Joker in zufälliger Menge (1–3).', count: 10 },
  { id: 'jokers_all6', title: 'Alle 6 Joker', text: 'Du erhältst +1 von jedem Joker.', count: 1 },
  { id: 'joker_rain', title: 'Joker-Regen', text: 'Alle anderen Spieler erhalten je 2 zufällige Joker.', count: 10 },

  { id: 'spawn_barricades3', title: 'Barrikaden-Verstärkung', text: 'Drei zusätzliche Barrikaden erscheinen.', count: 5 },
  { id: 'spawn_barricades10', title: 'Barrikaden-Invasion', text: 'Zehn zusätzliche Barrikaden erscheinen.', count: 1 },
  { id: 'spawn_barricades5', title: 'Barrikaden-Nachschub', text: 'Fünf zusätzliche Barrikaden erscheinen.', count: 3 },
  { id: 'move_barricade1', title: 'Barrikade versetzen', text: 'Eine Barrikade wird versetzt.', count: 5 },
  { id: 'move_barricade2', title: 'Zwei Barrikaden versetzen', text: 'Zwei Barrikaden werden versetzt.', count: 3 },
  { id: 'barricades_reset_initial', title: 'Barrikaden-Reset', text: 'Alle Barrikaden gehen auf die Startpositionen zurück.', count: 5 },
  { id: 'barricades_shuffle', title: 'Barrikaden mischen', text: 'Alle Barrikaden werden neu gemischt.', count: 1 },
  { id: 'barricades_on_event_and_goal', title: 'Barrikaden-Invasion', text: 'Auf Ereignisfelder und Zielpunkt werden Barrikaden gesetzt.', count: 2 },
  { id: 'barricades_half_remove', title: 'Barrikaden verfallen', text: 'Die Hälfte aller Barrikaden verschwindet.', count: 2 },
  { id: 'barricade_jump_reroll', title: 'Sturmangriff', text: 'Nochmal würfeln, Barrikaden auf dem Weg ignorieren.', count: 4 },

  { id: 'spawn_one_boss', title: 'Ein Boss erscheint', text: 'Ein Boss erscheint auf einem freien Bossfeld.', count: 5 },
  { id: 'spawn_two_bosses', title: 'Zwei Bosse erscheinen', text: 'Bis zu zwei Bosse erscheinen.', count: 1 },
  { id: 'extra_roll_event', title: 'Nochmal würfeln', text: 'Dieses Team ist sofort nochmal dran.', count: 3 },
  { id: 'start_spawn', title: 'Startfeld-Spawn', text: 'Startfeld-Figuren werden zufällig aufs Brett verteilt.', count: 1 },
  { id: 'all_to_start', title: 'Alle zurück zum Start', text: 'Alle Spielfiguren werden zurück auf ihre Startfelder gesetzt.', count: 1 },
  { id: 'lose_all_jokers', title: 'Du verlierst alle Joker', text: 'Das aktive Team verliert alle Joker.', count: 1 },
  { id: 'respawn_all_events', title: 'Ereignisfelder neu', text: 'Alle Ereignisfelder werden neu verteilt.', count: 2 },
  { id: 'spawn_double_goal', title: 'Doppel-Zielfeld', text: 'Ein Doppel-Zielfeld erscheint auf einem freien Feld.', count: 3 },
  { id: 'dice_duel', title: 'Würfel-Duell', text: 'Niedrigster Wurf gibt höchstem Wurf einen zufälligen Joker.', count: 1 },
  { id: 'lose_one_point', title: 'Punktverlust', text: 'Das aktive Team verliert 1 Zielpunkt.', count: 1 },
  { id: 'gain_one_point', title: 'Zielpunkt +1', text: 'Das aktive Team erhält 1 Zielpunkt.', count: 5 },
  { id: 'gain_two_points', title: 'Zielpunkt +2', text: 'Das aktive Team erhält 2 Zielpunkte.', count: 2 },
  { id: 'point_transfer_most_to_least', title: 'Punktetausch', text: 'Meistes Team gibt dem wenigsten Team 1 Zielpunkt.', count: 2 },
  { id: 'shuffle_pieces', title: 'Figuren mischen', text: 'Spielfiguren werden neu gemischt.', count: 1 },
  { id: 'back_to_start', title: 'Zurück zum Start', text: 'Das aktive Team muss zurück zum Start.', count: 1 },
  { id: 'others_to_start', title: 'Alle anderen zurück zum Start', text: 'Alle anderen Teams müssen zurück zum Start.', count: 1 },
  { id: 'steal_one_point', title: 'Klaue 1 Siegpunkt', text: 'Klaue 1 Zielpunkt von einem zufälligen Gegner.', count: 1 },
  { id: 'sprint_5', title: 'Laufe 5 Felder', text: 'Das aktive Team darf sofort 5 Felder laufen.', count: 5 },
  { id: 'sprint_10', title: 'Laufe 10 Felder', text: 'Das aktive Team darf sofort 10 Felder laufen.', count: 5 },
  { id: 'spawn_bonus_light', title: 'Zusätzliches Lichtfeld', text: 'Ein zusätzliches Lichtfeld erscheint auf dem Brett.', count: 5 },
];

function cloneServerEventCard(card) {
  return card ? JSON.parse(JSON.stringify(card)) : null;
}

function pickWeightedServerEventCard() {
  const deck = SERVER_EVENT_DECK.filter((card) => Number(card?.count || 0) > 0);
  if (!deck.length) return null;
  const total = deck.reduce((sum, card) => sum + Math.max(0, Number(card.count || 0)), 0);
  if (total <= 0) return cloneServerEventCard(deck[0]);
  let roll = Math.floor(Math.random() * total);
  for (const card of deck) {
    roll -= Math.max(0, Number(card.count || 0));
    if (roll < 0) return cloneServerEventCard(card);
  }
  return cloneServerEventCard(deck[deck.length - 1]);
}

function pickServerEventCard() {
  return pickWeightedServerEventCard() || cloneServerEventCard(SERVER_EVENT_DECK[0]);
}

function addJokerServer(snapshot, team, jokerId, amount = 1) {
  ensureJokerStateServer(snapshot);
  if (!SERVER_JOKER_IDS.includes(jokerId)) return 0;
  const before = jokerCountServer(snapshot, team, jokerId);
  const after = Math.max(0, Math.min(SERVER_JOKER_MAX_PER_TYPE, before + Number(amount || 0)));
  snapshot.jokers[team][jokerId] = after;
  return Math.max(0, after - before);
}

function removeAllJokersFromTeamServer(snapshot, team) {
  ensureJokerStateServer(snapshot);
  let removed = 0;
  for (const id of SERVER_JOKER_IDS) {
    removed += jokerCountServer(snapshot, team, id);
    snapshot.jokers[team][id] = 0;
  }
  return removed;
}

function removeRandomJokerServer(snapshot, team, amount = 1) {
  ensureJokerStateServer(snapshot);
  let removed = 0;
  const count = Math.max(1, Number(amount || 1));
  for (let i = 0; i < count; i += 1) {
    const pool = SERVER_JOKER_IDS.filter((id) => jokerCountServer(snapshot, team, id) > 0);
    if (!pool.length) break;
    const pick = randomFrom(pool);
    snapshot.jokers[team][pick] = Math.max(0, jokerCountServer(snapshot, team, pick) - 1);
    removed += 1;
  }
  return removed;
}

function transferRandomJokerBetweenTeamsServer(snapshot, fromTeam, toTeam) {
  ensureJokerStateServer(snapshot);
  const pool = SERVER_JOKER_IDS.filter((id) => jokerCountServer(snapshot, fromTeam, id) > 0);
  if (!pool.length) return { ok: false, reason: 'no_joker' };
  const pick = randomFrom(pool);
  snapshot.jokers[fromTeam][pick] = Math.max(0, jokerCountServer(snapshot, fromTeam, pick) - 1);
  const gained = addJokerServer(snapshot, toTeam, pick, 1);
  return { ok: gained > 0, jokerId: pick };
}

function grantRandomJokerServer(snapshot, team, amount = 1) {
  ensureJokerStateServer(snapshot);
  const granted = [];
  const count = Math.max(1, Number(amount || 1));
  for (let i = 0; i < count; i += 1) {
    const pick = randomFrom(SERVER_JOKER_IDS);
    if (!pick) break;
    const gained = addJokerServer(snapshot, team, pick, 1);
    if (gained > 0) granted.push(pick);
  }
  return granted;
}

function grantAllSixJokersServer(snapshot, team) {
  ensureJokerStateServer(snapshot);
  const granted = [];
  for (const id of SERVER_JOKER_IDS) {
    const gained = addJokerServer(snapshot, team, id, 1);
    if (gained > 0) granted.push(id);
  }
  return granted;
}

function isPlainFreeNodeServer(snapshot, nodeId) {
  if (!nodeId) return false;
  const node = boardAuthority.nodesById.get(nodeId);
  if (!node || node.type !== 'normal') return false;
  if (nodeId === snapshot.goalNodeId || nodeId === snapshot.bonusGoalNodeId || nodeId === snapshot.bonusLightNodeId) return false;
  if (Array.isArray(snapshot.eventActive) && snapshot.eventActive.includes(nodeId)) return false;
  if (Array.isArray(snapshot.barricades) && snapshot.barricades.includes(nodeId)) return false;
  if (isOccupiedNodeServer(snapshot, nodeId)) return false;
  if (isBossNodeServer(snapshot, nodeId)) return false;
  return true;
}

function spawnStartPiecesRoundRobinServer(snapshot, playerCount = 4) {
  if (!snapshot || !Array.isArray(snapshot.pieces)) return { moved: 0, leftOnStart: 0 };
  const teamOrder = [];
  for (let t = 1; t <= Math.max(1, Number(playerCount || 4)); t += 1) teamOrder.push(t);

  const startPieces = snapshot.pieces.filter((p) => p?.node && isStartNodeServer(p.node));
  const freeNodes = [];
  for (const node of boardAuthority.nodesById.values()) {
    if (isPlainFreeNodeServer(snapshot, node.id)) freeNodes.push(node.id);
  }
  for (let i = freeNodes.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [freeNodes[i], freeNodes[j]] = [freeNodes[j], freeNodes[i]];
  }

  const byTeam = new Map();
  for (const piece of startPieces) {
    if (!byTeam.has(piece.team)) byTeam.set(piece.team, []);
    byTeam.get(piece.team).push(piece);
  }
  for (const arr of byTeam.values()) {
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  let moved = 0;
  let idx = 0;
  while (idx < freeNodes.length) {
    let any = false;
    for (const team of teamOrder) {
      const arr = byTeam.get(team);
      if (arr && arr.length && idx < freeNodes.length) {
        const piece = arr.pop();
        piece.prev = piece.node || null;
        piece.node = freeNodes[idx++];
        piece.shielded = false;
        moved += 1;
        any = true;
      }
    }
    if (!any) break;
  }

  let leftOnStart = 0;
  for (const arr of byTeam.values()) leftOnStart += arr.length;
  return { moved, leftOnStart };
}

function getInitialBarricadeLayoutServer() {
  const layout = [];
  for (const node of boardAuthority.nodesById.values()) {
    if (node?.type === 'barricade') layout.push(node.id);
  }
  return layout;
}

function resetBarricadesToInitialServer(snapshot) {
  if (!snapshot) return { targetCount: 0, placed: 0 };
  const layout = getInitialBarricadeLayoutServer();
  const blocked = new Set();
  for (const p of (snapshot.pieces || [])) if (p?.node) blocked.add(p.node);
  for (const b of (snapshot.bosses || [])) if (b && b.alive !== false && b.node) blocked.add(b.node);

  snapshot.barricades = [];
  for (const nodeId of layout) {
    const node = boardAuthority.nodesById.get(nodeId);
    if (!node || node.type === 'start' || node.type === 'portal' || node.type === 'boss') continue;
    if (blocked.has(nodeId)) continue;
    snapshot.barricades.push(nodeId);
  }
  const missing = Math.max(0, layout.length - snapshot.barricades.length);
  if (missing > 0) spawnExtraBarricadesServer(snapshot, missing);
  return { targetCount: layout.length, placed: snapshot.barricades.length };
}

function shuffleBarricadesRandomlyServer(snapshot) {
  if (!snapshot) return { count: 0, placed: 0 };
  const count = Array.isArray(snapshot.barricades) ? snapshot.barricades.length : 0;
  snapshot.barricades = [];
  const placed = spawnExtraBarricadesServer(snapshot, count);
  return { count, placed };
}

function placeBarricadesOnEventAndGoalServer(snapshot) {
  if (!snapshot) return { placed: 0 };
  if (!Array.isArray(snapshot.barricades)) snapshot.barricades = [];
  const current = new Set(snapshot.barricades);
  const targets = new Set(Array.isArray(snapshot.eventActive) ? snapshot.eventActive : []);
  if (snapshot.goalNodeId) targets.add(snapshot.goalNodeId);
  let placed = 0;
  for (const nodeId of targets) {
    const node = boardAuthority.nodesById.get(nodeId);
    if (!node) continue;
    if (node.type === 'start' || node.type === 'portal' || node.type === 'boss') continue;
    if (current.has(nodeId)) continue;
    if (isOccupiedNodeServer(snapshot, nodeId) || isBossNodeServer(snapshot, nodeId)) continue;
    current.add(nodeId);
    placed += 1;
  }
  snapshot.barricades = Array.from(current);
  return { placed };
}

function removeHalfBarricadesServer(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.barricades)) return { total: 0, removed: 0 };
  const total = snapshot.barricades.length;
  if (total <= 0) return { total: 0, removed: 0 };
  const arr = snapshot.barricades.slice();
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  const keep = Math.ceil(total / 2);
  snapshot.barricades = arr.slice(0, keep);
  return { total, removed: total - keep };
}

function moveRandomBarricadesServer(snapshot, amount = 1) {
  if (!snapshot || !Array.isArray(snapshot.barricades) || !snapshot.barricades.length) return { moved: 0 };
  const count = Math.max(1, Number(amount || 1));
  let moved = 0;
  for (let i = 0; i < count; i += 1) {
    if (!snapshot.barricades.length) break;
    const from = randomFrom(snapshot.barricades);
    if (!from) break;
    snapshot.barricades = snapshot.barricades.filter((id) => id !== from);
    const to = relocateBarricadeServer(snapshot, from);
    if (to) {
      snapshot.barricades.push(to);
      moved += 1;
    }
  }
  return { moved };
}

function spawnTwoBossesServer(snapshot) {
  const results = [];
  for (let i = 0; i < 2; i += 1) {
    const res = spawnRandomBossServer(snapshot);
    if (!res?.ok) break;
    results.push(res.boss);
  }
  return results;
}

function respawnAllEventFieldsServer(snapshot) {
  if (!snapshot) return { moved: 0, total: 0 };
  const current = Array.isArray(snapshot.eventActive) ? snapshot.eventActive.slice() : [];
  if (!current.length) return { moved: 0, total: 0 };
  let moved = 0;
  for (const fromId of current) {
    relocateEventFieldServer(snapshot, fromId);
    moved += 1;
  }
  return { moved, total: current.length };
}

function getMostAndLeastTeamsServer(snapshot, playerCount = 4) {
  const teams = [];
  for (let t = 1; t <= Math.max(1, Number(playerCount || 4)); t += 1) teams.push(t);
  const scores = {};
  for (const team of teams) scores[team] = Number(snapshot?.goalScores?.[team] || 0);
  const maxScore = Math.max(...teams.map((t) => scores[t]));
  const minScore = Math.min(...teams.map((t) => scores[t]));
  return {
    teams,
    scores,
    maxScore,
    minScore,
    donorCandidates: teams.filter((t) => scores[t] === maxScore),
    receiverCandidates: teams.filter((t) => scores[t] === minScore),
  };
}

function applyMostToLeastPointTransferServer(snapshot, playerCount = 4) {
  const info = getMostAndLeastTeamsServer(snapshot, playerCount);
  const donor = randomFrom(info.donorCandidates);
  let receivers = info.receiverCandidates.filter((t) => t !== donor);
  if (!receivers.length) receivers = info.receiverCandidates.slice();
  const receiver = randomFrom(receivers);
  if (!donor || !receiver || donor === receiver) return { ok: false, reason: 'same_team' };
  if (Number(snapshot?.goalScores?.[donor] || 0) <= 0) return { ok: false, reason: 'donor_has_zero', donor, receiver };
  adjustGoalPointsServer(snapshot, donor, -1);
  adjustGoalPointsServer(snapshot, receiver, 1);
  return { ok: true, donor, receiver };
}

function shufflePiecesServer(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.pieces)) return { moved: 0 };
  const eligible = snapshot.pieces.filter((p) => {
    if (!p?.node) return false;
    if (isStartNodeServer(p.node)) return false;
    const node = boardAuthority.nodesById.get(p.node);
    if (node?.type === 'portal') return false;
    if (p.shielded) return false;
    return true;
  });
  if (eligible.length < 2) return { moved: 0 };
  const nodes = eligible.map((p) => p.node);
  for (let i = nodes.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [nodes[i], nodes[j]] = [nodes[j], nodes[i]];
  }
  for (let i = 0; i < eligible.length; i += 1) {
    eligible[i].prev = eligible[i].node || null;
    eligible[i].node = nodes[i];
  }
  return { moved: eligible.length };
}

function sendTeamPiecesToStartServer(snapshot, team) {
  if (!snapshot || !Array.isArray(snapshot.pieces)) return { moved: 0 };
  const pieces = snapshot.pieces.filter((p) => Number(p?.team || 0) === Number(team || 0));
  const starts = getStartNodesForTeam(team);
  let moved = 0;
  for (let i = 0; i < pieces.length; i += 1) {
    const piece = pieces[i];
    const target = starts[i] || starts[starts.length - 1] || null;
    if (piece.node !== target) moved += 1;
    piece.prev = piece.node || null;
    piece.node = target;
    piece.shielded = false;
  }
  return { moved };
}

function sendOtherTeamsToStartServer(snapshot, exceptTeam) {
  if (!snapshot || !Array.isArray(snapshot.pieces)) return { moved: 0 };
  let moved = 0;
  const teams = new Set(snapshot.pieces.map((p) => p.team));
  for (const team of teams) {
    if (Number(team) === Number(exceptTeam || 0)) continue;
    moved += sendTeamPiecesToStartServer(snapshot, team).moved;
  }
  return { moved };
}

function stealOnePointServer(snapshot, team, playerCount = 4) {
  const candidates = [];
  for (let t = 1; t <= Math.max(1, Number(playerCount || 4)); t += 1) {
    if (t === team) continue;
    if (Number(snapshot?.goalScores?.[t] || 0) > 0) candidates.push(t);
  }
  const victim = randomFrom(candidates);
  if (!victim) return { ok: false };
  adjustGoalPointsServer(snapshot, victim, -1);
  adjustGoalPointsServer(snapshot, team, 1);
  return { ok: true, victim };
}

function resolveDiceDuelServer(snapshot, playerCount = 4) {
  const teams = [];
  for (let t = 1; t <= Math.max(1, Number(playerCount || 4)); t += 1) teams.push(t);
  if (teams.length < 2) return { ok: false, reason: 'not_enough_players' };

  while (true) {
    const rolls = {};
    for (const team of teams) rolls[team] = randomDie();
    const maxVal = Math.max(...teams.map((t) => rolls[t]));
    const minVal = Math.min(...teams.map((t) => rolls[t]));
    const winners = teams.filter((t) => rolls[t] === maxVal);
    const losers = teams.filter((t) => rolls[t] === minVal);
    if (winners.length === 1 && losers.length === 1 && winners[0] !== losers[0]) {
      const transfer = transferRandomJokerBetweenTeamsServer(snapshot, losers[0], winners[0]);
      return { ok: true, winner: winners[0], loser: losers[0], transfer };
    }
  }
}

function makeServerKeepTurnChoosePieceResult(steps, info) {
  return {
    keepTurn: true,
    preventBossPhase: true,
    setPhase: 'choosePiece',
    setRoll: Number(steps || 0),
    setLastRoll: Number(steps || 0),
    clearLastRollMeta: true,
    info,
  };
}

function makeServerKeepTurnNeedRollResult(info, extra = {}) {
  return Object.assign({
    keepTurn: true,
    preventBossPhase: true,
    setPhase: 'needRoll',
    setRoll: 0,
    setLastRoll: null,
    clearLastRollMeta: true,
    info,
  }, extra || {});
}

function applyServerEventEffect(snapshot, card, team, playerCount = 4) {
  const result = { keepTurn: false, info: '' };
  if (!snapshot || !card) return result;
  ensureJokerStateServer(snapshot);
  if (!Array.isArray(snapshot.barricades)) snapshot.barricades = [];
  if (!Array.isArray(snapshot.eventActive)) snapshot.eventActive = [];

  switch (String(card.id || '')) {
    case 'joker_pick6': {
      const granted = grantRandomJokerServer(snapshot, team, 1);
      result.info = granted.length
        ? `🃏 Team ${team} erhält den Joker ${granted[0]}.`
        : `🃏 Team ${team} konnte keinen zusätzlichen Joker erhalten.`;
      break;
    }
    case 'joker_wheel': {
      const amount = (Math.floor(Math.random() * 3) + 1);
      const pick = randomFrom(SERVER_JOKER_IDS);
      const gained = addJokerServer(snapshot, team, pick, amount);
      result.info = gained > 0
        ? `🎰 Team ${team} erhält ${pick} ×${gained}.`
        : `🎰 Team ${team}: ${pick} war bereits am Maximum.`;
      break;
    }
    case 'jokers_all6': {
      const granted = grantAllSixJokersServer(snapshot, team);
      result.info = granted.length
        ? `🃏 Team ${team} erhält alle 6 Jokerarten.`
        : `🃏 Team ${team} hat bereits alle Joker am Maximum.`;
      break;
    }
    case 'joker_rain': {
      let granted = 0;
      for (let t = 1; t <= Math.max(1, Number(playerCount || 4)); t += 1) {
        if (t === team) continue;
        granted += grantRandomJokerServer(snapshot, t, 2).length;
      }
      result.info = `🌧️ Joker-Regen! Die anderen Teams erhalten zusammen ${granted} Joker.`;
      break;
    }

    case 'spawn_barricades3': {
      const placed = spawnExtraBarricadesServer(snapshot, 3);
      result.info = placed > 0 ? `🧱 ${placed} neue Barrikaden wurden gesetzt.` : '🧱 Keine freie Position für neue Barrikaden gefunden.';
      break;
    }
    case 'spawn_barricades5': {
      const placed = spawnExtraBarricadesServer(snapshot, 5);
      result.info = placed > 0 ? `🧱 ${placed} neue Barrikaden wurden gesetzt.` : '🧱 Keine freie Position für neue Barrikaden gefunden.';
      break;
    }
    case 'spawn_barricades10': {
      const placed = spawnExtraBarricadesServer(snapshot, 10);
      result.info = placed > 0 ? `🧱 ${placed} neue Barrikaden wurden gesetzt.` : '🧱 Keine freie Position für neue Barrikaden gefunden.';
      break;
    }
    case 'move_barricade1': {
      const moved = moveRandomBarricadesServer(snapshot, 1).moved;
      result.info = moved > 0 ? '🧱 Eine Barrikade wurde versetzt.' : '🧱 Es konnte keine Barrikade versetzt werden.';
      break;
    }
    case 'move_barricade2': {
      const moved = moveRandomBarricadesServer(snapshot, 2).moved;
      result.info = moved > 0 ? `🧱 ${moved} Barrikaden wurden versetzt.` : '🧱 Es konnten keine Barrikaden versetzt werden.';
      break;
    }
    case 'barricades_reset_initial': {
      const reset = resetBarricadesToInitialServer(snapshot);
      result.info = `🧱 Barrikaden wurden zurückgesetzt (${reset.placed}/${reset.targetCount}).`;
      break;
    }
    case 'barricades_shuffle': {
      const shuffled = shuffleBarricadesRandomlyServer(snapshot);
      result.info = `🧱 ${shuffled.placed} Barrikaden wurden neu gemischt.`;
      break;
    }
    case 'barricades_on_event_and_goal': {
      const placed = placeBarricadesOnEventAndGoalServer(snapshot).placed;
      result.info = placed > 0 ? `🧱 ${placed} Barrikaden wurden auf Ereignis-/Zielfelder gesetzt.` : '🧱 Keine zusätzlichen Barrikaden konnten gesetzt werden.';
      break;
    }
    case 'barricades_half_remove': {
      const removed = removeHalfBarricadesServer(snapshot);
      result.info = removed.removed > 0 ? `🧱 ${removed.removed} Barrikaden verschwinden vom Brett.` : '🧱 Es gab keine Barrikaden zum Entfernen.';
      break;
    }
    case 'barricade_jump_reroll': {
      return makeServerKeepTurnNeedRollResult(`⚔️ Sturmangriff! Team ${team} würfelt nochmal und ignoriert Barrikaden auf dem Weg.`, {
        setIgnoreBarricadesThisTurn: true,
      });
    }

    case 'spawn_one_boss': {
      const spawned = spawnRandomBossServer(snapshot);
      result.info = spawned?.ok ? `👹 ${spawned.boss?.name || 'Ein Boss'} erscheint auf ${spawned.boss?.node || 'einem Bossfeld'}.` : '👹 Es konnte kein neuer Boss erscheinen.';
      break;
    }
    case 'spawn_two_bosses': {
      const spawned = spawnTwoBossesServer(snapshot);
      result.info = spawned.length > 0 ? `👹 ${spawned.length} Boss(e) erscheinen auf dem Brett.` : '👹 Es konnten keine neuen Bosse erscheinen.';
      break;
    }
    case 'extra_roll_event': {
      result.keepTurn = true;
      result.info = `🎲 Team ${team} darf sofort nochmal würfeln.`;
      break;
    }
    case 'start_spawn': {
      const spawned = spawnStartPiecesRoundRobinServer(snapshot, playerCount);
      result.info = `⚔️ ${spawned.moved} Startfeld-Figuren wurden aufs Brett verteilt.`;
      break;
    }
    case 'all_to_start': {
      const moved = sendAllPlayersToStartServer(snapshot);
      result.info = `🏁 ${moved} Figuren wurden auf ihre Startfelder zurückgesetzt.`;
      break;
    }
    case 'lose_all_jokers': {
      const removed = removeAllJokersFromTeamServer(snapshot, team);
      result.info = `🃏 Team ${team} verliert ${removed} Joker.`;
      break;
    }
    case 'respawn_all_events': {
      const moved = respawnAllEventFieldsServer(snapshot);
      result.info = `✨ ${moved.moved}/${moved.total} Ereignisfelder wurden neu verteilt.`;
      break;
    }
    case 'spawn_double_goal': {
      const nodeId = spawnBonusGoalServer(snapshot);
      result.info = nodeId ? `🌟 Ein Doppel-Zielfeld erscheint auf ${nodeId}.` : '🌟 Es konnte kein Doppel-Zielfeld gespawnt werden.';
      break;
    }
    case 'dice_duel': {
      const duel = resolveDiceDuelServer(snapshot, playerCount);
      if (!duel.ok) {
        result.info = '🎲 Das Würfel-Duell konnte nicht ausgewertet werden.';
      } else if (!duel.transfer?.ok) {
        result.info = `🎲 Team ${duel.winner} gewinnt das Duell, aber Team ${duel.loser} hat keinen Joker.`;
      } else {
        result.info = `🎲 Team ${duel.loser} gibt Team ${duel.winner} den Joker ${duel.transfer.jokerId}.`;
      }
      break;
    }
    case 'lose_one_point': {
      const score = adjustGoalPointsServer(snapshot, team, -1);
      result.info = `➖ Team ${team} verliert 1 Zielpunkt. Stand: ${score}/${snapshot.goalToWin || 10}`;
      break;
    }
    case 'gain_one_point': {
      const score = adjustGoalPointsServer(snapshot, team, 1);
      result.info = `➕ Team ${team} erhält 1 Zielpunkt. Stand: ${score}/${snapshot.goalToWin || 10}`;
      break;
    }
    case 'gain_two_points': {
      const score = adjustGoalPointsServer(snapshot, team, 2);
      result.info = `✨ Team ${team} erhält 2 Zielpunkte. Stand: ${score}/${snapshot.goalToWin || 10}`;
      break;
    }
    case 'point_transfer_most_to_least': {
      const transfer = applyMostToLeastPointTransferServer(snapshot, playerCount);
      if (!transfer.ok) result.info = '⚖️ Punktetausch konnte nicht ausgeführt werden.';
      else result.info = `⚖️ Team ${transfer.donor} gibt Team ${transfer.receiver} 1 Zielpunkt.`;
      break;
    }
    case 'shuffle_pieces': {
      const shuffled = shufflePiecesServer(snapshot);
      result.info = shuffled.moved > 0 ? `🌀 ${shuffled.moved} Figuren wurden neu gemischt.` : '🌀 Es gab nicht genug Figuren zum Mischen.';
      break;
    }
    case 'back_to_start': {
      const moved = sendTeamPiecesToStartServer(snapshot, team).moved;
      result.info = `🏁 Team ${team} muss mit ${moved} Figuren zurück zum Start.`;
      break;
    }
    case 'others_to_start': {
      const moved = sendOtherTeamsToStartServer(snapshot, team).moved;
      result.info = `🏁 Die anderen Teams müssen mit ${moved} Figuren zurück zum Start.`;
      break;
    }
    case 'steal_one_point': {
      const steal = stealOnePointServer(snapshot, team, playerCount);
      result.info = steal.ok ? `🪙 Team ${team} klaut Team ${steal.victim} 1 Zielpunkt.` : '🪙 Kein Gegner hatte einen Zielpunkt zum Klauen.';
      break;
    }
    case 'sprint_5': {
      return makeServerKeepTurnChoosePieceResult(5, `🏃 Team ${team} darf sofort 5 Felder laufen.`);
    }
    case 'sprint_10': {
      return makeServerKeepTurnChoosePieceResult(10, `🏃 Team ${team} darf sofort 10 Felder laufen.`);
    }
    case 'spawn_bonus_light': {
      const nodeId = spawnBonusLightServer(snapshot);
      result.info = nodeId ? `✨ Ein Lichtfeld erscheint auf ${nodeId}.` : '✨ Es konnte kein Lichtfeld gespawnt werden.';
      break;
    }
    default: {
      result.info = 'Ereignis ausgelöst.';
      break;
    }
  }

  return result;
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

function resolvePostLandingServer(snapshot, landedNodeId, team) {
  let info = null;
  let eventCard = null;
  let eventResult = null;

  if (!landedNodeId) return { info, eventCard, eventResult };

  const blockedByBarricade = Array.isArray(snapshot?.barricades) && snapshot.barricades.includes(landedNodeId);
  const blockedByGuardian = bossBlocksGoalServer(snapshot, landedNodeId);

  if (!blockedByBarricade && !blockedByGuardian) {
    if (snapshot.bonusLightNodeId && landedNodeId === snapshot.bonusLightNodeId) {
      const score = awardGoalPointsServer(snapshot, team, 1);
      snapshot.bonusLightNodeId = null;
      info = `✨ Team ${team} sammelt das Lichtfeld! Stand: ${score}/${snapshot.goalToWin || 10}`;
    } else if (snapshot.bonusGoalNodeId && landedNodeId === snapshot.bonusGoalNodeId) {
      const value = Number(snapshot.bonusGoalValue || 2);
      const score = awardGoalPointsServer(snapshot, team, value);
      snapshot.bonusGoalNodeId = null;
      info = `🌟 Team ${team} sammelt das Doppel-Zielfeld! +${value}. Stand: ${score}/${snapshot.goalToWin || 10}`;
    } else if (snapshot.goalNodeId && landedNodeId === snapshot.goalNodeId) {
      const score = awardGoalPointsServer(snapshot, team, 1);
      snapshot.goalNodeId = respawnGoalNodeServer(snapshot, landedNodeId);
      info = `🎯 Team ${team} sammelt einen Zielpunkt! Stand: ${score}/${snapshot.goalToWin || 10}`;
    }
  }

  const eventActive = new Set(Array.isArray(snapshot.eventActive) ? snapshot.eventActive : []);
  const eventTriggered = !snapshot.gameOver && (SERVER_FORCE_EVENT_EVERY_LANDING || eventActive.has(landedNodeId));
  if (eventTriggered) {
    eventCard = pickServerEventCard();
    if (eventActive.has(landedNodeId)) {
      relocateEventFieldServer(snapshot, landedNodeId);
    }
    eventResult = applyServerEventEffect(snapshot, eventCard, team, Array.isArray(snapshot?.pieces) ? Math.max(1, ...snapshot.pieces.map((p) => Number(p?.team || 0)), 1) : 4);
    if (eventResult?.info) info = `${info || ''} ${eventResult.info}`.trim();
  }

  return { info, eventCard, eventResult };
}

function resolveMoveServer(room, actor, requestId) {
  const snap = cloneSnapshot(room?.gameState?.snapshot);
  const move = room?.gameState?.lastMove || null;
  if (!snap || !move) return;
  ensureBossRuntimeServer(snap);
  ensureJokerStateServer(snap);
  snap.jokerFlags.double = false;

  const currentTurnIndex = clampTurnIndex(room, room.gameState?.turnIndex ?? 0);
  const movedPiece = Array.isArray(snap.pieces) ? snap.pieces.find((p) => String(p?.id || '') === String(move.pieceId || '')) : null;

  let info = `${actor?.name || 'Spieler'} hat gezogen.`;
  let eventCard = null;
  let eventResult = null;

  if (movedPiece && movedPiece.node) {
    const landedNodeId = movedPiece.node;
    const team = Number(movedPiece.team || (currentTurnIndex + 1));

    const bossInfo = maybeDefeatBossAtNodeServer(snap, landedNodeId, team);
    if (bossInfo) info = bossInfo;

    const barricades = new Set(Array.isArray(snap.barricades) ? snap.barricades : []);
    if (barricades.has(landedNodeId)) {
      snap.barricades = Array.from(barricades).filter((id) => id !== landedNodeId);
      if (!snap.carry || typeof snap.carry !== 'object') snap.carry = { 1: 0, 2: 0, 3: 0, 4: 0 };
      snap.carry[team] = Number(snap.carry[team] || 0) + 1;
      snap.pendingBarricadePlacement = {
        pieceId: movedPiece.id,
        landedNodeId,
        team,
      };
      snap.turnIndex = currentTurnIndex;
      snap.phase = 'placeBarricade';
      snap.roll = Number(room.gameState?.lastRoll || 0);
      room.gameState.snapshot = snap;
      room.gameState.phase = 'placeBarricade';
      room.gameState.turnIndex = currentTurnIndex;
      const pickupInfo = `🧱 Team ${team} nimmt eine Barrikade auf und muss sie neu platzieren.`;
      broadcastRoom(room, 'game_turn_state', {
        room: publicRoomState(room),
        gameState: room.gameState,
        requestId,
        info: pickupInfo,
      });
      return;
    }

    const landing = resolvePostLandingServer(snap, landedNodeId, team);
    if (landing.info) info = `${info !== `${actor?.name || 'Spieler'} hat gezogen.` ? info : ''} ${landing.info}`.trim();
    eventCard = landing.eventCard;
    eventResult = landing.eventResult;
  }

  if (snap.gameOver) {
    snap.turnIndex = currentTurnIndex;
    snap.roll = 0;
    snap.phase = 'gameOver';
    room.gameState.snapshot = snap;
    room.gameState.phase = 'gameOver';
    room.gameState.turnIndex = currentTurnIndex;
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
        info,
      });
    }
    broadcastRoom(room, 'game_turn_state', {
      room: publicRoomState(room),
      gameState: room.gameState,
      requestId,
      info: `🏆 Team ${snap.winnerTeam || (currentTurnIndex + 1)} gewinnt!`,
    });
    return;
  }

  finalizeTurnAfterBossServer(room, snap, currentTurnIndex, requestId, info, eventCard, eventResult);
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

function makeSessionToken() {
  return `s_${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 12)}`;
}

function publicRoomState(room) {
  return {
    roomCode: room.roomCode,
    status: room.status,
    createdAt: room.createdAt,
    hostId: room.hostId,
    playerCount: room.players.length,
    players: room.players.map((p, idx) => ({
      id: p.id,
      name: p.name,
      isHost: p.isHost,
      connected: p.connected,
      joinedAt: p.joinedAt,
      slotIndex: Number.isFinite(Number(p.slotIndex)) ? Number(p.slotIndex) : idx,
      team: (Number.isFinite(Number(p.slotIndex)) ? Number(p.slotIndex) : idx) + 1,
    })),
    gameState: room.gameState,
  };
}

function normalizeRoomSlots(room) {
  if (!room || !Array.isArray(room.players)) return;
  const used = new Set();
  room.players.forEach((p, idx) => {
    const raw = Number(p?.slotIndex);
    if (Number.isInteger(raw) && raw >= 0 && raw < MAX_PLAYERS && !used.has(raw)) {
      used.add(raw);
      p.slotIndex = raw;
      return;
    }
    let next = 0;
    while (used.has(next) && next < MAX_PLAYERS) next += 1;
    p.slotIndex = next;
    used.add(next);
  });
}

function getNextFreeSlotIndex(room) {
  normalizeRoomSlots(room);
  const used = new Set((room?.players || []).map((p) => Number(p?.slotIndex)).filter((n) => Number.isInteger(n) && n >= 0));
  for (let i = 0; i < MAX_PLAYERS; i += 1) {
    if (!used.has(i)) return i;
  }
  return -1;
}

function findPlayerBySlot(room, slotIndex) {
  return (room?.players || []).find((p) => Number(p?.slotIndex) === Number(slotIndex)) || null;
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

function ensureRoomHost(room) {
  if (!room || !Array.isArray(room.players)) return;
  let host = room.players.find((p) => p && p.isHost) || null;
  if (host) {
    room.hostId = host.id;
    return;
  }
  host = room.players[0] || null;
  if (!host) {
    room.hostId = null;
    return;
  }
  host.isHost = true;
  room.hostId = host.id;
}

function removeWaitingPlayer(room, playerId) {
  if (!room || !Array.isArray(room.players) || !playerId) return null;
  const idx = room.players.findIndex((p) => p && p.id === playerId);
  if (idx < 0) return null;
  const [removed] = room.players.splice(idx, 1);
  if (removed?.socket) {
    socketMeta.delete(removed.socket);
    try { removed.socket.close(4002, 'Removed stale waiting player'); } catch (_err) { }
  }
  if (removed?.isHost || room.hostId === playerId) {
    ensureRoomHost(room);
  }
  return removed || null;
}

function replacePlayerSocket(existing, ws, roomCode) {
  if (!existing) return;
  const oldSocket = existing.socket;
  if (oldSocket && oldSocket !== ws) {
    socketMeta.delete(oldSocket);
    try { oldSocket.close(4001, 'Replaced by reconnect'); } catch (_err) { }
  }
  existing.connected = true;
  existing.socket = ws;
  existing.lastSeenAt = new Date().toISOString();
  socketMeta.set(ws, { playerId: existing.id, roomCode });
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
      sessionToken: makeSessionToken(),
      name,
      slotIndex: 0,
      isHost: true,
      connected: true,
      joinedAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
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

  const self = room.players[0];
  send(ws, 'room_created', {
    room: publicRoomState(room),
    self: { playerId, sessionToken: self.sessionToken, name, isHost: true, slotIndex: Number(self.slotIndex || 0), team: Number(self.slotIndex || 0) + 1 },
  });

  console.log(`[ROOM] created ${roomCode} by ${name} (${playerId})`);
}

function handleJoinRoom(ws, msg) {
  const roomCode = String(msg.roomCode || '').trim().toUpperCase();
  const name = String(msg.name || '').trim() || 'Spieler';
  const requestedPlayerId = String(msg.playerId || '').trim();
  const requestedSessionToken = String(msg.sessionToken || '').trim();
  const requestedSlotIndexRaw = Number(msg.slotIndex);
  const requestedSlotIndex = Number.isInteger(requestedSlotIndexRaw) && requestedSlotIndexRaw >= 0 && requestedSlotIndexRaw < MAX_PLAYERS
    ? requestedSlotIndexRaw
    : null;

  if (!roomCode || !rooms.has(roomCode)) {
    send(ws, 'error_message', { message: 'Raum nicht gefunden.' });
    return;
  }

  const room = rooms.get(roomCode);
  normalizeRoomSlots(room);
  let existing = null;
  let fallbackFreshJoin = false;
  let runningNameRecovery = false;
  let recoveredBySlot = false;

  const disconnectedSameName = room.players.filter((p) => p && p.name === name && !p.connected);
  const connectedSameName = room.players.filter((p) => p && p.name === name && p.connected);
  const uniqueDisconnectedSameName = (disconnectedSameName.length === 1 && connectedSameName.length === 0)
    ? disconnectedSameName[0]
    : null;

  if (requestedPlayerId) {
    existing = room.players.find((p) => p.id === requestedPlayerId) || null;

    if (existing && existing.sessionToken && existing.sessionToken !== requestedSessionToken) {
      const waitingRecoveryAllowed = room.status === 'waiting' && !existing.connected;
      const runningRecoveryAllowed = room.status !== 'waiting' && !existing.connected && existing.name === name;
      if (waitingRecoveryAllowed) {
        console.warn(`[ROOM] stale waiting reconnect replaced in ${roomCode} (${existing.id})`);
        removeWaitingPlayer(room, existing.id);
        existing = null;
        fallbackFreshJoin = true;
      } else if (runningRecoveryAllowed) {
        console.warn(`[ROOM] running reconnect recovered by exact player/name in ${roomCode} (${existing.id})`);
        existing.sessionToken = makeSessionToken();
        runningNameRecovery = true;
      } else {
        send(ws, 'error_message', { message: 'Reconnect abgelehnt. Spieler-ID oder Session ungültig.' });
        return;
      }
    }
  }

  if (!existing && requestedSlotIndex != null) {
    const slotPlayer = findPlayerBySlot(room, requestedSlotIndex);
    if (slotPlayer && !slotPlayer.connected && slotPlayer.name === name) {
      existing = slotPlayer;
      if (!existing.sessionToken) existing.sessionToken = makeSessionToken();
      runningNameRecovery = true;
      recoveredBySlot = true;
      console.warn(`[ROOM] running reconnect recovered by slot ${requestedSlotIndex + 1} in ${roomCode} (${existing.id})`);
    }
  }

  if (!existing && uniqueDisconnectedSameName) {
    if (room.status === 'waiting' && !requestedPlayerId) {
      existing = uniqueDisconnectedSameName;
    } else if (room.status !== 'waiting' && (!requestedPlayerId || !room.players.some((p) => p.id === requestedPlayerId))) {
      existing = uniqueDisconnectedSameName;
      if (!existing.sessionToken) existing.sessionToken = makeSessionToken();
      runningNameRecovery = true;
      console.warn(`[ROOM] running reconnect recovered by unique disconnected name in ${roomCode} (${existing.id})`);
    }
  }

  if (existing) {
    if (!existing.sessionToken) existing.sessionToken = makeSessionToken();
    replacePlayerSocket(existing, ws, roomCode);
    cleanupRoomIfEmpty(roomCode);

    const selfPayload = {
      playerId: existing.id,
      sessionToken: existing.sessionToken,
      name: existing.name,
      isHost: !!existing.isHost,
      slotIndex: Number(existing.slotIndex || 0),
      team: Number(existing.slotIndex || 0) + 1,
    };

    send(ws, 'room_joined', {
      room: publicRoomState(room),
      self: selfPayload,
      reconnect: true,
      recoveredByName: runningNameRecovery,
      recoveredBySlot,
    });

    send(ws, 'room_state', {
      room: publicRoomState(room),
      info: runningNameRecovery
        ? `${existing.name} ist mit neuer Sitzung wieder verbunden.`
        : `${existing.name} ist wieder verbunden.`,
      reconnect: true,
      recoveredByName: runningNameRecovery,
      recoveredBySlot,
      self: selfPayload,
    });

    broadcastRoom(room, 'room_state', {
      info: runningNameRecovery
        ? `${existing.name} ist mit neuer Sitzung wieder verbunden.`
        : `${existing.name} ist wieder verbunden.`,
    });
    console.log(`[ROOM] ${existing.name} reconnected ${roomCode} (${existing.id}) slot=${Number(existing.slotIndex || 0) + 1}${runningNameRecovery ? ' [name-recovery]' : ''}${recoveredBySlot ? ' [slot-recovery]' : ''}`);
    return;
  }

  if (room.status !== 'waiting') {
    send(ws, 'error_message', { message: 'Spiel läuft bereits. Reconnect nur mit gespeicherter Spieler-ID, Name oder reserviertem Slot.' });
    return;
  }

  ensureRoomHost(room);
  normalizeRoomSlots(room);

  if (room.players.length >= MAX_PLAYERS) {
    send(ws, 'error_message', { message: 'Raum ist voll.' });
    return;
  }

  let slotIndex = requestedSlotIndex;
  if (slotIndex == null || findPlayerBySlot(room, slotIndex)) {
    slotIndex = getNextFreeSlotIndex(room);
  }
  if (slotIndex < 0) {
    send(ws, 'error_message', { message: 'Kein freier Team-Slot mehr.' });
    return;
  }

  const playerId = makePlayerId();
  const sessionToken = makeSessionToken();
  const shouldBecomeHost = !room.players.some((p) => p && p.isHost);
  room.players.push({
    id: playerId,
    sessionToken,
    name,
    slotIndex,
    isHost: shouldBecomeHost,
    connected: true,
    joinedAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    socket: ws,
  });
  normalizeRoomSlots(room);
  if (shouldBecomeHost) room.hostId = playerId;

  socketMeta.set(ws, { playerId, roomCode });
  cleanupRoomIfEmpty(roomCode);

  send(ws, 'room_joined', {
    room: publicRoomState(room),
    self: { playerId, sessionToken, name, isHost: shouldBecomeHost, slotIndex, team: slotIndex + 1 },
    reconnect: false,
    freshJoinAfterInvalidSession: fallbackFreshJoin,
  });

  const joinInfo = fallbackFreshJoin
    ? `${name} ist mit neuer Sitzung auf Team ${slotIndex + 1} beigetreten.`
    : `${name} ist Team ${slotIndex + 1} beigetreten.`;
  broadcastRoom(room, 'room_state', { info: joinInfo });
  console.log(`[ROOM] ${name} joined ${roomCode} (${playerId}) slot=${slotIndex + 1}${fallbackFreshJoin ? ' [fresh-after-invalid-session]' : ''}`);
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
  broadcastRoom(room, 'game_turn_state', {
    gameState: room.gameState,
    info: `Team 1 ist dran: Würfeln.`,
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
  const self = findPlayer(room, meta.playerId);
  send(ws, 'room_state', {
    room: publicRoomState(room),
    self: self ? { playerId: self.id, sessionToken: self.sessionToken || null, name: self.name, isHost: !!self.isHost, slotIndex: Number(self.slotIndex || 0), team: Number(self.slotIndex || 0) + 1 } : null,
  });
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

    const snap = room.gameState?.snapshot || null;
    ensureJokerStateServer(snap);
    const a = randomDie();
    const wantsDouble = !!snap?.jokerFlags?.double;
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
      ensureJokerStateServer(room.gameState.snapshot);
      room.gameState.snapshot.turnIndex = currentTurnIndex;
      room.gameState.snapshot.phase = 'choosePiece';
      room.gameState.snapshot.roll = value;
      room.gameState.snapshot.jokerFlags.double = false;
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
    const clientSnapshot = msg.stateSnapshot && typeof msg.stateSnapshot === 'object' ? msg.stateSnapshot : null;
    const serverSnapshot = cloneSnapshot(room.gameState?.snapshot);
    const snapshot = serverSnapshot || clientSnapshot || null;
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
      const clientPiece = Array.isArray(clientSnapshot?.pieces) ? clientSnapshot.pieces.find((p) => String(p?.id || '') === pieceId) : null;
      sendTrace(ws, 'move_request.snapshot_info', {
        requestId,
        snapshotSource: serverSnapshot ? 'server' : (clientSnapshot ? 'client' : 'none'),
        snapshotPhase: snapshot?.phase || null,
        snapshotRoll: Number(snapshot?.roll || 0),
        snapshotTurnIndex: Number(snapshot?.turnIndex || 0),
        pieceFound: !!piece,
        pieceTeam: Number(piece?.team || 0),
        pieceNode: piece?.node || null,
        clientPieceNode: clientPiece?.node || null,
        serverPieceNode: piece?.node || null,
      });
      if (!piece) {
        sendTrace(ws, 'move_request.reject', { requestId, reason: 'piece_not_found_in_snapshot', pieceId });
        send(ws, 'error_message', { message: 'Figur nicht gefunden.' });
        return;
      }
      ensureJokerStateServer(snapshot);
      const canUseAllColors = !!snapshot?.jokerFlags?.allcolors;
      if (Number(piece.team || 0) !== turnTeam && !canUseAllColors) {
        sendTrace(ws, 'move_request.reject', { requestId, reason: 'piece_team_mismatch', turnTeam, pieceTeam: Number(piece.team || 0), allcolors: canUseAllColors });
        send(ws, 'error_message', { message: 'Du darfst nur deine eigene Figur bewegen.' });
        return;
      }
      const roll = Number(room.gameState?.lastRoll || 0);
      if (clientSnapshot && Number(clientSnapshot.roll || 0) !== roll) {
        sendTrace(ws, 'move_request.client_roll_mismatch', {
          requestId,
          clientRoll: Number(clientSnapshot.roll || 0),
          serverRoll: roll,
        });
      }
      if (!roll) {
        sendTrace(ws, 'move_request.reject', { requestId, reason: 'missing_server_roll', serverRoll: roll });
        send(ws, 'error_message', { message: 'Kein gültiger Serverwurf aktiv.' });
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

    const baseSnapshot = serverSnapshot || room.gameState?.snapshot || snapshot || null;
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



  if (action === 'joker_use') {
    if (room.status !== 'running' || !room.gameState?.started || !room.gameState?.snapshot) {
      send(ws, 'error_message', { message: 'Spiel läuft noch nicht.' });
      return;
    }
    if (!currentPlayer || currentPlayer.id !== self.id) {
      send(ws, 'error_message', { message: 'Du bist gerade nicht am Zug.' });
      return;
    }

    const snap = cloneSnapshot(room.gameState.snapshot);
    ensureJokerStateServer(snap);
    ensureBossRuntimeServer(snap);
    const team = currentTurnIndex + 1;
    const jokerId = String(msg.jokerId || msg.joker || '').trim();
    const phase = sanitizePhase(room.gameState?.phase);
    let info = '';

    if (!SERVER_JOKER_IDS.includes(jokerId)) {
      send(ws, 'error_message', { message: 'Unbekannter Joker.' });
      return;
    }
    if (jokerCountServer(snap, team, jokerId) <= 0) {
      send(ws, 'error_message', { message: 'Diesen Joker besitzt dein Team nicht mehr.' });
      return;
    }

    const isBeforeRoll = phase === 'needRoll' && Number(snap.roll || 0) === 0;
    const isAfterRoll = ['choosePiece', 'chooseTarget'].includes(phase) && Number(room.gameState?.lastRoll || snap.roll || 0) > 0;

    if (jokerId === 'double') {
      if (!isBeforeRoll) {
        send(ws, 'error_message', { message: 'Doppelwurf geht nur vor dem Wurf.' });
        return;
      }
      if (!consumeJokerServer(snap, team, jokerId)) {
        send(ws, 'error_message', { message: 'Doppelwurf nicht verfügbar.' });
        return;
      }
      snap.jokerFlags.double = true;
      info = `🎲 Team ${team} aktiviert Doppelwurf.`;
    } else if (jokerId === 'reroll') {
      if (!isAfterRoll) {
        send(ws, 'error_message', { message: 'Neuwurf geht nur nach einem Wurf.' });
        return;
      }
      if (!consumeJokerServer(snap, team, jokerId)) {
        send(ws, 'error_message', { message: 'Neuwurf nicht verfügbar.' });
        return;
      }
      const a = randomDie();
      const b = !!snap.jokerFlags.double ? randomDie() : null;
      const value = b ? (a + b) : a;
      snap.roll = value;
      snap.phase = 'choosePiece';
      snap.turnIndex = currentTurnIndex;
      snap.jokerFlags.double = false;
      room.gameState.snapshot = snap;
      room.gameState.phase = 'choosePiece';
      room.gameState.turnIndex = currentTurnIndex;
      room.gameState.lastRoll = value;
      room.gameState.lastRollAt = new Date().toISOString();
      room.gameState.lastRollBy = self.id;
      room.gameState.lastRollMeta = {
        value,
        parts: b ? [a, b] : [a],
        double: !!b,
        byPlayerId: self.id,
        byName: self.name,
        turnIndex: currentTurnIndex,
        team,
        reason: 'joker_reroll',
        at: room.gameState.lastRollAt,
      };
      broadcastRoom(room, 'game_roll', {
        room: publicRoomState(room),
        roll: room.gameState.lastRollMeta,
        requestId,
        info: `🎲 Team ${team} nutzt Neuwurf und würfelt ${value}.`,
      });
      return;
    } else if (jokerId === 'allcolors') {
      if (!isAfterRoll) {
        send(ws, 'error_message', { message: 'Alle Farben geht nur nach dem Wurf.' });
        return;
      }
      if (!consumeJokerServer(snap, team, jokerId)) {
        send(ws, 'error_message', { message: 'Alle Farben nicht verfügbar.' });
        return;
      }
      snap.jokerFlags.allcolors = true;
      info = `🌈 Team ${team} darf in diesem Zug jede Figur wählen.`;
    } else if (jokerId === 'shield') {
      if (!isAfterRoll) {
        send(ws, 'error_message', { message: 'Schutzschild geht nur nach dem Wurf.' });
        return;
      }
      const pieceId = String(msg.pieceId || '').trim();
      const piece = Array.isArray(snap.pieces) ? snap.pieces.find((p) => String(p?.id || '') === pieceId) : null;
      if (!piece || Number(piece.team || 0) !== team) {
        send(ws, 'error_message', { message: 'Wähle eine eigene Figur für das Schutzschild.' });
        return;
      }
      if (!consumeJokerServer(snap, team, jokerId)) {
        send(ws, 'error_message', { message: 'Schutzschild nicht verfügbar.' });
        return;
      }
      piece.shielded = true;
      info = `🛡 Team ${team} schützt eine Figur.`;
    } else if (jokerId === 'swap') {
      if (!isBeforeRoll) {
        send(ws, 'error_message', { message: 'Spieler tauschen geht nur vor dem Wurf.' });
        return;
      }
      const pieceAId = String(msg.pieceAId || msg.aId || '').trim();
      const pieceBId = String(msg.pieceBId || msg.bId || '').trim();
      const pieceA = Array.isArray(snap.pieces) ? snap.pieces.find((p) => String(p?.id || '') === pieceAId) : null;
      const pieceB = Array.isArray(snap.pieces) ? snap.pieces.find((p) => String(p?.id || '') === pieceBId) : null;
      if (!pieceA || !pieceB || !pieceA.node || !pieceB.node || pieceA.id === pieceB.id) {
        send(ws, 'error_message', { message: 'Diese Figuren können nicht getauscht werden.' });
        return;
      }
      if (!consumeJokerServer(snap, team, jokerId)) {
        send(ws, 'error_message', { message: 'Tausch-Joker nicht verfügbar.' });
        return;
      }
      const aNode = pieceA.node;
      pieceA.node = pieceB.node;
      pieceB.node = aNode;
      pieceA.prev = null;
      pieceB.prev = null;
      info = `🔄 Team ${team} tauscht zwei Figuren.`;
    } else if (jokerId === 'moveBarricade') {
      if (!isBeforeRoll) {
        send(ws, 'error_message', { message: 'Barrikade versetzen geht nur vor dem Wurf.' });
        return;
      }
      const fromNodeId = String(msg.fromNodeId || '').trim();
      const toNodeId = String(msg.toNodeId || '').trim();
      const hasBarricade = Array.isArray(snap.barricades) && snap.barricades.includes(fromNodeId);
      if (!hasBarricade) {
        send(ws, 'error_message', { message: 'Wähle eine vorhandene Barrikade.' });
        return;
      }
      const nextSnap = cloneSnapshot(snap);
      nextSnap.barricades = Array.isArray(nextSnap.barricades) ? nextSnap.barricades.filter((id) => id !== fromNodeId) : [];
      if (!isFreeBarricadeNodeServer(nextSnap, toNodeId)) {
        send(ws, 'error_message', { message: 'Dieses Zielfeld ist für die Barrikade nicht erlaubt.' });
        return;
      }
      if (!consumeJokerServer(nextSnap, team, jokerId)) {
        send(ws, 'error_message', { message: 'Barrikaden-Joker nicht verfügbar.' });
        return;
      }
      nextSnap.barricades.push(toNodeId);
      room.gameState.snapshot = nextSnap;
      normalizeTurnSnapshotServer(room, room.gameState.snapshot, currentTurnIndex, phase);
      broadcastRoom(room, 'game_turn_state', {
        room: publicRoomState(room),
        gameState: room.gameState,
        requestId,
        info: `🧱 Team ${team} versetzt eine Barrikade.`,
      });
      return;
    }

    room.gameState.snapshot = snap;
    normalizeTurnSnapshotServer(room, room.gameState.snapshot, currentTurnIndex, phase);
    room.gameState.phase = room.gameState.snapshot.phase;
    room.gameState.turnIndex = currentTurnIndex;

    broadcastRoom(room, 'game_turn_state', {
      room: publicRoomState(room),
      gameState: room.gameState,
      requestId,
      info,
    });
    return;
  }

  if (action === 'boss_spawn_debug') {
    if (room.status !== 'running' || !room.gameState?.started || !room.gameState?.snapshot) {
      send(ws, 'error_message', { message: 'Spiel läuft noch nicht.' });
      return;
    }
    const snap = cloneSnapshot(room.gameState.snapshot);
    ensureBossRuntimeServer(snap);
    const spawned = spawnBossByTypeServer(snap, msg.bossType || null);
    room.gameState.snapshot = snap;
    broadcastRoom(room, 'game_turn_state', {
      room: publicRoomState(room),
      gameState: room.gameState,
      requestId,
      info: spawned?.ok ? `👹 ${spawned.boss?.name || 'Ein Boss'} erscheint.` : '👹 Kein Boss konnte erscheinen.',
    });
    return;
  }

  if (action === 'boss_step_debug') {
    if (room.status !== 'running' || !room.gameState?.started || !room.gameState?.snapshot) {
      send(ws, 'error_message', { message: 'Spiel läuft noch nicht.' });
      return;
    }
    const snap = cloneSnapshot(room.gameState.snapshot);
    ensureBossRuntimeServer(snap);
    const bossPhase = runBossPhaseServer(snap, {
      playerCount: room.players.length,
      roundEnd: true,
      forceAll: true,
    });
    room.gameState.snapshot = snap;
    broadcastRoom(room, 'game_turn_state', {
      room: publicRoomState(room),
      gameState: room.gameState,
      requestId,
      info: bossPhase.info || '👹 Boss-Step ausgeführt.',
    });
    return;
  }

  if (action === 'boss_clear_debug') {
    if (room.status !== 'running' || !room.gameState?.started || !room.gameState?.snapshot) {
      send(ws, 'error_message', { message: 'Spiel läuft noch nicht.' });
      return;
    }
    const snap = cloneSnapshot(room.gameState.snapshot);
    snap.bosses = [];
    room.gameState.snapshot = snap;
    broadcastRoom(room, 'game_turn_state', {
      room: publicRoomState(room),
      gameState: room.gameState,
      requestId,
      info: '👹 Alle Bosse wurden entfernt.',
    });
    return;
  }

  if (action === 'place_barricade') {
    if (room.status !== 'running' || !room.gameState?.started) {
      send(ws, 'error_message', { message: 'Spiel läuft noch nicht.' });
      return;
    }
    if (!currentPlayer || currentPlayer.id !== self.id) {
      send(ws, 'error_message', { message: 'Nur der aktuelle Spieler darf die Barrikade platzieren.' });
      return;
    }
    if (sanitizePhase(room.gameState?.phase) !== 'placeBarricade') {
      send(ws, 'error_message', { message: 'Gerade wird keine Barrikade platziert.' });
      return;
    }

    const snap = cloneSnapshot(room.gameState?.snapshot);
    const pending = snap?.pendingBarricadePlacement || null;
    const team = currentTurnIndex + 1;
    const nodeId = String(msg.nodeId || '').trim();

    if (!snap || !pending || Number(pending.team || 0) !== team) {
      send(ws, 'error_message', { message: 'Keine ausstehende Barrikaden-Platzierung gefunden.' });
      return;
    }
    if (!nodeId || !isFreeBarricadeNodeServer(snap, nodeId)) {
      send(ws, 'error_message', { message: 'Dieses Feld ist für die Barrikade nicht erlaubt.' });
      return;
    }
    if (!snap.carry || Number(snap.carry[team] || 0) <= 0) {
      send(ws, 'error_message', { message: 'Dein Team trägt gerade keine Barrikade.' });
      return;
    }

    snap.barricades = Array.isArray(snap.barricades) ? snap.barricades.slice() : [];
    snap.barricades.push(nodeId);
    snap.carry[team] = Math.max(0, Number(snap.carry[team] || 0) - 1);
    delete snap.pendingBarricadePlacement;

    const landing = resolvePostLandingServer(snap, pending.landedNodeId || null, team);
    let info = `🧱 Team ${team} platziert die Barrikade neu.`;
    if (landing.info) info = `${info} ${landing.info}`.trim();

    if (snap.gameOver) {
      snap.turnIndex = currentTurnIndex;
      snap.roll = 0;
      snap.phase = 'gameOver';
      room.gameState.snapshot = snap;
      room.gameState.phase = 'gameOver';
      room.gameState.turnIndex = currentTurnIndex;
      room.gameState.lastMove = null;
      room.gameState.lastRoll = null;
      room.gameState.lastRollAt = null;
      room.gameState.lastRollBy = null;
      room.gameState.lastRollMeta = null;
      if (landing.eventCard) {
        broadcastRoom(room, 'event_card', {
          room: publicRoomState(room),
          requestId,
          card: landing.eventCard,
          info,
        });
      }
      broadcastRoom(room, 'game_turn_state', {
        room: publicRoomState(room),
        gameState: room.gameState,
        requestId,
        info: `🏆 Team ${snap.winnerTeam || team} gewinnt!`,
      });
      return;
    }

    finalizeTurnAfterBossServer(room, snap, currentTurnIndex, requestId, info, landing.eventCard, landing.eventResult);
    return;
  }

  if (action === 'finish_move') {
    send(ws, 'room_state', {
      room: publicRoomState(room),
      info: typeof msg.info === 'string' && msg.info.trim() ? msg.info.trim() : null,
    });
    return;
  }

  if (action === 'turn_update') {
    const self = findPlayer(room, meta.playerId);
  send(ws, 'room_state', {
    room: publicRoomState(room),
    self: self ? { playerId: self.id, sessionToken: self.sessionToken || null, name: self.name, isHost: !!self.isHost, slotIndex: Number(self.slotIndex || 0), team: Number(self.slotIndex || 0) + 1 } : null,
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
  player.lastSeenAt = new Date().toISOString();

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
    stabilityPatch: 'v10',
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
          send(ws, 'pong', { ts: Date.now(), echoTs: Number(msg.ts || 0) || null });
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
