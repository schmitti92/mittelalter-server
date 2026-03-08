const express = require('express');
const http = require('http');
const cors = require('cors');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

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

const boardAuthority = loadBoardAuthority();

const FORCE_EVENT_EVERY_LANDING = true;
const EVENT_AUTHORITY_DECK = [
  {
    "id": "joker_pick6",
    "title": "Zufälliger Joker",
    "effect": "joker_pick6"
  },
  {
    "id": "joker_wheel",
    "title": "Joker-Glücksrad",
    "effect": "joker_wheel"
  },
  {
    "id": "jokers_all6",
    "title": "Alle 6 Joker",
    "effect": "jokers_all6"
  },
  {
    "id": "joker_rain",
    "title": "Joker-Regen",
    "effect": "joker_rain"
  },
  {
    "id": "shuffle_pieces",
    "title": "Figuren mischen",
    "effect": "shuffle_pieces"
  },
  {
    "id": "start_spawn",
    "title": "Startfeld-Spawn",
    "effect": "start_spawn"
  },
  {
    "id": "spawn_barricades3",
    "title": "Barrikaden-Verstärkung",
    "effect": "spawn_barricades3"
  },
  {
    "id": "spawn_barricades10",
    "title": "Barrikaden-Invasion",
    "effect": "spawn_barricades10"
  },
  {
    "id": "spawn_barricades5",
    "title": "Barrikaden-Nachschub",
    "effect": "spawn_barricades5"
  },
  {
    "id": "move_barricade1",
    "title": "Barrikade versetzen",
    "effect": "move_barricade1"
  },
  {
    "id": "move_barricade2",
    "title": "Zwei Barrikaden versetzen",
    "effect": "move_barricade2"
  },
  {
    "id": "barricades_reset_initial",
    "title": "Barrikaden-Reset",
    "effect": "barricades_reset_initial"
  },
  {
    "id": "barricades_shuffle",
    "title": "Barrikaden mischen",
    "effect": "barricades_shuffle"
  },
  {
    "id": "barricades_on_event_and_goal",
    "title": "Barrikaden-Invasion",
    "effect": "barricades_on_event_and_goal"
  },
  {
    "id": "barricades_half_remove",
    "title": "Barrikaden verfallen",
    "effect": "barricades_half_remove"
  },
  {
    "id": "barricade_jump_reroll",
    "title": "Sturmangriff",
    "effect": "barricade_jump_reroll"
  },
  {
    "id": "spawn_one_boss",
    "title": "Ein Boss erscheint",
    "effect": "spawn_one_boss"
  },
  {
    "id": "spawn_two_bosses",
    "title": "Zwei Bosse erscheinen",
    "effect": "spawn_two_bosses"
  },
  {
    "id": "extra_roll_event",
    "title": "Du darfst nochmal würfeln",
    "effect": "extra_roll_event"
  },
  {
    "id": "all_to_start",
    "title": "Alle zurück zum Start",
    "effect": "all_to_start"
  },
  {
    "id": "lose_all_jokers",
    "title": "Du verlierst alle Joker",
    "effect": "lose_all_jokers"
  },
  {
    "id": "respawn_all_events",
    "title": "Ereignisfelder neu",
    "effect": "respawn_all_events"
  },
  {
    "id": "spawn_double_goal",
    "title": "Doppel-Zielfeld",
    "effect": "spawn_double_goal"
  },
  {
    "id": "dice_duel",
    "title": "Würfel-Duell",
    "effect": "dice_duel"
  },
  {
    "id": "lose_one_point",
    "title": "Du verlierst 1 Siegpunkt",
    "effect": "lose_one_point"
  },
  {
    "id": "gain_one_point",
    "title": "Du bekommst 1 Siegpunkt",
    "effect": "gain_one_point"
  },
  {
    "id": "gain_two_points",
    "title": "Du erhältst 2 Siegpunkte",
    "effect": "gain_two_points"
  },
  {
    "id": "point_transfer_most_to_least",
    "title": "Punktetausch",
    "effect": "point_transfer_most_to_least"
  },
  {
    "id": "back_to_start",
    "title": "Zurück zum Start",
    "effect": "back_to_start"
  },
  {
    "id": "others_to_start",
    "title": "Alle anderen zurück zum Start",
    "effect": "others_to_start"
  },
  {
    "id": "steal_one_point",
    "title": "Klaue 1 Siegpunkt",
    "effect": "steal_one_point"
  },
  {
    "id": "sprint_5",
    "title": "Laufe 5 Felder",
    "effect": "sprint_5"
  },
  {
    "id": "sprint_10",
    "title": "Laufe 10 Felder",
    "effect": "sprint_10"
  },
  {
    "id": "spawn_bonus_light",
    "title": "Zusätzliches Lichtfeld",
    "effect": "spawn_bonus_light"
  }
];

