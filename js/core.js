// ================= core utilities =================
export const TS = 16, TAU = Math.PI * 2;
export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
export function hash2(x, y, s) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 982451653)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export const rint = (r, a, b) => a + Math.floor(r() * (b - a + 1));
export const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
export const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

// ================= min-heap (growable) =================
export class MinHeap {
  constructor(cap) { this.k = new Float64Array(cap); this.v = new Int32Array(cap); this.n = 0; }
  grow() {
    const k = new Float64Array(this.k.length * 2); k.set(this.k); this.k = k;
    const v = new Int32Array(this.v.length * 2); v.set(this.v); this.v = v;
  }
  push(key, val) {
    if (this.n >= this.k.length) this.grow();
    const k = this.k, v = this.v; let i = this.n++;
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v; const top = v[0]; const n = --this.n;
    if (n > 0) {
      const key = k[n], val = v[n]; let i = 0;
      for (;;) {
        const l = 2 * i + 1; if (l >= n) break;
        const r = l + 1; const m = (r < n && k[r] < k[l]) ? r : l;
        if (k[m] >= key) break;
        k[i] = k[m]; v[i] = v[m]; i = m;
      }
      k[i] = key; v[i] = val;
    }
    return top;
  }
}

// ================= tiles =================
export const T = {
  DEEP: 0, SHALLOW: 1, RIVER: 2, SAND: 3, GRASS: 4, FLOWERS: 5, FOREST: 6, TREE: 7, HILL: 8, MOUNTAIN: 9,
  SNOW: 10, ROAD: 11, BRIDGE_H: 12, BRIDGE_V: 13, COBBLE: 14, ROOF: 15, WALL: 16, DOOR: 17, WELL: 18, LAMP: 19,
  DUNGEON: 20, SWAMP: 21, VEINS: 22, PINE: 23, CWALL: 24, CDOOR: 25, BARRICADE: 26, SIGN: 27, DESERT: 28, MOOR: 29,
  MFLOOR: 30, MWALL: 31, MEYE: 32, STAIRS_UP: 33, STAIRS_DOWN: 34, MBONES: 35, MROOT: 36,
  FFLOOR: 40, FWALL: 41, FBILE: 42, FTEETH: 43, FVEIN: 44, FMOUTH: 45, FEYE: 46,
  IFLOOR: 48, IWALL: 49, IRUG: 50, ITABLE: 51, IBED: 52, ISHELF: 53, IFIRE: 54, IMAT: 55,
};
export const NT = 56;
export const TP = [];
for (let i = 0; i < NT; i++) TP.push({ solid: false, speed: 1, anim: 0, hurt: 0, water: false, ground: false, wall: false });
function tp(id, o) { Object.assign(TP[id], o); }
tp(T.DEEP, { solid: true, anim: 1, water: true });
tp(T.SHALLOW, { speed: 0.5, anim: 1, water: true });
tp(T.RIVER, { speed: 0.45, anim: 1, water: true });
tp(T.SAND, { speed: 0.9, ground: true });
tp(T.GRASS, { ground: true });
tp(T.FLOWERS, { ground: true });
tp(T.FOREST, { speed: 0.85, ground: true });
tp(T.TREE, { solid: true });
tp(T.PINE, { solid: true });
tp(T.HILL, { speed: 0.8, ground: true });
tp(T.MOUNTAIN, { solid: true, wall: true });
tp(T.SNOW, { solid: true, wall: true });
tp(T.ROAD, { speed: 1.3 });
tp(T.BRIDGE_H, { speed: 1.3 });
tp(T.BRIDGE_V, { speed: 1.3 });
tp(T.COBBLE, { speed: 1.2 });
tp(T.ROOF, { solid: true, wall: true });
tp(T.WALL, { solid: true, wall: true });
tp(T.DOOR, { solid: true, wall: true });
tp(T.WELL, { solid: true });
tp(T.LAMP, { solid: true });
tp(T.DUNGEON, {});
tp(T.CWALL, { solid: true, wall: true });
tp(T.CDOOR, { solid: true, wall: true });
tp(T.BARRICADE, { solid: true });
tp(T.DESERT, { speed: 0.82, ground: true });
tp(T.MOOR, { ground: true });
tp(T.SIGN, { solid: true });
tp(T.SWAMP, { speed: 0.6, anim: 1 });
tp(T.VEINS, { anim: 2, ground: true });
tp(T.MFLOOR, {});
tp(T.MWALL, { solid: true, wall: true, anim: 2 });
tp(T.MEYE, { solid: true, wall: true, anim: 2 });
tp(T.MROOT, { anim: 2 });
tp(T.STAIRS_UP, {});
tp(T.STAIRS_DOWN, {});
tp(T.MBONES, {});
tp(T.FFLOOR, { anim: 2 });
tp(T.FWALL, { solid: true, wall: true, anim: 2 });
tp(T.FTEETH, { solid: true, wall: true, anim: 2 });
tp(T.FEYE, { solid: true, wall: true, anim: 2 });
tp(T.FVEIN, { anim: 2 });
tp(T.FBILE, { speed: 0.6, anim: 1, hurt: 1 });
tp(T.FMOUTH, {});
tp(T.IWALL, { solid: true, wall: true });
tp(T.ITABLE, { solid: true });
tp(T.IBED, { solid: true });
tp(T.ISHELF, { solid: true, wall: true });
tp(T.IFIRE, { solid: true, wall: true });

// ================= level container =================
export class Level {
  constructor(kind, w, h) {
    this.kind = kind; this.w = w; this.h = h;
    const n = w * h;
    this.t = new Uint8Array(n); this.v = new Uint8Array(n); this.seen = new Uint8Array(n);
    this.ents = []; this.lights = []; this.alive = 0; this.edge = T.DEEP; this.name = '';
    this.atlas = null; this.mapCanvas = null; this.mapImg = null; this.mapDirty = true;
    this.noEnemy = null; // Uint8Array, 1 where enemies may not walk
  }
  inb(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  // the surface wraps: walk off one edge and you come back on the other
  wx(x) { return ((x % this.w) + this.w) % this.w; }
  wy(y) { return ((y % this.h) + this.h) % this.h; }
  idx(x, y) { return this.wy(y) * this.w + this.wx(x); }
  get(x, y) { if (this.wrap) return this.t[this.idx(x, y)]; return (x >= 0 && y >= 0 && x < this.w && y < this.h) ? this.t[y * this.w + x] : this.edge; }
  set(x, y, id) { if (this.wrap) { this.t[this.idx(x, y)] = id; return; } if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.t[y * this.w + x] = id; }
  solid(x, y) { return TP[this.get(x, y)].solid; }
  blockedFor(x, y, enemy) {
    if (this.wrap) { x = this.wx(x); y = this.wy(y); }
    if (!this.inb(x, y)) return true;
    const id = this.t[y * this.w + x];
    if (TP[id].solid) return true;
    if (enemy) {
      if (TP[id].water || TP[id].hurt) return true;
      if (this.noEnemy && this.noEnemy[y * this.w + x]) return true;
    }
    return false;
  }
  randomizeVariants(seed) {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) this.v[y * this.w + x] = (hash2(x, y, seed) * 4) | 0;
  }
}
