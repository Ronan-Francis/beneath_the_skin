import { clamp, dist, hash2, Level, mulberry32, pick, rint, smooth, T, TP, TS } from './core.js';
import { DIFF, floorsN } from './difficulty.js';
import { buildAtlas } from './art.js';
import { FLOW, makeEnemy } from './entities.js';
import { DX4, DY4, isGround } from './gen_overworld.js';
import { enterFlesh, genFlesh } from './gen_flesh.js';
import { genHouse } from './gen_house.js';
import { sfx } from './audio.js';
import {
  ammoAmt, ammoPop, ammoTypeFor, giveAmmo, giveGun, giveMed, gunPop, GUNS, MED_POP, nextGun, popAll
} from './weapons.js';
import {
  bctx, beatEnv, BH, burst, BW, ctx, enterLevel, G, initMap, makeCorpse, paintSeen, saveGame, toast,
  transition
} from './game.js';

// ================= the descent: the prison under the world =================
// Floor 1 is the outer works, where the surface hardens into the prison. Then one or two floors of cells.
// The last floor is the breach, where flesh has grown through the stone and the walls move. The flesh is below that.
export const stageOf = (d, n = floorsN()) => d <= 1 ? 'gradient' : d >= n ? 'breach' : 'cells';
export function stageInfo(d, n = floorsN()) {
  const s = stageOf(d, n);
  if (s === 'gradient') return { s, alive: 0.08, title: 'The Outer Works', sub: 'Old walls in the grass. Further in, they close over.', light: 92, cells: 11, pool: ['husk', 'husk', 'mite'], count: 4, hp: 1, braid: 0.12, rooms: 1 };
  if (s === 'breach') return { s, alive: 0.85, title: 'The Breach', sub: 'Something has grown through the stone.', light: 74, cells: 11, pool: ['worm', 'husk', 'mite', 'worm', 'antibody'], count: 7, hp: 1.6, braid: 0.1, rooms: 2, polyps: true };
  const nC = n - 2, k = d - 2; // which floor of cells, from 0
  return { s, alive: nC > 1 ? 0.3 + 0.25 * k / (nC - 1) : 0.4, title: nC > 1 ? `The Cells  ·  Level ${k + 1}` : 'The Cells',
    sub: k ? 'The walls are warm to the touch.' : 'Cold stone. Chains. Something drips.', light: 84 - k * 4, cells: 12 + k,
    pool: k ? ['husk', 'mite', 'worm', 'worm'] : ['husk', 'mite', 'worm', 'husk'], count: 6 + k * 2, hp: 1.2 + k * 0.25, braid: 0.1 + k * 0.03, rooms: 2 + k };
}
const WALK_T = t => !TP[t].solid;
// breadth-first distances over open tiles, from one tile; `block` tiles count as walls
function bfs(L, from, block) {
  const S = L.w, N = S * L.h, D = new Int32Array(N).fill(-1), q = new Int32Array(N); let qh = 0, qt = 0;
  if (from < 0 || (block && block.includes(from))) return D;
  D[from] = 0; q[qt++] = from;
  while (qh < qt) {
    const c = q[qh++], x = c % S, y = (c / S) | 0;
    for (let k = 0; k < 4; k++) {
      const nx = x + DX4[k], ny = y + DY4[k]; if (nx < 0 || ny < 0 || nx >= S || ny >= L.h) continue;
      const n = ny * S + nx; if (D[n] >= 0 || !WALK_T(L.t[n]) || (block && block.includes(n))) continue;
      D[n] = D[c] + 1; q[qt++] = n;
    }
  }
  return D;
}

