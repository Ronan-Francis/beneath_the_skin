import {
  clamp, dist, hash2, Level, MinHeap, mulberry32, pick, rint, smooth, T, TAU, TP, TS
} from './core.js';
import { fbmT, makePerlinP } from './noise.js';
import { settlementFixes, WATER_T, wcWaterDist } from './worldchecks.js';

// ================= overworld generation =================
const TOWN_A = ['Bally', 'Kil', 'Dun', 'Ross', 'Clon', 'Lis', 'Ard', 'Knock', 'Glen', 'Cappa', 'Inis', 'Drum', 'Carrig', 'Bel'];
const TOWN_B = ['more', 'beg', 'carra', 'lough', 'keel', 'nagh', 'ross', 'vara', 'dare', 'fin', 'gorm', 'shee', 'tully', 'owen'];
const townName = R => pick(R, TOWN_A) + pick(R, TOWN_B);
export const DX4 = [1, -1, 0, 0], DY4 = [0, 0, 1, -1];

function astar(L, sx, sy, tx, ty, cost) {
  const W = L.w, N = L.w * L.h;
  const g = new Float32Array(N).fill(1e30), came = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
  const hp = new MinHeap(1 << 15);
  const s = sy * W + sx, t = ty * W + tx; g[s] = 0; hp.push(0, s);
  while (hp.n) {
    const c = hp.pop(); if (c === t) break; if (closed[c]) continue; closed[c] = 1;
    const cx = c % W, cy = (c / W) | 0;
    for (let k = 0; k < 4; k++) {
      let nx = cx + DX4[k], ny = cy + DY4[k];
      if (L.wrap) { nx = L.wx(nx); ny = L.wy(ny); } else if (nx < 0 || ny < 0 || nx >= W || ny >= L.h) continue;
      const n = ny * W + nx; if (closed[n]) continue;
      const kc = cost(L.t[n]); if (kc >= 1e9) continue;
      const ng = g[c] + kc;
      let hx = Math.abs(nx - tx), hy = Math.abs(ny - ty); if (L.wrap) { hx = Math.min(hx, W - hx); hy = Math.min(hy, L.h - hy); }
      if (ng < g[n]) { g[n] = ng; came[n] = c; hp.push(ng + 0.9 * (hx + hy), n); }
    }
  }
  if (s !== t && came[t] < 0) return null;
  const path = []; let c = t;
  while (c !== -1) { path.push(c); if (c === s) break; c = came[c]; }
  return path.reverse();
}
function roadCost(t) {
  switch (t) {
    case T.SHALLOW: return 14; case T.RIVER: return 7; case T.SAND: return 1.5;
    case T.GRASS: case T.FLOWERS: case T.VEINS: case T.MOOR: return 1; case T.DESERT: return 1.3; case T.FOREST: return 1.8; case T.TREE: return 2.6; case T.PINE: return 3.2;
    case T.HILL: return 2.8; case T.MOUNTAIN: return 16; case T.SNOW: return 34; case T.SWAMP: return 4;
    case T.ROAD: case T.BRIDGE_H: case T.BRIDGE_V: return 0.4; case T.COBBLE: return 0.5;
    default: return 1e9;
  }
}
function layRoad(L, path) {
  for (let k = 0; k < path.length; k++) {
    const i = path[k], t = L.t[i];
    if (t === T.COBBLE || t === T.BRIDGE_H || t === T.BRIDGE_V) continue;
    if (TP[t].water) {
      const a = path[Math.max(0, k - 1)], b = path[Math.min(path.length - 1, k + 1)];
      L.t[i] = ((a / L.w) | 0) === ((b / L.w) | 0) ? T.BRIDGE_H : T.BRIDGE_V;
    } else L.t[i] = T.ROAD;
  }
}
export const isGround = t => t === T.GRASS || t === T.FLOWERS || t === T.FOREST || t === T.SAND || t === T.HILL || t === T.DESERT || t === T.MOOR;

