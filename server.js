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
    bossTick: 0,
    bossRoundNum: 0,
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


function randomFrom(list) {
  return Array.isArray(list) && list.length ? list[Math.floor(Math.random() * list.length)] : null;
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

const SERVER_BOSS_TYPES = {
  hunter: { type: 'hunter', name: 'Der Jäger', moveEvery: 1, respectsShield: true },
  destroyer: { type: 'destroyer', name: 'Der Zerstörer', moveOnRoundEnd: true, stepsPerMove: 3, respectsShield: true },
  reaper: { type: 'reaper', name: 'Der Räuber', moveOnRoundEnd: true, stepsPerMove: 5, respectsShield: true },
  guardian: { type: 'guardian', name: 'Der Wächter', moveOnRoundEnd: true, stepsPerMove: 0, respectsShield: true },
  magnet: { type: 'magnet', name: 'Der Magnet', moveOnRoundEnd: true, stepsPerMove: 0, respectsShield: true },
};

function ensureBossStateServer(snapshot) {
  if (!Array.isArray(snapshot.bosses)) snapshot.bosses = [];
  if (typeof snapshot.bossIdSeq !== 'number') snapshot.bossIdSeq = 1;
  if (typeof snapshot.bossTick !== 'number') snapshot.bossTick = 0;
  if (typeof snapshot.bossRoundNum !== 'number') snapshot.bossRoundNum = 0;
}

function spawnRandomBossServer(snapshot) {
  if (!boardAuthority.enabled || !snapshot) return { ok: false, reason: 'no_snapshot' };
  ensureBossStateServer(snapshot);
  const alive = snapshot.bosses.filter((b) => b && b.alive !== false);
  if (alive.length >= 2) return { ok: false, reason: 'max_active' };

  const bossTypes = Object.values(SERVER_BOSS_TYPES);
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
    meta: {
      moveEvery: Number(bossDef.moveEvery || 1),
      respectsShield: bossDef.respectsShield !== false,
    },
  };
  snapshot.bosses.push(boss);
  return { ok: true, boss };
}


function getTeamPieceNodesServer(snapshot, team) {
  return Array.isArray(snapshot?.pieces) ? snapshot.pieces.filter((p) => p && p.node && Number(p.team || 0) === Number(team || 0)).map((p) => p.node) : [];
}

function leadingTeamServer(snapshot) {
  const scores = Object.assign({ 1: 0, 2: 0, 3: 0, 4: 0 }, snapshot?.goalScores || {});
  let bestTeam = 1;
  let bestScore = -1;
  for (const team of [1, 2, 3, 4]) {
    const sc = Number(scores[team] || 0);
    if (sc > bestScore) {
      bestScore = sc;
      bestTeam = team;
    }
  }
  return bestTeam;
}

function kickPieceToStartServer(snapshot, piece) {
  if (!snapshot || !piece) return false;
  const starts = getStartNodesForTeam(piece.team);
  const freeStart = starts.find((id) => !snapshot.pieces.some((p) => p && p.id !== piece.id && p.node === id)) || starts[0] || null;
  piece.prev = piece.node || null;
  piece.node = freeStart;
  piece.shielded = false;
  return !!freeStart;
}

