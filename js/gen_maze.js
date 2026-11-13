import { clamp, dist, hash2, Level, mulberry32, pick, rint, T, TS } from './core.js';
import { DIFF, floorsN } from './difficulty.js';
import { buildAtlas } from './art.js';
import { makeEnemy } from './entities.js';
import { DX4, DY4, isGround } from './gen_overworld.js';
import { enterFlesh, genFlesh } from './gen_flesh.js';
import { genHouse } from './gen_house.js';
import { sfx } from './audio.js';
import {
  AMMO_NAME, ammoAmt, ammoTypeFor, giveAmmo, giveGun, GUNS, listText, nextGun
} from './weapons.js';
import {
  bctx, beatEnv, BH, burst, BW, ctx, enterLevel, G, initMap, makeCorpse, paintSeen, saveGame, toast,
  transition
} from './game.js';

// ================= maze floors (level 2) =================
const MAZE_FLOORS = 3;
const FLOOR_INFO = [null,
  { alive: 0.15, sub: 'Cold stone. Something drips.', light: 86 },
  { alive: 0.45, sub: 'The walls are warm to the touch.', light: 80 },
  { alive: 0.78, sub: 'It is breathing.', light: 74 },
];
function floorInfoIdx(d) { const n = floorsN(); return n === 1 ? 2 : clamp(Math.round(1 + (d - 1) / (n - 1) * 2), 1, 3); }
const MAZE_ENEMIES = [null, ['husk', 'husk', 'mite'], ['husk', 'mite', 'worm', 'husk'], ['worm', 'husk', 'mite', 'worm', 'antibody']];

