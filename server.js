// Mittelalter – Phase 1.1 (mit Barrikaden)
// ✅ Figuren dürfen übersprungen werden (AUßER Barrikaden – die blocken den Weg!)
// ✅ Nur Endfeld wird geprüft (1 Figur pro Feld)
// ✅ Gegner können geschmissen werden
// ✅ Bei 6: nochmal würfeln (nach evtl. Barrikaden-Platzierung)
// ✅ Barrikade:
//    - darf NICHT übersprungen werden (blockt Zwischen-Schritte)
//    - wenn du drauf landest: automatisch aufnehmen
//    - danach: irgendwo frei platzieren (auch auf Ereignisfelder / Spezialfelder)
//    - (Sicherheit) NICHT auf Startfelder platzieren

(() => {

const canvas = document.getElementById("boardCanvas");
canvas.style.touchAction = "none";
const ctx = canvas.getContext("2d");
const btnRoll = document.getElementById("btnRoll");
const btnFit = document.getElementById("btnFit");
const dieBox = document.getElementById("dieBox");
const statusLine = document.getElementById("statusLine");

// Joker UI (Sidebar)
const jokerButtonsWrap = document.getElementById("jokerButtons");
const jokerHint = document.getElementById("jokerHint");


// ---------- On-Screen Console (Debug Overlay) ----------
// Hilft besonders auf Tablet/Handy, wenn man DevTools nicht sieht.
// Toggle: Taste ` (Backtick) oder Button oben rechts (klein).
function installOnScreenConsole(){
  if(document.getElementById("osConsole")) return;

  const wrap = document.createElement("div");
  wrap.id = "osConsole";
  wrap.style.cssText = [
    "position:fixed",
    "right:12px",
    "bottom:12px",
    "width:min(520px, calc(100vw - 24px))",
    "max-height:40vh",
    "display:none",
    "flex-direction:column",
    "z-index:99999",
    "border-radius:14px",
    "overflow:hidden",
    "background:rgba(10,12,18,.92)",
    "box-shadow:0 12px 40px rgba(0,0,0,.45)",
    "backdrop-filter: blur(10px)",
    "-webkit-backdrop-filter: blur(10px)",
    "border:1px solid rgba(255,255,255,.10)"
  ].join(";");

  const bar = document.createElement("div");
  bar.style.cssText = [
    "display:flex",
    "align-items:center",
    "gap:8px",
    "padding:10px 12px",
    "background:rgba(255,255,255,.06)",
    "border-bottom:1px solid rgba(255,255,255,.08)",
    "font:600 12px system-ui, -apple-system, Segoe UI, Roboto, Arial",
    "color:rgba(240,245,255,.92)",
    "user-select:none",
    "cursor:move"
  ].join(";");

  const title = document.createElement("div");
  title.textContent = "Debug Console";
  title.style.flex = "1";

  const btnClear = document.createElement("button");
  btnClear.textContent = "Clear";
  btnClear.style.cssText = "all:unset; padding:6px 10px; border-radius:10px; background:rgba(255,255,255,.10); cursor:pointer;";
  btnClear.onmouseenter=()=>btnClear.style.background="rgba(255,255,255,.16)";
  btnClear.onmouseleave=()=>btnClear.style.background="rgba(255,255,255,.10)";

  const btnHide = document.createElement("button");
  btnHide.textContent = "Hide";
  btnHide.style.cssText = "all:unset; padding:6px 10px; border-radius:10px; background:rgba(255,255,255,.10); cursor:pointer;";
  btnHide.onmouseenter=()=>btnHide.style.background="rgba(255,255,255,.16)";
  btnHide.onmouseleave=()=>btnHide.style.background="rgba(255,255,255,.10)";

  const body = document.createElement("div");
  body.id = "osConsoleBody";
  body.style.cssText = [
    "padding:10px 12px",
    "overflow:auto",
    "font:12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
    "color:rgba(235,245,255,.92)",
    "line-height:1.35",
    "white-space:pre-wrap"
  ].join(";");

  bar.appendChild(title);
  bar.appendChild(btnClear);
  bar.appendChild(btnHide);
  wrap.appendChild(bar);
  wrap.appendChild(body);
  document.body.appendChild(wrap);

  // Small toggle button (top-right)
  const tbtn = document.createElement("button");
  tbtn.id = "osConsoleToggle";
  tbtn.textContent = "🪲";
  tbtn.title = "Debug Console (`)";
  tbtn.style.cssText = [
    "position:fixed",
    "right:14px",
    "top:74px",
    "z-index:99998",
    "width:42px",
    "height:42px",
    "border-radius:14px",
    "border:1px solid rgba(255,255,255,.12)",
    "background:rgba(10,12,18,.55)",
    "color:rgba(240,245,255,.92)",
    "box-shadow:0 10px 30px rgba(0,0,0,.35)",
    "cursor:pointer"
  ].join(";");
  document.body.appendChild(tbtn);

  function toggle(show){
    const isShown = wrap.style.display !== "none";
    const next = (typeof show === "boolean") ? show : !isShown;
    wrap.style.display = next ? "flex" : "none";
  }
  tbtn.addEventListener("click", ()=>toggle());
  btnHide.addEventListener("click", ()=>toggle(false));
  btnClear.addEventListener("click", ()=>{ body.textContent=""; });

  window.addEventListener("keydown",(e)=>{
    if(e.key === "`"){ toggle(); }
  });

  // Drag window (mouse/touch)
  let drag = null;
  const startDrag = (clientX, clientY)=>{
    const r = wrap.getBoundingClientRect();
    drag = { ox: clientX - r.left, oy: clientY - r.top };
  };
  const moveDrag = (clientX, clientY)=>{
    if(!drag) return;
    wrap.style.right = "auto";
    wrap.style.bottom = "auto";
    wrap.style.left = Math.max(8, Math.min(window.innerWidth - 8, clientX - drag.ox)) + "px";
    wrap.style.top  = Math.max(8, Math.min(window.innerHeight - 8, clientY - drag.oy)) + "px";
  };
  const endDrag = ()=>{ drag = null; };

  bar.addEventListener("pointerdown",(e)=>{ bar.setPointerCapture(e.pointerId); startDrag(e.clientX,e.clientY); });
  bar.addEventListener("pointermove",(e)=>{ moveDrag(e.clientX,e.clientY); });
  bar.addEventListener("pointerup", endDrag);
  bar.addEventListener("pointercancel", endDrag);

  const fmt = (args)=>args.map(a=>{
    try{
      if(typeof a === "string") return a;
      return JSON.stringify(a, null, 2);
    }catch(_){ return String(a); }
  }).join(" ");

  function addLine(level, args){
    const t = new Date().toLocaleTimeString();
    const line = `[${t}] ${level}: ${fmt(args)}\n`;
    body.textContent += line;
    body.scrollTop = body.scrollHeight;
  }

  // Hook console
  const orig = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    info: console.info.bind(console)
  };
  console.log = (...a)=>{ orig.log(...a); addLine("LOG", a); };
  console.info = (...a)=>{ orig.info(...a); addLine("INFO", a); };
  console.warn = (...a)=>{ orig.warn(...a); addLine("WARN", a); };
  console.error = (...a)=>{ orig.error(...a); addLine("ERR", a); };

  // Global errors
  window.addEventListener("error",(e)=>{
    addLine("JS-ERROR", [e.message, e.filename+":"+e.lineno+":"+e.colno]);
  });
  window.addEventListener("unhandledrejection",(e)=>{
    addLine("PROMISE", [String(e.reason)]);
  });

  addLine("READY", ["On-screen console installed. Press ` or click 🪲."]);
}

document.addEventListener("DOMContentLoaded", installOnScreenConsole);
document.addEventListener("DOMContentLoaded", ()=>{ try{ ensureTopTurnUI(); }catch(_){ } });

const TEAM_COLORS = {
  1: "#b33a3a", // Rot – Wappenrot
  2: "#2f5fa7", // Blau – Wappenblau
  3: "#2f7a4b", // Grün – Wappengrün
  4: "#b08a2e"  // Gold – Wappengold
};

// ---------- Joker System ----------
// Regeln (User):
// - Jeder Spieler startet mit 1 von jedem Joker.
// - Max 3 pro Sorte.
// - Beliebig viele Joker pro Zug.
// - Vor dem Wurf: Doppelwurf, Barrikade versetzen, Spieler tauschen
// - Nach dem Wurf: Neuwurf, Schutzschild, Alle Farben

const JOKER_MAX_PER_TYPE = 3;

const JOKERS = [
  { id:"double",      name:"Doppelwurf",            timing:"before" },
  { id:"moveBarricade", name:"Barrikade versetzen", timing:"before" },
  { id:"swap",        name:"Spieler tauschen",     timing:"before" },
  { id:"reroll",      name:"Neuwurf",              timing:"after"  },
  { id:"shield",      name:"Schutzschild",         timing:"after"  },
  { id:"allcolors",   name:"Alle Farben",          timing:"after"  }
];

function baseJokerLoadout(){
  const inv = {};
  for(const j of JOKERS) inv[j.id] = 1;
  return inv;
}

function ensureJokerState(){
  if(!state.jokers) state.jokers = {1:baseJokerLoadout(),2:baseJokerLoadout(),3:baseJokerLoadout(),4:baseJokerLoadout()};
  if(!state.jokerFlags) state.jokerFlags = { double:false, allcolors:false };
  if(!state.jokerMode) state.jokerMode = null; // swapPickA|swapPickB|moveBarricadePick|moveBarricadePlace|shieldPick
  if(!state.jokerData) state.jokerData = {};
  if(!state.jokerHighlighted) state.jokerHighlighted = new Set();
}

function jokerCount(team, id){
  ensureJokerState();
  const inv = state.jokers[team] || {};
  return Number(inv[id] || 0);
}

function consumeJoker(team, id){
  ensureJokerState();
  if(jokerCount(team,id) <= 0) return false;
  state.jokers[team][id] = jokerCount(team,id) - 1;
  return true;
}


function removeRandomJoker(team, amount=1){
  ensureJokerState();
  amount = Math.max(1, amount|0);
  let removed = 0;
  for(let i=0;i<amount;i++){
    const pool = [];
    for(const j of JOKERS){
      const c = jokerCount(team, j.id);
      if(c>0) pool.push(j.id);
    }
    if(!pool.length) break;
    const id = pool[Math.floor(Math.random()*pool.length)];
    const c = jokerCount(team,id);
    state.jokers[team][id] = clamp(c-1,0,JOKER_MAX);
    removed++;
  }
  if(removed) updateJokerUI();
  ensureEventSelectUI();
  return removed;
}

function addJoker(team, id, amount=1){
  ensureJokerState();
  const cur = jokerCount(team,id);
  state.jokers[team][id] = clamp(cur + (amount||0), 0, JOKER_MAX_PER_TYPE);
}

// ---------- Camera (Pan / Zoom) ----------
// World = Node-Koordinaten aus board.json
// Screen = Canvas Pixel (CSS px)
// Wir zeichnen in World-Koordinaten und transformieren mit cam.
const cam = {
  x: 0,   // translate in screen px
  y: 0,
  s: 1    // scale
};

const camLimits = { minS: 0.35, maxS: 2.5 };

function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }

// --- Camera bounds (prevents "board flies away") ---
// We clamp cam.x/cam.y so the board stays within the viewport with a margin.
// Works for all scales (pinch/wheel) and prevents the "jump" after fast zoom.
let _boardBoundsCache = null; // {minX,maxX,minY,maxY}

function computeBoardBoundsWorld(padWorld=26){
  if(!nodes || !nodes.length) return {minX:0,maxX:0,minY:0,maxY:0};
  let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
  for(const n of nodes){
    if(!n) continue;
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x);
    maxY = Math.max(maxY, n.y);
  }
  // expand bounds a bit so nodes on the edge are still reachable
  return {
    minX: minX - padWorld,
    minY: minY - padWorld,
    maxX: maxX + padWorld,
    maxY: maxY + padWorld
  };
}

function clampCameraToBoard(marginPx=70){
  if(!canvas) return;
  const cw = canvas.clientWidth || canvas.width || 0;
  const ch = canvas.clientHeight || canvas.height || 0;
  if(cw<=0 || ch<=0) return;

  const b = _boardBoundsCache || (_boardBoundsCache = computeBoardBoundsWorld(28));
  const s = cam.s || 1;

  const viewMinX = marginPx;
  const viewMaxX = cw - marginPx;
  const viewMinY = marginPx;
  const viewMaxY = ch - marginPx;

  // Allowed cam ranges so the whole board stays inside the viewport (with margins).
  // Works for BOTH cases:
  // - board larger than view: you can pan, but can't lose the board
  // - board smaller than view: you can still pan a bit, but it remains fully visible
  let minCamX = viewMaxX - b.maxX * s;
  let maxCamX = viewMinX - b.minX * s;
  if(minCamX > maxCamX){ const t=minCamX; minCamX=maxCamX; maxCamX=t; }

  let minCamY = viewMaxY - b.maxY * s;
  let maxCamY = viewMinY - b.minY * s;
  if(minCamY > maxCamY){ const t=minCamY; minCamY=maxCamY; maxCamY=t; }

  cam.x = clamp(cam.x, minCamX, maxCamX);
  cam.y = clamp(cam.y, minCamY, maxCamY);
}


function screenToWorld(sx, sy){
  // sx/sy sind CSS-Pixel relativ zum Canvas
  return {
    x: (sx - cam.x) / cam.s,
    y: (sy - cam.y) / cam.s
  };
}

function applyZoomAt(screenX, screenY, factor){
  const before = screenToWorld(screenX, screenY);
  cam.s = clamp(cam.s * factor, camLimits.minS, camLimits.maxS);
  const after = screenToWorld(screenX, screenY);
  // cursor stays fixed: adjust translation
  cam.x += (after.x - before.x) * cam.s;
  cam.y += (after.y - before.y) * cam.s;
  clampCameraToBoard(70);
}

function fitToBoard(padding=40){
  if(!nodes || !nodes.length) return;
  let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
  for(const n of nodes){
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x);
    maxY = Math.max(maxY, n.y);
  }
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  const bw = Math.max(1, (maxX - minX));
  const bh = Math.max(1, (maxY - minY));
  const sX = (cw - padding*2) / bw;
  const sY = (ch - padding*2) / bh;
  cam.s = clamp(Math.min(sX, sY), camLimits.minS, camLimits.maxS);

  // center bbox
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  cam.x = cw/2 - cx*cam.s;
  cam.y = ch/2 - cy*cam.s;
  clampCameraToBoard(70);
}

let board, nodes=[], edges=[];
let nodesById = new Map();
let adj = new Map();

// Barrikaden-Positionen (separat vom Node-Type, damit wir sie "wegnehmen" & woanders platzieren können)
const barricades = new Set(); // nodeId

const state = {
  players:[1,2,3,4],
  playerCount:4,
  turn:0,
  roll:null,
  phase:"loading", // loading | needRoll | choosePiece | chooseTarget | usePortal | placeBarricade
  selected:null,
  highlighted:new Set(),       // Move targets
  placeHighlighted:new Set(),
  jokerHighlighted:new Set(),  // Joker placement targets (e.g. barricade move)
  eventActive:new Set(),
  lastEvent:null,  // Barricade placement targets
  pieces:[],
  occupied:new Map(),
  carry: {1:0,2:0,3:0,4:0},    // wie viele Barrikaden trägt Team x
  pendingSix:false,
  extraRoll:false,

  // Joker inventory & state
  jokers: {1:baseJokerLoadout(),2:baseJokerLoadout(),3:baseJokerLoadout(),4:baseJokerLoadout()},
  jokerFlags: { double:false, allcolors:false },
  jokerMode: null,
  jokerData: {},

  // --- Event continuation (after mandatory mini-actions) ---
  eventPendingContinue: null,
  eventMoveBarricadesRemaining: 0,
  initialBarricadeLayout: null,
  ignoreBarricadesThisTurn: false,

  // --- Landing continuation (after placing a picked-up barricade) ---
  resumeLanding: null,
            // ob nach Aktion nochmal gewürfelt werden darf

  // --- Zielpunkte (Sammelziel) ---
  goalScores: {1:0,2:0,3:0,4:0}, // Punkte pro Team
  goalNodeId: null,             // aktuelles Zielpunkt-Feld (nodeId)
  bonusGoalNodeId: null,        // zusätzliches Einmal-Zielfeld mit doppelten Punkten
  bonusGoalValue: 2,            // Punktewert des Bonus-Zielfelds
  bonusLightNodeId: null,       // zusätzliches Einmal-Lichtfeld (+1 Punkt, verschwindet nach Einsammeln)
  goalToWin: 10,                // wer zuerst 10 sammelt gewinnt
  gameOver: false,              // Spiel beendet?

  // --- Boss System (max 2 gleichzeitig) ---
  bosses: [],                    // [{id,type,node,hp,visible,meta:{...}}]
  bossMaxActive: 2,
  bossIdSeq: 1,
  bossSpawnNodes: [],            // wird aus board nodes[type=boss] gefüllt
  bossTick: 0                    // Counter (für "jeden 2. Zug" etc.)
};

// ---------- Online / Server-Autorität (Würfel) ----------
const online = {
  enabled: false,
  roomCode: null,
  playerId: null,
  playerName: null,
  serverUrl: null,
  ws: null,
  connected: false,
  joined: false,
  room: null,
  currentTurnPlayerId: null,
  suppressTurnBroadcast: false,
  initDone: false,
  authoritativeMoveActorId: null
};