function teleportBossRandomFreeServer(snapshot, boss, fromNodeId, minDist = 0, byTeam = null) {
  if (!snapshot || !boss || boss.alive === false) return false;
  const teamNodes = byTeam ? getTeamPieceNodesServer(snapshot, byTeam) : [];
  const candidates = [];
  for (const node of boardAuthority.nodesById.values()) {
    const id = node?.id;
    if (!id || id === fromNodeId) continue;
    if (node.type === 'start') continue;
    if (isOccupiedNodeServer(snapshot, id)) continue;
    if (Array.isArray(snapshot?.barricades) && snapshot.barricades.includes(id)) continue;
    if (snapshot.bosses.some((b) => b && b.alive !== false && b.id !== boss.id && b.node === id)) continue;
    candidates.push(id);
  }
  if (!candidates.length) return false;

  const bfsDistances = (startId) => {
    const dist = new Map([[startId, 0]]);
    const q = [startId];
    while (q.length) {
      const cur = q.shift();
      const d = dist.get(cur);
      for (const nb of (boardAuthority.adj.get(cur) || [])) {
        const meta = boardAuthority.nodesById.get(nb);
        if (meta?.type === 'start') continue;
        if (dist.has(nb)) continue;
        dist.set(nb, d + 1);
        q.push(nb);
      }
    }
    return dist;
  };

  let pool = candidates;
  if (minDist > 0 && teamNodes.length) {
    const filtered = [];
    for (const cand of candidates) {
      const dist = bfsDistances(cand);
      let best = Infinity;
      for (const tnode of teamNodes) {
        const d = dist.get(tnode);
        if (typeof d === 'number' && d < best) best = d;
      }
      if (best >= minDist) filtered.push(cand);
    }
    if (filtered.length) pool = filtered;
  }

  boss.node = randomFrom(pool);
  return !!boss.node;
}

function maybeDefeatBossAtNodeServer(snapshot, nodeId, byTeam) {
  ensureBossStateServer(snapshot);
  const boss = snapshot.bosses.find((b) => b && b.alive !== false && b.node === nodeId);
  if (!boss) return { defeated: false, info: null };

  if (boss.type !== 'reaper') {
    boss.alive = false;
    boss.node = null;
    return { defeated: true, info: `⚔️ Team ${byTeam} besiegt ${boss.name || boss.type}.` };
  }

  boss.hits = Number(boss.hits || 0) + 1;
  if (boss.hits >= 2) {
    boss.alive = false;
    boss.node = null;
    return { defeated: true, info: `⚔️ Team ${byTeam} besiegt ${boss.name || boss.type}.` };
  }

  const ok = teleportBossRandomFreeServer(snapshot, boss, nodeId, 6, byTeam);
  return { defeated: true, info: ok ? `⚔️ Team ${byTeam} trifft ${boss.name || boss.type} (1/2) – Boss teleportiert.` : `⚔️ Team ${byTeam} trifft ${boss.name || boss.type} (1/2).` };
}

function bossBlockedServer(snapshot, nextId, boss) {
  const node = boardAuthority.nodesById.get(nextId);
  if (node?.type === 'start') return true;
  const occ = Array.isArray(snapshot?.pieces) ? snapshot.pieces.find((p) => p && p.node === nextId) : null;
  if (occ && occ.shielded) return true;
  return false;
}

function bfsNextStepServer(snapshot, startId, goalIds, boss) {
  if (!startId || !Array.isArray(goalIds) || !goalIds.length) return null;
  const goals = new Set(goalIds);
  if (goals.has(startId)) return startId;

  const q = [startId];
  const prev = new Map([[startId, null]]);
  while (q.length) {
    const cur = q.shift();
    for (const nb of (boardAuthority.adj.get(cur) || [])) {
      if (prev.has(nb)) continue;
      if (bossBlockedServer(snapshot, nb, boss)) continue;
      prev.set(nb, cur);
      if (goals.has(nb)) {
        let step = nb;
        let p = prev.get(step);
        while (p && p !== startId) {
          step = p;
          p = prev.get(step);
        }
        return step;
      }
      q.push(nb);
    }
  }
  return null;
}

function bossCollideAtServer(snapshot, nodeId, boss) {
  const piece = Array.isArray(snapshot?.pieces) ? snapshot.pieces.find((p) => p && p.node === nodeId) : null;
  if (!piece) return null;
  const respectsShield = boss?.meta?.respectsShield !== false;
  if (respectsShield && piece.shielded) return null;

  if (boss.type === 'reaper') {
    if (snapshot.goalNodeId && nodeId === snapshot.goalNodeId) {
      kickPieceToStartServer(snapshot, piece);
      return `👹 ${boss.name || 'Der Räuber'} wirft Team ${piece.team} vom Zielfeld auf Start.`;
    }
    return `👹 ${boss.name || 'Der Räuber'} bedroht Team ${piece.team}.`;
  }

  kickPieceToStartServer(snapshot, piece);
  return `👹 ${boss.name || 'Boss'} schickt Team ${piece.team} auf Start.`;
}

