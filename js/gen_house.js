import { clamp, hash2, Level, mulberry32, T, TS } from './core.js';
import { makeEnemy } from './entities.js';
import { getLevel } from './gen_maze.js';
import { sfx } from './audio.js';
import { enterLevel, G, makeCorpse, transition } from './game.js';

// ================= house interiors =================
export function houseOccupied(h) {
  if (h.town.fog || h.town.doomed) return false;
  return hash2(h.door[0], h.door[1], G.seed + 77) < (h.town.kind === 'city' ? 0.35 : 0.3);
}
export function genHouse(h) {
  const R = mulberry32((G.seed ^ (h.door[0] * 7919 + h.door[1] * 104729)) >>> 0);
  const W = clamp(h.w * 2 + 4, 9, 13), H = clamp(h.h * 2 + 3, 8, 11);
  const L = new Level('house', W, H); L.edge = T.IWALL; L.key = 'h:' + h.key; L.house = h; L.revealR = 14;
  L.name = (h.town.fog ? 'Abandoned house  ·  ' : 'Empty house  ·  ') + h.town.name;
  L.t.fill(T.IFLOOR);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (y < 2 || x === 0 || x === W - 1 || y === H - 1) L.set(x, y, T.IWALL);
  L.randomizeVariants(h.door[0] * 31 + h.door[1]);
  for (let i = 0; i < W * H; i++) if (L.t[i] === T.IFLOOR) L.v[i] = h.town.fog && R() < 0.12 ? 3 : L.v[i] % 3;
  const mx = W >> 1;
  L.set(mx, H - 2, T.IMAT);
  // furniture against the back wall: a cold fireplace and cupboards to search
  const bedLeft = R() < 0.5, slots = [];
  // the bed takes one back corner, so nothing else may go there (cupboards used to be dropped there, leaving some houses with none)
  for (let x = 2; x <= W - 3; x++) if ((Math.abs(x - mx) > 0 || W < 10) && !(bedLeft ? x <= 2 : x >= W - 3)) slots.push(x);
  const takeSlot = () => { const k = Math.floor(R() * slots.length); const x = slots[k]; slots.splice(k, 1); for (const n of [x - 1, x + 1]) { const j = slots.indexOf(n); if (j >= 0) slots.splice(j, 1); } return x; };
  L.set(takeSlot(), 1, T.IFIRE);
  L.stashes = new Map();
  const nCup = W >= 11 ? 3 : 2;
  for (let k = 0; k < nCup && slots.length; k++) {
    const x = takeSlot(); if (x === undefined) break;
    L.set(x, 1, T.ISHELF); L.stashes.set(x + ',1', { type: 'stash', key: `${h.key}:${x}`, town: h.town });
  }
  const bx = bedLeft ? 1 : W - 2;
  L.set(bx, 2, T.IBED); L.v[2 * W + bx] = 0; L.set(bx, 3, T.IBED); L.v[3 * W + bx] = 1;
  const ty = Math.floor(H / 2); L.set(mx - 1, ty, T.ITABLE); L.set(mx, ty, T.ITABLE);
  for (let y = H - 4; y <= H - 3; y++) for (let x = mx - 1; x <= mx + 1; x++) if (L.get(x, y) === T.IFLOOR) L.set(x, y, T.IRUG);
  L.start = { x: mx * TS + 8, y: (H - 3) * TS + 8 };
  L.lights.push({ x: mx * TS + 8, y: 2 * TS, r: W * TS * 0.75, day: true });
  if (h.town.fog) {
    if (R() < 0.3) { const e = makeEnemy('husk', (bedLeft ? W - 3 : 2) * TS + 8, 3 * TS + 8); L.ents.push(e); }
    else if (R() < 0.3) { const c = makeCorpse((mx + 2) * TS + 8, (H - 4) * TS + 8); c.key = 'hc:' + h.key; c.pool = 'surface'; L.ents.push(c); }
  }
  L.goUp = leaveHouse;
  L.audio = () => ({ wind: 0.012, windF: 180, drone: h.town.fog ? 0.05 : 0, droneF: 44, bpm: 60, beatVol: 0 });
  return L;
}
export function enterHouse(h) {
  sfx('door');
  transition('', '', () => { const L = getLevel('h:' + h.key); enterLevel(L, L.start.x, L.start.y); }, 0.7);
}
function leaveHouse(L) {
  sfx('door'); const h = L.house;
  transition('', '', () => enterLevel(G.over, h.door[0] * TS + 8, h.door[1] * TS + 10), 0.7);
}
export const KNOCK_LINES = [
  '"Go away. We\'re not opening up."',
  '"Who\'s there? ...Leave us be."',
  'A chair scrapes inside. Nobody comes to the door.',
  '"Not after what happened at the next town. Move on."',
  'A child starts to ask who it is. Someone hushes them.',
];