export function genMaze(seed, depth, eid, nFloors = floorsN()) {
  const fi = stageInfo(depth, nFloors);
  const R = mulberry32(seed >>> 0), C = fi.cells, S = C * 3 + 1;
  const L = new Level('maze', S, S); L.edge = T.MWALL; L.t.fill(T.MWALL);
  L.depth = depth; L.eid = eid; L.stage = fi.s; L.alive = fi.alive; L.lightR = fi.light; L.revealR = 5;
  L.name = fi.title; L.key = `m${eid}-${depth}`; L.cells = C;
  const cellFloor = (cx, cy) => { for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) L.set(cx * 3 + 1 + x, cy * 3 + 1 + y, T.MFLOOR); };
  const carveBetween = (ax, ay, bx, by) => {
    if (bx !== ax) { const wx = Math.min(ax, bx) * 3 + 3; for (let y = 0; y < 2; y++) L.set(wx, ay * 3 + 1 + y, T.MFLOOR); }
    else { const wy = Math.min(ay, by) * 3 + 3; for (let x = 0; x < 2; x++) L.set(ax * 3 + 1 + x, wy, T.MFLOOR); }
  };
  // recursive backtracker
  const sx = R() < 0.5 ? 0 : C - 1, sy = R() < 0.5 ? 0 : C - 1;
  const vis = new Uint8Array(C * C); vis[sy * C + sx] = 1; cellFloor(sx, sy);
  const st = [sy * C + sx];
  while (st.length) {
    const c = st[st.length - 1], cx = c % C, cy = (c / C) | 0, nb = [];
    for (let k = 0; k < 4; k++) { const nx = cx + DX4[k], ny = cy + DY4[k]; if (nx >= 0 && ny >= 0 && nx < C && ny < C && !vis[ny * C + nx]) nb.push([nx, ny]); }
    if (!nb.length) { st.pop(); continue; }
    const [nx, ny] = pick(R, nb); carveBetween(cx, cy, nx, ny); cellFloor(nx, ny); vis[ny * C + nx] = 1; st.push(ny * C + nx);
  }
  // braid a few loops so fights can be escaped
  for (let cy = 0; cy < C; cy++) for (let cx = 0; cx < C; cx++) {
    if (cx < C - 1 && R() < fi.braid) carveBetween(cx, cy, cx + 1, cy);
    if (cy < C - 1 && R() < fi.braid) carveBetween(cx, cy, cx, cy + 1);
  }
  // rooms with pillars
  const rooms = [];
  for (let k = 0; k < fi.rooms; k++) {
    const w = rint(R, 2, 3), h = rint(R, 2, 3), rx = rint(R, 1, C - w - 1), ry = rint(R, 1, C - h - 1);
    if (Math.abs(rx - sx) < 3 && Math.abs(ry - sy) < 3) continue;
    for (let y = ry * 3 + 1; y < (ry + h) * 3; y++) for (let x = rx * 3 + 1; x < (rx + w) * 3; x++) if (!(x % 3 === 0 && y % 3 === 0)) L.set(x, y, T.MFLOOR);
    rooms.push({ x: rx, y: ry, w, h });
  }
  // distances from the start
  const N = S * S, s0 = (sy * 3 + 1) * S + sx * 3 + 1, D = bfs(L, s0);
  const cellD = (cx, cy) => D[(cy * 3 + 1) * S + cx * 3 + 1];
  let far = [sx, sy], fd = 0;
  for (let cy = 0; cy < C; cy++) for (let cx = 0; cx < C; cx++) if (cellD(cx, cy) > fd) { fd = cellD(cx, cy); far = [cx, cy]; }
  L.set(sx * 3 + 1, sy * 3 + 1, T.STAIRS_UP);
  L.set(far[0] * 3 + 1, far[1] * 3 + 1, T.STAIRS_DOWN);
  L.upI = s0; L.downI = (far[1] * 3 + 1) * S + far[0] * 3 + 1;
  L.start = { x: (sx * 3 + 1) * TS + 8, y: (sy * 3 + 2) * TS + 8 };
  L.downAt = { x: (far[0] * 3 + 1) * TS + 8, y: (far[1] * 3 + 2) * TS + 8 };
  L.lights.push({ x: (far[0] * 3 + 1) * TS + 8, y: (far[1] * 3 + 1) * TS + 8, r: 40, col: [255, 40, 50], flick: 0.4 });
  L.lights.push({ x: (sx * 3 + 1) * TS + 8, y: (sy * 3 + 1) * TS + 8, r: 34, col: [200, 210, 255] });
  // safe zone around the way back up
  L.noEnemy = new Uint8Array(N);
  for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const x = sx * 3 + 1 + dx, y = sy * 3 + 1 + dy; if (L.inb(x, y)) L.noEnemy[y * S + x] = 1; }
  // decor: bones, roots creeping over the floor, eyes opening in the walls
  L.floors = []; L.eyes = [];
  for (let y = 1; y < S - 1; y++) for (let x = 1; x < S - 1; x++) {
    const i = y * S + x, t = L.t[i];
    if (t === T.MFLOOR) {
      L.floors.push(i);
      const r = R();
      if (r < 0.018) L.t[i] = T.MBONES; else if (r < 0.018 + L.alive * 0.22) L.t[i] = T.MROOT;
    } else if (t === T.MWALL && L.t[i + S] === T.MFLOOR && R() < 0.006 + L.alive * 0.08) { L.t[i] = T.MEYE; L.eyes.push({ x, y, h: R() }); }
  }
  if (fi.s === 'gradient') hardenFromSurface(L, R, seed, sx, sy, far);
  if (fi.s === 'breach') setupBreach(L, R, sx, sy, far);
  L.randomizeVariants(seed + 3);
  // chests in far dead ends
  const opens = (cx, cy) => {
    let n = 0; const bx = cx * 3 + 1, by = cy * 3 + 1;
    if (WALK_T(L.get(bx + 2, by))) n++; if (WALK_T(L.get(bx - 1, by))) n++;
    if (WALK_T(L.get(bx, by + 2))) n++; if (WALK_T(L.get(bx, by - 1))) n++;
    return n;
  };
  const ends = [];
  for (let cy = 0; cy < C; cy++) for (let cx = 0; cx < C; cx++) {
    if ((cx === sx && cy === sy) || (cx === far[0] && cy === far[1])) continue;
    if (opens(cx, cy) === 1 && cellD(cx, cy) > 8) ends.push([cx, cy, cellD(cx, cy)]);
  }
  ends.sort((a, b) => b[2] - a[2]);
  const picks = [];
  for (const e of ends) { if (picks.length >= 2) break; if (picks.every(p => Math.abs(p[0] - e[0]) + Math.abs(p[1] - e[1]) > C / 2)) picks.push(e); }
  const loot = depth === 2 ? ['hcont', 'gun'] : ['hcont', 'ammo'];
  picks.forEach((p, k) => {
    const key = `${L.key}-c${k}`;
    L.ents.push({ type: 'chest', x: (p[0] * 3 + 2) * TS, y: (p[1] * 3 + 2) * TS, r: 6, open: !!(G.prog && G.prog.chests[key]), loot: loot[k], key, onOpen: openMazeChest });
  });
  // a hunter who came before you
  { const spot = ends.find(e => !picks.includes(e)) || [far[0], far[1]];
    const c = makeCorpse((spot[0] * 3 + 2) * TS, (spot[1] * 3 + 2) * TS - 2); c.key = `${L.key}-b`; c.pool = 'maze' + Math.min(depth, 3); L.ents.push(c); }
  // enemies: only where the prison has closed in
  L.pool = fi.pool; L.hpMul = fi.hp;
  const cand = L.floors.filter(i => D[i] > 14 && WALK_T(L.t[i]) && (!L.hard || L.hard[i] > 0.6));
  L.baseCount = Math.round(fi.count * DIFF.spawn);
  for (let k = 0; k < L.baseCount && cand.length; k++) {
    const i = cand[Math.floor(R() * cand.length)];
    L.ents.push(makeEnemy(pick(R, L.pool), (i % S) * TS + 8, ((i / S) | 0) * TS + 8, L.hpMul));
  }
  if (fi.polyps) for (const rm of rooms) {
    const x = (rm.x * 3 + 2) * TS + 8, y = (rm.y * 3 + 2) * TS + 8;
    if (D[Math.floor(y / TS) * S + Math.floor(x / TS)] > 10) L.ents.push(makeEnemy('polyp', x, y, 1.3));
  }
  L.spT = 10;
  L.spawner = fi.s === 'breach' ? (L, dt) => { mazeSpawner(L, dt); breachTick(L, dt); } : mazeSpawner;
  L.goDown = mazeDown; L.goUp = mazeUp; L.audio = mazeAudio;
  L.drawUnder = drawEyes; L.drawOver = fi.s === 'breach' ? (L, cx, cy) => { drawBreach(L, cx, cy); mazeOver(L, cx, cy); } : mazeOver; L.markers = mazeMarkers;
  return L;
}