function moveBossOneStepServer(snapshot, boss, force = false) {
  if (!snapshot || !boss || boss.alive === false || !boss.node) return null;
  const def = SERVER_BOSS_TYPES[boss.type];
  if (!def) return null;

  const every = Number(boss?.meta?.moveEvery || def.moveEvery || 1);
  if (!force && every > 1 && (Number(snapshot.bossTick || 0) % every) !== 0) return null;

  let goalIds = [];
  if (boss.type === 'hunter') {
    const team = leadingTeamServer(snapshot);
    goalIds = getTeamPieceNodesServer(snapshot, team).filter((id) => boardAuthority.nodesById.get(id)?.type !== 'start');
    if (!goalIds.length) goalIds = (snapshot.pieces || []).filter((p) => p && p.node && boardAuthority.nodesById.get(p.node)?.type !== 'start').map((p) => p.node);
  } else if (boss.type === 'destroyer') {
    goalIds = Array.isArray(snapshot?.barricades) ? snapshot.barricades.filter((id) => boardAuthority.nodesById.get(id)?.type !== 'start') : [];
    if (!goalIds.length) {
      const team = leadingTeamServer(snapshot);
      goalIds = getTeamPieceNodesServer(snapshot, team).filter((id) => boardAuthority.nodesById.get(id)?.type !== 'start');
    }
  } else if (boss.type === 'reaper') {
    if (snapshot.goalNodeId && boardAuthority.nodesById.get(snapshot.goalNodeId)?.type !== 'start') goalIds = [snapshot.goalNodeId];
    if (!goalIds.length) {
      const team = leadingTeamServer(snapshot);
      goalIds = getTeamPieceNodesServer(snapshot, team).filter((id) => boardAuthority.nodesById.get(id)?.type !== 'start');
    }
  } else {
    return null;
  }

  if (!goalIds.length) return null;
  const step = bfsNextStepServer(snapshot, boss.node, goalIds, boss);
  if (!step || step === boss.node) return null;

  let info = null;
  if (Array.isArray(snapshot?.barricades) && snapshot.barricades.includes(step)) {
    if (boss.type === 'reaper') {
      snapshot.barricades = snapshot.barricades.filter((id) => id !== step);
      const exclude = new Set([step, ...snapshot.bosses.filter((b) => b && b.alive !== false && b.node).map((b) => b.node)]);
      const candidates = [];
      for (const node of boardAuthority.nodesById.values()) {
        if (!node?.id || exclude.has(node.id)) continue;
        if (isFreeBarricadeNodeServer(snapshot, node.id)) candidates.push(node.id);
      }
      const placed = randomFrom(candidates);
      if (placed) snapshot.barricades.push(placed);
      info = placed ? `👹 ${boss.name} versetzt eine Barrikade.` : `👹 ${boss.name} räumt eine Barrikade weg.`;
    } else {
      snapshot.barricades = snapshot.barricades.filter((id) => id !== step);
      info = `👹 ${boss.name} zerstört eine Barrikade.`;
    }
  }

  boss.node = step;
  const collideInfo = bossCollideAtServer(snapshot, step, boss);
  return [info, collideInfo].filter(Boolean).join(' ');
}