function getRandomEventAuthorityCard() {
  if (!Array.isArray(EVENT_AUTHORITY_DECK) || !EVENT_AUTHORITY_DECK.length) return null;
  const idx = Math.floor(Math.random() * EVENT_AUTHORITY_DECK.length);
  const raw = EVENT_AUTHORITY_DECK[idx] || null;
  if (!raw) return null;
  return { id: String(raw.id || ''), title: String(raw.title || ''), effect: String(raw.effect || '') };
}

function snapshotHasActiveEventField(snapshot, nodeId) {
  if (!snapshot || !nodeId) return false;
  return Array.isArray(snapshot.eventActive) && snapshot.eventActive.includes(nodeId);
}

function shouldTriggerAuthoritativeEvent(snapshot, landingNodeId) {
  if (!landingNodeId) return false;
  if (FORCE_EVENT_EVERY_LANDING) return true;
  return snapshotHasActiveEventField(snapshot, landingNodeId);
}


const SIMPLE_SERVER_EVENT_EFFECTS = new Set([
  'extra_roll_event',
  'barricades_half_remove',
  'spawn_one_boss',
  'spawn_two_bosses',
  'respawn_all_events',
  'gain_one_point',
  'gain_two_points',
  'lose_one_point',
  'all_to_start',
  'back_to_start',
  'others_to_start',
  'spawn_bonus_light',
  'spawn_double_goal',
  'joker_pick6',
  'joker_wheel',
  'dice_duel',
  'sprint_5',
  'sprint_10'
]);

const JOKER_IDS = ['double','moveBarricade','swap','reroll','shield','allcolors'];
const JOKER_MAX_PER_TYPE = 3;
const INTERACTIVE_SERVER_EVENT_EFFECTS = new Set(['move_barricade1','move_barricade2']);

function baseJokerLoadout() {
  const out = {};
  for (const id of JOKER_IDS) out[id] = 1;
  return out;
}

function ensureSnapshotJokers(snapshot) {
  const snap = snapshot || {};
  if (!snap.jokers || typeof snap.jokers !== 'object') snap.jokers = { 1: baseJokerLoadout(), 2: baseJokerLoadout(), 3: baseJokerLoadout(), 4: baseJokerLoadout() };
  for (const team of [1,2,3,4]) {
    if (!snap.jokers[team] || typeof snap.jokers[team] !== 'object') snap.jokers[team] = baseJokerLoadout();
    for (const id of JOKER_IDS) {
      const val = Number(snap.jokers[team][id] || 0);
      snap.jokers[team][id] = Math.max(0, Math.min(JOKER_MAX_PER_TYPE, Math.trunc(val)));
    }
  }
  return snap;
}

function addJokerToSnapshot(snapshot, team, jokerId, amount = 1) {
  const snap = ensureSnapshotJokers(cloneSnapshot(snapshot) || {});
  if (!JOKER_IDS.includes(jokerId)) return { snapshot: snap, gained: 0, jokerId };
  const t = String(Number(team || 0));
  const cur = Number(snap.jokers[t]?.[jokerId] || 0);
  const next = Math.max(0, Math.min(JOKER_MAX_PER_TYPE, cur + Number(amount || 0)));
  if (!snap.jokers[t]) snap.jokers[t] = baseJokerLoadout();
  snap.jokers[t][jokerId] = next;
  return { snapshot: snap, gained: next - cur, jokerId, after: next };
}

function removeRandomJokerFromSnapshot(snapshot, team) {
  const snap = ensureSnapshotJokers(cloneSnapshot(snapshot) || {});
  const t = String(Number(team || 0));
  const inv = snap.jokers[t] || baseJokerLoadout();
  const pool = JOKER_IDS.filter((id) => Number(inv[id] || 0) > 0);
  if (!pool.length) return { snapshot: snap, ok: false, jokerId: null };
  const jokerId = pool[Math.floor(Math.random() * pool.length)];
  inv[jokerId] = Math.max(0, Number(inv[jokerId] || 0) - 1);
  snap.jokers[t] = inv;
  return { snapshot: snap, ok: true, jokerId, jokerName: jokerId };
}

function getActiveTeamsFromSnapshot(snapshot) {
  const teams = new Set();
  for (const p of (snapshot?.pieces || [])) {
    const t = Number(p?.team || 0);
    if (t >= 1 && t <= 4) teams.add(t);
  }
  return Array.from(teams).sort((a,b)=>a-b);
}

