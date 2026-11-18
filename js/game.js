import { clamp, dist, hash2, lerp, mulberry32, pick, smooth, T, TAU, TP, TS } from './core.js';
import { DIFF, DIFFS, drawHintArrow, fallHint, floorsN, setDifficulty, stairsHint } from './difficulty.js';
import { buildAtlas, buildSprites, FR, mixc, rgb, shd, SPR, SPRC, SPRW } from './art.js';
import {
  collides, FLOW, flowDir, LINES_CALM, LINES_DEEP, LINES_HEALER, LINES_UNEASY, makeEnemy, makeNPC,
  moveBody, NPC_NAMES, updateFlow
} from './entities.js';
import { computeFog, fixCount, HEX_S, nearestTile } from './gen_overworld.js';
import { enterDungeon, getLevel, growSurfaceVeins, hardAt, stageInfo } from './gen_maze.js';
import { fleshAlarm } from './gen_flesh.js';
import { enterHouse, houseOccupied, KNOCK_LINES } from './gen_house.js';
import {
  drawRedEyes, findHaven, makeFogTown, moveDungeon, nightRaw, shiftTick, updEntranced
} from './shift.js';
import { closeHowTo, drawObjective, goalText, showHowTo } from './guide.js';
import { makeWorld, setupWorldTests, townCentre } from './worldchecks.js';
import { AU, auResume, auUpdate, sfx } from './audio.js';
import {
  AMMO_SHORT, ammoPop, ammoTypeFor, drawAim, drawBullet, drawGun, drawReticle, FILES, giveAmmo, gunOf, GUNS,
  giveMed, isEmpty, MED_POP, popAll, searchStash, startSearch, stashSearchable, updateGun, updateSearch, updBullet
} from './weapons.js';
import { drawTip, noteUse, retireTip, tipsReset, tipsUpdate } from './tips.js';

// ================= canvas & layout =================
export const cv = document.getElementById('game'), ctx = cv.getContext('2d');
export const buf = document.createElement('canvas'), bctx = buf.getContext('2d');
const lc = document.createElement('canvas'), lctx = lc.getContext('2d');
export let DPR = 1, SW = 0, SH = 0, SCALE = 4, BW = 0, BH = 0;
export const UI = {};
const FONT = '"Pixelify Sans", ui-monospace, monospace';
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 3); SW = window.innerWidth; SH = window.innerHeight;
  cv.width = Math.round(SW * DPR); cv.height = Math.round(SH * DPR);
  SCALE = Math.max(2, Math.floor(Math.min(cv.width, cv.height) / (TS * 14.5)));
  BW = Math.ceil(cv.width / SCALE); BH = Math.ceil(cv.height / SCALE);
  buf.width = BW; buf.height = BH; lc.width = BW; lc.height = BH;
  bctx.imageSmoothingEnabled = false;
  layoutUI();
}
function layoutUI() {
  const s = clamp(Math.min(SW, SH) / 400, 0.8, 1.35); UI.s = s;
  UI.atk = { x: SW - 74 * s, y: SH - 88 * s, r: 42 * s };
  UI.med = { x: SW - 166 * s, y: SH - 52 * s, r: 25 * s };
  UI.gun = { x: SW - 252 * s, y: SH - 152 * s, w: 128 * s, h: 40 * s };
  UI.use = { x: SW - 86 * s, y: SH - 186 * s, r: 32 * s };
  UI.mini = { w: Math.round(92 * s), x: Math.round(SW - 92 * s - 10), y: 10 };
  UI.mapBtn = { x: UI.mini.x - 26 * s, y: UI.mini.y + 18 * s, r: 17 * s };
  UI.menuBtn = { x: UI.mini.x - 26 * s, y: UI.mini.y + 60 * s, r: 17 * s };
  UI.stickR = 54 * s; UI.stickHome = { x: 96 * s, y: SH - 106 * s };
}

// ================= input =================
export const IN = { mx: 0, my: 0, atkHeld: false, atkPress: false, usePress: false, switchPress: false, reloadPress: false, medPress: false, keys: {}, mode: 'touch' };
const PTR = new Map(); let STICK = null;
// let go of everything (stick, fire button, keys): used whenever a finger or key-up could have been missed
export function resetInput() { STICK = null; PTR.clear(); IN.atkHeld = false; IN.keys = {}; IN.mx = IN.my = 0; }
const inCircle = (b, x, y, pad = 1.15) => b && Math.hypot(x - b.x, y - b.y) < b.r * pad;
function hitButton(x, y) {
  if (inCircle(UI.mapBtn, x, y, 1.4)) return 'map';
  if (inCircle(UI.menuBtn, x, y, 1.4)) return 'menu';
  if (G.use && inCircle(UI.use, x, y)) return 'use';
  if (G.P && G.P.meds > 0 && inCircle(UI.med, x, y, 1.2)) return 'med';
  const g = UI.gun; if (x > g.x && x < g.x + g.w && y > g.y - 6 && y < g.y + g.h + 6) return 'gun';
  if (inCircle(UI.atk, x, y, 1.3)) return 'atk';
  return null;
}
function press(role) {
  if (role === 'atk') { IN.atkHeld = true; IN.atkPress = true; }
  else if (role === 'use') IN.usePress = true;
  else if (role === 'gun') IN.switchPress = true;
  else if (role === 'med') IN.medPress = true;
  else if (role === 'map') toggleMap();
  else if (role === 'menu') openMenu();
}
function toggleMap() { G.mapOpen = !G.mapOpen; if (G.mapOpen) { resetInput(); G.mapSeen = true; } }
cv.addEventListener('pointerdown', e => {
  e.preventDefault(); auResume();
  IN.mode = e.pointerType === 'mouse' ? 'mouse' : 'touch';
  if (!G.running) return;
  const x = e.clientX, y = e.clientY;
  if (G.mapOpen) { G.mapOpen = false; return; }
  const hit = hitButton(x, y);
  if (hit) { PTR.set(e.pointerId, hit); press(hit); return; }
  if (G.dialog && y > G.dialogBox.y && y < G.dialogBox.y + G.dialogBox.h) { advanceDialog(); return; }
  if (x < SW * 0.5) {
    // the left half only ever moves: a new touch there always takes over the stick, even if an old one got stuck
    if (STICK) PTR.delete(STICK.id);
    STICK = { id: e.pointerId, ox: x, oy: y, x, y }; PTR.set(e.pointerId, 'stick');
    try { cv.setPointerCapture(e.pointerId); } catch (_) {}
    return;
  }
  PTR.set(e.pointerId, 'atk'); press('atk');
}, { passive: false });
cv.addEventListener('pointermove', e => {
  if (!STICK || e.pointerId !== STICK.id) return;
  if (e.pointerType === 'mouse' && !(e.buttons & 1)) { ptrUp(e); return; }
  STICK.x = e.clientX; STICK.y = e.clientY;
  const dx = STICK.x - STICK.ox, dy = STICK.y - STICK.oy, l = Math.hypot(dx, dy), R = UI.stickR;
  if (l > R * 1.25) { STICK.ox = STICK.x - dx / l * R * 1.25; STICK.oy = STICK.y - dy / l * R * 1.25; }
});
function ptrUp(e) {
  const role = PTR.get(e.pointerId); PTR.delete(e.pointerId);
  if (STICK && e.pointerId === STICK.id) STICK = null;
  if (role === 'atk' && ![...PTR.values()].includes('atk')) IN.atkHeld = false;
}
// a finger can lift over a menu or off the canvas, so listen for it on the whole window
window.addEventListener('pointerup', ptrUp, true); window.addEventListener('pointercancel', ptrUp, true);
cv.addEventListener('lostpointercapture', e => { if (STICK && e.pointerId === STICK.id) ptrUp(e); });
// safety net: with no fingers on the glass, nothing can still be held
const noTouches = e => { if (e.touches.length === 0) { STICK = null; PTR.clear(); IN.atkHeld = false; } };
window.addEventListener('touchend', noTouches, true); window.addEventListener('touchcancel', noTouches, true);
window.addEventListener('blur', resetInput);
cv.addEventListener('contextmenu', e => e.preventDefault());
window.addEventListener('keydown', e => {
  if (e.repeat) return;
  IN.keys[e.code] = true; auResume(); IN.mode = 'keys';
  if (!G.running) return;
  if (e.code === 'Space' || e.code === 'KeyJ') { IN.atkHeld = true; IN.atkPress = true; e.preventDefault(); }
  if (e.code === 'KeyE' || e.code === 'Enter') IN.usePress = true;
  if (e.code === 'KeyM') toggleMap();
  if (e.code === 'KeyQ') IN.switchPress = true;
  if (e.code === 'KeyR') IN.reloadPress = true;
  if (e.code === 'KeyH') IN.medPress = true;
  if (e.code === 'Escape' || e.code === 'KeyP') { if (G.paused) closeMenu(); else openMenu(); }
});
window.addEventListener('keyup', e => { IN.keys[e.code] = false; if (e.code === 'Space' || e.code === 'KeyJ') IN.atkHeld = false; });
function readInput() {
  let mx = 0, my = 0;
  if (STICK) {
    // small tilts creep, full tilt runs: past a 10% dead zone, speed follows a gentle curve
    const dx = STICK.x - STICK.ox, dy = STICK.y - STICK.oy, l = Math.hypot(dx, dy), R = UI.stickR;
    if (l > R * 0.1) { const t = clamp((l / R - 0.1) / 0.8, 0, 1), m = 0.18 + 0.82 * Math.pow(t, 1.4); mx = dx / l * m; my = dy / l * m; }
  }
  const K = IN.keys;
  const kx = (K.KeyD || K.ArrowRight ? 1 : 0) - (K.KeyA || K.ArrowLeft ? 1 : 0), ky = (K.KeyS || K.ArrowDown ? 1 : 0) - (K.KeyW || K.ArrowUp ? 1 : 0);
  if (kx || ky) { const l = Math.hypot(kx, ky); mx = kx / l; my = ky / l; }
  IN.mx = mx; IN.my = my;
}

// ================= game state =================
const DAY_LEN = 300;
// every run starts late in the afternoon: dusk in about ten seconds, night in about thirty, so the first town falls in the first two minutes
const START_DAY = 0.7;
export const G = {
  ngp: 0, prog: { chests: {}, ganglia: {}, won: false, files: {}, houses: {}, searched: {}, doomed: {}, lost: {}, hints: {}, marked: {} }, diff: 'easy', permaDead: false, hintArrow: null, endMode: 'win', endT: 0, stillT: 0, kick: { x: 0, y: 0 }, flash: 0, dayN: 0, search: null, hittables: [],
  running: false, paused: false, seed: 0, t: 0, day: 0.3, L: null, over: null, levels: new Map(), P: null,
  cam: { x: 0, y: 0 }, parts: [], toasts: [], shake: 0, mapOpen: false, dialog: null, dialogBox: { y: 0, h: 0 },
  fade: null, beat: 9, hurtFlash: 0, stats: { kills: 0, time: 0, deaths: 0 }, lastTown: -1, curTown: 0,
  maxDepth: 0, use: null, pops: [], spawnT: 0, saveT: 0, hintT: 25, settings: {},
};
// ---- the surface wraps: shortest offsets across the edge ----
export function wdx(L, d) { if (!L.wrap) return d; const S = L.w * TS; return d - S * Math.round(d / S); }
export function wdy(L, d) { if (!L.wrap) return d; const S = L.h * TS; return d - S * Math.round(d / S); }
export function wrapPos(L, e) { if (!L.wrap) return; const Wp = L.w * TS, Hp = L.h * TS; if (e.x < 0) e.x += Wp; else if (e.x >= Wp) e.x -= Wp; if (e.y < 0) e.y += Hp; else if (e.y >= Hp) e.y -= Hp; }
// where something should be drawn/aimed at: its copy nearest to the reference point
export function nearX(L, x, ref) { return ref + wdx(L, x - ref); }
export function nearY(L, y, ref) { return ref + wdy(L, y - ref); }
// distance that takes the shortcut across the wrapping edge of the surface
export function wdist(L, x1, y1, x2, y2) { return Math.hypot(wdx(L, x2 - x1), wdy(L, y2 - y1)); }
const WALK = 88; // walking speed in pixels per second
function makePlayer(x, y) {
  return { type: 'player', x, y, r: 5, vx: 0, vy: 0, hp: DIFF.hearts, maxHp: DIFF.hearts, dmg: 1, fx: 0, fy: 1, dir: 0, anim: 0, moving: false, inv: 0, kx: 0, ky: 0, dead: false,
    guns: [{ id: 'bat' }, { id: 'pistol', mag: 12 }], gi: 1, ammo: { light: DIFF.startAmmo, shell: 0, heavy: 0 }, meds: DIFF.meds, vessels: 0, fireCool: 0, bloom: 0, reload: 0, reloadMax: 1, aimT: 0, aimAng: 0, target: null };
}
function nightF() {
  if (!G.L || G.L.kind !== 'over') return 0;
  const l = 0.5 - 0.5 * Math.cos(G.day * TAU);
  return 1 - smooth(0.22, 0.5, l);
}
function duskF() { const l = 0.5 - 0.5 * Math.cos(G.day * TAU); return smooth(0.18, 0.34, l) * (1 - smooth(0.34, 0.55, l)); }
export function beatEnv() { const b = G.beat; return Math.exp(-b * 6) + (b > 0.22 ? 0.7 * Math.exp(-(b - 0.22) * 7) : 0); }