function resolveMagnetPullServer(snapshot, boss) {
  if (!snapshot || !boss || boss.alive === false || !boss.node) return [];
  const messages = [];
  const dist = new Map([[boss.node, 0]]);
  const q = [boss.node];
  while (q.length) {
    const cur = q.shift();
    const d = dist.get(cur);
    for (const nb of (boardAuthority.adj.get(cur) || [])) {
      if (!dist.has(nb)) {
        dist.set(nb, d + 1);
        q.push(nb);
      }
    }
  }
  const nextToward = (fromId) => {
    const d0 = dist.get(fromId);
    if (d0 == null) return null;
    let best = null;
    let bestD = d0;
    for (const nb of (boardAuthority.adj.get(fromId) || [])) {
      const dn = dist.get(nb);
      if (dn == null) continue;
      if (dn < bestD) {
        bestD = dn;
        best = nb;
      }
    }
    return best;
  };

  const pullPieces = (snapshot.pieces || []).filter((p) => p && p.node).slice().sort((a, b) => Number(a.team || 0) - Number(b.team || 0));
  for (const piece of pullPieces) {
    const step1 = nextToward(piece.node);
    if (!step1) continue;
    let dest = step1;
    if ((snapshot.pieces || []).some((p) => p && p.id !== piece.id && p.node === dest)) {
      const step2 = nextToward(dest);
      if (step2 && !(snapshot.pieces || []).some((p) => p && p.id !== piece.id && p.node === step2)) dest = step2;
      else continue;
    }
    piece.prev = piece.node || null;
    piece.node = dest;
    piece.shielded = false;

    if (Array.isArray(snapshot?.barricades) && snapshot.barricades.includes(dest)) {
      snapshot.barricades = snapshot.barricades.filter((id) => id !== dest);
      const candidates = [];
      for (const node of boardAuthority.nodesById.values()) {
        if (isFreeBarricadeNodeServer(snapshot, node.id)) candidates.push(node.id);
      }
      const placed = randomFrom(candidates);
      if (placed) snapshot.barricades.push(placed);
    }

    const blockedByGuardian = bossBlocksGoalServer(snapshot, dest);
    if (!blockedByGuardian) {
      if (snapshot.bonusLightNodeId && dest === snapshot.bonusLightNodeId) {
        awardGoalPointsServer(snapshot, piece.team, 1);
        snapshot.bonusLightNodeId = null;
      } else if (snapshot.bonusGoalNodeId && dest === snapshot.bonusGoalNodeId) {
        awardGoalPointsServer(snapshot, piece.team, Number(snapshot.bonusGoalValue || 2));
        snapshot.bonusGoalNodeId = null;
      } else if (snapshot.goalNodeId && dest === snapshot.goalNodeId) {
        awardGoalPointsServer(snapshot, piece.team, 1);
        snapshot.goalNodeId = respawnGoalNodeServer(snapshot, dest);
      }
    }
  }

  if (pullPieces.length) messages.push(`👹 ${boss.name} zieht alle Figuren näher heran.`);
  return messages;
}

function updateBossesAfterTurnServer(snapshot, opts = {}) {
  ensureBossStateServer(snapshot);
  const messages = [];
  snapshot.bossTick = Number(snapshot.bossTick || 0) + 1;
  const roundEnd = !!opts.roundEnd;
  if (roundEnd) snapshot.bossRoundNum = Number(snapshot.bossRoundNum || 0) + 1;

  const alive = snapshot.bosses.filter((b) => b && b.alive !== false);
  for (const boss of alive) {
    const def = SERVER_BOSS_TYPES[boss.type];
    if (!def) continue;

    if (def.moveOnRoundEnd && !roundEnd) continue;

    if (boss.type === 'guardian') {
      const candidates = [];
      for (const node of boardAuthority.nodesById.values()) {
        if (!node?.id) continue;
        if (snapshot.goalNodeId && node.id === snapshot.goalNodeId) continue;
        if (isFreeBarricadeNodeServer(snapshot, node.id)) candidates.push(node.id);
      }
      const placed = randomFrom(candidates);
      if (placed) {
        if (!Array.isArray(snapshot.barricades)) snapshot.barricades = [];
        snapshot.barricades.push(placed);
        messages.push(`👹 ${boss.name} setzt eine zusätzliche Barrikade.`);
      }
      if ((Number(snapshot.bossRoundNum || 0) % 2) === 0) {
        const old = boss.node;
        if (teleportBossRandomFreeServer(snapshot, boss, old, 0, null)) {
          messages.push(`👹 ${boss.name} teleportiert sich.`);
        }
      }
      continue;
    }

    if (boss.type === 'magnet') {
      messages.push(...resolveMagnetPullServer(snapshot, boss));
      continue;
    }

    const steps = Math.max(1, Number(def.stepsPerMove || 1));
    for (let i = 0; i < steps; i += 1) {
      const msg = moveBossOneStepServer(snapshot, boss, false);
      if (msg) messages.push(msg);
    }

    if (boss.type === 'destroyer' && Array.isArray(snapshot?.barricades) && snapshot.barricades.length) {
      const pick = randomFrom(snapshot.barricades);
      snapshot.barricades = snapshot.barricades.filter((id) => id !== pick);
      messages.push(`👹 ${boss.name} zerstört eine weitere Barrikade.`);
    }
  }

  return messages.filter(Boolean);
}