// ---- the outer works: grass and trees near the stairs, prison stone closing over as you go in ----
function hardenFromSurface(L, R, seed, sx, sy, far) {
  const S = L.w, x0 = sx * 3 + 1, y0 = sy * 3 + 1, span = Math.hypot(far[0] * 3 + 1 - x0, far[1] * 3 + 1 - y0) || 1;
  L.hard = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x, h = Math.hypot(x - x0, y - y0) / span + (hash2(x >> 1, y >> 1, seed) - 0.5) * 0.1;
    const g = smooth(0.1, 0.62, h); L.hard[i] = g;
    const t = L.t[i], u = R(), soft = 1 - g;
    if (soft < 0.03) continue;
    if (t === T.MWALL || t === T.MEYE) {
      if (x === 0 || y === 0 || x === S - 1 || y === S - 1) { if (u < soft) L.t[i] = R() < 0.5 ? T.TREE : T.PINE; continue; }
      if (x % 3 === 0 && y % 3 === 0 && u < soft * 0.5) { L.t[i] = R() < 0.5 ? T.TREE : T.PINE; continue; } // the old posts
      if (u < soft * 0.62) L.t[i] = R() < 0.15 ? T.FLOWERS : T.GRASS;
      else if (u < soft * 0.8) L.t[i] = R() < 0.6 ? T.TREE : T.PINE;
      else if (u < soft * 0.9) L.t[i] = R() < 0.85 ? T.BARRICADE : T.SIGN; // the prison's outer fence and its warnings
      // anything else stays: prison stone standing in the grass
    } else if (t === T.MFLOOR || t === T.MROOT || t === T.MBONES) {
      if (u < soft * 1.15) L.t[i] = u < soft * 0.15 ? T.FLOWERS : T.GRASS;
    }
  }
  L.eyes = L.eyes.filter(e => L.t[e.y * S + e.x] === T.MEYE);
  // past the edge: forest out by the entrance, solid prison stone further in
  L.edgeAt = (x, y) => L.hard[clamp(y, 0, S - 1) * S + clamp(x, 0, S - 1)] < 0.45 + hash2(x, y, seed) * 0.2 ? (hash2(x, y, seed + 1) < 0.5 ? T.TREE : T.PINE) : T.MWALL;
}
// how far into the prison a spot is: 0 out under the sky, 1 deep in the stone
export function hardAt(L, x, y) {
  if (!L.hard) return 1;
  const tx = clamp(Math.floor(x / TS), 0, L.w - 1), ty = clamp(Math.floor(y / TS), 0, L.h - 1);
  return L.hard[ty * L.w + tx];
}

