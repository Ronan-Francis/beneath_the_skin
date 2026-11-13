import { clamp, hash2, lerp, mulberry32, NT, T, TAU, TS } from './core.js';
import { vnoise } from './noise.js';

// ================= procedural pixel art =================
export const VAR = 4, FR = 4, ACOLS = VAR * FR;
export const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const shd = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
export const rgb = (c, a) => a === undefined ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

class Pix {
  constructor() { this.d = new Float32Array(TS * TS * 3); }
  set(x, y, c, a) {
    x |= 0; y |= 0; if (x < 0 || y < 0 || x >= TS || y >= TS) return;
    const i = (y * TS + x) * 3, d = this.d;
    if (a === undefined || a >= 1) { d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; }
    else { d[i] += (c[0] - d[i]) * a; d[i + 1] += (c[1] - d[i + 1]) * a; d[i + 2] += (c[2] - d[i + 2]) * a; }
  }
  get(x, y) { x = clamp(x | 0, 0, 15); y = clamp(y | 0, 0, 15); const i = (y * TS + x) * 3; return [this.d[i], this.d[i + 1], this.d[i + 2]]; }
  mul(x, y, k) { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= TS || y >= TS) return; const i = (y * TS + x) * 3; this.d[i] *= k; this.d[i + 1] *= k; this.d[i + 2] *= k; }
  each(fn) { for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) fn(x, y); }
}

const C = {
  grass: [86, 150, 64], grassD: [70, 128, 52], grassL: [112, 172, 80],
  forest: [52, 106, 52], forestD: [40, 86, 42], forestL: [70, 128, 62],
  sand: [216, 198, 142], shallow: [72, 134, 194], river: [64, 124, 190], deep: [34, 66, 132],
  hill: [126, 146, 78], rock: [130, 124, 118], snow: [234, 238, 246], road: [158, 126, 86],
  wood: [146, 100, 58], cobble: [142, 138, 132], plaster: [224, 210, 174], timber: [96, 66, 44],
  swamp: [80, 96, 62], stone: [106, 102, 116], flesh: [166, 62, 70], meat: [168, 56, 66],
};

function walk(P, r, x, y, n, col, dirBias) {
  let dx = Math.cos(dirBias), dy = Math.sin(dirBias);
  for (let i = 0; i < n; i++) {
    P.set(x, y, col);
    const a = Math.atan2(dy, dx) + (r() - 0.5) * 1.6; dx = Math.cos(a); dy = Math.sin(a);
    x += Math.round(dx); y += Math.round(dy);
  }
}
function grassFill(P, c, base, dark, light) {
  P.each((x, y) => { const h = c.r(); P.set(x, y, h < 0.62 ? base : h < 0.86 ? dark : light); });
  const n = 3 + Math.floor(c.r() * 4);
  for (let k = 0; k < n; k++) { const x = 1 + Math.floor(c.r() * 14), y = 2 + Math.floor(c.r() * 13); P.set(x, y, light); P.set(x, y - 1, shd(light, 1.08)); }
}
function cobbleFill(P, c, base, mort) {
  P.each((x, y) => {
    const row = y >> 2, off = (row & 1) * 2, col = (x + off) >> 2;
    const m = (y & 3) === 3 || ((x + off) & 3) === 3;
    const k = 0.85 + hash2(col, row, c.v * 13 + 5) * 0.3;
    P.set(x, y, m ? mort : shd(base, k * ((y & 3) === 0 ? 1.08 : 1)));
  });
}
function boulder(P, c, rock, gravel, snowy) {
  P.each((x, y) => P.set(x, y, shd(gravel, 0.85 + c.r() * 0.3)));
  const cx = 8 + (c.r() - 0.5) * 2, cy = 8 + (c.r() - 0.5) * 2, rx = 6.9 + c.r() * 0.9, ry = 6.3 + c.r() * 1.1;
  P.each((x, y) => {
    const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry, d = dx * dx + dy * dy;
    if (d < 1) {
      const nz = Math.sqrt(1 - d), n = vnoise(x, y, 3, c.seed);
      let l = 0.55 + 0.5 * (nz * 0.5 - dx * 0.35 - dy * 0.45) + (n - 0.5) * 0.3;
      let col = rock;
      if (snowy && dy < -0.15 + (n - 0.5) * 0.6) { col = C.snow; l = 0.8 + l * 0.25; }
      col = shd(col, clamp(l, 0.45, 1.2));
      if (d > 0.8) col = shd(col, 0.72);
      P.set(x, y, col);
    }
  });
  if (c.v < 2 && !snowy) walk(P, c.r, Math.round(cx), Math.round(cy - 3), 5, shd(rock, 0.55), Math.PI / 2);
}
function waterFill(P, c, base, hi, dashes) {
  P.each((x, y) => P.set(x, y, shd(base, 0.96 + vnoise(x, y, 4, c.seed) * 0.08)));
  for (let k = 0; k < dashes; k++) {
    const x0 = Math.floor(c.r() * 16), y0 = Math.floor(c.r() * 16), len = 2 + Math.floor(c.r() * 3);
    for (let i = 0; i < len; i++) P.set((x0 + i + c.f * 2) & 15, y0, hi, 0.8);
  }
}
function veinsOn(P, c, n, col, bright) {
  const k = 1 + bright * Math.sin(c.f / FR * TAU);
  for (let i = 0; i < n; i++) {
    const side = Math.floor(c.r() * 4);
    let x = side === 0 ? 0 : side === 1 ? 15 : Math.floor(c.r() * 16), y = side === 2 ? 0 : side === 3 ? 15 : Math.floor(c.r() * 16);
    const ang = Math.atan2(8 - y, 8 - x);
    walk(P, c.r, x, y, 6 + Math.floor(c.r() * 10), shd(col, k), ang);
  }
}
function fleshFill(P, c, base, pulse) {
  const k = 1 + pulse * Math.sin(c.f / FR * TAU);
  P.each((x, y) => {
    const n1 = vnoise(x + c.v * 16, y, 4, c.seed), n2 = vnoise(x, y + c.v * 16, 2, c.seed + 1);
    let col = shd(base, (0.7 + 0.5 * n1 + 0.15 * n2) * k);
    if (n1 < 0.28) col = mixc(col, [86, 18, 32], 0.7);
    if (n2 > 0.8 && n1 > 0.5) col = mixc(col, [244, 160, 160], 0.75);
    P.set(x, y, col);
  });
}
function eyeSocket(P, rimCol, big) {
  const rx = big ? 6 : 5, ry = big ? 4 : 3;
  P.each((x, y) => {
    const dx = (x + 0.5 - 8) / rx, dy = (y + 0.5 - 8) / ry, d = dx * dx + dy * dy;
    if (d < 1) P.set(x, y, [34, 8, 12]);
    else if (d < 1.6) P.set(x, y, shd(rimCol, d < 1.25 ? 0.7 : 1.1));
  });
}
function mazeColors(a) {
  return {
    wall: mixc([114, 110, 126], [182, 74, 82], a * 0.92),
    floor: mixc([46, 43, 52], [66, 20, 28], a * 0.9),
    vein: mixc([90, 40, 60], [196, 40, 62], a),
  };
}