function finalizeTurnAfterBossServer(room, snap, currentTurnIndex, requestId, info, eventCard, eventResult) {
  const sameTeamAgain = Number(room.gameState?.lastRoll || 0) === 6;
  const keepTurnBecauseEvent = !!eventResult?.keepTurn;
  const roundEnd = !sameTeamAgain && !keepTurnBecauseEvent && currentTurnIndex === (room.players.length - 1);

  const bossMessages = updateBossesAfterTurnServer(snap, { roundEnd });
  if (bossMessages.length) info = `${info || ''} ${bossMessages.join(' ')}`.trim();

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
    return true;
  }

  const nextTurnIndex = (sameTeamAgain || keepTurnBecauseEvent) ? currentTurnIndex : ((currentTurnIndex + 1) % room.players.length);
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

  const nextTeam = nextTurnIndex + 1;
  const turnInfo = (sameTeamAgain || keepTurnBecauseEvent)
    ? `Team ${nextTeam} ist nochmal dran.`
    : `Team ${nextTeam} ist dran: Würfeln.`;
  const combinedInfo = info !== `${room.players[currentTurnIndex]?.name || 'Spieler'} hat gezogen.` ? `${info} ${turnInfo}`.trim() : turnInfo;

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
  return true;
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


function pickServerEventCard() {
  const deck = [
    { id: 'extra_roll_event', title: 'Nochmal würfeln', text: 'Dieses Team ist sofort nochmal dran.' },
    { id: 'spawn_barricades3', title: 'Barrikaden-Verstärkung', text: 'Drei neue Barrikaden erscheinen auf freien Feldern.' },
    { id: 'spawn_one_boss', title: 'Ein Boss erscheint', text: 'Ein neuer Boss erscheint auf einem freien Bossfeld.' },
    { id: 'spawn_two_bosses', title: 'Zwei Bosse erscheinen', text: 'Bis zu zwei Bosse erscheinen auf freien Bossfeldern.' },
    { id: 'all_to_start', title: 'Zurück zum Start', text: 'Alle Spielfiguren werden zurück auf ihre Startfelder gesetzt.' },
    { id: 'gain_one_point', title: 'Zielpunkt +1', text: 'Das aktive Team erhält 1 Zielpunkt.' },
    { id: 'gain_two_points', title: 'Zielpunkt +2', text: 'Das aktive Team erhält 2 Zielpunkte.' },
    { id: 'lose_one_point', title: 'Punktverlust', text: 'Das aktive Team verliert 1 Zielpunkt.' },
    { id: 'spawn_double_goal', title: 'Doppel-Zielfeld', text: 'Ein Doppel-Zielfeld erscheint auf einem freien Feld.' },
    { id: 'spawn_bonus_light', title: 'Lichtfeld', text: 'Ein Lichtfeld erscheint auf einem freien Feld.' },
  ];
  return Object.assign({}, randomFrom(deck) || deck[0]);
}