function buildTown(L, cx, cy, R, townMap, idx, names, rad) {
  const W = L.w, r = rad || 7 + Math.floor(R() * 4);
  let name; do { name = townName(R); } while (names.has(name) && names.size < 150); names.add(name);
  for (let dy = -r - 2; dy <= r + 2; dy++) for (let dx = -r - 2; dx <= r + 2; dx++) {
    if (dx * dx + dy * dy > (r + 2) * (r + 2)) continue;
    const t = L.get(cx + dx, cy + dy);
    if (t === T.TREE || t === T.PINE || t === T.FOREST) L.set(cx + dx, cy + dy, T.GRASS);
  }
  const ps = r >= 9 ? 3 : 2;
  for (let dy = -ps; dy <= ps; dy++) for (let dx = -ps; dx <= ps; dx++) if (!TP[L.get(cx + dx, cy + dy)].water) L.set(cx + dx, cy + dy, T.COBBLE);
  L.set(cx, cy, T.WELL);
  for (const [lx, ly] of [[cx - ps, cy - ps], [cx + ps, cy - ps], [cx - ps, cy + ps], [cx + ps, cy + ps]]) {
    if (L.get(lx, ly) === T.COBBLE) { L.set(lx, ly, T.LAMP); L.lights.push({ x: lx * TS + 8, y: ly * TS + 5, r: 70, col: [255, 196, 120], flick: 1 }); }
  }
  const houses = []; const target = 3 + Math.floor(r / 2) + Math.floor(R() * 2), hid = L.hexOf ? L.hexOf[L.idx(cx, cy)] : -1;
  for (let a = 0; a < 70 && houses.length < target; a++) {
    const w = rint(R, 3, 5), h = rint(R, 3, 4), ang = R() * TAU, dd = ps + 2.5 + R() * (r - ps - 1.5);
    const hx = Math.round(cx + Math.cos(ang) * dd - w / 2), hy = Math.round(cy + Math.sin(ang) * dd - h / 2);
    let ok = true;
    // every house stays on open ground and inside its own hex
    for (let y = hy - 1; y <= hy + h && ok; y++) for (let x = hx - 1; x <= hx + w; x++) if (!isGround(L.get(x, y)) || (hid >= 0 && y >= hy && y < hy + h && x >= hx && x < hx + w && L.hexOf[L.idx(x, y)] !== hid)) { ok = false; break; }
    if (!ok) continue;
    const col = Math.floor(R() * 4);
    for (let y = hy; y < hy + h; y++) for (let x = hx; x < hx + w; x++) {
      L.set(x, y, y < hy + h - 1 ? T.ROOF : T.WALL);
      if (y < hy + h - 1) L.v[y * W + x] = col;
    }
    const dxr = hx + 1 + Math.floor(R() * (w - 2)); L.set(dxr, hy + h - 1, T.DOOR);
    const lt = { x: dxr * TS + 8, y: (hy + h) * TS + 2, r: 34, col: [255, 180, 100], flick: 0.5 }; L.lights.push(lt);
    houses.push({ x: hx, y: hy, w, h, door: [dxr, hy + h], light: lt });
  }
  // little dirt paths from each door to the plaza (local BFS)
  const B = r + 4, BW = B * 2 + 1;
  for (const hs of houses) {
    const prev = new Int32Array(BW * BW).fill(-2); const q = [];
    const sx = hs.door[0] - cx + B, sy = hs.door[1] - cy + B;
    if (sx < 0 || sy < 0 || sx >= BW || sy >= BW) continue;
    prev[sy * BW + sx] = -1; q.push(sy * BW + sx); let found = -1;
    for (let qi = 0; qi < q.length; qi++) {
      const c = q[qi], lx = c % BW, ly = (c / BW) | 0; const t = L.get(lx - B + cx, ly - B + cy);
      if (t === T.COBBLE) { found = c; break; }
      for (let k = 0; k < 4; k++) {
        const nx = lx + DX4[k], ny = ly + DY4[k]; if (nx < 0 || ny < 0 || nx >= BW || ny >= BW) continue;
        const n = ny * BW + nx; if (prev[n] !== -2) continue;
        const tt = L.get(nx - B + cx, ny - B + cy);
        if (TP[tt].solid || TP[tt].water) continue;
        prev[n] = c; q.push(n);
      }
    }
    for (let c = found; c >= 0; c = prev[c]) {
      const x = c % BW - B + cx, y = ((c / BW) | 0) - B + cy;
      if (L.get(x, y) !== T.COBBLE) L.set(x, y, T.ROAD);
    }
  }
  const rr = r + 3;
  for (let dy = -rr; dy <= rr; dy++) for (let dx = -rr; dx <= rr; dx++) {
    if (dx * dx + dy * dy > rr * rr || !L.inb(cx + dx, cy + dy)) continue;
    townMap[(cy + dy) * W + cx + dx] = idx + 1;
  }
  return { x: cx, y: cy, r, ps, name, idx, houses, seen: false, unease: 0 };
}

function placeDungeon(L, x, y, seed) {
  for (let dy = -7; dy <= 7; dy++) for (let dx = -7; dx <= 7; dx++) {
    const d = Math.hypot(dx, dy); const t = L.get(x + dx, y + dy);
    if (d <= 2.2 && (t === T.TREE || t === T.PINE)) L.set(x + dx, y + dy, t === T.PINE ? T.HILL : T.FOREST);
    const t2 = L.get(x + dx, y + dy);
    if (d > 0 && isGround(t2) && hash2(x + dx, y + dy, seed) < 0.8 * (1 - d / 7)) L.set(x + dx, y + dy, T.VEINS);
  }
  const under = L.get(x, y);
  L.set(x, y, T.DUNGEON);
  const light = { x: x * TS + 8, y: y * TS + 8, r: 46, col: [255, 40, 60], flick: 0.3, glow: true }; L.lights.push(light);
  return { under, light };
}