// ---- the breach: flesh in the stone, and walls that herd you down ----
// Side passages behind you grow shut and new ways open ahead. The path between the two sets of stairs never closes,
// and a wall only moves if you can still reach both stairs (and every unopened chest) afterwards.
const BREACH_EVERY = 2.6, BREACH_WARN = 1.1, BREACH_MAX_OPEN = 14;
function setupBreach(L, R, sx, sy, far) {
  const S = L.w, C = L.cells;
  for (let y = 1; y < S - 1; y++) for (let x = 1; x < S - 1; x++) {
    const i = y * S + x;
    if (L.t[i] === T.MWALL && R() < 0.35) L.t[i] = T.FWALL;
    else if (L.t[i] === T.MFLOOR && R() < 0.06) L.t[i] = T.FVEIN;
  }
  // the spine: the cells on the shortest way from the up stairs to the down stairs
  const D = bfs(L, L.downI), sc = new Uint8Array(C * C);
  let cx = sx, cy = sy; sc[cy * C + cx] = 1;
  const cd = (x, y) => D[(y * 3 + 1) * S + x * 3 + 1];
  for (let guard = 0; guard < C * C && !(cx === far[0] && cy === far[1]); guard++) {
    let best = null, bd = cd(cx, cy);
    for (let k = 0; k < 4; k++) {
      const nx = cx + DX4[k], ny = cy + DY4[k]; if (nx < 0 || ny < 0 || nx >= C || ny >= C || !gapOpen(L, cx, cy, nx, ny)) continue;
      const d = cd(nx, ny); if (d >= 0 && d < bd) { bd = d; best = [nx, ny]; }
    }
    if (!best) break; [cx, cy] = best; sc[cy * C + cx] = 1;
  }
  L.spineCell = sc; L.moveT = 3; L.pend = [];
}
function gapTiles(L, ax, ay, bx, by) {
  const S = L.w;
  if (bx !== ax) { const wx = Math.min(ax, bx) * 3 + 3; return [(ay * 3 + 1) * S + wx, (ay * 3 + 2) * S + wx]; }
  const wy = Math.min(ay, by) * 3 + 3; return [wy * S + ax * 3 + 1, wy * S + ax * 3 + 2];
}
function gapOpen(L, ax, ay, bx, by) { return gapTiles(L, ax, ay, bx, by).every(i => WALK_T(L.t[i])); }
function gapShut(L, ax, ay, bx, by) { return gapTiles(L, ax, ay, bx, by).every(i => L.t[i] === T.MWALL || L.t[i] === T.FWALL); }
// can you still get from here to both stairs and to every unopened chest, with these tiles shut?
function stillReachable(L, from, block) {
  const D = bfs(L, from, block); if (D[L.upI] < 0 || D[L.downI] < 0) return false;
  for (const e of L.ents) if (e.type === 'chest' && !e.open && D[Math.floor(e.y / TS) * L.w + Math.floor(e.x / TS)] < 0) return false;
  return true;
}
export function breachReachable(L, from) { return stillReachable(L, from, null); }
// choose one passage behind you to grow shut and one wall ahead to open
export function planBreach(L, ptile, rnd) {
  const S = L.w, C = L.cells, E = bfs(L, L.downI), pe = E[ptile]; if (pe < 0) return null;
  const pcx = Math.floor((ptile % S) / 3), pcy = Math.floor(((ptile / S) | 0) / 3);
  const cE = (x, y) => E[(y * 3 + 1) * S + x * 3 + 1];
  const shut = [], open = [];
  for (let cy = 0; cy < C; cy++) for (let cx = 0; cx < C; cx++) {
    const near = Math.abs(cx - pcx) + Math.abs(cy - pcy); if (near < 1 || near > 5) continue;
    for (let k = 0; k < 2; k++) {
      const nx = cx + (k ? 0 : 1), ny = cy + (k ? 1 : 0); if (nx >= C || ny >= C) continue;
      const a = cE(cx, cy), b = cE(nx, ny), spA = L.spineCell[cy * C + cx], spB = L.spineCell[ny * C + nx];
      if (spA !== spB && gapOpen(L, cx, cy, nx, ny)) { // a side passage leaving the spine
        const sp = spA ? a : b; if (sp > pe + 3) shut.push([cx, cy, nx, ny]);
      } else if (gapShut(L, cx, cy, nx, ny) && a >= 0 && b >= 0 && Math.abs(a - b) >= 8 && Math.min(a, b) < pe) open.push([cx, cy, nx, ny]);
    }
  }
  const pickOK = (list, test) => { for (let tries = 0; tries < 6 && list.length; tries++) { const k = Math.floor(rnd() * list.length), g = list.splice(k, 1)[0]; if (test(g)) return g; } return null; };
  const s = pickOK(shut, g => stillReachable(L, ptile, gapTiles(L, ...g)));
  const o = pickOK(open, () => true);
  return { shut: s && gapTiles(L, ...s), open: o && gapTiles(L, ...o) };
}
export function applyBreach(L, tiles, shut) {
  for (const i of tiles) { L.t[i] = shut ? T.FWALL : T.FVEIN; if (L.seen[i]) paintSeen(L, i); }
  L.mapDirty = true; FLOW.ptx = -9999;
}
function occupied(L, i) {
  const x = (i % L.w) * TS + 8, y = ((i / L.w) | 0) * TS + 8;
  if (Math.abs(G.P.x - x) < 14 && Math.abs(G.P.y - y) < 14) return true;
  return L.ents.some(e => (e.type === 'enemy' || e.type === 'chest' || e.type === 'pickup' || e.type === 'corpse') && !e.dead && Math.abs(e.x - x) < 14 && Math.abs(e.y - y) < 14);
}
function breachTick(L, dt) {
  const P = G.P; if (P.dead || G.fade || G.L !== L) return;
  const ptile = Math.floor(P.y / TS) * L.w + Math.floor(P.x / TS);
  for (let k = L.pend.length - 1; k >= 0; k--) {
    const p = L.pend[k]; p.t -= dt;
    p.dust -= dt; if (p.dust <= 0) { p.dust = 0.22; const i = p.tiles[Math.floor(Math.random() * 2)]; burst((i % L.w) * TS + 8, ((i / L.w) | 0) * TS + 8, p.shut ? [150, 40, 54] : [90, 80, 74], 3, 0.4); }
    if (p.t > 0) continue;
    L.pend.splice(k, 1);
    if (p.tiles.some(i => occupied(L, i))) continue;
    if (p.shut && !stillReachable(L, ptile, p.tiles)) continue;
    applyBreach(L, p.tiles, p.shut); sfx('squelch');
    if (!G.breachWarned) { G.breachWarned = true; toast('The walls are moving', '', 4); }
  }
  L.moveT -= dt; if (L.moveT > 0) return;
  L.moveT = BREACH_EVERY * (DIFF.id === 'easy' ? 1.35 : 1);
  const plan = planBreach(L, ptile, Math.random); if (!plan) return;
  let any = false;
  // opening is rationed so the floor stays a maze and doesn't wear away into one big room
  const canOpen = (L.opened || 0) < BREACH_MAX_OPEN && Math.random() < 0.5;
  for (const [tiles, shut] of [[plan.shut, true], [canOpen && plan.open, false]]) if (tiles && !tiles.some(i => occupied(L, i))) {
    L.pend.push({ tiles, shut, t: BREACH_WARN, dust: 0 }); any = true; if (!shut) L.opened = (L.opened || 0) + 1;
  }
  if (any) { sfx('drag'); G.shake = Math.max(G.shake, 0.06); }
}
// the stone shudders before it moves
function drawBreach(L, cx, cy) {
  for (const p of L.pend) {
    const k = 1 - Math.max(0, p.t) / BREACH_WARN;
    for (const i of p.tiles) {
      const x = (i % L.w) * TS - cx + Math.round((Math.random() - 0.5) * 2), y = ((i / L.w) | 0) * TS - cy + Math.round((Math.random() - 0.5) * 2);
      bctx.fillStyle = p.shut ? `rgba(130,30,46,${0.25 + 0.5 * k})` : `rgba(10,4,6,${0.2 + 0.4 * k})`;
      if (p.shut) { const h = Math.round(TS * k); bctx.fillRect(x, y + TS - h, TS, h); } else bctx.fillRect(x + 2, y + 2, TS - 4, TS - 4);
    }
  }
}

