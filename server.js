import fs from "fs";
import path from "path";
import express from "express";
import http from "http";
import { WebSocketServer } from "ws";

const PORT = process.env.PORT || 10000;
const SERVER_BUILD = "barikade-emoji-reliable-v2-20260919";
const SAVE_DIR = process.env.SAVE_DIR || path.join(process.cwd(), "saves");
try { fs.mkdirSync(SAVE_DIR, { recursive: true }); } catch (_e) {}

function savePathForRoom(code){
  const safe = String(code||"").toUpperCase().replace(/[^A-Z0-9_-]/g,"").slice(0,20) || "ROOM";
  return path.join(SAVE_DIR, safe + ".json");
}
function persistRoomState(room){
  try{
    if(!room || !room.code || !room.state) return;
    const file = savePathForRoom(room.code);
    fs.writeFileSync(file, JSON.stringify({ code: room.code, ts: Date.now(), state: room.state }));
  }catch(_e){}
}
function restoreRoomState(room){
  try{
    if(!room || !room.code) return false;
    const file = savePathForRoom(room.code);
    if(!fs.existsSync(file)) return false;
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    if(payload && payload.state && typeof payload.state === "object"){
      room.state = payload.state;
      return true;
    }
  }catch(_e){}
  return false;
}
function deletePersisted(room){
  try{
    if(!room || !room.code) return;
    const file = savePathForRoom(room.code);
    if(fs.existsSync(file)) fs.unlinkSync(file);
  }catch(_e){}
}

const clients = new Map();
const rooms = new Map();

