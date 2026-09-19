import fs from "fs";
import path from "path";
import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import admin from "firebase-admin";

const PORT = process.env.PORT || 10000;
const SERVER_BUILD = "barikade-main4-smiley-broadcast-v3-20260919";

// ---------- Player Colors (Lobby Selection) ----------
// WICHTIG (Christoph-Wunsch): KEINE automatische Farbe mehr beim Join.
// Jeder (auch Host) wählt seine Farbe aktiv in der Lobby.
// Reconnect via sessionToken behält die Farbe.
//
// 2–4 Spieler: alle 4 Farben sind grundsätzlich möglich.
// Die Turn-Reihenfolge läuft über room.state.activeColors (nur die tatsächlich
// im Match verwendeten Farben). Pieces existieren aber immer für alle 4 Farben.
const ALLOWED_COLORS = ["red", "blue", "green", "yellow"];

// ---------- Wheel Quotes (Kick) ----------
const KICK_QUOTES = [
  "Abflug! Sitzplatz gibt's draussen.",
  "Raus mit dir – das ist Barikade, kein Wellnessurlaub!",
  "Zack! Das war ein Kurztrip ins Aus.",
  "Du wolltest Action? Bitte sehr.",
  "Heute gibt’s keinen Rabatt auf Schadenfreude.",
  "Einmal frische Luft fuers Karma!",
  "Und tschues – wir sehen uns am Startfeld!",
  "Der Wurf war gut… fuer mich. Schlecht fuer dich.",
  "Das Brett ist voll – einer muss gehen.",
  "Gerade noch drin, jetzt schon draussen.",
  "Das war kein Schritt, das war ein Rausschmiss.",
  "Kleiner Ausflug? Nein: grosser Rauswurf.",
  "Hier fliegen Figuren schneller als Ausreden.",
  "Wenn’s kracht, dann richtig!",
  "Barikade sagt: Bitte hinten anstellen – draussen.",
  "Du bist nicht raus… du bist nur woanders.",
  "Einmal Kick to go.",
  "Auf Wiedersehen im Rueckspiegel!",
  "Das Spielfeld hat gesprochen.",
  "Heute ist nicht dein Tag – heute ist meiner!",
  "Ich nenn das: taktische Luftnummer.",
  "Sorry, Regeln sind Regeln – und ich bin Chef.",
  "Gute Reise! Nicht vergessen: Rueckflug erst spaeter.",
  "Bumm. Und weg war sie/er.",
  "Das ist kein Bug – das ist Barikade.",
  "Wenn du fällst, dann stilvoll.",
  "Ich schubs nur… der Rest macht die Physik.",
  "Kopf hoch – Startfeld ist auch schoen.",
  "Aus dem Weg, ich hab Ziele!",
  "Schnelltest: raus oder raus? Ergebnis: raus."
];


// ---------- Action-Mode Joker Stacks (v2) ----------
// We keep the existing action.jokersByColor for backwards compatibility,
// but internally we store earned/base jokers as arrays with an "origin color".
// This allows: multiple jokers per type, and correct display of the kicked color.
const ACTION_JOKER_TYPES = ["choose","sum","allColors","barricade","reroll","double"];

function ensureActionJokers(action){
  if(!action) return;
  if(!action.jokersOwned || typeof action.jokersOwned !== "object"){
    action.jokersOwned = { red: [], blue: [], green: [], yellow: [] };
  } else {
    for(const c of ALLOWED_COLORS){
      if(!Array.isArray(action.jokersOwned[c])) action.jokersOwned[c] = [];
    }
  }
  if(!action.jokersByColor || typeof action.jokersByColor !== "object"){
    action.jokersByColor = {
      red:      { choose:0, sum:0, allColors:0, barricade:0, reroll:0, double:0 },
      blue:     { choose:0, sum:0, allColors:0, barricade:0, reroll:0, double:0 },
      green:    { choose:0, sum:0, allColors:0, barricade:0, reroll:0, double:0 },
      yellow:   { choose:0, sum:0, allColors:0, barricade:0, reroll:0, double:0 },
    };
  } else {
    for(const c of ALLOWED_COLORS){
      if(!action.jokersByColor[c] || typeof action.jokersByColor[c] !== "object"){
        action.jokersByColor[c] = { choose:0, sum:0, allColors:0, barricade:0, reroll:0, double:0 };
      }
      for(const t of ACTION_JOKER_TYPES){
        const v = action.jokersByColor[c][t];
        if(v === true) action.jokersByColor[c][t] = 1;
        else if(v === false || v == null) action.jokersByColor[c][t] = 0;
        else if(typeof v !== "number" || !isFinite(v)) action.jokersByColor[c][t] = 0;
        else action.jokersByColor[c][t] = Math.max(0, Math.floor(v));
      }
    }
  }
}

function syncJokerCountsFromOwned(action){
  if(!action) return;
  ensureActionJokers(action);
  for(const c of ALLOWED_COLORS){
    const owned = action.jokersOwned[c] || [];
    const counts = { choose:0, sum:0, allColors:0, barricade:0, reroll:0, double:0 };
    for(const j of owned){
      const t = String(j?.type || "");
      if(counts[t] != null) counts[t] += 1;
    }
    action.jokersByColor[c] = counts;
  }
}

function addOwnedJoker(action, ownerColor, type, originColor, source="wheel"){
  if(!action) return;
  ensureActionJokers(action);
  if(!ALLOWED_COLORS.includes(ownerColor)) return;
  const t = String(type || "");
  if(!ACTION_JOKER_TYPES.includes(t)) return;
  const origin = ALLOWED_COLORS.includes(originColor) ? originColor : ownerColor;
  action.jokersOwned[ownerColor].push({ type: t, color: origin, source, ts: Date.now() });
  syncJokerCountsFromOwned(action);
}

function consumeOwnedJoker(action, ownerColor, type){
  if(!action) return null;
  ensureActionJokers(action);
  if(!ALLOWED_COLORS.includes(ownerColor)) return null;
  const t = String(type || "");
  const arr = action.jokersOwned[ownerColor];
  if(!Array.isArray(arr) || !arr.length) return null;
  const idx = arr.findIndex(j => String(j?.type) === t);
  if(idx < 0) return null;
  const [removed] = arr.splice(idx, 1);
  syncJokerCountsFromOwned(action);
  return removed || null;
}

function countOwnedJokers(action, ownerColor, type){
  if(!action) return 0;
  ensureActionJokers(action);
  const arr = action.jokersOwned?.[ownerColor];
  if(!Array.isArray(arr)) return 0;
  const t = String(type || "");
  let n = 0;
  for(const j of arr){ if(String(j?.type) === t) n++; }
  return n;
}

function roomUpdatePayload(room, playersOverride) {
  return {
    type: "room_update",
    players: Array.isArray(playersOverride) ? playersOverride : currentPlayersList(room),
    canStart: canStart(room),
    jokerAwardMode: (room.state && room.state.jokerAwardMode) ? room.state.jokerAwardMode : (room.jokerAwardMode || "thrower"),
    jokerStartCount: Number.isInteger(room?.jokerStartCount) ? room.jokerStartCount : null,
    allowedColors: ALLOWED_COLORS,
  };
}

// ---------- Firebase (optional, but recommended for 100% Restore) ----------
// IMPORTANT: We do NOT remove the existing disk save/restore.
// Firebase is an additional, durable persistence layer.
const FIREBASE_ENABLED = String(process.env.FIREBASE_ENABLED || "").trim() === "1";
const FIREBASE_COLLECTION = process.env.FIREBASE_COLLECTION || "rooms";


const STATS_COLLECTION = process.env.STATS_COLLECTION || "stats";
let firestore = null;

function parseServiceAccountFromEnv() {
  // Supports either:
  // - FIREBASE_SERVICE_ACCOUNT_JSON: raw JSON string
  // - FIREBASE_SERVICE_ACCOUNT_B64: base64 encoded JSON
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  try {
    if (raw && raw.trim().startsWith("{")) return JSON.parse(raw);
  } catch (_e) {}
  try {
    if (b64 && b64.trim().length > 10) {
      const json = Buffer.from(b64.trim(), "base64").toString("utf8");
      return JSON.parse(json);
    }
  } catch (_e) {}
  return null;
}

function initFirebaseIfConfigured() {
  if (!FIREBASE_ENABLED) return;
  try {
    if (firestore) return;
    const serviceAccount = parseServiceAccountFromEnv();
    if (!serviceAccount) {
      console.warn("[firebase] FIREBASE_ENABLED=1 but no service account JSON found. Falling back to disk only.");
      return;
    }
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    }
    firestore = admin.firestore();
    console.log("[firebase] Firestore enabled for persistence");
  } catch (e) {
    console.warn("[firebase] init failed, falling back to disk only:", e?.message || e);
    firestore = null;
  }
}


 // ---------- Global Barikade Stats (Firestore) ----------
 // Requirements:
 // - count ONLY registered names (no "Gast")
 // - count a game when someone wins (including forfeit)
 // - store in Firebase (Firestore). If Firestore unavailable, stats are skipped (game never breaks).
 function normName(name){
   return String(name||"").trim().replace(/\s+/g," ").slice(0,32);
 }
 function isGuestName(name){
   const n = normName(name).toLowerCase();
   return !n || n === "gast" || n === "guest";
 }

 // ---------- Test Mode (Exclude from Stats) ----------
 // If a room is marked as test, we do NOT write roll/game stats to Firestore.
 // How a room becomes "test":
 // 1) Room code starts with one of TEST_ROOM_PREFIXES (default: "TEST")
 // 2) Host can toggle it in lobby via WS message: {type:"set_test_mode", isTest:true}
 const TEST_ROOM_PREFIXES = String(process.env.TEST_ROOM_PREFIXES || "TEST")
   .split(",")
   .map(s => s.trim().toUpperCase())
   .filter(Boolean);

 function isTestRoomCode(code){
   const c = normalizeRoomCode(code);
   if(!c) return false;
   for(const pref of TEST_ROOM_PREFIXES){
     if(pref && c.startsWith(pref)) return true;
   }
   return false;
 }

 function isTestRoom(room){
   try{
     if(room?.state && room.state.isTest === true) return true;
     if(room?.isTest === true) return true;
     return isTestRoomCode(room?.code);
   }catch(_e){
     return false;
   }
 }
 function statsDocId(name){
   return normName(name).toUpperCase().replace(/[^A-Z0-9_-]/g,"_").slice(0,64) || "UNKNOWN";
 }
 async function statsUpsert(name, patch){
   try{
     initFirebaseIfConfigured();
     if(!firestore) return false;
     const displayName = normName(name);
     if(isGuestName(displayName)) return false;

     const ref = firestore.collection(STATS_COLLECTION).doc(statsDocId(displayName));
     await firestore.runTransaction(async (tx) => {
       const snap = await tx.get(ref);
       const cur = snap.exists ? (snap.data()||{}) : {};
       const next = { ...cur };

       // Keep display name (last seen)
       next.name = displayName;

       // Apply numeric increments or sets
       for(const [k,v] of Object.entries(patch||{})){
         if(typeof v === "number" && isFinite(v)){
           next[k] = (typeof next[k]==="number" && isFinite(next[k])) ? next[k] + v : v;
         }else if(v != null){
           next[k] = v;
         }
       }

       // Defaults
       if(typeof next.games !== "number") next.games = 0;
       if(typeof next.wins !== "number") next.wins = 0;
       if(typeof next.forfeits !== "number") next.forfeits = 0;
       if(typeof next.rollCount !== "number") next.rollCount = 0;
       if(typeof next.rollSum !== "number") next.rollSum = 0;
       if(typeof next.playMs !== "number") next.playMs = 0;

       next.updatedAt = Date.now();
       tx.set(ref, next, { merge: true });
     });
     return true;
   }catch(e){
     console.warn("[stats] upsert failed:", e?.message||e);
     return false;
   }
 }
 function getPlayerNameByColor(room, color){
   try{
     color = String(color||"").toLowerCase();
     for(const p of room.players.values()){
       if(String(p?.color||"").toLowerCase() === color){
         return normName(p?.name);
       }
     }
   }catch(_e){}
   return "";
 }
 async function recordRollStat(room, color, value){
   const name = getPlayerNameByColor(room, color);
   if(isGuestName(name)) return;
   await statsUpsert(name, { rollCount: 1, rollSum: Number(value)||0 });
 }
 
 // ---------------- Match tracking (titles per finished game) ----------------
 function ensureMatchTrack(room){
   if(!room?.state) return;
   if(!room.state.matchTrack){
     const perPlayer = {};
     (room.players||[]).forEach(p=>{
       const nk = String(p.nameKey||"").trim();
       if(!nk) return;
       perPlayer[nk] = { kills:0, deaths:0, six:0, one:0, distance:0, turnSumMs:0, turnCount:0 };
     });
     room.state.matchTrack = { perPlayer, turnStartedAt: Date.now() };
   }
 }
 function ensureMatchPlayer(room, nameKey){
   ensureMatchTrack(room);
   if(!room?.state?.matchTrack) return null;
   const nk = String(nameKey||"").trim();
   if(!nk) return null;
   const per = room.state.matchTrack.perPlayer;
   if(!per[nk]) per[nk] = { kills:0, deaths:0, six:0, one:0, distance:0, turnSumMs:0, turnCount:0 };
   return per[nk];
 }
 function recordMatchRoll(room, color, value){
   const name = getPlayerNameByColor(room, color);
   if(!name || isGuestName(name)) return;
   const st = ensureMatchPlayer(room, name);
   if(!st) return;
   const v = Number(value)||0;
   if(v===1) st.one++;
   if(v===6) st.six++;
 }
 function recordMatchMove(room, color, steps){
   const name = getPlayerNameByColor(room, color);
   if(!name || isGuestName(name)) return;
   const st = ensureMatchPlayer(room, name);
   if(!st) return;
   st.distance += Math.max(0, Number(steps)||0);
 }