// ================= map / reveal =================
export function initMap(L) {
  L.mapCanvas = document.createElement('canvas'); L.mapCanvas.width = L.w; L.mapCanvas.height = L.h;
  L.mapImg = L.mapCanvas.getContext('2d').createImageData(L.w, L.h); L.mapDirty = true;
}
export function paintSeen(L, i) {
  const c = L.atlas.avg[L.t[i]], j = i * 4, d = L.mapImg.data, k = 0.92 + (L.v[i] & 3) * 0.03;
  d[j] = c[0] * k; d[j + 1] = c[1] * k; d[j + 2] = c[2] * k; d[j + 3] = 255;
}
function revealAround(L, tx, ty, rad) {
  const r2 = rad * rad;
  for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
    if (dx * dx + dy * dy > r2) continue;
    const x = tx + dx, y = ty + dy; if (!L.wrap && !L.inb(x, y)) continue;
    const i = L.wrap ? L.idx(x, y) : y * L.w + x; if (L.seen[i]) continue;
    L.seen[i] = 1; paintSeen(L, i); L.mapDirty = true;
  }
}
function refreshMap(L) { if (L.mapDirty) { L.mapCanvas.getContext('2d').putImageData(L.mapImg, 0, 0); L.mapDirty = false; } }

// ================= world setup =================
export function freshProg() { return { chests: {}, ganglia: {}, won: false, files: {}, houses: {}, searched: {}, doomed: {}, lost: {}, hints: {}, marked: {} }; }
// paints and map canvas: only for the world you actually play (the tests skip this)
function dressOverworld(L) { L.atlas = buildAtlas(0, G.seed); initMap(L); }
export function setupOverworld(L) {
  L.key = 'over';
  const R = mulberry32(G.seed ^ 0x1234567);
  L.doorMap = new Map();
  for (const town of L.towns) {
    for (const h of town.houses) { h.town = town; h.key = h.door[0] + ',' + (h.door[1] - 1); L.doorMap.set(h.key, h); if (h.light && !houseOccupied(h)) h.light.r = 0; }
    (town.corpses || []).forEach((c, k) => { const e = makeCorpse(c.x, c.y); e.key = `o${town.idx}-${k}`; e.pool = 'surface'; L.ents.push(e); });
    if (town.fog) continue;
    let n = town.kind === 'city' ? 7 + Math.floor(R() * 4) : town.kind === 'hamlet' ? (R() < 0.6 ? 1 : 0) : 2 + Math.floor(town.houses.length / 2);
    if (town.idx === L.fallTown) n = Math.max(n + 1, 4); // the town that falls on the first night needs a crowd to walk out
    for (let k = 0; k < n; k++) {
      for (let tries = 0; tries < 30; tries++) {
        const x = town.x + Math.round((R() - 0.5) * town.r * 1.6), y = town.y + Math.round((R() - 0.5) * town.r * 1.6);
        if (L.solid(x, y) || TP[L.get(x, y)].water || L.townMap[y * L.w + x] !== town.idx + 1) continue;
        L.ents.push(makeNPC('v' + (k & 3), x * TS + 8, y * TS + 8, town, 'villager', pick(R, NPC_NAMES)));
        break;
      }
    }
    if (town.kind !== 'hamlet') {
      let h = town.kind === 'city' ? town.plaza : [town.x + 1, town.y + 2];
      if (TP[L.get(h[0], h[1])].solid || TP[L.get(h[0], h[1])].water) { h = townCentre(L, town); fixCount(L, 'npc-home'); }
      L.ents.push(makeNPC('healer', h[0] * TS + 8, h[1] * TS + 8, town, 'healer', 'Healer ' + pick(R, NPC_NAMES)));
    }
  }
}
export function makeCorpse(x, y) {
  return { type: 'corpse', x, y, r: 5, searched: false, z: y - 6,
    draw(e, cx, cy) { bctx.fillStyle = 'rgba(90,10,16,0.75)'; bctx.fillRect(Math.round(e.x - 7 - cx), Math.round(e.y - cy), 13, 3); bctx.fillRect(Math.round(e.x - 5 - cx), Math.round(e.y - 1 - cy), 9, 5); drawSpr('corpse', e.x, e.y + 5, false, cx, cy); } };
}
function townSpot(L, t) {
  const c = nearestTile(L, t.x, t.y + 1, 8, (x, y) => !TP[L.get(x, y)].solid && !TP[L.get(x, y)].water) || [t.x, t.y + 1];
  return [c[0] * TS + 8, c[1] * TS + 8];
}
export function newGame(seed, save, carry, diffId) {
  setDifficulty(save ? (save.diff || 'hard') : diffId || G.diff || 'easy');
  showLoading('Growing the world...');
  setTimeout(() => {
    G.seed = seed >>> 0; G.levels.clear(); G.parts = []; G.toasts = []; G.pops = []; G.dialog = null; G.fade = null; G.mapOpen = false;
    G.stats = { kills: 0, time: 0, deaths: 0 }; G.maxDepth = 0; G.prog = freshProg(); G.dungeon = null; G.wasNight = false; G.crawlWarned = false; G.dayN = 0; G.search = null; G.lastTown = -1; G.curTown = 0; G.day = START_DAY; G.fallWait = 0; G.breachWarned = false; G.climbWarned = false;
    if (save) save = migrateSave(save);
    const test = G.testJump; G.testJump = null; G.testWorld = !!test;
    // same seed, same world: checks run on start, and a world that still fails after its fixes quietly becomes the next variant
    const L = makeWorld(G.seed, save ? save.wv : test ? test.v : null); dressOverworld(L); G.variant = L.variant;
    G.over = L; G.levels.set('over', L);
    G.P = makePlayer(L.spawn.x, L.spawn.y);
    G.ngp = save ? (save.ngp || 0) : carry ? carry.ngp : 0; G.endT = 0; G.stillT = 0;
    G.permaDead = false; G.hintArrow = null;
    if (carry) { G.P.vessels = carry.vessels || 0; G.P.maxHp = DIFF.hearts + 2 * G.P.vessels; G.P.hp = G.P.maxHp; G.P.guns = carry.guns; G.P.gi = 0; G.P.ammo = carry.ammo; G.P.meds = carry.meds; }
    let sx = L.spawn.x, sy = L.spawn.y, lvl = L;
    if (save) { applySave(save, L); if (G.maxDepth) growSurfaceVeins(); }
    if (save && save.lastTown >= 0 && L.towns[save.lastTown]) [sx, sy] = townSpot(L, L.towns[save.lastTown]);
    if (save && save.loc) { try { lvl = getLevel(save.loc.key || 'over'); sx = save.loc.x; sy = save.loc.y; } catch (e) { lvl = L; } }
    // a floor can be built differently than when you saved (or its walls have moved): never wake up inside a wall
    if (lvl && lvl !== L && lvl.start && lvl.solid(Math.floor(sx / TS), Math.floor(sy / TS))) { sx = lvl.start.x; sy = lvl.start.y; }
    if (test) { const c = nearestTile(L, test.x, test.y, 12, (x, y) => !L.blockedFor(x, y)) || [test.x, test.y]; sx = c[0] * TS + 8; sy = c[1] * TS + 8; G.testMark = { x: test.x, y: test.y, t: 0 }; }
    else G.testMark = null;
    enterLevel(lvl, sx, sy); tipsReset();
    G.running = true; G.paused = false; hideAll();
    if (test) toast('Test world · not saved', test.msg, 7);
    else if (carry) toast(`New Game+ ${G.ngp}`, 'Another island. Another Shift. It already knows your name.');
    else if (!save) showIntro();
    else toast('Welcome back', (L.towns[G.lastTown] || L.towns[L.spawnTown]).name);
    saveGame();
  }, 40);
}
// saves made before the world started wrapping point at a different map: keep your kit and progress below, drop the old surface details
const GEN_V = 3; // 3: the first stairs sit next to a living town, the one that falls on the first night
function migrateSave(s) {
  if ((s.gen || 1) === GEN_V) return s;
  s = Object.assign({}, s, { gen: GEN_V, wv: null, seen: null, towns: null, dung: null, lastTown: -1 });
  if (s.loc && !(s.loc.key === 'flesh' || /^m\d/.test(s.loc.key || ''))) s.loc = null;
  if (s.prog) s.prog = Object.assign({}, s.prog, { houses: {}, searched: {}, doomed: {}, lost: {}, hints: {}, marked: {} });
  return s;
}
export function enterLevel(L, x, y) {
  G.L = L; const P = G.P; P.x = x; P.y = y; P.kx = P.ky = 0; P.vx = P.vy = 0;
  FLOW.t = 0; FLOW.ptx = -9999;
  G.parts = []; G.dialog = null; G.curTown = 0;
  snapCam();
  revealAround(L, Math.floor(x / TS), Math.floor(y / TS), L.kind === 'over' ? 11 : 6);
}
export function transition(text, sub, fn, dur = 1.8) { G.fade = { t: 0, dur, text, sub, mid: fn, done: false }; }
// ================= combat helpers =================
export function burst(x, y, col, n, spd = 1) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, s = (20 + Math.random() * 60) * spd;
    G.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.3 + Math.random() * 0.4, max: 0.7, col: shd(col, 0.7 + Math.random() * 0.5), sz: Math.random() < 0.3 ? 2 : 1 });
  }
}
export function hurtPlayer(dmg, sx, sy) {
  const P = G.P; if (P.inv > 0 || P.dead || G.fade) return;
  P.hp -= dmg * DIFF.dmg; P.inv = DIFF.inv;
  const a = Math.atan2(P.y - sy, P.x - sx); P.kx = Math.cos(a) * 170; P.ky = Math.sin(a) * 170;
  G.shake = 0.25; G.hurtFlash = 0.35; sfx('hurt'); burst(P.x, P.y, [200, 30, 40], 8);
  if (G.L.kind === 'flesh') fleshAlarm(G.L, P.x, P.y);
  if (P.hp <= 0) { P.hp = 0; playerDie(); }
}
function playerDie() {
  const P = G.P; P.dead = true; G.stats.deaths++;
  if (DIFF.perma) {
    G.permaDead = true; try { localStorage.removeItem(SAVE_KEY); } catch (e) { }
    transition('You fall.', 'On Impossible there is no waking up.', showPermaDeath, 3.2); return;
  }
  transition('You fall.', '...and wake somewhere familiar.', respawn, 3.2);
}
function showPermaDeath() {
  G.paused = true; G.endMode = 'perma'; IN.atkHeld = false; STICK = null; PTR.clear();
  const st = G.stats;
  $('endTitle').textContent = 'The Shift wins.'; $('endSub').textContent = 'This world is gone. Nothing of it was saved.';
  $('endStats').innerHTML = `Time ${fmtTime(st.time)}<br>Things killed ${st.kills}<br>Deepest floor ${G.maxDepth}`;
  $('btnNGP').textContent = 'New world (Impossible)'; $('btnStay').textContent = 'Back to the title';
  $('ending').classList.remove('hidden');
}
function respawn() {
  const P = G.P, L = G.over; let town = L.towns[G.lastTown];
  if (!town || town.fog || town.doomed) town = findHaven(L, P.x / TS, P.y / TS);
  P.hp = P.maxHp; P.dead = false; P.inv = 2;
  L.ents = L.ents.filter(e => e.type !== 'enemy' && e.type !== 'proj');
  const [x, y] = townSpot(L, town); enterLevel(L, x, y);
}
export function damageEnemy(e, dmg, nx, ny, kb0 = 170) {
  const col = e.d ? e.d.col : (e.col || [200, 60, 70]);
  if (e.shielded) { burst(e.x - nx * e.r, e.y - ny * e.r, [190, 140, 230], 6); sfx('hit'); if (e.onShield) e.onShield(); return; }
  e.hp -= dmg; e.hurt = 0.22;
  if (e.onHit) e.onHit(e);
  if (G.L.kind === 'flesh') fleshAlarm(G.L, G.P.x, G.P.y);
  const kb = e.heavy ? 0 : kb0; e.kx = nx * kb; e.ky = ny * kb;
  sfx('hit'); burst(e.x, e.y, col, 5); G.shake = Math.max(G.shake, 0.08);
  if (e.hp <= 0) {
    e.dead = true; G.stats.kills++; sfx('kill'); burst(e.x, e.y, col, 14, 1.6);
    if (G.L.kind === 'flesh') sfx('squelch');
    if (e.onDeath) e.onDeath(e);
    else if (e.d) {
      const P = G.P;
      if (Math.random() < e.d.drop * DIFF.drop * (P.hp < P.maxHp ? 1.6 : 0.5)) G.L.ents.push({ type: 'pickup', kind: 'heart', x: e.x, y: e.y, r: 4, t: 0 });
      else if (Math.random() < (0.2 + (G.L.kind === 'over' ? 0 : 0.1)) * DIFF.drop) { const t = ammoTypeFor(P); G.L.ents.push({ type: 'pickup', kind: 'ammo', ammoType: t, n: t === 'light' ? 6 : 2, x: e.x, y: e.y, r: 4, t: 0 }); }
    }
  }
}