// painters: id -> fn(P, c) where c = {v, f, a, r, seed}
const PAINT = {};
PAINT[T.GRASS] = (P, c) => grassFill(P, c, C.grass, C.grassD, C.grassL);
PAINT[T.FLOWERS] = (P, c) => {
  grassFill(P, c, C.grass, C.grassD, C.grassL);
  const cols = [[236, 222, 96], [224, 92, 112], [244, 244, 244], [156, 124, 232]];
  for (let k = 0; k < 4; k++) { const x = 1 + Math.floor(c.r() * 14), y = 1 + Math.floor(c.r() * 14); const col = cols[(c.v + k) & 3]; P.set(x, y, col); P.set(x + 1, y, shd(col, 0.8)); P.set(x, y + 1, C.grassD); }
};
PAINT[T.FOREST] = (P, c) => {
  grassFill(P, c, C.forest, C.forestD, C.forestL);
  for (let k = 0; k < 5; k++) P.set(Math.floor(c.r() * 16), Math.floor(c.r() * 16), [108, 84, 52]);
};
PAINT[T.TREE] = (P, c) => {
  grassFill(P, c, C.forest, C.forestD, C.forestL);
  P.each((x, y) => { const dx = (x + 0.5 - 8.5) / 6.5, dy = (y + 0.5 - 12.5) / 3; if (dx * dx + dy * dy < 1) P.mul(x, y, 0.62); });
  for (let y = 10; y <= 14; y++) { P.set(7, y, [104, 72, 46]); P.set(8, y, [84, 58, 38]); }
  const cx = 8 + (c.v & 1) * 0.5 - 0.25, cy = 6.4, rr = 6.2 + (c.v === 3 ? 0.6 : 0);
  P.each((x, y) => {
    const dx = (x + 0.5 - cx) / rr, dy = (y + 0.5 - cy) / (rr * 0.94), d = dx * dx + dy * dy;
    if (d < 1) {
      const n = vnoise(x, y, 2.5, c.seed);
      const l = clamp(0.5 + 0.55 * (-dx * 0.55 - dy * 0.7) + (n - 0.5) * 0.6, 0, 1);
      let col = l < 0.33 ? [30, 78, 40] : l < 0.7 ? [50, 116, 54] : [94, 160, 78];
      if (d > 0.82) col = shd(col, 0.78);
      P.set(x, y, col);
    }
  });
};
PAINT[T.PINE] = (P, c) => {
  P.each((x, y) => P.set(x, y, shd(C.hill, 0.85 + vnoise(x, y, 5, c.seed) * 0.25)));
  P.each((x, y) => { const dx = (x + 0.5 - 9) / 5.5, dy = (y + 0.5 - 13.5) / 2.2; if (dx * dx + dy * dy < 1) P.mul(x, y, 0.65); });
  for (let y = 12; y <= 14; y++) { P.set(7, y, [96, 66, 42]); P.set(8, y, [78, 52, 34]); }
  for (let y = 1; y <= 12; y++) {
    const hw = 0.8 + ((y - 1) % 4) * 1.1 + Math.floor((y - 1) / 4) * 0.9;
    for (let x = 0; x < 16; x++) {
      const dx = x + 0.5 - 8;
      if (Math.abs(dx) < hw) {
        let col = dx < -hw * 0.3 ? [66, 130, 90] : dx > hw * 0.4 ? [22, 58, 46] : [36, 88, 66];
        if ((y - 1) % 4 === 3) col = shd(col, 0.8);
        P.set(x, y, col);
      }
    }
  }
};
PAINT[T.SAND] = (P, c) => P.each((x, y) => { const h = c.r(); P.set(x, y, h < 0.12 ? [196, 176, 124] : h < 0.17 ? [234, 220, 172] : C.sand); });
PAINT[T.SHALLOW] = (P, c) => waterFill(P, c, C.shallow, [150, 198, 236], 3);
PAINT[T.RIVER] = (P, c) => waterFill(P, c, C.river, [140, 190, 236], 4);
PAINT[T.DEEP] = (P, c) => {
  waterFill(P, c, C.deep, [70, 110, 180], 2);
  for (let k = 0; k < 3; k++) { const x = Math.floor(c.r() * 16), y = Math.floor(c.r() * 16); if ((c.f + k) % 4 === 0) P.set(x, y, [130, 170, 230]); }
};
PAINT[T.SWAMP] = (P, c) => {
  P.each((x, y) => { const n = vnoise(x + c.v * 16, y, 4, c.seed); P.set(x, y, n > 0.55 ? shd([56, 74, 60], 0.95 + c.r() * 0.1) : shd(C.swamp, 0.9 + c.r() * 0.2)); });
  for (let k = 0; k < 3; k++) { const x = 1 + Math.floor(c.r() * 14), y = 4 + Math.floor(c.r() * 10); P.set(x, y, [104, 124, 62]); P.set(x, y - 1, [104, 124, 62]); P.set(x, y - 2, [156, 132, 82]); }
  P.set(Math.floor(c.r() * 16), Math.floor(c.r() * 16), [120, 140, 110], c.f === 0 ? 0.8 : 0);
};
PAINT[T.HILL] = (P, c) => {
  P.each((x, y) => P.set(x, y, shd(C.hill, 0.86 + vnoise(x + c.v * 16, y, 5, c.seed) * 0.28)));
  for (let k = 0; k < 3; k++) { const x = 1 + Math.floor(c.r() * 14), y = 2 + Math.floor(c.r() * 13); P.set(x, y, [150, 168, 96]); P.set(x, y - 1, [150, 168, 96]); }
  if (c.v === 0) { P.set(5, 10, [150, 144, 130]); P.set(6, 10, [120, 114, 104]); }
};
PAINT[T.MOUNTAIN] = (P, c) => boulder(P, c, C.rock, [86, 82, 80], false);
PAINT[T.SNOW] = (P, c) => boulder(P, c, [140, 142, 156], [110, 112, 124], true);
PAINT[T.ROAD] = (P, c) => {
  P.each((x, y) => P.set(x, y, shd(C.road, 0.9 + c.r() * 0.16)));
  for (let k = 0; k < 4; k++) { const x = Math.floor(c.r() * 16), y = Math.floor(c.r() * 16); P.set(x, y, c.r() < 0.5 ? [124, 100, 72] : [184, 154, 112]); }
};
PAINT[T.BRIDGE_H] = (P, c) => P.each((x, y) => {
  const pl = Math.floor(x / 3); let col = shd(C.wood, 0.88 + hash2(pl, c.v, 7) * 0.22);
  if (x % 3 === 2) col = shd(C.wood, 0.6);
  if (y <= 1 || y >= 14) col = shd([112, 76, 46], (y === 0 || y === 15) ? 0.7 : 1);
  P.set(x, y, col);
});
PAINT[T.BRIDGE_V] = (P, c) => P.each((x, y) => {
  const pl = Math.floor(y / 3); let col = shd(C.wood, 0.88 + hash2(pl, c.v, 7) * 0.22);
  if (y % 3 === 2) col = shd(C.wood, 0.6);
  if (x <= 1 || x >= 14) col = shd([112, 76, 46], (x === 0 || x === 15) ? 0.7 : 1);
  P.set(x, y, col);
});
PAINT[T.COBBLE] = (P, c) => cobbleFill(P, c, C.cobble, [94, 90, 88]);
PAINT[T.ROOF] = (P, c) => {
  const cols = [[172, 68, 54], [126, 86, 60], [86, 98, 134], [94, 124, 72]];
  const base = cols[c.v & 3];
  P.each((x, y) => {
    let k = 0.94 + c.r() * 0.08;
    if (y % 3 === 2) k *= 0.68; else if (((x + (Math.floor(y / 3) & 1) * 2) & 3) === 3) k *= 0.84; else if (y % 3 === 0) k *= 1.08;
    P.set(x, y, shd(base, k));
  });
};
function wallFill(P, c, windowed) {
  P.each((x, y) => P.set(x, y, shd(C.plaster, 0.94 + c.r() * 0.08)));
  P.each((x, y) => { if (y <= 1) P.set(x, y, shd(C.plaster, 0.55)); if (x === 0 || x === 15 || y === 15) P.set(x, y, C.timber); });
  if (windowed) {
    for (let y = 5; y <= 10; y++) for (let x = 5; x <= 10; x++) {
      const edge = x === 5 || x === 10 || y === 5 || y === 10, bar = x === 7 || y === 7;
      P.set(x, y, edge ? C.timber : bar ? shd(C.timber, 1.2) : (x + y < 14 ? [156, 186, 220] : [76, 96, 136]));
    }
  }
}
PAINT[T.WALL] = (P, c) => wallFill(P, c, c.v < 2);
PAINT[T.DOOR] = (P, c) => {
  wallFill(P, c, false);
  for (let y = 4; y <= 15; y++) for (let x = 5; x <= 10; x++) {
    if (y === 4 && (x === 5 || x === 10)) continue;
    P.set(x, y, (x === 5 || x === 10 || y === 4) ? [70, 44, 28] : x === 7 ? [92, 58, 36] : [118, 76, 46]);
  }
  P.set(9, 10, [236, 196, 84]);
};
PAINT[T.WELL] = (P, c) => {
  cobbleFill(P, c, C.cobble, [94, 90, 88]);
  P.each((x, y) => {
    const d = Math.hypot(x + 0.5 - 8, y + 0.5 - 8);
    if (d < 4) P.set(x, y, (x === 6 && y === 6) ? [120, 150, 200] : [28, 44, 76]);
    else if (d < 6.4) P.set(x, y, shd([164, 160, 152], 0.8 + 0.3 * ((8 - y) / 8)));
    else if (d < 7.2) P.set(x, y, [70, 66, 64]);
  });
};
PAINT[T.LAMP] = (P, c) => {
  cobbleFill(P, c, C.cobble, [94, 90, 88]);
  for (let y = 5; y <= 13; y++) { P.set(7, y, [64, 62, 72]); P.set(8, y, [44, 42, 50]); }
  for (let x = 6; x <= 9; x++) { P.set(x, 14, [44, 42, 50]); P.set(x, 1, [44, 42, 50]); P.set(x, 4, [44, 42, 50]); }
  for (let y = 2; y <= 3; y++) for (let x = 6; x <= 9; x++) P.set(x, y, (x === 7 || x === 8) ? [255, 250, 210] : [255, 214, 120]);
};
PAINT[T.DUNGEON] = (P, c) => {
  P.each((x, y) => P.set(x, y, shd([74, 62, 52], 0.85 + c.r() * 0.3)));
  P.each((x, y) => {
    const dx = x + 0.5 - 8, dy = y + 0.5 - 8, d = Math.hypot(dx, dy);
    if (d < 5.4) {
      const k = (y - 2) / 12, step = ((y - 2) >> 1) & 1;
      let col = mixc([84, 76, 72], [6, 2, 4], clamp(k * 1.2, 0, 1));
      if (step) col = shd(col, 0.82);
      if (d < 3.2 && y > 7) col = mixc(col, [120, 10, 24], 0.35 * (1 + Math.sin(c.f / FR * TAU)) / 2 + 0.15);
      P.set(x, y, col);
    } else if (d < 7.6) {
      const ang = Math.atan2(dy, dx), seg = Math.floor((ang + Math.PI) / TAU * 10);
      const mort = Math.abs(((ang + Math.PI) / TAU * 10) - seg - 0.5) > 0.42 || Math.abs(d - 6.5) > 0.95;
      P.set(x, y, mort ? [64, 60, 58] : shd([124, 118, 110], 0.8 + hash2(seg, 0, c.v) * 0.35));
    }
  });
};
PAINT[T.VEINS] = (P, c) => {
  grassFill(P, c, mixc(C.grass, [126, 104, 70], 0.35), mixc(C.grassD, [100, 80, 56], 0.35), mixc(C.grassL, [150, 130, 90], 0.3));
  veinsOn(P, c, 2 + (c.v & 1), [132, 26, 46], 0.3);
  if (c.v === 2) { P.set(10, 6, [206, 90, 100]); P.set(11, 6, [176, 60, 76]); }
};
PAINT[T.CWALL] = (P, c) => cwallFill(P, c, c.v < 3);
PAINT[T.CDOOR] = (P, c) => {
  cwallFill(P, c, false);
  for (let y = 4; y <= 15; y++) for (let x = 5; x <= 10; x++) {
    if (y === 4 && (x === 5 || x === 10)) continue;
    const edge = x === 5 || x === 10 || y === 4;
    P.set(x, y, edge ? [52, 34, 24] : ((x + y) % 4 === 0 && y % 3 === 0) ? [150, 140, 120] : [90, 56, 36]);
  }
  P.set(9, 10, [210, 200, 170]);
};
PAINT[T.BARRICADE] = (P, c) => {
  P.each((x, y) => P.set(x, y, shd([118, 102, 80], 0.88 + c.r() * 0.2)));
  const bag = (bx, by) => { for (let y = 0; y < 5; y++) for (let x = 0; x < 7; x++) {
    const dx = (x + 0.5 - 3.5) / 3.6, dy = (y + 0.5 - 2.5) / 2.6; const d = dx * dx + dy * dy; if (d >= 1) continue;
    P.set(bx + x, by + y, shd([200, 182, 134], d > 0.7 ? 0.68 : dy < -0.2 ? 1.08 : 0.92)); } };
  bag(-3, 9); bag(4, 9); bag(11, 9); bag(0, 5); bag(7, 5); bag(14, 5); bag(-3, 1); bag(4, 1); bag(11, 1);
};
PAINT[T.SIGN] = (P, c) => {
  P.each((x, y) => P.set(x, y, shd([118, 102, 80], 0.88 + c.r() * 0.2)));
  for (let y = 8; y <= 15; y++) { P.set(7, y, [96, 70, 46]); P.set(8, y, [72, 52, 34]); }
  for (let y = 1; y <= 8; y++) for (let x = 2; x <= 13; x++) {
    const edge = x === 2 || x === 13 || y === 1 || y === 8;
    P.set(x, y, edge ? (((x + y) >> 1) & 1 ? [24, 22, 20] : [236, 196, 40]) : [236, 196, 40]);
  }
  for (let y = 3; y <= 5; y++) { P.set(7, y, [24, 22, 20]); P.set(8, y, [24, 22, 20]); }
  P.set(7, 7, [24, 22, 20]); P.set(8, 7, [24, 22, 20]);
};
function cwallFill(P, c, windowed) {
  const base = [[172, 166, 156], [160, 150, 140], [180, 170, 150], [150, 152, 160]][c.v & 3];
  P.each((x, y) => {
    const row = Math.floor(y / 3), off = (row & 1) * 3, m = y % 3 === 2 || (x + off) % 6 === 5;
    P.set(x, y, m ? shd(base, 0.62) : shd(base, 0.9 + hash2((x + off) / 6 | 0, row, c.v * 5 + 1) * 0.2));
  });
  P.each((x, y) => { if (y <= 1) P.set(x, y, shd(base, 0.45)); });
  if (windowed) for (let y = 5; y <= 11; y++) for (let x = 5; x <= 10; x++) {
    const edge = x === 5 || x === 10 || y === 5 || y === 11, bar = x === 7 || y === 8;
    P.set(x, y, edge ? [64, 62, 68] : bar ? [80, 78, 84] : (x + y < 14 ? [150, 176, 206] : [70, 90, 124]));
  }
}
PAINT[T.DESERT] = (P, c) => {
  P.each((x, y) => { const rip = Math.sin((x * 0.5 + y * 1.3) + c.v * 2 + vnoise(x, y, 5, c.seed) * 3); P.set(x, y, shd([226, 186, 120], (rip > 0.75 ? 1.08 : rip < -0.8 ? 0.86 : 0.97) + (c.r() - 0.5) * 0.05)); });
  if (c.v === 3) { for (let y = 4; y <= 13; y++) { P.set(7, y, [70, 128, 64]); P.set(8, y, [52, 104, 50]); } for (let y = 6; y <= 9; y++) { P.set(4, y, [70, 128, 64]); P.set(11, y - 2, [70, 128, 64]); } P.set(5, 9, [70, 128, 64]); P.set(6, 9, [70, 128, 64]); P.set(9, 7, [70, 128, 64]); P.set(10, 7, [70, 128, 64]); P.each((x, y) => { const dx = (x + 0.5 - 8) / 4, dy = (y + 0.5 - 14.5) / 1.2; if (dx * dx + dy * dy < 1) P.mul(x, y, 0.8); }); }
  else if (c.v === 2) { for (const [x, y] of [[5, 9], [6, 8], [7, 9], [8, 7], [9, 8], [10, 9], [6, 10], [9, 10]]) P.set(x, y, [132, 104, 62]); }
  else if (c.v === 1) { P.set(4, 11, [150, 136, 120]); P.set(5, 11, [120, 108, 96]); P.set(11, 4, [150, 136, 120]); }
};
PAINT[T.MOOR] = (P, c) => {
  P.each((x, y) => { const h = c.r(); P.set(x, y, h < 0.5 ? [148, 158, 82] : h < 0.8 ? [126, 132, 66] : [168, 166, 96]); });
  for (let k = 0; k < 4; k++) { const x = 1 + Math.floor(c.r() * 14), y = 3 + Math.floor(c.r() * 12); for (let i = 0; i < 3; i++) { P.set(x - 1 + i, y - (i === 1 ? 2 : 1), [96, 112, 52]); } P.set(x, y, [84, 98, 46]); }
  if (c.v === 1) for (let k = 0; k < 5; k++) P.set(Math.floor(c.r() * 16), Math.floor(c.r() * 16), [150, 96, 150]);
};
// ---- house interiors ----
PAINT[T.IFLOOR] = (P, c) => {
  const base = [138, 98, 62];
  P.each((x, y) => { const row = y >> 2, off = (row * 5 + c.v * 3) & 15; let k = 0.9 + hash2((x + off) >> 3, row, c.v + 40) * 0.18 + (c.r() - 0.5) * 0.05;
    if ((y & 3) === 3) k = 0.62; else if (((x + off) & 7) === 0) k *= 0.8; P.set(x, y, shd(base, k)); });
  if (c.v === 3) for (let s = 0; s < 3; s++) { const cx = c.r() * 16, cy = c.r() * 16, rr = 1 + c.r() * 1.5; P.each((x, y) => { if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) < rr) P.set(x, y, [96, 22, 26], 0.6); }); }
};
PAINT[T.IWALL] = (P, c) => P.each((x, y) => {
  let col = y < 9 ? shd([196, 180, 150], 0.92 + c.r() * 0.08) : shd([104, 70, 44], (x & 3) === 0 ? 0.75 : 0.95);
  if (y === 9) col = [80, 54, 34]; if (y === 0) col = [60, 46, 38];
  P.set(x, y, col);
});
PAINT[T.IRUG] = (P, c) => { PAINT[T.IFLOOR](P, c); P.each((x, y) => { const e = x === 0 || x === 15 || y === 0 || y === 15, d = (x + y + c.v) % 6 === 0; P.set(x, y, e ? [196, 160, 80] : d ? [210, 180, 110] : [142, 40, 46]); }); };
PAINT[T.ITABLE] = (P, c) => { PAINT[T.IFLOOR](P, c); for (let y = 2; y <= 12; y++) for (let x = 1; x <= 14; x++) P.set(x, y, y === 12 ? [70, 46, 28] : y === 2 ? [176, 128, 80] : [150, 104, 62]); P.set(2, 13, [70, 46, 28]); P.set(13, 13, [70, 46, 28]); if (c.v < 2) { P.set(6, 6, [230, 230, 220]); P.set(7, 6, [230, 230, 220]); P.set(6, 7, [200, 200, 190]); P.set(10, 8, [120, 40, 40]); } };
PAINT[T.IBED] = (P, c) => { PAINT[T.IFLOOR](P, c); for (let y = 0; y < 16; y++) for (let x = 2; x <= 13; x++) { const top = c.v === 0; let col = top ? (y < 2 ? [92, 60, 36] : y < 8 ? [236, 232, 220] : [74, 96, 150]) : (y > 13 ? [92, 60, 36] : [74, 96, 150]); if (x === 2 || x === 13) col = [92, 60, 36]; if (!top && (x + y) % 5 === 0 && y < 14) col = [96, 120, 176]; P.set(x, y, col); } };
PAINT[T.ISHELF] = (P, c) => P.each((x, y) => {
  let col = [112, 76, 46]; if (y < 2) col = [60, 46, 38]; else if (x === 0 || x === 15 || y === 15) col = [76, 50, 30]; else if (x === 7 || x === 8) col = [84, 56, 34];
  else if (y === 8) col = [92, 62, 38]; if ((x === 6 || x === 9) && y === 9) col = [220, 190, 90]; P.set(x, y, col);
});
PAINT[T.IFIRE] = (P, c) => P.each((x, y) => {
  let col = shd([128, 120, 112], 0.85 + hash2(x >> 2, y >> 2, 9) * 0.25); if (y < 2) col = [60, 46, 38];
  if (x >= 4 && x <= 11 && y >= 7) col = y > 12 ? [70, 66, 62] : [24, 20, 20]; if (x >= 5 && x <= 10 && y === 13 && (x + c.v) % 2) col = [90, 84, 80];
  P.set(x, y, col);
});
PAINT[T.IMAT] = (P, c) => { PAINT[T.IFLOOR](P, c); for (let y = 3; y <= 13; y++) for (let x = 2; x <= 13; x++) P.set(x, y, (x + y) % 3 === 0 ? [110, 92, 60] : [150, 128, 84]); for (let i = 0; i < 4; i++) { P.set(7, 6 + i, [240, 220, 160]); P.set(8, 6 + i, [240, 220, 160]); } P.set(6, 9, [240, 220, 160]); P.set(9, 9, [240, 220, 160]); P.set(5, 8, [240, 220, 160]); P.set(10, 8, [240, 220, 160]); };
// ---- maze ----
PAINT[T.MWALL] = (P, c) => {
  const M = mazeColors(c.a), a = c.a;
  const k = 1 + (a > 0.25 ? a * 0.12 : 0) * Math.sin(c.f / FR * TAU);
  const mort = a > 0.5 ? mixc(shd(M.wall, 0.5), [72, 14, 24], (a - 0.5) * 2) : shd(M.wall, 0.52);
  P.each((x, y) => {
    const row = y >> 2, off = (row & 1) * 4;
    const m = (y & 3) === 3 || ((x + off) & 7) === 7;
    const bk = 0.86 + hash2((x + off) >> 3, row, c.v * 31 + 3) * 0.24;
    P.set(x, y, m ? mort : shd(M.wall, bk * k * ((y & 3) === 0 ? 1.12 : 1)));
  });
  if (a > 0.1) veinsOn(P, c, Math.floor(a * 3 + c.r() * a * 3), M.vein, 0.25 * a);
  if (a > 0.55) for (let i = 0; i < 4; i++) P.set(Math.floor(c.r() * 16), Math.floor(c.r() * 16), [240, 170, 170], (a - 0.5));
};
PAINT[T.MEYE] = (P, c) => { PAINT[T.MWALL](P, c); eyeSocket(P, mixc(mazeColors(c.a).wall, C.flesh, 0.5 + c.a * 0.5), false); };
PAINT[T.MFLOOR] = (P, c) => {
  const M = mazeColors(c.a), a = c.a, o = c.v * 3;
  P.each((x, y) => {
    const sx = (x + o) & 7, sy = (y + (c.v & 1) * 4) & 7;
    let col = shd(M.floor, 0.88 + hash2((x + o) >> 3, (y + (c.v & 1) * 4) >> 3, c.v + 9) * 0.22 + (c.r() - 0.5) * 0.06);
    if (sx === 0 || sy === 0) col = shd(M.floor, 0.68);
    if (a > 0.45 && Math.sin(x * 0.8 + y * 0.3 + c.v) > 0.75) col = shd(col, 1.14);
    P.set(x, y, col);
  });
  const stains = Math.floor(a * 3 + c.r() * (0.4 + a));
  for (let s = 0; s < stains; s++) {
    const cx = c.r() * 16, cy = c.r() * 16, rr = 0.8 + c.r() * 1.6;
    P.each((x, y) => { if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) < rr) P.set(x, y, [104, 18, 30], 0.55); });
  }
};
PAINT[T.MROOT] = (P, c) => { PAINT[T.MFLOOR](P, c); veinsOn(P, c, 2 + (c.v & 1), mixc([96, 72, 52], [164, 30, 52], c.a), 0.35); };
PAINT[T.MBONES] = (P, c) => {
  PAINT[T.MFLOOR](P, c);
  const bone = [222, 212, 190];
  for (let i = 0; i < 6; i++) P.set(3 + i, 11 - (i >> 1), bone);
  P.set(2, 11, bone); P.set(2, 12, bone); P.set(9, 7, bone); P.set(9, 8, bone);
  for (let y = 4; y <= 6; y++) for (let x = 10; x <= 12; x++) P.set(x, y, bone);
  P.set(10, 5, [40, 30, 30]); P.set(12, 5, [40, 30, 30]); P.set(11, 7, bone);
};
PAINT[T.STAIRS_DOWN] = (P, c) => {
  PAINT[T.MFLOOR](P, c);
  const M = mazeColors(c.a);
  for (let y = 2; y <= 13; y++) for (let x = 2; x <= 13; x++) {
    if (x === 2 || x === 13 || y === 2) { P.set(x, y, shd(M.wall, 0.9)); continue; }
    const k = (y - 3) / 10; let col = mixc(shd(M.wall, 0.75), [6, 2, 4], k);
    if ((y & 1) === 0) col = shd(col, 0.75);
    if (y > 9) col = mixc(col, [150, 16, 30], (0.15 + c.a * 0.5) * (y - 9) / 4);
    P.set(x, y, col);
  }
};
PAINT[T.STAIRS_UP] = (P, c) => {
  PAINT[T.MFLOOR](P, c);
  for (let y = 2; y <= 13; y++) for (let x = 3; x <= 12; x++) {
    const k = 1 - (y - 2) / 14; let col = mixc([60, 56, 60], [206, 198, 180], k);
    if ((y & 1) === 0) col = shd(col, 0.8);
    P.set(x, y, col);
  }
};
// ---- flesh ----
PAINT[T.FWALL] = (P, c) => { fleshFill(P, c, C.meat, 0.13); veinsOn(P, c, 1 + (c.v & 1), [104, 56, 132], 0.3); };
PAINT[T.FEYE] = (P, c) => { fleshFill(P, c, C.meat, 0.13); eyeSocket(P, [200, 90, 100], true); };
PAINT[T.FTEETH] = (P, c) => {
  fleshFill(P, c, C.meat, 0.13);
  for (let x = 0; x < 16; x++) { P.set(x, 10, [110, 18, 38]); P.set(x, 11, [130, 26, 46]); }
  for (let i = 0; i < 4; i++) {
    const x0 = i * 4, h = 3 + ((c.v + i) & 1);
    for (let y = 0; y < h; y++) for (let x = 0; x < 4; x++) {
      const w = 1.9 * (1 - y / (h + 0.5));
      if (Math.abs(x + 0.5 - 2) < w) P.set(x0 + x, 12 + y, x < 2 ? [238, 230, 210] : [198, 188, 168]);
    }
  }
};
PAINT[T.FFLOOR] = (P, c) => {
  const k = 1 + 0.06 * Math.sin(c.f / FR * TAU);
  P.each((x, y) => {
    const s = Math.sin(x * 0.7 + vnoise(x + c.v * 16, y, 6, c.seed) * 7 + c.v);
    let col = shd([110, 34, 46], (0.84 + 0.18 * s + (c.r() - 0.5) * 0.06) * k);
    if (s > 0.9) col = mixc(col, [200, 110, 120], 0.3);
    P.set(x, y, col);
  });
};
PAINT[T.FVEIN] = (P, c) => {
  PAINT[T.FFLOOR](P, c);
  const hor = (c.v & 1) === 0;
  for (let i = 0; i < 16; i++) {
    const w = Math.round(Math.sin(i * 0.5 + c.v) * 1.5);
    const bright = ((i - c.f * 4) & 15) < 4;
    for (let j = -1; j <= 1; j++) {
      const col = bright ? [222, 62, 92] : (j === 0 ? [140, 26, 62] : [104, 20, 48]);
      if (hor) P.set(i, 8 + w + j, col); else P.set(8 + w + j, i, col);
    }
  }
};
PAINT[T.FBILE] = (P, c) => {
  P.each((x, y) => P.set(x, y, shd([150, 172, 52], 0.9 + vnoise(x, y, 4, c.seed) * 0.2)));
  for (let k = 0; k < 3; k++) {
    const bx = c.r() * 16, by = c.r() * 16, br = ((c.f + k) % 4) * 0.7 + 0.5;
    P.each((x, y) => { const d = Math.hypot(x + 0.5 - bx, y + 0.5 - by); if (d < br) P.set(x, y, d > br - 0.9 ? [210, 230, 110] : [170, 192, 70]); });
  }
};
PAINT[T.FMOUTH] = (P, c) => {
  PAINT[T.FFLOOR](P, c);
  P.each((x, y) => {
    const dx = x + 0.5 - 8, dy = y + 0.5 - 8, d = Math.hypot(dx, dy);
    if (d < 4.2) P.set(x, y, [24, 4, 8]);
    else if (d < 6.2) { const ang = Math.atan2(dy, dx); const t = (Math.sin(ang * 6) + 1) / 2; P.set(x, y, t > 0.45 ? [236, 228, 206] : [140, 30, 50]); }
    else if (d < 7.4) P.set(x, y, [184, 64, 82]);
  });
};