export const HEX_S = 17, HEX_C = 17, HEX_R = 20, SQ3 = Math.sqrt(3);
const WORLD_W = Math.round(HEX_C * HEX_S * SQ3), WORLD_H = Math.round(HEX_R * 1.5 * HEX_S);
export function genOverworld(seed) {
  const W = WORLD_W, H = WORLD_H, N = W * H;
  const R = mulberry32((seed ^ 0x5bd1e995) >>> 0);
  const pE = makePerlinP(R), pR = makePerlinP(R), pM = makePerlinP(R), pW = makePerlinP(R), pC = makePerlinP(R);
  const L = new Level('over', W, H); L.edge = T.DEEP; L.name = 'The Surface'; L.seed = seed; L.wrap = true; L.fixes = {};
  const el = new Float32Array(N), mo = new Float32Array(N);
  const cW = Math.round(W / 120), cH = Math.round(H / 120);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const wx = x + 24 * pW(x / W * 7, y / H * 7, 7, 7), wy = y + 24 * pW(x / W * 7 + 19, y / H * 7 + 7, 7, 7);
    let e = fbmT(pE, wx, wy, W, H, cW, cH, 6);
    const rg = Math.max(0, 1 - Math.abs(fbmT(pR, wx, wy, W, H, 6, 6, 4)) * 2.2);
    e += 0.42 * rg * rg * rg * smooth(-0.04, 0.2, e);
    el[i] = e; mo[i] = fbmT(pM, x, y, W, H, 5, 5, 4) * 1.6;
  }
  const srt = Float32Array.from(el).sort(); const q = p => srt[Math.min(N - 1, Math.floor(p * N))];
  const qDeep = q(0.25), qWater = q(0.32), qSand = q(0.345), qHill = q(0.80), qMount = q(0.885), qSnow = q(0.955);
  const wrapI = (x, y) => (((y % H) + H) % H) * W + (((x % W) + W) % W);

  // ---- drainage: priority flood from every sea cell (no map edges: the world wraps) ----
  const vis = new Uint8Array(N), down = new Int32Array(N).fill(-1), order = new Int32Array(N), fill = new Float32Array(N);
  let oc = 0; const hp = new MinHeap(1 << 17);
  for (let i = 0; i < N; i++) if (el[i] < qWater) { vis[i] = 1; fill[i] = el[i]; hp.push(el[i], i); }
  while (hp.n) {
    const c = hp.pop(); order[oc++] = c; const cx = c % W, cy = (c / W) | 0, f = fill[c];
    for (let k = 0; k < 4; k++) {
      const n = wrapI(cx + DX4[k], cy + DY4[k]); if (vis[n]) continue;
      vis[n] = 1; fill[n] = Math.max(el[n], f + 1e-5); down[n] = c; hp.push(fill[n], n);
    }
  }
  const acc = new Float32Array(N); let landN = 0;
  for (let i = 0; i < N; i++) if (el[i] >= qWater) { acc[i] = 1 + 1.6 * smooth(qSand, qMount, el[i]) + 0.6 * clamp(mo[i] + 0.4, 0, 1); landN++; }
  for (let k = oc - 1; k >= 0; k--) { const c = order[k], d = down[c]; if (d >= 0) acc[d] += acc[c]; }
  const la = new Float32Array(landN), ld = new Float32Array(landN); let li = 0;
  for (let i = 0; i < N; i++) if (el[i] >= qWater) { la[li] = acc[i]; ld[li] = fill[i] - el[i]; li++; }
  la.sort(); ld.sort();
  const riverT = Math.max(220, la[Math.floor(0.975 * landN)]);
  const lakeT = Math.max(0.012, ld[Math.floor(0.975 * landN)]);

  // ---- biomes ----
  for (let i = 0; i < N; i++) {
    const x = i % W, y = (i / W) | 0, e = el[i], m = mo[i]; let t;
    if (e < qDeep) t = T.DEEP;
    else if (e < qWater) t = T.SHALLOW;
    else if (fill[i] - e > lakeT) t = (fill[i] - e > lakeT * 4) ? T.DEEP : T.SHALLOW;
    else if (e < qSand) t = m > 0.28 ? T.SWAMP : T.SAND;
    else if (e >= qSnow) t = T.SNOW;
    else if (e >= qMount) t = T.MOUNTAIN;
    else if (e >= qHill) t = hash2(x, y, seed + 3) < 0.06 + 0.22 * clamp(m + 0.25, 0, 1) ? T.PINE : T.HILL;
    else {
      const cl = pC(x / W * 72, y / H * 72, 72, 72);
      if (m > 0.1) { t = T.FOREST; if (cl + (m - 0.1) * 0.8 > 0 && hash2(x, y, seed + 5) < 0.45) t = T.TREE; }
      else if (m < -0.2) t = hash2(x, y, seed + 7) < 0.1 ? T.FLOWERS : T.GRASS;
      else { t = T.GRASS; const h = hash2(x, y, seed + 9); if (h < 0.018) t = T.TREE; else if (h < 0.04) t = T.FLOWERS; }
      if (e < qSand + 0.02 && m > 0.32) t = T.SWAMP;
    }
    L.t[i] = t;
  }
  // ---- rivers (they carry on across the map edge) ----
  for (let i = 0; i < N; i++) {
    if (el[i] < qWater || acc[i] < riverT) continue;
    const x = i % W, y = (i / W) | 0, wide = acc[i] > riverT * 6 ? 1 : 0;
    for (let dy = 0; dy <= wide; dy++) for (let dx = 0; dx <= wide; dx++) {
      const j = wrapI(x + dx, y + dy); if (L.t[j] !== T.DEEP && L.t[j] !== T.SHALLOW && fill[j] >= fill[i] - 1e-6) L.t[j] = T.RIVER;
    }
  }
  const valley = [];
  for (let i = 0; i < N; i++) if (L.t[i] === T.RIVER) {
    const x = i % W, y = (i / W) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const j = wrapI(x + dx, y + dy), t = L.t[j]; if (t === T.MOUNTAIN || t === T.SNOW || t === T.PINE) valley.push(j); }
  }
  for (const j of valley) L.t[j] = T.HILL;
  biomeRules(L);
  L.randomizeVariants(seed + 11);
  L.fillEl = fill; L.el = el;
  buildRegions(L, R, seed, el);
  settlementFixes(L);
  return L;
}
// ---- biome rules the checks enforce: shores, deserts, swamp grass, bare rock round mountain lakes ----
export function wdistT(L, a, b) { let dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y); if (L.wrap) { dx = Math.min(dx, L.w - dx); dy = Math.min(dy, L.h - dy); } return Math.hypot(dx, dy); }
export function fixCount(L, id, n = 1) { L.fixes[id] = (L.fixes[id] || 0) + n; }
function biomeRules(L) {
  const W = L.w, N = W * L.h;
  const WD = wcWaterDist(L, 7);
  for (let i = 0; i < N; i++) {
    const t = L.t[i], x = i % W, y = (i / W) | 0;
    if (t === T.SAND && WD[i] > 3) { L.t[i] = T.DESERT; fixCount(L, 'beach-water'); }
    else if (t === T.SWAMP && WD[i] > 6) { L.t[i] = T.MOOR; fixCount(L, 'swamp-low'); }
    else if (t === T.SNOW) { for (let k = 0; k < 4; k++) { const n = L.get(x + DX4[k], y + DY4[k]); if (n === T.SAND || n === T.SWAMP || n === T.DESERT || n === T.MOOR || WATER_T(n)) { L.t[i] = T.MOUNTAIN; fixCount(L, 'snow-high'); break; } } }
  }
  const hilly = t => t === T.HILL || t === T.PINE || t === T.MOUNTAIN || t === T.SNOW || t === T.RIVER;
  for (let i = 0; i < N; i++) {
    if (L.t[i] !== T.PINE) continue; const x = i % W, y = (i / W) | 0; let n = 0;
    for (let k = 0; k < 4; k++) if (hilly(L.get(x + DX4[k], y + DY4[k]))) n++;
    if (!n) { L.t[i] = T.TREE; fixCount(L, 'pine-hills'); }
  }
}
// ================= hex regions: wilderness, towns, cities =================
const NB_EVEN = [[1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]], NB_ODD = [[1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1]];
const HW = WORLD_W / HEX_C, HV = WORLD_H / HEX_R;
function hexCenter(c, r) { return [HW * (c + 0.5 * (r & 1)), HV * r]; }
function pixelToHexRaw(px, py) {
  px *= HEX_S * SQ3 / HW; py *= 1.5 * HEX_S / HV;
  const q = (SQ3 / 3 * px - py / 3) / HEX_S, r = (2 / 3 * py) / HEX_S;
  let x = q, z = r, y = -x - z, rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
  const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz; else if (dy > dz) ry = -rx - rz; else rz = -rx - ry;
  return [rx + (rz - (rz & 1)) / 2, rz];
}
function pixelToHex(px, py) { const [c, r] = pixelToHexRaw(px, py); return [((c % HEX_C) + HEX_C) % HEX_C, ((r % HEX_R) + HEX_R) % HEX_R]; }
// hex distance on a grid that wraps both ways
export function hexDist(a, b) {
  let best = 1e9;
  for (const sc of [-HEX_C, 0, HEX_C]) for (const sr of [-HEX_R, 0, HEX_R]) {
    const bc = b.c + sc, br = b.r + sr;
    const ax = a.c - (a.r - (a.r & 1)) / 2, bx = bc - (br - (br & 1)) / 2, dx = ax - bx, dz = a.r - br;
    best = Math.min(best, Math.max(Math.abs(dx), Math.abs(dz), Math.abs(dx + dz)));
  }
  return best;
}
function makeHexGrid(L) {
  const HC = HEX_C, HR = HEX_R, hexes = [];
  for (let r = 0; r < HR; r++) for (let c = 0; c < HC; c++) {
    const [x, y] = hexCenter(c, r);
    hexes.push({ id: r * HC + c, c, r, x, y, cx: Math.round(x), cy: Math.round(y), n: 0, land: 0, mount: 0, nb: [], type: 'sea', fog: 0, full: true, seam: false });
  }
  for (const h of hexes) for (const [dc, dr] of (h.r & 1) ? NB_ODD : NB_EVEN) h.nb.push((((h.r + dr) % HR + HR) % HR) * HC + (((h.c + dc) % HC + HC) % HC));
  const hexOf = new Int16Array(L.w * L.h);
  for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
    const [rc, rr] = pixelToHexRaw(x + 0.5, y + 0.5), c = ((rc % HC) + HC) % HC, r = ((rr % HR) + HR) % HR, id = r * HC + c;
    hexOf[y * L.w + x] = id;
    if (rc !== c || rr !== r) hexes[id].seam = true; // this hex is split across the edge of the map
  }
  return { HC, HR, hexes, hexOf };
}
export function nearestTile(L, x, y, rad, ok) {
  for (let d = 0; d <= rad; d++) for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue;
    if (L.inb(x + dx, y + dy) && ok(x + dx, y + dy)) return [x + dx, y + dy];
  }
  return null;
}
function buildHamlet(L, cx, cy, R, townMap, idx, names, hexId) {
  const W = L.w; let name; do { name = townName(R); } while (names.has(name) && names.size < 190); names.add(name);
  const houses = [], target = rint(R, 2, 4);
  for (let a = 0; a < 50 && houses.length < target; a++) {
    const w = rint(R, 3, 4), h = 3, ang = R() * TAU, dd = 2 + R() * 8;
    const hx = Math.round(cx + Math.cos(ang) * dd - w / 2), hy = Math.round(cy + Math.sin(ang) * dd - h / 2);
    let ok = true;
    for (let y = hy - 2; y <= hy + h + 1 && ok; y++) for (let x = hx - 2; x <= hx + w + 1; x++) {
      const t = L.get(x, y); if (!(isGround(t) || t === T.TREE) || L.hexOf[y * W + x] !== hexId) { ok = false; break; }
    }
    if (!ok) continue;
    for (let y = hy - 2; y <= hy + h + 1; y++) for (let x = hx - 2; x <= hx + w + 1; x++) if (L.get(x, y) === T.TREE || L.get(x, y) === T.FOREST) L.set(x, y, T.GRASS);
    const col = Math.floor(R() * 4);
    for (let y = hy; y < hy + h; y++) for (let x = hx; x < hx + w; x++) { L.set(x, y, y < hy + h - 1 ? T.ROOF : T.WALL); if (y < hy + h - 1) L.v[y * W + x] = col; }
    const dxr = hx + 1 + Math.floor(R() * (w - 2)); L.set(dxr, hy + h - 1, T.DOOR);
    for (const yy of [hy + h, hy + h + 1]) if (!TP[L.get(dxr, yy)].water) L.set(dxr, yy, T.ROAD);
    const lt = { x: dxr * TS + 8, y: (hy + h) * TS + 2, r: 34, col: [255, 180, 100], flick: 0.5 }; L.lights.push(lt);
    houses.push({ x: hx, y: hy, w, h, door: [dxr, hy + h], light: lt });
    for (let dy = -4; dy <= h + 4; dy++) for (let dx = -4; dx <= w + 4; dx++) if (L.inb(hx + dx, hy + dy)) townMap[(hy + dy) * W + hx + dx] = idx + 1;
  }
  const c = nearestTile(L, cx, cy, 8, (x, y) => !TP[L.get(x, y)].solid && !TP[L.get(x, y)].water) || [cx, cy];
  return { x: c[0], y: c[1] - 1, r: 9, ps: 0, name, idx, houses, seen: false, unease: 0 };
}
function buildCity(L, h, R, townMap, idx, names) {
  const W = L.w, cx = h.cx, cy = h.cy;
  let name; do { name = townName(R); } while (names.has(name) && names.size < 190); names.add(name);
  const inside = (x, y) => {
    if (!L.inb(x, y) || L.hexOf[y * W + x] !== h.id) return false;
    for (let k = 0; k < 4; k++) { const nx = x + DX4[k], ny = y + DY4[k]; if (!L.inb(nx, ny) || L.hexOf[ny * W + nx] !== h.id) return false; }
    return true;
  };
  const mod = (a, m) => ((a % m) + m) % m;
  for (let y = cy - HEX_S; y <= cy + HEX_S; y++) for (let x = cx - HEX_S; x <= cx + HEX_S; x++) {
    if (!inside(x, y)) continue;
    townMap[y * W + x] = idx + 1;
    const t = L.get(x, y), wet = TP[t].water;
    const sx = mod(x - cx, 6) === 0, sy = mod(y - cy, 6) === 0;
    if (sx || sy) L.set(x, y, wet ? (sy ? T.BRIDGE_H : T.BRIDGE_V) : T.COBBLE);
    else if (!wet) L.set(x, y, T.GRASS);
  }
  const houses = [], SP = 6;
  const okTile = (x, y) => inside(x, y) && !TP[L.get(x, y)].water;
  for (let by = cy - SP * 3; by <= cy + SP * 2; by += SP) for (let bx = cx - SP * 3; bx <= cx + SP * 2; bx += SP) {
    const x0 = bx + 1, y0 = by + 1;
    if (bx === cx && by === cy) { // central square
      for (let y = y0; y < y0 + 5; y++) for (let x = x0; x < x0 + 5; x++) if (okTile(x, y)) L.set(x, y, T.COBBLE);
      if (okTile(x0 + 2, y0 + 2)) L.set(x0 + 2, y0 + 2, T.WELL);
      for (const [lx, ly] of [[x0, y0], [x0 + 4, y0], [x0, y0 + 4], [x0 + 4, y0 + 4]]) if (okTile(lx, ly)) { L.set(lx, ly, T.LAMP); L.lights.push({ x: lx * TS + 8, y: ly * TS + 5, r: 70, col: [255, 196, 120], flick: 1 }); }
      continue;
    }
    let built = false;
    for (const [w, hh] of [[rint(R, 4, 5), rint(R, 3, 4)], [4, 3], [3, 3]]) {
      for (const ox of [0, 1, 2].sort(() => R() - 0.5)) {
        if (built || ox + w > 5) continue;
        const hx = x0 + ox, hy = y0, dxr = hx + 1 + Math.floor(R() * (w - 2));
        let ok = true;
        for (let y = hy; y < hy + hh && ok; y++) for (let x = hx; x < hx + w; x++) if (!okTile(x, y)) { ok = false; break; }
        for (let y = hy + hh; y <= y0 + 5 && ok; y++) if (!okTile(dxr, y)) ok = false;
        if (!ok) continue;
        const col = Math.floor(R() * 4);
        for (let y = hy; y < hy + hh; y++) for (let x = hx; x < hx + w; x++) { const roof = y < hy + hh - 1; L.set(x, y, roof ? T.ROOF : T.CWALL); if (roof) L.v[y * W + x] = col; }
        L.set(dxr, hy + hh - 1, T.CDOOR);
        for (let y = hy + hh; y < y0 + 5; y++) L.set(dxr, y, T.COBBLE);
        const lt = { x: dxr * TS + 8, y: (hy + hh) * TS + 2, r: 34, col: [255, 180, 100], flick: 0.5 }; L.lights.push(lt);
        houses.push({ x: hx, y: hy, w, h: hh, door: [dxr, hy + hh], city: true, light: lt }); built = true;
      }
      if (built) break;
    }
    if (!built) for (let k = 0; k < 3; k++) { const tx = x0 + rint(R, 0, 4), ty = y0 + rint(R, 0, 4); if (okTile(tx, ty) && L.get(tx, ty) === T.GRASS) L.set(tx, ty, R() < 0.5 ? T.TREE : T.FLOWERS); }
    if (okTile(x0 + 4, y0 + 4) && L.get(x0 + 4, y0 + 4) === T.GRASS && R() < 0.5) { L.set(x0 + 4, y0 + 4, T.LAMP); L.lights.push({ x: (x0 + 4) * TS + 8, y: (y0 + 4) * TS + 5, r: 60, col: [255, 196, 120], flick: 1 }); }
  }
  return { x: cx, y: cy, r: 14, ps: 0, name, idx, houses, seen: false, unease: 0, plaza: [cx + 3, cy + 5] };
}
function addQuarantine(L, s, R) {
  // barricades where roads leave the settlement, warning signs, and the agents who held the line
  s.corpses = [];
  const rr = s.r + 2, seen = new Set();
  for (let a = 0; a < 64; a++) {
    const ang = a / 64 * TAU, x = Math.round(s.x + Math.cos(ang) * rr), y = Math.round(s.y + Math.sin(ang) * rr), key = x + ',' + y;
    if (seen.has(key) || L.get(x, y) !== T.ROAD) continue; seen.add(key);
    const horiz = L.get(x - 1, y) === T.ROAD || L.get(x + 1, y) === T.ROAD;
    for (const o of [-2, -1, 1, 2]) {
      const bx = horiz ? x : x + o, by = horiz ? y + o : y;
      if (isGround(L.get(bx, by)) || L.get(bx, by) === T.TREE) L.set(bx, by, Math.abs(o) === 2 && R() < 0.5 ? T.SIGN : T.BARRICADE);
    }
    if (s.corpses.length < 3 && R() < 0.8) s.corpses.push({ x: x * TS + 8 + (R() - 0.5) * 10, y: y * TS + 8 + (R() < 0.5 ? -20 : 20) });
  }
  for (let k = 0; k < 2; k++) {
    const p = nearestTile(L, s.x + rint(R, -5, 5), s.y + rint(R, -5, 5), 6, (x, y) => !TP[L.get(x, y)].solid && !TP[L.get(x, y)].water);
    if (p) s.corpses.push({ x: p[0] * TS + 8, y: p[1] * TS + 8 });
  }
}