// Track joker usage per match (for titles). Server is chef.
function recordMatchJoker(room, color, type){
  const name = getPlayerNameByColor(room, color);
  if(!name || isGuestName(name)) return;
  const st = ensureMatchPlayer(room, name);
  if(!st) return;
  if(typeof st.jokersUsed !== "number") st.jokersUsed = 0;
  st.jokersUsed += 1;
  const k = String(type||"").toLowerCase();
  if(k){
    if(!st.jokersByType || typeof st.jokersByType !== "object") st.jokersByType = {};
    st.jokersByType[k] = (typeof st.jokersByType[k]==="number" ? st.jokersByType[k] : 0) + 1;
  }
}
 function recordMatchKick(room, attackerColor, victimColor){
   const attacker = getPlayerNameByColor(room, attackerColor);
   const victim   = getPlayerNameByColor(room, victimColor);
   if(attacker && !isGuestName(attacker)){
     const a = ensureMatchPlayer(room, attacker);
     if(a) a.kills++;
   }
   if(victim && !isGuestName(victim)){
     const v = ensureMatchPlayer(room, victim);
     if(v) v.deaths++;
   }
 }
 function recordMatchTurnTime(room, color, ms){
   const name = getPlayerNameByColor(room, color);
   if(!name || isGuestName(name)) return;
   const st = ensureMatchPlayer(room, name);
   if(!st) return;
   const capped = Math.max(0, Math.min(60000, Number(ms)||0)); // cap at 60s (AFK/reconnect safe)
   st.turnSumMs += capped;
   st.turnCount += 1;
 }
 function computeMatchAwards(room){
   ensureMatchTrack(room);
   const per = room?.state?.matchTrack?.perPlayer || {};
   const rows = Object.entries(per).map(([name, s])=>({
     name,
     kills: s.kills||0,
     deaths: s.deaths||0,
     six: s.six||0,
     one: s.one||0,
     distance: s.distance||0,
     jokersUsed: s.jokersUsed||0,
     avgTurnMs: (s.turnCount ? (s.turnSumMs/s.turnCount) : null)
   })).filter(r=>r.name && !isGuestName(r.name));

   const winnersMax = (key)=>{
     const max = rows.reduce((m,r)=>Math.max(m, r[key]??0), -Infinity);
     const ws = rows.filter(r=>(r[key]??0)===max).map(r=>r.name);
     return { value:max, winners:ws };
   };
   const winnersMinAvg = ()=>{
     const valid = rows.filter(r=>r.avgTurnMs!=null && isFinite(r.avgTurnMs));
     if(valid.length===0) return { value:null, winners:[] };
     const min = valid.reduce((m,r)=>Math.min(m, r.avgTurnMs), Infinity);
     const ws = valid.filter(r=>r.avgTurnMs===min).map(r=>r.name);
     return { value:min, winners:ws };
   };
   const winnersMaxAvg = ()=>{
     const valid = rows.filter(r=>r.avgTurnMs!=null && isFinite(r.avgTurnMs));
     if(valid.length===0) return { value:null, winners:[] };
     const max = valid.reduce((m,r)=>Math.max(m, r.avgTurnMs), -Infinity);
     const ws = valid.filter(r=>r.avgTurnMs===max).map(r=>r.name);
     return { value:max, winners:ws };
   };

   const a1 = winnersMax("kills");
   const a2 = winnersMax("deaths");
   const a3 = winnersMax("six");
   const a4 = winnersMax("one");
   const a5 = winnersMax("distance");
   const a8 = winnersMax("jokersUsed");
   const a6 = winnersMaxAvg();
   const a7 = winnersMinAvg();

   return [
     { id:"kills",    title:"👊 Rauswurf‑König",      unit:"Gegner rausgeworfen", value:a1.value, winners:a1.winners },
     { id:"deaths",   title:"🛡 Stehauf‑Männchen",    unit:"mal rausgeworfen",    value:a2.value, winners:a2.winners },
     { id:"six",      title:"🎲 Glückspilz",         unit:"× 6 gewürfelt",       value:a3.value, winners:a3.winners },
     { id:"one",      title:"🧊 Pechvogel",           unit:"× 1 gewürfelt",       value:a4.value, winners:a4.winners },
     { id:"distance", title:"🥾 Wanderer",            unit:"Felder gelaufen",     value:a5.value, winners:a5.winners },
     { id:"jokers",   title:"🃏 Joker‑Meister",       unit:"Joker genutzt",       value:a8.value, winners:a8.winners },
     { id:"slow",     title:"🐢 Vieldenker",          unit:"Ø Sekunden pro Zug",  value:a6.value!=null?Math.round(a6.value/100)/10:null, winners:a6.winners },
     { id:"fast",     title:"⚡ Blitzspieler",        unit:"Ø Sekunden pro Zug",  value:a7.value!=null?Math.round(a7.value/100)/10:null, winners:a7.winners },
   ];
 }
 // --------------------------------------------------------------------------

async function finalizeMatchStats(room, winnerColor, opts={}){
   try{
     if(!room?.state) return;
     if(isTestRoom(room)) return;
     if(room.state.statsFinalized) return;
     room.state.statsFinalized = true;

     const startedAt = Number(room.state.startedAt || 0) || 0;
     const finishedAt = Number(room.state.finishedAt || Date.now()) || Date.now();
     const playMs = Math.max(0, finishedAt - startedAt);

     const active = Array.isArray(room.state.activeColors) && room.state.activeColors.length ? room.state.activeColors : ALLOWED_COLORS;
     const winner = String(winnerColor||"").toLowerCase();

     for(const c of active){
       const name = getPlayerNameByColor(room, c);
       if(isGuestName(name)) continue;
       await statsUpsert(name, { games: 1, playMs });
     }

     const wName = getPlayerNameByColor(room, winner);
     if(!isGuestName(wName)){
       await statsUpsert(wName, { wins: 1 });
     }

     const forfeiter = String(opts.forfeiterColor||"").toLowerCase();
     if(forfeiter){
       const fName = getPlayerNameByColor(room, forfeiter);
       if(!isGuestName(fName)){
         await statsUpsert(fName, { forfeits: 1 });
       }
     }
   }catch(e){
     console.warn("[stats] finalize failed:", e?.message||e);
   }
 }


function docIdForRoom(code) {
  // Keep identical sanitization as disk filename
  return String(code || "")
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 20) || "ROOM";
}


// ---------- Lobby Reservations (Name + Color Pre-Join) ----------
// Goal:
// - In the name-selection mask, show who already clicked a name ("ready") and who is already in-game.
// - Lock selected colors immediately for others.
// - Purely additive: does NOT change gameplay rules.
const LOBBY_TTL_MS = Number(process.env.LOBBY_TTL_MS || (30 * 60 * 1000)); // default 30 min

function nowMs(){ return Date.now(); }

function normalizeRoomCode(code){
  return String(code||"").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 20);
}

function ensureLobby(room){
  if(!room) return;
  if(!room.lobby || typeof room.lobby !== "object") room.lobby = { reservations:{}, colorLocks:{} };
  if(!room.lobby.reservations || typeof room.lobby.reservations !== "object") room.lobby.reservations = {};
  if(!room.lobby.colorLocks || typeof room.lobby.colorLocks !== "object") room.lobby.colorLocks = {};
}

function lobbyCleanup(room){
  try{
    ensureLobby(room);
    const t = nowMs();
    for(const [nameKey, r] of Object.entries(room.lobby.reservations)){
      if(!r || typeof r !== "object"){ delete room.lobby.reservations[nameKey]; continue; }
      const ts = Number(r.ts||0);
      if(ts && (t - ts) > LOBBY_TTL_MS){
        // release color lock
        const c = String(r.color||"").toLowerCase();
        if(c && room.lobby.colorLocks[c] === nameKey) delete room.lobby.colorLocks[c];
        delete room.lobby.reservations[nameKey];
      }
    }
    // remove stale colorLocks that point to missing reservation
    for(const [c, nameKey] of Object.entries(room.lobby.colorLocks)){
      if(!room.lobby.reservations[nameKey]) delete room.lobby.colorLocks[c];
    }
  }catch(_e){}
}

function lobbySnapshot(room){
  ensureLobby(room);
  lobbyCleanup(room);
  return {
    reservations: room.lobby.reservations,
    colorLocks: room.lobby.colorLocks,
    ts: nowMs()
  };
}

function reserveLobby(room, nameKey, color, status){
  ensureLobby(room);
  lobbyCleanup(room);
  const nk = String(nameKey||"").trim();
  if(!nk) return { ok:false, error:"NO_NAME" };
  const c = ALLOWED_COLORS.includes(String(color||"").toLowerCase()) ? String(color).toLowerCase() : null;
  const st = (status === "in_game") ? "in_game" : "lobby";

  // enforce unique color lock (if requested)
  if(c){
    const currentHolder = room.lobby.colorLocks[c];
    if(currentHolder && currentHolder !== nk){
      // If current holder is stale (not reserved anymore), allow
      if(!room.lobby.reservations[currentHolder]){
        delete room.lobby.colorLocks[c];
      } else {
        return { ok:false, error:"COLOR_TAKEN", holder: currentHolder };
      }
    }
  }

  // update reservation
  const prev = room.lobby.reservations[nk] || null;
  // if changing color, release previous lock
  if(prev && prev.color && prev.color !== c){
    const pc = String(prev.color).toLowerCase();
    if(room.lobby.colorLocks[pc] === nk) delete room.lobby.colorLocks[pc];
  }

  room.lobby.reservations[nk] = { ts: nowMs(), color: c, status: st };
  if(c) room.lobby.colorLocks[c] = nk;
  return { ok:true };
}

// ---------- Match Stats safety guard ----------
// Some deployed versions call ensureMatchStats() during initGameState.
// If stats are not enabled in this build, we keep a safe no-op to avoid crashes.
function ensureMatchStats(_room){ /* no-op unless stats module is present */ }

// ---------- Save / Restore (best-effort) ----------
// NOTE: On some hosts (z.B. Render free) kann das Dateisystem nach Restart leer sein.
// Daher zusätzlich "Export/Import" über WebSocket (Host kann JSON herunterladen/hochladen).
const SAVE_DIR = process.env.SAVE_DIR || path.join(process.cwd(), "saves");
try { fs.mkdirSync(SAVE_DIR, { recursive: true }); } catch (_e) {}

function savePathForRoom(code){
  const safe = String(code||"").toUpperCase().replace(/[^A-Z0-9_-]/g,"").slice(0,20) || "ROOM";
  return path.join(SAVE_DIR, safe + ".json");
}