function qp(name){
  try{ return new URLSearchParams(location.search).get(name); }catch(_){ return null; }
}
function lsGet(keys){
  for(const k of keys){
    try{
      const v = localStorage.getItem(k);
      if(v) return v;
    }catch(_){ }
  }
  return null;
}
function resolveOnlineContext(){
  const roomCode = (qp('roomCode') || qp('room') || qp('code') || lsGet(['mittelalter_room_code','mittelalterRoomCode','roomCode']) || '').trim().toUpperCase();
  const playerId = (qp('playerId') || qp('pid') || lsGet(['mittelalter_player_id','mittelalterPlayerId','playerId']) || '').trim();
  const playerName = (qp('name') || lsGet(['mittelalter_player_name','mittelalterPlayerName','playerName']) || 'Spieler').trim();
  const serverUrlRaw = (qp('serverUrl') || qp('server') || qp('ws') || qp('wss') || lsGet(['mittelalter_server_url','mittelalterServerUrl','serverUrl']) || '').trim();
  if(!roomCode || !playerId || !serverUrlRaw) return null;
  let wsUrl = serverUrlRaw;
  if(/^https?:\/\//i.test(wsUrl)){
    wsUrl = wsUrl.replace(/^http/i, 'ws');
  }
  if(!/^wss?:\/\//i.test(wsUrl)) return null;
  return { roomCode, playerId, playerName, serverUrl: wsUrl };
}
function isOnlineAuthorityActive(){
  return !!(online.enabled && online.connected && online.joined);
}
function isLocalPlayersTurn(){
  if(!isOnlineAuthorityActive()) return true;
  return !!online.currentTurnPlayerId && online.currentTurnPlayerId === online.playerId;
}
function syncLocalTurnOwnerFromRoom(room){
  if(!room || !room.players || !room.players.length) return;
  const idx = Math.max(0, Math.min(room.players.length - 1, Number(room.gameState?.turnIndex || 0)));
  online.currentTurnPlayerId = room.players[idx]?.id || null;
}
function applyServerRoomState(room, opts={}){
  if(!room) return;
  online.room = room;
  syncLocalTurnOwnerFromRoom(room);

  const playerCount = Number(room.playerCount || (room.players ? room.players.length : state.players.length) || state.players.length || 4);
  if(!online.initDone){
    setPlayerCount(playerCount, { reset:true });
    online.initDone = true;
  } else if(playerCount !== state.players.length){
    setPlayerCount(playerCount, { reset:true });
  }

  const turnIndex = Math.max(0, Math.min(playerCount - 1, Number(room.gameState?.turnIndex || 0)));
  state.turn = turnIndex;
  updateTurnBadge();

  if(opts.forceNeedRoll || room.gameState?.phase === 'needRoll'){
    if(state.phase === 'loading' || state.phase === 'needRoll' || opts.forceNeedRoll){
      state.roll = null;
      state.selected = null;
      state.highlighted.clear();
      state.placeHighlighted.clear();
      ensurePortalState();
      state.portalHighlighted.clear();
      state.phase = 'needRoll';
      dieBox.textContent = '–';
    }
  }

  const snap = room.gameState?.snapshot || null;
  if(snap) applyServerSnapshot(snap, { silentDraw:true });

  if(!isLocalPlayersTurn()){
    setStatus(`Team ${currentTeam()} ist dran – Wurf wird vom Server gesteuert.`);
  }

  if(!opts.silentDraw){
    draw();
  }
}

function applyAuthoritativeRoll(roll){
  if(!roll) return;
  if(typeof roll.turnIndex === 'number'){
    state.turn = Math.max(0, Math.min(state.players.length - 1, Number(roll.turnIndex)||0));
  }
  ensureJokerState();
  state.roll = Number(roll.value || 0);
  dieBox.textContent = String(state.roll || '–');
  state.selected = null;
  state.highlighted.clear();
  state.phase = 'choosePiece';
  if(roll.double) state.jokerFlags.double = false;

  const actor = roll.byName || (roll.team ? `Team ${roll.team}` : 'Jemand');
  const parts = Array.isArray(roll.parts) && roll.parts.length ? ` (${roll.parts.join(' + ')})` : '';
  if(isLocalPlayersTurn()){
    setStatus(`${actor} würfelt ${roll.value}${parts}. Tippe eine eigene Figur an, um sie zu bewegen.`);
  }else{
    setStatus(`${actor} würfelt ${roll.value}${parts}. Alle Spieler sehen den Wurf.`);
  }
  updateTurnBadge();
  updateJokerUI();
  ensureEventSelectUI();
}
function sendServerAction(action, payload={}){
  if(!isOnlineAuthorityActive()) return false;
  try{
    online.ws.send(JSON.stringify({ type:'server_action', action, ...payload }));
    return true;
  }catch(err){
    console.warn('[ONLINE] send failed', action, err);
    return false;
  }
}
function requestServerRoll(reason='main'){
  if(!isOnlineAuthorityActive()) return false;
  if(!isLocalPlayersTurn()){
    setStatus(`Nicht du bist dran. Team ${currentTeam()} würfelt über den Server.`);
    return true;
  }
  return sendServerAction('roll_request', {
    reason,
    double: !!state.jokerFlags.double
  });
}
function broadcastTurnStateOnline(infoText){
  if(!isOnlineAuthorityActive()) return;
  if(online.suppressTurnBroadcast) return;

  const payload = {
    turnIndex: Number(state.turn || 0),
    phase: String(state.phase || 'needRoll'),
    info: infoText || null
  };

  if(online.authoritativeMoveActorId){
    if(online.playerId !== online.authoritativeMoveActorId) return;
    payload.stateSnapshot = buildFullSyncSnapshot();
    sendServerAction('finish_move', payload);
    return;
  }

  sendServerAction('turn_update', payload);
}

function buildFullSyncSnapshot(){
  ensureEventState();
  ensureBossState();
  ensurePortalState();
  ensureJokerState();
  return {
    turnIndex: Number(state.turn || 0),
    phase: String(state.phase || 'needRoll'),
    roll: Number(state.roll || 0),
    pendingSix: !!state.pendingSix,
    extraRoll: !!state.extraRoll,
    ignoreBarricadesThisTurn: !!state.ignoreBarricadesThisTurn,
    selected: state.selected || null,
    pieces: state.pieces.map(p => ({
      id: p.id,
      team: Number(p.team || 0),
      node: p.node || null,
      prev: p.prev || null,
      shielded: !!p.shielded
    })),
    barricades: Array.from(barricades || []),
    eventActive: Array.from(state.eventActive || []),
    carry: Object.assign({}, state.carry || {}),
    goalScores: Object.assign({}, state.goalScores || {}),
    goalNodeId: state.goalNodeId || null,
    bonusGoalNodeId: state.bonusGoalNodeId || null,
    bonusLightNodeId: state.bonusLightNodeId || null,
    bosses: Array.isArray(state.bosses) ? state.bosses.map(b => ({
      id: b.id,
      type: b.type,
      name: b.name,
      node: b.node || null,
      alive: b.alive !== false,
      visible: b.visible !== false,
      hits: Number(b.hits || 0),
      meta: b.meta || {}
    })) : []
  };
}

function applyServerSnapshot(snapshot, opts={}){
  if(!snapshot || typeof snapshot !== 'object') return false;
  ensureEventState();
  ensureBossState();
  ensurePortalState();
  ensureJokerState();

  if(Array.isArray(snapshot.pieces)){
    state.pieces = snapshot.pieces.map(p => ({
      id: p.id,
      team: Number(p.team || 0),
      node: p.node || null,
      prev: p.prev || null,
      shielded: !!p.shielded
    }));
    state.occupied.clear();
    for(const p of state.pieces){
      if(p && p.node) state.occupied.set(p.node, p.id);
    }
  }
  if(Array.isArray(snapshot.barricades)){
    barricades.clear();
    for(const id of snapshot.barricades){
      if(id) barricades.add(id);
    }
  }
  if(Array.isArray(snapshot.eventActive)){
    state.eventActive.clear();
    for(const id of snapshot.eventActive){
      if(id) state.eventActive.add(id);
    }
  }
  if(snapshot.carry && typeof snapshot.carry === 'object') state.carry = Object.assign({1:0,2:0,3:0,4:0}, snapshot.carry);
  if(snapshot.goalScores && typeof snapshot.goalScores === 'object') state.goalScores = Object.assign({1:0,2:0,3:0,4:0}, snapshot.goalScores);
  if('goalNodeId' in snapshot) state.goalNodeId = snapshot.goalNodeId || null;
  if('bonusGoalNodeId' in snapshot) state.bonusGoalNodeId = snapshot.bonusGoalNodeId || null;
  if('bonusLightNodeId' in snapshot) state.bonusLightNodeId = snapshot.bonusLightNodeId || null;
  if(Array.isArray(snapshot.bosses)) state.bosses = snapshot.bosses.map(b => Object.assign({}, b));
  if('selected' in snapshot) state.selected = snapshot.selected || null;
  if('pendingSix' in snapshot) state.pendingSix = !!snapshot.pendingSix;
  if('extraRoll' in snapshot) state.extraRoll = !!snapshot.extraRoll;
  if('ignoreBarricadesThisTurn' in snapshot) state.ignoreBarricadesThisTurn = !!snapshot.ignoreBarricadesThisTurn;
  if('roll' in snapshot){
    state.roll = Number(snapshot.roll || 0) || null;
    dieBox.textContent = state.roll ? String(state.roll) : '–';
  }
  if(typeof snapshot.turnIndex === 'number') state.turn = Math.max(0, Math.min(state.players.length - 1, Number(snapshot.turnIndex) || 0));
  if(snapshot.phase) state.phase = String(snapshot.phase);

  state.highlighted.clear();
  state.placeHighlighted.clear();
  state.jokerHighlighted.clear();
  state.portalHighlighted.clear();
  online.lastSnapshotAt = Date.now();
  if(!opts.silentDraw) draw();
  return true;
}

function buildServerMoveSnapshot(){
  const full = buildFullSyncSnapshot();
  return {
    roll: Number(state.roll || 0),
    ignoreBarricadesThisTurn: !!state.ignoreBarricadesThisTurn,
    pieces: state.pieces.map(p => ({
      id: p.id,
      team: Number(p.team || 0),
      node: p.node || null,
      shielded: !!p.shielded
    })),
    barricades: Array.from(barricades || []),
    eventActive: full.eventActive,
    carry: full.carry,
    goalScores: full.goalScores,
    goalNodeId: full.goalNodeId,
    bonusGoalNodeId: full.bonusGoalNodeId,
    bonusLightNodeId: full.bonusLightNodeId,
    bosses: full.bosses
  };
}
function requestServerMove(pieceId, targetId, legalTargets){
  if(!isOnlineAuthorityActive()) return false;
  if(!isLocalPlayersTurn()){
    setStatus(`Nicht du bist dran. Team ${currentTeam()} steuert gerade den Zug.`);
    return true;
  }
  const targets = Array.isArray(legalTargets) ? legalTargets.filter(Boolean) : [];
  return sendServerAction('move_request', {
    pieceId: String(pieceId || ''),
    targetId: String(targetId || ''),
    legalTargets: targets,
    stateSnapshot: buildServerMoveSnapshot()
  });
}
function applyAuthoritativeMove(moveMsg, snapshot){
  if(!moveMsg) return;
  if(typeof moveMsg.turnIndex === 'number'){
    state.turn = Math.max(0, Math.min(state.players.length - 1, Number(moveMsg.turnIndex) || 0));
  }
  online.authoritativeMoveActorId = moveMsg.byPlayerId || null;

  const snap = snapshot || moveMsg.snapshot || null;
  if(snap){
    applyServerSnapshot(snap, { silentDraw:true });
    state.selected = moveMsg.pieceId || null;
    state.roll = Number(moveMsg.roll || state.roll || 0) || null;
    dieBox.textContent = state.roll ? String(state.roll) : '–';
    state.highlighted.clear();
    state.placeHighlighted.clear();
    ensurePortalState();
    state.portalHighlighted.clear();
    draw();
    return;
  }

  console.warn('[ONLINE] authoritative move without snapshot -> requesting sync', moveMsg);
  try{
    if(online.ws && online.ws.readyState === WebSocket.OPEN){
      online.ws.send(JSON.stringify({ type:'sync_request' }));
    }
  }catch(_){ }
}
function connectOnlineAuthority(){
  const ctx = resolveOnlineContext();
  if(!ctx) return;
  online.enabled = true;
  online.roomCode = ctx.roomCode;
  online.playerId = ctx.playerId;
  online.playerName = ctx.playerName;
  online.serverUrl = ctx.serverUrl;

  try{
    online.ws = new WebSocket(online.serverUrl);
  }catch(err){
    console.warn('[ONLINE] websocket init failed', err);
    return;
  }

  online.ws.addEventListener('open', ()=>{
    online.connected = true;
    console.info('[ONLINE] connected', online.serverUrl, online.roomCode, online.playerId);
    try{
      online.ws.send(JSON.stringify({
        type: 'join_room',
        roomCode: online.roomCode,
        playerId: online.playerId,
        name: online.playerName || 'Spieler'
      }));
    }catch(err){
      console.warn('[ONLINE] join send failed', err);
    }
  });

  online.ws.addEventListener('message', (ev)=>{
    let msg = null;
    try{ msg = JSON.parse(ev.data); }catch(err){ console.warn('[ONLINE] message parse failed', err); return; }
    const type = msg?.type;
    if(type === 'hello') return;
    if(type === 'room_joined' || type === 'room_created'){
      online.joined = true;
      if(msg.self?.playerId) online.playerId = msg.self.playerId;
      if(msg.room) applyServerRoomState(msg.room, { forceNeedRoll:false, silentDraw:false });
      if(sendServerAction('turn_update', { turnIndex:Number(state.turn||0), phase:String(state.phase||'needRoll') })){
        // only as soft sync for reconnect; server validates later on real actions
      }
      try{ online.ws.send(JSON.stringify({ type:'sync_request' })); }catch(_){ }
      return;
    }
    if(type === 'room_state'){
      if(msg.room) applyServerRoomState(msg.room, { forceNeedRoll:false, silentDraw:false });
      return;
    }
    if(type === 'game_started'){
      online.joined = true;
      online.authoritativeMoveActorId = null;
      if(msg.room) applyServerRoomState(msg.room, { forceNeedRoll:true, silentDraw:false });
      state.phase = 'needRoll';
      state.roll = null;
      dieBox.textContent = '–';
      setStatus(`Spiel gestartet. Team ${currentTeam()} ist dran. Der Server würfelt.`);
      return;
    }
    if(type === 'game_roll'){
      online.authoritativeMoveActorId = null;
      if(msg.room) applyServerRoomState(msg.room, { forceNeedRoll:false, silentDraw:true });
      applyAuthoritativeRoll(msg.roll);
      draw();
      return;
    }
    if(type === 'game_move'){
      if(msg.room) applyServerRoomState(msg.room, { forceNeedRoll:false, silentDraw:true });
      applyAuthoritativeMove(msg.move, msg.snapshot || msg.move?.snapshot || msg.room?.gameState?.snapshot || null);
      return;
    }
    if(type === 'game_turn_state'){
      online.authoritativeMoveActorId = null;
      if(msg.room) applyServerRoomState(msg.room, { forceNeedRoll: msg.gameState?.phase === 'needRoll', silentDraw:true });
      if(msg.gameState?.phase === 'needRoll'){
        online.suppressTurnBroadcast = true;
        state.roll = null;
        state.selected = null;
        state.highlighted.clear();
        state.placeHighlighted.clear();
        ensurePortalState();
        state.portalHighlighted.clear();
        state.phase = 'needRoll';
        dieBox.textContent = '–';
        online.suppressTurnBroadcast = false;
      }
      draw();
      return;
    }
    if(type === 'error_message'){
      console.warn('[ONLINE] server error', msg.message);
      if(msg.message) setStatus(String(msg.message));
      return;
    }
  });

  online.ws.addEventListener('close', ()=>{
    online.connected = false;
    online.joined = false;
    console.warn('[ONLINE] disconnected');
  });
  online.ws.addEventListener('error', (err)=>{
    console.warn('[ONLINE] socket error', err);
  });
}

function currentTeam(){ return state.players[state.turn]; }

function setPlayerCount(n, opts={reset:true}){
  const nn = Math.max(1, Math.min(4, Number(n)||4));
  state.playerCount = nn;
  state.players = Array.from({length: nn}, (_,i)=>i+1);
  state.turn = 0;

  // Joker: reset inventory for active players (start with 1 each)
  ensureJokerState();
  for(let t=1;t<=4;t++){
    state.jokers[t] = baseJokerLoadout();
  }
  state.jokerFlags.double = false;
  state.jokerFlags.allcolors = false;
  state.jokerMode = null;
  state.jokerData = {};
  state.jokerHighlighted.clear();

  // Reset running turn state
  state.roll = null;
  state.selected = null;
  state.highlighted.clear();
  state.placeHighlighted.clear();
  ensurePortalState();
  state.portalHighlighted.clear();
  state.portalUsedThisTurn = false;
  state.pendingSix = false;
  state.extraRoll = false;
  state.ignoreBarricadesThisTurn = false;

  if(opts.reset){
    initPieces();
    initEventFieldsFromBoard();

    // Zielpunkte zurücksetzen
    state.goalScores = {1:0,2:0,3:0,4:0};
    state.gameOver = false;
    state.bonusGoalNodeId = null;
    state.bonusLightNodeId = null;
    spawnGoalRandom(true);

    fitToBoard(60);
  }

  dieBox.textContent = "–";
  state.phase = "needRoll";
  setStatus(`Spieleranzahl: ${nn}. Team ${currentTeam()} ist dran: Würfeln.`);

  renderJokerButtons();
  updateJokerUI();
  ensureEventSelectUI();
}

function isStartNode(id){
  const n = nodesById.get(id);
  return !!n && n.type === "start";
}

function isPortalNode(id){
  const n = nodesById.get(id);
  return !!n && n.type === "portal";
}

function computePortalTargets(currentPortalId){
  ensurePortalState();
  ensurePortalState();
  state.portalHighlighted.clear();
  for(const n of nodes){
    if(n.type !== "portal") continue;
    if(n.id === currentPortalId) continue;
    if(state.occupied.has(n.id)) continue; // Zielportal muss frei sein
    state.portalHighlighted.add(n.id);
  }
}

function isFreeForBarricade(id){
  // frei heißt: kein Spieler drauf UND keine Barrikade drauf
  if (state.occupied.has(id)) return false;
  if (barricades.has(id)) return false;
  // Sicherheit: nicht auf Start platzieren
  if (isStartNode(id)) return false;
  return true;
}

function relocateBarricadeRandom(excludeIds){
  // Wählt ein zufälliges freies Feld (für Barrikaden), optional mit Ausschlussliste.
  const ex = excludeIds || new Set();
  const candidates = [];
  for(const n of nodes){
    const id = n.id;
    if(ex.has(id)) continue;
    if(!isFreeForBarricade(id)) continue;
    candidates.push(id);
  }
  if(!candidates.length) return null;
  return candidates[Math.floor(Math.random()*candidates.length)];
}


// --- Turn indicator in top status bar (always visible) ---
let _statusTextEl = null;
let _turnBadgeEl = null;

function ensureTopTurnUI(){
  if(!statusLine) return;

  // Transform statusLine into: [badge][text]
  if(!_statusTextEl){
    // keep existing text
    const prevText = statusLine.textContent || "";
    statusLine.textContent = "";

    _turnBadgeEl = document.createElement("span");
    _turnBadgeEl.id = "turnBadge";
    _turnBadgeEl.style.cssText = [
      "display:inline-flex",
      "align-items:center",
      "gap:6px",
      "padding:6px 10px",
      "margin-right:10px",
      "border-radius:999px",
      "font:800 12px system-ui, -apple-system, Segoe UI, Roboto, Arial",
      "letter-spacing:.2px",
      "border:1px solid rgba(255,255,255,.18)",
      "box-shadow:0 8px 22px rgba(0,0,0,.22)",
      "vertical-align:middle",
      "user-select:none"
    ].join(";");

    _statusTextEl = document.createElement("span");
    _statusTextEl.id = "statusText";
    _statusTextEl.textContent = prevText;

    statusLine.appendChild(_turnBadgeEl);
    statusLine.appendChild(_statusTextEl);
  }

  updateTurnBadge();
}

function updateTurnBadge(){
  if(!_turnBadgeEl) return;
  const t = currentTeam ? currentTeam() : 1;
  const col = TEAM_COLORS[t] || "#888";
  _turnBadgeEl.textContent = `▶ Team ${t} dran`;
  _turnBadgeEl.style.background = col;
  _turnBadgeEl.style.color = "rgba(255,255,255,.95)";
}

// Status text (kept separate from the badge)
function setStatus(t){
  ensureTopTurnUI();
  if(_statusTextEl) _statusTextEl.textContent = t;
  else if(statusLine) statusLine.textContent = t;
  updateTurnBadge();
}


function ensureFixedUILayout(){
  if(window.__fixedUILayoutApplied) return;
  window.__fixedUILayoutApplied = true;

  // Prevent the whole page from scrolling/zooming while interacting with the board.
  try{
    document.documentElement.style.height = "100%";
    document.body.style.height = "100%";
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";
    // Allow normal tapping on UI controls; canvas itself handles pan/zoom.
    document.body.style.touchAction = "manipulation";
  }catch(e){}

  const css = `
    html, body { height:100%; overflow:hidden; overscroll-behavior:none; }

    /* Lock the UI: topbar + sidebar fixed, only the canvas content pans/zooms */
    .topbar{
      position:fixed !important;
      top:0; left:0; right:0;
      z-index:100;
    }

    /* Main area becomes a fixed viewport below the topbar */
    .main{
      position:fixed !important;
      left:0; right:0;
      top:62px; bottom:0;
      height:auto !important;
      overflow:hidden !important;
    }

    /* Sidebar fixed on the right (desktop/tablet). */
    #sidebar{
      position:fixed !important;
      top:62px; right:0; bottom:0;
      width:280px;
      z-index:90;
      overflow:auto;
      -webkit-overflow-scrolling: touch;
    }

    /* Canvas area fills remaining space left of the sidebar */
    .canvasWrap{
      position:fixed !important;
      top:62px; left:0;
      right:280px; bottom:0;
      min-height:0 !important;
    }
    #boardCanvas{ width:100% !important; height:100% !important; display:block; touch-action:none; }

    /* Status line should stay readable but not shift layout */
    #statusLine{ position:relative !important; }

    /* Mobile: stack sidebar under the board */
    @media (max-width: 980px){
      #sidebar{ position:fixed !important; left:0; right:0; bottom:0; top:auto; width:auto; max-height:46vh; }
      .canvasWrap{ right:0; bottom:46vh; }
    }
  `;
  const st = document.createElement("style");
  st.id = "fixedUILayoutStyles";
  st.textContent = css;
  document.head.appendChild(st);

  // If the sidebar is inside another positioned container, force it to be fixed anyway.
  const sb = document.getElementById("sidebar");
  if(sb){
    sb.style.position = "fixed";
    sb.style.right = "0";
    sb.style.top = "62px";
    sb.style.bottom = "0";
    sb.style.zIndex = "90";
    sb.style.overflow = "auto";
  }
}

function ensurePortalState(){
  if(!state.portalHighlighted) state.portalHighlighted = new Set();
  if(typeof state.portalUsedThisTurn !== "boolean") state.portalUsedThisTurn = false;
}

function ensureEventState(){
  if(!state.eventActive) state.eventActive = new Set();
  if(!("lastEvent" in state)) state.lastEvent = null;
}


// ---------- Boss System ----------
const BOSS_TYPES = {
  hunter: {
    name: "Der Jäger",
    icon: "☠",
    color: "rgba(220,70,70,.95)",
    traits: [
      "Läuft Richtung Führender",
      "Berührung: Figur zurück auf Start",
      "Barrikaden blocken den Weg"
    ],
    // bewegt sich nach jedem Spielerzug
    moveEvery: 1,
    respectsShield: true
  }

  ,
  destroyer: {
    name: "Der Zerstörer",
    icon: "⚔",
    color: "rgba(255,140,60,.95)",
    traits: [
      "Bewegt sich nur am Rundenende",
      "Läuft dann 3 Felder",
      "Zerstört dabei Barrikaden (und zusätzlich 1 zufällige Barrikade)"
    ],
    // bewegt sich NUR am Ende einer kompletten Runde (alle Spieler einmal dran)
    moveOnRoundEnd: true,
    stepsPerMove: 3,
    respectsShield: true
  }

  ,
  reaper: {
    name: "Der Räuber",
    icon: "🗡",
    color: "rgba(140,90,255,.95)",
    traits: [
      "Bewegt sich nur am Rundenende",
      "Läuft dann 5 Felder",
      "Auf dem Weg: Spieler verlieren 1 zufälligen Joker",
      "Auf dem Zielfeld (⭐): Spieler wird auf Start geworfen",
      "Bei Treffer: teleportiert (min. 6 Felder Abstand zum Treffer-Spieler)",
      "Darf auf Barrikaden landen (versetzt sie), aber nicht darüber springen"
    ],
    moveOnRoundEnd: true,
    stepsPerMove: 5,
    respectsShield: true
  }

  ,
  guardian: {
    name: "Der Wächter",
    icon: "🛡",
    color: "rgba(120,220,255,.95)",
    traits: [
      "Läuft nicht",
      "Teleportiert alle 2 Spielrunden zufällig (auch auf Boss-Felder möglich)",
      "Platziert am Rundenende 1 zusätzliche Barrikade (Eventfelder erlaubt)",
      "Blockiert den Zielpunkt (⭐), wenn er darauf steht"
    ],
    moveOnRoundEnd: true,
    stepsPerMove: 0,
    respectsShield: true
  }


,
  magnet: {
    name: "Der Magnet",
    icon: "🧲",
    color: "rgba(80,170,255,.95)",
    traits: [
      "Zieht alle Figuren am Rundenende 1 Feld näher zu sich (Startfelder inkl.)",
      "Wenn Zielfeld belegt: Figur rutscht 1 Feld weiter (Reihenfolge Team 1→4)",
      "Landung auf Barrikade: Spieler platziert sie neu",
      "Zielpunkte/Ereignisse werden normal eingesammelt"
    ],
    moveOnRoundEnd: true,
    stepsPerMove: 0,
    respectsShield: true
  }};

function ensureBossState(){
  if(!Array.isArray(state.bosses)) state.bosses = [];
  if(typeof state.bossMaxActive !== "number") state.bossMaxActive = 2;
  if(typeof state.bossIdSeq !== "number") state.bossIdSeq = 1;
  if(!Array.isArray(state.bossSpawnNodes)) state.bossSpawnNodes = [];
  if(typeof state.bossTick !== "number") state.bossTick = 0;
  if(typeof state.bossAuto !== "boolean") state.bossAuto = true;
  if(typeof state.bossDebug !== "boolean") state.bossDebug = true;
  if(typeof state._bossRoundEndFlag !== "boolean") state._bossRoundEndFlag = false;
  if(typeof state.bossRoundNum !== "number") state.bossRoundNum = 0;
}

function getBossSpawnNodes(){
  return nodes.filter(n=>n && n.type==="boss").map(n=>n.id);
}

function isNodeBlockedForBoss(nodeId){
  const n = nodesById.get(nodeId);
  if(!n) return true;
  if(n.type === "start") return true;
  if(state.bosses.some(b=>b.alive!==false && b.node===nodeId)) return true;
  return false;
}

function spawnBoss(type="hunter", preferredNodeId=null){
  ensureBossState();
  const def = BOSS_TYPES[type];
  if(!def) return null;

  const alive = state.bosses.filter(b=>b.alive!==false);
  if(alive.length >= state.bossMaxActive) return null;

  if(!state.bossSpawnNodes.length) state.bossSpawnNodes = getBossSpawnNodes();
  const pool = state.bossSpawnNodes.length ? state.bossSpawnNodes.slice() : nodes.map(n=>n.id);

  let nodeId = preferredNodeId;
  if(!nodeId || isNodeBlockedForBoss(nodeId)){
    const candidates = pool.filter(id=>!isNodeBlockedForBoss(id));
    if(!candidates.length) return null;
    nodeId = candidates[Math.floor(Math.random()*candidates.length)];
  }

  const boss = {
    id: "b"+(state.bossIdSeq++),
    type,
    name: def.name,
    node: nodeId,
    alive: true,
    visible: true,
    meta: {
      moveEvery: def.moveEvery || 1,
      respectsShield: !!def.respectsShield
    }
  };
  state.bosses.push(boss);
  updateBossUI();
  console.info("[BOSS] spawned", boss.type, boss.id, "at", boss.node);
  return boss;
}


function maybeDefeatBossAtNode(nodeId, byTeam){
  ensureBossState();
  const b = state.bosses.find(x => x.alive !== false && x.node === nodeId);
  if(!b) return false;

  // Standard: Bosse sind sofort besiegbar (1 Treffer) – AUSSER Boss 3 (Der Räuber) braucht 2 Treffer.
  if(b.type !== "reaper"){
    b.alive = false;
    b.node = null;
    updateBossUI();
    setStatus(`Team ${byTeam}: Boss besiegt (${(BOSS_TYPES[b.type]?.name)||b.name||b.type})!`);
    return true;
  }

  // Boss 3: braucht 2 Treffer. Treffer 1 => Teleport (min. 6 Felder Abstand nur zum Treffer-Spieler).
  b.hits = (b.hits || 0) + 1;

  if(b.hits >= 2){
    b.alive = false;
    b.node = null;
    updateBossUI();
    setStatus(`Team ${byTeam}: Boss besiegt (${(BOSS_TYPES[b.type]?.name)||b.name||b.type})!`);
    return true;
  }

  const ok = teleportBossRandomFree(b, nodeId, 6, byTeam);
  updateBossUI();
  setStatus(`Team ${byTeam}: Boss getroffen (1/2) – teleportiert${ok ? "" : " (kein freies Feld gefunden)"}!`);
  return true;
}

// Teleportiert den Boss auf ein zufälliges freies Feld.
// - Der Boss darf nicht auf Startfelder.
// - Der Mindestabstand (in Feldern/Schritten auf dem Graphen) gilt NUR zu den Figuren des Teams `byTeam`.
//   (Andere Teams dürfen näher sein.)
function teleportBossRandomFree(boss, fromNodeId, minDist=0, byTeam=null){
  ensureBossState();
  if(!boss || boss.alive===false) return false;

  const team = Number(byTeam||0);
  const teamNodes = team ? getTeamPieceNodes(team) : [];

  // Kandidaten: alle Nodes, die nicht blockiert sind
  const candidates = [];
  for(const n of nodes){
    if(!n || !n.id) continue;
    const id = n.id;
    if(id === fromNodeId) continue;
    if(isNodeBlockedForBoss(id)) continue;
    // Boss nicht direkt auf eine Figur
    if(state.occupied.has(id)) continue;
    // Optional: nicht direkt auf Barrikade teleportieren (wir wollen „frei“)
    if(barricades && barricades.has(id)) continue;
    candidates.push(id);
  }
  if(!candidates.length) return false;

  const randPick = (arr)=>arr[Math.floor(Math.random()*arr.length)];

  // Keine Distanzregel nötig?
  if(!minDist || minDist <= 0 || !teamNodes.length){
    boss.node = randPick(candidates);
    return true;
  }

  // BFS-Distanz von einem Start zu allen Knoten
  const bfsDistances = (startId)=>{
    const dist = new Map();
    dist.set(startId, 0);
    const q = [startId];
    while(q.length){
      const cur = q.shift();
      const d = dist.get(cur);
      for(const nb of (adj.get(cur)||[])){
        // Boss ignoriert Startfelder komplett als „begehbar“
        const nn = nodesById.get(nb);
        if(nn && nn.type === "start") continue;
        if(dist.has(nb)) continue;
        dist.set(nb, d+1);
        q.push(nb);
      }
    }
    return dist;
  };

  // Wir wollen: Abstand(candidate -> irgendeine Figur von byTeam) >= minDist
  // Für performance: Distanzkarten pro Kandidat sind ok (Board ist klein).
  const good = [];
  for(const cand of candidates){
    const dist = bfsDistances(cand);
    let best = Infinity;
    for(const tnode of teamNodes){
      const d = dist.get(tnode);
      if(typeof d === "number" && d < best) best = d;
    }
    if(best >= minDist) good.push(cand);
  }

  if(good.length){
    boss.node = randPick(good);
    return true;
  }

  // Fallback: wenn kein Feld den Mindestabstand schafft, teleportiere trotzdem irgendwo frei.
  boss.node = randPick(candidates);
  return true;
}

function despawnBoss(bossId){
  ensureBossState();
  const b = state.bosses.find(x=>x.id===bossId);
  if(!b) return;
  b.alive = false;
  updateBossUI();
  console.info("[BOSS] despawn", bossId);
}

function leadingTeam(){
  let bestT = currentTeam();
  let best = -1;
  for(const t of state.players){
    const sc = Number(state.goalScores?.[t]||0);
    if(sc > best){ best=sc; bestT=t; }
  }
  return bestT;
}

function getTeamPieceNodes(team){
  return state.pieces.filter(p=>p.node && p.team===team).map(p=>p.node);
}

function bfsNextStep(startId, goalIds, blockedFn){
  if(!startId || !goalIds || !goalIds.length) return null;
  const goals = new Set(goalIds);
  if(goals.has(startId)) return startId;

  const q = [startId];
  const prev = new Map();
  prev.set(startId, null);

  while(q.length){
    const cur = q.shift();
    for(const nb of (adj.get(cur)||[])){
      if(prev.has(nb)) continue;
      if(blockedFn && blockedFn(nb, cur)) continue;
      prev.set(nb, cur);
      if(goals.has(nb)){
        // reconstruct first step
        let step = nb;
        let p = prev.get(step);
        while(p && p !== startId){
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

function bossBlocked(nextId, fromId, boss){
  // Boss ignoriert Startfelder komplett:
  // - darf NICHT darauf laufen
  // - darf sie auch nicht als Zwischen-Schritt nutzen
  const nn = nodesById.get(nextId);
  if(nn && nn.type === "start") return true;

  // Boss 3 (Der Räuber): darf auf Barrikaden LANDEN (und versetzt sie). Bewegung ist Schritt-für-Schritt,
// daher gibt es kein "Drüberspringen" – Barrikaden werden hier NICHT hart geblockt.
  if(boss && boss.type === "reaper"){
    // not blocked here
  }

  // Schutzschild blockt Zwischen-Schritt (Boss darf nicht "drüber laufen")
  const occId = state.occupied.get(nextId);
  if(occId){
    const p = state.pieces.find(x=>x.id===occId);
    if(p && p.shielded) return true;
  }
  return false;
}


function bossCollideAt(nodeId, boss){
  const occId = state.occupied.get(nodeId);
  if(!occId) return false;
  const p = state.pieces.find(x=>x.id===occId);
  if(!p) return false;

  const respectsShield = boss?.meta?.respectsShield ?? true;
  if(respectsShield && p.shielded) return false;

  // Boss 3: nur auf dem Zielfeld (⭐) wird geschmissen, sonst Joker klauen.
  if(boss.type === "reaper"){
    if(state.goalNodeId && nodeId === state.goalNodeId){
      kickToStart(p);
      console.info("[BOSS] reaper hit GOAL -> kick", p.id);
      return true;
    }
    // sonst: 1 zufälligen Joker verlieren
    if(removeRandomJoker(p.team, 1)){
      console.info("[BOSS] reaper stole random joker from team", p.team);
    }
    return true;
  }

  // Standard (Jäger/Zerstörer): Berührung => zurück auf Start
  kickToStart(p);
  console.info("[BOSS] collide", boss.type, boss.id, "-> kick", p.id);
  return true;
}

function moveBossOneStep(boss, force=false){
  if(!boss || boss.alive===false || !boss.node) return;

  const def = BOSS_TYPES[boss.type];
  if(!def) return;

  // Balancing: nur jeden X. Tick bewegen (außer im Debug-Force-Step)
  const every = Number(boss.meta?.moveEvery || 1);
  if(!force && every > 1){
    if(((state.bossTick||0) % every) !== 0) {
      if(state.bossDebug) console.info("[BOSS] skip (moveEvery)", boss.id, "tick", state.bossTick, "every", every);
      return;
    }
  }

  if(boss.type === "hunter"){
    const t = leadingTeam();
    // Boss berücksichtigt Startfelder nicht als Ziel (und jagt keine Figuren, die noch im Start stehen)
    const goals = getTeamPieceNodes(t).filter(id=>!isStartNode(id));
    // Wenn kein Ziel existiert (Team offboard / alle Figuren im Start), fallback: irgendeine Figur, aber auch ohne Startfelder
    const fallback = state.pieces.filter(p=>p.node && !isStartNode(p.node)).map(p=>p.node);
    const goalIds = goals.length ? goals : fallback;
if(!goalIds.length) return;

    const step = bfsNextStep(boss.node, goalIds, (n,f)=>bossBlocked(n,f,boss));
    if(!step || step === boss.node){
      if(state.bossDebug){
        const neigh = (adj.get(boss.node)||[]).slice(0,12);
        console.warn("[BOSS] no-step", boss.id, "at", boss.node, "neigh", neigh, "goals", goalIds.slice(0,6), "tick", state.bossTick);
      }
      return;
    }
    // Falls ein Boss auf eine Barrikade tritt: Barrikade wird entfernt (sonst kann er komplett stecken bleiben).
    if(barricades.has(step)){
      barricades.delete(step);
      if(state.bossDebug) console.info("[BOSS] broke barricade at", step, "boss", boss.id);
    }

    boss.node = step;
    bossCollideAt(step, boss);
  }
  else if(boss.type === "destroyer"){
    // Priorität: nächste Barrikade jagen und dabei zerstören
    let goalIds = [];
    if(barricades && barricades.size){
      goalIds = Array.from(barricades).filter(id=>!isStartNode(id));
    }
    // Fallback: Richtung führendes Team (ohne Startfelder)
    if(!goalIds.length){
      const t = leadingTeam();
      goalIds = getTeamPieceNodes(t).filter(id=>!isStartNode(id));
      if(!goalIds.length){
        goalIds = state.pieces.filter(p=>p.node && !isStartNode(p.node)).map(p=>p.node);
      }
    }
    if(!goalIds.length) return;

    const step = bfsNextStep(boss.node, goalIds, (n,f)=>bossBlocked(n,f,boss));
    if(!step || step === boss.node){
      if(state.bossDebug){
        const neigh = (adj.get(boss.node)||[]).slice(0,12);
        console.warn("[BOSS] no-step", boss.id, "at", boss.node, "neigh", neigh, "goals", goalIds.slice(0,6), "tick", state.bossTick);
      }
      return;
    }

    // Zerstörer: Barrikade auf dem Schritt wird sofort zerstört
    if(barricades.has(step)){
      barricades.delete(step);
      if(state.bossDebug) console.info("[BOSS] destroyer broke barricade at", step, "boss", boss.id);
    }

    boss.node = step;
    bossCollideAt(step, boss);
  }

  else if(boss.type === "reaper"){
    // Boss 3 (Der Räuber): jagt bevorzugt das Zielfeld (⭐), sonst Richtung führendes Team.
    let goalIds = [];
    if(state.goalNodeId && !isStartNode(state.goalNodeId)){
      goalIds = [state.goalNodeId];
    }
    if(!goalIds.length){
      const t = leadingTeam();
      goalIds = getTeamPieceNodes(t).filter(id=>!isStartNode(id));
      if(!goalIds.length){
        goalIds = state.pieces.filter(p=>p.node && !isStartNode(p.node)).map(p=>p.node);
      }
    }
    if(!goalIds.length) return;

    const step = bfsNextStep(boss.node, goalIds, (n,f)=>bossBlocked(n,f,boss));
    if(!step || step === boss.node){
      if(state.bossDebug){
        const neigh = (adj.get(boss.node)||[]).slice(0,12);
        console.warn("[BOSS] no-step", boss.id, "at", boss.node, "neigh", neigh, "goals", goalIds.slice(0,6), "tick", state.bossTick);
      }
      return;
    }

    // Räuber darf auf Barrikaden LANDEN: er nimmt sie auf und versetzt sie sofort neu.
    if(barricades && barricades.has(step)){
      barricades.delete(step);

      const ex = new Set([step]);
      // niemals auf einen Boss setzen (inkl. sich selbst)
      if(Array.isArray(state.bosses)){
        for(const bb of state.bosses){
          if(bb && bb.alive!==false && bb.node) ex.add(bb.node);
        }
      }

      const newId = relocateBarricadeRandom(ex);
      if(newId){
        barricades.add(newId);
        if(state.bossDebug) console.info("[BOSS] reaper moved barricade", step, "->", newId, "boss", boss.id);
      } else {
        if(state.bossDebug) console.warn("[BOSS] reaper removed barricade but found no free place", step, "boss", boss.id);
      }
    }

    boss.node = step;
    bossCollideAt(step, boss);
  }


}


function bossStepOnce(){
  ensureBossState();
  const alive = state.bosses.filter(b=>b.alive!==false);
  for(const b of alive){
    moveBossOneStep(b, true); // force one move for testing
  }
  updateBossUI();
}

function clearBosses(){
  ensureBossState();
  for(const b of state.bosses){
    b.alive = false;
  }
  updateBossUI();
}

function updateBossesAfterPlayerAction(){
  ensureBossState();
  // Tick nach jedem abgeschlossenen Spielerzug (Move+Landing)
  state.bossTick = (state.bossTick||0) + 1;

  // Spielrunde zählt nur am Rundenende (alle Teams einmal dran)
  if(state._bossRoundEndFlag){
    state.bossRoundNum = (state.bossRoundNum||0) + 1;
  }

  if(state.bossAuto){
    const alive = state.bosses.filter(b=>b.alive!==false);
    if(state.bossDebug) console.info("[BOSS] auto-step tick", state.bossTick, "alive", alive.map(x=>x.id), "roundEnd", !!state._bossRoundEndFlag);

    for(const b of alive){
      const def = BOSS_TYPES[b.type];
      if(!def) continue;

      // Boss, der nur am Rundenende agiert
      if(def.moveOnRoundEnd){
        if(!state._bossRoundEndFlag) continue;

        // Boss 4: Der Wächter – läuft nicht, teleportiert jede 2. Spielrunde, platziert jede Runde 1 Barrikade
        if(b.type === "guardian"){
          // 1) Barrikade zusätzlich platzieren (Eventfelder erlaubt). Nicht auf Start / nicht auf Figur / nicht auf vorhandene Barrikade.
          if(barricades){
            const exclude = new Set();
            // optional: Zielpunkt nicht zusätzlich blockieren durch Barrikade
            if(state.goalNodeId) exclude.add(state.goalNodeId);
            const spot = relocateBarricadeRandom(exclude);
            if(spot){
              barricades.add(spot);
              if(state.bossDebug) console.info("[BOSS] guardian placed extra barricade at", spot, "round", state.bossRoundNum);
            }
          }

          // 2) Teleport alle 2 Spielrunden (gerade Zahlen). Teleport darf auch auf Boss-Felder.
          if((state.bossRoundNum % 2) === 0){
            const old = b.node;
            teleportBossRandomFree(b, old, 0, null); // keine Distanzregel
            if(state.bossDebug) console.info("[BOSS] guardian teleported", old, "->", b.node, "round", state.bossRoundNum);
          }
          continue;
        }

        

        // Magnet: zieht alle Spielfiguren 1 Feld Richtung Boss (Startfelder inkl.)
        if(b.type === "magnet"){
          const targetId = b.node;

          // BFS-Distanzen vom Boss
          const dist = new Map();
          const q = [targetId];
          dist.set(targetId, 0);
          while(q.length){
            const cur = q.shift();
            const curD = dist.get(cur);
            const nbs = adj.get(cur) || [];
            for(const nb of nbs){
              if(!dist.has(nb)){
                dist.set(nb, curD + 1);
                q.push(nb);
              }
            }
          }

          const nextToward = (fromId)=>{
            const d0 = dist.get(fromId);
            if(d0==null) return null;
            let best = null;
            let bestD = d0;
            for(const nb of (adj.get(fromId)||[])){
              const dn = dist.get(nb);
              if(dn==null) continue;
              if(dn < bestD){
                bestD = dn;
                best = nb;
              }
            }
            return best;
          };

          const pullPieces = state.pieces
            .filter(p=>p && p.node)
            .slice()
            .sort((a,b2)=>a.team-b2.team);

          for(const p of pullPieces){
            const step1 = nextToward(p.node);
            if(!step1) continue;

            let dest = step1;

            // Wenn belegt -> 1 Feld weiter (falls möglich)
            if(state.occupied.has(dest)){
              const step2 = nextToward(dest);
              if(step2 && !state.occupied.has(step2)){
                dest = step2;
              } else {
                continue;
              }
            }

            // Move ohne Schmeißen (Magnet schiebt nur)
            state.occupied.delete(p.node);
            p.prev = p.node;
            p.node = dest;
            state.occupied.set(dest, p.id);

            // Schild endet sobald bewegt
            if(p.shielded) p.shielded = false;

            // Landeeffekte (Barrikade aufnehmen/setzen, Event/Ziel)
            resolveLanding(p, {allowPortal:true, fromBarricade:false});
          }

          // Magnet selbst bewegt sich nicht
          continue;
        }

const steps = Math.max(1, Number(def.stepsPerMove||3));
        for(let i=0;i<steps;i++){
          moveBossOneStep(b, false);
        }

        // Extra-Effekt: nur Der Zerstörer zerstört zusätzlich 1 zufällige Barrikade
        if(b.type === "destroyer" && barricades && barricades.size){
          const arr = Array.from(barricades);
          const pick = arr[Math.floor(Math.random()*arr.length)];
          barricades.delete(pick);
          if(state.bossDebug) console.info("[BOSS] destroyer extra broke barricade at", pick, "boss", b.id);
        }
        continue;
      }

      // Standard: pro Boss-Phase 1 Schritt (unter Berücksichtigung moveEvery)
      moveBossOneStep(b, false);
    }
  }

  // RoundEnd-Flag ist nur für diese Boss-Phase gültig
  state._bossRoundEndFlag = false;

  updateBossUI();
}



// ---- Boss Phase Helper ----
// Läuft nach jedem abgeschlossenen Spielerzug einmal, damit der Boss "zwischen" den Zügen agiert.
// Blockiert in der kurzen Zeit Eingaben, damit es keine Race-Conditions gibt (Boss vs. Spieler-Click).
function runBossPhaseThen(done){
  try{
    if(state.gameOver) return;
    ensureBossState();

    const hasAlive = (state.bosses||[]).some(b=>b.alive!==false);
    if(!state.bossAuto || !hasAlive){
      done && done();
      return;
    }

    const prevPhase = state.phase;
    state.phase = "bossPhase";
    setStatus("Boss bewegt sich...");

    // kleiner Delay -> fühlt sich "Phase" an und verhindert gleichzeitige Clicks auf Touch-Geräten
    setTimeout(()=>{
      updateBossesAfterPlayerAction();
      // done setzt anschließend wieder eine sinnvolle Phase (needRoll / choosePiece / etc.)
      done && done();
      // falls done nichts gesetzt hat, zurückfallen
      if(state.phase === "bossPhase") state.phase = prevPhase || "needRoll";
    }, 220);
  }catch(e){
    console.warn("[BOSS] bossPhase error", e);
    // Niemals hängen bleiben:
    done && done();
  }
}
function bossFieldHighlightDraw(n, R){
  // Spawn-Felder (type=boss) leicht markieren
  ctx.save();
  ctx.strokeStyle = "rgba(220,70,70,.55)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(n.x,n.y,R+6,0,Math.PI*2);
  ctx.stroke();

  ctx.strokeStyle = "rgba(255,220,220,.22)";
  ctx.lineWidth = 2;
  ctx.setLineDash([6,6]);
  ctx.beginPath();
  ctx.arc(n.x,n.y,R+10,0,Math.PI*2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

// ---- Boss UI in Sidebar ----
function ensureBossPanel(){
  // Wir hängen es unter die Joker-Buttons (rechts in der Sidebar)
  const anchor = jokerButtonsWrap || document.getElementById("sidebar") || document.body;
  let host = document.getElementById("bossPanel");
  if(host) return host;

  host = document.createElement("div");
  host.id = "bossPanel";
  host.style.cssText = [
    "margin-top:12px",
    "padding:12px",
    "border-radius:14px",
    "background:rgba(10,12,18,.42)",
    "border:1px solid rgba(255,255,255,.10)",
    "color:rgba(245,250,255,.92)",
    "font:600 13px system-ui, -apple-system, Segoe UI, Roboto, Arial"
  ].join(";");

  const title = document.createElement("div");
  title.textContent = "Bosse";
  title.style.cssText = "font-weight:800; margin-bottom:8px; letter-spacing:.2px;";
  host.appendChild(title);

  const list = document.createElement("div");
  list.id = "bossPanelList";
  host.appendChild(list);

  // --- Debug Controls (immer sichtbar) ---
  const dbg = document.createElement('div');
  dbg.id = 'bossDebugControls';
  dbg.style.cssText = 'margin-top:10px; display:grid; grid-template-columns:1fr 1fr; gap:8px;';

  function mkBtn(id, label){
    const b = document.createElement('button');
    b.id = id;
    b.textContent = label;
    b.className = 'btn small';
    b.style.cssText = 'padding:10px 10px; border-radius:12px; border:1px solid rgba(255,255,255,.12); background:rgba(255,255,255,.06); color:rgba(245,250,255,.92); font-weight:800; letter-spacing:.2px;';
    b.onmouseenter = ()=>{ b.style.background='rgba(255,255,255,.10)'; };
    b.onmouseleave = ()=>{ b.style.background='rgba(255,255,255,.06)'; };
    return b;
  }

  // Spawn selector (Test)
  const sel = document.createElement('select');
  sel.id = 'bossSpawnSelect';
  sel.style.cssText = 'grid-column:1 / -1; padding:10px 10px; border-radius:12px; border:1px solid rgba(255,255,255,.12); background:rgba(10,12,18,.35); color:rgba(245,250,255,.92); font-weight:800;';
  // Options from BOSS_TYPES
  for(const k of Object.keys(BOSS_TYPES)){
    const o = document.createElement('option');
    o.value = k;
    o.textContent = (BOSS_TYPES[k]?.name) ? BOSS_TYPES[k].name : k;
    sel.appendChild(o);
  }
  dbg.appendChild(sel);

  const btnSpawn = mkBtn('btnBossSpawn','Spawn Boss');
  const btnSpawnHunter = mkBtn('btnBossSpawnHunter','Spawn Jäger');
  const btnStep = mkBtn('btnBossStep','Boss Step');
  const btnToggle = mkBtn('btnBossToggleAI','Boss AI: AN');
  const btnClear = mkBtn('btnBossClear','Clear Bosses');

  dbg.appendChild(btnSpawn);
  dbg.appendChild(btnSpawnHunter);
  dbg.appendChild(btnStep);
  dbg.appendChild(btnToggle);
  dbg.appendChild(btnClear);

  const hint = document.createElement('div');
  hint.id = 'bossDebugHint';
  hint.style.cssText = 'grid-column:1 / -1; margin-top:2px; opacity:.7; font-size:12px; line-height:1.25;';
  hint.textContent = 'Test-Modus: Spawnen, Step, AI togglen, Clear.';
  dbg.appendChild(hint);

  host.appendChild(dbg);

  // Wire once
  btnSpawn.onclick = ()=>{ const t = document.getElementById('bossSpawnSelect')?.value || 'hunter'; spawnBoss(t); };
  btnSpawnHunter.onclick = ()=>{ spawnBoss('hunter'); };
  btnStep.onclick = ()=>{ bossStepOnce(); };
  btnClear.onclick = ()=>{ clearBosses(); };
  btnToggle.onclick = ()=>{
    ensureBossState();
    state.bossAuto = !state.bossAuto;
    btnToggle.textContent = 'Boss AI: ' + (state.bossAuto ? 'AN' : 'AUS');
  };

  // Insert after jokerButtonsWrap if possible
  if(jokerButtonsWrap && jokerButtonsWrap.parentElement){
    jokerButtonsWrap.parentElement.appendChild(host);
  }else{
    anchor.appendChild(host);
  }

  return host;
}

function updateBossUI(){
  ensureBossState();
  const panel = ensureBossPanel();
  const tgl = document.getElementById("btnBossToggleAI");
  if(tgl){ ensureBossState(); tgl.textContent = "Boss AI: " + (state.bossAuto ? "AN" : "AUS"); }
  const list = document.getElementById("bossPanelList");
  if(!list) return;

  const alive = state.bosses.filter(b=>b.alive!==false);
  if(!alive.length){
    list.innerHTML = "<div style='opacity:.75'>Kein Boss aktiv</div>";
    return;
  }

  list.innerHTML = "";
  for(const b of alive){
    const def = BOSS_TYPES[b.type] || {};
    const card = document.createElement("div");
    card.style.cssText = [
      "display:flex",
      "gap:10px",
      "align-items:flex-start",
      "padding:10px",
      "border-radius:12px",
      "background:rgba(255,255,255,.06)",
      "border:1px solid rgba(255,255,255,.10)",
      "margin-bottom:8px"
    ].join(";");

    const icon = document.createElement("div");
    icon.textContent = def.icon || "☠";
    icon.style.cssText = [
      "width:38px","height:38px",
      "border-radius:14px",
      "display:flex","align-items:center","justify-content:center",
      "background:"+(def.color || 'rgba(220,70,70,.95)'),
      "color:rgba(255,245,235,.95)",
      "font-weight:900",
      "border:1px solid rgba(0,0,0,.25)"
    ].join(";");

    const body = document.createElement("div");
    body.style.flex = "1";
    const name = document.createElement("div");
    name.textContent = def.name || b.name || b.type;
    name.style.cssText = "font-weight:900; margin-bottom:2px;";
    const meta = document.createElement("div");
    meta.style.cssText = "opacity:.78; font-weight:600; font-size:12px; margin-bottom:6px;";
    meta.textContent = `Feld: ${b.node}`;

    const ul = document.createElement("ul");
    ul.style.cssText = "margin:0; padding-left:16px; opacity:.9; font-weight:600; font-size:12px; line-height:1.3;";
    const traits = def.traits || [];
    for(const t of traits){
      const li = document.createElement("li");
      li.textContent = t;
      ul.appendChild(li);
    }

    body.appendChild(name);
    body.appendChild(meta);
    body.appendChild(ul);

    card.appendChild(icon);
    card.appendChild(body);
    list.appendChild(card);
  }
}


// ---------- Joker UI + Logic ----------
function renderJokerButtons(){
  if(!jokerButtonsWrap) return;
  if(jokerButtonsWrap._built) return;
  jokerButtonsWrap._built = true;

  jokerButtonsWrap.innerHTML = "";
  const btns = {};
  for(const j of JOKERS){
    const b = document.createElement("button");
    b.className = "jokerBtn";
    b.type = "button";
    b.dataset.jokerId = j.id;

    const label = document.createElement("span");
    label.textContent = j.name;

    const count = document.createElement("span");
    count.className = "jokerCount";
    count.textContent = "0";

    b.appendChild(label);
    b.appendChild(count);

    b.addEventListener("click", ()=>{
      tryUseJoker(j.id);
    });
    jokerButtonsWrap.appendChild(b);
    btns[j.id] = { btn:b, countEl: count };
  }
  state._jokerBtns = btns;
  updateJokerUI();
  ensureEventSelectUI();
}

function jokerIsUsableNow(joker){
  if(state.gameOver) return false;
  if(state.jokerMode) return false; // während eines Joker-Modus keine anderen starten

  const beforeOk = (state.phase === "needRoll") && (state.roll === null);
  const afterOk = (state.roll !== null) && (state.phase === "choosePiece" || state.phase === "chooseTarget");

  if(joker.timing === "before") return beforeOk;
  return afterOk;
}

function updateJokerUI(){
  if(!jokerButtonsWrap) return;
  ensureJokerState();
  renderJokerButtons();

  const team = currentTeam();
  const hint = [];
  if(state.jokerMode === "swapPickA") hint.push("Spieler tauschen: Figur A wählen");
  if(state.jokerMode === "swapPickB") hint.push("Spieler tauschen: Figur B wählen");
  if(state.jokerMode === "moveBarricadePick") hint.push("Barrikade versetzen: Barrikade wählen");
  if(state.jokerMode === "moveBarricadePlace") hint.push("Barrikade versetzen: Ziel-Feld wählen");
  if(state.jokerMode === "shieldPick") hint.push("Schutzschild: eigene Figur wählen");
  if(!hint.length){
    if(state.phase === "needRoll") hint.push("Vor dem Wurf nutzbar: Doppelwurf / Barrikade / Spieler tauschen");
    else if(state.phase === "choosePiece" || state.phase === "chooseTarget") hint.push("Nach dem Wurf nutzbar: Neuwurf / Schutzschild / Alle Farben");
    else hint.push("–");
  }
  if(jokerHint) jokerHint.textContent = hint.join(" · ");

  const btns = state._jokerBtns || {};
  for(const j of JOKERS){
    const ref = btns[j.id];
    if(!ref) continue;
    ref.countEl.textContent = String(jokerCount(team, j.id));

    const usable = jokerIsUsableNow(j) && jokerCount(team, j.id) > 0;
    ref.btn.disabled = !usable;

    // Active toggles
    let on = false;
    if(j.id === "double" && state.jokerFlags.double) on = true;
    if(j.id === "allcolors" && state.jokerFlags.allcolors) on = true;
    ref.btn.classList.toggle("on", on);
  }
}

function setJokerMode(mode, data={}){
  ensureJokerState();
  state.jokerMode = mode;
  state.jokerData = data || {};
  state.jokerHighlighted.clear();
  updateJokerUI();
  ensureEventSelectUI();
}

function clearJokerMode(msg){
  ensureJokerState();
  state.jokerMode = null;
  state.jokerData = {};
  state.jokerHighlighted.clear();
  if(msg) setStatus(msg);
  updateJokerUI();
  ensureEventSelectUI();
}


function beginSprintEventMove(steps){
  steps = Math.max(1, Number(steps) || 1);
  state.roll = steps;
  state.selected = null;
  state.highlighted.clear();
  state.placeHighlighted.clear();
  ensurePortalState();
  state.portalHighlighted.clear();
  state.portalUsedThisTurn = false;
  state.phase = "choosePiece";
  dieBox.textContent = String(steps);
  setStatus(`🏃 Team ${currentTeam()}: Wähle 1 eigene Figur und laufe ${steps} Felder.`);
  updateJokerUI();
  ensureEventSelectUI();
  draw();
}

function beginChoosePieceAfterRoll(){
  // Nach (Neu-)Wurf: Figur wählen (oder wechseln)
  state.selected = null;
  state.highlighted.clear();
  state.phase = "choosePiece";
  const any = state.pieces.some(p=>p.node);
  if(!any){
    setStatus(`Team ${currentTeam()}: Keine Figur auf dem Board.`);
  }
  updateJokerUI();
  ensureEventSelectUI();
}

function rollDice(){
  const a = Math.floor(Math.random()*6)+1;
  if(state.jokerFlags.double){
    const b = Math.floor(Math.random()*6)+1;
    state.jokerFlags.double = false; // verbraucht beim Wurf
    return a + b;
  }
  return a;
}

function tryUseJoker(jokerId){
  if(state.gameOver) return;
  ensureJokerState();

  const team = currentTeam();
  const joker = JOKERS.find(j=>j.id===jokerId);
  if(!joker) return;

  if(jokerCount(team, jokerId) <= 0) return;
  if(!jokerIsUsableNow(joker)) return;

  // Consume first (prevents double click abuse)
  if(!consumeJoker(team, jokerId)) return;

  if(jokerId === "double"){
    state.jokerFlags.double = true;
    setStatus(`Team ${team}: Doppelwurf aktiv. Jetzt würfeln.`);
    updateJokerUI();
    return;
  }

  if(jokerId === "reroll"){
    // nur nach dem Wurf
    state.roll = rollDice();
    dieBox.textContent = state.roll;
    setStatus(`Team ${team}: Neuwurf! Wurf ${state.roll}.`);
    beginChoosePieceAfterRoll();
    return;
  }

  if(jokerId === "allcolors"){
    state.jokerFlags.allcolors = true;
    setStatus(`Team ${team}: Alle Farben aktiv – du darfst jede Figur wählen.`);
    updateJokerUI();
    return;
  }

  if(jokerId === "moveBarricade"){
    setJokerMode("moveBarricadePick");
    setStatus(`Team ${team}: Joker Barrikade versetzen – tippe eine Barrikade an.`);
    return;
  }

  if(jokerId === "swap"){
    setJokerMode("swapPickA");
    setStatus(`Team ${team}: Joker Spieler tauschen – wähle Figur A.`);
    return;
  }

  if(jokerId === "shield"){
    setJokerMode("shieldPick");
    setStatus(`Team ${team}: Schutzschild – wähle eine eigene Figur.`);
    return;
  }
}


// ---------- Zielpunkte (Sammelziel) ----------
function isFreeForGoal(id){
  // Zielpunkt darf NICHT auf Figuren liegen.
  // ABER: Er DARF unter einer Barrikade liegen (versteckt).
  if(state.occupied.has(id)) return false;
  return true;
}

function spawnGoalRandom(force=false){
  // Wählt ein zufälliges Feld für den Zielpunkt
  // - nur wenn noch keiner existiert oder force=true
  if(state.gameOver) return;
  if(state.goalNodeId && !force) return;

  if(!nodes || nodes.length===0) return;

  const candidates = nodes
    .filter(n => n && n.id)
    // optional: Start/Portal meiden, damit es fair bleibt
    .filter(n => n.type !== "start" && n.type !== "portal")
    .map(n => n.id)
    .filter(id => isFreeForGoal(id));

  // Fallback: wenn zu restriktiv, nimm wirklich "irgendwo frei"
  const fallback = nodes.map(n=>n.id).filter(id => isFreeForGoal(id));

  const pool = (candidates.length ? candidates : fallback);
  if(!pool.length) return;

  // Nicht exakt dasselbe Feld wie vorher (wenn möglich)
  let pick = pool[Math.floor(Math.random()*pool.length)];
  if(state.goalNodeId && pool.length > 1){
    let tries = 0;
    while(pick === state.goalNodeId && tries < 10){
      pick = pool[Math.floor(Math.random()*pool.length)];
      tries++;
    }
  }

  state.goalNodeId = pick;
}



function isFreeForBonusLight(id){
  if(!id) return false;
  const n = nodesById.get(id);
  if(!n) return false;
  if(state.occupied.has(id)) return false;
  if(n.type === "start" || n.type === "portal" || n.type === "boss") return false;
  if(state.goalNodeId && id === state.goalNodeId) return false;
  if(state.bonusGoalNodeId && id === state.bonusGoalNodeId) return false;
  if(state.bonusLightNodeId && id === state.bonusLightNodeId) return false;
  return true;
}

function spawnBonusLightOneShot(force=false){
  if(state.gameOver) return { ok:false, reason:"game_over" };
  if(state.bonusLightNodeId && !force) return { ok:false, reason:"already_exists", nodeId: state.bonusLightNodeId };

  const candidates = nodes
    .filter(n => n && n.id)
    .filter(n => isFreeForBonusLight(n.id))
    .map(n => n.id);

  if(!candidates.length){
    return { ok:false, reason:"no_free_field" };
  }

  const pick = candidates[Math.floor(Math.random()*candidates.length)];
  state.bonusLightNodeId = pick;
  draw();
  console.info("[LIGHT] bonus light spawned", { nodeId: pick });
  return { ok:true, nodeId: pick };
}

function isFreeForBonusGoal(id){
  if(!id) return false;
  const n = nodesById.get(id);
  if(!n) return false;
  if(state.occupied.has(id)) return false;
  if(n.type === "start" || n.type === "portal" || n.type === "boss") return false;
  if(state.goalNodeId && id === state.goalNodeId) return false;
  if(state.bonusGoalNodeId && id === state.bonusGoalNodeId) return false;
  return true;
}

function spawnBonusGoalDoubleOneShot(force=false){
  if(state.gameOver) return { ok:false, reason:"game_over" };
  if(state.bonusGoalNodeId && !force) return { ok:false, reason:"already_exists", nodeId: state.bonusGoalNodeId };

  const candidates = nodes
    .filter(n => n && n.id)
    .filter(n => isFreeForBonusGoal(n.id))
    .map(n => n.id);

  if(!candidates.length){
    return { ok:false, reason:"no_free_field" };
  }

  let pick = candidates[Math.floor(Math.random()*candidates.length)];
  state.bonusGoalNodeId = pick;
  draw();
  console.info("[GOAL] bonus double spawned", { nodeId: pick, value: state.bonusGoalValue || 2 });
  return { ok:true, nodeId: pick, value: state.bonusGoalValue || 2 };
}

function maybeCaptureGoal(piece){
  if(state.gameOver) return false;
  if(!piece || !piece.node) return false;

  // Einmal-Lichtfeld zuerst prüfen (+1 Punkt, verschwindet danach)
  if(state.bonusLightNodeId && piece.node === state.bonusLightNodeId){
    if(barricades.has(piece.node)) return false;

    if(state.bosses && state.bosses.some(b=>b.alive!==false && b.type==="guardian" && b.node===piece.node)){
      setStatus("🛡 Der Wächter blockiert den Zielpunkt!");
      return false;
    }

    const t = piece.team;
    state.goalScores[t] = (state.goalScores[t]||0) + 1;
    state._goalCapturedThisLanding = t;
    state.bonusLightNodeId = null;

    if(state.goalScores[t] >= state.goalToWin){
      state.gameOver = true;
      state.phase = "gameOver";
      setStatus(`🏆 Team ${t} gewinnt! (${state.goalToWin} Zielpunkte erreicht)`);
      showWinOverlay(t);
      return true;
    }

    setStatus(`✨ Team ${t} sammelt das Lichtfeld! +1 Punkt. Stand: ${state.goalScores[t]}/${state.goalToWin}`);
    return true;
  }

  // Bonus-Zielfeld zuerst prüfen (einmalig, doppelte Punkte, kein Respawn)
  if(state.bonusGoalNodeId && piece.node === state.bonusGoalNodeId){
    if(barricades.has(piece.node)) return false;

    if(state.bosses && state.bosses.some(b=>b.alive!==false && b.type==="guardian" && b.node===piece.node)){
      setStatus("🛡 Der Wächter blockiert den Zielpunkt!");
      return false;
    }

    const t = piece.team;
    const value = Number(state.bonusGoalValue || 2);
    state.goalScores[t] = (state.goalScores[t]||0) + value;
    state._goalCapturedThisLanding = t;
    state.bonusGoalNodeId = null;

    if(state.goalScores[t] >= state.goalToWin){
      state.gameOver = true;
      state.phase = "gameOver";
      setStatus(`🏆 Team ${t} gewinnt! (${state.goalToWin} Zielpunkte erreicht)`);
      showWinOverlay(t);
      return true;
    }

    setStatus(`🌟 Team ${t} sammelt das Doppel-Zielfeld! +${value} Punkte. Stand: ${state.goalScores[t]}/${state.goalToWin}`);
    return true;
  }

  if(!state.goalNodeId) return false;
  if(piece.node !== state.goalNodeId) return false;

  // Wenn hier eine Barrikade liegt, ist der Zielpunkt "versteckt" und kann nicht eingesammelt werden.
  if(barricades.has(piece.node)) return false;

  // Boss 4 (Wächter) blockiert den Zielpunkt komplett, wenn er darauf steht.
  if(state.bosses && state.bosses.some(b=>b.alive!==false && b.type==="guardian" && b.node===piece.node)){
    setStatus("🛡 Der Wächter blockiert den Zielpunkt!");
    return false;
  }

  // Punkt einsammeln
  const t = piece.team;
  state.goalScores[t] = (state.goalScores[t]||0) + 1;

  // Sieg?
  if(state.goalScores[t] >= state.goalToWin){
    state.gameOver = true;
    state.phase = "gameOver";
    setStatus(`🏆 Team ${t} gewinnt! (${state.goalToWin} Zielpunkte erreicht)`);
    showWinOverlay(t);
    return true;
  }

  // Für Test/Regel: Zielfeld triggert immer auch eine Ereigniskarte (1x pro Landung)
  state._goalCapturedThisLanding = t;

  // Neu spawnen
  state.goalNodeId = null;
  spawnGoalRandom(true);
  setStatus(`🎯 Team ${t} sammelt einen Zielpunkt! Stand: ${state.goalScores[t]}/${state.goalToWin}`);
  return true;
}

function showWinOverlay(team){
  let ov = document.getElementById("winOverlay");
  if(!ov){
    ov = document.createElement("div");
    ov.id = "winOverlay";
    ov.style.cssText = [
      "position:fixed","inset:0","display:none",
      "align-items:center","justify-content:center",
      "z-index:99998",
      "background:rgba(0,0,0,.55)"
    ].join(";");

    ov.innerHTML = `
      <div style="
        width:min(640px, calc(100vw - 28px));
        border-radius:22px;
        padding:22px 20px 18px;
        background:
          radial-gradient(900px 380px at 50% 10%, rgba(255,255,255,.55), rgba(255,255,255,0) 65%),
          repeating-linear-gradient(90deg, rgba(70,55,38,.05), rgba(70,55,38,.05) 1px, rgba(0,0,0,0) 1px, rgba(0,0,0,0) 26px),
          repeating-linear-gradient(0deg, rgba(70,55,38,.03), rgba(70,55,38,.03) 1px, rgba(0,0,0,0) 1px, rgba(0,0,0,0) 34px),
          linear-gradient(180deg, #f3e7c9 0%, #ead8ab 60%, #ddc58f 100%);
        border:1px solid rgba(0,0,0,.22);
        box-shadow:0 26px 90px rgba(0,0,0,.62);
        color:rgba(38,26,18,.92);
        font-family: ui-serif, Georgia, 'Times New Roman', Times, serif;
      ">
        <div style="font:800 28px 'Cinzel', ui-serif, Georgia, serif; letter-spacing:.5px; margin-bottom:8px;">
          🏆 Sieg!
        </div>
        <div id="winText" style="font:600 18px 'EB Garamond', ui-serif, Georgia, serif; line-height:1.35; margin-bottom:14px;">
        </div>
        <div style="display:flex; gap:10px; justify-content:flex-end;">
          <button id="btnWinRestart" style="
            all:unset; cursor:pointer;
            padding:10px 14px; border-radius:12px;
            background:rgba(60,40,20,.12);
            border:1px solid rgba(0,0,0,.18);
            font:700 14px system-ui, -apple-system, Segoe UI, Roboto, Arial;
          ">Neu starten</button>
          <button id="btnWinClose" style="
            all:unset; cursor:pointer;
            padding:10px 14px; border-radius:12px;
            background:rgba(60,40,20,.18);
            border:1px solid rgba(0,0,0,.18);
            font:700 14px system-ui, -apple-system, Segoe UI, Roboto, Arial;
          ">Schließen</button>
        </div>
      </div>
    `;
    document.body.appendChild(ov);

    ov.addEventListener("click",(e)=>{
      if(e.target === ov) ov.style.display="none";
    });

    ov.querySelector("#btnWinClose").addEventListener("click",()=>{
      ov.style.display="none";
    });

    ov.querySelector("#btnWinRestart").addEventListener("click",()=>{
      // Soft-Reset: Punkte + Figuren zurück (kein Reload nötig)
      state.goalScores = {1:0,2:0,3:0,4:0};
      state.gameOver = false;
      initPieces();
      initEventFieldsFromBoard();
      state.goalNodeId = null;
      state.bonusGoalNodeId = null;
      state.bonusLightNodeId = null;
      spawnGoalRandom(true);
      state.phase = "needRoll";
      state.turn = 0;
      state.roll = null;
      state.selected = null;
      state.highlighted.clear();
      state.placeHighlighted.clear();
      ensurePortalState();
      state.portalHighlighted.clear();
      state.portalUsedThisTurn = false;
      state.pendingSix = false;
      state.extraRoll = false;
      state.ignoreBarricadesThisTurn = false;

      dieBox.textContent="–";
      setStatus(`Neustart! Team ${currentTeam()} ist dran: Würfeln.`);
      ov.style.display="none";
    });
  }

  const winText = ov.querySelector("#winText");
  winText.textContent = `Team ${team} hat als erstes ${state.goalToWin} Zielpunkte gesammelt.`;
  markOverlayOpened(ov);
  ov.style.display="flex";
}


// ---------- UI Safety Helpers (Anti Auto-Tap) ----------
// Problem: On mobile/tablet the click/tap that triggers the landing/event can "fall through" into the overlay
// and instantly click a card/button. We block input for a short grace period.
function markOverlayOpened(ov){
  ov._openedAt = performance.now();
}
function overlayClickAllowed(ov, ms=350){
  const t = (ov && ov._openedAt) ? ov._openedAt : 0;
  return (performance.now() - t) >= ms;
}

// ---------- Event Cards (Ereignisse) ----------
// TEST-MODUS: Wenn true, zieht JEDES Betreten eines Feldes eine Ereigniskarte (ideal zum Testen).
// Für normales Spiel einfach auf false stellen.
const FORCE_EVENT_EVERY_LANDING = true;
// TEST-Helfer: Wenn gesetzt (z.B. "joker_pick6"), wird immer diese Karte gezogen.
const FORCE_EVENT_CARD_ID = null;
let eventForceCardId = null; // UI: forced event card (persistent until changed)

const EVENT_DECK = [
{ 
    id:"joker_pick6",
    title:"Zufälliger Joker",
    text:"Wähle 1 von 6 Karten – du bekommst den Joker dahinter.",
    effect:"joker_pick6"
  },
  {
    id:"joker_wheel",
    title:"Joker-Glücksrad",
    text:"Drehe das Glücksrad: Erst Joker, dann Anzahl (1–3).",
    effect:"joker_wheel"
  },
  {
    id:"jokers_all6",
    title:"Alle 6 Joker",
    text:"Du erhältst +1 von jedem Joker (6 Stück).",
    effect:"jokers_all6"
  },
  {
    id:"joker_rain",
    title:"Joker-Regen",
    text:"Alle anderen Spieler erhalten 2 zufällige Joker.",
    effect:"joker_rain"
  },
  {
    id:"shuffle_pieces",
    title:"Figuren mischen",
    text:"Alle Spielfiguren (außer Start, Schild, Portal) werden neu gemischt.",
    effect:"shuffle_pieces"
  },
  {
    id:"start_spawn",
    title:"Startfeld-Spawn",
    text:"Alle Figuren auf Startfeldern werden nacheinander (0,5s) auf freie Felder verteilt.",
    effect:"start_spawn"
  },
  {
    id:"spawn_barricades3",
    title:"Barrikaden-Verstärkung",
    text:"3 zusätzliche Barrikaden erscheinen (auch auf Ereignis- & Siegpunktfeldern).",
    effect:"spawn_barricades3"
  },
  {
    id:"spawn_barricades10",
    title:"Barrikaden-Invasion",
    text:"10 zusätzliche Barrikaden erscheinen (auch auf Ereignis- & Siegpunktfeldern).",
    effect:"spawn_barricades10"
  },
  {
    id:"spawn_barricades5",
    title:"Barrikaden-Nachschub",
    text:"5 zusätzliche Barrikaden erscheinen (auch auf Ereignis- & Siegpunktfeldern).",
    effect:"spawn_barricades5"
  },
  {
    id:"move_barricade1",
    title:"Barrikade versetzen",
    text:"Du musst 1 Barrikade auf ein anderes Feld versetzen.",
    effect:"move_barricade1"
  },
  {
    id:"move_barricade2",
    title:"Zwei Barrikaden versetzen",
    text:"Du musst 2 Barrikaden auf andere Felder versetzen.",
    effect:"move_barricade2"
  },
  {
    id:"barricades_reset_initial",
    title:"Barrikaden-Reset",
    text:"Alle Barrikaden werden auf die Startpositionen zurückgesetzt (gleiche Anzahl).",
    effect:"barricades_reset_initial"
  }
,
  {
    id:"barricades_shuffle",
    title:"Barrikaden mischen",
    text:"Alle Barrikaden werden neu gemischt und auf neue Felder verteilt.",
    effect:"barricades_shuffle"
  },
  {
    id:"barricades_on_event_and_goal",
    title:"Barrikaden-Invasion",
    text:"Auf jedes Ereignisfeld und auf das Zielfeld wird je 1 zusätzliche Barrikade platziert.",
    effect:"barricades_on_event_and_goal"
  },
  {
    id:"barricades_half_remove",
    title:"Barrikaden verfallen",
    text:"Die Hälfte aller Barrikaden verschwindet vom Brett.",
    effect:"barricades_half_remove"
  },
  {
    id:"barricade_jump_reroll",
    title:"Sturmangriff",
    text:"Du darfst nochmal würfeln. Für diesen ganzen Zug darfst du Barrikaden auf dem Weg überspringen. Landest du auf einer Barrikade, sammelst du sie ein und darfst sie neu platzieren.",
    effect:"barricade_jump_reroll"
  },
  {
    id:"spawn_one_boss",
    title:"Ein Boss erscheint",
    text:"Ein zufälliger Boss erscheint auf einem freien Bossfeld. Maximal 2 Bosse gleichzeitig.",
    effect:"spawn_one_boss"
  },
  {
    id:"spawn_two_bosses",
    title:"Zwei Bosse erscheinen",
    text:"Bis zu zwei zufällige Bosse erscheinen auf freien Bossfeldern. Maximal 2 Bosse insgesamt.",
    effect:"spawn_two_bosses"
  },
  {
    id:"extra_roll_event",
    title:"Du darfst nochmal würfeln",
    text:"Du darfst sofort noch einmal würfeln.",
    effect:"extra_roll_event"
  },
  {
    id:"all_to_start",
    title:"Alle zurück zum Start",
    text:"Alle Spieler müssen zurück auf ihre Startfelder.",
    effect:"all_to_start"
  },
  {
    id:"lose_all_jokers",
    title:"Du verlierst alle Joker",
    text:"Alle Joker deines Teams gehen verloren.",
    effect:"lose_all_jokers"
  },
  {
    id:"respawn_all_events",
    title:"Ereignisfelder neu",
    text:"Alle 6 Ereignisfelder werden nacheinander neu gespawnt.",
    effect:"respawn_all_events"
  }
  ,
  {
    id:"spawn_double_goal",
    title:"Doppel-Zielfeld",
    text:"Ein zusätzliches Zielfeld mit doppelten Punkten erscheint. Es ist einmalig und spawnt nach dem Einsammeln nicht neu.",
    effect:"spawn_double_goal"
  }
  ,
  {
    id:"dice_duel",
    title:"Würfel-Duell",
    text:"Alle würfeln automatisch. Der niedrigste Wurf gibt dem höchsten Wurf 1 zufälligen Joker. Bei Gleichstand wird erneut gewürfelt. Hat der Verlierer keinen Joker, geht der Gewinner leer aus.",
    effect:"dice_duel"
  }
  ,
  {
    id:"lose_one_point",
    title:"Du verlierst 1 Siegpunkt",
    text:"Dein Team verliert 1 Siegpunkt. Minimum ist 0.",
    effect:"lose_one_point"
  }
  ,
  {
    id:"gain_one_point",
    title:"Du bekommst 1 Siegpunkt",
    text:"Dein Team erhält 1 Siegpunkt.",
    effect:"gain_one_point"
  }
  ,
  {
    id:"gain_two_points",
    title:"Du erhältst 2 Siegpunkte",
    text:"Dein Team erhält 2 Siegpunkte.",
    effect:"gain_two_points"
  }
  ,
  {
    id:"point_transfer_most_to_least",
    title:"Punktetausch",
    text:"Das Team mit den meisten Siegpunkten gibt dem Team mit den wenigsten 1 Siegpunkt. Bei Gleichstand entscheidet ein Glücksrad.",
    effect:"point_transfer_most_to_least"
  }
  ,
  {
    id:"back_to_start",
    title:"Zurück zum Start",
    text:"Alle eigenen Figuren müssen zurück auf die Startfelder deines Teams.",
    effect:"back_to_start"
  }
  ,
  {
    id:"others_to_start",
    title:"Alle anderen zurück zum Start",
    text:"Alle anderen Spieler müssen komplett zurück auf ihre Startfelder.",
    effect:"others_to_start"
  }
  ,
  {
    id:"steal_one_point",
    title:"Klaue 1 Siegpunkt",
    text:"Du klaust 1 Siegpunkt von einem zufälligen Mitspieler.",
    effect:"steal_one_point"
  }
  ,
  {
    id:"sprint_5",
    title:"Laufe 5 Felder",
    text:"Du darfst sofort 1 eigene Figur um 5 Felder bewegen.",
    effect:"sprint_5"
  }
  ,
  {
    id:"sprint_10",
    title:"Laufe 10 Felder",
    text:"Du darfst sofort 1 eigene Figur um 10 Felder bewegen.",
    effect:"sprint_10"
  }
  ,
  {
    id:"spawn_bonus_light",
    title:"Zusätzliches Lichtfeld",
    text:"Ein zusätzliches Lichtfeld erscheint auf dem Brett. Nach dem Einsammeln verschwindet es wieder.",
    effect:"spawn_bonus_light"
  }
];

// ---- Event Effect: 3 zusätzliche Barrikaden spawnen ----
// Darf auf Ereignisfeldern & Siegpunktfeld spawnen.
// NICHT auf Start, Portal, Boss, belegt (Figur), oder vorhandene Barrikade.
function spawnExtraBarricades(count=3){
  const occupied = new Set();
  for(const p of (state.pieces || [])) occupied.add(p.node);

  const candidates = nodes
    .map(n=>n.id)
    .filter(id=>{
      if(!id) return false;
      if((nodesById.get(id)?.type)==='start') return false;
      if(typeof isPortalField === "function" && isPortalField(id)) return false;
      if(typeof isBossField === "function" && isBossField(id)) return false;

      // Figuren blocken
      if(occupied.has(id)) return false;

      // vorhandene Barrikaden blocken (egal ob statisch (node.type) oder dynamisch (Set))
      if(barricades && barricades.has(id)) return false;
      const n = nodesById && nodesById.get ? nodesById.get(id) : null;
      if(n && n.type === "barricade") return false;

      return true; // Event + Ziel + Siegpunkt ist erlaubt
    });

  // Shuffle
  for(let i=candidates.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  let placed = 0;
  for(const id of candidates){
    if(placed>=count) break;
    if(barricades) barricades.add(id); // ✅ Das ist die echte Barrikaden-Quelle im Spiel
    placed++;
  }

  draw();
  return placed;
}

// ---- Event Effect: Barrikaden auf Start-Layout zurücksetzen ----
// - gleiche Anzahl + gleiche Startpositionen wie beim Spielstart
// - zu viele (zusätzliche) werden entfernt
// - wenn Startpositionen gerade blockiert sind: Ersatz-Barrikaden werden auf freie Felder gespawnt




function spawnTwoBossesFromEvent(){
  ensureBossState();
  const results=[];

  for(let i=0;i<2;i++){
    const r = spawnRandomBossFromEvent();
    if(!r.ok) break;
    results.push(r);
  }

  draw();
  console.info("[BOSS] event spawn two", results);
  return results;
}
function spawnRandomBossFromEvent(){
  ensureBossState();

  const alive = (state.bosses || []).filter(b => b && b.alive !== false);
  if(alive.length >= 2){
    draw();
    console.info("[BOSS] event spawn blocked: max active reached");
    return { ok:false, reason:"max_active", active: alive.length };
  }

  let bossFields = nodes.filter(n => n && n.type === "boss").map(n => n.id);
  bossFields = bossFields.filter(id => {
    if(!id) return false;
    if(state.occupied && state.occupied.has(id)) return false;
    if(barricades && barricades.has(id)) return false;
    if(state.goalNodeId && id === state.goalNodeId) return false;
    if(state.eventActive && state.eventActive.has(id)) return false;
    if(alive.some(b => b.node === id)) return false;
    return true;
  });

  if(!bossFields.length){
    draw();
    console.info("[BOSS] event spawn blocked: no free boss field");
    return { ok:false, reason:"no_free_boss_field", active: alive.length };
  }

  const bossTypes = Object.keys(BOSS_TYPES || {});
  if(!bossTypes.length){
    draw();
    console.info("[BOSS] event spawn blocked: no boss types");
    return { ok:false, reason:"no_boss_types", active: alive.length };
  }

  const type = bossTypes[Math.floor(Math.random() * bossTypes.length)];
  const nodeId = bossFields[Math.floor(Math.random() * bossFields.length)];

  const boss = spawnBoss(type, nodeId);
  draw();

  if(!boss){
    console.info("[BOSS] event spawn failed", { type, nodeId });
    return { ok:false, reason:"spawn_failed", active: alive.length };
  }

  console.info("[BOSS] event spawned", { type: boss.type, id: boss.id, node: boss.node });
  return { ok:true, type: boss.type, id: boss.id, node: boss.node, active: (state.bosses || []).filter(b => b && b.alive !== false).length };
}




function removeAllJokersFromTeam(team){
  ensureJokerState();

  const inv = {};
  let removed = 0;

  for(const j of JOKERS){
    removed += Number(jokerCount(team, j.id) || 0);
    inv[j.id] = 0;
  }

  state.jokers[team] = inv;
  updateJokerUI();
  ensureEventSelectUI();
  console.info("[EVENT] all jokers removed", { team, removed });
  return { team, removed };
}



function sendOtherTeamsPiecesToStart(exceptTeam){
  const otherPieces = (state.pieces || []).filter(p => p && p.team !== exceptTeam);

  const startsByTeam = new Map();
  for(const n of nodes){
    if(n && n.type === "start"){
      const t = Number(n.props?.startTeam || 0);
      if(!startsByTeam.has(t)) startsByTeam.set(t, []);
      startsByTeam.get(t).push(n.id);
    }
  }

  let moved = 0;
  const reset = [];

  // Nur die anderen Teams aus occupied entfernen.
  // Das aktive Team bleibt komplett unangetastet.
  for(const p of otherPieces){
    if(p && p.node){
      state.occupied.delete(p.node);
    }
  }

  const usedStarts = new Set();

  for(const p of otherPieces){
    const starts = (startsByTeam.get(p.team) || []).filter(id => !usedStarts.has(id));
    let placed = false;

    for(const sid of starts){
      if(!state.occupied.has(sid)){
        if(p.node !== sid) moved++;
        p.prev = p.node || null;
        p.node = sid;
        p.shielded = false;
        state.occupied.set(sid, p.id);
        usedStarts.add(sid);
        reset.push(p.id);
        placed = true;
        break;
      }
    }

    if(!placed){
      p.prev = p.node || null;
      p.node = null;
      p.shielded = false;
    }
  }

  draw();
  console.info("[EVENT] others_to_start", { exceptTeam, moved, reset });
  return { ok:true, exceptTeam, moved, total:otherPieces.length, reset };
}

function sendTeamPiecesToStart(team){
  if(!team) return { ok:false, reason:"no_team", moved:0, total:0 };

  const teamPieces = (state.pieces || []).filter(p => p && p.team === team);
  const teamStarts = nodes
    .filter(n => n && n.type === "start" && Number(n.props?.startTeam) === team)
    .map(n => n.id);

  if(!teamStarts.length){
    draw();
    return { ok:false, reason:"no_start_fields", team, moved:0, total:teamPieces.length };
  }

  // Alle eigenen Figuren erst aus occupied entfernen
  for(const p of teamPieces){
    if(p && p.node){
      state.occupied.delete(p.node);
    }
  }

  let moved = 0;
  const reset = [];

  for(let i=0; i<teamPieces.length; i++){
    const p = teamPieces[i];
    const target = teamStarts[i] || null;

    p.prev = p.node || null;
    p.shielded = false;

    if(target){
      if(p.node !== target) moved++;
      p.node = target;
      state.occupied.set(target, p.id);
      reset.push(p.id);
    } else {
      p.node = null;
    }
  }

  draw();
  console.info("[EVENT] back_to_start_team", { team, moved, reset });
  return { ok:true, team, moved, total:teamPieces.length, reset };
}

function sendAllPlayersToStart(){
  let moved = 0;
  const reset = [];

  // belegung neu aufbauen
  state.occupied.clear();

  const startsByTeam = new Map();
  for(const n of nodes){
    if(n.type === "start"){
      const t = Number(n.props?.startTeam || 0);
      if(!startsByTeam.has(t)) startsByTeam.set(t, []);
      startsByTeam.get(t).push(n.id);
    }
  }

  for(const p of state.pieces){
    if(!p) continue;
    const teamStarts = startsByTeam.get(p.team) || [];
    let placed = false;

    for(const sid of teamStarts){
      if(!state.occupied.has(sid)){
        if(p.node !== sid) moved++;
        p.prev = p.node || null;
        p.node = sid;
        p.shielded = false;
        state.occupied.set(sid, p.id);
        placed = true;
        reset.push(p.id);
        break;
      }
    }

    if(!placed){
      p.prev = p.node || null;
      p.node = null;
      p.shielded = false;
    }
  }

  state.selected = null;
  state.highlighted.clear();
  state.placeHighlighted.clear();
  state.jokerHighlighted.clear();

  draw();
  console.info("[EVENT] all_to_start", { moved, reset });
  return { moved, total: state.pieces.length };
}

function grantExtraRollFromEvent(){
  state.extraRoll = true;
  console.info("[EVENT] extra roll granted");
  return true;
}

function activateBarricadeJumpReroll(){
  state.ignoreBarricadesThisTurn = true;
  state.roll = null;
  state.selected = null;
  state.highlighted.clear();
  state.placeHighlighted.clear();
  ensurePortalState();
  state.portalHighlighted.clear();
  state.portalUsedThisTurn = false;
  state.phase = "needRoll";
  dieBox.textContent = "–";
  setStatus(`⚔️ Sturmangriff! Team ${currentTeam()} darf sofort nochmal würfeln und ignoriert Barrikaden auf dem Weg bis der Zug endet.`);
  updateJokerUI();
  ensureEventSelectUI();
  draw();
  console.info("[EVENT] storm attack active for team", currentTeam());
  return true;
}

function removeHalfBarricades(){
  const arr = Array.from(barricades || []);
  const total = arr.length;
  if(total <= 0){
    draw();
    return { total:0, removed:0, left:0 };
  }

  // Bei ungerader Zahl wird abgerundet: 5 -> 2 weg, 3 bleiben
  const removeCount = Math.floor(total / 2);

  for(let i=arr.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }

  for(let i=0;i<removeCount;i++){
    barricades.delete(arr[i]);
  }

  draw();
  console.info("[BARRICADE] half remove:", { total, removed: removeCount, left: barricades.size });
  return { total, removed: removeCount, left: barricades.size };
}

function resetBarricadesToInitial(){
  // Fallback: falls Snapshot fehlt, neu aus Board-Nodes lesen
  let layout = (Array.isArray(state.initialBarricadeLayout) && state.initialBarricadeLayout.length>0)
    ? state.initialBarricadeLayout.slice()
    : nodes.filter(n=>n.type==="barricade").map(n=>n.id);

  const targetCount = layout.length;

  const occupied = new Set();
  for(const p of (state.pieces||[])) occupied.add(p.node);

  const bossOcc = new Set();
  if(Array.isArray(state.bosses)){
    for(const bb of state.bosses){
      if(bb && bb.alive!==false && bb.node) bossOcc.add(bb.node);
    }
  }

  barricades.clear();

  let placed = 0;
  for(const id of layout){
    if(!id) continue;
    if(occupied.has(id)) continue;
    if(bossOcc.has(id)) continue;
    // Start/Portal/Boss sollten im Layout eh nicht vorkommen, aber sicher ist sicher:
    if((nodesById.get(id)?.type)==='start') continue;
    if(typeof isPortalField === "function" && isPortalField(id)) continue;
    if(typeof isBossField === "function" && isBossField(id)) continue;

    barricades.add(id);
    placed++;
  }

  // Ersatz spawnen, falls durch Blockierung weniger gesetzt werden konnte
  const missing = Math.max(0, targetCount - barricades.size);
  if(missing>0){
    spawnExtraBarricades(missing);
  }

  draw();
  return { targetCount, placed: barricades.size, missing };
}

// ---- Event Effect: Barrikaden neu mischen ----
// Setzt alle aktuell vorhandenen Barrikaden (Anzahl bleibt gleich) auf neue zufällige Felder.
// Regeln (wie von dir gewünscht):
// - NICHT auf Startfelder
// - NICHT auf Portalfelder
// - NICHT auf Felder, auf denen eine Spielfigur steht
// - NICHT auf Bossfelder
// - Ziel-/Ereignis-/Siegpunktfelder sind erlaubt (wenn sie normale Felder sind)
function shuffleBarricadesRandomly(){
  const count = barricades ? barricades.size : 0;
  if(count<=0){
    draw();
    return { count:0, placed:0, reason:"no_barricades" };
  }

  const occupied = new Set();
  for(const p of (state.pieces || [])){
    if(p && p.node) occupied.add(p.node);
  }

  const bossOcc = new Set();
  if(Array.isArray(state.bosses)){
    for(const bb of state.bosses){
      if(bb && bb.alive!==false && bb.node) bossOcc.add(bb.node);
    }
  }

  // Kandidaten: alle Node-IDs, die nicht verboten sind
  const candidates = nodes
    .map(n=>n.id)
    .filter(id=>{
      if(!id) return false;
      const n = nodesById.get(id);
      if(!n) return false;

      // Start
      if(n.type === "start") return false;

      // Portal
      if(n.type === "portal") return false;
      if(typeof isPortalField === "function" && isPortalField(id)) return false;

      // Boss (falls Helfer existieren, nutzen)
      if(typeof isBossField === "function" && isBossField(id)) return false;
      if(bossOcc.has(id)) return false;

      // Figuren blocken
      if(occupied.has(id)) return false;

      // Keine Barrikade auf Barrikade (wir setzen neu)
      // (Wichtig: wir clearen gleich barricades, deshalb hier nicht checken)

      // Optional: wenn Board statische barricade Nodes hätte, blocken:
      if(n.type === "barricade") return false;

      return true;
    });

  // Shuffle (Fisher-Yates)
  for(let i=candidates.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  barricades.clear();

  const maxPlace = Math.min(count, candidates.length);
  for(let i=0;i<maxPlace;i++){
    barricades.add(candidates[i]);
  }

  draw();
  return { count, placed: maxPlace, shortage: Math.max(0, count - maxPlace) };
}

// ---- Event Effect: Barrikaden auf alle Ereignisfelder + Zielfeld ----
// 1 pro Feld. Erlaubt: Ereignisfelder & Zielfeld. Verboten: Start/Portal/Boss, Felder mit Figur.
// Wenn dort schon eine Barrikade liegt, bleibt es dabei (kein Stack).

// ---- Event Effect: Barrikaden auf alle Ereignisfelder + Zielfeld ----
// 1 pro Feld. Erlaubt: Ereignisfelder & Zielfeld.
// Verboten: Start/Portal/Boss, Felder mit Figur.
// Wenn dort schon eine Barrikade liegt, bleibt es dabei (kein Stack).

// ---- Event Effect: Barrikaden auf alle Ereignisfelder + Zielfeld ----
// 1 pro Feld. Erlaubt: Ereignisfelder & Zielfeld.
// Verboten: Start/Portal/Boss, Felder mit Figur.
// Wenn dort schon eine Barrikade liegt, bleibt es dabei (kein Stack).
function placeBarricadesOnEventAndGoal(){
  // Nur auf AKTUELL freie Felder:
  // - aktuelle Eventfelder aus state.eventActive
  // - aktuelles Siegpunktfeld aus state.goalNodeId
  // - NICHT auf Start / Portal / Boss
  // - NICHT auf Figuren
  // - NICHT wenn schon Barrikade dort liegt
  const occupied = new Set();
  for(const p of (state.pieces || [])){
    if(p && p.node) occupied.add(p.node);
  }

  const targets = [];
  if(state.eventActive && typeof state.eventActive.forEach === "function"){
    state.eventActive.forEach(id => {
      if(id) targets.push(id);
    });
  }

  if(state.goalNodeId) targets.push(state.goalNodeId);

  let placed = 0;
  let skippedOccupied = 0;
  let skippedBlocked = 0;
  let skippedAlreadyBarricade = 0;

  for(const id of targets){
    const n = nodesById.get(id);
    if(!n) continue;

    // blockierte Spezialfelder
    if(n.type === "start" || n.type === "portal" || n.type === "boss"){
      skippedBlocked++;
      continue;
    }

    // nur freie Felder
    if(occupied.has(id)){
      skippedOccupied++;
      continue;
    }
    if(barricades.has(id)){
      skippedAlreadyBarricade++;
      continue;
    }

    barricades.add(id);
    placed++;
  }

  draw();
  console.info("[BARRICADE] invasion:", {
    targets: targets.slice(),
    placed,
    skippedOccupied,
    skippedBlocked,
    skippedAlreadyBarricade
  });

  return {
    placed,
    targetCount: targets.length,
    skippedOccupied,
    skippedBlocked,
    skippedAlreadyBarricade
  };
}









// ---- Event Effect: Startfeld-Spawn (nur komplett freie Felder) ----
function isEventNode(id){
  // Eventfelder kommen aus state.eventActive (wird aus Board initialisiert / respawned)
  return !!id && state.eventActive && state.eventActive.has(id);
}
function isGoalNode(id){
  return !!id && state.goalNodeId && id === state.goalNodeId;
}
function isBossNode(id){
  const n = nodesById.get(id);
  return !!n && n.type === "boss";
}
function isPlainFreeNode(id){
  const n = nodesById.get(id);
  if(!n) return false;
  // "Komplett frei": normaler Knoten, keine Spezialtypen
  if(n.type !== "normal") return false;
  if(isGoalNode(id)) return false;
  if(isStartNode(id)) return false;
  if(isPortalNode(id)) return false;
  if(isBossNode(id)) return false;
  if(isEventNode(id)) return false;
  if(barricades && barricades.has(id)) return false;
  if(state.occupied && state.occupied.has(id)) return false;
  return true;
}

function spawnStartPiecesRoundRobin(onDone){
  // sammle alle Figuren, die auf Start stehen
  const startPieces = state.pieces.filter(p=>p && p.node && isStartNode(p.node));
  if(!startPieces.length){
    setStatus("⚔ Startfeld-Spawn: Keine Figuren auf Startfeldern.");
    if(onDone) onDone();
    return;
  }

  // freie Felder (komplett frei)
  const free = nodes.map(n=>n.id).filter(isPlainFreeNode);

  if(!free.length){
    setStatus("⚔ Startfeld-Spawn: Keine freien Felder gefunden.");
    if(onDone) onDone();
    return;
  }

  // Shuffle freie Felder
  for(let i=free.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    const t=free[i]; free[i]=free[j]; free[j]=t;
  }

  // Gruppiere nach Team für gleichmäßige Verteilung
  const byTeam = new Map();
  for(const p of startPieces){
    if(!byTeam.has(p.team)) byTeam.set(p.team, []);
    byTeam.get(p.team).push(p);
  }
  // Shuffle innerhalb Team für Chaos
  for(const arr of byTeam.values()){
    for(let i=arr.length-1;i>0;i--){
      const j=Math.floor(Math.random()*(i+1));
      const t=arr[i]; arr[i]=arr[j]; arr[j]=t;
    }
  }

  // Round-robin Reihenfolge: nach state.players (damit konsistent)
  const teamOrder = (state.players && state.players.length) ? state.players.slice() : [1,2,3,4];

  // Baue Zuweisungen (max free.length)
  const assigns = [];
  let idxFree = 0;
  while(idxFree < free.length){
    let any = false;
    for(const t of teamOrder){
      const arr = byTeam.get(t);
      if(arr && arr.length && idxFree < free.length){
        assigns.push({ piece: arr.pop(), node: free[idxFree++] });
        any = true;
      }
    }
    if(!any) break;
  }

  const overflow = startPieces.length - assigns.length;

  // während Spawn: keine Event-Trigger durch die künstlichen Positionswechsel
  const prevPhase = state.phase;
  state._suspendEvents = true;
  state.phase = "spawning";
  setStatus(`⚔ Startfeld-Spawn: ${assigns.length} Figur(en) werden verteilt${overflow>0 ? ` (${overflow} bleiben auf Start)` : ""}…`);

  let k=0;
  function step(){
    if(k >= assigns.length){
      state._suspendEvents = false;
      state.phase = prevPhase;
      draw();
      setStatus(`⚔ Startfeld-Spawn abgeschlossen: ${assigns.length} verteilt${overflow>0 ? `, ${overflow} auf Start geblieben` : ""}.`);
      if(onDone) onDone();
      return;
    }
    const {piece, node} = assigns[k++];
    // move piece + occupied map
    if(piece && piece.node){
      state.occupied.delete(piece.node);
      piece.prev = piece.node;
      piece.node = node;
      state.occupied.set(node, piece.id);
    }
    draw();
    setTimeout(step, 500);
  }
  step();
}



// ---- Event Reward: alle 6 Joker (+1 je Typ, capped) ----
function grantAllSixJokers(team){
  ensureJokerState();
  const before = {};
  for(const j of JOKERS) before[j.id] = jokerCount(team, j.id);

  for(const j of JOKERS){
    addJoker(team, j.id, 1);
  }
  updateJokerUI();

  const gained = [];
  for(const j of JOKERS){
    const a = jokerCount(team, j.id);
    const g = Math.max(0, a - before[j.id]);
    gained.push({ id:j.id, name:j.name||j.id, gained:g, now:a });
  }
  return gained;
}


// ---- Event Effect: Figuren mischen (Permutation) ----
function shufflePiecesSmart(){
  // Eligible pieces: not on start, not shielded, not on portal
  const eligible = state.pieces.filter(p=>{
    if(!p.node) return false;
    if(isStartNode(p.node)) return false;
    if(p.shielded) return false;
    if(isPortalNode(p.node)) return false;
    return true;
  });

  if(eligible.length < 2){
    setStatus("🌀 Figuren mischen: Zu wenige Figuren zum Mischen.");
    return;
  }

  // Collect current nodes and shuffle them
  const nodesList = eligible.map(p=>p.node);
  for(let i=nodesList.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    const tmp = nodesList[i]; nodesList[i]=nodesList[j]; nodesList[j]=tmp;
  }

  // Clear occupied for these nodes first
  for(const p of eligible){
    state.occupied.delete(p.node);
  }

  // Reassign
  for(let i=0;i<eligible.length;i++){
    const p = eligible[i];
    p.prev = p.node;
    p.node = nodesList[i];
    state.occupied.set(p.node, p.id);
  }

  setStatus(`🌀 Figuren gemischt: ${eligible.length} Figuren wurden neu verteilt.`);
}

// ---- Event Effect: Joker-Regen (alle anderen erhalten 2 zufällige Joker; 2 verschiedene) ----
function applyJokerRain(sourceTeam){
  ensureJokerState();
  const jokerIds = JOKERS.map(j=>j.id);

  for(const team of state.players){
    if(team === sourceTeam) continue;

    // pick 2 different jokers (no reroll even if max reached)
    const a = jokerIds[Math.floor(Math.random()*jokerIds.length)];
    let b = a;
    // ensure different
    if(jokerIds.length > 1){
      while(b === a) b = jokerIds[Math.floor(Math.random()*jokerIds.length)];
    }

    addJoker(team, a, 1);
    addJoker(team, b, 1);
  }

  updateJokerUI();
}





function showEventOverlay(card, onClose){
  let ov = document.getElementById("eventOverlay");
  if(!ov){
    ov = document.createElement("div");
    ov.id = "eventOverlay";
    ov.style.cssText = [
      "position:fixed","inset:0","display:none",
      "align-items:center","justify-content:center",
      "z-index:99997",
      "background:rgba(0,0,0,.48)"
    ].join(";") + ";";

    ov.innerHTML = `
      <div id="eventCard" style="
        width:min(560px, calc(100vw - 28px));
        border-radius:18px;
        padding:18px 18px 14px;
        background:
          radial-gradient(900px 380px at 50% 10%, rgba(255,255,255,.55), rgba(255,255,255,0) 65%),
          repeating-linear-gradient(90deg, rgba(70,55,38,.05), rgba(70,55,38,.05) 1px, rgba(0,0,0,0) 1px, rgba(0,0,0,0) 26px),
          repeating-linear-gradient(0deg, rgba(70,55,38,.03), rgba(70,55,38,.03) 1px, rgba(0,0,0,0) 1px, rgba(0,0,0,0) 34px),
          linear-gradient(180deg, #f3e7c9 0%, #ead8ab 60%, #ddc58f 100%);
        border:1px solid rgba(0,0,0,.22);
        box-shadow:0 22px 70px rgba(0,0,0,.55);
        color:rgba(38,26,18,.92);
        font-family: ui-serif, Georgia, 'Times New Roman', Times, serif;
        position:relative;
      ">
        <div style="display:flex; align-items:flex-start; gap:12px; margin-bottom:10px;">
          <div style="
            width:44px; height:44px; border-radius:16px;
            display:flex; align-items:center; justify-content:center;
            background:linear-gradient(180deg, rgba(255,255,255,.20), rgba(0,0,0,.10)),
                       radial-gradient(circle at 35% 35%, rgba(200,55,65,.98), rgba(90,14,18,.96));
            border:1px solid rgba(0,0,0,.28);
            box-shadow: inset 0 0 0 2px rgba(255,240,232,.12);
            color:rgba(255,245,235,.92);
            font-weight:900;
          ">✦</div>

          <div style="flex:1;">
            <div id="eventTitle" style="font-weight:900; font-size:20px; letter-spacing:.2px; line-height:1.15;">Ereignis</div>
            <div style="opacity:.72; font-size:12px; margin-top:2px;">Ereigniskarte (Wachssiegel)</div>
          </div>

          <button id="eventCloseX" title="Schließen" style="
            border:1px solid rgba(0,0,0,.22);
            background:rgba(255,255,255,.55);
            color:rgba(38,26,18,.85);
            border-radius:12px;
            width:38px; height:38px;
            display:flex; align-items:center; justify-content:center;
            font-size:16px;
            cursor:pointer;
          ">✕</button>
        </div>

        <div id="eventText" style="
          font-size:15px;
          line-height:1.4;
          padding:12px 12px;
          border-radius:14px;
          background:rgba(255,255,255,.35);
          border:1px dashed rgba(0,0,0,.18);
          margin-bottom:12px;
          white-space:pre-wrap;
        "></div>

        <div style="display:flex; gap:10px; justify-content:flex-end; align-items:center;">
          <button id="eventOk" style="
            cursor:pointer;
            padding:10px 14px;
            border-radius:12px;
            border:1px solid rgba(0,0,0,.35);
            background:
              linear-gradient(180deg, rgba(255,255,255,.18), rgba(0,0,0,.18)),
              linear-gradient(180deg, #6a4a2f, #4f3623);
            color:rgba(255,250,235,.92);
            font-weight:800;
            text-shadow:0 1px 0 rgba(0,0,0,.45);
          ">Annehmen</button>
        </div>

        <div style="
          position:absolute; right:14px; bottom:12px;
          width:58px; height:58px; border-radius:22px;
          background:
            radial-gradient(circle at 35% 35%, rgba(200,55,65,.98), rgba(90,14,18,.96));
          border:1px solid rgba(0,0,0,.30);
          box-shadow: 0 14px 26px rgba(0,0,0,.35), inset 0 0 0 2px rgba(255,240,232,.10);
          display:flex; align-items:center; justify-content:center;
          color:rgba(255,245,235,.92);
          font-size:18px; font-weight:900;
          transform: rotate(-8deg);
          opacity:.92;
          pointer-events:none;
        ">✦</div>
      </div>
    `;

    document.body.appendChild(ov);

    // Prevent closing by clicking inside card
    ov.addEventListener("click",(e)=>{
      if(e.target===ov){ if(!overlayClickAllowed(ov)) return; doClose(); }
    });

    function doClose(){
      ov.style.display="none";
      if(typeof onClose==="function") onClose();
    }

    ov._doClose = doClose;

    ov.querySelector("#eventOk").addEventListener("click", doClose);
    ov.querySelector("#eventCloseX").addEventListener("click", doClose);
  }

  // update content + show
  ov.querySelector("#eventTitle").textContent = card?.title || "Ereignis";
  ov.querySelector("#eventText").textContent = card?.text || "";
  ov.style.display="flex";

  // If onClose changes between calls, update handler
  ov._doClose = (function(){
    return function(){
      ov.style.display="none";
      if(typeof onClose==="function") onClose();
    };
  })();

  // Rebind buttons to new onClose
  const okBtn = ov.querySelector("#eventOk");
  const xBtn  = ov.querySelector("#eventCloseX");
  okBtn.onclick = ov._doClose;
  xBtn.onclick  = ov._doClose;
}


function showJokerPick6Overlay(team, onClose){
  ensureJokerState();

  let ov = document.getElementById("jokerPick6Overlay");
  if(!ov){
    ov = document.createElement("div");
    ov.id = "jokerPick6Overlay";
    ov.style.cssText = [
      "position:fixed","inset:0","display:none",
      "align-items:center","justify-content:center",
      "z-index:99998",
      "background:rgba(0,0,0,.52)"
    ].join(";") + ";";

    ov.innerHTML = `
      <div style="
        width:min(720px, calc(100vw - 28px));
        border-radius:18px;
        padding:16px;
        background:
          radial-gradient(900px 380px at 50% 10%, rgba(255,255,255,.55), rgba(255,255,255,0) 65%),
          repeating-linear-gradient(90deg, rgba(70,55,38,.05), rgba(70,55,38,.05) 1px, rgba(0,0,0,0) 1px, rgba(0,0,0,0) 26px),
          repeating-linear-gradient(0deg, rgba(70,55,38,.03), rgba(70,55,38,.03) 1px, rgba(0,0,0,0) 1px, rgba(0,0,0,0) 34px),
          linear-gradient(180deg, #f3e7c9 0%, #ead8ab 60%, #ddc58f 100%);
        border:1px solid rgba(0,0,0,.22);
        box-shadow:0 22px 70px rgba(0,0,0,.55);
        color:rgba(38,26,18,.92);
        font-family: ui-serif, Georgia, 'Times New Roman', Times, serif;
        position:relative;
      ">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:10px;">
          <div>
            <div style="font-weight:900; font-size:20px; letter-spacing:.2px;">🃏 Zufälliger Joker</div>
            <div style="opacity:.72; font-size:12px; margin-top:2px;">Wähle eine Karte – danach werden alle umgedreht.</div>
          </div>
          <button id="jp6CloseX" title="Schließen" style="
            border:1px solid rgba(0,0,0,.22);
            background:rgba(255,255,255,.55);
            color:rgba(38,26,18,.85);
            border-radius:12px;
            width:38px; height:38px;
            display:flex; align-items:center; justify-content:center;
            font-size:16px;
            cursor:pointer;
          ">✕</button>
        </div>

        <div id="jp6Grid" style="
          display:grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap:12px;
          margin: 12px 0 14px;
        "></div>

        <div style="display:flex; gap:10px; justify-content:flex-end; align-items:center;">
          <div id="jp6Result" style="flex:1; opacity:.85; font-weight:800;"></div>
          <button id="jp6Ok" disabled style="
            cursor:not-allowed;
            padding:10px 14px;
            border-radius:12px;
            border:1px solid rgba(0,0,0,.35);
            background:
              linear-gradient(180deg, rgba(255,255,255,.18), rgba(0,0,0,.18)),
              linear-gradient(180deg, #6a4a2f, #4f3623);
            color:rgba(255,250,235,.92);
            font-weight:900;
            text-shadow:0 1px 0 rgba(0,0,0,.45);
            opacity:.55;
          ">OK</button>
        </div>
      </div>
    `;

    document.body.appendChild(ov);

    ov.addEventListener("click",(e)=>{
      if(e.target===ov) ov._doClose && ov._doClose();
    });
  }

  // build a fresh 6-card layout each time
  const grid = ov.querySelector("#jp6Grid");
  const result = ov.querySelector("#jp6Result");
  const okBtn = ov.querySelector("#jp6Ok");
  const xBtn  = ov.querySelector("#jp6CloseX");

  grid.innerHTML = "";
  result.textContent = "";
  okBtn.disabled = true;
  okBtn.style.cursor = "not-allowed";
  okBtn.style.opacity = ".55";

  // random jokers behind each card
  const picks = [];
  for(let i=0;i<6;i++){
    const j = JOKERS[Math.floor(Math.random()*JOKERS.length)];
    picks.push(j);
  }

  let chosen = -1;

  function cardStyle(){
    return [
      "user-select:none",
      "height:120px",
      "border-radius:16px",
      "border:1px solid rgba(0,0,0,.28)",
      "box-shadow: inset 0 0 0 2px rgba(255,240,232,.10), 0 14px 28px rgba(0,0,0,.20)",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "text-align:center",
      "padding:10px",
      "cursor:pointer",
      "font-weight:900",
      "letter-spacing:.2px",
      "background:linear-gradient(180deg, rgba(255,255,255,.20), rgba(0,0,0,.12)), radial-gradient(circle at 35% 35%, rgba(200,55,65,.95), rgba(90,14,18,.96))",
      "color:rgba(255,245,235,.95)",
      "transform: translateZ(0)",
      "transition: transform .18s ease, filter .18s ease, opacity .18s ease"
    ].join(";");
  }

  const cardEls = [];
  for(let i=0;i<6;i++){
    const el = document.createElement("div");
    el.className = "jp6Card";
    el.setAttribute("data-idx", String(i));
    el.style.cssText = cardStyle();
    el.innerHTML = `<div style="font-size:26px; line-height:1;">🃏</div><div style="font-size:12px; opacity:.9; margin-top:6px;">Karte ${i+1}</div>`;
    el.addEventListener("mouseenter", ()=>{ if(chosen<0){ el.style.transform="scale(1.03)"; el.style.filter="brightness(1.05)"; }});
    el.addEventListener("mouseleave", ()=>{ if(chosen<0){ el.style.transform="scale(1)"; el.style.filter="none"; }});

    el.addEventListener("click", ()=>{ if(!overlayClickAllowed(ov)) return;
      if(chosen>=0) return;
      chosen = i;

      // flip reveal (simple: swap content + visual)
      for(let k=0;k<6;k++){
        const c = cardEls[k];
        const j = picks[k];
        c.style.cursor = "default";
        c.style.transform = "rotateY(180deg)";
        c.style.background = "linear-gradient(180deg, rgba(255,255,255,.22), rgba(0,0,0,.14)), linear-gradient(180deg, #6a4a2f, #4f3623)";
        c.style.color = "rgba(255,250,235,.95)";
        c.innerHTML = `<div style="transform: rotateY(180deg);"><div style="font-size:14px; opacity:.9;">Joker</div><div style="font-size:18px; margin-top:6px;">${j.name}</div></div>`;
        if(k!==i) c.style.opacity = ".72";
      }

      // highlight chosen
      const chosenEl = cardEls[i];
      chosenEl.style.opacity = "1";
      chosenEl.style.boxShadow = "inset 0 0 0 2px rgba(255,240,232,.20), 0 0 0 3px rgba(255,215,120,.75), 0 18px 36px rgba(0,0,0,.28)";

      // apply reward
      const reward = picks[i];
      addJoker(team, reward.id, 1);
      updateJokerUI();

      result.textContent = `Team ${team} bekommt: ${reward.name} (+1)`;
      okBtn.disabled = false;
      okBtn.style.cursor = "pointer";
      okBtn.style.opacity = "1";
    });

    cardEls.push(el);
    grid.appendChild(el);
  }

  function doClose(){
    ov.style.display="none";
    if(typeof onClose==="function") onClose();
  }
  ov._doClose = doClose;
  okBtn.onclick = ()=>{ if(!overlayClickAllowed(ov)) return; doClose(); };
  xBtn.onclick = ()=>{ if(!overlayClickAllowed(ov)) return; doClose(); };

  markOverlayOpened(ov);
  ov.style.display="flex";
}






function gainTwoGoalPointsFromTeam(team){
  const before = Number((state.goalScores && state.goalScores[team]) || 0);
  const after = before + 2;
  state.goalScores[team] = after;
  draw();
  console.info("[EVENT] gain_two_points", { team, before, after });
  return { team, before, after };
}

function gainOneGoalPointFromTeam(team){
  const before = Number((state.goalScores && state.goalScores[team]) || 0);
  const after = before + 1;
  state.goalScores[team] = after;
  draw();
  console.info("[EVENT] gain_one_point", { team, before, after });
  return { team, before, after };
}

function loseOneGoalPointFromTeam(team){
  const before = Number((state.goalScores && state.goalScores[team]) || 0);
  const after = Math.max(0, before - 1);
  state.goalScores[team] = after;
  draw();
  console.info("[EVENT] lose_one_point", { team, before, after, lost: before - after });
  return { team, before, after, lost: before - after };
}


function resolveMostToLeastPointTransfer(){
  const teams = (state.players || []).slice();
  const scores = {};
  for(const t of teams){
    scores[t] = Number((state.goalScores && state.goalScores[t]) || 0);
  }

  let maxScore = -Infinity;
  let minScore = Infinity;
  for(const t of teams){
    if(scores[t] > maxScore) maxScore = scores[t];
    if(scores[t] < minScore) minScore = scores[t];
  }

  let donorCandidates = teams.filter(t => scores[t] === maxScore);
  let receiverCandidates = teams.filter(t => scores[t] === minScore);

  return {
    teams,
    scores,
    maxScore,
    minScore,
    donorCandidates,
    receiverCandidates
  };
}

function applyMostToLeastPointTransfer(donor, receiver){
  const beforeDonor = Number((state.goalScores && state.goalScores[donor]) || 0);
  const beforeReceiver = Number((state.goalScores && state.goalScores[receiver]) || 0);

  if(donor === receiver){
    draw();
    return {
      ok:false,
      reason:"same_team",
      donor, receiver,
      donorBefore: beforeDonor,
      receiverBefore: beforeReceiver
    };
  }

  if(beforeDonor <= 0){
    draw();
    return {
      ok:false,
      reason:"donor_has_zero",
      donor, receiver,
      donorBefore: beforeDonor,
      receiverBefore: beforeReceiver
    };
  }

  state.goalScores[donor] = beforeDonor - 1;
  state.goalScores[receiver] = beforeReceiver + 1;
  draw();

  console.info("[EVENT] point_transfer_most_to_least", {
    donor, receiver,
    donorBefore: beforeDonor,
    donorAfter: state.goalScores[donor],
    receiverBefore: beforeReceiver,
    receiverAfter: state.goalScores[receiver]
  });

  return {
    ok:true,
    donor, receiver,
    donorBefore: beforeDonor,
    donorAfter: state.goalScores[donor],
    receiverBefore: beforeReceiver,
    receiverAfter: state.goalScores[receiver]
  };
}

function showPointTransferWheelOverlay(onClose){
  let ov = document.getElementById("pointTransferOverlay");
  if(!ov){
    ov = document.createElement("div");
    ov.id = "pointTransferOverlay";
    ov.style.cssText = [
      "position:fixed","inset:0","display:none",
      "align-items:center","justify-content:center",
      "z-index:99998",
      "background:rgba(0,0,0,.58)"
    ].join(";");

    ov.innerHTML = `
      <div style="
        width:min(900px, calc(100vw - 28px));
        border-radius:18px;
        padding:16px;
        background:
          radial-gradient(900px 420px at 50% 0%, rgba(255,255,255,.55), rgba(255,255,255,0) 65%),
          repeating-linear-gradient(90deg, rgba(70,55,38,.05), rgba(70,55,38,.05) 1px, rgba(0,0,0,0) 1px, rgba(0,0,0,0) 26px),
          repeating-linear-gradient(0deg, rgba(70,55,38,.03), rgba(70,55,38,.03) 1px, rgba(0,0,0,0) 1px, rgba(0,0,0,0) 34px),
          linear-gradient(180deg, #f3e7c9 0%, #ead8ab 60%, #ddc58f 100%);
        border:1px solid rgba(0,0,0,.25);
        box-shadow:0 22px 70px rgba(0,0,0,.55);
        color:rgba(38,26,18,.92);
        font-family: ui-serif, Georgia, 'Times New Roman', Times, serif;
        position:relative;
        overflow:hidden;
      ">
        <div style="display:flex; align-items:center; gap:10px; margin-bottom:12px;">
          <div style="
            width:44px; height:44px; border-radius:16px;
            display:flex; align-items:center; justify-content:center;
            background:
              linear-gradient(180deg, rgba(255,255,255,.18), rgba(0,0,0,.14)),
              radial-gradient(circle at 35% 35%, rgba(200,55,65,.98), rgba(90,14,18,.96));
            border:1px solid rgba(0,0,0,.28);
            box-shadow: inset 0 0 0 2px rgba(255,240,232,.12);
            color:rgba(255,245,235,.92);
            font-weight:900;
          ">⚖️</div>
          <div style="flex:1;">
            <div style="font-weight:900; font-size:20px; letter-spacing:.2px; line-height:1.15;">Punktetausch</div>
            <div id="ptSub" style="opacity:.75; font-size:12px; margin-top:2px;">Das Glücksrad entscheidet…</div>
          </div>
          <button id="ptCloseX" title="Schließen" style="
            border:1px solid rgba(0,0,0,.22);
            background:rgba(255,255,255,.55);
            color:rgba(38,26,18,.85);
            border-radius:12px;
            width:38px; height:38px;
            display:flex; align-items:center; justify-content:center;
            font-size:16px;
            cursor:pointer;
          ">✕</button>
        </div>

        <div id="ptScoreboard" style="
          display:grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap:10px;
          margin:12px 0 14px;
        "></div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px;">
          <div style="padding:12px; border-radius:14px; background:rgba(255,255,255,.30); border:1px solid rgba(0,0,0,.14);">
            <div style="font:900 15px system-ui, -apple-system, Segoe UI, Roboto, Arial; margin-bottom:8px;">👑 Gibt 1 Punkt ab</div>
            <div id="ptDonorRow" style="display:flex; gap:10px; flex-wrap:wrap;"></div>
          </div>
          <div style="padding:12px; border-radius:14px; background:rgba(255,255,255,.30); border:1px solid rgba(0,0,0,.14);">
            <div style="font:900 15px system-ui, -apple-system, Segoe UI, Roboto, Arial; margin-bottom:8px;">🪙 Bekommt 1 Punkt</div>
            <div id="ptReceiverRow" style="display:flex; gap:10px; flex-wrap:wrap;"></div>
          </div>
        </div>

        <div id="ptResult" style="
          min-height:74px;
          padding:12px;
          border-radius:14px;
          background:rgba(255,255,255,.30);
          border:1px dashed rgba(0,0,0,.18);
          font-family:system-ui, -apple-system, Segoe UI, Roboto, Arial;
          font-weight:800;
          line-height:1.4;
          white-space:pre-wrap;
        "></div>

        <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:12px;">
          <button id="ptOk" disabled style="
            cursor:not-allowed;
            padding:11px 14px;
            border-radius:12px;
            border:1px solid rgba(0,0,0,.25);
            background:rgba(255,255,255,.45);
            color:rgba(38,26,18,.55);
            font-weight:900;
            opacity:.65;
            min-width:160px;
          ">Schließen</button>
        </div>
      </div>
    `;
    document.body.appendChild(ov);
    ov.addEventListener("click",(e)=>{
      if(e.target===ov){ if(!overlayClickAllowed(ov)) return; ov._doClose && ov._doClose(); }
    });
  }

  const scoreboard = ov.querySelector("#ptScoreboard");
  const donorRow = ov.querySelector("#ptDonorRow");
  const receiverRow = ov.querySelector("#ptReceiverRow");
  const result = ov.querySelector("#ptResult");
  const sub = ov.querySelector("#ptSub");
  const okBtn = ov.querySelector("#ptOk");
  const closeX = ov.querySelector("#ptCloseX");

  const info = resolveMostToLeastPointTransfer();
  scoreboard.innerHTML = "";
  donorRow.innerHTML = "";
  receiverRow.innerHTML = "";
  result.textContent = "Die Spielstände werden ausgewertet…";

  const cardRefs = new Map();
  const wheelRefs = { donor:new Map(), receiver:new Map() };

  for(const team of info.teams){
    const wrap = document.createElement("div");
    wrap.style.cssText = [
      "border-radius:16px",
      "padding:12px",
      "background:rgba(255,255,255,.30)",
      "border:1px solid rgba(0,0,0,.14)",
      "display:flex",
      "flex-direction:column",
      "align-items:center",
      "gap:8px",
      "min-height:114px"
    ].join(";");

    const title = document.createElement("div");
    title.textContent = `Team ${team}`;
    title.style.cssText = "font:900 16px system-ui, -apple-system, Segoe UI, Roboto, Arial; color:rgba(38,26,18,.92);";

    const colorDot = document.createElement("div");
    colorDot.style.cssText = `width:20px;height:20px;border-radius:999px;background:${TEAM_COLORS[team]||"#999"}; border:1px solid rgba(0,0,0,.2);`;

    const score = document.createElement("div");
    score.id = `ptScore_${team}`;
    score.style.cssText = "font:900 28px system-ui, -apple-system, Segoe UI, Roboto, Arial; color:rgba(30,20,14,.92);";
    score.textContent = String(info.scores[team]);

    const note = document.createElement("div");
    note.style.cssText = "font:700 12px system-ui, -apple-system, Segoe UI, Roboto, Arial; opacity:.78;";
    note.textContent = "Siegpunkte";

    wrap.appendChild(title);
    wrap.appendChild(colorDot);
    wrap.appendChild(score);
    wrap.appendChild(note);
    scoreboard.appendChild(wrap);
    cardRefs.set(team, { wrap, score });
  }

  function makeWheelToken(team, labelText){
    const token = document.createElement("div");
    token.style.cssText = [
      "min-width:96px",
      "padding:10px 12px",
      "border-radius:14px",
      "background:rgba(255,255,255,.44)",
      "border:2px solid rgba(0,0,0,.12)",
      "box-shadow:0 8px 18px rgba(0,0,0,.12)",
      "display:flex",
      "flex-direction:column",
      "align-items:center",
      "gap:6px",
      "font-family:system-ui, -apple-system, Segoe UI, Roboto, Arial",
      "font-weight:900"
    ].join(";");

    token.innerHTML = `
      <div style="width:18px;height:18px;border-radius:999px;background:${TEAM_COLORS[team]||"#999"}; border:1px solid rgba(0,0,0,.2);"></div>
      <div>Team ${team}</div>
      <div style="font-size:12px; opacity:.74;">${labelText}</div>
    `;
    return token;
  }

  for(const team of info.donorCandidates){
    const el = makeWheelToken(team, `${info.scores[team]} Punkte`);
    donorRow.appendChild(el);
    wheelRefs.donor.set(team, el);
  }
  for(const team of info.receiverCandidates){
    const el = makeWheelToken(team, `${info.scores[team]} Punkte`);
    receiverRow.appendChild(el);
    wheelRefs.receiver.set(team, el);
  }

  okBtn.disabled = true;
  okBtn.style.cursor = "not-allowed";
  okBtn.style.opacity = ".65";
  closeX.disabled = true;
  closeX.style.opacity = ".5";
  let finished = false;

  function enableClose(){
    finished = true;
    okBtn.disabled = false;
    okBtn.style.cursor = "pointer";
    okBtn.style.opacity = "1";
    okBtn.style.color = "rgba(38,26,18,.88)";
    okBtn.style.background = "rgba(255,255,255,.70)";
    closeX.disabled = false;
    closeX.style.opacity = "1";
  }
  function doClose(){
    if(!finished) return;
    ov.style.display = "none";
    if(typeof onClose === "function") onClose();
  }
  ov._doClose = doClose;
  okBtn.onclick = ()=>{ if(!overlayClickAllowed(ov)) return; doClose(); };
  closeX.onclick = ()=>{ if(!overlayClickAllowed(ov)) return; doClose(); };

  function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

  async function animateWheelPick(candidates, mapRef, label){
    const arr = candidates.slice();
    if(!arr.length) return null;

    for(const el of mapRef.values()){
      el.style.borderColor = "rgba(0,0,0,.12)";
      el.style.boxShadow = "0 8px 18px rgba(0,0,0,.12)";
      el.style.transform = "scale(1)";
    }

    const steps = Math.max(12, arr.length * 5);
    let current = arr[0];
    for(let i=0;i<steps;i++){
      const pick = arr[Math.floor(Math.random()*arr.length)];
      current = pick;
      for(const [team, el] of mapRef.entries()){
        if(team === pick){
          el.style.borderColor = "rgba(200,55,65,.75)";
          el.style.boxShadow = "0 0 0 4px rgba(200,55,65,.18) inset, 0 10px 24px rgba(0,0,0,.18)";
          el.style.transform = "scale(1.05)";
        }else{
          el.style.borderColor = "rgba(0,0,0,.12)";
          el.style.boxShadow = "0 8px 18px rgba(0,0,0,.12)";
          el.style.transform = "scale(1)";
        }
      }
      sub.textContent = `${label}: Glücksrad dreht…`;
      await sleep(120 + i*8);
    }

    for(const [team, el] of mapRef.entries()){
      if(team === current){
        el.style.borderColor = "rgba(40,140,70,.75)";
        el.style.boxShadow = "0 0 0 4px rgba(40,140,70,.18) inset, 0 10px 24px rgba(0,0,0,.18)";
        el.style.transform = "scale(1.06)";
      }else{
        el.style.borderColor = "rgba(0,0,0,.12)";
        el.style.boxShadow = "0 8px 18px rgba(0,0,0,.12)";
        el.style.transform = "scale(1)";
      }
    }
    return current;
  }

  async function run(){
    result.textContent =
      `Höchster Stand: ${info.maxScore}\n` +
      `Niedrigster Stand: ${info.minScore}\n\n` +
      `Bei Gleichstand entscheidet das Glücksrad.`;

    await sleep(500);

    const donor = await animateWheelPick(info.donorCandidates, wheelRefs.donor, "Abgeber");
    await sleep(500);

    let receiverCandidates = info.receiverCandidates.slice();
    if(receiverCandidates.length > 1){
      // if all equal or same team appears in both pools, receiver should be a different team when possible
      const filtered = receiverCandidates.filter(t => t !== donor);
      if(filtered.length) receiverCandidates = filtered;
    }

    // rebuild receiver row if filtered changed
    if(receiverCandidates.length !== info.receiverCandidates.length){
      receiverRow.innerHTML = "";
      wheelRefs.receiver.clear();
      for(const team of receiverCandidates){
        const el = makeWheelToken(team, `${info.scores[team]} Punkte`);
        receiverRow.appendChild(el);
        wheelRefs.receiver.set(team, el);
      }
    }

    await sleep(250);
    const receiver = await animateWheelPick(receiverCandidates, wheelRefs.receiver, "Empfänger");
    await sleep(300);

    const applied = applyMostToLeastPointTransfer(donor, receiver);

    if(!applied.ok){
      if(applied.reason === "donor_has_zero"){
        result.textContent =
          `👑 Abgeber: Team ${donor} (${applied.donorBefore})\n` +
          `🪙 Empfänger: Team ${receiver} (${applied.receiverBefore})\n\n` +
          `Team ${donor} hat keinen Siegpunkt zum Abgeben. Es passiert nichts.`;
        setStatus(`⚖️ Punktetausch: Team ${donor} hat keinen Siegpunkt.`);
      }else{
        result.textContent =
          `👑 Abgeber: Team ${donor}\n` +
          `🪙 Empfänger: Team ${receiver}\n\n` +
          `Dieselbe Mannschaft wurde zweimal gewählt. Es passiert nichts.`;
        setStatus(`⚖️ Punktetausch: Kein Transfer möglich.`);
      }
    }else{
      const donorScoreEl = cardRefs.get(donor)?.score;
      const receiverScoreEl = cardRefs.get(receiver)?.score;
      if(donorScoreEl) donorScoreEl.textContent = String(applied.donorAfter);
      if(receiverScoreEl) receiverScoreEl.textContent = String(applied.receiverAfter);

      result.textContent =
        `👑 Abgeber: Team ${donor} (${applied.donorBefore} → ${applied.donorAfter})\n` +
        `🪙 Empfänger: Team ${receiver} (${applied.receiverBefore} → ${applied.receiverAfter})\n\n` +
        `Team ${donor} gibt Team ${receiver} 1 Siegpunkt.`;
      setStatus(`⚖️ Punktetausch: Team ${donor} gibt Team ${receiver} 1 Siegpunkt.`);
    }

    sub.textContent = "Punktetausch beendet!";
    enableClose();
  }

  markOverlayOpened(ov);
  ov.style.display = "flex";
  run();
}


function transferRandomJokerBetweenTeams(fromTeam, toTeam){
  ensureJokerState();
  const pool = [];
  for(const j of JOKERS){
    const c = jokerCount(fromTeam, j.id);
    if(c > 0) pool.push(j.id);
  }
  if(!pool.length){
    updateJokerUI();
    ensureEventSelectUI();
    return { ok:false, reason:"no_joker" };
  }
  const id = pool[Math.floor(Math.random()*pool.length)];
  state.jokers[fromTeam][id] = Math.max(0, jokerCount(fromTeam, id) - 1);
  addJoker(toTeam, id, 1);
  updateJokerUI();
  ensureEventSelectUI();
  return { ok:true, jokerId:id, jokerName:(JOKERS.find(j=>j.id===id)?.name || id) };
}

function showDiceDuelOverlay(onClose){
  ensureJokerState();

  let ov = document.getElementById("diceDuelOverlay");
  if(!ov){
    ov = document.createElement("div");
    ov.id = "diceDuelOverlay";
    ov.style.cssText = [
      "position:fixed","inset:0","display:none",
      "align-items:center","justify-content:center",
      "z-index:99998",
      "background:rgba(0,0,0,.58)"
    ].join(";");

    ov.innerHTML = `
      <div style="
        width:min(860px, calc(100vw - 28px));
        border-radius:18px;
        padding:16px;
        background:
          radial-gradient(900px 420px at 50% 0%, rgba(255,255,255,.55), rgba(255,255,255,0) 65%),
          repeating-linear-gradient(90deg, rgba(70,55,38,.05), rgba(70,55,38,.05) 1px, rgba(0,0,0,0) 1px, rgba(0,0,0,0) 26px),
          repeating-linear-gradient(0deg, rgba(70,55,38,.03), rgba(70,55,38,.03) 1px, rgba(0,0,0,0) 1px, rgba(0,0,0,0) 34px),
          linear-gradient(180deg, #f3e7c9 0%, #ead8ab 60%, #ddc58f 100%);
        border:1px solid rgba(0,0,0,.25);
        box-shadow:0 22px 70px rgba(0,0,0,.55);
        color:rgba(38,26,18,.92);
        font-family: ui-serif, Georgia, 'Times New Roman', Times, serif;
        position:relative;
        overflow:hidden;
      ">
        <div style="display:flex; align-items:center; gap:10px; margin-bottom:12px;">
          <div style="
            width:44px; height:44px; border-radius:16px;
            display:flex; align-items:center; justify-content:center;
            background:
              linear-gradient(180deg, rgba(255,255,255,.18), rgba(0,0,0,.14)),
              radial-gradient(circle at 35% 35%, rgba(200,55,65,.98), rgba(90,14,18,.96));
            border:1px solid rgba(0,0,0,.28);
            box-shadow: inset 0 0 0 2px rgba(255,240,232,.12);
            color:rgba(255,245,235,.92);
            font-weight:900;
          ">🎲</div>
          <div style="flex:1;">
            <div style="font-weight:900; font-size:20px; letter-spacing:.2px; line-height:1.15;">Würfel-Duell</div>
            <div id="ddSub" style="opacity:.75; font-size:12px; margin-top:2px;">Alle würfeln automatisch…</div>
          </div>
          <button id="ddCloseX" title="Schließen" style="
            border:1px solid rgba(0,0,0,.22);
            background:rgba(255,255,255,.55);
            color:rgba(38,26,18,.85);
            border-radius:12px;
            width:38px; height:38px;
            display:flex; align-items:center; justify-content:center;
            font-size:16px;
            cursor:pointer;
          ">✕</button>
        </div>

        <div id="ddRow" style="
          display:grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap:10px;
          margin:12px 0 14px;
        "></div>

        <div id="ddResult" style="
          min-height:60px;
          padding:12px;
          border-radius:14px;
          background:rgba(255,255,255,.30);
          border:1px dashed rgba(0,0,0,.18);
          font-family:system-ui, -apple-system, Segoe UI, Roboto, Arial;
          font-weight:800;
          line-height:1.4;
          white-space:pre-wrap;
        "></div>

        <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:12px;">
          <button id="ddOk" disabled style="
            cursor:not-allowed;
            padding:11px 14px;
            border-radius:12px;
            border:1px solid rgba(0,0,0,.25);
            background:rgba(255,255,255,.45);
            color:rgba(38,26,18,.55);
            font-weight:900;
            opacity:.65;
            min-width:160px;
          ">Schließen</button>
        </div>
      </div>
    `;
    document.body.appendChild(ov);
    ov.addEventListener("click",(e)=>{
      if(e.target===ov){ if(!overlayClickAllowed(ov)) return; ov._doClose && ov._doClose(); }
    });
  }

  const row = ov.querySelector("#ddRow");
  const result = ov.querySelector("#ddResult");
  const sub = ov.querySelector("#ddSub");
  const okBtn = ov.querySelector("#ddOk");
  const closeX = ov.querySelector("#ddCloseX");

  const teams = state.players.slice();
  row.innerHTML = "";
  result.textContent = "Die Würfel rollen…";
  sub.textContent = "Alle würfeln automatisch…";

  const cardRefs = new Map();
  for(const team of teams){
    const wrap = document.createElement("div");
    wrap.style.cssText = [
      "border-radius:16px",
      "padding:12px",
      "background:rgba(255,255,255,.30)",
      "border:1px solid rgba(0,0,0,.14)",
      "display:flex",
      "flex-direction:column",
      "align-items:center",
      "gap:10px",
      "min-height:146px"
    ].join(";");

    const title = document.createElement("div");
    title.textContent = `Team ${team}`;
    title.style.cssText = "font:900 16px system-ui, -apple-system, Segoe UI, Roboto, Arial; color:rgba(38,26,18,.92);";

    const colorDot = document.createElement("div");
    colorDot.style.cssText = `width:18px;height:18px;border-radius:999px;background:${TEAM_COLORS[team]||"#999"}; border:1px solid rgba(0,0,0,.2);`;

    const die = document.createElement("div");
    die.style.cssText = [
      "width:64px","height:64px","border-radius:16px",
      "display:flex","align-items:center","justify-content:center",
      "font:900 28px system-ui, -apple-system, Segoe UI, Roboto, Arial",
      "background:rgba(255,255,255,.88)",
      "color:rgba(30,20,14,.92)",
      "border:3px solid rgba(0,0,0,.15)",
      "box-shadow:0 12px 24px rgba(0,0,0,.18)"
    ].join(";");
    die.textContent = "🎲";

    const line = document.createElement("div");
    line.style.cssText = "font:800 13px system-ui, -apple-system, Segoe UI, Roboto, Arial; opacity:.82;";
    line.textContent = "wartet…";

    wrap.appendChild(title);
    wrap.appendChild(colorDot);
    wrap.appendChild(die);
    wrap.appendChild(line);
    row.appendChild(wrap);
    cardRefs.set(team, { wrap, die, line });
  }

  okBtn.disabled = true;
  okBtn.style.cursor = "not-allowed";
  okBtn.style.opacity = ".65";
  closeX.disabled = true;
  closeX.style.opacity = ".5";
  let finished = false;

  function enableClose(){
    finished = true;
    okBtn.disabled = false;
    okBtn.style.cursor = "pointer";
    okBtn.style.opacity = "1";
    okBtn.style.color = "rgba(38,26,18,.88)";
    okBtn.style.background = "rgba(255,255,255,.70)";
    closeX.disabled = false;
    closeX.style.opacity = "1";
  }

  function doClose(){
    if(!finished) return;
    ov.style.display = "none";
    if(typeof onClose === "function") onClose();
  }
  ov._doClose = doClose;
  okBtn.onclick = ()=>{ if(!overlayClickAllowed(ov)) return; doClose(); };
  closeX.onclick = ()=>{ if(!overlayClickAllowed(ov)) return; doClose(); };

  function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

  async function animateTeamRoll(team){
    const ref = cardRefs.get(team);
    if(!ref) return 1;
    ref.line.textContent = "würfelt…";
    const faces = ["⚀","⚁","⚂","⚃","⚄","⚅"];
    for(let i=0;i<8;i++){
      ref.die.textContent = faces[Math.floor(Math.random()*6)];
      ref.die.style.transform = `rotate(${(-12 + Math.random()*24).toFixed(1)}deg) scale(${(0.95 + Math.random()*0.12).toFixed(2)})`;
      await sleep(80);
    }
    const val = Math.floor(Math.random()*6) + 1;
    ref.die.textContent = String(val);
    ref.die.style.transform = "rotate(0deg) scale(1)";
    ref.line.textContent = `Wurf: ${val}`;
    return val;
  }

  async function run(){
    const rolls = {};
    let highestTeams = [];
    let lowestTeams = [];

    while(true){
      sub.textContent = "Alle würfeln automatisch…";
      for(const team of teams){
        const ref = cardRefs.get(team);
        ref.wrap.style.boxShadow = "none";
        ref.wrap.style.borderColor = "rgba(0,0,0,.14)";
      }

      for(const team of teams){
        rolls[team] = await animateTeamRoll(team);
        await sleep(220);
      }

      let maxVal = Math.max(...teams.map(t=>rolls[t]));
      let minVal = Math.min(...teams.map(t=>rolls[t]));
      highestTeams = teams.filter(t=>rolls[t]===maxVal);
      lowestTeams  = teams.filter(t=>rolls[t]===minVal);

      if(highestTeams.length===1 && lowestTeams.length===1 && highestTeams[0] !== lowestTeams[0]){
        break;
      }

      const parts = [];
      if(highestTeams.length>1) parts.push(`Höchster Gleichstand: Team ${highestTeams.join(", Team ")}`);
      if(lowestTeams.length>1 || highestTeams[0]===lowestTeams[0]) parts.push(`Niedrigster Gleichstand: Team ${lowestTeams.join(", Team ")}`);
      result.textContent = parts.join("\n") + "\n\nGleichstand – diese Teams würfeln nochmal.";
      sub.textContent = "Gleichstand – nochmal würfeln…";

      const rerollTeams = Array.from(new Set([...highestTeams, ...lowestTeams]));
      await sleep(900);

      for(const team of rerollTeams){
        const ref = cardRefs.get(team);
        ref.wrap.style.borderColor = "rgba(200,55,65,.65)";
        ref.wrap.style.boxShadow = "0 0 0 3px rgba(200,55,65,.18) inset";
        ref.line.textContent = "Nochmal!";
      }

      for(const team of rerollTeams){
        rolls[team] = await animateTeamRoll(team);
        await sleep(220);
      }

      maxVal = Math.max(...teams.map(t=>rolls[t]));
      minVal = Math.min(...teams.map(t=>rolls[t]));
      highestTeams = teams.filter(t=>rolls[t]===maxVal);
      lowestTeams  = teams.filter(t=>rolls[t]===minVal);

      if(highestTeams.length===1 && lowestTeams.length===1 && highestTeams[0] !== lowestTeams[0]){
        break;
      }
      // while repeats until unique
    }

    const winner = highestTeams[0];
    const loser = lowestTeams[0];

    const winRef = cardRefs.get(winner);
    const loseRef = cardRefs.get(loser);
    if(winRef){
      winRef.wrap.style.borderColor = "rgba(40,140,70,.65)";
      winRef.wrap.style.boxShadow = "0 0 0 3px rgba(40,140,70,.18) inset";
    }
    if(loseRef){
      loseRef.wrap.style.borderColor = "rgba(200,55,65,.65)";
      loseRef.wrap.style.boxShadow = "0 0 0 3px rgba(200,55,65,.18) inset";
    }

    const r = transferRandomJokerBetweenTeams(loser, winner);
    if(!r.ok){
      result.textContent =
        `🏆 Höchster Wurf: Team ${winner} (${rolls[winner]})\n`+
        `💀 Niedrigster Wurf: Team ${loser} (${rolls[loser]})\n\n`+
        `Team ${loser} hat keinen Joker. Team ${winner} geht leer aus.`;
      setStatus(`🎲 Würfel-Duell: Team ${winner} gewinnt, aber Team ${loser} hat keinen Joker.`);
    }else{
      result.textContent =
        `🏆 Höchster Wurf: Team ${winner} (${rolls[winner]})\n`+
        `💀 Niedrigster Wurf: Team ${loser} (${rolls[loser]})\n\n`+
        `Team ${loser} gibt Team ${winner} den Joker: ${r.jokerName}`;
      setStatus(`🎲 Würfel-Duell: Team ${loser} gibt Team ${winner} den Joker ${r.jokerName}.`);
    }

    sub.textContent = "Duell beendet!";
    enableClose();
  }

  markOverlayOpened(ov);
  ov.style.display = "flex";
  run();
}

function showJokerWheelOverlay(team, onClose){
  ensureJokerState();

  // Helper: mapping id -> display (mittelalterlich)
  const items = JOKERS.map(j=>({
    id: j.id,
    name: (j.name || j.id).replace(/\s+/g," ").trim(),
    icon: (j.id==="double") ? "🎲" :
          (j.id==="moveBarricade") ? "🧱" :
          (j.id==="swap") ? "🔁" :
          (j.id==="reroll") ? "🎯" :
          (j.id==="shield") ? "🛡" :
          (j.id==="allcolors") ? "🌈" : "✦"
  }));

  let ov = document.getElementById("jokerWheelOverlay");
  if(!ov){
    ov = document.createElement("div");
    ov.id = "jokerWheelOverlay";
    ov.style.cssText = [
      "position:fixed","inset:0","display:none",
      "align-items:center","justify-content:center",
      "z-index:99998",
      "background:rgba(0,0,0,.58)"
    ].join(";") + ";";

    ov.innerHTML = `
      <div style="
        width:min(840px, calc(100vw - 28px));
        border-radius:18px;
        padding:16px;
        background:
          radial-gradient(900px 420px at 50% 0%, rgba(255,255,255,.55), rgba(255,255,255,0) 65%),
          repeating-linear-gradient(90deg, rgba(70,55,38,.05), rgba(70,55,38,.05) 1px, rgba(0,0,0,0) 1px, rgba(0,0,0,0) 26px),
          repeating-linear-gradient(0deg, rgba(70,55,38,.03), rgba(70,55,38,.03) 1px, rgba(0,0,0,0) 1px, rgba(0,0,0,0) 34px),
          linear-gradient(180deg, #f3e7c9 0%, #ead8ab 60%, #ddc58f 100%);
        border:1px solid rgba(0,0,0,.25);
        box-shadow:0 22px 70px rgba(0,0,0,.55);
        color:rgba(38,26,18,.92);
        font-family: ui-serif, Georgia, 'Times New Roman', Times, serif;
        position:relative;
        overflow:hidden;
      ">
        <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
          <div style="
            width:44px; height:44px; border-radius:16px;
            display:flex; align-items:center; justify-content:center;
            background:
              linear-gradient(180deg, rgba(255,255,255,.18), rgba(0,0,0,.14)),
              radial-gradient(circle at 35% 35%, rgba(200,55,65,.98), rgba(90,14,18,.96));
            border:1px solid rgba(0,0,0,.28);
            box-shadow: inset 0 0 0 2px rgba(255,240,232,.12);
            color:rgba(255,245,235,.92);
            font-weight:900;
          ">🎰</div>

          <div style="flex:1;">
            <div style="font-weight:900; font-size:20px; letter-spacing:.2px; line-height:1.15;">Joker‑Glücksrad</div>
            <div id="jwSub" style="opacity:.75; font-size:12px; margin-top:2px;">Wähle dein Schicksal…</div>
          </div>

          <button id="jwCloseX" title="Schließen" style="
            border:1px solid rgba(0,0,0,.22);
            background:rgba(255,255,255,.55);
            color:rgba(38,26,18,.85);
            border-radius:12px;
            width:38px; height:38px;
            display:flex; align-items:center; justify-content:center;
            font-size:16px;
            cursor:pointer;
          ">✕</button>
        </div>

        <div style="display:grid; grid-template-columns: 1.1fr .9fr; gap:14px;">
          <!-- LEFT: Slot 1 Joker -->
          <div style="
            border-radius:16px;
            padding:12px;
            background:rgba(255,255,255,.30);
            border:1px solid rgba(0,0,0,.14);
          ">
            <div style="font-weight:900; margin-bottom:8px;">Rad I – Joker</div>

            <div style="display:flex; gap:10px; align-items:flex-start;">
              <!-- Slot window -->
              <div style="
                position:relative;
                width:100%;
                max-width:360px;
                height:168px;
                border-radius:14px;
                background:linear-gradient(180deg, rgba(80,55,35,.28), rgba(30,20,12,.12));
                border:1px solid rgba(0,0,0,.22);
                box-shadow: inset 0 0 0 2px rgba(255,240,200,.08);
                overflow:hidden;
              ">
                <div style="
                  position:absolute; inset:0;
                  background:radial-gradient(circle at 35% 25%, rgba(255,235,190,.25), rgba(0,0,0,0) 60%);
                  pointer-events:none;
                "></div>

                <div id="jwSlot1" style="
                  position:absolute; left:0; right:0;
                  top:0;
                  display:flex;
                  flex-direction:column;
                  gap:10px;
                  padding:18px 14px;
                  transform: translateY(0);
                "></div>

                <!-- viewport highlight -->
                <div style="
                  position:absolute; left:10px; right:10px;
                  top:50%; transform: translateY(-50%);
                  height:48px;
                  border-radius:12px;
                  border:2px solid rgba(200,55,65,.65);
                  box-shadow: 0 0 0 3px rgba(255,240,232,.12) inset;
                  pointer-events:none;
                "></div>
              </div>

              <!-- Legend list -->
              <div style="
                flex:1;
                min-width:210px;
                max-height:168px;
                overflow:auto;
                border-radius:14px;
                padding:10px 10px;
                background:rgba(255,255,255,.22);
                border:1px dashed rgba(0,0,0,.18);
                font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial;
                color: rgba(38,26,18,.88);
              ">
                <div style="font-weight:800; font-size:12px; opacity:.85; margin-bottom:6px;">Alle Joker</div>
                <div id="jwLegend" style="display:flex; flex-direction:column; gap:6px; font-size:13px;"></div>
              </div>
            </div>

            <div id="jwWin1" style="margin-top:10px; font-weight:900; display:none;"></div>
          </div>

          <!-- RIGHT: Slot 2 Amount -->
          <div style="
            border-radius:16px;
            padding:12px;
            background:rgba(255,255,255,.30);
            border:1px solid rgba(0,0,0,.14);
          ">
            <div style="font-weight:900; margin-bottom:8px;">Rad II – Anzahl</div>

            <div style="
              position:relative;
              width:100%;
              height:168px;
              border-radius:14px;
              background:linear-gradient(180deg, rgba(80,55,35,.28), rgba(30,20,12,.12));
              border:1px solid rgba(0,0,0,.22);
              box-shadow: inset 0 0 0 2px rgba(255,240,200,.08);
              overflow:hidden;
            ">
              <div id="jwSlot2" style="
                position:absolute; left:0; right:0;
                top:0;
                display:flex;
                flex-direction:column;
                gap:12px;
                padding:18px 14px;
                transform: translateY(0);
                align-items:center;
              "></div>

              <div style="
                position:absolute; left:10px; right:10px;
                top:50%; transform: translateY(-50%);
                height:52px;
                border-radius:12px;
                border:2px solid rgba(200,55,65,.65);
                box-shadow: 0 0 0 3px rgba(255,240,232,.12) inset;
                pointer-events:none;
              "></div>
            </div>

            <div id="jwWin2" style="margin-top:10px; font-weight:900; display:none;"></div>
          </div>
        </div>

        <div style="display:flex; gap:10px; justify-content:flex-end; align-items:center; margin-top:12px;">
          <button id="jwStart" style="
            cursor:pointer;
            padding:11px 14px;
            border-radius:12px;
            border:1px solid rgba(0,0,0,.35);
            background:
              linear-gradient(180deg, rgba(255,255,255,.18), rgba(0,0,0,.18)),
              linear-gradient(180deg, #6a4a2f, #4f3623);
            color:rgba(255,250,235,.92);
            font-weight:900;
            text-shadow:0 1px 0 rgba(0,0,0,.45);
            min-width:170px;
          ">🎰 Drehen!</button>

          <button id="jwOk" style="
            cursor:not-allowed;
            padding:11px 14px;
            border-radius:12px;
            border:1px solid rgba(0,0,0,.25);
            background:rgba(255,255,255,.45);
            color:rgba(38,26,18,.55);
            font-weight:900;
            opacity:.65;
            min-width:160px;
          " disabled>Schließen</button>
        </div>

        <div style="
          position:absolute; right:-60px; top:-60px;
          width:220px; height:220px; border-radius:50%;
          background:radial-gradient(circle at 30% 30%, rgba(200,55,65,.38), rgba(90,14,18,0) 70%);
          pointer-events:none;
          transform: rotate(18deg);
        "></div>
      </div>
    `;

    document.body.appendChild(ov);

    // close via backdrop
    ov.addEventListener("click",(e)=>{
      if(e.target===ov){ if(!overlayClickAllowed(ov)) return; ov._doClose && ov._doClose(); }
    });
  }

  // Fill legend + slots
  const slot1 = ov.querySelector("#jwSlot1");
  const slot2 = ov.querySelector("#jwSlot2");
  const legend = ov.querySelector("#jwLegend");
  const startBtn = ov.querySelector("#jwStart");
  const okBtn = ov.querySelector("#jwOk");
  const closeX = ov.querySelector("#jwCloseX");
  const sub = ov.querySelector("#jwSub");
  const win1 = ov.querySelector("#jwWin1");
  const win2 = ov.querySelector("#jwWin2");

  legend.innerHTML = "";
  for(const it of items){
    const row = document.createElement("div");
    row.style.cssText = "display:flex; gap:8px; align-items:center;";
    row.innerHTML = `<span style="width:18px; text-align:center;">${it.icon}</span><span style="font-weight:800;">${it.name}</span>`;
    legend.appendChild(row);
  }

  // Helper build row element for slot1
  function slotRowJoker(it){
    const d = document.createElement("div");
    d.style.cssText = [
      "height:38px",
      "display:flex",
      "align-items:center",
      "justify-content:flex-start",
      "gap:10px",
      "padding:0 10px",
      "border-radius:12px",
      "background:rgba(255,255,255,.20)",
      "border:1px solid rgba(0,0,0,.10)",
      "font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial",
      "font-weight:900",
      "color:rgba(245,250,255,.92)",
      "text-shadow:0 1px 0 rgba(0,0,0,.55)"
    ].join(";");
    d.innerHTML = `<span style="width:22px; text-align:center;">${it.icon}</span><span>${it.name}</span>`;
    return d;
  }

  function slotRowAmt(n){
    const d = document.createElement("div");
    d.style.cssText = [
      "height:42px",
      "width:100%",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "border-radius:12px",
      "background:rgba(255,255,255,.20)",
      "border:1px solid rgba(0,0,0,.10)",
      "font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial",
      "font-weight:900",
      "font-size:18px",
      "color:rgba(245,250,255,.92)",
      "text-shadow:0 1px 0 rgba(0,0,0,.55)"
    ].join(";");
    d.textContent = `×${n}`;
    return d;
  }

  // Prepare slot contents (repeat for smooth scroll illusion)
  function fillSlot1(){
    slot1.innerHTML = "";
    // repeat list 6x
    for(let r=0;r<18;r++){
      for(const it of items) slot1.appendChild(slotRowJoker(it));
    }
  }
  function fillSlot2(){
    slot2.innerHTML = "";
    const nums = [1,2,3];
    for(let r=0;r<10;r++){
      for(const n of nums) slot2.appendChild(slotRowAmt(n));
    }
  }
  fillSlot1();
  fillSlot2();

  // State
  let spun = false;
  let chosenJoker = null;
  let chosenAmt = null;

  function enableClose(){
    okBtn.disabled = false;
    okBtn.style.cursor = "pointer";
    okBtn.style.opacity = "1";
    okBtn.style.color = "rgba(38,26,18,.88)";
    okBtn.style.background = "rgba(255,255,255,.70)";
  }

  function doClose(){
    ov.style.display="none";
    if(typeof onClose==="function") onClose();
  }
  ov._doClose = doClose;
  okBtn.onclick = ()=>{ if(!overlayClickAllowed(ov)) return; doClose(); };
  closeX.onclick = ()=>{ if(!overlayClickAllowed(ov)) return; doClose(); };

  // Spin helper: slot animation for 5s, then stop at target index (center window)
  
  function spinSlot(slotEl, itemCountPerCycle, pickIndex, rowHeight, durationMs=5000){
    return new Promise((resolve)=>{
      const totalItems = slotEl.children.length;
      const totalCycles = Math.max(1, Math.floor(totalItems / itemCountPerCycle));

      // Immer viele Runden drehen (schnell -> langsam)
      const minRounds = 10;
      const cycle = Math.min(totalCycles - 2, Math.max(minRounds, Math.floor(totalCycles * 0.75)));
      const targetRow = Math.max(0, cycle * itemCountPerCycle + pickIndex);

      const gap = (slotEl.id==="jwSlot2") ? 12 : 10;
      const highlightTop = (168/2) - (rowHeight/2);
      const translate = -(targetRow * (rowHeight + gap)) + highlightTop;

      // Reset
      slotEl.style.transition = "none";
      slotEl.style.transform = "translateY(0px)";

      requestAnimationFrame(()=>{
        requestAnimationFrame(()=>{
          slotEl.style.transition = `transform ${durationMs}ms cubic-bezier(.08,.88,.12,1)`;
          slotEl.style.transform = `translateY(${translate}px)`;

          setTimeout(()=>{
            slotEl.style.transition = "transform 260ms ease-out";
            slotEl.style.transform = `translateY(${translate-3}px)`;
            setTimeout(()=>{
              slotEl.style.transition = "transform 180ms ease-in";
              slotEl.style.transform = `translateY(${translate}px)`;
              setTimeout(resolve, 190);
            }, 270);
          }, durationMs);
        });
      });
    });
  }


  startBtn.disabled = false;
  startBtn.style.cursor = "pointer";
  okBtn.disabled = true;
  okBtn.style.cursor = "not-allowed";
  okBtn.style.opacity = ".65";
  win1.style.display="none";
  win2.style.display="none";
  sub.textContent = "Wähle dein Schicksal…";

  startBtn.onclick = async ()=>{ if(!overlayClickAllowed(ov)) return;
    if(spun) return;
    spun = true;
    startBtn.disabled = true;
    startBtn.style.opacity = ".65";
    startBtn.style.cursor = "not-allowed";
    sub.textContent = "Rad I dreht…";

    // pick joker
    const pickJ = Math.floor(Math.random()*items.length);
    await spinSlot(slot1, items.length, pickJ, 38, 5000);
    chosenJoker = items[pickJ];

    // double suspense
    win1.style.display="block";
    win1.textContent = `✨ Gewonnen: ${chosenJoker.name}!`;
    sub.textContent = "Rad I beendet…";

    // Short pause for drama
    await new Promise(r=>setTimeout(r, 900));

    // spin amount
    sub.textContent = "Rad II dreht…";
    const nums = [1,2,3];
    const pickA = Math.floor(Math.random()*nums.length);
    await spinSlot(slot2, nums.length, pickA, 42, 5000);
    chosenAmt = nums[pickA];

    win2.style.display="block";
    win2.textContent = `➕ Anzahl: ×${chosenAmt}`;
    sub.textContent = "Belohnung…";

    // payout with cap behavior (4A)
    const before = jokerCount(team, chosenJoker.id);
    addJoker(team, chosenJoker.id, chosenAmt);
    const after = jokerCount(team, chosenJoker.id);
    updateJokerUI();

    const gained = Math.max(0, after - before);
    if(gained <= 0){
      setStatus(`🎰 Team ${team}: ${chosenJoker.name} war bereits max (${JOKER_MAX_PER_TYPE}/${JOKER_MAX_PER_TYPE}).`);
    }else if(gained < chosenAmt){
      setStatus(`🎰 Team ${team}: ${chosenJoker.name} +${gained} (Max erreicht).`);
    }else{
      setStatus(`🎰 Team ${team}: ${chosenJoker.name} +${gained}.`);
    }

    enableClose();
    sub.textContent = "Fertig!";
  };

  markOverlayOpened(ov);
  ov.style.display="flex";
}


function pickRandomEventCard(){
  // UI-forced card (persistent)
  if(eventForceCardId){
    const forced = EVENT_DECK.find(c=>c.id===eventForceCardId);
    if(forced) return forced;
  }

  if(FORCE_EVENT_CARD_ID){
    const forced = EVENT_DECK.find(c=>c && c.id===FORCE_EVENT_CARD_ID);
    if(forced) return forced;
  }
  return EVENT_DECK[Math.floor(Math.random()*EVENT_DECK.length)];
}


function getEligibleRespawnEventTargets(excludeIds=new Set()){
  const occupied = new Set();
  for(const p of (state.pieces || [])){
    if(p && p.node) occupied.add(p.node);
  }

  const aliveBosses = new Set();
  if(Array.isArray(state.bosses)){
    for(const b of state.bosses){
      if(b && b.alive !== false && b.node) aliveBosses.add(b.node);
    }
  }

  return nodes
    .filter(n => n && n.id)
    .filter(n => n.type !== "start")
    .filter(n => n.type !== "portal")
    .filter(n => n.type !== "boss")
    .filter(n => !occupied.has(n.id))
    .filter(n => !aliveBosses.has(n.id))
    .filter(n => !excludeIds.has(n.id))
    .filter(n => !(state.goalNodeId && n.id === state.goalNodeId))
    .map(n => n.id);
}

function respawnAllEventFieldsSequential(onDone){
  ensureEventState();

  const current = Array.from(state.eventActive || []);
  if(!current.length){
    draw();
    console.info("[EVENT] respawn_all_events: no active event fields");
    if(typeof onDone === "function") onDone({ moved:0, total:0 });
    return;
  }

  const oldSet = new Set(current);

  // Neue Ziele einmalig bestimmen:
  // - keine Start/Portal/Boss
  // - keine Spieler
  // - nicht auf dem aktuellen Zielpunkt
  // - Barrikaden sind ERLAUBT
  // - neue Eventfelder sollen nicht auf alten Eventfeldern bleiben
  let pool = getEligibleRespawnEventTargets(oldSet);

  // Fallback, falls zu wenig freie Felder: alte Eventfelder wieder erlauben
  if(pool.length < current.length){
    pool = getEligibleRespawnEventTargets(new Set());
  }

  // Shuffle
  for(let i = pool.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  const targets = pool.slice(0, current.length);
  const total = Math.min(current.length, targets.length);

  // Wenn zu wenig Ziele existieren, nur so viele wie möglich umsetzen
  const pairs = [];
  for(let i=0;i<total;i++){
    pairs.push({ from: current[i], to: targets[i] });
  }

  let idx = 0;
  let moved = 0;
  const prevPhase = state.phase;
  state.phase = "eventRespawn";

  function step(){
    if(idx >= pairs.length){
      state.phase = prevPhase === "eventRespawn" ? "needRoll" : prevPhase;
      draw();
      console.info("[EVENT] respawn_all_events done", { moved, total: current.length, pairs });
      if(typeof onDone === "function") onDone({ moved, total: current.length, pairs });
      return;
    }

    const pair = pairs[idx++];
    state.eventActive.delete(pair.from);
    state.eventActive.add(pair.to);
    moved++;
    draw();
    setTimeout(step, 200);
  }

  draw();
  step();
}
function initEventFieldsFromBoard(){
  ensureEventState();
  state.eventActive.clear();
  for(const n of nodes){
    const t = String(n.type||"").toLowerCase();
    const z = String(n.zone||"").toLowerCase();
    const pk = String((n.props && (n.props.kind||n.props.type||n.props.zone))||"").toLowerCase();

    const isEvent =
      (t==="event") || t.includes("event") ||
      (z==="event") || z.includes("event") ||
      (n.props && n.props.event===true) ||
      (pk==="event") || pk.includes("event");

    if(isEvent) state.eventActive.add(n.id);
  }
  console.info("[EVENT] init:", Array.from(state.eventActive));
}

function isEligibleEventSpawnNode(id){
  const n = nodesById.get(id);
  if(!n) return false;

  // Start/Portal/Boss meiden (Fairness / Logik)
  if(n.type==="start" || n.type==="portal") return false;
  if(n.type==="boss") return false;

  // Hindernisse meiden (aber: Barrikaden dürfen darüber liegen -> "versteckt" ist erlaubt)
  if(n.type==="obstacle") return false;

  // nicht auf ein bereits aktives Eventfeld / nicht auf Figuren
  if(state.eventActive.has(id)) return false;
  if(state.occupied.has(id)) return false;

  return true;
}

function relocateEventField(fromId){
  ensureEventState();
  const eligible = nodes.filter(nn=>isEligibleEventSpawnNode(nn.id)).map(nn=>nn.id);
  if(!eligible.length) return;
  const toId = eligible[Math.floor(Math.random()*eligible.length)];
  state.eventActive.delete(fromId);
  state.eventActive.add(toId);
  console.info("[EVENT] relocated", fromId, "->", toId);
}

function nextTurn(){
  ensurePortalState();
  ensureJokerState();
  state.turn = (state.turn+1)%state.players.length;
  state.roll=null;
  state.selected=null;
  state.highlighted.clear();
  state.placeHighlighted.clear();
  state.jokerHighlighted.clear();
  state.jokerMode = null;
  state.jokerData = {};
  state.jokerFlags.double = false;
  state.jokerFlags.allcolors = false;
  ensurePortalState();
  state.portalHighlighted.clear();
  state.portalUsedThisTurn=false;
  state.phase="needRoll";
  state.pendingSix=false;
  state.extraRoll=false;
  state.ignoreBarricadesThisTurn = false;
  dieBox.textContent="–";
  setStatus(`Team ${currentTeam()} ist dran: Würfeln.`);

  updateJokerUI();
  ensureEventSelectUI();
  broadcastTurnStateOnline(`Team ${currentTeam()} ist dran: Würfeln.`);
}

function staySameTeamNeedRoll(msg){
  ensurePortalState();
  ensureJokerState();
  state.roll=null;
  state.selected=null;
  state.highlighted.clear();
  state.placeHighlighted.clear();
  state.jokerHighlighted.clear();
  state.jokerMode = null;
  state.jokerData = {};
  state.jokerFlags.double = false;
  state.jokerFlags.allcolors = false;
  ensurePortalState();
  state.portalHighlighted.clear();
  state.portalUsedThisTurn=false;
  state.phase="needRoll";
  dieBox.textContent="–";
  setStatus(msg || `Team ${currentTeam()} ist dran: Würfeln.`);

  updateJokerUI();
  ensureEventSelectUI();
  broadcastTurnStateOnline(msg || `Team ${currentTeam()} ist dran: Würfeln.`);
}

function initPieces(){
  state.pieces=[];
  state.occupied.clear();
  state.carry = {1:0,2:0,3:0,4:0};

  // Barrikaden initial aus dem Board lesen: nodes mit type "barricade"
  barricades.clear();
  for(const n of nodes){
    if(n.type === "barricade"){
      barricades.add(n.id);
    }
  }

  // Snapshot: Start-Layout der Barrikaden merken (für Reset-Events)
  if(!state.initialBarricadeLayout || !Array.isArray(state.initialBarricadeLayout) || state.initialBarricadeLayout.length===0){
    state.initialBarricadeLayout = Array.from(barricades);
  }

  // Auf ALLEN Startfeldern eine Figur (wie vorher)
  const active = new Set(state.players);
  const starts = nodes.filter(n=>n.type==="start" && active.has(Number(n.props?.startTeam)));
  let i=0;
  for(const s of starts){
    const id="p"+(++i);
    const p={id,team:Number(s.props.startTeam),node:s.id,prev:null};
    state.pieces.push(p);
    state.occupied.set(s.id,id);
  }
}

function computeMoveTargets(piece,steps){
  state.highlighted.clear();

  const start = piece.node;

  // Anti-Hüpfen (nur INNERHALB dieses Wurfs):
  // Verhindert nur A->B->A im selben Pfad.
  // WICHTIG: NICHT das vorherige Feld aus dem letzten Zug sperren!
  //
  // Dafür tracken wir pro BFS-State das "from" (Vorgängerfeld) und blocken nur den direkten Rücksprung.
  const q = [{ id: start, d: 0, from: null }];
  const visited = new Set([start+"|0|null"]);

  while(q.length){
    const cur = q.shift();

    if(cur.d === steps){
      if(cur.id !== start){
        const occ = state.occupied.get(cur.id);
        if(!occ){
          state.highlighted.add(cur.id);
        }else{
          const op = state.pieces.find(x=>x.id===occ);
          // Wenn Ziel eine Figur hat:
          // - Gegner darf geschmissen werden (außer Schutzschild)
          // - Eigene Figur blockt
          if(op && op.team !== piece.team && !op.shielded){
            state.highlighted.add(cur.id);
          }
        }
      }
      continue;
    }

    for(const nb of (adj.get(cur.id)||[])){

      // Kein Zurück-Hüpfen (A->B->A)
      if(cur.from && nb === cur.from) continue;

      // ✅ Barrikade blockt Zwischen-Schritte (nicht überspringen!)
      // Ausnahme: Sturmangriff ignoriert Barrikaden auf dem Weg für den ganzen Zug.
      if(!state.ignoreBarricadesThisTurn && barricades.has(nb) && (cur.d+1) < steps) continue;

      // 🛡 Schutzschild blockt Zwischen-Schritte (niemand darf drüber laufen)
      if((cur.d+1) < steps){
        const occ = state.occupied.get(nb);
        if(occ){
          const op = state.pieces.find(x=>x.id===occ);
          if(op && op.shielded) continue;
        }
      }

      // visited muss auch den Vorgänger berücksichtigen, sonst schneiden wir legitime Pfade ab
      const key = nb+"|"+(cur.d+1)+"|"+cur.id;
      if(visited.has(key)) continue;
      visited.add(key);

      q.push({ id: nb, d: cur.d+1, from: cur.id });
    }
  }
}

function computePlaceTargets(){
  state.placeHighlighted.clear();
  for(const n of nodes){
    if(isFreeForBarricade(n.id)){
      state.placeHighlighted.add(n.id);
    }
  }
}

function kickToStart(other){
  // Gegner "schmeißen": zurück auf ein freies Startfeld seines Teams, sonst bleibt er in "Reserve" (node=null)
  state.occupied.delete(other.node);
  other.node = null;
  other.prev = null;

  const starts = nodes.filter(n=>n.type==="start" && Number(n.props?.startTeam)===other.team);
  for(const s of starts){
    if(!state.occupied.has(s.id)){
      other.node = s.id;
      state.occupied.set(s.id, other.id);
      return;
    }
  }
  // kein freies Startfeld -> bleibt offboard
}

function move(piece,target){
  const occ=state.occupied.get(target);
  if(occ){
    const other=state.pieces.find(p=>p.id===occ);
    if(other && other.team===piece.team) return false;

    // Schutzschild: darf nicht geschmissen werden
    if(other && other.shielded) return false;

    // Portal-Schutz: Figuren auf Portal können NICHT geschmissen werden.
    // => Feld bleibt blockiert.
    if(other && other.node && isPortalNode(other.node)){
      return false;
    }

    if(other) kickToStart(other);
  }

  state.occupied.delete(piece.node);
  piece.prev=piece.node;
  piece.node=target;
  state.occupied.set(target,piece.id);

  // Schutzschild endet, sobald diese Figur bewegt wird
  if(piece.shielded) piece.shielded = false;
  return true;
}

function resolveLanding(piece, opts={allowPortal:true, fromBarricade:false}){
  const team = piece.team;

  // ✅ 1) Barrikade aufgenommen?
  // Wichtig: Anti-Funktionsverlust + saubere State-Machine:
  // - Wenn man auf einer Barrikade landet, wird zuerst aufgenommen
  // - Danach platziert man sie
  // - Danach wird das Landefeld (Ziel/Event/Portal) weiter ausgewertet
  if(!opts.fromBarricade && barricades.has(piece.node)){
    barricades.delete(piece.node);
    state.carry[team] = (state.carry[team]||0) + 1;

    // Merke, dass wir nach der Platzierung hier weiter machen müssen
    state.resumeLanding = { pieceId: piece.id, allowPortal: !!opts.allowPortal, nodeId: piece.node };

    computePlaceTargets();
    state.phase = "placeBarricade";
    setStatus(`Team ${team}: Barrikade aufgenommen! Tippe ein freies Feld zum Platzieren.`);
    updateJokerUI();
    return;
  }

  // 👹 Boss auf dem Feld? -> sofort besiegt (bevor Ziel/Event ausgewertet wird)
  if(maybeDefeatBossAtNode(piece.node, team)){
    // nach Boss-Besiegung geht der Zug normal weiter (Ziel/Event kann trotzdem passieren)
  }


  // 🎯 2) Zielpunkt einsammeln?
  if(maybeCaptureGoal(piece)){
    if(state.gameOver) return; // bei Sieg sofort stoppen
    // weiter mit normalen Landing-Effekten
  }



// 🎯 Extra-Regel: Wenn du einen Zielpunkt eingesammelt hast, ziehst du SOFORT auch eine Ereigniskarte.
// (Damit Testen einfacher ist und das Zielfeld "besonders" bleibt.)
if(state._goalCapturedThisLanding && !opts._goalEventTriggered){
  const card = pickRandomEventCard();
  state.lastEvent = card;
  console.info('[EVENT] draw (goal)', card.id, 'after goal capture on', piece.node);

  // Flag sofort löschen (wird nur einmal pro Landung gebraucht)
  state._goalCapturedThisLanding = null;

  const nextOpts = { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true, _goalEventTriggered: true };

  if(card && card.effect === 'joker_pick6'){
    showEventOverlay(card, ()=>{
      showJokerPick6Overlay(currentTeam(), ()=>{
        resolveLanding(piece, nextOpts);
      });
    });
  } else if(card && card.effect === 'joker_wheel'){
    showEventOverlay(card, ()=>{
      showJokerWheelOverlay(currentTeam(), ()=>{
        resolveLanding(piece, nextOpts);
      });
    });
  } else if(card && card.effect === 'jokers_all6'){
    showEventOverlay(card, ()=>{
      const gained = grantAllSixJokers(currentTeam());
      const ok = gained.filter(x=>x.gained>0).map(x=>x.name).join(', ');
      setStatus(`🎁 Team ${currentTeam()}: Alle 6 Joker! ${ok ? ('+'+ok) : '(Max erreicht)'}`);
      resolveLanding(piece, nextOpts);
    });
  } else {
    showEventOverlay(card, ()=>{
      resolveLanding(piece, nextOpts);
    });
  }
  return;
}

  // 🎴 3) Ereignisfeld: Karte ziehen
  // TEST/Regel: Jede Landung löst eine Karte aus (außer wir kommen gerade aus einer Event-/Barrikaden-Fortsetzung).
  if(FORCE_EVENT_EVERY_LANDING && !opts._eventTriggered){
    const card = pickRandomEventCard();
    state.lastEvent = card;
    console.info('[EVENT] draw (forced)', card.id, 'on', piece.node);

    if(card && card.effect === 'joker_pick6'){
      showEventOverlay(card, ()=>{
        showJokerPick6Overlay(currentTeam(), ()=>{
          resolveLanding(piece, { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true });
        });
      });
    } else if(card && card.effect === 'joker_wheel'){
      showEventOverlay(card, ()=>{
        showJokerWheelOverlay(currentTeam(), ()=>{
          resolveLanding(piece, { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true });
        });
      });
    } else if(card && card.effect === 'jokers_all6'){
      showEventOverlay(card, ()=>{
        const gained = grantAllSixJokers(currentTeam());
        const ok = gained.filter(x=>x.gained>0).map(x=>x.name).join(', ');
        setStatus(`🎁 Team ${currentTeam()}: Alle 6 Joker! ${ok ? ('+'+ok) : '(Max erreicht)'}`);
        resolveLanding(piece, { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true });
      });
    } else if(card && card.effect === 'joker_rain'){
      showEventOverlay(card, ()=>{
        applyJokerRain(currentTeam());
        setStatus(`🌧️ Joker‑Regen! Team ${currentTeam()} hat alle anderen beschenkt.`);
        resolveLanding(piece, { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true });
      });
    } else if(card && card.effect === 'shuffle_pieces'){
      showEventOverlay(card, ()=>{
        shufflePiecesSmart();
        resolveLanding(piece, { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true });
      });
    } else if(card && card.effect === 'start_spawn'){
      showEventOverlay(card, ()=>{
        spawnStartPiecesRoundRobin(()=>{
          resolveLanding(piece, { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true });
        });
      });
    } else if(card && card.effect === 'spawn_barricades3'){
      showEventOverlay(card, ()=>{
        const placed = spawnExtraBarricades(3);
        setStatus(`🧱 ${placed} neue Barrikaden erscheinen!`);
        resolveLanding(piece, { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true });
      });
    } else if(card && card.effect === 'spawn_barricades10'){
      showEventOverlay(card, ()=>{
        const placed = spawnExtraBarricades(10);
        setStatus(`🧱 ${placed} neue Barrikaden erscheinen!`);
        resolveLanding(piece, { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true });
      });
    } else if(card && card.effect === 'spawn_barricades5'){
      showEventOverlay(card, ()=>{
        const placed = spawnExtraBarricades(5);
        setStatus(`🧱 ${placed} neue Barrikaden erscheinen!`);
        resolveLanding(piece, { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true });
      });
    } else if(card && card.effect === 'move_barricade1'){
      showEventOverlay(card, ()=>{
        if(barricades.size<=0){
          setStatus(`🧱 Keine Barrikaden auf dem Brett – nichts zu versetzen.`);
          resolveLanding(piece, { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true });
          return;
        }
        state.eventPendingContinue = { pieceId: piece.id, allowPortal: !!opts.allowPortal };
        state.jokerHighlighted.clear();
        setJokerMode("moveBarricadePick");
        setStatus(`Team ${currentTeam()}: EVENT – tippe eine Barrikade an, dann das Zielfeld.`);
      });
    } else if(card && card.effect === 'move_barricade2'){
      showEventOverlay(card, ()=>{
        if(barricades.size<=0){
          setStatus(`🧱 Keine Barrikaden auf dem Brett – nichts zu versetzen.`);
          resolveLanding(piece, { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true });
          return;
        }
        state.eventPendingContinue = { pieceId: piece.id, allowPortal: !!opts.allowPortal };
        state.eventMoveBarricadesRemaining = Math.min(2, barricades.size);
        state.jokerHighlighted.clear();
        setJokerMode("moveBarricadePick");
        setStatus(`Team ${currentTeam()}: EVENT – tippe eine Barrikade an, dann das Zielfeld. (noch ${state.eventMoveBarricadesRemaining})`);
      });
    } else if(card && card.effect === 'barricades_shuffle'){
      showEventOverlay(card, ()=>{
        const r = shuffleBarricadesRandomly();
        if(r.shortage){
          setStatus(`🧱 Barrikaden gemischt: ${r.placed}/${r.count} gesetzt (zu wenig freie Felder!)`);
        } else {
          setStatus(`🧱 Barrikaden gemischt: ${r.placed} Barrikaden neu verteilt.`);
        }
        resolveLanding(piece, { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true });
      });
    } else if(card && card.effect === 'barricades_reset_initial'){
      showEventOverlay(card, ()=>{
        const r = resetBarricadesToInitial();
        setStatus(`🧱 Barrikaden-Reset: ${r.placed}/${r.targetCount} gesetzt${r.missing?(' (+'+r.missing+' Ersatz)'):''}.`);
        resolveLanding(piece, { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true });
      });
    } else if(card && card.effect === 'barricades_on_event_and_goal'){
      showEventOverlay(card, ()=>{
        const r = placeBarricadesOnEventAndGoal();
        setStatus(`🧱 Barrikaden platziert: ${r.placed}/${r.targetCount}.`);
        resolveLanding(piece, { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true });
      });
    } else if(card && card.effect === 'barricades_half_remove'){
      showEventOverlay(card, ()=>{
        const r = removeHalfBarricades();
        setStatus(`🧱 ${r.removed} Barrikaden verschwinden. Übrig: ${r.left}.`);
        resolveLanding(piece, { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true });
      });
    } else if(card && card.effect === 'barricade_jump_reroll'){
      showEventOverlay(card, ()=>{
        activateBarricadeJumpReroll();
      });
    } else if(card && card.effect === 'spawn_one_boss'){
      showEventOverlay(card, ()=>{
        const r = spawnRandomBossFromEvent();
        if(!r.ok){
          if(r.reason === "max_active"){
            setStatus(`👹 Boss-Event: Maximal 2 Bosse sind bereits aktiv.`);
          } else if(r.reason === "no_free_boss_field"){
            setStatus(`👹 Boss-Event: Kein freies Bossfeld verfügbar.`);
          } else {
            setStatus(`👹 Boss-Event: Boss konnte nicht erscheinen.`);
          }
          resolveLanding(piece, { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true });
          return;
        }
        const bossName = (BOSS_TYPES[r.type] && BOSS_TYPES[r.type].name) ? BOSS_TYPES[r.type].name : r.type;
        setStatus(`👹 ${bossName} erscheint auf ${r.node}!`);
        resolveLanding(piece, { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true });
      });
    } else if(card && card.effect === 'spawn_two_bosses'){
      showEventOverlay(card, ()=>{
        const res = spawnTwoBossesFromEvent();
        if(!res.length){
          setStatus(`👹 Boss-Event: Kein Boss konnte erscheinen.`);
        } else if(res.length === 1){
          const bossName = (BOSS_TYPES[res[0].type] && BOSS_TYPES[res[0].type].name) ? BOSS_TYPES[res[0].type].name : res[0].type;
          setStatus(`👹 ${bossName} erscheint! (1/2 möglich)`);
        } else {
          setStatus(`👹 Zwei Bosse erscheinen auf den Bossfeldern!`);
        }
        resolveLanding(piece, { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true });
      });
    } else if(card && card.effect === 'extra_roll_event'){
      showEventOverlay(card, ()=>{
        grantExtraRollFromEvent();
        setStatus(`🎲 Du darfst sofort nochmal würfeln!`);
        resolveLanding(piece, { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true });
      });
    } else if(card && card.effect === 'all_to_start'){
      showEventOverlay(card, ()=>{
        const r = sendAllPlayersToStart();
        setStatus(`🏰 Alle zurück zum Start! ${r.moved} Figuren wurden versetzt.`);
        resolveLanding(piece, { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true });
      });
    } else if(card && card.effect === 'lose_all_jokers'){
      showEventOverlay(card, ()=>{
        const r = removeAllJokersFromTeam(currentTeam());
        setStatus(`💀 Team ${r.team} verliert alle Joker! (${r.removed} entfernt)`);
        resolveLanding(piece, { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true });
      });
    } else if(card && card.effect === 'respawn_all_events'){
      showEventOverlay(card, ()=>{
        setStatus(`✨ Magische Kräfte verschieben die Ereignisfelder…`);
        respawnAllEventFieldsSequential((r)=>{
          setStatus(`✨ Ereignisfelder neu gespawnt: ${r.moved}/${r.total}.`);
          resolveLanding(piece, { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true });
        });
      });
    } else if(card && card.effect === 'spawn_double_goal'){
      showEventOverlay(card, ()=>{
        const r = spawnBonusGoalDoubleOneShot(false);
        if(!r.ok){
          if(r.reason === "already_exists"){
            setStatus(`🌟 Das Doppel-Zielfeld ist bereits auf dem Brett.`);
          } else {
            setStatus(`🌟 Kein freies Feld für das Doppel-Zielfeld gefunden.`);
          }
        } else {
          setStatus(`🌟 Ein Doppel-Zielfeld erscheint auf ${r.nodeId}!`);
        }
        resolveLanding(piece, { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true });
      });
    } else if(card && card.effect === 'dice_duel'){
      showEventOverlay(card, ()=>{
        showDiceDuelOverlay(()=>{
          resolveLanding(piece, { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true });
        });
      });
    } else if(card && card.effect === 'lose_one_point'){
      showEventOverlay(card, ()=>{
        const r = loseOneGoalPointFromTeam(currentTeam());
        if(r.lost > 0){
          setStatus(`💀 Team ${r.team} verliert 1 Siegpunkt! Stand: ${r.after}/${state.goalToWin}`);
        } else {
          setStatus(`💀 Team ${r.team} hatte keinen Siegpunkt zu verlieren.`);
        }
        resolveLanding(piece, { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true });
      });
    } else if(card && card.effect === 'gain_one_point'){
      showEventOverlay(card, ()=>{
        const r = gainOneGoalPointFromTeam(currentTeam());
        setStatus(`✨ Team ${r.team} erhält 1 Siegpunkt! Stand: ${r.after}/${state.goalToWin}`);
        resolveLanding(piece, { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true });
      });
    } else if(card && card.effect === 'gain_two_points'){
      showEventOverlay(card, ()=>{
        const r = gainTwoGoalPointsFromTeam(currentTeam());
        setStatus(`🏆 Team ${r.team} erhält 2 Siegpunkte! Stand: ${r.after}/${state.goalToWin}`);
        resolveLanding(piece, { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true });
      });
    } else if(card && card.effect === 'point_transfer_most_to_least'){
      showEventOverlay(card, ()=>{
        showPointTransferWheelOverlay(()=>{
          resolveLanding(piece, { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true });
        });
      });
    } else if(card && card.effect === 'others_to_start'){
      showEventOverlay(card, ()=>{
        const r = sendOtherTeamsPiecesToStart(currentTeam());
        setStatus(`↩️ Alle anderen Spieler müssen zurück aufs Startfeld!`);
        resolveLanding(piece, { allowPortal: false, fromBarricade: true, _eventTriggered: true });
      });
    } else if(card && card.effect === 'back_to_start'){
      showEventOverlay(card, ()=>{
        const r = sendTeamPiecesToStart(currentTeam());
        if(r.ok){
          setStatus(`↩️ Alle Figuren von Team ${r.team} müssen zurück aufs Startfeld!`);
        } else {
          setStatus(`↩️ Zurück-zum-Start konnte nicht ausgeführt werden.`);
        }
        resolveLanding(piece, { allowPortal: false, fromBarricade: true, _eventTriggered: true });
      });
    } else if(card && card.effect === 'sprint_5'){
      showEventOverlay(card, ()=>{
        beginSprintEventMove(5);
      });
    } else if(card && card.effect === 'sprint_10'){
      showEventOverlay(card, ()=>{
        beginSprintEventMove(10);
      });
    } else if(card && card.effect === 'spawn_bonus_light'){
      showEventOverlay(card, ()=>{
        const r = spawnBonusLightOneShot(false);
        if(!r.ok){
          if(r.reason === "already_exists"){
            setStatus(`✨ Das zusätzliche Lichtfeld ist bereits auf dem Brett.`);
          } else {
            setStatus(`✨ Kein freies Feld für das zusätzliche Lichtfeld gefunden.`);
          }
        } else {
          draw();
          draw();
          setStatus(`✨ Ein zusätzliches Lichtfeld erscheint auf ${r.nodeId}!`);
        }
        resolveLanding(piece, { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true });
      });
    } else {
      showEventOverlay(card, ()=>{
        resolveLanding(piece, { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true });
      });
    }
    return;
  }
  ensureEventState();
  if(state.eventActive && state.eventActive.has(piece.node)){
    const card = pickRandomEventCard();
    state.lastEvent = card;
    console.info('[EVENT] draw', card.id, 'on', piece.node);

    if(card && card.effect === 'joker_pick6'){
      showEventOverlay(card, ()=>{
        showJokerPick6Overlay(currentTeam(), ()=>{
          relocateEventField(piece.node);
          resolveLanding(piece, { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true });
        });
      });
    } else if(card && card.effect === 'joker_wheel'){
      showEventOverlay(card, ()=>{
        showJokerWheelOverlay(currentTeam(), ()=>{
          relocateEventField(piece.node);
          resolveLanding(piece, { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true });
        });
      });
    } else if(card && card.effect === 'jokers_all6'){
      showEventOverlay(card, ()=>{
        const gained = grantAllSixJokers(currentTeam());
        const ok = gained.filter(x=>x.gained>0).map(x=>x.name).join(', ');
        setStatus(`🎁 Team ${currentTeam()}: Alle 6 Joker! ${ok ? ('+'+ok) : '(Max erreicht)'}`);
        relocateEventField(piece.node);
        resolveLanding(piece, { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true });
      });
    } else if(card && card.effect === 'joker_rain'){
      showEventOverlay(card, ()=>{
        applyJokerRain(currentTeam());
        setStatus(`🌧️ Joker‑Regen! Team ${currentTeam()} hat alle anderen beschenkt.`);
        // Wenn es ein echtes Ereignisfeld war, bleibt die alte Logik: Eventfeld wandert weiter
        relocateEventField(piece.node);
        resolveLanding(piece, { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true });
      });
    } else if(card && card.effect === 'shuffle_pieces'){
      showEventOverlay(card, ()=>{
        shufflePiecesSmart();
        relocateEventField(piece.node);
        resolveLanding(piece, { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true });
      });
    } else if(card && card.effect === 'start_spawn'){
      showEventOverlay(card, ()=>{
        spawnStartPiecesRoundRobin(()=>{
          relocateEventField(piece.node);
          resolveLanding(piece, { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true });
        });
      });
    } else if(card && card.effect === 'spawn_barricades3'){
      showEventOverlay(card, ()=>{
        const placed = spawnExtraBarricades(3);
        setStatus(`🧱 ${placed} neue Barrikaden erscheinen!`);
        relocateEventField(piece.node);
        resolveLanding(piece, { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true });
      });
    } else if(card && card.effect === 'spawn_barricades10'){
      showEventOverlay(card, ()=>{
        const placed = spawnExtraBarricades(10);
        setStatus(`🧱 ${placed} neue Barrikaden erscheinen!`);
        relocateEventField(piece.node);
        resolveLanding(piece, { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true });
      });
    } else if(card && card.effect === 'spawn_barricades5'){
      showEventOverlay(card, ()=>{
        const placed = spawnExtraBarricades(5);
        setStatus(`🧱 ${placed} neue Barrikaden erscheinen!`);
        relocateEventField(piece.node);
        resolveLanding(piece, { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true });
      });
    } else if(card && card.effect === 'move_barricade1'){
      showEventOverlay(card, ()=>{
        // Eventfeld wird direkt neu gespawnt (damit es nicht hängen bleibt)
        relocateEventField(piece.node);

        if(barricades.size<=0){
          setStatus(`🧱 Keine Barrikaden auf dem Brett – nichts zu versetzen.`);
          resolveLanding(piece, { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true });
          return;
        }

        // Pflicht-Aktion: Barrikade versetzen (ohne Joker zu verbrauchen)
        state.eventPendingContinue = { pieceId: piece.id, allowPortal: !!opts.allowPortal };
        state.jokerHighlighted.clear();
        setJokerMode("moveBarricadePick");
        setStatus(`Team ${currentTeam()}: EVENT – tippe eine Barrikade an, dann das Zielfeld.`);
      });
    } else if(card && card.effect === 'move_barricade2'){
      showEventOverlay(card, ()=>{
        relocateEventField(piece.node);

        if(barricades.size<=0){
          setStatus(`🧱 Keine Barrikaden auf dem Brett – nichts zu versetzen.`);
          resolveLanding(piece, { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true });
          return;
        }

        state.eventPendingContinue = { pieceId: piece.id, allowPortal: !!opts.allowPortal };
        state.eventMoveBarricadesRemaining = Math.min(2, barricades.size);
        state.jokerHighlighted.clear();
        setJokerMode("moveBarricadePick");
        setStatus(`Team ${currentTeam()}: EVENT – tippe eine Barrikade an, dann das Zielfeld. (noch ${state.eventMoveBarricadesRemaining})`);
      });
    } else if(card && card.effect === 'barricades_reset_initial'){
      showEventOverlay(card, ()=>{
        const r = resetBarricadesToInitial();
        setStatus(`🧱 Barrikaden-Reset: ${r.placed}/${r.targetCount} gesetzt${r.missing?(' (+'+r.missing+' Ersatz)'):''}.`);
        relocateEventField(piece.node);
        resolveLanding(piece, { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true });
      });
    } else if(card && card.effect === 'barricades_on_event_and_goal'){
      showEventOverlay(card, ()=>{
        const r = placeBarricadesOnEventAndGoal();
        setStatus(`🧱 Barrikaden platziert: ${r.placed}/${r.targetCount}.`);
        relocateEventField(piece.node);
        resolveLanding(piece, { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true });
      });
    } else if(card && card.effect === 'barricades_half_remove'){
      showEventOverlay(card, ()=>{
        const r = removeHalfBarricades();
        setStatus(`🧱 ${r.removed} Barrikaden verschwinden. Übrig: ${r.left}.`);
        relocateEventField(piece.node);
        resolveLanding(piece, { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true });
      });
    } else if(card && card.effect === 'barricade_jump_reroll'){
      showEventOverlay(card, ()=>{
        relocateEventField(piece.node);
        activateBarricadeJumpReroll();
      });
    } else if(card && card.effect === 'spawn_one_boss'){
      showEventOverlay(card, ()=>{
        relocateEventField(piece.node);
        const r = spawnRandomBossFromEvent();
        if(!r.ok){
          if(r.reason === "max_active"){
            setStatus(`👹 Boss-Event: Maximal 2 Bosse sind bereits aktiv.`);
          } else if(r.reason === "no_free_boss_field"){
            setStatus(`👹 Boss-Event: Kein freies Bossfeld verfügbar.`);
          } else {
            setStatus(`👹 Boss-Event: Boss konnte nicht erscheinen.`);
          }
          resolveLanding(piece, { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true });
          return;
        }
        const bossName = (BOSS_TYPES[r.type] && BOSS_TYPES[r.type].name) ? BOSS_TYPES[r.type].name : r.type;
        setStatus(`👹 ${bossName} erscheint auf ${r.node}!`);
        resolveLanding(piece, { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true });
      });
    } else if(card && card.effect === 'spawn_two_bosses'){
      showEventOverlay(card, ()=>{
        relocateEventField(piece.node);
        const res = spawnTwoBossesFromEvent();
        if(!res.length){
          setStatus(`👹 Boss-Event: Kein Boss konnte erscheinen.`);
        } else if(res.length === 1){
          const bossName = (BOSS_TYPES[res[0].type] && BOSS_TYPES[res[0].type].name) ? BOSS_TYPES[res[0].type].name : res[0].type;
          setStatus(`👹 ${bossName} erscheint! (1/2 möglich)`);
        } else {
          setStatus(`👹 Zwei Bosse erscheinen auf den Bossfeldern!`);
        }
        resolveLanding(piece, { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true });
      });
    } else if(card && card.effect === 'extra_roll_event'){
      showEventOverlay(card, ()=>{
        relocateEventField(piece.node);
        grantExtraRollFromEvent();
        setStatus(`🎲 Du darfst sofort nochmal würfeln!`);
        resolveLanding(piece, { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true });
      });
    } else if(card && card.effect === 'all_to_start'){
      showEventOverlay(card, ()=>{
        relocateEventField(piece.node);
        const r = sendAllPlayersToStart();
        setStatus(`🏰 Alle zurück zum Start! ${r.moved} Figuren wurden versetzt.`);
        resolveLanding(piece, { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true });
      });
    } else if(card && card.effect === 'lose_all_jokers'){
      showEventOverlay(card, ()=>{
        relocateEventField(piece.node);
        const r = removeAllJokersFromTeam(currentTeam());
        setStatus(`💀 Team ${r.team} verliert alle Joker! (${r.removed} entfernt)`);
        resolveLanding(piece, { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true });
      });
    } else if(card && card.effect === 'respawn_all_events'){
      showEventOverlay(card, ()=>{
        // Das ausgelöste Eventfeld wird ganz normal mit in den Respawn einbezogen.
        setStatus(`✨ Magische Kräfte verschieben die Ereignisfelder…`);
        respawnAllEventFieldsSequential((r)=>{
          setStatus(`✨ Ereignisfelder neu gespawnt: ${r.moved}/${r.total}.`);
          resolveLanding(piece, { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true });
        });
      });
    } else if(card && card.effect === 'spawn_double_goal'){
      showEventOverlay(card, ()=>{
        relocateEventField(piece.node);
        const r = spawnBonusGoalDoubleOneShot(false);
        if(!r.ok){
          if(r.reason === "already_exists"){
            setStatus(`🌟 Das Doppel-Zielfeld ist bereits auf dem Brett.`);
          } else {
            setStatus(`🌟 Kein freies Feld für das Doppel-Zielfeld gefunden.`);
          }
        } else {
          setStatus(`🌟 Ein Doppel-Zielfeld erscheint auf ${r.nodeId}!`);
        }
        resolveLanding(piece, { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true });
      });
    } else if(card && card.effect === 'dice_duel'){
      showEventOverlay(card, ()=>{
        relocateEventField(piece.node);
        showDiceDuelOverlay(()=>{
          resolveLanding(piece, { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true });
        });
      });
    } else if(card && card.effect === 'lose_one_point'){
      showEventOverlay(card, ()=>{
        relocateEventField(piece.node);
        const r = loseOneGoalPointFromTeam(currentTeam());
        if(r.lost > 0){
          setStatus(`💀 Team ${r.team} verliert 1 Siegpunkt! Stand: ${r.after}/${state.goalToWin}`);
        } else {
          setStatus(`💀 Team ${r.team} hatte keinen Siegpunkt zu verlieren.`);
        }
        resolveLanding(piece, { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true });
      });
    } else if(card && card.effect === 'gain_one_point'){
      showEventOverlay(card, ()=>{
        relocateEventField(piece.node);
        const r = gainOneGoalPointFromTeam(currentTeam());
        setStatus(`✨ Team ${r.team} erhält 1 Siegpunkt! Stand: ${r.after}/${state.goalToWin}`);
        resolveLanding(piece, { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true });
      });
    } else if(card && card.effect === 'gain_two_points'){
      showEventOverlay(card, ()=>{
        relocateEventField(piece.node);
        const r = gainTwoGoalPointsFromTeam(currentTeam());
        setStatus(`🏆 Team ${r.team} erhält 2 Siegpunkte! Stand: ${r.after}/${state.goalToWin}`);
        resolveLanding(piece, { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true });
      });
    } else if(card && card.effect === 'point_transfer_most_to_least'){
      showEventOverlay(card, ()=>{
        relocateEventField(piece.node);
        showPointTransferWheelOverlay(()=>{
          resolveLanding(piece, { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true });
        });
      });
    } else if(card && card.effect === 'others_to_start'){
      showEventOverlay(card, ()=>{
        relocateEventField(piece.node);
        const r = sendOtherTeamsPiecesToStart(currentTeam());
        setStatus(`↩️ Alle anderen Spieler müssen zurück aufs Startfeld!`);
        resolveLanding(piece, { allowPortal: false, fromBarricade: true, _eventTriggered: true });
      });
    } else if(card && card.effect === 'back_to_start'){
      showEventOverlay(card, ()=>{
        relocateEventField(piece.node);
        const r = sendTeamPiecesToStart(currentTeam());
        if(r.ok){
          setStatus(`↩️ Alle Figuren von Team ${r.team} müssen zurück aufs Startfeld!`);
        } else {
          setStatus(`↩️ Zurück-zum-Start konnte nicht ausgeführt werden.`);
        }
        resolveLanding(piece, { allowPortal: false, fromBarricade: true, _eventTriggered: true });
      });
    } else if(card && card.effect === 'sprint_5'){
      showEventOverlay(card, ()=>{
        relocateEventField(piece.node);
        beginSprintEventMove(5);
      });
    } else if(card && card.effect === 'sprint_10'){
      showEventOverlay(card, ()=>{
        relocateEventField(piece.node);
        beginSprintEventMove(10);
      });
    } else if(card && card.effect === 'spawn_bonus_light'){
      showEventOverlay(card, ()=>{
        relocateEventField(piece.node);
        const r = spawnBonusLightOneShot(false);
        if(!r.ok){
          if(r.reason === "already_exists"){
            setStatus(`✨ Das zusätzliche Lichtfeld ist bereits auf dem Brett.`);
          } else {
            setStatus(`✨ Kein freies Feld für das zusätzliche Lichtfeld gefunden.`);
          }
        } else {
          draw();
          draw();
          setStatus(`✨ Ein zusätzliches Lichtfeld erscheint auf ${r.nodeId}!`);
        }
        resolveLanding(piece, { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true });
      });
    } else {
      showEventOverlay(card, ()=>{
        relocateEventField(piece.node);
        // Nach dem OK weiter mit Portal / Turn-Ende (ohne Barrikade-Check erneut)
        resolveLanding(piece, { allowPortal: !!opts.allowPortal, fromBarricade: true, _eventTriggered: true });
      });
    }

    // Temporär entfernen, damit wir nicht sofort wieder triggert
    state.eventActive.delete(piece.node);
    return;
  }

  // 🌀 4) Portal (optional, z.B. nach Teleport nicht nochmal)
  if(opts.allowPortal && isPortalNode(piece.node) && !state.portalUsedThisTurn){
    computePortalTargets(piece.node);
    if(state.portalHighlighted.size > 0){
      state.phase = "usePortal";
      setStatus(`Team ${team}: Portal! Tippe ein anderes freies Portal (oder tippe dein Portal nochmal = bleiben).`);
      updateJokerUI();
      return;
    }
  }

  // ✅ 5) Zug beenden / 6 = nochmal
  // 👹 Boss-Phase nach abgeschlossenem Spielerzug (Move + Landing)
  // Rundenende-Marker (für Bosse, die nur am Rundenende agieren)
  ensureBossState();
  state._bossRoundEndFlag = (!state.pendingSix) && (state.turn === state.players.length-1);
  // WICHTIG:
  // - Boss bewegt sich erst NACH allen Spieler-Aktionen (inkl. Barrikade/Events/Portale)
  // - Boss bewegt sich VOR dem Spielerwechsel / erneuten Würfeln (bei 6)
  runBossPhaseThen(()=>{
    if(state.pendingSix || state.extraRoll){
      const hadSix = !!state.pendingSix;
      const hadExtra = !!state.extraRoll;
      state.pendingSix = false;
      state.extraRoll = false;

      if(hadSix && hadExtra){
        staySameTeamNeedRoll(`Team ${team}: 6 + Extra-Wurf! Nochmal würfeln.`);
      }else if(hadSix){
        staySameTeamNeedRoll(`Team ${team}: Du hast eine 6! Nochmal würfeln.`);
      }else{
        staySameTeamNeedRoll(`Team ${team}: Extra-Wurf! Nochmal würfeln.`);
      }
    }else{
      nextTurn();
    }
  });
}

function afterLandingNoPortal(piece){
  return resolveLanding(piece, { allowPortal:false, fromBarricade:false });
}

function afterLanding(piece){
  return resolveLanding(piece, { allowPortal:true, fromBarricade:false });
}

function placeBarricadeAt(nodeId){
  const team = currentTeam();
  if(!state.placeHighlighted.has(nodeId)) return false;
  if((state.carry[team]||0) <= 0) return false;

  barricades.add(nodeId);
  state.carry[team] -= 1;

  // Nach Platzierung:
  // Wenn wir gerade eine Barrikade von einem Landefeld aufgenommen haben, muss
  // danach das Landefeld (Ziel / Ereignis / Portal / Turn-Ende) weiter ausgewertet werden.
  state.placeHighlighted.clear();

  if(state.resumeLanding && state.resumeLanding.pieceId){
    const info = state.resumeLanding;
    state.resumeLanding = null;

    const p = state.pieces.find(pp => pp.id === info.pieceId);
    if(p){
      // Weiter mit der Landelogik (ohne erneuten Barrikaden-Check)
      resolveLanding(p, { allowPortal: !!info.allowPortal, fromBarricade: true });
      return true;
    }
  }

  // Fallback: normales Ende nach Barrikaden-Platzierung
  if(state.pendingSix){
    state.pendingSix=false;
    staySameTeamNeedRoll(`Team ${team}: Barrikade platziert + 6! Nochmal würfeln.`);
  }else{
    nextTurn();
  }
  return true;
}

// ---------- Input (Tap/Click + Pan/Zoom) ----------
function hitTestWorld(wx, wy){
  // UX-Fix:
  // - Der Hit-Radius bleibt in SCREEN-Pixeln ungefähr gleich (auch beim Rauszoomen).
  // - Wir wählen den NÄCHSTEN Node innerhalb des Radius (nicht "erster Treffer" in Array-Reihenfolge),
  //   damit man auch bei Zoom-out zuverlässig das richtige Feld / die richtige Figur trifft.
  const desiredScreenR = 26; // px (klickbar auf Tablet)
  const minWorldR = 18;      // nie kleiner als Node-Kreis
  const maxWorldR = 44;      // Sicherheitsklemme (sonst zu viel "Mitnehmen")

  const R = clamp(desiredScreenR / (cam.s || 1), minWorldR, maxWorldR);
  const R2 = R*R;

  let best = null;
  let bestD2 = Infinity;
  for(const n of nodes){
    const dx = wx - n.x, dy = wy - n.y;
    const d2 = dx*dx + dy*dy;
    if(d2 <= R2 && d2 < bestD2){
      best = n;
      bestD2 = d2;
    }
  }
  return best;
}


function handleTapAtWorld(wx, wy){
  if(state.gameOver) return;
  if(isOnlineAuthorityActive() && !isLocalPlayersTurn()){
    setStatus(`Nicht du bist dran. Team ${currentTeam()} steuert gerade den Zug.`);
    return;
  }
  const hit = hitTestWorld(wx, wy);
  if(!hit) return;

  // Joker modes have priority
  ensureJokerState();
  if(state.jokerMode){
    const team = currentTeam();

    // --- Barrikade versetzen ---
    if(state.jokerMode === "moveBarricadePick"){
      if(!barricades.has(hit.id)){
        setStatus(`Team ${team}: Tippe eine Barrikade an.`);
        return;
      }
      // choose origin
      state.jokerData = { fromId: hit.id };
      // compute possible targets
      state.jokerHighlighted.clear();
      for(const n of nodes){
        if(isFreeForBarricade(n.id) || n.id === hit.id) state.jokerHighlighted.add(n.id);
      }
      state.jokerMode = "moveBarricadePlace";
      setStatus(`Team ${team}: Barrikade gewählt. Tippe das neue Feld.`);
      updateJokerUI();
      return;
    }

    if(state.jokerMode === "moveBarricadePlace"){
      const fromId = state.jokerData?.fromId;
      if(!fromId || !barricades.has(fromId)){
        clearJokerMode(`Team ${team}: Barrikade nicht mehr vorhanden.`);
        return;
      }
      if(!state.jokerHighlighted.has(hit.id)) return;
      // move
      barricades.delete(fromId);
      barricades.add(hit.id);
      clearJokerMode(`Team ${team}: Barrikade versetzt.`);
      // If an event requires a barricade move, resume landing afterwards
      if(state.eventPendingContinue){
        // If an event requires one or more barricade moves, resume only after required moves are done
        const info = state.eventPendingContinue;
        const p2 = state.pieces.find(pp=>pp.id===info.pieceId);

        if(state.eventMoveBarricadesRemaining>0){
          state.eventMoveBarricadesRemaining--;
        }

        if(state.eventMoveBarricadesRemaining>0){
          // Need more moves: keep mode active
          setJokerMode("moveBarricadePick");
          setStatus(`Team ${currentTeam()}: EVENT – noch ${state.eventMoveBarricadesRemaining} Barrikade(n) versetzen.`);
        }else{
          // Done: resume landing
          state.eventPendingContinue = null;
          if(p2){
            resolveLanding(p2, { allowPortal: !!info.allowPortal, fromBarricade: true, _eventTriggered: true });
          }
        }
      }

      return;
    }

    // --- Spieler tauschen ---
    if(state.jokerMode === "swapPickA"){
      const occId = state.occupied.get(hit.id);
      if(!occId){
        setStatus(`Team ${team}: Wähle eine Figur.`);
        return;
      }
      const p = state.pieces.find(x=>x.id===occId);
      if(!p || !p.node){
        setStatus(`Team ${team}: Ungültige Figur.`);
        return;
      }
      state.jokerData = { aId: p.id };
      state.jokerMode = "swapPickB";
      setStatus(`Team ${team}: Figur A gewählt. Wähle Figur B.`);
      updateJokerUI();
      return;
    }

    if(state.jokerMode === "swapPickB"){
      const occId = state.occupied.get(hit.id);
      if(!occId){
        setStatus(`Team ${team}: Wähle eine Figur.`);
        return;
      }
      const a = state.pieces.find(x=>x.id===state.jokerData?.aId);
      const b = state.pieces.find(x=>x.id===occId);
      if(!a || !b || !a.node || !b.node){
        clearJokerMode(`Team ${team}: Tausch nicht möglich.`);
        return;
      }
      if(a.id === b.id){
        setStatus(`Team ${team}: Wähle eine andere Figur als B.`);
        return;
      }

      // swap nodes and occupied
      const aNode = a.node;
      const bNode = b.node;
      state.occupied.set(aNode, b.id);
      state.occupied.set(bNode, a.id);
      a.node = bNode;
      b.node = aNode;
      a.prev = null;
      b.prev = null;

      clearJokerMode(`Team ${team}: Figuren getauscht.`);
      return;
    }

    // --- Schutzschild ---
    if(state.jokerMode === "shieldPick"){
      const occId = state.occupied.get(hit.id);
      if(!occId){
        setStatus(`Team ${team}: Wähle eine eigene Figur.`);
        return;
      }
      const p = state.pieces.find(x=>x.id===occId);
      if(!p || p.team !== team){
        setStatus(`Team ${team}: Nur eigene Figur!`);
        return;
      }
      p.shielded = true;
      clearJokerMode(`Team ${team}: Schutzschild aktiv auf einer Figur (bis sie bewegt wird).`);
      return;
    }
  }

  // 1) Figur wählen / wechseln (nach dem Wurf)
  const occId = state.occupied.get(hit.id);
  if(occId && (state.phase==="choosePiece") && state.roll){
    const occPiece = state.pieces.find(p=>p.id===occId);
    if(occPiece && (occPiece.team === currentTeam() || state.jokerFlags.allcolors)){
      state.selected = occPiece.id;
      computeMoveTargets(occPiece, state.roll);
      state.phase = "chooseTarget";
      setStatus(`Team ${currentTeam()}: Wurf ${state.roll}. Tippe ein leuchtendes Zielfeld.`);
      return;
    }
  }

  // 1b) Figur wechseln auch NACH Auswahl (solange der Zug noch nicht ausgeführt wurde)
  // Wunsch: Nach Auswahl einer Figur soll man eine andere eigene Figur anklicken können.
  if(occId && (state.phase==="chooseTarget") && state.roll){
    const occPiece = state.pieces.find(p=>p.id===occId);
    if(occPiece && (occPiece.team === currentTeam() || state.jokerFlags.allcolors)){
      state.selected = occPiece.id;
      computeMoveTargets(occPiece, state.roll);
      // Phase bleibt chooseTarget
      setStatus(`Team ${currentTeam()}: Wurf ${state.roll}. Figur gewechselt – tippe ein leuchtendes Zielfeld.`);
      return;
    }
  }


  // 2) Portal benutzen (Teleport)
  if(state.phase==="usePortal"){
    const piece = state.pieces.find(p=>p.id===state.selected);
    if(!piece) return;
    const curPortal = piece.node;

    // Tippe aktuelles Portal nochmal = bleiben (Portal ist damit "verbraucht")
    if(hit.id === curPortal){
      ensurePortalState();
  state.portalHighlighted.clear();
      state.portalUsedThisTurn = true;
      afterLandingNoPortal(piece); // beendet Zug sauber / 6 nochmal
      return;
    }

    if(!state.portalHighlighted.has(hit.id)) return;

    // Teleport
    state.occupied.delete(piece.node);
    piece.prev = piece.node;
    piece.node = hit.id;
    state.occupied.set(hit.id, piece.id);

    ensurePortalState();
  state.portalHighlighted.clear();
    state.portalUsedThisTurn = true;

    // Nach Teleport: Barrikade prüfen / sonst Zug beenden
    afterLandingNoPortal(piece);
    return;
  }

  // 2) Ziel klicken (bewegen)
  if(state.phase==="chooseTarget"){
    if(!state.highlighted.has(hit.id)) return;

    const piece=state.pieces.find(p=>p.id===state.selected);
    if(!piece) return;

    if(isOnlineAuthorityActive()){
      setStatus(`Server prüft den Zug...`);
      requestServerMove(piece.id, hit.id, Array.from(state.highlighted));
      return;
    }

    if(move(piece,hit.id)){
      // merken ob 6 (extra roll) – gilt erst NACH evtl. Barrikadenplatzierung
      state.pendingSix = (state.roll === 6);

      // Move-Ende: Targets reset
      state.highlighted.clear();

      // Landing logic (barricade pickup etc.)
      afterLanding(piece);
    }
    return;
  }

  // 3) Barrikade platzieren
  if(state.phase==="placeBarricade"){
    placeBarricadeAt(hit.id);
    return;
  }
}

// Pointer-Tracking (1 Finger / Maus = Pan, Tap = Auswahl; 2 Finger = Pinch Zoom)
const pointers = new Map(); // id -> {x,y}
let isPanning = false;
let panStart = null; // {x,y, camX, camY}
let tapCandidate = null; // {x,y,t}

function getLocalXY(e){
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

canvas.addEventListener("pointerdown",(e)=>{
  canvas.setPointerCapture(e.pointerId);
  const p = getLocalXY(e);
  pointers.set(e.pointerId, p);

  if(pointers.size===1){
    isPanning = true;
    panStart = { x: p.x, y: p.y, camX: cam.x, camY: cam.y };
    tapCandidate = { x: p.x, y: p.y, t: performance.now() };
  }else{
    // multi-touch: not a tap / stop panning baseline (prevents jump after pinch)
    tapCandidate = null;
    isPanning = false;
    panStart = null;
    canvas._pinchLastDist = null;
  }
},{passive:true});

canvas.addEventListener("pointermove",(e)=>{
  if(!pointers.has(e.pointerId)) return;
  const p = getLocalXY(e);
  const prev = pointers.get(e.pointerId);
  pointers.set(e.pointerId, p);

  if(pointers.size===1 && isPanning && panStart){
    const dx = p.x - panStart.x;
    const dy = p.y - panStart.y;
    cam.x = panStart.camX + dx;
    cam.y = panStart.camY + dy;
    clampCameraToBoard(70);

    // wenn merklich bewegt -> kein Tap
    if(tapCandidate){
      const mx = p.x - tapCandidate.x;
      const my = p.y - tapCandidate.y;
      if((mx*mx + my*my) > 144) tapCandidate = null; // >12px // >6px
    }
    return;
  }

  if(pointers.size===2){
    // Pinch: stop panning baseline (prevents jump when pinch ends)
    isPanning = false;
    panStart = null;
    // Pinch: compute distance/center between two pointers
    const pts = Array.from(pointers.values());
    const a = pts[0], b = pts[1];
    const cx = (a.x + b.x)/2;
    const cy = (a.y + b.y)/2;
    const dist = Math.hypot(a.x-b.x, a.y-b.y);

    // store last dist on canvas dataset
    const last = canvas._pinchLastDist;
    if(typeof last === "number" && last > 0){
      const factor = dist / last;
      // limit huge jumps
      const safe = clamp(factor, 0.85, 1.15);
      applyZoomAt(cx, cy, safe);
    }
    canvas._pinchLastDist = dist;
    lastPinchAt = performance.now();
    tapCandidate = null;
  }
},{passive:true});

function endPointer(e){
  if(!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);

  if(pointers.size<2){
    canvas._pinchLastDist = null;
  }

  // If pinch ends and one pointer remains: reset pan baseline to prevent "jump"
  if(pointers.size===1){
    const only = Array.from(pointers.values())[0];
    isPanning = true;
    panStart = { x: only.x, y: only.y, camX: cam.x, camY: cam.y };
    tapCandidate = null;
  }

  // Tap if candidate still valid and single pointer ended
  if(tapCandidate && pointers.size===0){
    const p = getLocalXY(e);
    const dt = performance.now() - tapCandidate.t;
    const dx = p.x - tapCandidate.x;
    const dy = p.y - tapCandidate.y;
    if(dt < 450 && (dx*dx+dy*dy) <= 144){
      // Double-tap only if no pinch recently (prevents "spring back" after zoom)
      const now = performance.now();
      if(now - lastPinchAt > 450){
        if(now - lastTapTime < 280){
          fitToBoard(60);
          lastTapTime = 0;
        }else{
          lastTapTime = now;
        }
      }
      const w = screenToWorld(p.x, p.y);
      handleTapAtWorld(w.x, w.y);
    }
  }

  if(pointers.size===0){
    isPanning = false;
    panStart = null;
    tapCandidate = null;
  }
}

canvas.addEventListener("pointerup", endPointer, {passive:true});
canvas.addEventListener("pointercancel", endPointer, {passive:true});

// Mouse wheel zoom (desktop)
canvas.addEventListener("wheel",(e)=>{
  e.preventDefault();
  const p = getLocalXY(e);
  const dir = Math.sign(e.deltaY);
  const factor = dir > 0 ? 0.92 : 1.08;
  applyZoomAt(p.x, p.y, factor);
},{passive:false});

// Doppeltipp (Touch) + Doppelklick (Mouse) = zentrieren
let lastTapTime = 0;
let lastPinchAt = 0;

// Mouse double click
canvas.addEventListener("dblclick", (e)=>{
  fitToBoard(60);
});

// Button "Zentrieren"
btnFit?.addEventListener("click", ()=> fitToBoard(60));


// ---------- Würfeln ----------
btnRoll.addEventListener("click",()=>{
  if(state.gameOver) return;
  if(state.phase!=="needRoll") return;

  ensureJokerState();

  if(isOnlineAuthorityActive()){
    requestServerRoll('main');
    return;
  }

  state.roll = rollDice();
  dieBox.textContent=state.roll;

  // Nach dem Wurf darf man die Figur wählen (oder wechseln).
  state.selected = null;
  state.highlighted.clear();
  state.phase = "choosePiece";

  // Wenn keine Figur dieses Teams auf dem Board ist -> Hinweis
  const any = state.pieces.some(p=>p.team===currentTeam() && p.node);
  if(!any){
    setStatus(`Team ${currentTeam()}: Keine Figur auf dem Board.`);
    return;
  }

  setStatus(`Team ${currentTeam()}: Wurf ${state.roll}. Tippe eine eigene Figur an, um sie zu bewegen.`);

  updateJokerUI();
  ensureEventSelectUI();
});

// ---------- Spieleranzahl (1–4) ----------
const selPlayerCount = document.getElementById("playerCount");
if(selPlayerCount){
  // Default = 4
  selPlayerCount.value = String(state.players.length || 4);

  selPlayerCount.addEventListener("change", ()=>{
    const n = Number(selPlayerCount.value || 4);

    // Nur vor dem Laufen umstellen (sicher)
    const safeToChange = (state.phase === "needRoll") && (state.roll === null) && (!state.selected);
    if(!safeToChange){
      console.warn("[PLAYERS] change blocked during active move/roll");
      // reset select back
      selPlayerCount.value = String(state.players.length || 4);
      setStatus("Spieleranzahl nur ändern, wenn noch NICHT gewürfelt wurde.");
      return;
    }
    setPlayerCount(n, {reset:true});
  });
}



// ---------- Eventfelder: Wachssiegel (nur optisch) ----------
function drawWaxSeal(x,y,baseR){
  const r = baseR;
  ctx.save();

  // soft shadow
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = "rgba(0,0,0,.18)";
  ctx.beginPath();
  ctx.arc(x+r*0.18, y+r*0.22, r*1.02, 0, Math.PI*2);
  ctx.fill();

  ctx.globalCompositeOperation = "source-over";

  // wax gradient
  const g = ctx.createRadialGradient(x-r*0.35, y-r*0.35, r*0.25, x, y, r*1.25);
  g.addColorStop(0, "rgba(200,55,65,.98)");
  g.addColorStop(0.55, "rgba(135,25,32,.95)");
  g.addColorStop(1, "rgba(80,14,18,.95)");

  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x,y,r,0,Math.PI*2);
  ctx.fill();

  // pressed edge
  ctx.strokeStyle = "rgba(255,235,220,.22)";
  ctx.lineWidth = Math.max(1.5, r*0.12);
  ctx.beginPath();
  ctx.arc(x,y,r-0.6,0,Math.PI*2);
  ctx.stroke();

  // inner ring
  ctx.strokeStyle = "rgba(0,0,0,.28)";
  ctx.lineWidth = Math.max(1, r*0.08);
  ctx.beginPath();
  ctx.arc(x,y,r*0.62,0,Math.PI*2);
  ctx.stroke();

  // stamp symbol
  ctx.fillStyle = "rgba(255,245,235,.92)";
  ctx.font = `${Math.round(r*0.95)}px ui-serif, Georgia, serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("✦", x, y+0.5);

  ctx.restore();
}

// ---------- Zielpunkt (Render) ----------
function drawGoalToken(x,y){
  const r = 13;
  ctx.save();
  // Glow
  const g = ctx.createRadialGradient(x,y,2,x,y,24);
  g.addColorStop(0, "rgba(255,215,120,.95)");
  g.addColorStop(1, "rgba(255,215,120,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x,y,24,0,Math.PI*2);
  ctx.fill();

  // Coin
  ctx.beginPath();
  ctx.arc(x,y,r,0,Math.PI*2);
  ctx.fillStyle = "rgba(255,215,120,.95)";
  ctx.fill();
  ctx.strokeStyle = "rgba(80,50,15,.65)";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Star
  ctx.fillStyle = "rgba(60,35,10,.75)";
  ctx.font = "14px system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("★", x, y+0.5);
  ctx.restore();
}

// ---------- Boss Spawn Marker (legendary) ----------
function drawBossSpawnLegendary(x,y,t){
  // t in seconds
  const pulse = 0.55 + 0.45*Math.sin(t*2.2);
  const rOuter = 28 + pulse*2.5;
  const rInner = 18;

  ctx.save();

  // Soft glow
  ctx.shadowColor = "rgba(255,170,60,.65)";
  ctx.shadowBlur = 18 + pulse*10;

  // Outer rune ring (gold -> ember)
  const grad = ctx.createLinearGradient(x-rOuter, y-rOuter, x+rOuter, y+rOuter);
  grad.addColorStop(0, "rgba(255,220,140,.95)");
  grad.addColorStop(0.55, "rgba(255,120,60,.92)");
  grad.addColorStop(1, "rgba(255,220,140,.95)");

  ctx.strokeStyle = grad;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(x,y,rOuter,0,Math.PI*2);
  ctx.stroke();

  // Rotating dashed ring
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(255,230,170,.70)";
  ctx.lineWidth = 2.5;
  ctx.setLineDash([5, 6]);
  ctx.lineDashOffset = -t*18;
  ctx.beginPath();
  ctx.arc(x,y,rOuter-7,0,Math.PI*2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Inner dark seal
  ctx.fillStyle = "rgba(30,10,6,.65)";
  ctx.beginPath();
  ctx.arc(x,y,rInner,0,Math.PI*2);
  ctx.fill();

  // Inner rim
  ctx.strokeStyle = "rgba(255,200,120,.55)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x,y,rInner,0,Math.PI*2);
  ctx.stroke();

  // Icon
  ctx.fillStyle = "rgba(255,230,170,.92)";
  ctx.font = "16px system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("☠", x, y+0.5);

  // Small crown sparkle
  ctx.font = "13px system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx.fillStyle = "rgba(255,215,120,.95)";
  ctx.fillText("♛", x, y-13.5);

  ctx.restore();
}



// ---------- Boss Entity ----------
function drawBossEntity(boss, t){
  const n = nodesById.get(boss.node);
  if(!n) return;
  const x = n.x, y = n.y;

  // Visible/stealth handling (future)
  const visible = (boss.visible !== false);

  ctx.save();

  // Base aura
  const pulse = 0.55 + 0.45*Math.sin(t*2.6 + (boss._pulseSeed||0));
  ctx.globalAlpha = visible ? 1 : 0.15;

  // Outer glow ring
  ctx.shadowColor = "rgba(255,80,40,.75)";
  ctx.shadowBlur  = 20 + pulse*14;

  ctx.beginPath();
  ctx.arc(x, y, 22 + pulse*2.0, 0, Math.PI*2);
  ctx.strokeStyle = "rgba(255,150,80,.95)";
  ctx.lineWidth = 4;
  ctx.stroke();

  // Inner dark core
  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.arc(x, y, 14, 0, Math.PI*2);
  ctx.fillStyle = "rgba(20,10,6,.75)";
  ctx.fill();

  // Icon
  ctx.fillStyle = "rgba(255,220,180,.95)";
  ctx.font = "bold 16px serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("☠", x, y+0.5);

  ctx.restore();
}


// ---------- HUD (Screen) ----------
function drawHUD(){
  // kleine Punkteanzeige oben links
  const pad = 12;
  const x = pad;
  const y = pad;
  const w = 220;
  const h = 126;

  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = "rgba(10,12,18,.55)";
  ctx.strokeStyle = "rgba(255,255,255,.12)";
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, w, h, 14);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "rgba(245,250,255,.92)";
  ctx.font = "700 14px system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(`Zielpunkte (bis ${state.goalToWin})`, x+12, y+10);

  const lines = [1,2,3,4].map(t=>`Team ${t}: ${(state.goalScores?.[t]||0)}/${state.goalToWin}`);
  ctx.font = "600 13px system-ui, -apple-system, Segoe UI, Roboto, Arial";
  lines.forEach((txt,i)=>{
    ctx.fillStyle = "rgba(245,250,255,.92)";
    ctx.fillText(txt, x+12, y+34 + i*20);
  });

  if(state.gameOver){
    ctx.fillStyle = "rgba(255,215,120,.95)";
    ctx.fillText("Spiel beendet", x+12, y+34 + 4*20);
  }

  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r){
  const rr = Math.min(r, w/2, h/2);
  ctx.beginPath();
  ctx.moveTo(x+rr, y);
  ctx.arcTo(x+w, y, x+w, y+h, rr);
  ctx.arcTo(x+w, y+h, x, y+h, rr);
  ctx.arcTo(x, y+h, x, y, rr);
  ctx.arcTo(x, y, x+w, y, rr);
  ctx.closePath();
}

// ---------- Render -----------
function draw(){
  // Canvas auf CSS-Größe setzen (einfach)
  const dpr = Math.max(1, window.devicePixelRatio||1);
  const w = Math.floor(canvas.clientWidth * dpr);
  const h = Math.floor(canvas.clientHeight * dpr);
  if(canvas.width!==w || canvas.height!==h){
    canvas.width=w; canvas.height=h;
    ctx.setTransform(dpr,0,0,dpr,0,0);
  }

  ctx.clearRect(0,0,canvas.clientWidth,canvas.clientHeight);

  ctx.save();
  ctx.translate(cam.x, cam.y);
  ctx.scale(cam.s, cam.s);

  // Edges
  ctx.lineWidth=2;
  ctx.strokeStyle="rgba(255,255,255,.18)";
  for(const e of edges){
    const a=nodesById.get(e.a);
    const b=nodesById.get(e.b);
    if(!a || !b) continue;
    ctx.beginPath();
    ctx.moveTo(a.x,a.y);
    ctx.lineTo(b.x,b.y);
    ctx.stroke();
  }

    // Nodes + Highlights
  const R=18;
  for(const n of nodes){
    ctx.beginPath();
    ctx.arc(n.x,n.y,R,0,Math.PI*2);

    let fill="rgba(255,255,255,.10)";
    if(state.highlighted.has(n.id)) fill="rgba(124,92,255,.38)";
    if(state.phase==="placeBarricade" && state.placeHighlighted.has(n.id)) fill="rgba(65,209,122,.28)";
    if(state.jokerMode==="moveBarricadePlace" && state.jokerHighlighted && state.jokerHighlighted.has(n.id)) fill="rgba(255,204,102,.28)";
    if(state.phase==="usePortal" && state.portalHighlighted.has(n.id)) fill="rgba(120,200,255,.35)";

    // Portal sichtbar machen (rein optisch, noch keine Teleport-Logik)
    // Board-Editor setzt dafür n.type==="portal" (optional auch props.portalKey / portalId)
    if(n.type==="portal"){
      // wenn es ein Highlight ist, bleibt das Highlight stärker, ansonsten Portal-Farbton
      if(!state.highlighted.has(n.id) && !(state.phase==="placeBarricade" && state.placeHighlighted.has(n.id))){
        fill="rgba(76,160,255,.22)";
      }
    }

    // Grund-Tints für Special-Felder (nur wenn kein starkes Highlight dominiert)
    const hardHL = state.highlighted.has(n.id)
      || (state.phase==="placeBarricade" && state.placeHighlighted.has(n.id))
      || (state.jokerMode==="moveBarricadePlace" && state.jokerHighlighted && state.jokerHighlighted.has(n.id))
      || (state.phase==="usePortal" && state.portalHighlighted.has(n.id));
    if(!hardHL){
      // Ereignisfeld: rot markieren (unter Barrikaden darf es unsichtbar bleiben)
      if(state.eventActive && state.eventActive.has(n.id) && !barricades.has(n.id)){
        fill = "rgba(220,60,60,.22)";
      }
      // Zielfeld / Zielpunkte: gold markieren
      if(state.goalNodeId && n.id===state.goalNodeId && !barricades.has(n.id)){
        fill = "rgba(255,205,80,.26)";
      }
    }

    ctx.fillStyle=fill;
    ctx.fill();

    // outline
    ctx.strokeStyle="rgba(255,255,255,.12)";
    ctx.stroke();

    // Ereignisfelder: als Wachssiegel richtig sichtbar (unter Barrikaden versteckbar)
    if(state.eventActive && state.eventActive.has(n.id)){
      if(!barricades.has(n.id)){
        drawWaxSeal(n.x, n.y, 14);
      }
    }

    // Portal-Ring + Symbol
    if(n.type==="portal"){
      ctx.save();
      // Außenring
      ctx.strokeStyle="rgba(120,200,255,.75)";
      ctx.lineWidth=3;
      ctx.beginPath();
      ctx.arc(n.x,n.y,R+4,0,Math.PI*2);
      ctx.stroke();

      // Innenring
      ctx.strokeStyle="rgba(120,200,255,.35)";
      ctx.lineWidth=2;
      ctx.beginPath();
      ctx.arc(n.x,n.y,R-6,0,Math.PI*2);
      ctx.stroke();

      // kleines Portal-Symbol (∿) in der Mitte
      ctx.fillStyle="rgba(210,240,255,.85)";
      ctx.font="14px system-ui, -apple-system, Segoe UI, Roboto, Arial";
      ctx.textAlign="center";
      ctx.textBaseline="middle";
      ctx.fillText("⟲", n.x, n.y+0.5);
      ctx.restore();
    }
  }

  // 🎯 Zielpunkt zeichnen (unter Barrikaden versteckbar)
  if(state.goalNodeId){
    const gn = nodesById.get(state.goalNodeId);
    if(gn && !barricades.has(state.goalNodeId)){
      drawGoalToken(gn.x, gn.y);
    }
  }

  // 🌟 Doppel-Zielfeld (einmalig, +2 Punkte)
  if(state.bonusGoalNodeId){
    const bn = nodesById.get(state.bonusGoalNodeId);
    if(bn && !barricades.has(state.bonusGoalNodeId)){
      drawGoalToken(bn.x, bn.y);
      ctx.save();
      ctx.fillStyle = "rgba(88,38,8,.88)";
      ctx.font = "bold 11px system-ui, -apple-system, Segoe UI, Roboto, Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("×2", bn.x, bn.y + 18);
      ctx.restore();
    }
  }

  // ✨ Zusätzliches Lichtfeld (einmalig, +1 Punkt)
  if(state.bonusLightNodeId){
    const ln = nodesById.get(state.bonusLightNodeId);
    if(ln && !barricades.has(state.bonusLightNodeId)){
      // eigener Look statt normales Zieltoken
      ctx.save();

      const glow = ctx.createRadialGradient(ln.x, ln.y, 2, ln.x, ln.y, 28);
      glow.addColorStop(0, "rgba(255,245,180,.98)");
      glow.addColorStop(1, "rgba(255,245,180,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(ln.x, ln.y, 28, 0, Math.PI*2);
      ctx.fill();

      ctx.beginPath();
      ctx.arc(ln.x, ln.y, 12, 0, Math.PI*2);
      ctx.fillStyle = "rgba(255,250,210,.98)";
      ctx.fill();
      ctx.strokeStyle = "rgba(180,140,40,.85)";
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.strokeStyle = "rgba(255,245,170,.95)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(ln.x, ln.y, 17, 0, Math.PI*2);
      ctx.stroke();

      ctx.fillStyle = "rgba(120,90,20,.95)";
      ctx.font = "bold 14px system-ui, -apple-system, Segoe UI, Roboto, Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("✦", ln.x, ln.y + 0.5);
      ctx.restore();
    }
  }

  // Barrikaden als Overlay (decken Ziel/Ereignis optisch komplett ab)
  for(const id of barricades){
    const n = nodesById.get(id);
    if(!n) continue;

    const s = 36; // Größe der Barrikade (muss größer als Ziel-Glow sein)
    const x = n.x - s/2;
    const y = n.y - s/2;

    ctx.save();

    // Shadow
    ctx.fillStyle = "rgba(0,0,0,.28)";
    ctx.fillRect(x+2.5, y+3.0, s, s);

    // Wood-like fill
    const g = ctx.createLinearGradient(x, y, x, y+s);
    g.addColorStop(0, "rgba(115,78,44,.98)");
    g.addColorStop(.55, "rgba(92,60,33,.98)");
    g.addColorStop(1, "rgba(70,44,24,.98)");
    ctx.fillStyle = g;
    ctx.fillRect(x, y, s, s);

    // Plank lines
    ctx.strokeStyle = "rgba(255,255,255,.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x+3, y+s*0.33);
    ctx.lineTo(x+s-3, y+s*0.33);
    ctx.moveTo(x+3, y+s*0.66);
    ctx.lineTo(x+s-3, y+s*0.66);
    ctx.stroke();

    // Frame
    ctx.strokeStyle = "rgba(255,204,102,.95)";
    ctx.lineWidth = 3.5;
    ctx.strokeRect(x+1.5, y+1.5, s-3, s-3);

    // Nails
    ctx.fillStyle = "rgba(0,0,0,.22)";
    const nail = (nx,ny)=>{ ctx.beginPath(); ctx.arc(nx,ny,2.1,0,Math.PI*2); ctx.fill(); };
    nail(x+7, y+7); nail(x+s-7, y+7); nail(x+7, y+s-7); nail(x+s-7, y+s-7);

    ctx.restore();
  }

  // 👑 Boss-Respawn-Felder (legendär sichtbar)
  const _tBoss = (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;
  for(const n of nodes){
    if(n.type === "boss"){
      drawBossSpawnLegendary(n.x, n.y, _tBoss);
    }
  }



  // Bosses (entities)
  if(state.bosses && state.bosses.length){
    const tSec = (performance.now()/1000);
    for(const b of state.bosses){
      if(!b || b.alive===false || !b.node) continue;
      if(b._pulseSeed==null) b._pulseSeed = (Math.random()*10);
      drawBossEntity(b, tSec);
    }
  }


    // Pieces
  const selectedId = state.selected;
  for(const p of state.pieces){
    if(!p.node) continue;
    const n=nodesById.get(p.node);
    if(!n) continue;

    // Piece body
    ctx.beginPath();
    ctx.arc(n.x,n.y,12,0,Math.PI*2);
    ctx.fillStyle=TEAM_COLORS[p.team] || "#fff";
    ctx.fill();
    ctx.strokeStyle="rgba(20,12,6,.55)";
    ctx.lineWidth=2;
    ctx.stroke();

    // Shield ring
    if(p.shielded){
      ctx.save();
      ctx.strokeStyle="rgba(120,200,255,.92)";
      ctx.lineWidth=4;
      ctx.beginPath();
      ctx.arc(n.x,n.y,17,0,Math.PI*2);
      ctx.stroke();
      ctx.restore();
    }

    // Selected piece ring (nur die ausgewählte Figur umranden)
    if(selectedId && p.id === selectedId){
      ctx.save();
      ctx.strokeStyle="rgba(200,166,75,.95)";
      ctx.lineWidth=3;
      ctx.beginPath();
      ctx.arc(n.x,n.y,16,0,Math.PI*2);
      ctx.stroke();

      ctx.strokeStyle="rgba(35,25,16,.55)";
      ctx.lineWidth=1.5;
      ctx.beginPath();
      ctx.arc(n.x,n.y,18.5,0,Math.PI*2);
      ctx.stroke();
      ctx.restore();
    }
  }

  ctx.restore();

  // HUD (Screen overlay)
  drawHUD();

  requestAnimationFrame(draw);
}

// ---------- Load ----------
async function load(){
  const V = (typeof window !== "undefined" && window.BUILD_ID) ? window.BUILD_ID : String(Date.now());
  const url = `Mittelalter.board.json?v=${V}`;

  setStatus("Lade Board...");
  ensureFixedUILayout();
  console.info("[LOAD] fetching", url);

  const ac = new AbortController();
  const t = setTimeout(()=>ac.abort(), 12000);

  try{
    const res = await fetch(url, { cache:"no-store", signal: ac.signal });
    console.info("[LOAD] status", res.status, res.statusText, "content-type:", res.headers.get("content-type"));

    if(!res.ok){
      const txt = await res.text().catch(()=>"(no body)");
      console.error("[LOAD] fetch failed", res.status, res.statusText, txt.slice(0,400));
      setStatus(`Board-Fehler: HTTP ${res.status}`);
      return;
    }

    // Parse JSON (catch parsing errors)
    board = await res.json();
  }catch(err){
    console.error("[LOAD] exception", err);
    const msg = (err && err.name === "AbortError") ? "Timeout beim Laden" : (err?.message || String(err));
    setStatus(`Board-Fehler: ${msg}`);
    return;
  }finally{
    clearTimeout(t);
  }

  nodes=board.nodes||[];
  edges=board.edges||[];

  // reset cached bounds when a new board loads
  _boardBoundsCache = null;

  nodesById=new Map(nodes.map(n=>[n.id,n]));

  // --- Safety: Startfelder dürfen NICHT miteinander verbunden sein (sonst startet eine Farbe "im Weg" einer anderen).
  // Falls im Board versehentlich ein Edge zwischen zwei Startfeldern verschiedener Teams liegt (z.B. Grün <-> Braun),
  // entfernen wir ihn hier automatisch, ohne am Board-JSON rumzuschrauben.
  edges = (edges||[]).filter(e=>{
    const a = nodesById.get(e.a);
    const b = nodesById.get(e.b);
    if(!a || !b) return false;
    if(a.type==="start" && b.type==="start"){
      const ta = Number(a.props?.startTeam);
      const tb = Number(b.props?.startTeam);
      if(ta && tb && ta !== tb) return false;
    }
    return true;
  });
  adj=new Map();
  for(const n of nodes) adj.set(n.id,[]);
  for(const e of edges){
    if(!adj.has(e.a)) adj.set(e.a,[]);
    if(!adj.has(e.b)) adj.set(e.b,[]);
    adj.get(e.a).push(e.b);
    adj.get(e.b).push(e.a);
  }

  // --- Auto-Fix: Start-Ausgang fehlt? ---
  // Wenn ein Startfeld keine Verbindung zu einem Nicht-Start-Feld hat, kann die Figur nicht "rauslaufen".
  // Wir verbinden es dann automatisch mit dem nächstgelegenen Nicht-Start-Knoten.
  // (Ändert NICHT dein board.json dauerhaft, ist nur ein Runtime-Fix.)
  const startNodes = nodes.filter(n=>n.type==="start");
  for(const s of startNodes){
    const neigh = adj.get(s.id) || [];
    const hasExit = neigh.some(id=> (nodesById.get(id)?.type) !== "start");
    if(hasExit) continue;

    // suche nächstgelegenen Nicht-Start-Knoten
    let best = null;
    let bestD = Infinity;
    for(const n of nodes){
      if(n.id === s.id) continue;
      if(n.type === "start") continue;
      const dx = n.x - s.x;
      const dy = n.y - s.y;
      const d2 = dx*dx + dy*dy;
      if(d2 < bestD){
        bestD = d2;
        best = n;
      }
    }
    if(!best) continue;

    // Edge hinzufügen
    edges.push({a: s.id, b: best.id});
    if(!adj.has(s.id)) adj.set(s.id, []);
    if(!adj.has(best.id)) adj.set(best.id, []);
    adj.get(s.id).push(best.id);
    adj.get(best.id).push(s.id);

    console.warn("[AUTO-FIX] Start-Ausgang hinzugefügt:", s.id, "->", best.id);
  }


  // --- Auto-Fix: Boss-Spawn-Felder müssen mit dem "Haupt-Graph" verbunden sein ---
  // Problem: Ein Boss-Spawn kann zwar Nachbarn haben, aber nur im Boss-Subgraph hängen → Boss findet keinen Pfad zu Spielern.
  // Fix: Wenn vom Boss-Spawn KEIN Nicht-Boss-Feld erreichbar ist, verbinden wir runtime-mäßig zum nächstgelegenen Nicht-Boss-Knoten.
  // (Ändert NICHT dein board.json dauerhaft, ist nur ein Runtime-Fix.)
  function canReachNonBoss(startId){
    const q=[startId];
    const seen=new Set([startId]);
    while(q.length){
      const cur=q.shift();
      const nn=adj.get(cur)||[];
      for(const nb of nn){
        if(seen.has(nb)) continue;
        seen.add(nb);
        const node = nodesById.get(nb);
        if(node && node.type !== "boss") return true;
        q.push(nb);
      }
    }
    return false;
  }

  const bossNodes = nodes.filter(n=>n.type==="boss");
  for(const s of bossNodes){
    if(canReachNonBoss(s.id)) continue;

    let best = null;
    let bestD = Infinity;
    for(const n of nodes){
      if(!n || n.id === s.id) continue;
      if(n.type === "boss") continue; // nicht Boss->Boss verbinden
      // Start-Felder meiden (Boss soll nicht in Startzonen "spawnen")
      if(n.type === "start") continue;
      const dx = n.x - s.x;
      const dy = n.y - s.y;
      const d2 = dx*dx + dy*dy;
      if(d2 < bestD){
        bestD = d2;
        best = n;
      }
    }
    if(!best) continue;

    edges.push({a: s.id, b: best.id});
    if(!adj.has(s.id)) adj.set(s.id, []);
    if(!adj.has(best.id)) adj.set(best.id, []);
    adj.get(s.id).push(best.id);
    adj.get(best.id).push(s.id);

    console.warn("[AUTO-FIX] Boss-Spawn verbunden:", s.id, "->", best.id);
  }

  initPieces();
  initEventFieldsFromBoard();

  // Boss-System initialisieren (keine Bosse aktiv beim Start)
  ensureBossState();
  state.bosses = [];
  state.bossSpawnNodes = getBossSpawnNodes();
  state.bossTick = 0;
  updateBossUI();

  // Zielpunkte initialisieren
  state.goalScores = {1:0,2:0,3:0,4:0};
  state.gameOver = false;
  state.goalNodeId = null;
  spawnGoalRandom(true);
  if(selPlayerCount) selPlayerCount.value = String(state.players.length||4);
  fitToBoard(60);
  state.phase="needRoll";
  dieBox.textContent="–";
  setStatus(`Team ${currentTeam()} ist dran: Würfeln.`);

  // Joker UI init
  ensureJokerState();
  renderJokerButtons();
  updateJokerUI();
  ensureEventSelectUI();
}



// ---- Sidebar UI: Ereigniskarte fürs nächste Feld auswählen (Test-Modus) ----
function ensureEventSelectUI(){
  const sidebar = document.getElementById("sidePanel") || document.getElementById("sidebar") || document.body;
  const hostParent = (typeof jokerButtonsWrap !== "undefined" && jokerButtonsWrap && jokerButtonsWrap.parentElement) ? jokerButtonsWrap.parentElement : sidebar;

  let box = document.getElementById("eventForceBox");
  if(box) return box;

  box = document.createElement("div");
  box.id = "eventForceBox";
  box.style.cssText = "margin-top:12px; padding:10px; border-radius:14px; background:rgba(10,12,18,.42); border:1px solid rgba(255,255,255,.10); color:rgba(245,250,255,.92); font:700 13px system-ui, -apple-system, Segoe UI, Roboto, Arial;";

  const h = document.createElement("div");
  h.textContent = "Event wählen (Test)";
  h.style.cssText = "font-weight:900; margin-bottom:8px; letter-spacing:.2px;";
  box.appendChild(h);

  const sel = document.createElement("select");
  sel.id = "eventForceSelect";
  sel.style.cssText = "width:100%; padding:10px; border-radius:12px; border:1px solid rgba(255,255,255,.12); background:rgba(10,12,18,.35); color:rgba(245,250,255,.92); font-weight:800;";
  box.appendChild(sel);

  const hint = document.createElement("div");
  hint.style.cssText = "margin-top:8px; opacity:.75; font-size:12px; line-height:1.25;";
  hint.textContent = "Diese Auswahl bleibt aktiv, bis du sie änderst. (Nächste Felder ziehen diese Karte)";
  box.appendChild(hint);

  function rebuildOptions(){
    sel.innerHTML = "";
    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = "— Zufällig —";
    sel.appendChild(opt0);

    const seen = new Set();
    for(const c of EVENT_DECK){
      if(seen.has(c.id)) continue;
      seen.add(c.id);
      const o = document.createElement("option");
      o.value = c.id;
      o.textContent = c.title;
      sel.appendChild(o);
    }

    sel.value = eventForceCardId || "";
  }

  rebuildOptions();

  sel.addEventListener("change", ()=>{
    eventForceCardId = sel.value || null;
    if(eventForceCardId){
      const c = EVENT_DECK.find(x=>x.id===eventForceCardId);
      setStatus(`🧪 Test aktiv: ${c ? c.title : eventForceCardId}`);
    }else{
      setStatus("🧪 Test aus: Ereigniskarten wieder zufällig.");
    }
  });

  hostParent.appendChild(box);
  return box;
}
connectOnlineAuthority();
load();
draw();

})();