export function buildAtlas(alive, seed) {
  const cv = document.createElement('canvas'); cv.width = ACOLS * TS; cv.height = NT * TS;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(cv.width, cv.height); const d = img.data;
  const P = new Pix();
  for (let id = 0; id < NT; id++) {
    const fn = PAINT[id]; if (!fn) continue;
    for (let v = 0; v < VAR; v++) for (let f = 0; f < FR; f++) {
      P.d.fill(0);
      const s = (seed * 31 + id * 1013 + v * 97) | 0;
      fn(P, { v, f, a: alive, r: mulberry32(s), seed: s });
      const ox = (v * FR + f) * TS, oy = id * TS;
      for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
        const si = (y * TS + x) * 3, di = ((oy + y) * cv.width + ox + x) * 4;
        d[di] = P.d[si]; d[di + 1] = P.d[si + 1]; d[di + 2] = P.d[si + 2]; d[di + 3] = 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  // average colours for minimap
  const avg = [];
  for (let id = 0; id < NT; id++) {
    let r = 0, g = 0, b = 0;
    for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) { const di = ((id * TS + y) * cv.width + x) * 4; r += d[di]; g += d[di + 1]; b += d[di + 2]; }
    avg.push([r / 256, g / 256, b / 256]);
  }
  avg[T.ROAD] = [196, 160, 110]; avg[T.BRIDGE_H] = avg[T.BRIDGE_V] = [176, 124, 72];
  avg[T.DUNGEON] = [230, 40, 60]; avg[T.STAIRS_DOWN] = [240, 60, 70]; avg[T.STAIRS_UP] = [230, 220, 170];
  avg[T.TREE] = [40, 88, 44]; avg[T.PINE] = [36, 80, 60];
  cv.avg = avg;
  return cv;
}

// ================= sprites =================
export const SPR = {}; export let SPRC = null, SPRW = null;
export function buildSprites() {
  const W = 512; SPRC = document.createElement('canvas'); SPRC.width = W; SPRC.height = 512;
  const actx = SPRC.getContext('2d');
  let cx = 0, cy = 0, rowH = 0;
  function place(name, can) {
    if (cx + can.width > W) { cx = 0; cy += rowH; rowH = 0; }
    actx.drawImage(can, cx, cy);
    SPR[name] = { x: cx, y: cy, w: can.width, h: can.height };
    cx += can.width; rowH = Math.max(rowH, can.height);
  }
  function make(name, w, h, fn, opt = {}) {
    const can = document.createElement('canvas'); can.width = w + 2; can.height = h + 2;
    const c = can.getContext('2d');
    const p = (x, y, ww, hh, col) => { c.fillStyle = typeof col === 'string' ? col : rgb(col); c.fillRect(x + 1, y + 1, ww, hh); };
    fn(p, c);
    if (opt.outline !== false) outline(can, opt.oc || [18, 12, 20]);
    place(name, can);
    if (opt.flip) {
      const f = document.createElement('canvas'); f.width = can.width; f.height = can.height;
      const fc = f.getContext('2d'); fc.translate(f.width, 0); fc.scale(-1, 1); fc.drawImage(can, 0, 0);
      place(name + 'L', f);
    }
  }
  function outline(can, oc) {
    const c = can.getContext('2d'); const im = c.getImageData(0, 0, can.width, can.height); const d = im.data; const w = can.width, h = can.height;
    const a = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) a[i] = d[i * 4 + 3] > 40 ? 1 : 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (a[i]) continue;
      if ((x > 0 && a[i - 1]) || (x < w - 1 && a[i + 1]) || (y > 0 && a[i - w]) || (y < h - 1 && a[i + w])) { d[i * 4] = oc[0]; d[i * 4 + 1] = oc[1]; d[i * 4 + 2] = oc[2]; d[i * 4 + 3] = 255; }
    }
    c.putImageData(im, 0, 0);
  }
  // ---- humanoids ----
  function humanoid(p, dir, fr, pal, o) {
    const hy = o.hunch ? 1 : 0;
    if (!o.robe || fr) {
      if (dir < 2) {
        p(5, 12 + (fr === 1 ? -1 : 0), 2, 3, pal.legs); p(9, 12 + (fr === 2 ? -1 : 0), 2, 3, pal.legs);
      } else {
        const s = fr === 0 ? 0 : 1; p(6 - s, 12, 2, 3, pal.legs); p(8 + s, 12, 2, 3, shd(pal.legs, 0.8));
      }
    } else { p(5, 12, 2, 3, pal.legs); p(9, 12, 2, 3, pal.legs); }
    const bodyH = o.robe ? 7 : 5;
    p(4, 7 + hy, 8, bodyH, pal.cloak);
    if (dir === 0 || dir === 1) { p(10, 7 + hy, 2, bodyH, pal.cloakD); p(3, 8 + hy, 1, 3, pal.cloakD); p(12, 8 + hy, 1, 3, pal.cloakD); p(3, 11 + hy, 1, 1, pal.skin); p(12, 11 + hy, 1, 1, pal.skin); }
    else { p(dir === 2 ? 10 : 4, 7 + hy, 2, bodyH, pal.cloakD); p(7, 8 + hy, 2, 4, pal.cloakD); p(dir === 2 ? 7 : 8, 12 + hy, 1, 1, pal.skin); }
    if (pal.belt) p(4, 10 + hy, 8, 1, pal.belt);
    if (pal.mark) { p(6, 9 + hy, 4, 1, pal.mark); p(7, 8 + hy, 2, 3, pal.mark); }
    const hx = o.hunch ? (dir === 2 ? -1 : dir === 3 ? 1 : 0) : 0;
    p(5 + hx, 2 + hy, 6, 6, pal.hood); p(6 + hx, 1 + hy, 4, 1, pal.hood);
    if (dir === 0) { p(6 + hx, 4 + hy, 4, 3, pal.skin); p(6 + hx, 4 + hy, 4, 1, shd(pal.skin, 0.78)); p(7 + hx, 5 + hy, 1, 1, pal.eye); p(9 + hx, 5 + hy, 1, 1, pal.eye); }
    else if (dir === 1) { p(7 + hx, 3 + hy, 2, 4, pal.hoodD); }
    else if (dir === 2) { p(5 + hx, 4 + hy, 3, 3, pal.skin); p(5 + hx, 5 + hy, 1, 1, pal.eye); p(9 + hx, 3 + hy, 2, 4, pal.hoodD); }
    else { p(8 + hx, 4 + hy, 3, 3, pal.skin); p(10 + hx, 5 + hy, 1, 1, pal.eye); p(5 + hx, 3 + hy, 2, 4, pal.hoodD); }
  }
  const PALS = {
    player: { cloak: [46, 112, 120], cloakD: [30, 80, 90], hood: [38, 94, 104], hoodD: [24, 66, 76], skin: [240, 200, 164], legs: [66, 54, 58], eye: [24, 20, 30], belt: [126, 88, 52] },
    v0: { cloak: [170, 120, 70], cloakD: [128, 88, 52], hood: [96, 64, 40], hoodD: [70, 46, 30], skin: [236, 196, 160], legs: [70, 60, 50], eye: [30, 20, 20], belt: [80, 60, 40] },
    v1: { cloak: [120, 70, 110], cloakD: [88, 50, 82], hood: [200, 120, 60], hoodD: [160, 90, 40], skin: [242, 206, 170], legs: [60, 50, 60], eye: [30, 20, 20] },
    v2: { cloak: [86, 120, 70], cloakD: [60, 90, 50], hood: [60, 40, 30], hoodD: [40, 26, 20], skin: [220, 180, 140], legs: [70, 60, 40], eye: [30, 20, 20], belt: [140, 110, 60] },
    v3: { cloak: [80, 92, 140], cloakD: [56, 66, 104], hood: [216, 196, 120], hoodD: [180, 160, 90], skin: [244, 210, 180], legs: [50, 50, 70], eye: [30, 20, 30] },
    healer: { cloak: [232, 230, 220], cloakD: [190, 188, 180], hood: [214, 212, 204], hoodD: [170, 168, 160], skin: [236, 198, 164], legs: [120, 116, 110], eye: [30, 20, 30], mark: [200, 40, 50] },
    husk: { cloak: [118, 126, 108], cloakD: [84, 92, 76], hood: [100, 108, 92], hoodD: [70, 78, 64], skin: [176, 184, 160], legs: [70, 70, 64], eye: [210, 40, 40] },
  };
  for (const k in PALS) for (let dir = 0; dir < 4; dir++) for (let fr = 0; fr < 3; fr++)
    make(`${k}${dir}${fr}`, 16, 16, p => humanoid(p, dir, fr, PALS[k], { hunch: k === 'husk', robe: k === 'healer' || k === 'husk' }));
  // ---- slime ----
  for (let fr = 0; fr < 2; fr++) make('slime' + fr, 16, 16, p => {
    const rx = fr ? 7.2 : 6.3, ry = fr ? 3.9 : 4.9, cy = fr ? 11.2 : 10.4;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const dx = (x + 0.5 - 8) / rx, dy = (y + 0.5 - cy) / ry; if (dx * dx + dy * dy < 1) p(x, y, 1, 1, dy < -0.35 ? [128, 214, 112] : dy > 0.5 ? [58, 140, 70] : [92, 190, 90]); }
    p(5, Math.round(cy) - 3, 2, 1, [220, 255, 220]); p(6, Math.round(cy), 1, 2, [20, 40, 24]); p(9, Math.round(cy), 1, 2, [20, 40, 24]);
  });
  // ---- wolf (faces right) ----
  for (let fr = 0; fr < 2; fr++) make('wolf' + fr, 16, 16, p => {
    const fur = [124, 124, 136], furD = [84, 84, 98], furL = [172, 172, 182];
    p(0, fr ? 5 : 6, 3, 2, furD); p(3, 7, 9, 4, fur); p(4, 10, 7, 1, furL); p(3, 7, 9, 1, furL);
    p(11, 5, 4, 4, fur); p(14, 7, 2, 2, furD); p(15, 7, 1, 1, [20, 20, 20]); p(11, 3, 1, 2, furD); p(13, 3, 1, 2, furD); p(13, 6, 1, 1, [250, 210, 80]);
    if (fr) { p(3, 11, 1, 2, furD); p(5, 11, 1, 3, furD); p(10, 11, 1, 2, furD); p(12, 11, 1, 3, furD); }
    else { p(4, 11, 1, 3, furD); p(6, 11, 1, 2, furD); p(9, 11, 1, 3, furD); p(11, 11, 1, 2, furD); }
  }, { flip: true });
  // ---- mite ----
  for (let fr = 0; fr < 2; fr++) make('mite' + fr, 12, 10, p => {
    const lc = [70, 20, 24];
    for (let i = 0; i < 3; i++) { const o = ((i + fr) & 1); p(1, 3 + i * 2 + o, 3, 1, lc); p(8, 3 + i * 2 + (1 - o), 3, 1, lc); }
    for (let y = 0; y < 10; y++) for (let x = 0; x < 12; x++) { const dx = (x + 0.5 - 6) / 3.4, dy = (y + 0.5 - 5.5) / 3.2; if (dx * dx + dy * dy < 1) p(x, y, 1, 1, dy < -0.3 ? [168, 44, 54] : [122, 26, 38]); }
    p(4, 2, 1, 1, [255, 120, 80]); p(7, 2, 1, 1, [255, 120, 80]);
  });
  // ---- antibody (white cell) ----
  for (let fr = 0; fr < 2; fr++) make('antibody' + fr, 16, 16, p => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const dx = x + 0.5 - 8, dy = y + 0.5 - 8, a = Math.atan2(dy, dx), r = 6 + 0.9 * Math.sin(3 * a + fr * 1.7) + 0.4 * Math.sin(5 * a - fr);
      const d = Math.hypot(dx, dy); if (d < r) p(x, y, 1, 1, d > r - 1.4 ? [196, 196, 222] : (dx + dy < -3 ? [248, 248, 255] : [228, 228, 242]));
    }
    for (const [nx, ny] of [[6, 7], [9, 6], [8, 9]]) for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) if (x * x + y * y < 2) p(nx + x, ny + y, 1, 1, [150, 96, 184]);
  });
  // ---- parasite worm (faces right) ----
  for (let fr = 0; fr < 2; fr++) make('worm' + fr, 16, 12, p => {
    for (let s = 0; s < 5; s++) {
      const x = 2 + s * 2.6, y = 6 + Math.sin(s * 1.1 + fr * Math.PI) * 1.6, r = s === 4 ? 2.6 : 2.1;
      for (let yy = -3; yy <= 3; yy++) for (let xx = -3; xx <= 3; xx++) if (xx * xx + yy * yy < r * r) p(Math.round(x + xx), Math.round(y + yy), 1, 1, s === 4 ? [176, 70, 92] : (s & 1 ? [214, 124, 138] : [232, 146, 156]));
    }
    p(14, 6, 1, 1, [30, 6, 10]);
  }, { flip: true });
  // ---- polyp ----
  for (let fr = 0; fr < 2; fr++) make('polyp' + fr, 16, 16, p => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const dx = (x + 0.5 - 8) / 6.4, dy = (y + 0.5 - 10.5) / 4.6; if (dx * dx + dy * dy < 1) p(x, y, 1, 1, dy < -0.2 ? [204, 96, 110] : [168, 62, 80]); }
    if (fr) { p(5, 7, 6, 3, [30, 6, 10]); p(5, 7, 1, 1, [240, 230, 210]); p(7, 7, 1, 1, [240, 230, 210]); p(9, 7, 1, 1, [240, 230, 210]); }
    else p(6, 8, 4, 1, [70, 14, 24]);
    p(4, 11, 1, 1, [230, 150, 150]); p(11, 12, 1, 1, [230, 150, 150]);
  });
  // ---- ganglion ----
  for (let fr = 0; fr < 2; fr++) make('ganglion' + fr, 24, 24, p => {
    const tc = fr ? [190, 120, 210] : [150, 90, 170];
    for (let k = 0; k < 7; k++) {
      const a = k / 7 * TAU + 0.3; let x = 12, y = 12;
      for (let i = 0; i < 10; i++) { x += Math.cos(a + Math.sin(i * 0.8 + k) * 0.5); y += Math.sin(a + Math.sin(i * 0.8 + k) * 0.5); p(Math.round(x), Math.round(y), 1, 1, tc); }
    }
    const R = fr ? 5.6 : 5;
    for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) { const dx = x + 0.5 - 12, dy = y + 0.5 - 12, d = Math.hypot(dx, dy); if (d < R) p(x, y, 1, 1, dx + dy < -2 ? [250, 236, 170] : d > R - 1.2 ? [180, 150, 90] : [224, 200, 124]); }
    p(11, 11, 2, 2, fr ? [255, 90, 90] : [200, 60, 70]);
  });
  // ---- items ----
  make('chest0', 16, 14, p => { p(2, 6, 12, 8, [150, 100, 50]); p(2, 3, 12, 4, [178, 124, 66]); p(2, 6, 12, 1, [100, 66, 34]); p(4, 3, 1, 11, [90, 60, 30]); p(11, 3, 1, 11, [90, 60, 30]); p(7, 6, 2, 3, [236, 196, 70]); });
  make('chest1', 16, 14, p => { p(2, 6, 12, 8, [150, 100, 50]); p(2, 1, 12, 3, [178, 124, 66]); p(3, 5, 10, 2, [30, 20, 16]); p(4, 1, 1, 13, [90, 60, 30]); p(11, 1, 1, 13, [90, 60, 30]); });
  const HEART = ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'];
  make('heart', 7, 6, p => HEART.forEach((row, y) => [...row].forEach((ch, x) => { if (ch === 'X') p(x, y, 1, 1, (x === 1 && y === 1) ? [255, 200, 200] : [228, 40, 60]); })));
  make('hcont', 9, 8, p => HEART.forEach((row, y) => [...row].forEach((ch, x) => { if (ch === 'X') p(x + 1, y + 1, 1, 1, (x === 1 && y === 1) ? [255, 220, 220] : [228, 40, 60]); })), { oc: [240, 200, 70] });
  make('ammo', 8, 6, p => { p(0, 1, 8, 5, [110, 96, 60]); p(0, 1, 8, 1, [150, 132, 84]); for (let i = 0; i < 3; i++) { p(1 + i * 2, 0, 1, 2, [232, 196, 90]); } }, { oc: [30, 24, 14] });
  make('med', 8, 7, p => { p(0, 1, 8, 6, [236, 236, 236]); p(3, 2, 2, 4, [220, 40, 50]); p(2, 3, 4, 2, [220, 40, 50]); p(2, 0, 4, 1, [180, 180, 180]); });
  make('corpse', 16, 10, p => {
    p(1, 3, 10, 5, [36, 38, 44]); p(2, 4, 8, 1, [56, 60, 70]); p(11, 3, 4, 4, [214, 180, 150]); p(11, 3, 4, 1, [40, 34, 30]);
    p(0, 4, 2, 3, [28, 28, 32]); p(4, 8, 2, 1, [36, 38, 44]); p(7, 1, 2, 2, [36, 38, 44]); p(3, 5, 2, 1, [220, 200, 60]);
  });
  make('blade', 12, 12, p => { for (let i = 0; i < 8; i++) p(3 + i, 8 - i, 1, 1, i > 5 ? [255, 255, 255] : [210, 224, 240]); p(2, 7, 3, 3, [200, 160, 70]); p(1, 10, 2, 1, [110, 74, 40]); p(0, 11, 1, 1, [110, 74, 40]); });
  make('spore', 6, 6, p => { p(1, 0, 4, 6, [180, 206, 76]); p(0, 1, 6, 4, [180, 206, 76]); p(1, 1, 2, 2, [236, 250, 160]); }, { oc: [60, 80, 20] });
  // ---- heart boss ----
  for (let fr = 0; fr < 2; fr++) make('boss' + fr, 52, 52, (p) => {
    const s = fr ? 15 : 16.5;
    const tube = (pts, r, col, colL) => {
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
        for (let t = 0; t <= 1; t += 0.05) { const x = lerp(ax, bx, t), y = lerp(ay, by, t);
          for (let yy = -r; yy <= r; yy++) for (let xx = -r; xx <= r; xx++) if (xx * xx + yy * yy <= r * r) p(Math.round(x + xx), Math.round(y + yy), 1, 1, (xx + yy < -r * 0.6) ? colL : col); }
      }
    };
    tube([[12, 18], [10, 10], [9, 3]], 3, [86, 86, 160], [130, 130, 200]);
    tube([[22, 16], [21, 8], [26, 3], [33, 4], [36, 10]], 4, [214, 124, 134], [244, 176, 180]);
    tube([[30, 18], [31, 9], [38, 6]], 3, [120, 96, 176], [160, 140, 210]);
    for (let y = 0; y < 52; y++) for (let x = 0; x < 52; x++) {
      const u = (x + 0.5 - 26) / s, v = -(y + 0.5 - 28) / s;
      const q = u * u + v * v - 1; const f = q * q * q - u * u * v * v * v;
      if (f <= 0) {
        const n = vnoise(x, y, 4, 77 + fr);
        let l = 0.72 + 0.42 * (-u * 0.45 + v * 0.5) + (n - 0.5) * 0.3;
        let col = shd([158, 28, 42], clamp(l, 0.5, 1.35));
        if (f > -0.06) col = shd(col, 0.7);
        if (v > 0.55 && n > 0.55) col = mixc(col, [232, 204, 128], 0.6);
        p(x, y, 1, 1, col);
      }
    }
    const vc = fr ? [230, 70, 90] : [96, 16, 36];
    for (let k = 0; k < 3; k++) { let x = 20 + k * 6, y = 20; for (let i = 0; i < 18; i++) { x += Math.sin(i * 0.6 + k) * 0.8; y += 1; p(Math.round(x), Math.round(y), 1, 1, vc); } }
  });
  // white silhouettes for hit flashes
  SPRW = document.createElement('canvas'); SPRW.width = SPRC.width; SPRW.height = SPRC.height;
  const wc = SPRW.getContext('2d'); wc.drawImage(SPRC, 0, 0); wc.globalCompositeOperation = 'source-in'; wc.fillStyle = '#fff'; wc.fillRect(0, 0, SPRW.width, SPRW.height);
}