const app = express();
app.use(express.json());
app.get("/", (_req, res) => res.status(200).send(`barikade-server ok · ${SERVER_BUILD}`));
app.get("/health", (_req, res) => res.status(200).json({ ok:true, build:SERVER_BUILD, ts:Date.now(), rooms:rooms.size, clients:clients.size, emojiPending:Array.from(rooms.values()).reduce((n,r)=>n+(r?.emojiPending?.size||0),0) }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const boardPath = path.join(process.cwd(), "board.json");
const BOARD = JSON.parse(fs.readFileSync(boardPath, "utf-8"));
const NODES = new Map((BOARD.nodes || []).map(n => [n.id, n]));
const EDGES = BOARD.edges || [];
const ADJ = new Map();
for (const [a, b] of EDGES) {
  if (!ADJ.has(a)) ADJ.set(a, new Set());
  if (!ADJ.has(b)) ADJ.set(b, new Set());
  ADJ.get(a).add(b);
  ADJ.get(b).add(a);
}
const STARTS = BOARD.meta?.starts || {};
const GOAL = BOARD.meta?.goal || null;
const HOUSE_BY_COLOR = (() => {
  const map = { red: [], blue: [], green: [], yellow: [] };
  for (const n of BOARD.nodes || []) {
    if (n.kind !== "house") continue;
    const c = String(n.flags?.houseColor || "").toLowerCase();
    const slot = Number(n.flags?.houseSlot || 0);
    if (!map[c]) map[c] = [];
    map[c].push([slot, n.id]);
  }
  for (const c of Object.keys(map)) {
    map[c].sort((a, b) => a[0] - b[0]);
    map[c] = map[c].map(x => x[1]);
  }
  return map;
})();

function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(2, 8); }
function normalizeJokerStartConfig(value){
  const n = Number(value);
  if(Number.isInteger(n) && n >= 1 && n <= 5){
    return { allColors:n, barricade:n, reroll:n, double:n };
  }
  const src = value && typeof value === "object" ? value : {};
  const out = {};
  for(const key of ["allColors","barricade","reroll","double"]){
    const v = Number(src[key]);
    if(!Number.isInteger(v) || v < 1 || v > 5) return null;
    out[key] = v;
  }
  return (out.allColors && out.barricade && out.reroll && out.double) ? out : null;
}
function cloneJokerConfig(cfg){
  return cfg ? { allColors:Number(cfg.allColors), barricade:Number(cfg.barricade), reroll:Number(cfg.reroll), double:Number(cfg.double) } : null;
}

function makeRoom(code) {
  return {
    code,
    hostToken: null,
    players: new Map(),
    state: null,
    lastRollWasSix: false,
    carryingByColor: { red: false, blue: false },
    lobby: { jokerStart: null },
    emojiCooldowns: new Map(),
    emojiPending: new Map(),
    emojiSeq: 0,
  };
}
function shuffleInPlace(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }
function isConnectedPlayer(p) { const c = clients.get(p.id); return !!(c?.ws && c.ws.readyState === 1); }
function currentPlayersList(room) {
  return Array.from(room.players.values()).map(p => ({ id:p.id, name:p.name, color:p.color||null, isHost:!!p.isHost, connected:isConnectedPlayer(p), lastSeen:p.lastSeen||null }));
}
function canStart(room) { return Array.from(room.players.values()).filter(p => p.color && isConnectedPlayer(p)).length >= 2; }
function enforcePauseIfNotReady(room){ try{ if(room?.state && !canStart(room)) room.state.paused = true; }catch(_e){} }
function broadcast(room, obj) {
  const msg = JSON.stringify(obj);
  for (const p of room.players.values()) {
    const c = clients.get(p.id);
    if (c?.ws?.readyState === 1) { try { c.ws.send(msg); } catch (_e) {} }
  }
}
// ===== Reliable Emoji Delivery =====
// Emoji-Reaktionen sind kurzlebig, sollen aber bei ALLEN Spielern des Raums ankommen.
// Deshalb: serverseitige Event-ID, ACK pro Spielersitzung, Retry und Replay nach Reconnect.
const EMOJI_EVENT_TTL_MS = 9000;
const EMOJI_RETRY_MS = 650;
const EMOJI_MAX_PENDING_PER_ROOM = 24;

function emojiRecipientKeyFromPlayer(p){
  const token = String(p?.sessionToken || "").trim();
  if(token) return `s:${token}`;
  const id = String(p?.id || "").trim();
  return id ? `p:${id}` : "";
}
function emojiRecipientKeyFromClient(clientId, c){
  const token = String(c?.sessionToken || "").trim();
  if(token) return `s:${token}`;
  const id = String(clientId || "").trim();
  return id ? `p:${id}` : "";
}
function connectedRoomClients(roomCode){
  const code = String(roomCode || "").trim().toUpperCase();
  const out = [];
  for(const [id, c] of clients.entries()){
    if(String(c?.room || "").trim().toUpperCase() !== code) continue;
    if(c?.ws?.readyState !== 1) continue;
    const recipientKey = emojiRecipientKeyFromClient(id, c);
    if(!recipientKey) continue;
    out.push({ clientId:id, client:c, recipientKey });
  }
  return out;
}
function pruneEmojiPending(room, now = Date.now()){
  if(!room?.emojiPending) return;
  for(const [eventId, entry] of room.emojiPending.entries()){
    if(!entry || Number(entry.expiresAt || 0) <= now){
      room.emojiPending.delete(eventId);
    }
  }
  while(room.emojiPending.size > EMOJI_MAX_PENDING_PER_ROOM){
    const first = room.emojiPending.keys().next().value;
    if(!first) break;
    room.emojiPending.delete(first);
  }
}
function sendPendingEmoji(room, entry, onlyRecipientKey = ""){
  if(!room || !entry) return 0;
  const now = Date.now();
  const payload = JSON.stringify(entry.payload);
  let sent = 0;
  for(const rc of connectedRoomClients(room.code)){
    if(onlyRecipientKey && rc.recipientKey !== onlyRecipientKey) continue;
    if(!entry.recipients.has(rc.recipientKey)) continue;
    if(entry.acked.has(rc.recipientKey)) continue;
    try{
      rc.client.ws.send(payload);
      sent++;
    }catch(_e){}
  }
  entry.lastSendAt = now;
  return sent;
}
function queueReliableEmoji(room, senderId, player, key, reactionId){
  if(!room) return null;
  if(!room.emojiPending) room.emojiPending = new Map();
  pruneEmojiPending(room);

  const now = Date.now();
  room.emojiSeq = Number(room.emojiSeq || 0) + 1;
  const requestedId = String(reactionId || "").replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 96);
  const eventId = requestedId || `emoji:${room.code}:${now}:${room.emojiSeq}`;

  // Zielgruppe sind alle bekannten Spielersitzungen im Raum – auch ein Spieler,
  // der gerade für wenige Sekunden reconnectet. Dadurch kann das Event nachgeliefert werden.
  const recipients = new Set();
  for(const p of room.players.values()){
    const rk = emojiRecipientKeyFromPlayer(p);
    if(rk) recipients.add(rk);
  }
  // Sicherheit: aktuell verbundene Sockets ebenfalls aufnehmen.
  for(const rc of connectedRoomClients(room.code)) recipients.add(rc.recipientKey);

  const payload = {
    type:"emoji_event",
    eventId,
    reactionId:eventId, // kompatibel zu älteren Clients
    playerId:senderId,
    name:player?.name || "Spieler",
    emoji:key,
    icon:emojiGlyph(key),
    ts:now
  };
  const entry = {
    eventId,
    payload,
    recipients,
    acked:new Set(),
    createdAt:now,
    lastSendAt:0,
    expiresAt:now + EMOJI_EVENT_TTL_MS
  };
  room.emojiPending.set(eventId, entry);
  sendPendingEmoji(room, entry);
  return entry;
}
function ackReliableEmoji(room, clientId, eventId){
  if(!room?.emojiPending) return false;
  const id = String(eventId || "").trim();
  if(!id) return false;
  const entry = room.emojiPending.get(id);
  if(!entry) return false;
  const c = clients.get(clientId);
  const rk = emojiRecipientKeyFromClient(clientId, c);
  if(!rk || !entry.recipients.has(rk)) return false;
  entry.acked.add(rk);
  if(entry.acked.size >= entry.recipients.size){
    room.emojiPending.delete(id);
  }
  return true;
}
function replayPendingEmojiForClient(room, clientId){
  if(!room?.emojiPending) return;
  pruneEmojiPending(room);
  const c = clients.get(clientId);
  const rk = emojiRecipientKeyFromClient(clientId, c);
  if(!rk) return;
  for(const entry of room.emojiPending.values()){
    if(entry.recipients.has(rk) && !entry.acked.has(rk)){
      sendPendingEmoji(room, entry, rk);
    }
  }
}
function send(ws, obj) { try { ws.send(JSON.stringify(obj)); } catch (_e) {} }
function emojiGlyph(key){
  if (key === "laugh") return "😂";
  if (key === "angry") return "😡";
  if (key === "cool") return "😎";
  return "";
}
function normalizeEmojiKey(value){
  const v = String(value || "").trim();
  if (v === "😂" || v.toLowerCase() === "laugh") return "laugh";
  if (v === "😡" || v.toLowerCase() === "angry") return "angry";
  if (v === "😎" || v.toLowerCase() === "cool") return "cool";
  return "";
}
function assignColorsRandom(room) {
  for (const p of Array.from(room.players.values())) if (!isConnectedPlayer(p)) room.players.delete(p.id);
  const connected = Array.from(room.players.values()).filter(p => isConnectedPlayer(p));
  for (const p of connected) p.color = null;
  if (connected.length === 0) return;
  if (connected.length > 2) connected.length = 2;
  shuffleInPlace(connected);
  const firstColor = (Math.random() < 0.5) ? "red" : "blue";
  connected[0].color = firstColor;
  if (connected[1]) connected[1].color = (firstColor === "red") ? "blue" : "red";
}

