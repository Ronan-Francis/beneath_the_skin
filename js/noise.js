import { hash2, lerp } from './core.js';

// ================= Perlin noise =================
function _grad(h, x, y) {
  switch (h & 7) {
    case 0: return x + y; case 1: return -x + y; case 2: return x - y; case 3: return -x - y;
    case 4: return x; case 5: return -x; case 6: return y; default: return -y;
  }
}
function makePerlin(rand) {
  const a = new Uint8Array(256);
  for (let i = 0; i < 256; i++) a[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
  const p = new Uint8Array(512);
  for (let i = 0; i < 512; i++) p[i] = a[i & 255];
  return function (x, y) {
    let X = Math.floor(x), Y = Math.floor(y);
    const xf = x - X, yf = y - Y; X &= 255; Y &= 255;
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10), v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const aa = p[p[X] + Y], ab = p[p[X] + Y + 1], ba = p[p[X + 1] + Y], bb = p[p[X + 1] + Y + 1];
    const x1 = _grad(aa, xf, yf) + (_grad(ba, xf - 1, yf) - _grad(aa, xf, yf)) * u;
    const x2 = _grad(ab, xf, yf - 1) + (_grad(bb, xf - 1, yf - 1) - _grad(ab, xf, yf - 1)) * u;
    return x1 + (x2 - x1) * v;
  };
}
function fbm(n, x, y, oct) {
  let a = 1, f = 1, s = 0, t = 0;
  for (let i = 0; i < oct; i++) { s += a * n(x * f + i * 17.3, y * f + i * 9.1); t += a; a *= 0.5; f *= 2.03; }
  return s / t;
}
// value noise on a pixel grid (for tile art)
export function vnoise(x, y, s, seed) {
  const fx = x / s, fy = y / s; const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0; const u = tx * tx * (3 - 2 * tx), v = ty * ty * (3 - 2 * ty);
  const a = hash2(x0, y0, seed), b = hash2(x0 + 1, y0, seed), c = hash2(x0, y0 + 1, seed), d = hash2(x0 + 1, y0 + 1, seed);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

// periodic Perlin: tiles seamlessly with integer lattice periods px, py
export function makePerlinP(rand) {
  const a = new Uint8Array(256);
  for (let i = 0; i < 256; i++) a[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
  const p = new Uint8Array(512); for (let i = 0; i < 512; i++) p[i] = a[i & 255];
  return function (x, y, px, py) {
    const X = Math.floor(x), Y = Math.floor(y), xf = x - X, yf = y - Y;
    const X0 = ((X % px) + px) % px, Y0 = ((Y % py) + py) % py, X1 = (X0 + 1) % px, Y1 = (Y0 + 1) % py;
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10), v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const aa = p[p[X0 & 255] + (Y0 & 255)], ab = p[p[X0 & 255] + (Y1 & 255)], ba = p[p[X1 & 255] + (Y0 & 255)], bb = p[p[X1 & 255] + (Y1 & 255)];
    const x1 = _grad(aa, xf, yf) + (_grad(ba, xf - 1, yf) - _grad(aa, xf, yf)) * u;
    const x2 = _grad(ab, xf, yf - 1) + (_grad(bb, xf - 1, yf - 1) - _grad(ab, xf, yf - 1)) * u;
    return x1 + (x2 - x1) * v;
  };
}
// fractal noise over a W x H map that wraps; cells = lattice cells across the map at octave 0
export function fbmT(n, x, y, W, H, cx, cy, oct) {
  let a = 1, s = 0, t = 0, fx = cx, fy = cy;
  for (let i = 0; i < oct; i++) { s += a * n(x / W * fx + i * 17, y / H * fy + i * 9, fx, fy); t += a; a *= 0.5; fx *= 2; fy *= 2; }
  return s / t;
}