function resolveServerDiceDuel(snapshot) {
  let snap = ensureSnapshotJokers(cloneSnapshot(snapshot) || {});
  const teams = getActiveTeamsFromSnapshot(snap);
  if (teams.length < 2) return { snapshot: snap, info: '🎲 Würfel-Duell: Zu wenige Teams aktiv.' };
  let rolls = {};
  let winner = null;
  let loser = null;
  for (let guard = 0; guard < 20; guard += 1) {
    rolls = {};
    for (const team of teams) rolls[team] = randomDie();
    const maxVal = Math.max(...teams.map((t) => rolls[t]));
    const minVal = Math.min(...teams.map((t) => rolls[t]));
    const highs = teams.filter((t) => rolls[t] === maxVal);
    const lows = teams.filter((t) => rolls[t] === minVal);
    if (highs.length === 1 && lows.length === 1 && highs[0] !== lows[0]) { winner = highs[0]; loser = lows[0]; break; }
  }
  if (!winner || !loser) return { snapshot: snap, info: '🎲 Würfel-Duell: Kein eindeutiges Ergebnis.' };
  const moved = removeRandomJokerFromSnapshot(snap, loser);
  snap = moved.snapshot;
  if (!moved.ok) return { snapshot: snap, info: `🎲 Würfel-Duell: Team ${winner} gewinnt, aber Team ${loser} hat keinen Joker.` };
  const gained = addJokerToSnapshot(snap, winner, moved.jokerId, 1);
  snap = gained.snapshot;
  return { snapshot: snap, info: `🎲 Würfel-Duell: Team ${loser} gibt Team ${winner} den Joker ${moved.jokerId}.` };
}

function beginInteractiveServerEvent(snapshot, card, actorPlayerId, actorTeam, pieceId) {
  const snap = ensureSnapshotJokers(cloneSnapshot(snapshot) || {});
  const effect = String(card?.effect || '');
  if (effect === 'move_barricade1' || effect === 'move_barricade2') {
    snap.pendingInteractiveEvent = {
      type: 'move_barricade',
      effect,
      remaining: effect === 'move_barricade2' ? 2 : 1,
      selectedBarricadeId: null,
      actorPlayerId: actorPlayerId || null,
      actorTeam: Number(actorTeam || 0),
      pieceId: pieceId || null,
    };
    return { snapshot: snap, handled: true, appliedEffect: effect, info: effect === 'move_barricade2' ? '🧱 Event: 2 Barrikaden serverseitig versetzen.' : '🧱 Event: 1 Barrikade serverseitig versetzen.' };
  }
  return { snapshot: snap, handled: false, appliedEffect: null, info: null };
}

function isSnapshotFreeForBarricade(snapshot, id) {
  if (!id) return false;
  const occ = getSnapshotOccupiedNodeIds(snapshot);
  const barricades = new Set(Array.isArray(snapshot?.barricades) ? snapshot.barricades : []);
  if (occ.has(id)) return false;
  if (barricades.has(id)) return false;
  const node = boardAuthority.nodesById.get(id);
  if (!node || node.type === 'start') return false;
  return true;
}

function getBoardNodeIdsByType(type) {
  if (!boardAuthority.enabled) return [];
  const out = [];
  for (const node of boardAuthority.nodesById.values()) {
    if (node?.type === type) out.push(node.id);
  }
  return out;
}

function shuffleArrayInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function getSnapshotOccupiedNodeIds(snapshot) {
  const occupied = new Set();
  for (const p of (snapshot?.pieces || [])) {
    if (p?.node) occupied.add(p.node);
  }
  for (const b of (snapshot?.bosses || [])) {
    if (b?.node && b?.alive !== false) occupied.add(b.node);
  }
  return occupied;
}

function getServerFreeSpawnNodes(snapshot, { allowEvent = false, allowGoal = false, allowBonus = false } = {}) {
  if (!boardAuthority.enabled) return [];
  const occupied = getSnapshotOccupiedNodeIds(snapshot);
  const barricades = new Set(Array.isArray(snapshot?.barricades) ? snapshot.barricades : []);
  const eventActive = new Set(Array.isArray(snapshot?.eventActive) ? snapshot.eventActive : []);
  const goalNodeId = snapshot?.goalNodeId || null;
  const bonusGoalNodeId = snapshot?.bonusGoalNodeId || null;
  const bonusLightNodeId = snapshot?.bonusLightNodeId || null;
  const out = [];
  for (const node of boardAuthority.nodesById.values()) {
    if (!node?.id) continue;
    if (occupied.has(node.id)) continue;
    if (barricades.has(node.id)) continue;
    if (node.type === 'start' || node.type === 'portal' || node.type === 'boss') continue;
    if (!allowEvent && eventActive.has(node.id)) continue;
    if (!allowGoal && goalNodeId && node.id === goalNodeId) continue;
    if (!allowBonus && bonusGoalNodeId && node.id === bonusGoalNodeId) continue;
    if (!allowBonus && bonusLightNodeId && node.id === bonusLightNodeId) continue;
    out.push(node.id);
  }
  return out;
}

function pickRandomFreeNode(snapshot, opts = {}) {
  const nodes = getServerFreeSpawnNodes(snapshot, opts);
  if (!nodes.length) return null;
  return nodes[Math.floor(Math.random() * nodes.length)] || null;
}