async function persistRoomState(room){
  // Disk persistence (kept as fallback)
  try{
    if(!room || !room.code || !room.state) return;

    // Revision counter (monotonic, used for stale snapshot protection)
    if (typeof room.state.rev !== "number") room.state.rev = 0;
    room.state.rev += 1;

    const file = savePathForRoom(room.code);
    const payload = { code: room.code, ts: Date.now(), state: room.state };
    fs.writeFileSync(file, JSON.stringify(payload));
  }catch(_e){}

  // Firestore persistence (durable)
  try{
    initFirebaseIfConfigured();
    if(!firestore || !room?.code || !room?.state) return;
    const docId = docIdForRoom(room.code);
    const now = Date.now();
    await firestore.collection(FIREBASE_COLLECTION).doc(docId).set({
      code: room.code,
      ts: now,
      rev: room.state.rev,
      state: room.state,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }catch(e){
    // We do NOT throw: game continues. Disk fallback still exists.
    console.warn("[firebase] persist failed:", e?.message || e);
  }
}

async function restoreRoomState(room){
  // Prefer Firestore when enabled; otherwise disk.
  try{
    initFirebaseIfConfigured();
    if (firestore && room?.code) {
      const docId = docIdForRoom(room.code);
      const snap = await firestore.collection(FIREBASE_COLLECTION).doc(docId).get();
      const data = snap.exists ? snap.data() : null;
      if (data?.state && typeof data.state === "object") {
        room.state = data.state;
        // Backward-compat + safety defaults
        if (!room.state.carryingByColor || typeof room.state.carryingByColor !== "object") {
          room.state.carryingByColor = { red: false, blue: false, green: false, yellow: false };
        } else {
          // Backward-compat: fehlende Farben auffüllen
          for (const c of ALLOWED_COLORS) {
            if (typeof room.state.carryingByColor[c] !== "boolean") room.state.carryingByColor[c] = false;
          }
        }
        if (!Array.isArray(room.state.activeColors)) room.state.activeColors = [];
        if (!room.state.jokerAwardMode) room.state.jokerAwardMode = "thrower";
        room.jokerAwardMode = room.state.jokerAwardMode;
        room.carryingByColor = room.state.carryingByColor;

        // Action-Mode Joker backward-compat / defaults
        try{
          if (String(room.state.mode || "classic") === "action" && room.state.action) {
            ensureActionJokers(room.state.action);
            // If we restored an old snapshot without jokersOwned, rebuild it from counts/booleans.
            let hasOwned = room.state.action.jokersOwned && typeof room.state.action.jokersOwned === "object";
            if (!hasOwned) room.state.action.jokersOwned = { red: [], blue: [], green: [], yellow: [] };
            for (const c of ALLOWED_COLORS) {
              if (!Array.isArray(room.state.action.jokersOwned[c])) room.state.action.jokersOwned[c] = [];
            }
            // If owned arrays are empty but jokersByColor has counts, rebuild.
            const emptyAll = ALLOWED_COLORS.every(c => (room.state.action.jokersOwned[c].length === 0));
            if (emptyAll && room.state.action.jokersByColor) {
              for (const c of ALLOWED_COLORS) {
                const set = room.state.action.jokersByColor[c] || {};
                for (const t of ACTION_JOKER_TYPES) {
                  const v = set[t];
                  const n = (v===true) ? 1 : ((typeof v==="number" && isFinite(v)) ? Math.max(0, Math.floor(v)) : 0);
                  for (let i=0;i<n;i++){
                    room.state.action.jokersOwned[c].push({ type: t, color: c, source: "legacy", ts: Date.now() });
                  }
                }
              }
            }
            syncJokerCountsFromOwned(room.state.action);
          }
        }catch(_e){}
        return true;
      }
    }
  } catch (e) {
    console.warn("[firebase] restore failed, trying disk:", e?.message || e);
  }

  try{
    if(!room || !room.code) return false;
    const file = savePathForRoom(room.code);
    if(!fs.existsSync(file)) return false;
    const raw = fs.readFileSync(file, "utf8");
    const payload = JSON.parse(raw);
    if(payload && payload.state && typeof payload.state === "object"){
      room.state = payload.state;
      if (!room.state.carryingByColor || typeof room.state.carryingByColor !== "object") {
        room.state.carryingByColor = { red: false, blue: false, green: false, yellow: false };
      } else {
        for (const c of ALLOWED_COLORS) {
          if (typeof room.state.carryingByColor[c] !== "boolean") room.state.carryingByColor[c] = false;
        }
      }
      if (!Array.isArray(room.state.activeColors)) room.state.activeColors = [];
        if (!room.state.jokerAwardMode) room.state.jokerAwardMode = "thrower";
        room.jokerAwardMode = room.state.jokerAwardMode;
      room.carryingByColor = room.state.carryingByColor;

        // Action-Mode Joker backward-compat / defaults
        try{
          if (String(room.state.mode || "classic") === "action" && room.state.action) {
            ensureActionJokers(room.state.action);
            // If we restored an old snapshot without jokersOwned, rebuild it from counts/booleans.
            let hasOwned = room.state.action.jokersOwned && typeof room.state.action.jokersOwned === "object";
            if (!hasOwned) room.state.action.jokersOwned = { red: [], blue: [], green: [], yellow: [] };
            for (const c of ALLOWED_COLORS) {
              if (!Array.isArray(room.state.action.jokersOwned[c])) room.state.action.jokersOwned[c] = [];
            }
            // If owned arrays are empty but jokersByColor has counts, rebuild.
            const emptyAll = ALLOWED_COLORS.every(c => (room.state.action.jokersOwned[c].length === 0));
            if (emptyAll && room.state.action.jokersByColor) {
              for (const c of ALLOWED_COLORS) {
                const set = room.state.action.jokersByColor[c] || {};
                for (const t of ACTION_JOKER_TYPES) {
                  const v = set[t];
                  const n = (v===true) ? 1 : ((typeof v==="number" && isFinite(v)) ? Math.max(0, Math.floor(v)) : 0);
                  for (let i=0;i<n;i++){
                    room.state.action.jokersOwned[c].push({ type: t, color: c, source: "legacy", ts: Date.now() });
                  }
                }
              }
            }
            syncJokerCountsFromOwned(room.state.action);
          }
        }catch(_e){}
      return true;
    }
  }catch(_e){}
  return false;
}

async function deletePersisted(room){
  // delete disk + firestore (if configured)
  try{
    if(!room || !room.code) return;
    const file = savePathForRoom(room.code);
    if(fs.existsSync(file)) fs.unlinkSync(file);
  }catch(_e){}

  try{
    initFirebaseIfConfigured();
    if(!firestore || !room?.code) return;
    const docId = docIdForRoom(room.code);
    await firestore.collection(FIREBASE_COLLECTION).doc(docId).delete();
  }catch(e){
    console.warn("[firebase] delete failed:", e?.message || e);
  }
}

// ---------- Rooms + Clients (müssen vor /health existieren) ----------
const clients = new Map(); // clientId -> {ws, room, name, sessionToken}
const rooms = new Map();   // code -> room

const app = express();

// CORS for GitHub Pages / mobile browsers (stats/presence endpoints).
// NOTE: WebSocket is unchanged; this only affects HTTP requests.
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});
app.use(express.json({ limit: "200kb" }));
app.get("/", (_req, res) => res.status(200).send(`barikade-server ok · ${SERVER_BUILD}`));
app.get("/health", (_req, res) =>
  res.status(200).json({ ok: true, build: SERVER_BUILD, ts: Date.now(), rooms: rooms.size, clients: clients.size })
);





// --- Global Statistics (Lobby) ---
app.get("/stats", async (_req, res) => {
  try{
    initFirebaseIfConfigured();

    if(!firestore){
      return res.status(200).json({ ok:true, source:"none", rows: [] });
    }

    // Primary: composite sort (needs Firestore composite index)
    try{
      const snap = await firestore.collection(STATS_COLLECTION)
        .orderBy("wins","desc")
        .orderBy("games","desc")
        .limit(200)
        .get();

      const rows = [];
      snap.forEach(doc => {
        const d = doc.data() || {};
        const games = Number(d.games||0)||0;
        const wins = Number(d.wins||0)||0;
        const rollCount = Number(d.rollCount||0)||0;
        const rollSum = Number(d.rollSum||0)||0;
        const playMs = Number(d.playMs||0)||0;
        rows.push({
          name: String(d.name||doc.id),
          games,
          wins,
          forfeits: Number(d.forfeits||0)||0,
          avgRoll: rollCount ? (rollSum/rollCount) : 0,
          playMs,
          updatedAt: Number(d.updatedAt||0)||0,
        });
      });
      return res.status(200).json({ ok:true, source:"firestore", rows });
    }catch(e){
      // Fallback: if composite index missing, return a simpler ordering instead of failing.
      const msg = String(e?.message||e||"");
      const needsIndex = msg.includes("requires an index") || msg.includes("FAILED_PRECONDITION");
      if(!needsIndex) throw e;

      const snap = await firestore.collection(STATS_COLLECTION)
        .orderBy("wins","desc")
        .limit(200)
        .get();

      const rows = [];
      snap.forEach(doc => {
        const d = doc.data() || {};
        const games = Number(d.games||0)||0;
        const wins = Number(d.wins||0)||0;
        const rollCount = Number(d.rollCount||0)||0;
        const rollSum = Number(d.rollSum||0)||0;
        const playMs = Number(d.playMs||0)||0;
        rows.push({
          name: String(d.name||doc.id),
          games,
          wins,
          forfeits: Number(d.forfeits||0)||0,
          avgRoll: rollCount ? (rollSum/rollCount) : 0,
          playMs,
          updatedAt: Number(d.updatedAt||0)||0,
        });
      });
      return res.status(200).json({ ok:true, source:"firestore_fallback", rows, warning:"INDEX_MISSING" });
    }
  }catch(e){
    return res.status(500).json({ ok:false, error:"STATS_ERR", message: e?.message||String(e) });
  }
});

// --- Room presence (Lobby) ---
// Returns current players list for a room (no join, read-only).
app.get("/room/:code", (req, res) => {
  try {
    const code = String(req.params.code || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 20);
    if (!code) return res.status(400).json({ ok: false, error: "NO_CODE" });
    const room = rooms.get(code);
    if (!room) return res.status(404).json({ ok: false, error: "NO_ROOM" });
    return res.status(200).json({ ok: true, ...roomUpdatePayload(room) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "ERR" });
  }
});

// Ensures the room exists (host can create the room before anyone opens the game).
app.post("/room/:code/ensure", (req, res) => {
  try {
    const code = String(req.params.code || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 20);
    if (!code) return res.status(400).json({ ok: false, error: "NO_CODE" });
    let room = rooms.get(code);
    if (!room) {
      room = makeRoom(code);
      rooms.set(code, room);
    }
    return res.status(200).json({ ok: true, code, rooms: rooms.size });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "ERR" });
  }
});

// --- Lobby presence/reservations (pre-join) ---
// Lets the lobby show: who clicked a name (ready) and which colors are locked.
app.get("/room/:code/presence", (req, res) => {
  try{
    const code = normalizeRoomCode(req.params.code);
    if(!code) return res.status(400).json({ ok:false, error:"NO_CODE" });
    const room = rooms.get(code);
    if(!room) return res.status(404).json({ ok:false, error:"NO_ROOM" });
    return res.status(200).json({ ok:true, code, ...lobbySnapshot(room), players: currentPlayersList(room) });
  }catch(_e){
    return res.status(500).json({ ok:false, error:"ERR" });
  }
});

app.post("/room/:code/reserve", (req, res) => {
  try{
    const code = normalizeRoomCode(req.params.code);
    if(!code) return res.status(400).json({ ok:false, error:"NO_CODE" });
    const room = rooms.get(code);
    if(!room) return res.status(404).json({ ok:false, error:"NO_ROOM" });

    const nameKey = String(req.body?.nameKey || req.body?.name || "").trim();
    const color = String(req.body?.color || "").toLowerCase().trim();
    const status = String(req.body?.status || "lobby").trim();

    const r = reserveLobby(room, nameKey, color, status);
    if(!r.ok) return res.status(409).json({ ok:false, ...r });

    return res.status(200).json({ ok:true, code, ...lobbySnapshot(room) });
  }catch(_e){
    return res.status(500).json({ ok:false, error:"ERR" });
  }
});


const server = http.createServer(app);
const wss = new WebSocketServer({ server });

/** ---------- Board graph (server authoritative path + legality) ---------- **/
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



// ---------- Distances to goal (for forfeit winner calculation) ----------
function computeDistancesFrom(startId){
  if(!startId) return new Map();
  const dist = new Map();
  const q = [startId];
  dist.set(startId, 0);
  for(let qi=0; qi<q.length; qi++){
    const u = q[qi];
    const du = dist.get(u);
    const ns = ADJ.get(u);
    if(!ns) continue;
    for(const v of ns){
      if(!dist.has(v)){
        dist.set(v, du+1);
        q.push(v);
      }
    }
  }
  return dist;
}
const DIST_TO_GOAL = computeDistancesFrom(GOAL);
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

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(2, 8);
}