function applyServerEventEffect(snapshot, card, team) {
  const result = { keepTurn: false, info: '' };
  if (!snapshot || !card) return result;

  switch (String(card.id || '')) {
    case 'extra_roll_event': {
      result.keepTurn = true;
      result.info = `🎲 Team ${team} darf sofort nochmal würfeln.`;
      break;
    }
    case 'spawn_barricades3': {
      if (!Array.isArray(snapshot.barricades)) snapshot.barricades = [];
      const placed = spawnExtraBarricadesServer(snapshot, 3);
      result.info = placed > 0
        ? `🧱 ${placed} neue Barrikaden wurden gesetzt.`
        : '🧱 Keine freie Position für neue Barrikaden gefunden.';
      break;
    }
    case 'spawn_one_boss': {
      const spawned = spawnRandomBossServer(snapshot);
      result.info = spawned?.ok
        ? `👹 ${spawned.boss?.name || 'Ein Boss'} erscheint auf ${spawned.boss?.node || 'einem Bossfeld'}.`
        : '👹 Es konnte kein neuer Boss erscheinen.';
      break;
    }
    case 'spawn_two_bosses': {
      const a = spawnRandomBossServer(snapshot);
      const b = spawnRandomBossServer(snapshot);
      const count = [a, b].filter((x) => x?.ok).length;
      result.info = count > 0 ? `👹 ${count} Boss${count > 1 ? 'e' : ''} erscheinen.` : '👹 Es konnten keine neuen Bosse erscheinen.';
      break;
    }
    case 'all_to_start': {
      const moved = sendAllPlayersToStartServer(snapshot);
      result.info = `🏁 ${moved} Figuren wurden auf ihre Startfelder zurückgesetzt.`;
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
    case 'lose_one_point': {
      const score = adjustGoalPointsServer(snapshot, team, -1);
      result.info = `➖ Team ${team} verliert 1 Zielpunkt. Stand: ${score}/${snapshot.goalToWin || 10}`;
      break;
    }
    case 'spawn_double_goal': {
      const nodeId = spawnBonusGoalServer(snapshot);
      result.info = nodeId
        ? `🌟 Ein Doppel-Zielfeld erscheint auf ${nodeId}.`
        : '🌟 Es konnte kein Doppel-Zielfeld gespawnt werden.';
      break;
    }
    case 'spawn_bonus_light': {
      const nodeId = spawnBonusLightServer(snapshot);
      result.info = nodeId
        ? `✨ Ein Lichtfeld erscheint auf ${nodeId}.`
        : '✨ Es konnte kein Lichtfeld gespawnt werden.';
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

  const bossHit = maybeDefeatBossAtNodeServer(snapshot, landedNodeId, team);
  if (bossHit?.info) info = bossHit.info;
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
    eventResult = applyServerEventEffect(snapshot, eventCard, team);
    if (eventResult?.info) info = `${info || ''} ${eventResult.info}`.trim();
  }

  return { info, eventCard, eventResult };
}

function resolveMoveServer(room, actor, requestId) {
  const snap = cloneSnapshot(room?.gameState?.snapshot);
  const move = room?.gameState?.lastMove || null;
  if (!snap || !move) return;
  const currentTurnIndex = clampTurnIndex(room, room.gameState?.turnIndex ?? 0);
  const movedPiece = Array.isArray(snap.pieces) ? snap.pieces.find((p) => String(p?.id || '') === String(move.pieceId || '')) : null;

  let info = `${actor?.name || 'Spieler'} hat gezogen.`;
  let eventCard = null;
  let eventResult = null;

  if (movedPiece && movedPiece.node) {
    const landedNodeId = movedPiece.node;
    const team = Number(movedPiece.team || (currentTurnIndex + 1));
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
    if (landing.info) info = landing.info;
    eventCard = landing.eventCard;
    eventResult = landing.eventResult;
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