function resetEventFieldsFromBoard(snapshot) {
  const snap = cloneSnapshot(snapshot) || {};
  snap.eventActive = getBoardNodeIdsByType('event');
  return snap;
}

function removeHalfBarricadesFromSnapshot(snapshot) {
  const snap = cloneSnapshot(snapshot) || {};
  const list = Array.isArray(snap.barricades) ? [...snap.barricades] : [];
  const removeCount = Math.floor(list.length / 2);
  shuffleArrayInPlace(list);
  snap.barricades = list.slice(removeCount);
  return { snapshot: snap, removed: removeCount, left: snap.barricades.length };
}

function assignTeamPiecesToStarts(snapshot, team, pieceIds = null) {
  const snap = cloneSnapshot(snapshot) || {};
  const pieces = Array.isArray(snap.pieces) ? snap.pieces : [];
  const starts = getStartNodesForTeam(team);
  if (!starts.length) return { snapshot: snap, moved: 0 };
  let idx = 0;
  let moved = 0;
  for (const piece of pieces) {
    if (!piece || Number(piece.team || 0) !== Number(team || 0)) continue;
    if (pieceIds && !pieceIds.includes(piece.id)) continue;
    const dest = starts[idx] || starts[starts.length - 1] || null;
    idx += 1;
    if (!dest) continue;
    if (piece.node !== dest) moved += 1;
    piece.prev = piece.node || null;
    piece.node = dest;
    piece.shielded = false;
  }
  return { snapshot: snap, moved };
}

function sendAllPiecesToStartSnapshot(snapshot) {
  let snap = cloneSnapshot(snapshot) || {};
  let moved = 0;
  const teams = new Set((snap.pieces || []).map((p) => Number(p?.team || 0)).filter(Boolean));
  for (const team of teams) {
    const res = assignTeamPiecesToStarts(snap, team);
    snap = res.snapshot;
    moved += res.moved;
  }
  return { snapshot: snap, moved };
}

function sendOtherTeamsToStartSnapshot(snapshot, keepTeam) {
  let snap = cloneSnapshot(snapshot) || {};
  let moved = 0;
  const teams = new Set((snap.pieces || []).map((p) => Number(p?.team || 0)).filter(Boolean));
  for (const team of teams) {
    if (Number(team) === Number(keepTeam || 0)) continue;
    const res = assignTeamPiecesToStarts(snap, team);
    snap = res.snapshot;
    moved += res.moved;
  }
  return { snapshot: snap, moved };
}

function ensureSnapshotBossArray(snapshot) {
  const snap = cloneSnapshot(snapshot) || {};
  if (!Array.isArray(snap.bosses)) snap.bosses = [];
  return snap;
}

function spawnBossesOnSnapshot(snapshot, count = 1) {
  let snap = ensureSnapshotBossArray(snapshot);
  const active = (snap.bosses || []).filter((b) => b && b.alive !== false);
  const maxCanSpawn = Math.max(0, 2 - active.length);
  if (maxCanSpawn <= 0) return { snapshot: snap, spawned: [] };
  const bossNodes = getBoardNodeIdsByType('boss');
  const occupied = getSnapshotOccupiedNodeIds(snap);
  const taken = new Set(active.map((b) => b.node).filter(Boolean));
  const freeBossNodes = bossNodes.filter((id) => id && !occupied.has(id) && !taken.has(id) && !(snap.barricades || []).includes(id));
  if (!freeBossNodes.length) return { snapshot: snap, spawned: [] };
  const bossTypes = ['hunter', 'destroyer'];
  const seqBase = (snap.bossIdSeq || 1);
  const spawned = [];
  shuffleArrayInPlace(freeBossNodes);
  const actualCount = Math.min(Math.max(0, Number(count || 0)), maxCanSpawn, freeBossNodes.length);
  for (let i = 0; i < actualCount; i += 1) {
    const node = freeBossNodes[i];
    const type = bossTypes[Math.floor(Math.random() * bossTypes.length)] || 'hunter';
    const boss = {
      id: `boss_${seqBase + i}`,
      type,
      name: type === 'destroyer' ? 'Der Zerstörer' : 'Der Jäger',
      node,
      alive: true,
      visible: true,
      hits: 0,
      meta: {},
    };
    snap.bosses.push(boss);
    spawned.push(boss);
  }
  snap.bossIdSeq = seqBase + spawned.length;
  return { snapshot: snap, spawned };
}

function changeGoalScore(snapshot, team, delta) {
  const snap = cloneSnapshot(snapshot) || {};
  snap.goalScores = Object.assign({ 1: 0, 2: 0, 3: 0, 4: 0 }, snap.goalScores || {});
  const key = String(Number(team || 0));
  const before = Number(snap.goalScores[key] || 0);
  const after = Math.max(0, before + Number(delta || 0));
  snap.goalScores[key] = after;
  return { snapshot: snap, before, after, delta: after - before };
}