function genMaze(seed, depth, eid) {
  const R = mulberry32(seed >>> 0), C = 10 + depth * 3, S = C * 3 + 1;
  const L = new Level('maze', S, S); L.edge = T.MWALL; L.t.fill(T.MWALL);
  const fi = FLOOR_INFO[floorInfoIdx(depth)];
  L.depth = depth; L.eid = eid; L.alive = fi.alive; L.lightR = fi.light; L.revealR = 5;
  L.name = `The Below  ·  Floor ${depth}`; L.key = `m${eid}-${depth}`;
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
  const braid = 0.07 + depth * 0.03;
  for (let cy = 0; cy < C; cy++) for (let cx = 0; cx < C; cx++) {
    if (cx < C - 1 && R() < braid) carveBetween(cx, cy, cx + 1, cy);
    if (cy < C - 1 && R() < braid) carveBetween(cx, cy, cx, cy + 1);
  }
  // rooms with pillars
  const rooms = [];
  for (let k = 0; k < 2 + (depth > 1 ? 1 : 0); k++) {
    const w = rint(R, 2, 3), h = rint(R, 2, 3), rx = rint(R, 1, C - w - 1), ry = rint(R, 1, C - h - 1);
    if (Math.abs(rx - sx) < 3 && Math.abs(ry - sy) < 3) continue;
    for (let y = ry * 3 + 1; y < (ry + h) * 3; y++) for (let x = rx * 3 + 1; x < (rx + w) * 3; x++) if (!(x % 3 === 0 && y % 3 === 0)) L.set(x, y, T.MFLOOR);
    rooms.push({ x: rx, y: ry, w, h });
  }
  // distances from the start
  const N = S * S, D = new Int32Array(N).fill(-1), q = new Int32Array(N); let qh = 0, qt = 0;
  const s0 = (sy * 3 + 1) * S + sx * 3 + 1; D[s0] = 0; q[qt++] = s0;
  while (qh < qt) {
    const c = q[qh++], x = c % S, y = (c / S) | 0;
    for (let k = 0; k < 4; k++) { const nx = x + DX4[k], ny = y + DY4[k]; if (!L.inb(nx, ny)) continue; const n = ny * S + nx; if (D[n] >= 0 || L.t[n] === T.MWALL) continue; D[n] = D[c] + 1; q[qt++] = n; }
  }
  const cellD = (cx, cy) => D[(cy * 3 + 1) * S + cx * 3 + 1];
  let far = [sx, sy], fd = 0;
  for (let cy = 0; cy < C; cy++) for (let cx = 0; cx < C; cx++) if (cellD(cx, cy) > fd) { fd = cellD(cx, cy); far = [cx, cy]; }
  L.set(sx * 3 + 1, sy * 3 + 1, T.STAIRS_UP);
  L.set(far[0] * 3 + 1, far[1] * 3 + 1, T.STAIRS_DOWN);
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
  L.randomizeVariants(seed + 3);
  // chests in far dead ends
  const opens = (cx, cy) => {
    let n = 0; const bx = cx * 3 + 1, by = cy * 3 + 1;
    if (L.get(bx + 2, by) !== T.MWALL) n++; if (L.get(bx - 1, by) !== T.MWALL) n++;
    if (L.get(bx, by + 2) !== T.MWALL) n++; if (L.get(bx, by - 1) !== T.MWALL) n++;
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
    const c = makeCorpse((spot[0] * 3 + 2) * TS, (spot[1] * 3 + 2) * TS - 2); c.key = `${L.key}-b`; c.pool = 'maze' + depth; L.ents.push(c); }
  // enemies
  const pool = MAZE_ENEMIES[floorInfoIdx(depth)], cand = L.floors.filter(i => D[i] > 14);
  L.baseCount = Math.round((7 + depth * 4) * DIFF.spawn);
  for (let k = 0; k < L.baseCount && cand.length; k++) {
    const i = cand[Math.floor(R() * cand.length)];
    L.ents.push(makeEnemy(pick(R, pool), (i % S) * TS + 8, ((i / S) | 0) * TS + 8, 1 + (depth - 1) * 0.35));
  }
  if (floorInfoIdx(depth) === 3) for (const rm of rooms) {
    const x = (rm.x * 3 + 2) * TS + 8, y = (rm.y * 3 + 2) * TS + 8;
    if (D[Math.floor(y / TS) * S + Math.floor(x / TS)] > 10) L.ents.push(makeEnemy('polyp', x, y, 1.3));
  }
  L.spT = 10;
  L.spawner = mazeSpawner; L.goDown = mazeDown; L.goUp = mazeUp; L.audio = mazeAudio;
  L.drawUnder = drawEyes; L.drawOver = mazeOver; L.markers = mazeMarkers;
  return L;
}
function openMazeChest(c) {
  G.prog.chests[c.key] = 1; sfx('pickup'); burst(c.x, c.y - 4, [255, 210, 120], 10);
  const P = G.P;
  if (c.loot === 'ammo') {
    const found = []; for (let k = 0; k < 2; k++) { const t = ammoTypeFor(P), n = ammoAmt(t, 1.5); giveAmmo(P, t, n); found.push(`${n} ${AMMO_NAME[t]}`); }
    P.meds = Math.min(5, P.meds + 1); found.push('a medkit');
    toast('Supply cache', 'Found ' + listText(found) + '.');
  } else if (c.loot === 'gun') {
    const id = nextGun(P, true);
    if (id) { giveGun(P, id); toast('Found a ' + GUNS[id].name, GUNS[id].desc); }
    else { const t = ammoTypeFor(P), n = ammoAmt(t, 2); giveAmmo(P, t, n); toast('Supply cache', `Found ${n} ${AMMO_NAME[t]}.`); }
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
    L.ents.push(makeEnemy(pick(Math.random, MAZE_ENEMIES[floorInfoIdx(L.depth)]), x, y, 1 + (L.depth - 1) * 0.35)); break;
  }
}
function mazeAudio(L) { const a = L.alive; return { wind: 0.025, windF: 260, drone: 0.04 + 0.1 * a, droneF: 48 - 8 * a, bpm: 58 + 32 * a, beatVol: 0.08 + 0.4 * a }; }
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
  if (deep > 1) transition(`Floor ${deep}`, 'The stairs remember you. They take you straight down.', () => { const L = getLevel(`m${d.id}-${deep}`); enterLevel(L, L.start.x, L.start.y); });
  else transition('The Below', 'Floor 1. ' + FLOOR_INFO[floorInfoIdx(1)].sub, () => { const L = getLevel(`m${d.id}-1`); enterLevel(L, L.start.x, L.start.y); reachDepth(1); });
}
function mazeDown(L) {
  sfx('descend');
  if (L.depth < floorsN()) {
    const d = L.depth + 1;
    transition(`Floor ${d}`, FLOOR_INFO[floorInfoIdx(d)].sub, () => { const N = getLevel(`m${L.eid}-${d}`); enterLevel(N, N.start.x, N.start.y); reachDepth(d); });
  } else enterFlesh(L);
}
function mazeUp(L) {
  sfx('ascend');
  if (L.depth > 1) {
    const d = L.depth - 1;
    transition(`Floor ${d}`, 'Back up. It is colder here.', () => { const N = getLevel(`m${L.eid}-${d}`); enterLevel(N, N.downAt.x, N.downAt.y); });
  } else {
    const dg = G.over.dungeons[L.eid];
    transition('The Surface', 'Fresh air. It tastes thin now.', () => { enterLevel(G.over, dg.x * TS + 8, (dg.y + 1) * TS + 8); });
  }
}
export function reachDepth(d) {
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