function openMazeChest(c) {
  G.prog.chests[c.key] = 1; sfx('pickup'); burst(c.x, c.y - 4, [255, 210, 120], 10);
  const P = G.P;
  if (c.loot === 'ammo') {
    const found = [['Supply cache', '#c8b8ac']]; for (let k = 0; k < 2; k++) { const t = ammoTypeFor(P), n = ammoAmt(t, 1.5); giveAmmo(P, t, n); found.push(ammoPop(t, n)); }
    if (giveMed(P)) found.push(MED_POP);
    popAll(found);
  } else if (c.loot === 'gun') {
    const id = nextGun(P, true);
    if (id) { giveGun(P, id); toast('Found a ' + GUNS[id].name, GUNS[id].desc); popAll([gunPop(id)]); }
    else { const t = ammoTypeFor(P), n = ammoAmt(t, 2); giveAmmo(P, t, n); popAll([['Supply cache', '#c8b8ac'], ammoPop(t, n)]); }
  } else G.L.ents.push({ type: 'pickup', kind: c.loot, x: c.x, y: c.y + 12, r: 4, t: -60 });
  saveGame();
}
function mazeSpawner(L, dt) {
  L.spT -= dt; if (L.spT > 0) return; L.spT = 9;
  const P = G.P; let n = 0; for (const e of L.ents) if (e.type === 'enemy') n++;
  if (n >= L.baseCount * 0.6) return;
  for (let tries = 0; tries < 12; tries++) {
    const i = L.floors[Math.floor(Math.random() * L.floors.length)], x = (i % L.w) * TS + 8, y = ((i / L.w) | 0) * TS + 8;
    if (dist(x, y, P.x, P.y) < TS * 12 || L.noEnemy[i] || L.t[i] !== T.MFLOOR && L.t[i] !== T.MROOT && L.t[i] !== T.MBONES) continue;
    L.ents.push(makeEnemy(pick(Math.random, L.pool), x, y, L.hpMul)); break;
  }
}
function mazeAudio(L) {
  const a = L.alive, g = L.hard ? hardAt(L, G.P.x, G.P.y) : 1; // out under the sky the wind is louder and the stone is quiet
  return { wind: 0.025 + 0.05 * (1 - g), windF: 260 + 200 * (1 - g), drone: (0.04 + 0.1 * a) * g, droneF: 48 - 8 * a, bpm: 58 + 32 * a, beatVol: 0.08 + 0.4 * a };
}
function mazeMarkers(L, proj, sz) {
  for (const e of L.ents) if (e.type === 'chest' && !e.open && L.seen[Math.floor(e.y / TS) * L.w + Math.floor(e.x / TS)]) {
    const [x, y] = proj(e.x / TS, e.y / TS); ctx.fillStyle = '#ffd060'; ctx.fillRect(x - sz, y - sz, sz * 2, sz * 2);
  }
}
export function drawEyes(L, cx, cy) {
  const P = G.P;
  for (const e of L.eyes) {
    const ex = e.x * TS + 8, ey = e.y * TS + 8;
    if (ex < cx - 16 || ex > cx + BW + 16 || ey < cy - 16 || ey > cy + BH + 16) continue;
    const dpx = P.x - ex, dpy = P.y - ey, d = Math.hypot(dpx, dpy);
    const want = d < TS * (e.big ? 7 : 5) ? 1 : 0;
    e.open = (e.open || 0) + (want - (e.open || 0)) * 0.08;
    const blink = ((G.t * 0.23 + e.h) % 1) < 0.035;
    const op = blink ? 0 : e.open;
    const sx = ex - cx, sy = ey - cy, k = e.big ? 1.25 : 1;
    if (op < 0.08) continue;
    const half = [2, 4, 5, 4, 2], rows = Math.max(1, Math.round(op * 2.4));
    for (let dy = -2; dy <= 2; dy++) {
      if (Math.abs(dy) > rows) continue;
      const hw = Math.round(half[dy + 2] * k);
      bctx.fillStyle = dy === 0 ? '#f0e4d4' : '#d8c4b0'; bctx.fillRect(sx - hw, sy + dy, hw * 2, 1);
    }
    const px = Math.round(clamp(dpx / 40, -1, 1) * 2.5 * k), py = Math.round(clamp(dpy / 40, -1, 1) * Math.min(rows, 1.4));
    bctx.fillStyle = e.big ? '#d8a020' : '#9a1c24'; bctx.fillRect(sx + px - 1, sy + py - 1, 3, Math.min(3, rows * 2 + 1));
    bctx.fillStyle = '#080204'; bctx.fillRect(sx + px, sy + py - (rows > 1 ? 1 : 0), 1, rows > 1 ? 2 : 1);
  }
}
export function mazeOver(L, cx, cy) {
  // eyes and enemies glint through the dark
  for (const e of L.eyes) {
    if (!e.open || e.open < 0.3) continue;
    const sx = e.x * TS + 8 - cx, sy = e.y * TS + 8 - cy;
    bctx.fillStyle = `rgba(255,60,60,${0.35 * e.open})`; bctx.fillRect(sx - 1, sy, 2, 1);
  }
  for (const e of L.ents) {
    if (e.type !== 'enemy' || e.dir === 1) continue;
    const sx = Math.round(e.x - cx), sy = Math.round(e.y - cy);
    if (sx < -10 || sy < -10 || sx > BW + 10 || sy > BH + 10) continue;
    const h = e.d.hum ? 6 : 1, o = e.d.hum ? (e.dir === 2 ? -2 : e.dir === 3 ? 2 : 0) : 0;
    bctx.fillStyle = 'rgba(255,50,50,0.85)';
    if (e.d.hum && e.dir >= 2) bctx.fillRect(sx + o, sy - h, 1, 1);
    else { bctx.fillRect(sx - 1 + o, sy - h, 1, 1); bctx.fillRect(sx + 1 + o, sy - h, 1, 1); }
  }
  const a = L.alive, env = beatEnv();
  if (a > 0.3) {
    const g = bctx.createRadialGradient(BW / 2, BH / 2, Math.min(BW, BH) * 0.3, BW / 2, BH / 2, Math.max(BW, BH) * 0.7);
    g.addColorStop(0, 'rgba(120,0,20,0)'); g.addColorStop(1, `rgba(120,0,20,${0.35 * a * env})`);
    bctx.fillStyle = g; bctx.fillRect(0, 0, BW, BH);
  }
}