/** ---------- Rooms ---------- **/
function makeRoom(code) {
  return {
    code,
    isTest: false, // host-toggleable test mode (excluded from stats)
    lobby: { reservations: {}, colorLocks: {} },
    hostToken: null, // stable host identity (sessionToken)
    // Socket index for this room (used for host-swap/reconnect messaging)
    clients: new Map(), // clientId -> ws
    players: new Map(), // clientId -> {id,name,color,isHost,sessionToken,lastSeen}
    state: null,
    jokerAwardMode: "thrower",
    jokerStartCount: null,
    lastRollWasSix: false,
    // Backward-compat field. Source of truth is room.state.carryingByColor
    // because only room.state is persisted to disk/Firebase.
    carryingByColor: { red: false, blue: false, green: false, yellow: false },
    // Reaktionen/Smilies: nur Laufzeitdaten, kein Einfluss auf den Spielstand.
    emojiCooldowns: new Map(),
    emojiSeq: 0,
  };
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function isConnectedPlayer(p) {
  const c = clients.get(p.id);
  return !!(c?.ws && c.ws.readyState === 1);
}

function currentPlayersList(room) {
  return Array.from(room.players.values()).map(p => ({
    id: p.id,
    name: p.name,
    color: p.color || null,
    isHost: !!p.isHost,
    connected: isConnectedPlayer(p),
    lastSeen: p.lastSeen || null
  }));
}

function canStart(room) {
  const coloredConnected = Array.from(room.players.values()).filter(p => p.color && isConnectedPlayer(p));
  return coloredConnected.length >= 2;
}

// Reconnect-Sicherheit:
// - Sobald weniger als 2 farbige Spieler verbunden sind, pausieren wir IMMER.
// - Entpausen passiert NUR explizit per Host-Button (msg.type === "resume").
function enforcePauseIfNotReady(room){
  try{
    if(!room?.state) return;
    const ready = canStart(room);
    if(!ready) room.state.paused = true;
  }catch(_e){}
}

// Legacy helper (auto-unpause ist absichtlich deaktiviert)
function resumeIfReady(room) {
  enforcePauseIfNotReady(room);
}


function broadcast(room, obj) {
  const msg = JSON.stringify(obj);

  // Hotfix: broadcast to currently connected sockets in this room.
  // This prevents missing real-time updates when player records are stale
  // (e.g. refresh/reconnect) but the websocket is already connected.
  const map = room?.clients;
  if (map && map instanceof Map) {
    for (const ws of map.values()) {
      if (ws?.readyState === 1) {
        try { ws.send(msg); } catch (_e) {}
      }
    }
    return;
  }

  // Fallback: older behavior
  for (const p of room.players.values()) {
    const c = clients.get(p.id);
    if (c?.ws?.readyState === 1) {
      try { c.ws.send(msg); } catch (_e) {}
    }
  }
}


function send(ws, obj) {
  try { ws.send(JSON.stringify(obj)); } catch (_e) {}
}

// Defensive helper: accepts possibly-undefined ws and never throws.
// (We saw crashes when a reconnect/host-swap tried to message a socket
// that was already gone.)
function safeSend(ws, obj) {
  if (!ws || ws.readyState !== 1) return;
  try { ws.send(JSON.stringify(obj)); } catch (_e) {}
}


// ---------- Emoji / Smiley realtime broadcast ----------
// Wichtig: Fuer Reaktionen verlassen wir uns NICHT nur auf room.players/room.clients.
// Reconnects koennen diese Indizes kurzzeitig auseinanderlaufen. Deshalb wird ueber
// den globalen Client-Index an JEDEN aktuell verbundenen Socket desselben Raums gesendet.
function normalizeEmojiKey(value) {
  const v = String(value || "").trim();
  const low = v.toLowerCase();
  if (v === "😂" || low === "laugh") return "laugh";
  if (v === "😡" || low === "angry") return "angry";
  if (v === "😎" || low === "cool") return "cool";
  return "";
}

function emojiGlyph(key) {
  if (key === "laugh") return "😂";
  if (key === "angry") return "😡";
  if (key === "cool") return "😎";
  return "";
}

function broadcastEmojiToRoom(roomCode, payload) {
  const code = String(roomCode || "").trim().toUpperCase();
  if (!code) return 0;
  const raw = JSON.stringify(payload);
  let sent = 0;
  for (const c of clients.values()) {
    if (String(c?.room || "").trim().toUpperCase() !== code) continue;
    if (c?.ws?.readyState !== 1) continue;
    try {
      c.ws.send(raw);
      sent++;
    } catch (_e) {}
  }
  return sent;
}

function assignColorsRandom(room) {
  // remove offline placeholders on reset
  for (const p of Array.from(room.players.values())) {
    if (!isConnectedPlayer(p)) room.players.delete(p.id);
  }
  const connected = Array.from(room.players.values()).filter(p => isConnectedPlayer(p));
  for (const p of connected) p.color = null;
  if (connected.length === 0) return;
  if (connected.length > ALLOWED_COLORS.length) connected.length = ALLOWED_COLORS.length;

  // Zufällig verteilen, aber eindeutig
  shuffleInPlace(connected);
  const colors = [...ALLOWED_COLORS];
  shuffleInPlace(colors);
  for (let i = 0; i < connected.length; i++) {
    connected[i].color = colors[i];
  }
}

/** ---------- Game state ---------- **/
function initGameState(room, activeColors, mode = "classic", starterColor = null, jokerStartCount = null) {
  // Normalize activeColors (colors that are actually participating in turn order).
  activeColors = Array.isArray(activeColors) && activeColors.length
    ? activeColors.map(c => String(c).toLowerCase())
    : null;

  if (!activeColors) {
    const fromState = room?.state?.activeColors;
    if (Array.isArray(fromState) && fromState.length) {
      activeColors = fromState.map(c => String(c).toLowerCase());
    }
  }

  if (!activeColors) {
    // Fallback: connected players with a chosen color, in stable order.
    const order = ["red","blue","green","yellow"];
    activeColors = order.filter(col => room.players && [...room.players.values()].some(p => p && p.color === col));
    if (!activeColors.length) activeColors = ["red","blue"]; // last-resort fallback
  }

  // pieces 5 per color in house
  // WICHTIG: Für 2–4 Spieler müssen alle 4 Farben echte Pieces im Server-State haben,
  // sonst kann z.B. Grün zwar würfeln, aber keine Figur auswählen/bewegen.
  const pieces = [];
  for (const color of ALLOWED_COLORS) {
    const houses = (BOARD.nodes || [])
      .filter(n => n.kind === "house" && String(n.flags?.houseColor || "").toLowerCase() === color)
      .sort((a, b) => (a.flags?.houseSlot ?? 0) - (b.flags?.houseSlot ?? 0));

    for (let i = 0; i < 5; i++) {
      pieces.push({
        id: `p_${color}_${i + 1}`,
        label: i + 1,
        color,
        posKind: "house",
        houseId: houses[i]?.id || houses[0]?.id || null,
        nodeId: null,
      });
    }
  }

  // barricades: all run nodes
  const barricades = (BOARD.nodes || [])
    .filter(n => n.kind === "board" && n.flags?.run)
    .map(n => n.id);

  // activeColors = die Farben, die beim Spielstart tatsächlich mitspielen
  // (2–4). Falls nicht angegeben, aus den verbundenen Spielern ableiten.
  const act = Array.isArray(activeColors) && activeColors.length
    ? activeColors.filter(c => ALLOWED_COLORS.includes(c))
    : ALLOWED_COLORS.filter(c => Array.from(room.players.values()).some(p => isConnectedPlayer(p) && p.color === c));

  // Fallback: mindestens 2 Farben erzwingen (damit Turn-Cycle nicht kaputt geht)
  const active = (act.length >= 2) ? act : ALLOWED_COLORS.slice(0, 2);

  // choose starter
  const sc = String(starterColor || "").toLowerCase().trim();
  const turnColor = (sc && active.includes(sc)) ? sc : (active[0] || "red");

  room.lastRollWasSix = false;
  // IMPORTANT: carrying must survive restart -> store in room.state (persisted)
  const carryingByColor = { red: false, blue: false, green: false, yellow: false };
  room.carryingByColor = carryingByColor; // backward-compat alias

  // ===== Mode / Action-Mode Jokers (server is chef) =====
  const gameMode = (String(mode || "classic").toLowerCase() === "action") ? "action" : "classic";
  const baseJokerCount = Math.max(1, Math.min(5, Number(jokerStartCount ?? room?.jokerStartCount ?? 1) || 1));

  // Action state lives fully on the server (persisted in room.state).
  // Client UI only reads this snapshot.
  const action = (gameMode === "action") ? {
    // Earned/base jokers live here (with origin color for display)
    jokersOwned: {
      red:    ACTION_JOKER_TYPES.flatMap(t => Array.from({ length: baseJokerCount }, () => ({ type: t, color: "red",    source: "base", ts: Date.now() }))),
      blue:   ACTION_JOKER_TYPES.flatMap(t => Array.from({ length: baseJokerCount }, () => ({ type: t, color: "blue",   source: "base", ts: Date.now() }))),
      green:  ACTION_JOKER_TYPES.flatMap(t => Array.from({ length: baseJokerCount }, () => ({ type: t, color: "green",  source: "base", ts: Date.now() }))),
      yellow: ACTION_JOKER_TYPES.flatMap(t => Array.from({ length: baseJokerCount }, () => ({ type: t, color: "yellow", source: "base", ts: Date.now() }))),
    },
    // Backward compat snapshot for UI (counts)
    jokersByColor: {
      red:      { choose: baseJokerCount, sum: baseJokerCount, allColors: baseJokerCount, barricade: baseJokerCount, reroll: baseJokerCount, double: baseJokerCount },
      blue:     { choose: baseJokerCount, sum: baseJokerCount, allColors: baseJokerCount, barricade: baseJokerCount, reroll: baseJokerCount, double: baseJokerCount },
      green:    { choose: baseJokerCount, sum: baseJokerCount, allColors: baseJokerCount, barricade: baseJokerCount, reroll: baseJokerCount, double: baseJokerCount },
      yellow:   { choose: baseJokerCount, sum: baseJokerCount, allColors: baseJokerCount, barricade: baseJokerCount, reroll: baseJokerCount, double: baseJokerCount },
    },
    // Active effects for the CURRENT turn only (cleared on end_turn)
    effects: {
      allColorsBy: null,   // color that may move any piece this turn
      barricadeBy: null,   // color that may move one barricade this turn
      doubleRoll: null,    // {kind:"choose"|"sum", by:"red", rolls:[..], chosen?:n }
    },
    // version for future-proofing
    v: 2,
  } : null;

  room.state = {
    started: true,
    isTest: (room.isTest === true) || isTestRoomCode(room.code),
    
    matchId: uid(),
    startedAt: Date.now(),
    statsFinalized: false,
paused: false,
    finished: false,
    winnerColor: null,
    finishedAt: null,
    mode: gameMode,
    jokerStartCount: baseJokerCount,
    jokerAwardMode: (room.state && room.state.jokerAwardMode) ? room.state.jokerAwardMode : (room.jokerAwardMode || "thrower"),
    action,
    turnColor,
    phase: "need_roll", // need_roll | need_move | place_barricade
    rolled: null,
    pieces,
    barricades,
    goal: GOAL,
    carryingByColor,
    activeColors: active,

    // ---- Per-match tracking (for end-of-game title ceremony) ----
    matchTrack: (function(){
      const perPlayer = {};
      (room.players || []).forEach(p=>{
        // room.players is a Map; values contain {name,...}. nameKey is not guaranteed.
        const nk = String(p?.name || p?.nameKey || "").trim();
        if(!nk) return;
        perPlayer[nk] = { kills:0, deaths:0, six:0, one:0, distance:0, turnSumMs:0, turnCount:0 };
      });
      return { perPlayer, turnStartedAt: Date.now() };
    })(),
  };
}

function detectWinnerColor(room) {
  const goalId = room?.state?.goal || GOAL;
  if (!goalId) return null;
  const pcs = room?.state?.pieces;
  if (!Array.isArray(pcs)) return null;
  for (const p of pcs) {
    if (p && p.posKind === "board" && p.nodeId === goalId) return p.color || null;
  }
  return null;
}

function setGameOver(room, winnerColor) {
  if (!room || !room.state) return;
  if (room.state.finished) return;
  room.state.finished = true;
  room.state.winnerColor = String(winnerColor || "").toLowerCase() || null;
  room.state.finishedAt = Date.now();
  room.state.phase = "game_over";
  try{
    room.state.matchAwards = computeMatchAwards(room);
  }catch(_e){ room.state.matchAwards = []; }
}

function nextTurnColor(room, current) {
  const act = Array.isArray(room.state?.activeColors) && room.state.activeColors.length
    ? room.state.activeColors
    : ALLOWED_COLORS;
  const i = act.indexOf(current);
  if (i < 0) return act[0] || "red";
  return act[(i + 1) % act.length];
}
function getPiece(room, pieceId) {
  return room.state?.pieces?.find(p => p.id === pieceId) || null;
}

function occupiedByColor(room, color, excludePieceId = null) {
  const set = new Set();
  for (const p of room.state.pieces) {
    if (p.color !== color) continue;
    if (excludePieceId && p.id === excludePieceId) continue;
    if (p.posKind === "board" && p.nodeId) set.add(p.nodeId);
  }
  return set;
}

function occupiedAny(room) {
  const set = new Set();
  for (const p of room.state.pieces) {
    if (p.posKind === "board" && p.nodeId) set.add(p.nodeId);
  }
  return set;
}

function nextFreeHouseId(room, color) {
  const homes = HOUSE_BY_COLOR[color] || [];
  if (!homes.length) return null;

  const used = new Set();
  for (const p of room.state.pieces) {
    if (p.color === color && p.posKind === "house" && p.houseId) used.add(p.houseId);
  }
  for (const hid of homes) {
    if (!used.has(hid)) return hid;
  }
  return homes[0] || null;
}

function sendPieceHome(room, piece) {
  piece.posKind = "house";
  piece.nodeId = null;
  piece.houseId = nextFreeHouseId(room, piece.color);
}

function isPlacableBarricade(room, nodeId) {
  const n = NODES.get(nodeId);
  if (!n || n.kind !== "board") return false;

  // goal tabu
  if (n.flags?.goal) return false;

  // not on existing barricade / pieces
  if (room.state.barricades.includes(nodeId)) return false;
  if (occupiedAny(room).has(nodeId)) return false;

  return true;
}

/** ---------- Path + legality (exact steps, no immediate backtrack, no revisits) ---------- **/
function computeAllTargets(room, startNodeId, steps, color, pieceId) {
  const blockedEnd = occupiedByColor(room, color, pieceId); // cannot END on own piece
  const barricades = new Set(room.state.barricades || []);
  const targets = new Map(); // nodeId -> path array

  function dfs(node, depth, prevNode, visited, pathArr) {
    if (depth === steps) {
      if (!blockedEnd.has(node)) {
        if (!targets.has(node)) targets.set(node, [...pathArr]);
      }
      return;
    }
    const neigh = ADJ.get(node);
    if (!neigh) return;

    for (const nx of neigh) {
      if (prevNode && nx === prevNode) continue; // no immediate backtrack
      if (visited.has(nx)) continue;             // no revisits

      // barricade cannot be passed through; only land
      if (barricades.has(nx) && (depth + 1) < steps) continue;

      // end can't be own piece
      if ((depth + 1) === steps && blockedEnd.has(nx)) continue;

      visited.add(nx);
      pathArr.push(nx);
      dfs(nx, depth + 1, node, visited, pathArr);
      pathArr.pop();
      visited.delete(nx);
    }
  }

  const visited = new Set([startNodeId]);
  dfs(startNodeId, 0, null, visited, [startNodeId]);
  return targets;
}

function pathForTarget(room, piece, targetId) {
  const color = piece.color;
  const roll = room.state.rolled;
  // Doppelwurf kann 7–12 ergeben. Der Server setzt room.state.rolled,
  // daher ist es sicher, hier bis 12 zuzulassen.
  if (!(roll >= 1 && roll <= 12)) return { ok: false, msg: "no roll" };

  const startField = STARTS[color];
  if (!startField || !NODES.has(startField)) return { ok: false, msg: "missing start in board.meta.starts" };

  if (piece.posKind === "house") {
    const remaining = roll - 1;
    if (remaining < 0) return { ok: false, msg: "bad remaining" };

    if (remaining === 0) {
      if (targetId !== startField) return { ok: false, msg: "with roll=1 you must go to start" };
      return { ok: true, path: [startField] };
    }

    const targets = computeAllTargets(room, startField, remaining, color, piece.id);
    const p = targets.get(targetId);
    if (!p) return { ok: false, msg: "illegal target" };
    return { ok: true, path: p };
  }

  if (piece.posKind === "board") {
    const cur = piece.nodeId;
    if (!cur) return { ok: false, msg: "piece has no nodeId" };

    const targets = computeAllTargets(room, cur, roll, color, piece.id);
    const p = targets.get(targetId);
    if (!p) return { ok: false, msg: "illegal target" };
    return { ok: true, path: p };
  }

  return { ok: false, msg: "unknown piece pos" };
}

/** ---------- Protocol ---------- **/
function requireRoomState(room, ws) {
  if (!room.state) {
    send(ws, { type: "error", code: "NO_STATE", message: "Spiel nicht gestartet" });
    return false;
  }
  return true;
}

function requireTurn(room, clientId, ws) {
  const me = room.players.get(clientId);
  if (!me?.color) { send(ws, { type: "error", code: "SPECTATOR", message: "Du hast keine Farbe" }); return false; }
  if (room.state?.finished) {
    send(ws, { type: "error", code: "GAME_OVER", message: `Spiel beendet. Gewinner: ${(room.state.winnerColor || "?").toUpperCase()}` });
    return false;
  }
  if (room.state.paused) { send(ws, { type: "error", code: "PAUSED", message: "Spiel pausiert" }); return false; }
  if (room.state.turnColor !== me.color) {
    send(ws, { type: "error", code: "NOT_YOUR_TURN", message: `Nicht dran. Dran: ${room.state.turnColor.toUpperCase()}` });
    return false;
  }
  return true;
}

/** ---------- WebSocket ---------- **/
wss.on("connection", (ws) => {
  const clientId = uid();
  clients.set(clientId, { ws, room: null, name: null, sessionToken: null });
  send(ws, { type: "hello", clientId });

  ws.on("message", async (buf) => {
    let msg;
    try { msg = JSON.parse(String(buf)); } catch (_e) { return; }
    const c = clients.get(clientId);
    if (!c) return;

    if (msg.type === "ping") { send(ws, { type: "pong" }); return; }

    // ---------- JOIN ----------
    if (msg.type === "join") {
      const roomCode = String(msg.room || "").trim().toUpperCase();
      const name = String(msg.name || "Spieler").slice(0, 32);
      const asHost = !!msg.asHost;
      const sessionToken = String(msg.sessionToken || "").slice(0, 60);
      const requestedColor = String(msg.requestedColor || "").toLowerCase().trim();

      if (!roomCode) { send(ws, { type: "error", code: "NO_ROOM", message: "Kein Raumcode" }); return; }

      // leave old room
      if (c.room) {
        const old = rooms.get(c.room);
        if (old) {
          old.players.delete(clientId);
          broadcast(old, roomUpdatePayload(old));
        }
      }

      // get/create room
      let room = rooms.get(roomCode);
      if (!room) { room = makeRoom(roomCode); rooms.set(roomCode, room); }
      // hotfix: ensure per-room ws map exists (prevents crashes after restore)
      if (!room.clients || !(room.clients instanceof Map)) room.clients = new Map();

      // If server restarted / room.state missing, try to restore from disk (best-effort)
      if (!room.state) {
        const restored = await restoreRoomState(room);
        if (restored) {
          console.log(`[restore] room=${roomCode} restored state (firebase/disk)`);
        }
      }

      // reconnect via sessionToken
      let existing = null;
      if (sessionToken) {
        for (const p of room.players.values()) {
          if (p.sessionToken && p.sessionToken === sessionToken) { existing = p; break; }
        }
      }
      if (existing) {
        // Prevent a NEW client from kicking a currently-connected player that uses the same sessionToken.
        // If the old one is truly disconnected, reconnect still works (old ws not in room.clients).
        const existingWs = (room.clients && room.clients.get) ? room.clients.get(existing.id) : null;
        if (existingWs && existingWs.readyState === 1 && existing.id !== clientId) {
          safeSend(ws, { t: "error", code: "DUPLICATE_SESSION", message: "Diese Sitzung ist bereits verbunden (Session bereits aktiv)." });
          try { ws.close(4000, "DUPLICATE_SESSION"); } catch (_) {}
          return;
        }
        room.players.delete(existing.id);
      }
      const existingColor = existing?.color || null;

      
// host assignment (stable, server-chef):
// - host is bound to room.hostToken (sessionToken)
// - prevents race condition when BOTH players reconnect
let isHost = false;

// Establish hostToken once (first host join with sessionToken)
if (!room.hostToken) {
  if (existing?.isHost && existing?.sessionToken) {
    room.hostToken = existing.sessionToken;
  } else if (asHost && sessionToken) {
    room.hostToken = sessionToken;
  }
}

// Determine host strictly by token
if (room.hostToken && sessionToken && sessionToken === room.hostToken) {
  isHost = true;
}

// Ensure single-host: if true host joins, clear host flag on all others
if (isHost) {
  for (const p of room.players.values()) p.isHost = false;
}

// color assignment
// IMPORTANT CHANGE (requested):
// - KEINE automatische Farbe mehr beim Join.
// - Jeder (auch Host) waehlt seine Farbe aktiv in der Lobby.
// - Reconnect via sessionToken behaelt die vorherige Farbe.
// - Wunschfarbe kann beim Join mitgeschickt werden (requestedColor) und wird nur gesetzt,
//   wenn der Slot frei ist.
//
// NOTE: Das Board/Game-Logic in diesem Server arbeitet aktuell mit 2 Farben (red/blue).
//       Weitere Farben koennen spaeter additiv freigeschaltet werden.
//       (ALLOWED_COLORS ist global definiert.)

// If reconnecting via sessionToken, keep the exact previous color
let color = existing?.color || null;

// remove offline placeholders that hold a color, so slots become available
for (const p of Array.from(room.players.values())) {
  if (p.color && !isConnectedPlayer(p)) {
    room.players.delete(p.id);
  }
}

// Max 4 gleichzeitig verbundene Spieler pro Raum
{
  const connectedCount = Array.from(room.players.values()).filter(p => isConnectedPlayer(p)).length;
  if (!existing && connectedCount >= ALLOWED_COLORS.length) {
    send(clientId, { type: "error", code: "ROOM_FULL", message: `Raum ist voll (max ${ALLOWED_COLORS.length} Spieler).` });
    return;
  }
}

// If not reconnecting, honor requestedColor ONLY if free
if (!color) {
  const usedNow = new Set(Array.from(room.players.values()).map(p => p.color).filter(Boolean));
  const want = ALLOWED_COLORS.includes(requestedColor) ? requestedColor : null;
  if (want && !usedNow.has(want)) {
    color = want;
  } else {
    // stay spectator until player actively chooses
    color = null;
  }
}

room.players.set(clientId, { id: clientId, name, color, isHost, sessionToken, lastSeen: Date.now() });
	      // Auto-unpause deaktiviert: Fortsetzen nur per Host (resume)
	      c.room = roomCode; c.name = name; c.sessionToken = sessionToken;
	      // keep per-room socket map in sync (host-swap/reconnect depends on it)
	      room.clients.set(clientId, ws);

// Lobby presence: mark name as in_game and lock chosen color (if any)
try{
  ensureLobby(room);
  const nk = typeof normalizeNameKey === "function" ? (normalizeNameKey(name) || name) : name;
  // only lock canonical names + Gast if provided
  reserveLobby(room, nk, color, "in_game");
}catch(_e){}


      // Reconnect-Sicherheit: Wenn noch nicht wieder 2 Spieler verbunden sind,
      // pausieren wir den Raum sofort (auch nach Server-Restart/Restore).
      if (room.state) {
        enforcePauseIfNotReady(room);
        await persistRoomState(room);
      }

      console.log(`[join] room=${roomCode} name=${name} host=${isHost} color=${color} existing=${!!existing}`);

      send(ws, roomUpdatePayload(room));
      broadcast(room, roomUpdatePayload(room));


      if (room.state) send(ws, { type: "snapshot", state: room.state });
      return;
    }

    // ---------- ALL OTHER MESSAGES NEED ROOM ----------
    const roomCode = c.room;
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (!room) return;
    // hotfix: ensure per-room ws map exists (prevents crashes)
    if (!room.clients || !(room.clients instanceof Map)) room.clients = new Map();
    if (!room.emojiCooldowns || !(room.emojiCooldowns instanceof Map)) room.emojiCooldowns = new Map();

    // ---------- EMOJI / SMILEY ----------
    // Client sendet: {type:"emoji_send", emoji:"laugh|angry|cool", reactionId?:"..."}
    // Server verteilt das Event bewusst an ALLE aktuell verbundenen Clients im Raum.
    if (msg.type === "emoji_send" || msg.type === "smiley_send") {
      const me = room.players.get(clientId);
      if (!me) {
        send(ws, { type:"error", code:"NO_PLAYER", message:"Spieler nicht gefunden" });
        return;
      }
      if (!room.state || !room.state.started || room.state.finished) {
        send(ws, { type:"error", code:"NO_STATE", message:"Spiel laeuft nicht" });
        return;
      }

      const key = normalizeEmojiKey(msg.emoji ?? msg.smiley ?? msg.icon);
      if (!key) {
        send(ws, { type:"error", code:"BAD_EMOJI", message:"Ungueltiges Emoji" });
        return;
      }

      const now = Date.now();
      const cooldownKey = String(me.sessionToken || clientId);
      const last = Number(room.emojiCooldowns.get(cooldownKey) || 0);
      if ((now - last) < 1200) return;
      room.emojiCooldowns.set(cooldownKey, now);
      room.emojiSeq = Number(room.emojiSeq || 0) + 1;

      const requestedId = String(msg.reactionId || msg.eventId || "")
        .replace(/[^A-Za-z0-9_.:-]/g, "")
        .slice(0, 96);
      const eventId = requestedId || `emoji:${room.code}:${now}:${room.emojiSeq}`;

      const payload = {
        type: "emoji_event",
        eventId,
        reactionId: eventId,
        playerId: clientId,
        senderId: clientId,
        name: me.name || c.name || "Spieler",
        playerName: me.name || c.name || "Spieler",
        emoji: key,
        emojiKey: key,
        icon: emojiGlyph(key),
        ts: now
      };

      const delivered = broadcastEmojiToRoom(room.code, payload);
      // Sender bekommt eine Diagnose nur dann, wenn unerwartet niemand erreichbar war.
      if (delivered === 0) {
        send(ws, { type:"error", code:"EMOJI_NOT_DELIVERED", message:"Emoji konnte an keinen Client verteilt werden" });
      }
      return;
    }

    if (msg.type === "leave") {
      room.players.delete(clientId);
      c.room = null;
      send(ws, roomUpdatePayload(room, []));
      broadcast(room, roomUpdatePayload(room));
      return;
    }


    // ---------- CLAIM COLOR (DEPRECATED) ----------
    // Früher konnte der Host Slots anderen Spielern zuweisen.
    // Neuer Standard (dein Wunsch): Jeder wählt seine Farbe selbst in der Lobby.
    // Wir lassen den Message-Typ existieren, damit alte Clients nicht crashen,
    // aber wir blocken die Aktion mit einer klaren Fehlermeldung.
    if (msg.type === "claim_color") {
      send(ws, {
        type: "error",
        code: "DEPRECATED",
        message: "Slot-Zuweisung durch Host ist deaktiviert. Jeder Spieler wählt seine Farbe selbst (Lobby).",
      });
      return;
    }

    // ---------- REQUEST COLOR (Self, lobby only) ----------
    // Additive feature: player can request a preferred color BEFORE the game starts.
    // Does NOT remove/replace any existing logic (reconnect, pause/resume, save/restore stay unchanged).
    if (msg.type === "request_color") {
      // only in lobby (no running state yet)
      if (room.state) {
        send(ws, { type: "error", code: "GAME_STARTED", message: "Farbe nur vor Spielstart wählbar" });
        return;
      }

      const me = room.players.get(clientId);
      if (!me || !isConnectedPlayer(me)) {
        send(ws, { type: "error", code: "BAD_PLAYER", message: "Spieler nicht verbunden" });
        return;
      }

      const targetColor = String(msg.color || msg.targetColor || "").toLowerCase().trim();
      if (!ALLOWED_COLORS.includes(targetColor)) {
        send(ws, { type: "error", code: "BAD_COLOR", message: "Ungültige Farbe" });
        return;
      }

      // If I'm already that color -> ok
      if (me.color === targetColor) {
        send(ws, roomUpdatePayload(room));
        return;
      }

      // Check if slot is held
      let holderId = null;
      for (const p of room.players.values()) {
        if (p.color === targetColor) { holderId = p.id; break; }
      }
      if (holderId) {
        const holder = room.players.get(holderId);
        // connected holder blocks
        if (holder && isConnectedPlayer(holder)) {
          send(ws, { type: "error", code: "SLOT_IN_USE", message: "Slot ist gerade belegt" });
          return;
        }
        // offline placeholder -> remove
        if (holder && !isConnectedPlayer(holder)) room.players.delete(holderId);
      }

      // assign
      me.color = targetColor;

      

// Also lock the color in lobby reservations so other devices see it immediately.
try{
  reserveLobby(room, typeof normalizeNameKey === "function" ? (normalizeNameKey(me.name) || me.name) : me.name, targetColor, "lobby");
}catch(_e){}
broadcast(room, roomUpdatePayload(room));
      await persistRoomState(room);
      return;
    }

    
    
    // ---------- TEST MODE (Host, lobby only) ----------
    // Additive: lets the host flag a room as "test" so roll/game stats are NOT recorded.
    // Safe: does not change gameplay; only affects Firestore stats writes.
    if (msg.type === "set_test_mode") {
      const me = room.players.get(clientId);
      if (!me?.isHost) { send(ws, { type: "error", code: "NOT_HOST", message: "Nur Host" }); return; }
      if (room.state) { send(ws, { type: "error", code: "GAME_STARTED", message: "Testmodus nur vor Spielstart" }); return; }
      room.isTest = !!(msg.isTest ?? msg.value ?? msg.enabled);
      broadcast(room, { type: "test_mode", isTest: room.isTest, prefixes: TEST_ROOM_PREFIXES });
      broadcast(room, roomUpdatePayload(room));
      return;
    }


    if (msg.type === "set_joker_start_count") {
      const me = room.players.get(clientId);
      if (!me?.isHost) { send(ws, { type: "error", code: "NOT_HOST", message: "Nur Host kann die Joker-Anzahl ändern" }); return; }
      if (room.state) { send(ws, { type: "error", code: "GAME_STARTED", message: "Joker-Anzahl nur vor Spielstart" }); return; }

      const count = Number(msg.count);
      if (!Number.isInteger(count) || count < 1 || count > 5) {
        send(ws, { type: "error", code: "BAD_JOKER_COUNT", message: "Bitte 1 bis 5 Joker wählen" });
        return;
      }

      room.jokerStartCount = count;
      broadcast(room, roomUpdatePayload(room));
      return;
    }

// ---------- JOKER AWARD MODE ----------
    if (msg.type === "set_award_mode") {
      const me = room.players.get(clientId);
      if (!me?.isHost) { send(ws, { type: "error", code: "NOT_HOST", message: "Nur Host kann den Modus ändern" }); return; }

      const mode = (msg.mode === "victim") ? "victim" : "thrower";
      room.jokerAwardMode = mode;
      if (room.state) room.state.jokerAwardMode = mode;

      broadcast(room, roomUpdatePayload(room));
      if (room.state) await persistRoomState(room);
      return;
    }

// ---------- START / RESET ----------

    if (msg.type === "start_request") {
      const me = room.players.get(clientId);
      if (!me?.isHost) { send(ws, { type: "error", code: "NOT_HOST", message: "Nur Host kann starten" }); return; }
      if (!canStart(room)) { send(ws, { type: "error", code: "NEED_2P", message: "Mindestens 2 Spieler nötig" }); return; }

      // aktive Farben anhand verbundener Spieler (mit gewählter Farbe)
      const act = Array.from(room.players.values())
        .filter(p => isConnectedPlayer(p) && ALLOWED_COLORS.includes(p.color))
        .map(p => p.color);
      const uniqueAct = ALLOWED_COLORS.filter(c => act.includes(c));
      if (uniqueAct.length < 2) {
        send(ws, { type: "error", code: "NEED_COLORS", message: "Mindestens 2 Spieler müssen eine Farbe wählen" });
        return;
      }

      // Server entscheidet zufällig die Startfarbe (Quelle der Wahrheit)
      const starterColor = uniqueAct[Math.floor(Math.random() * uniqueAct.length)];

      const jokerStartCount = Number(room.jokerStartCount);
      if (!Number.isInteger(jokerStartCount) || jokerStartCount < 1 || jokerStartCount > 5) {
        send(ws, { type: "error", code: "NEED_JOKER_COUNT", message: "Host muss zuerst die Joker-Anzahl 1 bis 5 wählen" });
        return;
      }

      // pending info (nur im RAM, kein Persist nötig)
      room._pendingStart = { starterColor, mode: "action", jokerStartCount, ts: Date.now() };

      broadcast(room, { type: "start_spin", activeColors: uniqueAct, starterColor, mode: "action", jokerStartCount, durationMs: 4200 });
      return;
    }

    if (msg.type === "start") {
      const me = room.players.get(clientId);
      if (!me?.isHost) { send(ws, { type: "error", code: "NOT_HOST", message: "Nur Host kann starten" }); return; }
      if (!canStart(room)) { send(ws, { type: "error", code: "NEED_2P", message: "Mindestens 2 Spieler nötig" }); return; }

      // aktive Farben anhand verbundener Spieler (mit gewählter Farbe)
      const act = Array.from(room.players.values())
        .filter(p => isConnectedPlayer(p) && ALLOWED_COLORS.includes(p.color))
        .map(p => p.color);
      const uniqueAct = ALLOWED_COLORS.filter(c => act.includes(c));
      if (uniqueAct.length < 2) {
        send(ws, { type: "error", code: "NEED_COLORS", message: "Mindestens 2 Spieler müssen eine Farbe wählen" });
        return;
      }

      const starter = String(msg.starterColor || room._pendingStart?.starterColor || "").toLowerCase().trim();
      const jokerStartCount = Number(msg.jokerStartCount ?? room._pendingStart?.jokerStartCount ?? room.jokerStartCount);
      if (!Number.isInteger(jokerStartCount) || jokerStartCount < 1 || jokerStartCount > 5) {
        send(ws, { type: "error", code: "NEED_JOKER_COUNT", message: "Host muss zuerst die Joker-Anzahl 1 bis 5 wählen" });
        return;
      }
      room.jokerStartCount = jokerStartCount;
      initGameState(room, uniqueAct, "action", starter, jokerStartCount);
      room._pendingStart = null;
      await persistRoomState(room);
      console.log(`[start] room=${room.code} starter=${room.state.turnColor}`);
      broadcast(room, { type: "started", state: room.state });
      return;
    }

    if (msg.type === "reset") {
    // reset = neues Spiel, überschreibt Save
    await deletePersisted(room);

      const me = room.players.get(clientId);
      if (!me?.isHost) { send(ws, { type: "error", code: "NOT_HOST", message: "Nur Host kann resetten" }); return; }

      room.state = null;
      room.jokerStartCount = null;
      room.lastRollWasSix = false;
      room.carryingByColor = { red: false, blue: false, green: false, yellow: false };
      // Farben NICHT neu zufaellig zuweisen:
      // Neuer Standard: Spieler waehlen ihre Farbe selbst in der Lobby.
      // (Reconnect/Token bleibt damit konsistent.)

      console.log(`[reset] room=${room.code} by=host`);
      broadcast(room, roomUpdatePayload(room));
      broadcast(room, { type: "reset_done" });
      return;
    }

    // ---------- RESUME (Host) ----------
    // Reconnect-Sicherheit: Der Raum bleibt pausiert, bis der Host aktiv fortsetzt.
    // Wichtig: Nur fortsetzen, wenn wieder 2 farbige Spieler verbunden sind.
    if (msg.type === "resume") {
      const me = room.players.get(clientId);
      if (!me?.isHost) { send(ws, { type: "error", code: "NOT_HOST", message: "Nur Host kann fortsetzen" }); return; }
      if (!room.state) { send(ws, { type: "error", code: "NO_STATE", message: "Spiel nicht gestartet" }); return; }
      if (!canStart(room)) {
        room.state.paused = true;
        await persistRoomState(room);
        send(ws, { type: "error", code: "NEED_2P", message: "Warte auf 2 Spieler…" });
        broadcast(room, { type: "snapshot", state: room.state });
        return;
      }
      room.state.paused = false;
      await persistRoomState(room);
      broadcast(room, { type: "snapshot", state: room.state });
      return;
    }    // ---------- ACTION MODE: JOKERS (server is chef) ----------
    // Safety-first rollout:
    // - allColors + barricade are enabled (low risk)
    // - choose + sum are reserved for next step (needs dice UI for 7-12 etc.)
    if (msg.type === "use_joker") {
      if (!requireRoomState(room, ws)) return;
      if (!requireTurn(room, clientId, ws)) return;

      if (String(room.state.mode || "classic") !== "action" || !room.state.action) {
        send(ws, { type: "error", code: "NOT_ACTION", message: "Action-Modus ist nicht aktiv" });
        return;
      }

      const turnColor = room.state.turnColor;
      const action = room.state.action;
      ensureActionJokers(action);
      const set = action.jokersByColor?.[turnColor];
      if (!set) { send(ws, { type: "error", code: "NO_JOKERS", message: "Joker-Set fehlt" }); return; }

      const joker = String(msg.joker || "").toLowerCase().trim();

      // helper: count/consume (stackable)
      const hasJoker = (k) => countOwnedJokers(action, turnColor, k) > 0;
      const consumeNow = (k) => consumeOwnedJoker(action, turnColor, k);


      if (joker === "allcolors") {
        if (!hasJoker("allColors")) { send(ws, { type: "error", code: "USED", message: "Alle Farben Joker schon verbraucht" }); return; }
        // Wunsch: Joker erst NACH dem Würfeln (Phase need_move)
        if (room.state.phase !== "need_move" || room.state.rolled == null) {
          send(ws, { type: "error", code: "BAD_PHASE", message: "Erst würfeln – dann Joker wählen" });
          return;
        }
        room.state.action.effects.allColorsBy = turnColor;
        consumeNow("allColors");
        try{ recordMatchJoker(room, turnColor, "allColors"); }catch(_e){}
        await persistRoomState(room);
        broadcast(room, { type: "snapshot", state: room.state, joker: "allcolors" });
        return;
      }

      if (joker === "barricade") {
        if (!hasJoker("barricade")) { send(ws, { type: "error", code: "USED", message: "Barikade Joker schon verbraucht" }); return; }
        // Barikade-Joker soll *vor* dem Würfeln eingesetzt werden.
        // Wenn man ihn nach dem Wurf aktiviert, kann der Spieler die Barikade nicht mehr bewegen
        // (weil das Spiel dann in phase=need_move ist) und es fühlt sich "buggy" an.
        if (room.state.phase !== "need_roll" || room.state.rolled != null) {
          send(ws, { type: "error", code: "BAD_PHASE", message: "Barikade-Joker nur vor dem Würfeln" });
          return;
        }
        
        // Falls schon aktiv (z.B. Doppel-Klick), nicht nochmal „verbrauchen“.
        if (room.state.action.effects.barricadeBy === turnColor) {
          broadcast(room, { type: "snapshot", state: room.state, joker: "barricade" });
          return;
        }

        room.state.action.effects.barricadeBy = turnColor;
        // NOTE: Joker wird erst nach erfolgreichem Versetzen verbraucht (Commit in action_barricade_move)
        await persistRoomState(room);
        broadcast(room, { type: "snapshot", state: room.state, joker: "barricade" });
        return;
      }


      if (joker === "reroll") {
        if (!hasJoker("reroll")) { send(ws, { type: "error", code: "USED", message: "Neu-Wurf Joker schon verbraucht" }); return; }
        // Neu-Wurf-Joker: erst NACH dem Würfeln (need_move) nutzbar
        if (room.state.phase !== "need_move" || room.state.rolled == null) {
          send(ws, { type: "error", code: "BAD_PHASE", message: "Erst würfeln – dann Neu-Wurf" });
          return;
        }
        // Wurf verfällt -> zurück in need_roll
        room.state.rolled = null;
        room.state.phase = "need_roll";
        consumeNow("reroll");
        try{ recordMatchJoker(room, turnColor, "reroll"); }catch(_e){}
        await persistRoomState(room);
        broadcast(room, { type: "snapshot", state: room.state, joker: "reroll" });
        return;
      }

      
      if (joker === "double") {
        if (!hasJoker("double")) { send(ws, { type: "error", code: "USED", message: "Doppelwurf Joker schon verbraucht" }); return; }
        // Doppelwurf-Joker soll *vor* dem Würfeln eingesetzt werden.
        if (room.state.phase !== "need_roll" || room.state.rolled != null) {
          send(ws, { type: "error", code: "BAD_PHASE", message: "Doppelwurf nur vor dem Würfeln" });
          return;
        }
        // Falls schon aktiv, nicht nochmal verbrauchen
        if (room.state.action.effects.doubleRoll && room.state.action.effects.doubleRoll.by === turnColor && room.state.action.effects.doubleRoll.kind === "sum2" && room.state.action.effects.doubleRoll.pending === true) {
          broadcast(room, { type: "snapshot", state: room.state, joker: "double" });
          return;
        }
        room.state.action.effects.doubleRoll = { kind: "sum2", by: turnColor, pending: true, rolls: null, chosen: null };
        consumeNow("double");
        try{ recordMatchJoker(room, turnColor, "double"); }catch(_e){}
        await persistRoomState(room);
        broadcast(room, { type: "snapshot", state: room.state, joker: "double" });
        return;
      }

if (joker === "choose" || joker === "sum") {
        send(ws, { type: "error", code: "NOT_READY", message: "Choose/Summe kommt im nächsten Schritt (sonst Risiko mit Würfel-UI)" });
        return;
      }

      send(ws, { type: "error", code: "BAD_JOKER", message: "Unbekannter Joker" });
      return;
    }

    if (msg.type === "cancel_joker") {
      if (!requireRoomState(room, ws)) return;
      if (!requireTurn(room, clientId, ws)) return;

      if (String(room.state.mode || "classic") !== "action" || !room.state.action) {
        send(ws, { type: "error", code: "NOT_ACTION", message: "Action-Modus ist nicht aktiv" });
        return;
      }

      const action = room.state.action;
      ensureActionJokers(action);

      const turnColor = room.state.turnColor;
      const kindRaw = String(msg.joker || "").toLowerCase().trim();

      // Normalize to server joker keys
      const kind =
        kindRaw === "allcolors" ? "allColors" :
        kindRaw === "barricade" ? "barricade" :
        kindRaw === "double" ? "double" :
        kindRaw === "reroll" ? "reroll" :
        kindRaw;

      // Cancel only makes sense for toggle-like jokers
      if (kind === "allColors") {
        // AllColors is consumed on activation -> refund on cancel if still active
        if (action.effects?.allColorsBy === turnColor) {
          action.effects.allColorsBy = null;
          addOwnedJoker(action, turnColor, "allColors", turnColor, "cancel_refund");
          syncJokerCountsFromOwned(action);
        }
      } else if (kind === "barricade") {
        // Barricade is consumed only on successful move -> just clear effect
        if (action.effects?.barricadeBy === turnColor) {
          action.effects.barricadeBy = null;
        }
      } else if (kind === "double") {
        // Double is consumed on activation -> refund only if still pending (not rolled yet)
        if (action.effects?.doubleRoll
            && action.effects.doubleRoll.by === turnColor
            && action.effects.doubleRoll.pending === true) {
          action.effects.doubleRoll = null;
          addOwnedJoker(action, turnColor, "double", turnColor, "cancel_refund");
          syncJokerCountsFromOwned(action);
        }
      } else {
        // reroll / choose / sum etc. are not cancellable (would change game state)
      }

      await persistRoomState(room);
      broadcast(room, { type: "snapshot", state: room.state, jokerCanceled: kindRaw });
      return;
    }

if (msg.type === "action_barricade_move") {
      if (!requireRoomState(room, ws)) return;
      if (!requireTurn(room, clientId, ws)) return;

      if (String(room.state.mode || "classic") !== "action" || !room.state.action) {
        send(ws, { type: "error", code: "NOT_ACTION", message: "Action-Modus ist nicht aktiv" });
        return;
      }

      const turnColor = room.state.turnColor;
      const eff = room.state.action.effects || {};
      if (eff.barricadeBy !== turnColor) {
        send(ws, { type: "error", code: "NO_EFFECT", message: "Barikade-Effekt ist nicht aktiv" });
        return;
      }
      if (room.state.phase !== "need_roll") {
        send(ws, { type: "error", code: "BAD_PHASE", message: "Barikade-Joker nur vor dem Würfeln" });
        return;
      }

      const from = String(msg.from || "");
      const to   = String(msg.to || "");
      if (!from || !to) { send(ws, { type: "error", code: "BAD_ARGS", message: "from/to fehlt" }); return; }
      if (from === to) { send(ws, { type: "error", code: "BAD_ARGS", message: "Quelle = Ziel" }); return; }
      if (to === String(room.state.goal)) { send(ws, { type: "error", code: "GOAL_BLOCKED", message: "Ziel-Feld ist gesperrt" }); return; }

      const barr = room.state.barricades || [];
      if (!barr.includes(from)) { send(ws, { type: "error", code: "NO_BARR", message: "Quelle hat keine Barikade" }); return; }
      if (barr.includes(to)) { send(ws, { type: "error", code: "HAS_BARR", message: "Ziel hat schon eine Barikade" }); return; }

      // move
      room.state.barricades = barr.filter(x => x !== from);
      room.state.barricades.push(to);

      // effect is single-use per turn -> clear now
      room.state.action.effects.barricadeBy = null;


      // Commit: Joker jetzt verbrauchen (erst nach erfolgreichem Move)
      try{
        if (room.state.action) {
          consumeOwnedJoker(room.state.action, turnColor, "barricade");
          try{ recordMatchJoker(room, turnColor, "barricade"); }catch(_e){}
        }
      }catch(_e){}
      await persistRoomState(room);
      broadcast(room, { type: "snapshot", state: room.state, moved: { from, to } });
      return;
    }



    // ---------- ROLL ----------
    if (msg.type === "roll_request") {
      if (!requireRoomState(room, ws)) return;
      if (!requireTurn(room, clientId, ws)) return;

      if (room.state.phase !== "need_roll") {
        send(ws, { type: "error", code: "BAD_PHASE", message: "Erst Zug beenden" });
        return;
      }

      let v = randInt(1, 6);
      let double = null;

      // Action-Mode: Doppelwurf (2x würfeln, Summe) – wird VOR dem Würfeln aktiviert
      try{
        if (String(room.state.mode || "classic") === "action" && room.state.action && room.state.action.effects) {
          const eff = room.state.action.effects.doubleRoll;
          if (eff && eff.by === room.state.turnColor && eff.kind === "sum2" && eff.pending === true) {
            const a = randInt(1, 6);
            const b = randInt(1, 6);
            v = a + b;
            double = [a, b];
            eff.pending = false;
            eff.rolls = [a, b];
            eff.chosen = v;
            // Effekt nach dem Wurf entfernen (Joker ist ohnehin schon verbraucht)
            room.state.action.effects.doubleRoll = null;
          }
        }
      }catch(_e){}

      console.log(`[roll] room=${room.code} by=${room.state.turnColor} value=${v}`);

      // Stats: track rolls for registered players (no Gast)
      await recordRollStat(room, room.state.turnColor, v);

      // Per-match titles: count rolled 1/6 etc. (server authoritative)
      try{ recordMatchRoll(room, room.state.turnColor, v); }catch(_e){}

      room.state.rolled = v;
      room.lastRollWasSix = (v === 6);
      room.state.phase = "need_move";
      await persistRoomState(room);
    broadcast(room, { type: "roll", value: v, state: room.state, double });
      return;
    }

    
    // ---------- FORFEIT / AUFGEBEN ----------
    if (msg.type === "forfeit") {
      if (!requireRoomState(room, ws)) return;

      // Only a player with a color can forfeit
      const me = room.players.get(clientId);
      const myColor = String(me?.color || "").toLowerCase();
      if (!myColor) { send(ws, { type:"error", code:"SPECTATOR", message:"Du hast keine Farbe" }); return; }
      if (room.state.finished) { send(ws, { type:"error", code:"GAME_OVER", message:"Spiel ist bereits beendet" }); return; }

      // Determine winner: player with the smallest distance to the goal (closest piece wins)
      const goalId = room.state.goal || GOAL;
      const active = Array.isArray(room.state.activeColors) && room.state.activeColors.length ? room.state.activeColors : ALLOWED_COLORS;

      function minDistForColor(color){
        let best = Infinity;
        for(const p of (room.state.pieces || [])){
          if(!p || String(p.color||"").toLowerCase() !== String(color||"").toLowerCase()) continue;
          if(p.posKind !== "board") continue;
          const d = DIST_TO_GOAL.get(p.nodeId);
          if(typeof d === "number" && d < best) best = d;
        }
        return best;
      }

      // Build ranking (deterministic): distance asc, then active order
      let winnerColor = null;
      let bestDist = Infinity;
      for(const c of active){
        const d = minDistForColor(c);
        if(d < bestDist){
          bestDist = d;
          winnerColor = c;
        }
      }
      // If distances are missing (shouldn't), fall back to turnColor
      if(!winnerColor) winnerColor = room.state.turnColor || active[0] || myColor;

      setGameOver(room, winnerColor);

      // Mark reason + forfeiter
      room.state.gameOverReason = "forfeit";
      room.state.forfeiterColor = myColor;

      await finalizeMatchStats(room, room.state.winnerColor, { forfeiterColor: myColor });
      await persistRoomState(room);

      broadcast(room, {
        type: "forfeit",
        by: myColor,
        winner: room.state.winnerColor,
        state: room.state,
      });
      return;
    }


    // ---------- END / SKIP ----------
    if (msg.type === "end_turn" || msg.type === "skip_turn") {
      if (!requireRoomState(room, ws)) return;
      if (!requireTurn(room, clientId, ws)) return;

      if (room.state.phase === "place_barricade") {
        send(ws, { type: "error", code: "BAD_PHASE", message: "Erst Barikade platzieren" });
        return;
      }

      // Action-Mode: clear per-turn effects when a turn ends (prevents desync / stuck effects)
      if (String(room.state.mode || "classic") === "action" && room.state.action && room.state.action.effects) {
        const ended = room.state.turnColor;
        const eff = room.state.action.effects;
        if (eff.allColorsBy === ended) eff.allColorsBy = null;
        if (eff.barricadeBy === ended) eff.barricadeBy = null;
        if (eff.doubleRoll && eff.doubleRoll.by === ended) eff.doubleRoll = null;
      }

      // per-match titles: turn time tracking (cap at 60s)
      try{
        if(room.state.matchTrack && room.state.matchTrack.turnStartedAt){
          const dt = Date.now() - room.state.matchTrack.turnStartedAt;
          recordMatchTurnTime(room, room.state.turnColor, dt);
        }
      }catch(_e){}

      room.lastRollWasSix = false;
      room.state.rolled = null;
      room.state.phase = "need_roll";
      room.state.turnColor = nextTurnColor(room, room.state.turnColor);
      if(room.state.matchTrack) room.state.matchTrack.turnStartedAt = Date.now();

      await persistRoomState(room);
    broadcast(room, { type: "move", state: room.state });
      broadcast(room, roomUpdatePayload(room));
      return;
    }

    // ---------- LEGAL TARGETS ----------
    if (msg.type === "legal_request") {
      if (!requireRoomState(room, ws)) return;
      if (!requireTurn(room, clientId, ws)) return;

      if (room.state.phase !== "need_move") {
        send(ws, { type: "error", code: "BAD_PHASE", message: "Erst würfeln" });
        return;
      }

      const pieceId = String(msg.pieceId || "");
      const pc = getPiece(room, pieceId);
      const allowAll = (String(room.state.mode || "classic") === "action") && room.state.action && room.state.action.effects && (room.state.action.effects.allColorsBy === room.state.turnColor);

      if (!pc || (!allowAll && pc.color !== room.state.turnColor)) {
        send(ws, { type: "error", code: "BAD_PIECE", message: "Ungültige Figur" });
        return;
      }

      const roll = room.state.rolled;
      const startField = STARTS[pc.color];
      let targets = new Map();

      if (pc.posKind === "house") {
        const remaining = roll - 1;
        if (remaining === 0) targets = new Map([[startField, [startField]]]);
        else targets = computeAllTargets(room, startField, remaining, pc.color, pc.id);
      } else {
        targets = computeAllTargets(room, pc.nodeId, roll, pc.color, pc.id);
      }

      send(ws, { type: "legal", pieceId, targets: Array.from(targets.keys()) });
      return;
    }

    // ---------- MOVE ----------
    
  // ---------- EXPORT / IMPORT (Host only) ----------
  // export_state: Server sendet aktuellen room.state zurück (Host kann als JSON speichern)
  if (msg.type === "export_state") {
    if (!room) return;
    const me = room.players.get(clientId);
    if (!me?.isHost) return send(ws, { type: "error", code: "HOST_ONLY", message: "Nur Host" });
    if (!room.state) return send(ws, { type: "error", code: "NO_STATE", message: "Spiel nicht gestartet" });
    return send(ws, { type: "export_state", code: room.code, state: room.state, ts: Date.now() });
  }

  // import_state: Host sendet state JSON zurück → Server setzt room.state und broadcastet snapshot
  if (msg.type === "import_state") {
    if (!room) return;
    const me = room.players.get(clientId);
    if (!me?.isHost) return send(ws, { type: "error", code: "HOST_ONLY", message: "Nur Host" });
    const st = msg.state;
    if (!st || typeof st !== "object") return send(ws, { type: "error", code: "BAD_STATE", message: "Ungültiger State" });

    // Minimal sanity: muss turnColor & phase besitzen
    if (!st.turnColor || !st.phase || !Array.isArray(st.pieces) || !Array.isArray(st.barricades)) {
      return send(ws, { type: "error", code: "BAD_STATE", message: "State-Format passt nicht" });
    }

    room.state = st;
    // wenn Spiel importiert ist, nicht pausieren (sonst lock)
    room.state.paused = false;
    await persistRoomState(room);
    broadcast(room, { type: "snapshot", state: room.state, players: currentPlayersList(room) });
    return;
  }

if (msg.type === "move_request") {
      if (!requireRoomState(room, ws)) return;
      if (!requireTurn(room, clientId, ws)) return;

      if (room.state.phase !== "need_move") {
        send(ws, { type: "error", code: "BAD_PHASE", message: "Erst würfeln" });
        return;
      }

      const pieceId = String(msg.pieceId || "");
      const targetId = String(msg.targetId || "");
      const pc = getPiece(room, pieceId);

      // Action‑Mode Joker "Alle Farben": aktiver Spieler bleibt turnColor,
      // aber darf (einmalig) auch fremde Figuren bewegen.
      const activeColor = room.state.turnColor;
      const allowAll = (String(room.state.mode || "classic") === "action")
        && room.state.action
        && room.state.action.effects
        && (room.state.action.effects.allColorsBy === activeColor);

      if (!pc || (!allowAll && pc.color !== activeColor)) {
        send(ws, { type: "error", code: "BAD_PIECE", message: "Ungültige Figur" });
        return;
      }

      const res = pathForTarget(room, pc, targetId);
      if (!res.ok) {
        send(ws, { type: "error", code: "ILLEGAL", message: res.msg || "illegal" });
        return;
      }

      // apply move
      pc.posKind = "board";
      pc.nodeId = res.path[res.path.length - 1];

      const landed = pc.nodeId;

      // Per-match titles: count walked fields (server authoritative)
      try{ recordMatchMove(room, activeColor, Number(room.state.rolled||0) || 0); }catch(_e){}

      // kick opponent on landing
      const kicked = [];
      const kickedVictimColors = [];
      for (const op of room.state.pieces) {
        if (op.posKind === "board" && op.nodeId === landed && op.color !== pc.color) {
          kickedVictimColors.push(op.color);
          sendPieceHome(room, op);
          kicked.push(op.id);
        }
      }

      if (kickedVictimColors.length) {
        kickedVictimColors.forEach(vc=>recordMatchKick(room, activeColor, vc));
      }

      // Wheel: if a piece is kicked in Action-Mode, the ACTIVE (current) player gets a 50% chance
      // to receive a random joker. The joker "origin color" is the kicked piece color (for UI display).
      // Server decides instantly (no delays). Client may animate it visually.
      let wheel = null;
      try {
        const isAction = String(room.state.mode || "classic") === "action";
        const action = room.state?.action;
        if (isAction && action && kicked.length) {
          ensureActionJokers(action);

          // Determine which colors were kicked (usually 1)
          const kickedColors = new Set();
          for (const pid of kicked) {
            const pp = room.state.pieces.find(x => String(x.id) === String(pid));
            if (pp && pp.color) kickedColors.add(pp.color);
          }

          const segments = ["allColors","barricade","reroll","double"]; // keine Nieten
          wheel = [];

          for (const kc of kickedColors) {
            const pick = segments[Math.floor(Math.random() * segments.length)];
            const result = pick;

            const awardMode = room.state?.jokerAwardMode || room.jokerAwardMode || "thrower";
            const targetColor = (awardMode === "victim") ? kc : activeColor;

            // Keep both keys for backwards/forwards compatibility (client may read either).
            const attacker = Array.from(room.players.values()).find(p=>p && p.color===targetColor);
            const victim = Array.from(room.players.values()).find(p=>p && p.color===kc);
            const quote = KICK_QUOTES[Math.floor(Math.random()*KICK_QUOTES.length)];
            wheel.push({ ownerColor: targetColor, targetColor, jokerColor: kc, result, durationMs: 5000, attackerName: attacker?.name || "", victimName: victim?.name || "", quote }); // Christoph-Wunsch: 5s

            // Grant to selected recipient (thrower OR victim). Origin color=kc for display.
            if (result) {
              addOwnedJoker(action, targetColor, result, kc, "wheel");
            }
          }

          // Keep counts snapshot in sync
          syncJokerCountsFromOwned(action);
        }
      } catch (_e) {
        wheel = null;
      }

      // landed on barricade?
      const barricades = room.state.barricades;
      const idx = barricades.indexOf(landed);
      let picked = false;

      if (idx >= 0) {
        barricades.splice(idx, 1);
        picked = true;
        // Persist the "carrying" flag inside state (so it survives restart)
        if (!room.state.carryingByColor || typeof room.state.carryingByColor !== "object") {
  room.state.carryingByColor = { red: false, blue: false, green: false, yellow: false };
        }
        room.state.carryingByColor[activeColor] = true;
        room.carryingByColor = room.state.carryingByColor; // compat alias
        room.state.phase = "place_barricade";
      } else {
        room.state.phase = "need_roll";
      }

      // if no barricade placement needed:
      if (!picked) {
        if (room.lastRollWasSix) {
          room.state.turnColor = activeColor; // extra roll (Joker-sicher)
        } else {
          room.state.turnColor = nextTurnColor(room, activeColor);
        }
        room.state.phase = "need_roll";
        room.state.rolled = null;
      }

      // Joker‑Effekt endet nach dem Zug (verhindert Turn‑Chaos)
      if (String(room.state.mode || "classic") === "action" && room.state.action && room.state.action.effects) {
        if (room.state.action.effects.allColorsBy === activeColor) {
          room.state.action.effects.allColorsBy = null;
        }
      }

      // ✅ Win condition (server is chef): first piece that reaches the goal node wins.
      const winner = detectWinnerColor(room);
      if (winner) {
        setGameOver(room, winner);
        console.log(`[win] room=${room.code} winner=${room.state.winnerColor}`);
        await finalizeMatchStats(room, room.state.winnerColor);
      }

      console.log(`[move] room=${room.code} active=${activeColor} moved=${pc.color} piece=${pc.id} to=${pc.nodeId} picked=${picked}`);
      broadcast(room, {
        type: "move",
        action: { pieceId: pc.id, path: res.path, pickedBarricade: picked, kickedPieces: kicked },
        wheel: wheel || undefined,
        state: room.state
      });
      if (room.state.finished) {
        broadcast(room, { type: "game_over", winnerColor: room.state.winnerColor, finishedAt: room.state.finishedAt, awards: room.state.matchAwards || [] });
      }
      // Persist after every successful move so a server restart has the newest possible state.
      await persistRoomState(room);
      return;
    }

    // ---------- PLACE BARRICADE (Host+Client) ----------
// ---------- PLACE BARRICADE (Host+Client) ----------
if (msg.type === "place_barricade") {
  if (!requireRoomState(room, ws)) return;

  if (room.state.phase !== "place_barricade") {
    send(ws, { type: "error", code: "BAD_PHASE", message: "Keine Barikade zu platzieren" });
    return;
  }

  const me = room.players.get(clientId);
  if (!me?.color) {
    send(ws, { type: "error", code: "SPECTATOR", message: "Du hast keine Farbe" });
    return;
  }

  const color = room.state.turnColor;

  // Zug über Spielerfarbe prüfen (Host/Client egal)
  if (me.color !== color) {
    send(ws, { type: "error", code: "NOT_YOUR_TURN", message: "Nicht dein Zug" });
    return;
  }

  // carrying flag is persisted in room.state
  if (!room.state.carryingByColor || typeof room.state.carryingByColor !== "object") {
    room.state.carryingByColor = { red: false, blue: false, green: false, yellow: false };
  }
  room.carryingByColor = room.state.carryingByColor; // compat alias

  if (!room.state.carryingByColor[color]) {
    send(ws, { type: "error", code: "NO_BARRICADE", message: "Du trägst keine Barikade" });
    return;
  }

  // ✅ Robust: viele mögliche Payload-Formate akzeptieren
  let nodeId = "";
  if (typeof msg.nodeId === "string") nodeId = msg.nodeId;
  else if (typeof msg.at === "string") nodeId = msg.at;
  else if (typeof msg.id === "string") nodeId = msg.id;
  else if (typeof msg.targetId === "string") nodeId = msg.targetId;
  else if (msg.node && typeof msg.node === "object" && typeof msg.node.id === "string") nodeId = msg.node.id;

  // falls aus irgendeinem Grund eine Zahl/Index kommt:
  if (!nodeId && (typeof msg.nodeId === "number" || typeof msg.at === "number" || typeof msg.id === "number")) {
    const idx = Number(msg.nodeId ?? msg.at ?? msg.id);
    const n = (BOARD.nodes || [])[idx];
    if (n?.id) nodeId = String(n.id);
  }

  nodeId = String(nodeId || "").trim();

  // 🔧 normalize ids (host/client may send "12" or "node_12" etc.)
  if (nodeId && !NODES.has(nodeId)) {
    const m = String(nodeId).match(/(\d+)/);
    if (/^\d+$/.test(nodeId)) nodeId = `n_${nodeId}`;
    else if (m) nodeId = `n_${m[1]}`;
  }

  // 🔧 fallback: if still unknown but coords exist, snap to nearest board node
  if (nodeId && !NODES.has(nodeId)) {
    let x = null, y = null;
    if (typeof msg.x === "number" && typeof msg.y === "number") { x = msg.x; y = msg.y; }
    else if (msg.pos && typeof msg.pos.x === "number" && typeof msg.pos.y === "number") { x = msg.pos.x; y = msg.pos.y; }
    if (x !== null && y !== null) {
      let best = null;
      let bestD = Infinity;
      for (const n of (BOARD.nodes || [])) {
        if (n.kind !== "board") continue;
        const dx = (n.x ?? 0) - x;
        const dy = (n.y ?? 0) - y;
        const d = dx*dx + dy*dy;
        if (d < bestD) { bestD = d; best = n; }
      }
      if (best?.id) nodeId = best.id;
    }
  }

  if (!nodeId) {
    send(ws, { type: "error", code: "NO_NODE", message: "Kein Zielfeld" });
    return;
  }

  if (!isPlacableBarricade(room, nodeId)) {
    // Mini-Debug, damit du es im Render Log sofort siehst:
    const n = NODES.get(nodeId);
    console.log("[place_barricade] FAIL",
      "player=", me.color,
      "turn=", color,
      "nodeId=", nodeId,
      "exists=", !!n,
      "kind=", n?.kind
    );
    send(ws, { type: "error", code: "BAD_NODE", message: "Hier darf keine Barikade hin" });
    return;
  }

  // ✅ platzieren
  room.state.barricades.push(nodeId);
  room.state.carryingByColor[color] = false;
  room.carryingByColor = room.state.carryingByColor; // compat alias

  // ✅ weiter
  room.state.turnColor = room.lastRollWasSix ? color : nextTurnColor(room, color);
  room.state.phase = "need_roll";
  room.state.rolled = null;

  await persistRoomState(room);
  broadcast(room, { type: "snapshot", state: room.state });
  return;
}

    // fallback: unknown message
    return;
  }); // ✅ Ende ws.on("message")

  ws.on("close", async () => {
    const c = clients.get(clientId);
    if (!c) return;

    const roomCode = c.room;
    if (roomCode) {
      const room = rooms.get(roomCode);
      if (room) {
	      // keep per-room socket index clean
	      if (room.clients) room.clients.delete(clientId);
        const p = room.players.get(clientId);
        const wasColor = p?.color;
        const wasTurn = room.state?.turnColor;
        if (p) p.lastSeen = Date.now();

        // pause if active player disconnected
        if (room.state && wasColor && wasTurn && wasColor === wasTurn) {
          room.state.paused = true;
        }


        // Wenn wirklich niemand mehr verbunden ist → sicher pausieren (beide reconnect edge-case)
        if (room.state) {
          const anyConnected = Array.from(room.players.values()).some(pp => isConnectedPlayer(pp));
          if (!anyConnected) room.state.paused = true;
        }

        // Reconnect-Sicherheit: sobald <2 Spieler verbunden sind → pausiert
        enforcePauseIfNotReady(room);
        broadcast(room, roomUpdatePayload(room));
        if (room.state) await persistRoomState(room);
    broadcast(room, { type: "snapshot", state: room.state });
      }
    }

    clients.delete(clientId);
  });
});



// ---------- Snapshot Heartbeat (Server is Chef) ----------
// Sends the current authoritative snapshot periodically so clients can resync after
// Render sleep/reconnect/message-loss without any risky auto-repair.
// Safe: does NOT change game state, only broadcasts existing room.state.
const SNAPSHOT_HEARTBEAT_MS = Number(process.env.SNAPSHOT_HEARTBEAT_MS || 3000);

setInterval(() => {
  try {
    for (const room of rooms.values()) {
      if (!room || !room.state || !room.state.started) continue;

      // only if at least one connected player is present
      const hasConnected = Array.from(room.players.values()).some(p => isConnectedPlayer(p));
      if (!hasConnected) continue;

      broadcast(room, { type: "snapshot", state: room.state, hb: true, ts: Date.now() });
    }
  } catch (_e) {
    // never crash the server because of heartbeat
  }
}, SNAPSHOT_HEARTBEAT_MS);

server.listen(PORT, () => console.log("Barikade server listening on", PORT, "build", SERVER_BUILD));