function initGameState(room, options = {}) {
  const pieces = [];
  for (const color of ["red", "blue"]) {
    const houses = (BOARD.nodes || [])
      .filter(n => n.kind === "house" && String(n.flags?.houseColor || "").toLowerCase() === color)
      .sort((a, b) => (a.flags?.houseSlot ?? 0) - (b.flags?.houseSlot ?? 0));
    for (let i = 0; i < 5; i++) {
      pieces.push({ id:`p_${color}_${i + 1}`, label:i + 1, color, posKind:"house", houseId:houses[i]?.id || houses[0]?.id || null, nodeId:null });
    }
  }
  const barricades = (BOARD.nodes || []).filter(n => n.kind === "board" && n.flags?.run).map(n => n.id);
  const turnColor = String(options.starterColor || "").toLowerCase().trim();
  const effectiveTurnColor = (turnColor === "red" || turnColor === "blue") ? turnColor : ((Math.random() < 0.5) ? "red" : "blue");
  room.lastRollWasSix = false;
  room.carryingByColor = { red: false, blue: false };
  const mode = String(options.mode || "classic").toLowerCase() === "action" ? "action" : "classic";
  const jokerStart = normalizeJokerStartConfig(options.startJokers || room.lobby?.jokerStart || null);
  room.state = { started:true, paused:false, turnColor:effectiveTurnColor, phase:"need_roll", rolled:null, pieces, barricades, goal:GOAL, mode, activeColors:["red","blue"] };
  if(mode === "action"){
    room.state.action = {};
    room.state.action.startJokers = cloneJokerConfig(jokerStart);
    if(jokerStart){
      room.state.action.jokersByColor = {};
      room.state.action.jokersOwned = {};
      for(const color of ["red","blue"]){
        room.state.action.jokersByColor[color] = { allColors:jokerStart.allColors, barricade:jokerStart.barricade, reroll:jokerStart.reroll, double:jokerStart.double };
        const arr = [];
        for(const type of ["allColors","barricade","reroll","double"]){
          for(let i=0;i<Number(jokerStart[type] || 0);i++) arr.push({ type, color });
        }
        room.state.action.jokersOwned[color] = arr;
      }
    }
  }
}
function otherColor(c) { return c === "red" ? "blue" : "red"; }
function getPiece(room, pieceId) { return room.state?.pieces?.find(p => p.id === pieceId) || null; }
function occupiedByColor(room, color, excludePieceId = null) {
  const set = new Set();
  for (const p of room.state.pieces) {
    if (p.color !== color) continue;
    if (excludePieceId && p.id === excludePieceId) continue;
    if (p.posKind === "board" && p.nodeId) set.add(p.nodeId);
  }
  return set;
}
function occupiedAny(room) { const set = new Set(); for (const p of room.state.pieces) if (p.posKind === "board" && p.nodeId) set.add(p.nodeId); return set; }
function nextFreeHouseId(room, color) {
  const homes = HOUSE_BY_COLOR[color] || [];
  if (!homes.length) return null;
  const used = new Set();
  for (const p of room.state.pieces) if (p.color === color && p.posKind === "house" && p.houseId) used.add(p.houseId);
  for (const hid of homes) if (!used.has(hid)) return hid;
  return homes[0] || null;
}
function sendPieceHome(room, piece) { piece.posKind = "house"; piece.nodeId = null; piece.houseId = nextFreeHouseId(room, piece.color); }
function isPlacableBarricade(room, nodeId) {
  const n = NODES.get(nodeId);
  if (!n || n.kind !== "board") return false;
  if (n.flags?.goal) return false;
  if (room.state.barricades.includes(nodeId)) return false;
  if (occupiedAny(room).has(nodeId)) return false;
  return true;
}
function computeAllTargets(room, startNodeId, steps, color, pieceId) {
  const blockedEnd = occupiedByColor(room, color, pieceId);
  const barricades = new Set(room.state.barricades || []);
  const targets = new Map();
  function dfs(node, depth, prevNode, visited, pathArr) {
    if (depth === steps) { if (!blockedEnd.has(node) && !targets.has(node)) targets.set(node, [...pathArr]); return; }
    const neigh = ADJ.get(node); if (!neigh) return;
    for (const nx of neigh) {
      if (prevNode && nx === prevNode) continue;
      if (visited.has(nx)) continue;
      if (barricades.has(nx) && (depth + 1) < steps) continue;
      if ((depth + 1) === steps && blockedEnd.has(nx)) continue;
      visited.add(nx); pathArr.push(nx); dfs(nx, depth + 1, node, visited, pathArr); pathArr.pop(); visited.delete(nx);
    }
  }
  dfs(startNodeId, 0, null, new Set([startNodeId]), [startNodeId]);
  return targets;
}
function pathForTarget(room, piece, targetId) {
  const roll = room.state.rolled;
  if (!(roll >= 1 && roll <= 6)) return { ok: false, msg: "no roll" };
  const startField = STARTS[piece.color];
  if (!startField || !NODES.has(startField)) return { ok: false, msg: "missing start in board.meta.starts" };
  if (piece.posKind === "house") {
    const remaining = roll - 1;
    if (remaining === 0) return targetId === startField ? { ok:true, path:[startField] } : { ok:false, msg:"with roll=1 you must go to start" };
    const p = computeAllTargets(room, startField, remaining, piece.color, piece.id).get(targetId);
    return p ? { ok:true, path:p } : { ok:false, msg:"illegal target" };
  }
  if (piece.posKind === "board") {
    const p = computeAllTargets(room, piece.nodeId, roll, piece.color, piece.id).get(targetId);
    return p ? { ok:true, path:p } : { ok:false, msg:"illegal target" };
  }
  return { ok:false, msg:"unknown piece pos" };
}
function requireRoomState(room, ws) { if (!room.state) { send(ws, { type:"error", code:"NO_STATE", message:"Spiel nicht gestartet" }); return false; } return true; }
function requireTurn(room, clientId, ws) {
  const me = room.players.get(clientId);
  if (!me?.color) { send(ws, { type:"error", code:"SPECTATOR", message:"Du hast keine Farbe" }); return false; }
  if (room.state.paused) { send(ws, { type:"error", code:"PAUSED", message:"Spiel pausiert" }); return false; }
  if (room.state.turnColor !== me.color) { send(ws, { type:"error", code:"NOT_YOUR_TURN", message:`Nicht dran. Dran: ${room.state.turnColor.toUpperCase()}` }); return false; }
  return true;
}