function spawnSpecialNodeOnSnapshot(snapshot, kind) {
  const snap = cloneSnapshot(snapshot) || {};
  if (kind === 'bonusGoal' && snap.bonusGoalNodeId) return { snapshot: snap, ok: false, reason: 'already_exists', nodeId: snap.bonusGoalNodeId };
  if (kind === 'bonusLight' && snap.bonusLightNodeId) return { snapshot: snap, ok: false, reason: 'already_exists', nodeId: snap.bonusLightNodeId };
  const nodeId = pickRandomFreeNode(snap, { allowEvent: false, allowGoal: false, allowBonus: false });
  if (!nodeId) return { snapshot: snap, ok: false, reason: 'no_free_node', nodeId: null };
  if (kind === 'bonusGoal') snap.bonusGoalNodeId = nodeId;
  if (kind === 'bonusLight') snap.bonusLightNodeId = nodeId;
  return { snapshot: snap, ok: true, reason: null, nodeId };
}

function applySimpleServerEventEffects(snapshot, card, actorTeam) {
  let snap = cloneSnapshot(snapshot) || {};
  const effect = String(card?.effect || '');
  const result = { snapshot: snap, handled: false, info: null, appliedEffect: null };
  if (!SIMPLE_SERVER_EVENT_EFFECTS.has(effect)) return result;

  result.handled = true;
  result.appliedEffect = effect;

  if (effect === 'extra_roll_event') {
    snap.extraRoll = true;
    result.snapshot = snap;
    result.info = `🎲 Team ${actorTeam}: Extra-Wurf vom Server aktiviert.`;
    return result;
  }
  if (effect === 'barricades_half_remove') {
    const r = removeHalfBarricadesFromSnapshot(snap);
    result.snapshot = r.snapshot;
    result.info = `🧱 ${r.removed} Barrikaden verschwinden. Übrig: ${r.left}.`;
    return result;
  }
  if (effect === 'spawn_one_boss') {
    const r = spawnBossesOnSnapshot(snap, 1);
    result.snapshot = r.snapshot;
    result.info = r.spawned.length ? `👹 ${r.spawned[0].name || 'Boss'} erscheint auf ${r.spawned[0].node}!` : '👹 Boss-Event: Kein Boss konnte erscheinen.';
    return result;
  }
  if (effect === 'spawn_two_bosses') {
    const r = spawnBossesOnSnapshot(snap, 2);
    result.snapshot = r.snapshot;
    result.info = !r.spawned.length ? '👹 Boss-Event: Kein Boss konnte erscheinen.' : (r.spawned.length === 1 ? `👹 ${r.spawned[0].name || 'Boss'} erscheint! (1/2 möglich)` : '👹 Zwei Bosse erscheinen auf den Bossfeldern!');
    return result;
  }
  if (effect === 'respawn_all_events') {
    snap = resetEventFieldsFromBoard(snap);
    result.snapshot = snap;
    result.info = `✨ Ereignisfelder neu gespawnt: ${(snap.eventActive || []).length}/${getBoardNodeIdsByType('event').length}.`;
    return result;
  }
  if (effect === 'gain_one_point') {
    const r = changeGoalScore(snap, actorTeam, 1);
    result.snapshot = r.snapshot;
    result.info = `✨ Team ${actorTeam} erhält 1 Siegpunkt! Stand: ${r.after}/10`;
    return result;
  }
  if (effect === 'gain_two_points') {
    const r = changeGoalScore(snap, actorTeam, 2);
    result.snapshot = r.snapshot;
    result.info = `🏆 Team ${actorTeam} erhält 2 Siegpunkte! Stand: ${r.after}/10`;
    return result;
  }
  if (effect === 'lose_one_point') {
    const r = changeGoalScore(snap, actorTeam, -1);
    result.snapshot = r.snapshot;
    result.info = r.delta < 0 ? `💀 Team ${actorTeam} verliert 1 Siegpunkt! Stand: ${r.after}/10` : `💀 Team ${actorTeam} hatte keinen Siegpunkt zu verlieren.`;
    return result;
  }
  if (effect === 'all_to_start') {
    const r = sendAllPiecesToStartSnapshot(snap);
    result.snapshot = r.snapshot;
    result.info = `🏰 Alle zurück zum Start! ${r.moved} Figuren wurden versetzt.`;
    return result;
  }
  if (effect === 'back_to_start') {
    const actorPieceIds = (snap.pieces || []).filter((p) => Number(p?.team || 0) === Number(actorTeam || 0)).map((p) => p.id);
    const r = assignTeamPiecesToStarts(snap, actorTeam, actorPieceIds);
    result.snapshot = r.snapshot;
    result.info = `↩️ Team ${actorTeam}: eigene Figuren zurück zum Start.`;
    return result;
  }
  if (effect === 'others_to_start') {
    const r = sendOtherTeamsToStartSnapshot(snap, actorTeam);
    result.snapshot = r.snapshot;
    result.info = '↩️ Alle anderen Spieler müssen zurück aufs Startfeld!';
    return result;
  }
  if (effect === 'spawn_bonus_light') {
    const r = spawnSpecialNodeOnSnapshot(snap, 'bonusLight');
    result.snapshot = r.snapshot;
    result.info = r.ok ? `💡 Ein zusätzliches Lichtfeld erscheint auf ${r.nodeId}!` : '💡 Kein freies Feld für das Bonus-Licht gefunden.';
    return result;
  }
  if (effect === 'spawn_double_goal') {
    const r = spawnSpecialNodeOnSnapshot(snap, 'bonusGoal');
    result.snapshot = r.snapshot;
    result.info = r.ok ? `🌟 Ein Doppel-Zielfeld erscheint auf ${r.nodeId}!` : (r.reason === 'already_exists' ? '🌟 Das Doppel-Zielfeld ist bereits auf dem Brett.' : '🌟 Kein freies Feld für das Doppel-Zielfeld gefunden.');
    return result;
  }
  if (effect === 'joker_pick6') {
    const jokerId = JOKER_IDS[Math.floor(Math.random() * JOKER_IDS.length)];
    const r = addJokerToSnapshot(snap, actorTeam, jokerId, 1);
    result.snapshot = r.snapshot;
    result.info = `🃏 Team ${actorTeam} erhält serverseitig den Joker ${jokerId}.`;
    return result;
  }
  if (effect === 'joker_wheel') {
    const jokerId = JOKER_IDS[Math.floor(Math.random() * JOKER_IDS.length)];
    const amount = Math.floor(Math.random() * 3) + 1;
    const r = addJokerToSnapshot(snap, actorTeam, jokerId, amount);
    result.snapshot = r.snapshot;
    result.info = `🃏 Joker-Glücksrad: Team ${actorTeam} erhält ${Math.max(0, r.gained)}x ${jokerId}.`;
    return result;
  }
  if (effect === 'dice_duel') {
    const r = resolveServerDiceDuel(snap);
    result.snapshot = r.snapshot;
    result.info = r.info;
    return result;
  }
  if (effect === 'sprint_5' || effect === 'sprint_10') {
    snap.phase = 'choosePiece';
    snap.roll = effect === 'sprint_10' ? 10 : 5;
    result.snapshot = snap;
    result.info = `🏃 Team ${actorTeam}: Wähle 1 eigene Figur und laufe ${snap.roll} Felder.`;
    return result;
  }

  result.handled = false;
  result.appliedEffect = null;
  return result;
}

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
  return {
    pieces,
    barricades,
    eventActive,
    carry: { 1: 0, 2: 0, 3: 0, 4: 0 },
    goalScores: { 1: 0, 2: 0, 3: 0, 4: 0 },
    jokers: { 1: baseJokerLoadout(), 2: baseJokerLoadout(), 3: baseJokerLoadout(), 4: baseJokerLoadout() },
    pendingEventCardId: null,
    lastEventCardId: null,
    pendingInteractiveEvent: null,
    ignoreBarricadesThisTurn: false,
    roll: 0,
    phase: 'lobby',
    turnIndex: 0,
  };
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