// ================= moving between levels =================
export function getLevel(key) {
  if (G.levels.has(key)) return G.levels.get(key);
  let L;
  if (key === 'over') return G.over;
  if (key.startsWith('h:')) { const h = G.over.doorMap.get(key.slice(2)); L = genHouse(h); L.atlas = G.over.atlas; initMap(L); G.levels.set(key, L); return L; }
  if (key === 'flesh') L = genFlesh(G.seed ^ 0x6a09e667);
  else { const [eid, d] = key.slice(1).split('-').map(Number); L = genMaze(G.seed ^ (eid * 7919 + d * 104729), d, eid); }
  L.atlas = buildAtlas(L.alive, G.seed + L.key.length * 31); initMap(L);
  G.levels.set(key, L);
  return L;
}
export function enterDungeon(tx, ty) {
  const d = G.over.dungeons.find(dd => dd.x === tx && dd.y === ty); if (!d) return;
  sfx('descend'); G.dungeon = d;
  const deep = clamp(G.maxDepth, 1, floorsN());
  if (deep > 1) transition(stageInfo(deep).title, 'The stairs remember you. They take you straight down.', () => { const L = getLevel(`m${d.id}-${deep}`); enterLevel(L, L.start.x, L.start.y); });
  else transition(stageInfo(1).title, stageInfo(1).sub, () => { const L = getLevel(`m${d.id}-1`); enterLevel(L, L.start.x, L.start.y); reachDepth(1); });
}
function mazeDown(L) {
  sfx('descend');
  if (L.depth < floorsN()) {
    const d = L.depth + 1;
    transition(stageInfo(d).title, stageInfo(d).sub, () => { const N = getLevel(`m${L.eid}-${d}`); enterLevel(N, N.start.x, N.start.y); reachDepth(d); });
  } else enterFlesh(L);
}
function mazeUp(L) {
  sfx('ascend');
  if (L.depth > 1) {
    const d = L.depth - 1;
    transition(stageInfo(d).title, 'Back up. It is colder here.', () => { const N = getLevel(`m${L.eid}-${d}`); enterLevel(N, N.downAt.x, N.downAt.y); });
  } else {
    const dg = G.over.dungeons[L.eid];
    transition('The Surface', 'Fresh air. It tastes thin now.', () => { enterLevel(G.over, dg.x * TS + 8, (dg.y + 1) * TS + 8); });
  }
}
export function reachDepth(d) {
  // when you first got to each floor, for the ending screen (and for timing playtests)
  const sp = G.stats.splits || (G.stats.splits = {}); if (sp[d] == null) sp[d] = Math.round(G.stats.time);
  if (d <= G.maxDepth) return;
  G.maxDepth = d; growSurfaceVeins(); saveGame();
}
// the deeper you have been, the more the surface around the stairs comes alive
export function growSurfaceVeins() {
  const L = G.over, rad = 7 + G.maxDepth * 4;
  for (const dg of L.dungeons) for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
    const x = dg.x + dx, y = dg.y + dy, d = Math.hypot(dx, dy); if (d > rad || !L.inb(x, y)) continue;
    const i = y * L.w + x;
    if (isGround(L.t[i]) && hash2(x, y, G.seed + 99) < 0.75 * (1 - d / (rad + 1))) { L.t[i] = T.VEINS; if (L.seen[i]) paintSeen(L, i); L.mapDirty = true; }
  }
}