// fog level per hex: quarantined towns are thick, the hex holding a set of stairs is thinner
export function computeFog(L) {
  const W = L.w; if (!L.fog) L.fog = new Uint8Array(L.w * L.h); else L.fog.fill(0);
  const dh = new Set((L.dungeons || []).map(d => d.hex));
  for (const h of L.hexes) {
    h.fog = h.fogTown ? 1 : dh.has(h.id) ? 0.45 : 0;
    if (!h.fog) continue; const rad = Math.ceil(HEX_S * 1.6);
    for (let y = h.cy - rad; y <= h.cy + rad; y++) for (let x = h.cx - rad; x <= h.cx + rad; x++) {
      const d = dist(x, y, h.x, h.y);
      const v = h.fog * (1 - smooth(HEX_S * 0.7, HEX_S * 1.45, d)) * 255, i = L.idx(x, y);
      if (v > L.fog[i]) L.fog[i] = v;
    }
  }
}
function buildRegions(L, R, seed, el) {
  const W = L.w, H = L.h, N = W * H;
  const grid = makeHexGrid(L), HX = grid.hexes; L.hexOf = grid.hexOf; L.hexes = HX; L.hexGrid = grid;
  for (let i = 0; i < N; i++) {
    const id = grid.hexOf[i]; if (id < 0) continue; const h = HX[id], t = L.t[i];
    h.n++; if (!TP[t].water) h.land++; if (t === T.MOUNTAIN || t === T.SNOW) h.mount++;
  }
  for (const h of HX) h.type = (h.n > 0 && h.land / h.n >= 0.5) ? 'wild' : 'sea';
  const landH = HX.filter(h => h.type === 'wild');
  const elig = h => h && h.type !== 'sea' && !h.seam && h.land / h.n >= 0.75 && h.mount / h.n <= 0.35 && !TP[L.get(h.cx, h.cy)].water;
  // ---- cities: 5% of land, each fully ringed by towns ----
  const nCity = Math.max(1, Math.round(landH.length * 0.03));
  const cc = landH.filter(h => elig(h) && h.nb.every(n => HX[n].type === 'sea' || elig(HX[n])))
    .map(h => ({ h, s: R() * 2 - dist(h.x, h.y, W / 2, H / 2) / 160 })).sort((a, b) => b.s - a.s).map(o => o.h);
  const cities = [];
  const place = list => { for (const minD of [3, 2]) for (const h of list) {
    if (cities.length >= nCity) break;
    if (h.type !== 'wild' || cities.some(c => hexDist(c, h) < minD)) continue;
    if (h.nb.some(n => HX[n].type === 'city')) continue;
    h.type = 'city'; cities.push(h);
    for (const n of h.nb) if (HX[n].type === 'wild') { HX[n].type = 'town'; HX[n].ring = true; }
  } };
  place(cc);
  // rugged worlds run short of perfect city spots: let the ring towns sit on rougher (but not seam) land
  if (cities.length < nCity) {
    const okRing = n => n && (n.type === 'sea' || (!n.seam && n.type !== 'sea' && n.land / n.n >= 0.6 && n.mount / n.n <= 0.5));
    place(landH.filter(h => elig(h) && !cc.includes(h) && h.nb.every(n => okRing(HX[n]))).map(h => ({ h, s: R() })).sort((a, b) => b.s - a.s).map(o => o.h));
  }
  // ---- extra towns until towns make up ~25% of the land ----
  const target = Math.round(landH.length * 0.25);
  let nTown = HX.filter(h => h.type === 'town').length;
  const pool = landH.filter(h => h.type === 'wild' && elig(h));
  while (nTown < target && pool.length) {
    let bi = -1, bs = -1e9;
    for (let k = 0; k < pool.length; k++) {
      const h = pool[k]; if (h.type !== 'wild') continue;
      const s = R() * 2 + h.nb.filter(n => HX[n].type === 'town').length * 0.6;
      if (s > bs) { bs = s; bi = k; }
    }
    if (bi < 0) break;
    const h = pool.splice(bi, 1)[0]; h.type = 'town'; nTown++;
  }
  for (const h of HX) if (h.type === 'town') h.style = R() < (h.ring ? 0.6 : 0.45) ? 'village' : 'hamlet';
  // ---- build settlements ----
  const towns = [], townMap = new Uint8Array(N), names = new Set();
  for (const h of HX) {
    if (h.type !== 'city' && h.type !== 'town') continue;
    const idx = towns.length; let s;
    if (h.type === 'city') { s = buildCity(L, h, R, townMap, idx, names); s.kind = 'city'; }
    else {
      const c = nearestTile(L, h.cx, h.cy, 6, (x, y) => isGround(L.get(x, y)) || L.get(x, y) === T.TREE) || [h.cx, h.cy];
      if (h.style === 'village') { s = buildTown(L, c[0], c[1], R, townMap, idx, names, 6 + Math.floor(R() * 3)); s.kind = 'village'; }
      else { s = buildHamlet(L, c[0], c[1], R, townMap, idx, names, h.id); s.kind = 'hamlet'; }
    }
    s.hex = h.id; h.settle = idx; towns.push(s);
  }
  // ---- roads: spanning tree over every settlement plus a few loops ----
  const nT = towns.length, inT = new Array(nT).fill(false), edges = [], bestD = new Float64Array(nT).fill(1e18), from = new Int32Array(nT).fill(-1);
  const node = t => t.kind === 'city' ? [t.x, t.y] : t.kind === 'village' ? [t.x, t.y + 1] : [t.x, t.y + 1];
  if (nT) {
    inT[0] = true; for (let b = 1; b < nT; b++) { bestD[b] = wdistT(L, towns[0], towns[b]); from[b] = 0; }
    for (let k = 1; k < nT; k++) {
      let b = -1; for (let j = 0; j < nT; j++) if (!inT[j] && (b < 0 || bestD[j] < bestD[b])) b = j;
      inT[b] = true; edges.push([from[b], b]);
      for (let j = 0; j < nT; j++) if (!inT[j]) { const d = wdistT(L, towns[b], towns[j]); if (d < bestD[j]) { bestD[j] = d; from[j] = b; } }
    }
    for (let a = 0; a < nT; a++) {
      if (towns[a].kind === 'hamlet' || R() > 0.35) continue;
      const ds = towns.map((t, b) => [wdistT(L, t, towns[a]), b]).filter(x => x[1] !== a && towns[x[1]].kind !== 'hamlet').sort((p, q) => p[0] - q[0]);
      if (ds.length > 1) { const b = ds[1][1]; if (!edges.some(e => (e[0] === a && e[1] === b) || (e[0] === b && e[1] === a))) edges.push([a, b]); }
    }
  }
  for (const [a, b] of edges) {
    const [ax, ay] = node(towns[a]), [bx, by] = node(towns[b]);
    const path = astar(L, ax, ay, bx, by, roadCost); if (path) layRoad(L, path);
  }
  // ---- spawn in a village near the middle ----
  const vill = towns.filter(t => t.kind === 'village');
  const sp = (vill.length ? vill : towns).slice().sort((a, b) => dist(a.x, a.y, W / 2, H / 2) - dist(b.x, b.y, W / 2, H / 2))[0];
  const spHex = HX[sp.hex];
  const reach = new Uint8Array(N);
  { const st = nearestTile(L, sp.x, sp.y + 1, 4, (x, y) => !TP[L.get(x, y)].solid) || [sp.x, sp.y + 1]; const qq = [st[1] * W + st[0]]; reach[qq[0]] = 1;
    for (let qi = 0; qi < qq.length; qi++) { const c = qq[qi], cx = c % W, cy = (c / W) | 0;
      for (let k = 0; k < 4; k++) { const n = L.idx(cx + DX4[k], cy + DY4[k]); if (reach[n] || TP[L.t[n]].solid) continue; reach[n] = 1; qq.push(n); } } }
  // ---- dungeons: only in wilderness hexes where 4+ of the 6 neighbours are wilderness ----
  const wildNb = h => h.nb.filter(n => HX[n].type === 'wild').length;
  const townNb = h => h.nb.filter(n => HX[n].type === 'town').length;
  const dc = [];
  for (const h of HX) {
    if (h.type !== 'wild' || h.seam || wildNb(h) < 4 || h.land / h.n < 0.6 || hexDist(h, spHex) < 2) continue;
    const e = nearestTile(L, h.cx, h.cy, 10, (x, y) => reach[y * W + x] && L.hexOf[y * W + x] === h.id && (L.t[y * W + x] === T.GRASS || L.t[y * W + x] === T.FOREST || L.t[y * W + x] === T.HILL || L.t[y * W + x] === T.FLOWERS));
    if (e) dc.push({ h, e, s: R() * 2 + (townNb(h) ? 1.6 : 0) });
  }
  dc.sort((a, b) => b.s - a.s);
  const dung = [];
  const first = dc.filter(d => hexDist(d.h, spHex) <= 3).sort((a, b) => hexDist(a.h, spHex) - hexDist(b.h, spHex))[0];
  if (first) dung.push(first);
  for (const d of dc) { if (dung.length >= 6) break; if (dung.every(o => hexDist(o.h, d.h) >= 4)) dung.push(d); }
  L.dungeons = dung.map((d, id) => { const r = placeDungeon(L, d.e[0], d.e[1], seed + id * 7); d.h.dungeon = true; return { x: d.e[0], y: d.e[1], id, seen: false, hex: d.h.id, hex0: d.h.id, under: r.under, light: r.light, home: [d.e[0], d.e[1]] }; });
  // ---- quarantine: towns around a dungeon lose their people to the fog ----
  for (const d of dung) for (const n of d.h.nb) {
    const nh = HX[n]; if (nh.type !== 'town') continue;
    nh.fogTown = true; const s = towns[nh.settle]; if (!s.fog) { s.fog = true; addQuarantine(L, s, R); }
  }
  computeFog(L);
  for (const t of towns) {
    const dmin = Math.min(99, ...dung.map(d => hexDist(d.h, HX[t.hex])));
    t.unease = t.fog ? 1 : 1 - clamp((dmin - 1) / 4, 0, 1);
  }
  L.noEnemy = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (townMap[i] && !towns[townMap[i] - 1].fog) L.noEnemy[i] = 1;
  L.towns = towns; L.townMap = townMap;
  L.spawnTown = sp.idx;
  L.spawn = { x: sp.x * TS + 8, y: (sp.y + 1) * TS + 8 };
  const st = { land: landH.length, wild: HX.filter(h => h.type === 'wild').length, town: HX.filter(h => h.type === 'town').length, city: cities.length, village: towns.filter(t => t.kind === 'village').length, hamlet: towns.filter(t => t.kind === 'hamlet').length, fogTowns: towns.filter(t => t.fog).length, dungeons: dung.length };
  L.hexStats = st;
  return L;
}