// ================= update =================
function update(dt) {
  G.t += dt; G.beat += dt; G.stats.time += dt;
  if (G.fade) {
    G.fade.t += dt;
    if (!G.fade.done && G.fade.t >= G.fade.dur * 0.5) { G.fade.done = true; if (G.fade.mid) G.fade.mid(); }
    if (G.fade && G.fade.t >= G.fade.dur) G.fade = null;
  }
  const L = G.L, P = G.P;
  if (L.kind === 'over' || L.kind === 'house') { const pd = G.day; G.day = (G.day + dt / DAY_LEN) % 1; if (G.day < pd) G.dayN = (G.dayN || 0) + 1; }
  shiftTick(dt);
  const kk = Math.exp(-dt * 18); G.kick.x *= kk; G.kick.y *= kk; G.flash = Math.max(0, G.flash - dt);
  updateSearch(dt);
  if (G.prog.won) G.stillT = (G.stillT || 0) + dt;
  if (G.endT > 0) { G.endT -= dt; if (G.endT <= 0) showEnding(); }
  readInput();
  G.hittables = L.ents.filter(e => e.hittable && !e.dead);
  const frozen = !!G.fade || P.dead || G.mapOpen;
  updatePlayer(dt, frozen);
  updateFlow(L, P, dt);
  for (const e of L.ents) {
    if (e.dead) continue;
    switch (e.type) {
      case 'enemy': updEnemy(e, dt, L, P); break;
      case 'npc': updNPC(e, dt, L, P); break;
      case 'proj': updProj(e, dt, L, P); break;
      case 'pickup': updPickup(e, dt, P); break;
      case 'bullet': updBullet(e, dt, L); break;
      default: if (e.update) e.update(e, dt, L, P);
    }
  }
  separate(L);
  let w = 0; for (let i = 0; i < L.ents.length; i++) if (!L.ents[i].dead) L.ents[w++] = L.ents[i]; L.ents.length = w;
  if (L.kind === 'over') overworldSpawns(dt);
  if (L.spawner) L.spawner(L, dt);
  for (const p of G.pops) p.t += dt; if (G.pops.length) G.pops = G.pops.filter(p => p.t < POP_LIFE);
  for (const p of G.parts) { p.x += p.vx * dt; p.y += p.vy * dt; const k = Math.exp(-dt * 5); p.vx *= k; p.vy *= k; p.life -= dt; }
  G.parts = G.parts.filter(p => p.life > 0);
  if (G.toasts.length) { G.toasts[0].t += dt; if (G.toasts[0].t >= G.toasts[0].dur) G.toasts.shift(); }
  G.shake = Math.max(0, G.shake - dt); G.hurtFlash = Math.max(0, G.hurtFlash - dt); G.hintT -= dt;
  if (G.hintArrow) { G.hintArrow.t -= dt; if (G.hintArrow.t <= 0) G.hintArrow = null; }
  // dialog
  if (G.dialog) {
    const d = G.dialog, before = Math.floor(d.shown); d.shown = Math.min(d.text.length, d.shown + dt * 48);
    if (Math.floor(d.shown) !== before && Math.floor(d.shown) % 3 === 0) sfx('talk');
    if (d.npc && wdist(G.L, d.npc.x, d.npc.y, P.x, P.y) > 48) G.dialog = null;
  }
  G.use = frozen ? null : findUse();
  if (IN.usePress && G.use) { noteUse(G.use.label); G.use.act(); }
  const ptx = Math.floor(P.x / TS), pty = Math.floor(P.y / TS);
  const fogT = L.fog ? L.fog[pty * L.w + ptx] / 255 : 0; G.fogCur = (G.fogCur || 0) + (fogT - (G.fogCur || 0)) * Math.min(1, dt * 1.2);
  revealAround(L, ptx, pty, L.kind === 'over' ? 11 : L.revealR || 5);
  if (L.kind === 'over') overworldTick(dt, ptx, pty);
  if (L.tick) L.tick(L, dt);
  auUpdate(dt, audioEnv());
  G.saveT += dt; if (G.saveT > 15) { G.saveT = 0; saveGame(); }
  tipsUpdate(dt);
  IN.atkPress = IN.usePress = IN.switchPress = IN.reloadPress = IN.medPress = false;
}
function updatePlayer(dt, frozen) {
  const P = G.P, L = G.L;
  P.inv = Math.max(0, P.inv - dt);
  const mx = frozen ? 0 : IN.mx, my = frozen ? 0 : IN.my, mag = Math.hypot(mx, my);
  const tid = L.get(Math.floor(P.x / TS), Math.floor(P.y / TS));
  const sp = WALK * TP[tid].speed * (P.fireCool > 0 ? 0.85 : 1);
  // velocity eases toward the stick: full speed in about 0.1 s, a short glide to a stop
  const a = 1 - Math.exp(-dt * (mag > 0.05 ? 26 : 15));
  P.vx += (mx * sp - P.vx) * a; P.vy += (my * sp - P.vy) * a;
  const ox = P.x, oy = P.y, wx = P.vx * dt, wy = P.vy * dt;
  moveBody(P, wx + P.kx * dt, wy + P.ky * dt, L, false);
  // pushing into a wall: bleed off that speed so turning away doesn't feel sticky
  if (Math.abs(wx) > 0.05 && Math.abs(P.x - ox) < Math.abs(wx) * 0.3) P.vx *= 0.4;
  if (Math.abs(wy) > 0.05 && Math.abs(P.y - oy) < Math.abs(wy) * 0.3) P.vy *= 0.4;
  if (L.wrap) { const ox = P.x, oy = P.y; wrapPos(L, P); G.cam.x += P.x - ox; G.cam.y += P.y - oy; }
  const kd = Math.exp(-dt * 12); P.kx *= kd; P.ky *= kd;
  const spd = Math.hypot(P.vx, P.vy);
  P.moving = spd > 9;
  if (P.moving) {
    P.anim += dt * (5 + 6 * Math.min(1, spd / WALK)) * TP[tid].speed;
    if (P.aimT <= 0 && mag > 0.05) { P.fx = mx / mag; P.fy = my / mag; P.dir = Math.abs(mx) > Math.abs(my) ? (mx < 0 ? 2 : 3) : (my < 0 ? 1 : 0); }
    if (TP[tid].water && Math.random() < dt * 10) G.parts.push({ x: P.x + (Math.random() - 0.5) * 8, y: P.y + 4, vx: 0, vy: 0, life: 0.4, max: 0.4, col: [190, 220, 250], sz: 1 });
  }
  updateGun(P, L, dt, frozen);
  if (TP[tid].hurt && !P.dead) hurtPlayer(1, P.x - P.fx * 4, P.y - P.fy * 4);
}
function updEnemy(e, dt, L, P) {
  e.anim += dt; if (e.hurt > 0) e.hurt -= dt; e.cool -= dt;
  const d = e.d, dx = wdx(L, P.x - e.x), dy = wdy(L, P.y - e.y), dd = Math.hypot(dx, dy) || 1;
  const aggroR = (L.immune && L.immune.at > 0 && e.kind === 'antibody') ? 330 : d.aggro * (L.kind === 'over' ? 1 + nightF() * 0.4 : 1);
  let mx = 0, my = 0;
  const aggro = dd < aggroR && !P.dead && !G.fade;
  if (aggro && d.beh !== 'turret') {
    const f = flowDir(e);
    if (f === 'direct') { mx = dx / dd; my = dy / dd; }
    else if (f) { mx = f[0]; my = f[1]; }
    else if (dd < 40) { mx = dx / dd; my = dy / dd; }
  } else if (d.beh !== 'turret') {
    e.wt -= dt;
    if (e.wt <= 0) { e.wt = 1 + Math.random() * 2; e.wdir = Math.random() * TAU; e.idle = Math.random() < 0.4; }
    if (!e.idle) { mx = Math.cos(e.wdir) * 0.45; my = Math.sin(e.wdir) * 0.45; }
  }
  let spd = d.spd * (1 + 0.08 * (G.ngp || 0));
  if (d.beh === 'hop') { e.hopT += dt; if ((e.hopT % 1) > 0.45) { mx = 0; my = 0; } else spd *= 1.8; }
  moveBody(e, (mx * spd + e.kx) * dt, (my * spd + e.ky) * dt, L, true); wrapPos(L, e);
  if (e.bumped && !aggro) e.wt = 0;
  const kd = Math.exp(-dt * 10); e.kx *= kd; e.ky *= kd;
  e.moving = Math.abs(mx) + Math.abs(my) > 0.05;
  if (Math.abs(mx) > 0.1) e.face = mx < 0 ? -1 : 1;
  if (e.moving) e.dir = Math.abs(mx) > Math.abs(my) ? (mx < 0 ? 2 : 3) : (my < 0 ? 1 : 0);
  if (dd < e.r + P.r + 1 && e.hurt <= 0.1) hurtPlayer(d.dmg, e.x, e.y);
  if (d.shoot && aggro && e.cool <= 0 && dd < d.aggro) {
    e.cool = d.shoot * (0.8 + Math.random() * 0.4); e.mouth = 0.4; sfx('spit');
    const s = 80; L.ents.push({ type: 'proj', x: e.x, y: e.y - 3, vx: dx / dd * s, vy: dy / dd * s, r: 2.5, dmg: 1, life: 3, spr: 'spore' });
  }
  if (e.mouth) e.mouth = Math.max(0, e.mouth - dt);
}
function updNPC(n, dt, L, P) {
  const dp = wdist(L, n.x, n.y, P.x, P.y); if (dp > TS * 40) return;
  if (n.entranced) { updEntranced(n, dt, L); return; }
  n.anim += dt;
  if (dp < 30) {
    n.moving = false; const dx = wdx(L, P.x - n.x), dy = wdy(L, P.y - n.y);
    n.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 2 : 3) : (dy < 0 ? 1 : 0); return;
  }
  n.wt -= dt;
  if (n.wt <= 0) {
    n.wt = 1.5 + Math.random() * 3; n.idle = Math.random() < 0.5; n.wdir = Math.random() * TAU;
    const hx = n.home.x - n.x, hy = n.home.y - n.y; if (Math.hypot(hx, hy) > n.home.rad) { n.wdir = Math.atan2(hy, hx); n.idle = false; }
  }
  if (n.idle) { n.moving = false; return; }
  const mx = Math.cos(n.wdir), my = Math.sin(n.wdir);
  moveBody(n, mx * 20 * dt, my * 20 * dt, L, false);
  if (n.bumped) n.wt = Math.min(n.wt, 0.2);
  n.moving = true; n.dir = Math.abs(mx) > Math.abs(my) ? (mx < 0 ? 2 : 3) : (my < 0 ? 1 : 0);
}
function updProj(p, dt, L, P) {
  p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
  if (p.life <= 0 || L.solid(Math.floor(p.x / TS), Math.floor(p.y / TS))) { p.dead = true; burst(p.x, p.y, [180, 206, 76], 4, 0.5); return; }
  if (wdist(L, p.x, p.y, P.x, P.y) < P.r + p.r) { p.dead = true; hurtPlayer(p.dmg, p.x - p.vx, p.y - p.vy); }
}
function updPickup(e, dt, P) {
  e.t += dt;
  if (e.t > 30) { e.dead = true; return; }
  if (wdist(G.L, e.x, e.y, P.x, P.y) < P.r + 7) {
    // already full: leave it lying there for later instead of wasting it
    if ((e.kind === 'heart' && P.hp >= P.maxHp) || (e.kind === 'med' && P.meds >= 5)) return;
    e.dead = true;
    if (e.kind === 'heart') { P.hp = Math.min(P.maxHp, P.hp + 2); sfx('pickup'); pop('+1 heart', '#ff8a8a'); }
    else if (e.kind === 'hcont') { P.vessels = (P.vessels || 0) + 1; P.maxHp = Math.min(24, DIFF.hearts + 2 * P.vessels); P.hp = P.maxHp; sfx('upgrade'); toast('Heart vessel', 'Your heart beats a little stronger.'); saveGame(); }
    else if (e.kind === 'ammo') { giveAmmo(P, e.ammoType, e.n); sfx('pickup'); popAll([ammoPop(e.ammoType, e.n)]); }
    else if (e.kind === 'med') { giveMed(P); sfx('pickup'); popAll([MED_POP]); }
    burst(e.x, e.y, [240, 80, 100], 6);
  }
}
function separate(L) {
  const es = L.ents;
  for (let i = 0; i < es.length; i++) {
    const a = es[i]; if (a.type !== 'enemy' || a.dead) continue;
    for (let j = i + 1; j < es.length; j++) {
      const b = es[j]; if (b.type !== 'enemy' || b.dead) continue;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), m = a.r + b.r;
      if (d < m && d > 0.01) {
        const push = (m - d) * 0.5, nx = dx / d * push, ny = dy / d * push;
        if (!a.d.spd || !b.d.spd) continue;
        if (!collides(L, a.x - nx, a.y - ny, a.r, true)) { a.x -= nx; a.y -= ny; }
        if (!collides(L, b.x + nx, b.y + ny, b.r, true)) { b.x += nx; b.y += ny; }
      }
    }
  }
}
function overworldSpawns(dt) {
  G.spawnT -= dt; if (G.spawnT > 0) return; G.spawnT = 1.2;
  const L = G.L, P = G.P; let count = 0;
  for (const e of L.ents) if (e.type === 'enemy') { if (Math.hypot(wdx(L, e.x - P.x), wdy(L, e.y - P.y)) > TS * 34) e.dead = true; else count++; }
  const night = nightF() > 0.5 && !G.prog.won, foggy = G.fogCur > 0.4;
  const target = G.prog.won ? 0 : Math.round(((night ? 10 : 5) + (foggy ? 6 : 0) + 2 * (G.ngp || 0)) * DIFF.spawn);
  if (count >= target || P.dead) return;
  for (let tries = 0; tries < 10; tries++) {
    const a = Math.random() * TAU, d = TS * (13 + Math.random() * 9);
    const x = P.x + Math.cos(a) * d, y = P.y + Math.sin(a) * d, tx = L.wrap ? L.wx(Math.floor(x / TS)) : Math.floor(x / TS), ty = L.wrap ? L.wy(Math.floor(y / TS)) : Math.floor(y / TS);
    if (L.blockedFor(tx, ty, true)) continue;
    if (Math.abs(x - P.x) < BW / 2 + 12 && Math.abs(y - P.y) < BH / 2 + 12) continue;
    const tf = L.fog ? L.fog[ty * L.w + tx] / 255 : 0;
    if (G.prog.won) continue;
    const kind = tf > 0.4 ? 'husk' : night && DIFF.wolves !== false && Math.random() < 0.5 ? 'wolf' : 'husk';
    L.ents.push(makeEnemy(kind, tx * TS + 8, ty * TS + 8));
    break;
  }
}
function overworldTick(dt, ptx, pty) {
  const L = G.L, ti = L.townMap[pty * L.w + ptx] || 0;
  if (ti !== G.curTown) {
    G.curTown = ti;
    if (ti) {
      const town = L.towns[ti - 1]; const first = !town.seen; town.seen = true;
      const kind = town.kind === 'city' ? 'City of ' : town.kind === 'hamlet' ? 'Hamlet of ' : '';
      if (town.fog) { toast('QUARANTINE ZONE', `${town.name}. The fog came up out of the ground. Nobody answers.`, 4); sfx('siren'); }
      else {
        G.lastTown = ti - 1;
        toast(kind + town.name, town.unease > 0.55 ? 'Something hums beneath the floorboards.' : first ? 'People live here. Nothing follows you in.' : 'Safe, for now.');
      }
      saveGame();
    }
  }
  const hid = L.hexOf[pty * L.w + ptx]; if (hid >= 0 && !L.hexes[hid].seen) L.hexes[hid].seen = true;
  if (G.fogCur > 0.3 && Math.random() < dt * 0.05) sfx(Math.random() < 0.6 ? 'static' : 'siren');
  for (const d of L.dungeons) if (!d.seen && Math.abs(wdx(L, (d.x - ptx) * TS)) < TS * 11 && Math.abs(wdy(L, (d.y - pty) * TS)) < TS * 11) { d.seen = true; toast('Old stairs', 'They lead down. The air coming up is warm.'); }
  const nf = nightF();
  if (nf < 0.2 && Math.random() < dt * 0.25) sfx('chirp');
  if (nf > 0.7 && Math.random() < dt * 0.025) sfx('howl');
}
function audioEnv() {
  const L = G.L, P = G.P;
  if (L.kind === 'over') {
    const nf = nightF(); let nd = 1e9;
    for (const d of L.dungeons) nd = Math.min(nd, Math.hypot(wdx(L, d.x * TS + 8 - P.x), wdy(L, d.y * TS + 8 - P.y)));
    const near = 1 - clamp(nd / (TS * 14), 0, 1);
    const f = G.fogCur;
    return { wind: 0.03 + 0.05 * nf + 0.04 * f, windF: (420 + 300 * nf) * (1 - 0.6 * f), drone: 0.06 * near + 0.05 * f, droneF: 44, bpm: 54 + 20 * near, beatVol: 0.4 * near * near };
  }
  if (L.audio) return L.audio(L, P);
  return { wind: 0.02, windF: 300, drone: 0.05, droneF: 46, bpm: 60, beatVol: 0.1 };
}
function findUse() {
  const P = G.P, L = G.L;
  if (G.dialog) return { label: 'Next', act: advanceDialog };
  if (G.search) return { label: 'Searching', act: () => {}, prog: G.search.t / G.search.dur };
  const ptx = Math.floor(P.x / TS), pty = Math.floor(P.y / TS);
  for (const [ox, oy] of [[0, 0], [0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const tx = ptx + ox, ty = pty + oy, t = L.get(tx, ty);
    if ((ox || oy) && dist(P.x, P.y, tx * TS + 8, ty * TS + 8) > 18) continue;
    if (t === T.DUNGEON) return { label: 'Descend', act: () => enterDungeon(tx, ty) };
    if (t === T.STAIRS_DOWN && L.goDown) return { label: 'Descend', act: () => L.goDown(L) };
    if (t === T.STAIRS_UP && L.goUp) return { label: 'Climb', act: () => L.goUp(L) };
    if (t === T.FMOUTH && L.goUp) return { label: 'Climb', act: () => L.goUp(L) };
    if ((t === T.DOOR || t === T.CDOOR) && L.doorMap && oy <= 0) { const h = L.doorMap.get(tx + ',' + ty); if (h) return houseOccupied(h) ? { label: 'Knock', act: () => { sfx('knock'); toast('Someone lives here', pick(Math.random, KNOCK_LINES), 3); } } : { label: 'Enter', act: () => enterHouse(h) }; }
    if (t === T.ISHELF && L.stashes && oy <= 0) { const st = L.stashes.get(tx + ',' + ty); if (st) return { label: stashSearchable(st) ? 'Search' : 'Searched', act: () => stashSearchable(st) ? startSearch(st) : searchStash(st) }; }
    if (t === T.IMAT && L.goUp) return { label: 'Leave', act: () => L.goUp(L) };
  }
  let best = null, bd = 26;
  for (const e of L.ents) if (L.wrap && Math.abs(wdx(L, e.x - P.x)) > 40) continue; else if ((e.type === 'npc' && !e.entranced) || (e.type === 'chest' && !e.open) || (e.type === 'corpse' && !e.searched && !G.prog.searched[e.key])) { const d = wdist(L, e.x, e.y, P.x, P.y); if (d < bd) { bd = d; best = e; } }
  if (best) {
    if (best.type === 'corpse') return { label: 'Search', act: () => startSearch(best) };
    if (best.type === 'npc') return { label: best.role === 'healer' ? 'Heal' : 'Talk', act: () => talkTo(best) };
    return { label: 'Open', act: () => openChest(best) };
  }
  return null;
}
function npcLine(n) {
  const pool = G.maxDepth > 0 && Math.random() < 0.5 ? LINES_DEEP : (Math.random() < n.town.unease * 0.9 ? LINES_UNEASY : LINES_CALM);
  let line = pick(Math.random, pool);
  if (line === n.lastLine) line = pick(Math.random, pool);
  n.lastLine = line; return line;
}
function talkTo(n) {
  let text;
  if (n.role === 'healer') {
    text = pick(Math.random, LINES_HEALER);
    if (G.P.hp < G.P.maxHp) { G.P.hp = G.P.maxHp; sfx('heal'); burst(G.P.x, G.P.y, [255, 230, 140], 12); }
  } else text = fallHint(n) || stairsHint(n) || npcLine(n);
  n.talked = true;
  G.dialog = { name: n.name, text, shown: 0, npc: n };
}
function advanceDialog() { const d = G.dialog; if (!d) return; if (d.shown < d.text.length) d.shown = d.text.length; else G.dialog = null; }
function openChest(c) { c.open = true; if (c.onOpen) c.onOpen(c); }
// a short line of text that floats up from your head (what you picked up)
export function pop(text, col = '#ffe9b0', delay = 0) { G.pops.push({ text, col, t: -delay }); }
function drawPops() {
  const P = G.P, rc = G.rc; if (!rc || !G.pops.length) return;
  const k = SCALE / DPR, x = (P.x - rc.cx) * k, y0 = (P.y - rc.cy - 16) * k;
  ctx.save(); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(10,4,8,0.85)'; ctx.lineJoin = 'round';
  for (const p of G.pops) {
    if (p.t < 0) continue;
    const y = y0 - p.t * 36 * UI.s - 6 * UI.s, a = clamp(Math.min(p.t / 0.15, (POP_LIFE - p.t) / 0.5), 0, 1);
    ctx.globalAlpha = a; ctx.font = `600 ${Math.round(13 * UI.s)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.strokeText(p.text, x, y); ctx.fillStyle = p.col; ctx.fillText(p.text, x, y);
  }
  ctx.restore();
}
const POP_LIFE = 1.9;
export function toast(title, sub, dur = 3.4) { if (G.toasts.some(t => t.title === title)) return; G.toasts.push({ title, sub, t: 0, dur }); if (G.toasts.length > 3) G.toasts.splice(1, 1); }

// ================= render =================
const LOOK = { x: 0, y: 0 };
function snapCam() {
  const P = G.P; LOOK.x = LOOK.y = 0;
  G.cam.x = P.x - BW / 2; G.cam.y = P.y - BH / 2 - 8; clampCam();
}
// Levels bigger than the screen are never clamped: the camera keeps you centred even in a corner,
// so the HUD never sits on top of you. Rooms smaller than the screen stay centred as before.
function clampCam() {
  const L = G.L, ww = L.w * TS, wh = L.h * TS; if (L.wrap) return;
  if (ww <= BW) G.cam.x = (ww - BW) / 2;
  if (wh <= BH) G.cam.y = (wh - BH) / 2;
}
// follows you smoothly at any frame rate, leaning a little the way you are walking
function updateCam(dt) {
  const P = G.P;
  // net lead once settled is about 25 px sideways and 17 px up/down (the follow lag eats the rest)
  const la = 1 - Math.exp(-dt * 3);
  LOOK.x += (clamp(P.vx * 0.45, -40, 40) - LOOK.x) * la; LOOK.y += (clamp(P.vy * 0.36, -30, 30) - LOOK.y) * la;
  const k = 1 - Math.exp(-dt * 7);
  G.cam.x += (P.x + LOOK.x - BW / 2 - G.cam.x) * k; G.cam.y += (P.y + LOOK.y - BH / 2 - 8 - G.cam.y) * k; clampCam();
}
function render(dt) {
  const L = G.L, P = G.P;
  updateCam(dt);
  let cx = G.cam.x + G.kick.x, cy = G.cam.y + G.kick.y;
  if (G.shake > 0) { cx += (Math.random() - 0.5) * G.shake * 16; cy += (Math.random() - 0.5) * G.shake * 16; }
  cx = Math.round(cx); cy = Math.round(cy); G.rc = { cx, cy };
  bctx.globalCompositeOperation = 'source-over'; bctx.globalAlpha = 1;
  bctx.fillStyle = L.kind === 'flesh' ? '#2a0408' : '#000'; bctx.fillRect(0, 0, BW, BH);
  drawTiles(L, cx, cy);
  if (L.drawUnder) L.drawUnder(L, cx, cy);
  drawEntities(L, cx, cy);
  for (const p of G.parts) { bctx.globalAlpha = clamp(p.life / p.max * 1.5, 0, 1); bctx.fillStyle = rgb(p.col); bctx.fillRect(Math.round(p.x - cx), Math.round(p.y - cy), p.sz, p.sz); }
  bctx.globalAlpha = 1;
  drawLighting(L, cx, cy);
  drawFog(L, cx, cy);
  drawGlints(L, cx, cy);
  if (L.kind === 'over') drawRedEyes(L, cx, cy);
  drawAim(P, L, cx, cy); drawReticle(P, cx, cy);
  if (G.testMark && L === G.over) drawTestMark(L, cx, cy);
  if (L.kind === 'over') { const df = duskF(); if (df > 0.01) { bctx.fillStyle = `rgba(255,120,60,${0.12 * df})`; bctx.fillRect(0, 0, BW, BH); } }
  if (L.drawOver) L.drawOver(L, cx, cy);
  if (G.hurtFlash > 0) { bctx.fillStyle = `rgba(200,0,20,${G.hurtFlash * 0.6})`; bctx.fillRect(0, 0, BW, BH); }
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingEnabled = false;
  ctx.drawImage(buf, 0, 0, BW * SCALE, BH * SCALE);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  drawHUD();
  if (G.mapOpen) drawMapOverlay();
  if (G.fade) drawFade();
}
// ---- glints: a small twinkle on things you can use, only when you're close ----
const GLINT_R = 5.5; // tiles
function houseWorthVisiting(h) {
  if (houseOccupied(h)) return false;
  const HL = G.levels.get('h:' + h.key); if (!HL) return true; // never been inside
  for (const st of HL.stashes.values()) if (stashSearchable(st)) return true;
  return HL.ents.some(e => e.type === 'corpse' && !e.searched && !G.prog.searched[e.key]);
}
function glint(x, y, d, ph, cx, cy) {
  const a = clamp((GLINT_R - d) / 2, 0, 1); if (a <= 0) return;
  const tw = 0.5 + 0.5 * Math.sin(G.t * 3.2 + ph), big = tw > 0.55;
  const X = Math.round(x - cx), Y = Math.round(y - cy + Math.sin(G.t * 2 + ph) * 0.8);
  bctx.fillStyle = `rgba(255,236,190,${a * (0.35 + 0.45 * tw)})`;
  bctx.fillRect(X - (big ? 2 : 1), Y, big ? 5 : 3, 1); bctx.fillRect(X, Y - (big ? 2 : 1), 1, big ? 5 : 3);
  bctx.fillStyle = `rgba(255,255,240,${a * (0.6 + 0.4 * tw)})`; bctx.fillRect(X, Y, 1, 1);
}
function drawGlints(L, cx, cy) {
  if (G.fade || G.P.dead) return;
  const P = G.P, ptx = Math.floor(P.x / TS), pty = Math.floor(P.y / TS), R = Math.ceil(GLINT_R);
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const tx = ptx + dx, ty = pty + dy, t = L.get(tx, ty);
    let show = false, oy = 3;
    if (t === T.DUNGEON || (t === T.STAIRS_DOWN && L.goDown)) show = true;
    else if ((t === T.DOOR || t === T.CDOOR) && L.doorMap) { const h = L.doorMap.get(L.wx(tx) + ',' + L.wy(ty)); show = !!h && houseWorthVisiting(h); oy = 1; }
    else if (t === T.ISHELF && L.stashes) { const st = L.stashes.get(tx + ',' + ty); show = !!st && stashSearchable(st); oy = 6; }
    if (!show) continue;
    const wx = tx * TS + 8, wy = ty * TS + oy;
    glint(wx, wy, Math.hypot(wx - P.x, wy - P.y) / TS, tx * 1.7 + ty * 2.3, cx, cy);
  }
  for (const e of L.ents) {
    let up;
    if (e.type === 'corpse' && !e.searched && !G.prog.searched[e.key]) up = 7;
    else if (e.type === 'chest' && !e.open) up = 12;
    else if (e.type === 'npc' && !e.entranced && (!e.talked || (e.role === 'healer' && P.hp < P.maxHp))) up = 19;
    else continue;
    const x = nearX(L, e.x, P.x), y = nearY(L, e.y, P.y);
    glint(x + 3, y - up, Math.hypot(x - P.x, y - P.y) / TS, e.x * 0.37 + e.y * 0.11, cx, cy);
  }
}
// the spot a world test flagged: a pulsing ring you can walk to
function drawTestMark(L, cx, cy) {
  const m = G.testMark, x = nearX(L, m.x * TS + 8, G.P.x) - cx, y = nearY(L, m.y * TS + 8, G.P.y) - cy, r = 14 + 5 * Math.sin(G.t * 5);
  bctx.strokeStyle = 'rgba(80,220,255,0.9)'; bctx.lineWidth = 2;
  bctx.beginPath(); bctx.arc(Math.round(x), Math.round(y), r, 0, TAU); bctx.stroke();
  bctx.beginPath(); bctx.moveTo(x - 4, y); bctx.lineTo(x + 4, y); bctx.moveTo(x, y - 4); bctx.lineTo(x, y + 4); bctx.stroke();
}
function drawTiles(L, cx, cy) {
  const wr = !!L.wrap, ed = !!L.edgeAt; // edgeAt: a level that draws scenery past its edges instead of black
  const x0 = wr || ed ? Math.floor(cx / TS) : Math.max(0, Math.floor(cx / TS)), y0 = wr || ed ? Math.floor(cy / TS) : Math.max(0, Math.floor(cy / TS));
  const x1 = wr || ed ? Math.floor((cx + BW) / TS) : Math.min(L.w - 1, Math.floor((cx + BW) / TS)), y1 = wr || ed ? Math.floor((cy + BH) / TS) : Math.min(L.h - 1, Math.floor((cy + BH) / TS));
  const env = beatEnv(), at = L.atlas, W = L.w;
  bctx.fillStyle = 'rgba(0,0,0,0.28)';
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (ed && !wr && !L.inb(x, y)) { const id = L.edgeAt(x, y); bctx.drawImage(at, ((hash2(x, y, 7) * 4) | 0) * FR * TS, id * TS, TS, TS, x * TS - cx, y * TS - cy, TS, TS); continue; }
      const i = wr ? L.idx(x, y) : y * W + x, id = L.t[i], p = TP[id]; let f = 0;
      if (p.anim === 1) f = Math.floor(G.t * 2.2 + ((x * 7 + y * 13) & 3) * 0.5) & 3;
      else if (p.anim === 2 && !G.prog.won) { const ph = Math.sin(G.t * 1.6 - (x * 0.45 + y * 0.3)); f = clamp(Math.floor((ph * 0.22 + 0.25 + env * 0.65) * 4), 0, 3); }
      const sx = x * TS - cx, sy = y * TS - cy;
      bctx.drawImage(at, ((L.v[i] & 3) * FR + f) * TS, id * TS, TS, TS, sx, sy, TS, TS);
      if (!p.solid && (wr || y > 0) && TP[wr ? L.get(x, y - 1) : L.t[i - W]].wall) bctx.fillRect(sx, sy, TS, 3);
    }
  }
}
function humFrame(e) { return e.moving ? [1, 0, 2, 0][Math.floor(e.anim * (e.type === 'player' ? 1 : 6)) & 3] : 0; }
export function drawSpr(name, x, fy, white, cx, cy) {
  const s = SPR[name]; if (!s) return;
  bctx.drawImage(white ? SPRW : SPRC, s.x, s.y, s.w, s.h, Math.round(x - s.w / 2) - cx, Math.round(fy - s.h) - cy, s.w, s.h);
}
export function drawShadow(x, y, w, cx, cy) {
  x = Math.round(x) - cx; y = Math.round(y) - cy;
  bctx.fillStyle = 'rgba(0,0,0,0.26)';
  bctx.fillRect(x - (w >> 1), y - 1, w, 2); bctx.fillRect(x - (w >> 1) + 1, y - 2, w - 2, 4);
}
function drawEntities(L, cx0, cy0) {
  const P = G.P, list = [], mx = cx0 + BW / 2, my = cy0 + BH / 2;
  for (const e of L.ents) {
    e._ox = L.wrap ? nearX(L, e.x, mx) - e.x : 0; e._oy = L.wrap ? nearY(L, e.y, my) - e.y : 0;
    const x = e.x + e._ox, y = e.y + e._oy;
    if (x > cx0 - 40 && x < cx0 + BW + 40 && y > cy0 - 40 && y < cy0 + BH + 60) list.push(e);
  }
  P._ox = P._oy = 0;
  list.push(P); list.sort((a, b) => ((a.z || a.y) + a._oy) - ((b.z || b.y) + b._oy));
  for (const e of list) {
    const fy = e.y + e.r + 2, cx = cx0 - e._ox, cy = cy0 - e._oy;
    switch (e.type) {
      case 'player': {
        if (P.dead) break;
        if (P.inv > 0 && Math.floor(G.t * 14) % 2 === 0) break;
        drawShadow(e.x, e.y + e.r, 10, cx, cy);
        if (e.dir === 1) drawGun(P, cx, cy);
        drawSpr('player' + e.dir + humFrame(e), e.x, fy, false, cx, cy);
        if (e.dir !== 1) drawGun(P, cx, cy);
        if (P.swing > 0) drawSlash(cx, cy);
        break;
      }
      case 'npc': drawShadow(e.x, e.y + e.r, 10, cx, cy); drawSpr(e.pal + e.dir + humFrame(e), e.x, fy, false, cx, cy); break;
      case 'enemy': {
        const d = e.d, white = e.hurt > 0;
        drawShadow(e.x, e.y + e.r, Math.round(e.r * 2), cx, cy);
        let name;
        if (d.hum) name = d.spr + e.dir + humFrame(e);
        else if (d.beh === 'hop') name = d.spr + (((e.hopT % 1) < 0.45) ? 1 : 0);
        else if (d.beh === 'turret') name = d.spr + (e.mouth > 0 ? 1 : 0);
        else name = d.spr + (Math.floor(e.anim * (e.moving ? 8 : 2)) & 1) + (d.flip && e.face < 0 ? 'L' : '');
        let yo = d.beh === 'hop' && (e.hopT % 1) < 0.45 ? -Math.sin((e.hopT % 1) / 0.45 * Math.PI) * 4 : 0;
        drawSpr(name, e.x, fy + yo, white, cx, cy);
        break;
      }
      case 'proj': drawSpr(e.spr, e.x, e.y + 3, false, cx, cy); break;
      case 'bullet': drawBullet(e, cx, cy); break;
      case 'pickup': { const b = Math.sin(e.t * 5) * 1.5; if (e.t > 25 && Math.floor(G.t * 10) % 2) break; drawShadow(e.x, e.y + 3, 6, cx, cy); drawSpr(e.kind === 'ammo' ? 'ammo' : e.kind, e.x, e.y + 2 + b, false, cx, cy); break; }
      case 'chest': drawShadow(e.x, e.y + 6, 14, cx, cy); drawSpr(e.open ? 'chest1' : 'chest0', e.x, e.y + 8, false, cx, cy); break;
      default: if (e.draw) e.draw(e, cx, cy);
    }
  }
}
function drawSlash(cx, cy) {
  const P = G.P, p = 1 - P.swing / 0.2, a0 = P.swAng - 1.15, sweep = 2.3 * Math.min(1, p * 1.4);
  const ox = P.x - cx, oy = P.y - 2 - cy;
  for (let i = 0; i <= 26; i++) {
    const t = i / 26; if (t > sweep / 2.3) break;
    const a = a0 + t * 2.3, fade = 1 - Math.max(0, (sweep / 2.3 - t)) * 1.6;
    if (fade <= 0) continue;
    for (let r = 9; r <= 19; r += 2.5) {
      bctx.fillStyle = `rgba(${r > 16 ? '255,240,220' : '220,170,120'},${fade * (r > 12 ? 0.9 : 0.5)})`;
      bctx.fillRect(Math.round(ox + Math.cos(a) * r), Math.round(oy + Math.sin(a) * r), 1, 1);
    }
  }
}
let FOGTEX = null;
function makeFogTex() {
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S; const x2 = c.getContext('2d'), im = x2.createImageData(S, S);
  const tn = (x, y, p, s) => { const fx = x / p, fy = y / p, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0, n = S / p;
    const h = (a, b) => hash2(((a % n) + n) % n, ((b % n) + n) % n, s); const u = tx * tx * (3 - 2 * tx), v = ty * ty * (3 - 2 * ty);
    return lerp(lerp(h(x0, y0), h(x0 + 1, y0), u), lerp(h(x0, y0 + 1), h(x0 + 1, y0 + 1), u), v); };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n = tn(x, y, 32, 3) * 0.55 + tn(x, y, 16, 4) * 0.3 + tn(x, y, 8, 5) * 0.15, i = (y * S + x) * 4;
    im.data[i] = 206; im.data[i + 1] = 210; im.data[i + 2] = 216; im.data[i + 3] = clamp((n - 0.42) * 3, 0, 1) * 210;
  }
  x2.putImageData(im, 0, 0); return c;
}
function drawFog(L, cx, cy) {
  const f = G.fogCur || 0; if (f < 0.02 || L.kind !== 'over') return;
  if (!FOGTEX) FOGTEX = makeFogTex();
  const P = G.P, nf = nightF(), tint = mixc([150, 156, 162], [34, 36, 44], nf * 0.85);
  lctx.globalCompositeOperation = 'source-over'; lctx.clearRect(0, 0, BW, BH);
  lctx.fillStyle = rgb(tint, Math.min(0.95, 0.86 * f * DIFF.fog)); lctx.fillRect(0, 0, BW, BH);
  lctx.globalCompositeOperation = 'destination-out';
  const sx = P.x - cx, sy = P.y - 4 - cy, r = 62;
  const g = lctx.createRadialGradient(sx, sy, 0, sx, sy, r); g.addColorStop(0, 'rgba(0,0,0,0.95)'); g.addColorStop(0.6, 'rgba(0,0,0,0.6)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  lctx.fillStyle = g; lctx.fillRect(sx - r, sy - r, r * 2, r * 2);
  lctx.globalCompositeOperation = 'source-over';
  bctx.drawImage(lc, 0, 0);
  for (const [sp, sc, a] of [[9, 1, 0.45], [5, 2, 0.35]]) {
    const S = 128 * sc, ox = ((-(cx * 0.9) - G.t * sp) % S + S) % S - S, oy = ((-(cy * 0.9) - G.t * sp * 0.4) % S + S) % S - S;
    bctx.globalAlpha = a * f * (1 - nf * 0.5);
    for (let y = oy; y < BH; y += S) for (let x = ox; x < BW; x += S) bctx.drawImage(FOGTEX, x, y, S, S);
  }
  bctx.globalAlpha = 1;
}
function drawLighting(L, cx, cy) {
  let dark = 0, tint = [6, 8, 24];
  if (L.kind === 'over') dark = nightF() * DIFF.night;
  else if (L.kind === 'maze') {
    dark = 0.92; tint = mixc([0, 0, 2], [34, 0, 8], L.alive);
    // the outer works: open sky near the stairs, the same day or night as up top, fading to torchlight as the stone closes in
    if (L.hard) { const g = hardAt(L, G.P.x, G.P.y); dark = lerp(nightF() * DIFF.night, dark, g); tint = mixc([6, 8, 24], tint, g); }
  }
  else if (L.kind === 'flesh') { dark = G.prog.won ? 0.6 : 0.72; tint = [40, 0, 10]; }
  else if (L.kind === 'house') { dark = 0.3 + 0.55 * nightRaw() + (L.house.town.fog ? 0.15 : 0); tint = [8, 6, 10]; }
  if (dark < 0.01) return;
  const P = G.P, lights = [];
  const pr = (L.kind === 'over' ? 84 : L.hard ? lerp(84, L.lightR, hardAt(L, G.P.x, G.P.y)) : L.lightR || 64) * DIFF.light;
  if (!P.dead) lights.push({ x: P.x, y: P.y - 4, r: pr });
  if (G.flash > 0 && G.flashAt) lights.push({ x: G.flashAt[0], y: G.flashAt[1], r: 70, col: [255, 214, 140] });
  const mx = cx + BW / 2, my = cy + BH / 2;
  for (const l0 of L.lights) { const lx = nearX(L, l0.x, mx), ly = nearY(L, l0.y, my); if (lx > cx - l0.r && lx < cx + BW + l0.r && ly > cy - l0.r && ly < cy + BH + l0.r) lights.push(L.wrap ? Object.assign({}, l0, { x: lx, y: ly }) : l0); }
  for (const e of L.ents) if (e.glow) lights.push({ x: nearX(L, e.x, mx), y: nearY(L, e.y, my), r: e.glow, col: e.glowCol });
  lctx.globalCompositeOperation = 'source-over'; lctx.clearRect(0, 0, BW, BH);
  lctx.fillStyle = rgb(tint, dark); lctx.fillRect(0, 0, BW, BH);
  lctx.globalCompositeOperation = 'destination-out';
  for (const l of lights) {
    const fl = l.flick ? 1 + Math.sin(G.t * 9 + l.x) * 0.04 * l.flick + (Math.random() - 0.5) * 0.04 * l.flick : 1;
    const r = l.r * fl, sx = l.x - cx, sy = l.y - cy;
    const g = lctx.createRadialGradient(sx, sy, 0, sx, sy, r);
    g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.5, 'rgba(0,0,0,0.78)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    lctx.fillStyle = g; lctx.fillRect(sx - r, sy - r, r * 2, r * 2);
  }
  lctx.globalCompositeOperation = 'source-over';
  bctx.drawImage(lc, 0, 0);
  bctx.globalCompositeOperation = 'lighter';
  for (const l of lights) {
    if (!l.col) continue;
    const r = l.r * 0.8, sx = l.x - cx, sy = l.y - cy;
    const g = bctx.createRadialGradient(sx, sy, 0, sx, sy, r);
    g.addColorStop(0, rgb(l.col, 0.22 * Math.max(dark, 0.4))); g.addColorStop(1, rgb(l.col, 0));
    bctx.fillStyle = g; bctx.fillRect(sx - r, sy - r, r * 2, r * 2);
  }
  bctx.globalCompositeOperation = 'source-over';
}

// ================= HUD =================
const HEART_PAT = ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'];
function drawHeartIcon(x, y, s, fill) {
  for (let pass = 0; pass < 2; pass++) HEART_PAT.forEach((row, ry) => [...row].forEach((ch, rx) => {
    if (ch !== 'X') return;
    if (pass === 0) { ctx.fillStyle = '#120a10'; ctx.fillRect(x + rx * s - s * 0.5, y + ry * s - s * 0.5, s * 2, s * 2); return; }
    const on = fill >= 1 || (fill >= 0.5 && rx <= 3);
    ctx.fillStyle = on ? ((rx === 1 && ry === 1) ? '#ffc4c8' : '#e3283c') : '#4a2632';
    ctx.fillRect(x + rx * s, y + ry * s, s, s);
  }));
}
export function txt(str, x, y, size, col = '#fff', align = 'left', base = 'top') {
  ctx.font = `${Math.round(size)}px ${FONT}`; ctx.textAlign = align; ctx.textBaseline = base;
  ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillText(str, x + 1.5, y + 1.5);
  ctx.fillStyle = col; ctx.fillText(str, x, y);
}
function wrap(str, maxW, size) {
  ctx.font = `${Math.round(size)}px ${FONT}`;
  const words = str.split(' '), lines = []; let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur); return lines;
}
function locationLabel() {
  const L = G.L;
  if (L.kind === 'over') { const t = G.curTown ? L.towns[G.curTown - 1].name : 'The Surface'; return t + (nightF() > 0.5 ? '  ·  Night' : '  ·  Day'); }
  return L.name;
}
function drawHUD() {
  const P = G.P, s = UI.s;
  const hs = Math.max(2, Math.round(2.6 * s));
  for (let i = 0; i < P.maxHp / 2; i++) drawHeartIcon(14 + i * (hs * 8 + 2), 14, hs, clamp((P.hp - i * 2) / 2, 0, 1));
  txt(locationLabel(), 14, 14 + hs * 7 + 6, 13 * s, '#e8dcd0');
  const gw = Math.max(120, UI.mapBtn.x - UI.mapBtn.r - 24 - 14);
  wrap(goalText(), gw, 12 * s).slice(0, 3).forEach((ln, i) => txt(ln, 14, 14 + hs * 7 + 26 * s + i * 15 * s, 12 * s, '#ffd88a'));
  if (G.L.hud) G.L.hud(G.L);
  drawHintArrow();
  if (G.L.kind === 'flesh') drawObjective();
  drawMinimap();
  drawRoundBtn(UI.mapBtn, false); drawMapIcon(UI.mapBtn);
  drawRoundBtn(UI.menuBtn, false); drawPauseIcon(UI.menuBtn);
  // controls
  const g = gunOf(P), D = g && GUNS[g.id];
  drawRoundBtn(UI.atk, IN.atkHeld, P.reload > 0 ? 1 - P.reload / P.reloadMax : 1, P.target ? 'rgba(255,70,80,0.22)' : null);
  if (D && D.melee) drawBatIcon(UI.atk, !!P.target); else drawCrosshair(UI.atk, !!P.target);
  if (D && !D.melee) txt(P.reload > 0 ? 'reload' : String(g.mag), UI.atk.x, UI.atk.y + UI.atk.r * 0.55, 12 * s, g.mag === 0 ? '#ff8080' : '#fff1e0', 'center', 'middle');
  if (D) {
    const b = UI.gun; ctx.fillStyle = 'rgba(10,6,10,0.6)'; ctx.fillRect(b.x, b.y, b.w, b.h); ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1.5; ctx.strokeRect(b.x, b.y, b.w, b.h);
    txt(D.name + (P.guns.length > 1 ? '  ⇄' : ''), b.x + 8, b.y + 5, 13 * s, '#ffe9b0');
    if (D.melee) { const back = P.guns.find(x => !GUNS[x.id].melee && !isEmpty(P, x)); txt(back ? 'tap for ' + GUNS[back.id].name.toLowerCase() : 'melee', b.x + 8, b.y + 22 * s, 11 * s, back ? '#ffd080' : '#c8b8ac'); }
    else txt(`${g.mag}/${D.mag}  ·  ${P.ammo[D.ammo] || 0} ${AMMO_SHORT[D.ammo]}`, b.x + 8, b.y + 22 * s, 11 * s, (P.ammo[D.ammo] || 0) + g.mag === 0 ? '#ff8080' : (P.ammo[D.ammo] || 0) + g.mag <= D.mag ? '#ffc080' : '#c8b8ac');
  }
  if (P.meds > 0) { drawRoundBtn(UI.med, false, 1, 'rgba(255,255,255,0.16)'); const m = UI.med, k = m.r * 0.32; ctx.fillStyle = '#e8303c'; ctx.fillRect(m.x - k, m.y - k * 2.6 - 2, k * 2, k * 3.4); ctx.fillRect(m.x - k * 1.7, m.y - k * 1.6 - 2, k * 3.4, k * 2); txt('x' + P.meds, m.x, m.y + m.r * 0.5, 11 * s, '#fff', 'center', 'middle'); }
  if (G.use) { drawRoundBtn(UI.use, false, G.use.prog !== undefined ? G.use.prog : 1, 'rgba(255,214,120,0.22)'); txt(G.use.label, UI.use.x, UI.use.y, 13 * s, '#ffe9b0', 'center', 'middle'); }
  if (STICK) {
    ctx.globalAlpha = 0.9;
    ctx.beginPath(); ctx.arc(STICK.ox, STICK.oy, UI.stickR, 0, TAU); ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 2; ctx.stroke();
    const dx = STICK.x - STICK.ox, dy = STICK.y - STICK.oy, l = Math.hypot(dx, dy), m = Math.min(l, UI.stickR);
    const kx = STICK.ox + (l ? dx / l * m : 0), ky = STICK.oy + (l ? dy / l * m : 0);
    ctx.beginPath(); ctx.arc(kx, ky, UI.stickR * 0.42, 0, TAU); ctx.fillStyle = 'rgba(255,255,255,0.32)'; ctx.fill();
    ctx.globalAlpha = 1;
  }
  drawTip();
  drawPops();
  // dialog
  if (G.dialog) {
    const land = SW > SH * 1.2;
    const d = G.dialog, w = land ? Math.min(SW - 2 * 190 * s, 560) : Math.min(SW - 24, 520), x = (SW - w) / 2, fs = 15 * s;
    const lines = wrap(d.text.slice(0, Math.floor(d.shown)), w - 28, fs);
    const allLines = wrap(d.text, w - 28, fs);
    const h = 40 * s + allLines.length * fs * 1.3;
    const y = land ? SH - h - 14 : Math.max(80, UI.use.y - UI.use.r - h - 16);
    G.dialogBox = { y, h };
    ctx.fillStyle = 'rgba(14,8,14,0.88)'; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(255,214,150,0.5)'; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    txt(d.name, x + 14, y + 10, 13 * s, '#ffcf8a');
    lines.forEach((ln, i) => txt(ln, x + 14, y + 16 * s + 12 + i * fs * 1.3, fs, '#f4ece4'));
  }
  // toasts
  G.toasts.slice(0, 1).forEach(t => {
    const a = Math.min(1, t.t / 0.4, (t.dur - t.t) / 0.6); ctx.globalAlpha = clamp(a, 0, 1);
    const y = SH * 0.17;
    txt(t.title, SW / 2, y, 24 * s, '#fff1e0', 'center');
    if (t.sub) wrap(t.sub, Math.min(SW - 40, 460), 14 * s).forEach((ln, j) => txt(ln, SW / 2, y + 30 * s + j * 18 * s, 14 * s, '#d8c8bc', 'center'));
    ctx.globalAlpha = 1;
  });
}
function drawRoundBtn(b, active, prog = 1, fill) {
  ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU);
  ctx.fillStyle = fill || (active ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.12)'); ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.stroke();
  if (prog < 1) { ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 3, -Math.PI / 2, -Math.PI / 2 + prog * TAU); ctx.strokeStyle = 'rgba(255,220,140,0.8)'; ctx.lineWidth = 3; ctx.stroke(); }
}
function drawCrosshair(b, lock) {
  const s = b.r / 42; ctx.strokeStyle = lock ? '#ff6070' : '#efe4d8'; ctx.lineWidth = 3 * s;
  ctx.beginPath(); ctx.arc(b.x, b.y - 4 * s, 13 * s, 0, TAU); ctx.stroke();
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.beginPath(); ctx.moveTo(b.x + dx * 8 * s, b.y - 4 * s + dy * 8 * s); ctx.lineTo(b.x + dx * 19 * s, b.y - 4 * s + dy * 19 * s); ctx.stroke(); }
}
function drawBatIcon(b, lock) {
  const s = b.r / 42; ctx.save(); ctx.translate(b.x, b.y - 2 * s); ctx.rotate(-Math.PI / 4); ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 10 * s; ctx.beginPath(); ctx.moveTo(0, -20 * s); ctx.lineTo(0, 16 * s); ctx.stroke();
  ctx.strokeStyle = lock ? '#e0a868' : '#c89058'; ctx.lineWidth = 8 * s; ctx.beginPath(); ctx.moveTo(0, -20 * s); ctx.lineTo(0, 2 * s); ctx.stroke();
  ctx.lineWidth = 4.5 * s; ctx.beginPath(); ctx.moveTo(0, 2 * s); ctx.lineTo(0, 16 * s); ctx.strokeStyle = '#6a4428'; ctx.stroke();
  ctx.restore();
}
function drawSwordIcon(b) {
  const s = b.r / 42; ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(-Math.PI / 4); ctx.lineCap = 'square';
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 7 * s; ctx.beginPath(); ctx.moveTo(0, -20 * s); ctx.lineTo(0, 12 * s); ctx.stroke();
  ctx.strokeStyle = '#e8eef8'; ctx.lineWidth = 4 * s; ctx.beginPath(); ctx.moveTo(0, -20 * s); ctx.lineTo(0, 8 * s); ctx.stroke();
  ctx.strokeStyle = '#c9a050'; ctx.lineWidth = 4 * s; ctx.beginPath(); ctx.moveTo(-9 * s, 8 * s); ctx.lineTo(9 * s, 8 * s); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, 8 * s); ctx.lineTo(0, 16 * s); ctx.strokeStyle = '#7a5030'; ctx.stroke();
  ctx.restore();
}
function drawMapIcon(b) { const s = b.r / 17; ctx.strokeStyle = '#efe4d8'; ctx.lineWidth = 2; ctx.strokeRect(b.x - 8 * s, b.y - 6 * s, 16 * s, 12 * s); ctx.beginPath(); ctx.moveTo(b.x - 3 * s, b.y - 6 * s); ctx.lineTo(b.x - 3 * s, b.y + 6 * s); ctx.moveTo(b.x + 3 * s, b.y - 6 * s); ctx.lineTo(b.x + 3 * s, b.y + 6 * s); ctx.stroke(); }
function drawPauseIcon(b) { const s = b.r / 17; ctx.fillStyle = '#efe4d8'; ctx.fillRect(b.x - 6 * s, b.y - 7 * s, 4 * s, 14 * s); ctx.fillRect(b.x + 2 * s, b.y - 7 * s, 4 * s, 14 * s); }
function blitMapRegion(L, sx, sy, sw, sh, dx, dy, dw, dh) {
  const kx = dw / sw, ky = dh / sh;
  let x0 = sx, y0 = sy, x1 = sx + sw, y1 = sy + sh;
  x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(L.w, x1); y1 = Math.min(L.h, y1);
  if (x1 <= x0 || y1 <= y0) return;
  ctx.drawImage(L.mapCanvas, x0, y0, x1 - x0, y1 - y0, dx + (x0 - sx) * kx, dy + (y0 - sy) * ky, (x1 - x0) * kx, (y1 - y0) * ky);
}
function drawMinimap() {
  const L = G.L, P = G.P, m = UI.mini, span = L.kind === 'over' ? 72 : 40;
  if (G.t - (L.mapT || 0) > 0.25) { refreshMap(L); L.mapT = G.t; }
  ctx.fillStyle = 'rgba(8,6,10,0.75)'; ctx.fillRect(m.x - 2, m.y - 2, m.w + 4, m.w + 4);
  ctx.imageSmoothingEnabled = false;
  const ptx = P.x / TS, pty = P.y / TS;
  ctx.save(); ctx.beginPath(); ctx.rect(m.x, m.y, m.w, m.w); ctx.clip();
  const sx0 = Math.floor(ptx - span / 2), sy0 = Math.floor(pty - span / 2);
  if (L.wrap) { for (const kx of [-1, 0, 1]) for (const ky of [-1, 0, 1]) blitMapRegion(L, sx0 + kx * L.w, sy0 + ky * L.h, span, span, m.x, m.y, m.w, m.w); }
  else blitMapRegion(L, sx0, sy0, span, span, m.x, m.y, m.w, m.w);
  const k = m.w / span, ox = m.x + m.w / 2 - (ptx - sx0 - span / 2) * k, oy = m.y + m.w / 2 - (pty - sy0 - span / 2) * k;
  drawMapMarkers(L, (x, y) => [ox + wdx(L, (x - ptx) * TS) / TS * k, oy + wdy(L, (y - pty) * TS) / TS * k], 3);
  ctx.restore();
  ctx.fillStyle = '#fff'; ctx.fillRect(ox - 2, oy - 2, 4, 4);
  ctx.strokeStyle = 'rgba(255,240,220,0.5)'; ctx.lineWidth = 1.5; ctx.strokeRect(m.x - 1, m.y - 1, m.w + 2, m.w + 2);
}
function drawHexes(L, proj, k) {
  if (!L.hexes) return;
  ctx.lineWidth = 1;
  for (const h of L.hexes) {
    if (h.type === 'sea') continue;
    ctx.beginPath();
    const [hx, hy] = proj(h.x, h.y);
    for (let i = 0; i < 6; i++) { const a = Math.PI / 180 * (60 * i - 30), x = hx + HEX_S * k * Math.cos(a), y = hy + HEX_S * k * Math.sin(a); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
    ctx.closePath();
    if (h.seen && h.fog >= 1) { ctx.fillStyle = 'rgba(200,204,214,0.32)'; ctx.fill(); }
    else if (h.seen && h.type === 'city') { ctx.fillStyle = 'rgba(255,214,140,0.12)'; ctx.fill(); }
    ctx.strokeStyle = h.type === 'city' ? 'rgba(255,214,140,0.35)' : 'rgba(255,255,255,0.09)'; ctx.stroke();
  }
}
function drawMapMarkers(L, proj, sz, labels, k) {
  if (L.kind === 'over') {
    if (labels) drawHexes(L, proj, k);
    for (const d of L.dungeons) if (d.seen) { const [x, y] = proj(d.x + 0.5, d.y + 0.5); ctx.fillStyle = '#ff3048'; ctx.beginPath(); ctx.arc(x, y, sz + 1, 0, TAU); ctx.fill(); ctx.strokeStyle = '#200'; ctx.lineWidth = 1; ctx.stroke(); }
    for (const t of L.towns) if (t.seen) {
      const [x, y] = proj(t.x + 0.5, t.y + 0.5), big = t.kind === 'city' ? 1.6 : t.kind === 'hamlet' ? 0.6 : 1;
      ctx.fillStyle = t.fog ? '#b8bcc6' : '#ffe6a0'; ctx.fillRect(x - sz * big, y - sz * big, sz * 2 * big, sz * 2 * big);
      if (labels && t.kind === 'city') txt(t.name, x, y + sz * big + 3, 13 * UI.s, '#ffe6a0', 'center');
    }
  }
  if (L.markers) L.markers(L, proj, sz, labels);
  if (G.testMark && L === G.over) { const [x, y] = proj(G.testMark.x + 0.5, G.testMark.y + 0.5); ctx.strokeStyle = '#50dcff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, sz * 2 + 2, 0, TAU); ctx.stroke(); }
}
function drawMapOverlay() {
  const L = G.L, P = G.P; refreshMap(L);
  ctx.fillStyle = 'rgba(6,4,8,0.92)'; ctx.fillRect(0, 0, SW, SH);
  const size = Math.min(SW, SH) - 40, span = Math.max(L.w, L.h), k = size / span;
  const mw = L.w * k, mh = L.h * k, x0 = (SW - mw) / 2, y0 = (SH - mh) / 2 + 10;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#0d0a10'; ctx.fillRect(x0, y0, mw, mh);
  let px, py, proj;
  if (L.wrap) {
    // the world wraps, so the map scrolls with you: you sit in the middle and the edges carry on round the back
    const ptx = P.x / TS, pty = P.y / TS, sx0 = ptx - L.w / 2, sy0 = pty - L.h / 2;
    px = x0 + mw / 2; py = y0 + mh / 2;
    ctx.save(); ctx.beginPath(); ctx.rect(x0, y0, mw, mh); ctx.clip();
    for (const ox of [-1, 0, 1]) for (const oy of [-1, 0, 1]) ctx.drawImage(L.mapCanvas, 0, 0, L.w, L.h, x0 + (ox * L.w - sx0) * k, y0 + (oy * L.h - sy0) * k, L.w * k, L.h * k);
    proj = (x, y) => [px + wdx(L, (x - ptx) * TS) / TS * k, py + wdy(L, (y - pty) * TS) / TS * k];
    drawMapMarkers(L, proj, Math.max(3, 3 * UI.s), true, k);
    ctx.restore();
  } else {
    ctx.drawImage(L.mapCanvas, 0, 0, L.w, L.h, x0, y0, mw, mh);
    proj = (x, y) => [x0 + x * k, y0 + y * k];
    drawMapMarkers(L, proj, Math.max(3, 3 * UI.s), true, k);
    px = x0 + P.x / TS * k; py = y0 + P.y / TS * k;
  }
  ctx.strokeStyle = 'rgba(255,240,220,0.4)'; ctx.lineWidth = 1.5; ctx.strokeRect(x0, y0, mw, mh);
  if (Math.floor(G.t * 3) % 2 === 0) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(px, py, 4 * UI.s, 0, TAU); ctx.fill(); }
  txt(L.kind === 'over' ? 'Map of the Surface' : L.name, SW / 2, y0 - 26, 16 * UI.s, '#f0e2d0', 'center');
  const ly = Math.min(SH - 44, y0 + L.h * k + 10);
  if (L.kind === 'over') txt('■ town   ▢ grey: quarantined fog   ● stairs down', SW / 2, ly, 12 * UI.s, '#c8b8a8', 'center');
  txt('tap to close', SW / 2, ly + 20 * UI.s, 12 * UI.s, '#a89888', 'center');
}
function drawFade() {
  const f = G.fade, h = f.dur / 2;
  const a = f.t < h ? clamp(f.t / Math.min(0.8, h), 0, 1) : clamp((f.dur - f.t) / Math.min(0.8, h), 0, 1);
  ctx.fillStyle = `rgba(0,0,0,${a})`; ctx.fillRect(0, 0, SW, SH);
  if (a > 0.5 && f.text) {
    ctx.globalAlpha = (a - 0.5) * 2;
    txt(f.text, SW / 2, SH / 2 - 20, 26 * UI.s, '#f3e0d0', 'center', 'middle');
    if (f.sub) wrap(f.sub, Math.min(SW - 40, 460), 14 * UI.s).forEach((ln, j) => txt(ln, SW / 2, SH / 2 + 14 + j * 18 * UI.s, 14 * UI.s, '#b8a49a', 'center', 'middle'));
    ctx.globalAlpha = 1;
  }
}

// ================= save / load =================
const SAVE_KEY = 'beneath_the_skin_v2';
function rle(arr) { const out = []; let cur = 0, run = 0; for (let i = 0; i < arr.length; i++) { const v = arr[i] ? 1 : 0; if (v === cur) run++; else { out.push(run); cur = v; run = 1; } } out.push(run); return out.join(','); }
function unrle(str, arr) { const runs = str.split(',').map(Number); let i = 0, v = 0; for (const r of runs) { if (v) arr.fill(1, i, i + r); i += r; v ^= 1; } }
export function saveGame() {
  try {
    if (!G.running || !G.over || !G.P || G.permaDead || G.testWorld) return;
    const P = G.P, L = G.over;
    const data = { v: 1, seed: G.seed, hp: Math.max(1, P.hp), maxHp: P.maxHp, dmg: P.dmg, day: G.day, stats: G.stats, lastTown: G.lastTown, maxDepth: G.maxDepth,
      loc: !P.dead && !G.fade && G.L && G.L.key ? { key: G.L.key, x: P.x, y: P.y } : null, seen: rle(L.seen), towns: L.towns.map(t => t.seen ? 1 : 0), dung: L.dungeons.map(d => ({ x: d.x, y: d.y, seen: d.seen ? 1 : 0 })), wasNight: !!G.wasNight, settings: G.settings, prog: G.prog || null, ngp: G.ngp || 0, diff: DIFF.id, vessels: P.vessels || 0, guns: P.guns, gi: P.gi, ammo: P.ammo, meds: P.meds, dayN: G.dayN, gen: GEN_V, wv: G.variant || 0 };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch (e) { }
}
// every key this game has ever saved under, older versions included
function saveKeys() { const out = []; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('beneath_the_skin')) out.push(k); } } catch (e) { } return out; }
function loadSave() { try { const s = localStorage.getItem(SAVE_KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
function applySave(s, L) {
  const P = G.P; P.vessels = s.vessels ?? Math.max(0, Math.round(((s.maxHp || 6) - 6) / 2)); P.maxHp = DIFF.hearts + 2 * P.vessels; P.hp = Math.min(s.hp || P.maxHp, P.maxHp); P.dmg = s.dmg || 1;
  G.day = s.day || 0.3; G.stats = s.stats || G.stats; G.lastTown = s.lastTown ?? -1; G.maxDepth = s.maxDepth || 0;
  if (s.settings) Object.assign(G.settings, s.settings);
  if (s.prog) G.prog = Object.assign(freshProg(), s.prog);
  for (const k of Object.keys(G.prog.marked)) if (L.dungeons[+k]) L.dungeons[+k].seen = true;
  if (s.guns) { P.guns = s.guns; P.gi = Math.min(s.gi || 0, s.guns.length - 1); P.ammo = s.ammo; P.meds = s.meds ?? 1; }
  if (!P.guns.some(g => g.id === 'bat')) { P.guns.unshift({ id: 'bat' }); P.gi++; }
  G.dayN = s.dayN || 0;
  if (s.seen) { unrle(s.seen, L.seen); for (let i = 0; i < L.seen.length; i++) if (L.seen[i]) paintSeen(L, i); L.mapDirty = true; }
  (s.towns || []).forEach((v, i) => { if (L.towns[i]) L.towns[i].seen = !!v; });
  (s.dung || []).forEach((v, i) => {
    const d = L.dungeons[i]; if (!d) return;
    if (typeof v === 'object') { d.seen = !!v.seen; if (v.x !== d.x || v.y !== d.y) moveDungeon(L, d, v.x, v.y, false); } else d.seen = !!v;
  });
  for (const k of Object.keys(G.prog.lost || {}).concat(Object.keys(G.prog.doomed || {}))) { const t = L.towns[+k]; if (t && !t.fog) makeFogTown(L, t); }
  computeFog(L);
  G.wasNight = !!s.wasNight;
}

// ================= menus =================
export const $ = id => document.getElementById(id);
function hideAll() { for (const id of ['title', 'menu', 'loading', 'ending', 'files', 'intro', 'guide', 'tests', 'howto']) $(id).classList.add('hidden'); }
function showLoading(msg) { hideAll(); $('loadingMsg').textContent = msg; $('loading').classList.remove('hidden'); }
function openMenu() {
  if (!G.running) return; G.paused = true; resetInput(); retireTip('help');
  $('menuSeed').textContent = 'World seed ' + G.seed;
  $('btnDiff').textContent = DIFF.perma ? 'Difficulty: Impossible (locked)' : 'Difficulty: ' + DIFF.name; $('btnDiff').disabled = DIFF.perma;
  $('btnFiles').textContent = `Files (${Object.keys(G.prog.files || {}).length}/${FILES.length})`;
  $('btnSound').textContent = 'Sound: ' + (AU.on ? 'on' : 'off');
  $('btnNewConfirm').textContent = 'New world';
  $('menu').classList.remove('hidden');
}
function fmtTime(s) { s = Math.floor(s); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(ss).padStart(2, '0'); }
function showEnding() {
  G.paused = true; IN.atkHeld = false; STICK = null; PTR.clear();
  const st = G.stats; G.endMode = 'win';
  $('endTitle').textContent = 'The world goes still.'; $('endSub').textContent = 'No pulse in the ground. No warmth in the walls. For the first time, the world is only a world.';
  const sp = st.splits || {}, n = floorsN();
  const legs = Object.keys(sp).map(Number).sort((a, b) => a - b).map(d => `${d > n ? 'Inside' : stageInfo(d).title.replace(/^The /, '').replace(/\s+·.*$/, '') + (stageInfo(d).s === 'cells' && n > 3 ? ' ' + (d - 1) : '')} ${fmtTime(sp[d])}`);
  $('endStats').innerHTML = `Time ${fmtTime(st.time)}` + (legs.length ? `<br><small>${legs.join(' · ')}</small>` : '') + `<br>Things killed ${st.kills}<br>Times you fell ${st.deaths}<br>Mode ${DIFF.name}` + (G.ngp ? `<br>New Game+ ${G.ngp}` : '');
  $('btnNGP').textContent = `Begin again (New Game+ ${(G.ngp || 0) + 1})`; $('btnStay').textContent = 'Stay a while';
  $('ending').classList.remove('hidden');
}
function openFiles() {
  $('menu').classList.add('hidden'); $('files').classList.remove('hidden'); $('fileView').classList.add('hidden'); $('fileList').classList.remove('hidden');
  const list = $('fileList'); list.innerHTML = '';
  FILES.forEach((f, i) => {
    const b = document.createElement('button'); b.className = 'filebtn';
    const got = G.prog.files[i];
    b.textContent = got ? `FILE ${String(i + 1).padStart(2, '0')}  ${f.title}` : `FILE ${String(i + 1).padStart(2, '0')}  ████████`;
    b.disabled = !got;
    b.onclick = () => { $('fileList').classList.add('hidden'); $('fileView').classList.remove('hidden'); $('fileTitle').textContent = `FILE ${String(i + 1).padStart(2, '0')} · ${f.title}`; $('fileBody').innerHTML = f.body.split('\n\n').map(p => '<p>' + p.replace(/(█+)/g, '<span class="redact">$1</span>') + '</p>').join(''); };
    list.appendChild(b);
  });
}
function showIntro() { G.paused = true; $('intro').classList.remove('hidden'); }
function closeMenu() { G.paused = false; $('menu').classList.add('hidden'); }
function tryFullscreen() { try { const el = document.documentElement; if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {}); } catch (e) { } }
function randomSeed() { return (Math.random() * 1e9) >>> 0; }
function setupMenus() {
  const save = loadSave();
  if (!save) $('btnCont').classList.add('hidden');
  // clear all saves: first tap arms it, second tap within 4 seconds wipes everything
  const clr = $('btnClear'); let clrT = 0;
  const clrIdle = () => { clr.classList.remove('armed'); clr.textContent = 'Clear all saves'; clr.classList.toggle('hidden', !saveKeys().length); };
  clrIdle();
  clr.onclick = () => {
    if (!clr.classList.contains('armed')) { clr.classList.add('armed'); clr.textContent = 'Tap again to delete everything'; clearTimeout(clrT); clrT = setTimeout(clrIdle, 4000); return; }
    clearTimeout(clrT);
    for (const k of saveKeys()) try { localStorage.removeItem(k); } catch (e) { }
    $('btnCont').classList.add('hidden');
    clr.classList.remove('armed'); clr.textContent = 'All saves cleared';
    clrT = setTimeout(clrIdle, 2000);
  };
  G.refreshClear = clrIdle;
  $('seed').value = '';
  $('btnNew').onclick = () => { auResume(); tryFullscreen(); const v = $('seed').value.trim(); const seed = v ? (/^\d+$/.test(v) ? +v : [...v].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261)) : randomSeed(); newGame(seed, null, null, G.pickDiff()); };
  $('btnCont').onclick = () => { auResume(); tryFullscreen(); const s = loadSave(); if (s) newGame(s.seed, s); };
  $('btnResume').onclick = () => closeMenu();
  $('btnFiles').onclick = () => openFiles();
  $('btnFilesBack').onclick = () => { if (!$('fileView').classList.contains('hidden')) { $('fileView').classList.add('hidden'); $('fileList').classList.remove('hidden'); } else { $('files').classList.add('hidden'); $('menu').classList.remove('hidden'); } };
  $('btnGuide').onclick = () => { $('guide').classList.add('hidden'); G.paused = false; };
  $('btnHelp').onclick = () => showHowTo('menu');
  $('btnHowtoTitle').onclick = () => showHowTo('title');
  $('btnHowtoBack').onclick = () => closeHowTo();
  $('btnIntro').onclick = () => { $('intro').classList.add('hidden'); G.paused = false; toast('Find the old stairs', 'Red marks on your map. Search houses for guns and ammo.', 4.5); };
  $('btnNGP').onclick = () => {
    const P = G.P; G.running = false; $('ending').classList.add('hidden');
    if (G.endMode === 'perma') { newGame(randomSeed(), null); return; }
    newGame(randomSeed(), null, { vessels: P.vessels || 0, guns: P.guns, ammo: P.ammo, meds: P.meds, ngp: (G.ngp || 0) + 1 });
  };
  $('btnStay').onclick = () => {
    $('ending').classList.add('hidden');
    if (G.endMode === 'perma') { G.running = false; $('btnCont').classList.add('hidden'); G.refreshClear(); $('title').classList.remove('hidden'); return; }
    G.paused = false; toast('Stillness', 'Nothing moves down here now. Climb out when you are ready.');
  };
  // difficulty picker on the title screen
  let pickD = 'easy';
  const showDiff = () => { for (const b of document.querySelectorAll('#diffRow button')) b.classList.toggle('sel', b.dataset.d === pickD); $('diffBlurb').textContent = DIFFS[pickD].blurb; };
  for (const b of document.querySelectorAll('#diffRow button')) b.onclick = () => { pickD = b.dataset.d; showDiff(); };
  showDiff(); G.pickDiff = () => pickD;
  $('btnDiff').onclick = () => {
    if (DIFF.perma) return;
    const order = ['easy', 'medium', 'hard'], next = order[(order.indexOf(DIFF.id) + 1) % order.length];
    setDifficulty(next, true); $('btnDiff').textContent = 'Difficulty: ' + DIFF.name; saveGame();
  };
  $('btnSound').onclick = () => { AU.on = !AU.on; $('btnSound').textContent = 'Sound: ' + (AU.on ? 'on' : 'off'); };
  $('btnFull').onclick = () => tryFullscreen();
  setupWorldTests();
  $('btnNewConfirm').onclick = () => {
    const b = $('btnNewConfirm');
    if (b.textContent !== 'Tap again to confirm') { b.textContent = 'Tap again to confirm'; return; }
    saveGame(); G.running = false; closeMenu(); newGame(randomSeed(), null);
  };
}

// ================= main loop =================
let LAST = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - LAST) / 1000; LAST = now; if (dt > 0.05) dt = 0.05; if (dt < 0) dt = 0;
  if (!G.running) return;
  // any menu, note or guide opening drops whatever was held, so nothing is stuck when play resumes
  if (G.paused && !WAS_PAUSED) resetInput(); WAS_PAUSED = G.paused;
  if (!G.paused && !G.mapOpen) update(dt); // the map is a safe moment: everything waits
  render(dt);
}
let WAS_PAUSED = false;
function boot() {
  resize(); buildSprites(); setupMenus();
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => { if (document.hidden) { resetInput(); saveGame(); if (G.running && !G.paused) openMenu(); } });
  requestAnimationFrame(frame);
}
window.BTS = { G, IN, newGame, saveGame, T, TP };
boot();