function shortestDistanceToGoal(startNodeId) {
  if (!startNodeId || !GOAL || !NODES.has(startNodeId) || !NODES.has(GOAL)) return Infinity;
  if (startNodeId === GOAL) return 0;
  const q = [[startNodeId, 0]];
  const seen = new Set([startNodeId]);
  while (q.length) {
    const [nodeId, dist] = q.shift();
    const neigh = ADJ.get(nodeId);
    if (!neigh) continue;
    for (const nx of neigh) {
      if (seen.has(nx)) continue;
      if (nx === GOAL) return dist + 1;
      seen.add(nx);
      q.push([nx, dist + 1]);
    }
  }
  return Infinity;
}
function bestForfeitWinnerColor(room, forfeiterColor) {
  const active = Array.isArray(room?.state?.activeColors) && room.state.activeColors.length
    ? room.state.activeColors.map(c => String(c || "").toLowerCase())
    : Array.from(room.players.values()).map(p => String(p.color || "").toLowerCase()).filter(Boolean);

  let winnerColor = null;
  let bestDist = Infinity;

  for (const color of active) {
    if (!color || color === forfeiterColor) continue;
    const pieces = Array.isArray(room?.state?.pieces)
      ? room.state.pieces.filter(p => p && String(p.color || "").toLowerCase() === color)
      : [];
    let colorBest = Infinity;
    for (const piece of pieces) {
      if (piece.posKind === "board" && piece.nodeId) {
        colorBest = Math.min(colorBest, shortestDistanceToGoal(piece.nodeId));
      } else if (piece.posKind === "house") {
        const startField = STARTS[color];
        if (startField) colorBest = Math.min(colorBest, 1 + shortestDistanceToGoal(startField));
      }
    }
    if (colorBest < bestDist) {
      bestDist = colorBest;
      winnerColor = color;
    }
  }

  if (!winnerColor) {
    winnerColor = active.find(c => c && c !== forfeiterColor) || null;
  }
  return winnerColor;
}