// ================= self-check for World tests =================
// Builds every floor of the descent for both lengths (3 and 4 floors) and checks each one can be walked from the
// up stairs to the down stairs. On the breach it walks that path while the walls move, checking after every move.
export function descentProblems(seed, eid = 0) {
  const out = [], rnd = mulberry32((seed ^ 0x5eed) >>> 0);
  for (const n of [3, 4]) for (let d = 1; d <= n; d++) {
    const L = genMaze(seed ^ (eid * 7919 + d * 104729), d, eid, n), name = `${n}-floor descent, ${L.name}`;
    if (!breachReachable(L, L.upI)) { out.push(`${name}: can't walk from the up stairs to the down stairs`); continue; }
    if (L.stage === 'gradient') {
      if (L.hard[L.upI] > 0.15) out.push(`${name}: the entrance is already deep in stone`);
      if (L.hard[L.downI] < 0.9) out.push(`${name}: the stairs down are still out under the sky`);
    }
    if (L.stage !== 'breach') continue;
    // walk the shortest way down, letting the walls move as you go
    let p = L.upI, moves = 0;
    for (let step = 0; step < 4000 && p !== L.downI; step++) {
      if (step % 3 === 0) for (let k = 0; k < 2; k++) {
        const plan = planBreach(L, p, rnd); if (!plan) break;
        if (plan.shut) { applyBreach(L, plan.shut, true); moves++; }
        if (plan.open) { applyBreach(L, plan.open, false); moves++; }
        if (!breachReachable(L, p)) { out.push(`${name}: a moving wall cut you off`); step = 1e9; break; }
      }
      const E = breachDist(L, L.downI), S = L.w, x = p % S, y = (p / S) | 0; let next = -1;
      for (let k = 0; k < 4; k++) { const nx = x + DX4[k], ny = y + DY4[k]; if (!L.inb(nx, ny)) continue; const q = ny * S + nx; if (E[q] >= 0 && E[q] < E[p]) { next = q; break; } }
      if (next < 0) { if (p !== L.downI) out.push(`${name}: lost the way down mid-walk`); break; }
      p = next;
    }
    if (!moves) out.push(`${name}: the walls never moved`);
  }
  return out;
}
function breachDist(L, from) { return bfs(L, from); }