function finalizeTurnState(room, nextTurnIndex, nextPhase, requestId = null, info = null) {
  const safeTurnIndex = clampTurnIndex(room, nextTurnIndex);
  const safePhase = sanitizePhase(nextPhase);

  room.gameState.turnIndex = safeTurnIndex;
  room.gameState.phase = safePhase;
  room.gameState.lastMove = null;

  if (room.gameState.snapshot) {
    room.gameState.snapshot.turnIndex = safeTurnIndex;
    room.gameState.snapshot.phase = safePhase;
    if (safePhase === 'needRoll') {
      room.gameState.snapshot.roll = 0;
      room.gameState.snapshot.pendingEventCardId = null;
      room.gameState.snapshot.serverAppliedEventEffect = null;
      room.gameState.snapshot.serverAppliedEventInfo = null;
      room.gameState.snapshot.pendingInteractiveEvent = null;
    }
  }

  if (safePhase === 'needRoll') {
    room.gameState.lastRoll = null;
    room.gameState.lastRollAt = null;
    room.gameState.lastRollBy = null;
    room.gameState.lastRollMeta = null;
  }

  broadcastRoom(room, 'game_turn_state', {
    room: publicRoomState(room),
    gameState: room.gameState,
    requestId,
    info: typeof info === 'string' && info.trim() ? info.trim() : null,
  });
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
    let selectedEventCard = null;
    if (nextSnapshot) {
      nextSnapshot.turnIndex = currentTurnIndex;
      nextSnapshot.phase = 'resolveMove';
      nextSnapshot.roll = Number(room.gameState?.lastRoll || 0);
      nextSnapshot.pendingEventCardId = null;
      nextSnapshot.serverAppliedEventEffect = null;
      nextSnapshot.serverAppliedEventInfo = null;
      if (shouldTriggerAuthoritativeEvent(nextSnapshot, targetId)) {
        selectedEventCard = getRandomEventAuthorityCard();
        if (selectedEventCard?.id) {
          nextSnapshot.pendingEventCardId = selectedEventCard.id;
          nextSnapshot.lastEventCardId = selectedEventCard.id;
          const simpleEventResult = applySimpleServerEventEffects(nextSnapshot, selectedEventCard, currentTurnIndex + 1);
          if (simpleEventResult?.handled) {
            nextSnapshot = simpleEventResult.snapshot || nextSnapshot;
            nextSnapshot.serverAppliedEventEffect = simpleEventResult.appliedEffect || selectedEventCard.effect || null;
            nextSnapshot.serverAppliedEventInfo = simpleEventResult.info || null;
          } else {
            const interactiveResult = beginInteractiveServerEvent(nextSnapshot, selectedEventCard, self.id, currentTurnIndex + 1, pieceId);
            if (interactiveResult?.handled) {
              nextSnapshot = interactiveResult.snapshot || nextSnapshot;
              nextSnapshot.serverAppliedEventEffect = interactiveResult.appliedEffect || selectedEventCard.effect || null;
              nextSnapshot.serverAppliedEventInfo = interactiveResult.info || null;
            }
          }
        }
      }
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
      eventCardId: selectedEventCard?.id || null,
      eventCardTitle: selectedEventCard?.title || null,
      eventCardEffect: selectedEventCard?.effect || null,
      at: new Date().toISOString(),
      snapshot: cloneSnapshot(room.gameState.snapshot),
    };

    sendTrace(ws, 'move_request.broadcast', {
      requestId,
      pieceId,
      targetId,
      roll: Number(room.gameState?.lastRoll || 0),
      phaseAfter: room.gameState.phase,
      eventCardId: selectedEventCard?.id || null,
      snapshotPieces: Array.isArray(room.gameState?.snapshot?.pieces) ? room.gameState.snapshot.pieces.length : 0,
    });

    broadcastRoom(room, 'game_move', {
      room: publicRoomState(room),
      move: room.gameState.lastMove,
      snapshot: cloneSnapshot(room.gameState.snapshot),
      requestId,
      event: selectedEventCard ? { cardId: selectedEventCard.id, title: selectedEventCard.title, effect: selectedEventCard.effect } : null,
      info: selectedEventCard?.title ? `${self.name} bewegt eine Figur. Event: ${selectedEventCard.title}.` : `${self.name} bewegt eine Figur.`,
    });

    sendTrace(ws, 'move_request.await_finish_move', {
      requestId,
      turnIndex: currentTurnIndex,
      phase: room.gameState.phase,
      actorPlayerId: self.id,
      actorName: self.name,
    });
    return;
  }


  if (action === 'finish_move') {
    const moveActorId = room.gameState?.lastMove?.byPlayerId || null;
    if (!moveActorId || moveActorId !== self.id) {
      send(ws, 'error_message', { message: 'Nur der Spieler der die Figur bewegt hat darf den Zug beenden.' });
      return;
    }
    if (sanitizePhase(room.gameState?.phase) !== 'resolveMove') {
      send(ws, 'error_message', { message: 'Der Zug ist auf dem Server nicht mehr im Abschluss.' });
      return;
    }

    if (room.gameState?.snapshot?.pendingInteractiveEvent) {
      send(ws, 'error_message', { message: 'Interaktives Event ist noch nicht abgeschlossen.' });
      return;
    }

    const nextTurnIndex = clampTurnIndex(room, msg.turnIndex);
    const nextPhase = sanitizePhase(msg.phase);
    const snapshot = msg.stateSnapshot && typeof msg.stateSnapshot === 'object' ? cloneSnapshot(msg.stateSnapshot) : null;
    if (!snapshot) {
      send(ws, 'error_message', { message: 'Zum Zugabschluss fehlt der Snapshot.' });
      return;
    }

    room.gameState.snapshot = snapshot;
    room.gameState.phase = sanitizePhase(snapshot.phase || nextPhase);
    if (room.gameState.phase !== 'resolveMove' && room.gameState.snapshot) {
      room.gameState.snapshot.pendingEventCardId = null;
      room.gameState.snapshot.serverAppliedEventEffect = null;
      room.gameState.snapshot.serverAppliedEventInfo = null;
      room.gameState.snapshot.pendingInteractiveEvent = null;
    }
    if (room.gameState.snapshot) {
      room.gameState.snapshot.turnIndex = clampTurnIndex(room, Number(snapshot.turnIndex ?? currentTurnIndex));
      room.gameState.snapshot.phase = sanitizePhase(snapshot.phase || nextPhase);
    }

    sendTrace(ws, 'finish_move.accepted', {
      requestId,
      byPlayerId: self.id,
      nextTurnIndex,
      nextPhase,
      snapshotPhase: room.gameState?.snapshot?.phase || null,
      snapshotTurnIndex: Number(room.gameState?.snapshot?.turnIndex ?? -1),
    });

    finalizeTurnState(room, nextTurnIndex, nextPhase, requestId, typeof msg.info === 'string' && msg.info.trim() ? msg.info.trim() : null);
    return;
  }

  if (action === 'interactive_event_step') {
    const moveActorId = room.gameState?.lastMove?.byPlayerId || null;
    const snap = cloneSnapshot(room.gameState?.snapshot) || null;
    const pending = snap?.pendingInteractiveEvent || null;
    if (!moveActorId || moveActorId !== self.id || !pending || pending.actorPlayerId !== self.id) {
      send(ws, 'error_message', { message: 'Kein aktives interaktives Server-Event für dich.' });
      return;
    }
    if (sanitizePhase(room.gameState?.phase) !== 'resolveMove') {
      send(ws, 'error_message', { message: 'Interaktives Event ist nicht mehr aktiv.' });
      return;
    }
    if (pending.type === 'move_barricade') {
      const step = String(msg.step || '');
      if (step === 'pick') {
        const sourceId = String(msg.sourceId || '');
        const barricades = new Set(Array.isArray(snap.barricades) ? snap.barricades : []);
        if (!barricades.has(sourceId)) {
          send(ws, 'error_message', { message: 'Diese Barrikade gibt es serverseitig nicht.' });
          return;
        }
        pending.selectedBarricadeId = sourceId;
        snap.pendingInteractiveEvent = pending;
        room.gameState.snapshot = snap;
        broadcastRoom(room, 'interactive_event_state', {
          room: publicRoomState(room),
          snapshot: cloneSnapshot(snap),
          requestId,
          info: '🧱 Barrikade gewählt. Tippe das neue Feld.'
        });
        return;
      }
      if (step === 'place') {
        const fromId = String(pending.selectedBarricadeId || '');
        const targetId = String(msg.targetId || '');
        const barricades = new Set(Array.isArray(snap.barricades) ? snap.barricades : []);
        if (!fromId || !barricades.has(fromId)) {
          send(ws, 'error_message', { message: 'Quell-Barrikade ist nicht mehr gültig.' });
          return;
        }
        if (targetId !== fromId && !isSnapshotFreeForBarricade(snap, targetId)) {
          send(ws, 'error_message', { message: 'Zielfeld für Barrikade ist serverseitig nicht erlaubt.' });
          return;
        }
        const arr = Array.from(barricades).filter((id) => id !== fromId);
        arr.push(targetId);
        snap.barricades = arr;
        pending.remaining = Math.max(0, Number(pending.remaining || 1) - 1);
        pending.selectedBarricadeId = null;
        if (pending.remaining > 0) {
          snap.pendingInteractiveEvent = pending;
        } else {
          snap.pendingInteractiveEvent = null;
        }
        room.gameState.snapshot = snap;
        broadcastRoom(room, 'interactive_event_state', {
          room: publicRoomState(room),
          snapshot: cloneSnapshot(snap),
          requestId,
          info: pending.remaining > 0 ? `🧱 Noch ${pending.remaining} Barrikade(n) versetzen.` : '🧱 Barrikaden-Event abgeschlossen.'
        });
        return;
      }
    }
    send(ws, 'error_message', { message: 'Unbekannter interaktiver Event-Schritt.' });
    return;
  }

  if (action === 'turn_update') {
    if (!currentPlayer || currentPlayer.id !== self.id) {
      send(ws, 'error_message', { message: 'Nur der aktuelle Spieler darf den Zugstatus ändern.' });
      return;
    }

    if (room.gameState?.snapshot?.pendingInteractiveEvent) {
      send(ws, 'error_message', { message: 'Interaktives Event ist noch nicht abgeschlossen.' });
      return;
    }

    const nextTurnIndex = clampTurnIndex(room, msg.turnIndex);
    const nextPhase = sanitizePhase(msg.phase);
    const snapshot = msg.stateSnapshot && typeof msg.stateSnapshot === 'object' ? cloneSnapshot(msg.stateSnapshot) : null;
    if (snapshot) room.gameState.snapshot = snapshot;

    finalizeTurnState(room, nextTurnIndex, nextPhase, requestId, typeof msg.info === 'string' && msg.info.trim() ? msg.info.trim() : null);
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