wss.on("connection", (ws) => {
  const clientId = uid();
  clients.set(clientId, { ws, room:null, name:null, sessionToken:null });
  send(ws, { type:"hello", clientId });

  ws.on("message", (buf) => {
    let msg; try { msg = JSON.parse(String(buf)); } catch (_e) { return; }
    const c = clients.get(clientId); if (!c) return;
    if (msg.type === "ping") { send(ws, { type:"pong" }); return; }

    if (msg.type === "join") {
      const roomCode = String(msg.room || "").trim().toUpperCase();
      const name = String(msg.name || "Spieler").slice(0, 32);
      const asHost = !!msg.asHost;
      const sessionToken = String(msg.sessionToken || "").slice(0, 60);
      if (!roomCode) { send(ws, { type:"error", code:"NO_ROOM", message:"Kein Raumcode" }); return; }
      if (c.room) {
        const old = rooms.get(c.room);
        if (old) { old.players.delete(clientId); broadcast(old, { type:"room_update", players:currentPlayersList(old), canStart:canStart(old), jokerStart:cloneJokerConfig(old.lobby?.jokerStart || old.state?.action?.startJokers || null) }); }
      }
      let room = rooms.get(roomCode);
      if (!room) { room = makeRoom(roomCode); rooms.set(roomCode, room); }
      if (!room.state) restoreRoomState(room);
      if(!room.lobby) room.lobby = { jokerStart: cloneJokerConfig(room.state?.action?.startJokers || null) };
      let existing = null;
      if (sessionToken) for (const p of room.players.values()) if (p.sessionToken && p.sessionToken === sessionToken) { existing = p; break; }
      if (existing) room.players.delete(existing.id);
      let isHost = false;
      if (!room.hostToken) {
        if (existing?.isHost && existing?.sessionToken) room.hostToken = existing.sessionToken;
        else if (asHost && sessionToken) room.hostToken = sessionToken;
      }
      if (room.hostToken && sessionToken && sessionToken === room.hostToken) isHost = true;
      if (isHost) for (const p of room.players.values()) p.isHost = false;
      const COLORS = ["red", "blue"];
      let color = existing?.color || null;
      if (!color) {
        for (const p of Array.from(room.players.values())) if (p.color && !isConnectedPlayer(p)) room.players.delete(p.id);
        const usedNow = Array.from(room.players.values()).map(p => p.color).filter(Boolean);
        if (Array.from(room.players.values()).filter(p => p.color && isConnectedPlayer(p)).length >= 2) { send(ws, { type:"error", code:"ROOM_FULL", message:"Raum ist voll (max. 2 Spieler)." }); return; }
        color = usedNow.length === 0 ? COLORS[randInt(0, 1)] : (COLORS.find(cc => !usedNow.includes(cc)) || null);
      }
      if (!color) { send(ws, { type:"error", code:"NO_COLOR", message:"Keine Farbe verfügbar" }); return; }
      room.players.set(clientId, { id:clientId, name, color, isHost, sessionToken, lastSeen:Date.now() });
      c.room = roomCode; c.name = name; c.sessionToken = sessionToken;
      if (room.state) { enforcePauseIfNotReady(room); persistRoomState(room); }
      const payload = { type:"room_update", players:currentPlayersList(room), canStart:canStart(room), jokerStart:cloneJokerConfig(room.lobby?.jokerStart || room.state?.action?.startJokers || null) };
      send(ws, payload); broadcast(room, payload);
      if (room.state) send(ws, { type:"snapshot", state:room.state });
      // Falls während eines kurzen Reconnects ein Emoji kam, jetzt zuverlässig nachliefern.
      replayPendingEmojiForClient(room, clientId);
      return;
    }

    const roomCode = c.room; if (!roomCode) return;
    const room = rooms.get(roomCode); if (!room) return;

    if (msg.type === "emoji_ack") {
      ackReliableEmoji(room, clientId, msg.eventId || msg.reactionId);
      return;
    }

    if (msg.type === "emoji_send") {
      const me = room.players.get(clientId);
      if (!me) { send(ws, { type:"error", code:"NO_PLAYER", message:"Spieler nicht gefunden" }); return; }
      if (!room.state || !room.state.started) { send(ws, { type:"error", code:"NO_STATE", message:"Spiel läuft nicht" }); return; }
      const key = normalizeEmojiKey(msg.emoji);
      if (!key) { send(ws, { type:"error", code:"BAD_EMOJI", message:"Ungültiges Emoji" }); return; }
      const now = Date.now();
      const last = Number(room.emojiCooldowns.get(clientId) || 0);
      if ((now - last) < 1800) return;
      room.emojiCooldowns.set(clientId, now);

      // Nicht mehr fire-and-forget: Event bleibt kurz serverseitig offen,
      // bis alle Spielersitzungen bestätigt haben oder die TTL abläuft.
      queueReliableEmoji(room, clientId, me, key, msg.reactionId);
      return;
    }


    if (msg.type === "forfeit") {
      const me = room.players.get(clientId);
      if (!me?.color) { send(ws, { type:"error", code:"NO_COLOR", message:"Keine Spielerfarbe gefunden" }); return; }
      if (!room.state || !room.state.started) { send(ws, { type:"error", code:"NO_STATE", message:"Spiel läuft nicht" }); return; }

      const forfeiterColor = String(me.color).toLowerCase();
      const winnerColor = bestForfeitWinnerColor(room, forfeiterColor);

      room.state.finished = true;
      room.state.phase = "game_over";
      room.state.winnerColor = winnerColor;
      room.state.forfeiterColor = forfeiterColor;
      room.state.rolled = null;
      room.state.paused = false;

      persistRoomState(room);
      broadcast(room, {
        type:"forfeit",
        by: forfeiterColor,
        winnerColor,
        state: room.state
      });
      return;
    }

    if (msg.type === "leave") {
      room.players.delete(clientId); c.room = null;
      send(ws, { type:"room_update", players:[], canStart:false, jokerStart:cloneJokerConfig(room.lobby?.jokerStart || room.state?.action?.startJokers || null) });
      broadcast(room, { type:"room_update", players:currentPlayersList(room), canStart:canStart(room), jokerStart:cloneJokerConfig(room.lobby?.jokerStart || room.state?.action?.startJokers || null) });
      return;
    }

    if (msg.type === "set_joker_count") {
      const me = room.players.get(clientId);
      if (!me?.isHost) { send(ws, { type:"error", code:"NOT_HOST", message:"Nur Host" }); return; }
      const cfg = normalizeJokerStartConfig(msg.count ?? msg.value ?? msg.jokerCount ?? msg.startJokers);
      if (!cfg) { send(ws, { type:"error", code:"BAD_JOKER_COUNT", message:"Jokerzahl muss 1 bis 5 sein" }); return; }
      room.lobby.jokerStart = cfg;
      if (room.state?.action && room.state.mode === "action") room.state.action.startJokers = cloneJokerConfig(cfg);
      broadcast(room, { type:"room_update", players:currentPlayersList(room), canStart:canStart(room), jokerStart:cloneJokerConfig(cfg) });
      return;
    }

    if (msg.type === "start") {
      const me = room.players.get(clientId);
      if (!me?.isHost) { send(ws, { type:"error", code:"NOT_HOST", message:"Nur Host kann starten" }); return; }
      if (!canStart(room)) { send(ws, { type:"error", code:"NEED_2P", message:"Mindestens 2 Spieler nötig" }); return; }
      const mode = String(msg.mode || "classic").toLowerCase() === "action" ? "action" : "classic";
      const starterColor = String(msg.starterColor || msg.starter || "").toLowerCase().trim();
      const startJokers = normalizeJokerStartConfig(msg.startJokers || room.lobby?.jokerStart || null);
      if (mode === "action" && !startJokers) { send(ws, { type:"error", code:"NEED_JOKER_COUNT", message:"Host muss 1 bis 5 Joker wählen" }); return; }
      if (startJokers) room.lobby.jokerStart = startJokers;
      initGameState(room, { mode, starterColor, startJokers });
      persistRoomState(room);
      broadcast(room, { type:"started", state:room.state });
      return;
    }

    if (msg.type === "reset") {
      deletePersisted(room);
      const me = room.players.get(clientId);
      if (!me?.isHost) { send(ws, { type:"error", code:"NOT_HOST", message:"Nur Host kann resetten" }); return; }
      room.state = null; room.lastRollWasSix = false; room.carryingByColor = { red:false, blue:false };
      assignColorsRandom(room);
      broadcast(room, { type:"room_update", players:currentPlayersList(room), canStart:canStart(room), jokerStart:cloneJokerConfig(room.lobby?.jokerStart || null) });
      broadcast(room, { type:"reset_done" });
      return;
    }

    if (msg.type === "resume") {
      const me = room.players.get(clientId);
      if (!me?.isHost) { send(ws, { type:"error", code:"NOT_HOST", message:"Nur Host kann fortsetzen" }); return; }
      if (!room.state) { send(ws, { type:"error", code:"NO_STATE", message:"Spiel nicht gestartet" }); return; }
      if (!canStart(room)) { room.state.paused = true; persistRoomState(room); send(ws, { type:"error", code:"NEED_2P", message:"Warte auf 2 Spieler…" }); broadcast(room, { type:"snapshot", state:room.state }); return; }
      room.state.paused = false; persistRoomState(room); broadcast(room, { type:"snapshot", state:room.state });
      return;
    }

    if (msg.type === "roll_request") {
      if (!requireRoomState(room, ws) || !requireTurn(room, clientId, ws)) return;
      if (room.state.phase !== "need_roll") { send(ws, { type:"error", code:"BAD_PHASE", message:"Erst Zug beenden" }); return; }
      const v = randInt(1, 6); room.state.rolled = v; room.lastRollWasSix = (v === 6); room.state.phase = "need_move"; persistRoomState(room); broadcast(room, { type:"roll", value:v, state:room.state }); return;
    }

    if (msg.type === "end_turn" || msg.type === "skip_turn") {
      if (!requireRoomState(room, ws) || !requireTurn(room, clientId, ws)) return;
      if (room.state.phase === "place_barricade") { send(ws, { type:"error", code:"BAD_PHASE", message:"Erst Barikade platzieren" }); return; }
      room.lastRollWasSix = false; room.state.rolled = null; room.state.phase = "need_roll"; room.state.turnColor = otherColor(room.state.turnColor); persistRoomState(room); broadcast(room, { type:"move", state:room.state }); return;
    }

    if (msg.type === "legal_request") {
      if (!requireRoomState(room, ws) || !requireTurn(room, clientId, ws)) return;
      if (room.state.phase !== "need_move") { send(ws, { type:"error", code:"BAD_PHASE", message:"Erst würfeln" }); return; }
      const pc = getPiece(room, String(msg.pieceId || ""));
      if (!pc || pc.color !== room.state.turnColor) { send(ws, { type:"error", code:"BAD_PIECE", message:"Ungültige Figur" }); return; }
      const roll = room.state.rolled;
      const startField = STARTS[pc.color];
      let targets = new Map();
      if (pc.posKind === "house") {
        const remaining = roll - 1;
        if (remaining === 0) targets = new Map([[startField, [startField]]]);
        else targets = computeAllTargets(room, startField, remaining, pc.color, pc.id);
      } else targets = computeAllTargets(room, pc.nodeId, roll, pc.color, pc.id);
      send(ws, { type:"legal", pieceId:pc.id, targets:Array.from(targets.keys()) });
      return;
    }

    if (msg.type === "export_state") {
      const me = room.players.get(clientId);
      if (!me?.isHost) return send(ws, { type:"error", code:"HOST_ONLY", message:"Nur Host" });
      if (!room.state) return send(ws, { type:"error", code:"NO_STATE", message:"Spiel nicht gestartet" });
      return send(ws, { type:"export_state", code:room.code, state:room.state, ts:Date.now() });
    }

    if (msg.type === "import_state") {
      const me = room.players.get(clientId);
      if (!me?.isHost) return send(ws, { type:"error", code:"HOST_ONLY", message:"Nur Host" });
      const st = msg.state;
      if (!st || typeof st !== "object") return send(ws, { type:"error", code:"BAD_STATE", message:"Ungültiger State" });
      if (!st.turnColor || !st.phase || !Array.isArray(st.pieces) || !Array.isArray(st.barricades)) return send(ws, { type:"error", code:"BAD_STATE", message:"State-Format passt nicht" });
      room.state = st; room.state.paused = false;
      if (room.state?.action?.startJokers) room.lobby.jokerStart = normalizeJokerStartConfig(room.state.action.startJokers) || room.lobby.jokerStart || null;
      persistRoomState(room); broadcast(room, { type:"snapshot", state:room.state, players:currentPlayersList(room) }); return;
    }

    if (msg.type === "move_request") {
      if (!requireRoomState(room, ws) || !requireTurn(room, clientId, ws)) return;
      if (room.state.phase !== "need_move") { send(ws, { type:"error", code:"BAD_PHASE", message:"Erst würfeln" }); return; }
      const pc = getPiece(room, String(msg.pieceId || ""));
      const targetId = String(msg.targetId || "");
      if (!pc || pc.color !== room.state.turnColor) { send(ws, { type:"error", code:"BAD_PIECE", message:"Ungültige Figur" }); return; }
      const res = pathForTarget(room, pc, targetId);
      if (!res.ok) { send(ws, { type:"error", code:"ILLEGAL", message:res.msg || "illegal" }); return; }
      pc.posKind = "board"; pc.nodeId = res.path[res.path.length - 1];
      const landed = pc.nodeId;
      const kicked = [];
      for (const op of room.state.pieces) {
        if (op.posKind === "board" && op.nodeId === landed && op.color !== pc.color) { sendPieceHome(room, op); kicked.push(op.id); }
      }
      const idx = room.state.barricades.indexOf(landed);
      let picked = false;
      if (idx >= 0) { room.state.barricades.splice(idx, 1); picked = true; room.carryingByColor[pc.color] = true; room.state.phase = "place_barricade"; }
      else room.state.phase = "need_roll";
      if (!picked) {
        room.state.turnColor = room.lastRollWasSix ? pc.color : otherColor(pc.color);
        room.state.phase = "need_roll"; room.state.rolled = null;
      }
      broadcast(room, { type:"move", action:{ pieceId:pc.id, path:res.path, pickedBarricade:picked, kickedPieces:kicked }, state:room.state });
      persistRoomState(room); return;
    }

    if (msg.type === "place_barricade") {
      if (!requireRoomState(room, ws)) return;
      if (room.state.phase !== "place_barricade") { send(ws, { type:"error", code:"BAD_PHASE", message:"Keine Barikade zu platzieren" }); return; }
      const me = room.players.get(clientId);
      if (!me?.color) { send(ws, { type:"error", code:"SPECTATOR", message:"Du hast keine Farbe" }); return; }
      const color = room.state.turnColor;
      if (me.color !== color) { send(ws, { type:"error", code:"NOT_YOUR_TURN", message:"Nicht dein Zug" }); return; }
      if (!room.carryingByColor[color]) { send(ws, { type:"error", code:"NO_BARRICADE", message:"Du trägst keine Barikade" }); return; }
      let nodeId = String(msg.nodeId || msg.at || msg.id || msg.targetId || msg?.node?.id || "").trim();
      if (!nodeId && (typeof msg.nodeId === "number" || typeof msg.at === "number" || typeof msg.id === "number")) {
        const idx = Number(msg.nodeId ?? msg.at ?? msg.id); const n = (BOARD.nodes || [])[idx]; if (n?.id) nodeId = String(n.id);
      }
      if (nodeId && !NODES.has(nodeId)) { const m = String(nodeId).match(/(\d+)/); if (/^\d+$/.test(nodeId)) nodeId = `n_${nodeId}`; else if (m) nodeId = `n_${m[1]}`; }
      if (!nodeId) { send(ws, { type:"error", code:"NO_NODE", message:"Kein Zielfeld" }); return; }
      if (!isPlacableBarricade(room, nodeId)) { send(ws, { type:"error", code:"BAD_NODE", message:"Hier darf keine Barikade hin" }); return; }
      room.state.barricades.push(nodeId); room.carryingByColor[color] = false; room.state.turnColor = room.lastRollWasSix ? color : otherColor(color); room.state.phase = "need_roll"; room.state.rolled = null; persistRoomState(room); broadcast(room, { type:"snapshot", state:room.state }); return;
    }
  });

  ws.on("close", () => {
    const c = clients.get(clientId); if (!c) return;
    const roomCode = c.room;
    if (roomCode) {
      const room = rooms.get(roomCode);
      if (room) {
        const p = room.players.get(clientId);
        if (p) p.lastSeen = Date.now();
        if (room.state && p?.color && room.state.turnColor === p.color) room.state.paused = true;
        if (room.state && !Array.from(room.players.values()).some(pp => isConnectedPlayer(pp))) room.state.paused = true;
        enforcePauseIfNotReady(room);
        broadcast(room, { type:"room_update", players:currentPlayersList(room), canStart:canStart(room), jokerStart:cloneJokerConfig(room.lobby?.jokerStart || room.state?.action?.startJokers || null) });
        if (room.state) persistRoomState(room);
        broadcast(room, { type:"snapshot", state:room.state });
      }
    }
    clients.delete(clientId);
  });
});

const emojiRetryTimer = setInterval(() => {
  const now = Date.now();
  for(const room of rooms.values()){
    if(!room?.emojiPending?.size) continue;
    pruneEmojiPending(room, now);
    for(const entry of room.emojiPending.values()){
      if((now - Number(entry.lastSendAt || 0)) < EMOJI_RETRY_MS) continue;
      sendPendingEmoji(room, entry);
    }
  }
}, EMOJI_RETRY_MS);
if(typeof emojiRetryTimer.unref === "function") emojiRetryTimer.unref();

server.listen(PORT, () => console.log("Barikade server listening on", PORT));
