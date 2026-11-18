import { pick, TS } from './core.js';
import { ctx, G, saveGame, SH, SW, toast, txt, UI, wdx, wdy } from './game.js';

// ================= difficulty =================
// Hard is the game as it was first built. Easier modes soften what felt hard; Impossible adds permadeath.
export const DIFFS = {
  easy: { id: 'easy', name: 'Easy', blurb: 'Weaker, fewer enemies. Plenty of ammo. Brighter nights. One floor of cells, two nerves.', hp: 0.6, dmg: 0.5, spawn: 0.5, ammo: 1.8, drop: 1.6, hearts: 10, inv: 1.5, night: 0.55, light: 1.4, fog: 0.6, crawl: 1.15, floors: 3, nerves: 2, boss: 0.6, meds: 3, startAmmo: 24, hintN: 1, hints: true, perma: false, wolves: false, climbEvery: 16, climbMax: 2 },
  medium: { id: 'medium', name: 'Medium', blurb: 'A fair fight. More ammo and hearts than Hard. One floor of cells, three nerves.', hp: 0.8, dmg: 0.75, spawn: 0.75, ammo: 1.35, drop: 1.25, hearts: 8, inv: 1.25, night: 0.72, light: 1.2, fog: 0.8, crawl: 0.8, floors: 3, nerves: 3, boss: 0.8, meds: 2, startAmmo: 18, hintN: 2, hints: true, perma: false, climbEvery: 12, climbMax: 3 },
  hard: { id: 'hard', name: 'Hard', blurb: 'The game as first built. Scarce ammo, dark nights, two floors of cells, four nerves.', hp: 1, dmg: 1, spawn: 1, ammo: 1, drop: 1, hearts: 6, inv: 1, night: 0.86, light: 1, fog: 1, crawl: 0.55, floors: 4, nerves: 4, boss: 1, meds: 1, startAmmo: 12, hintN: 3, hints: true, perma: false, climbEvery: 9, climbMax: 4 },
  impossible: { id: 'impossible', name: 'Impossible', blurb: 'Harder than Hard, and one life. Die and the world is gone.', hp: 1.3, dmg: 1.25, spawn: 1.3, ammo: 0.8, drop: 0.8, hearts: 6, inv: 0.85, night: 0.9, light: 0.9, fog: 1.1, crawl: 0.45, floors: 4, nerves: 4, boss: 1.3, meds: 0, startAmmo: 12, hintN: 4, hints: true, perma: true, climbEvery: 7, climbMax: 5 },
};
const DIFF_ORDER = ['easy', 'medium', 'hard', 'impossible'];
export let DIFF = DIFFS.easy;
export function setDifficulty(id, live) {
  DIFF = DIFFS[id] || DIFFS.medium; G.diff = DIFF.id;
  if (live && G.P) { const P = G.P; P.maxHp = DIFF.hearts + 2 * (P.vessels || 0); P.hp = Math.min(P.hp, P.maxHp); }
}
// underground floors: the outer works, one or two floors of cells, then the breach. The flesh is below the last.
export const floorsN = () => DIFF.floors;
// ---- villagers point the way to the stairs ----
const COMPASS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
const dirWord = (dx, dy) => COMPASS[((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8];
const HINT_LINES = [
  (dir, far) => `The old stairs? ${far}, ${dir} of here. Don't go at night.`,
  (dir, far) => `My brother saw stairs in the ground to the ${dir}. ${far}. He hasn't been right since.`,
  (dir, far) => `Head ${dir}. ${far}. You'll know it by the red in the grass.`,
  (dir, far) => `There's a set of stairs ${dir} of us. ${far}. The ground round it is warm.`,
];
// ---- before the first night, villagers send you to the town that is about to fall ----
const FALL_LINES = [
  (name, dir) => `Could you look in on ${name}? It's ${dir} of here, not far. They've gone quiet.`,
  (name, dir) => `${name}'s lamps should be lit by now. It's ${dir} of here. Go and see?`,
  (name, dir) => `My sister lives in ${name}, ${dir} of us. Nobody's come over from there all day.`,
];
export function firstNightTown() {
  const L = G.over, t = L && L.towns[L.fallTown];
  return t && !t.doomed && !t.fog ? t : null;
}
export function fallHint(n) {
  const t = firstNightTown(); if (!t || n.town === t) return null;
  const dx = wdx(G.over, t.x * TS + 8 - n.x), dy = wdy(G.over, t.y * TS + 8 - n.y);
  G.hintArrow = { d: t, t: 14 };
  return pick(Math.random, FALL_LINES)(t.name, dirWord(dx, dy));
}
export function stairsHint(n) {
  const L = G.over; if (!DIFF.hints || !L.dungeons.length) return null;
  let best = null, bd = 1e9;
  const tdx = d => wdx(L, (d.x + 0.5) * TS - n.x) / TS, tdy = d => wdy(L, (d.y + 0.5) * TS - n.y) / TS;
  for (const d of L.dungeons) { if (G.prog.marked[d.id]) continue; const dd = Math.hypot(tdx(d), tdy(d)); if (dd < bd) { bd = dd; best = d; } }
  if (!best) return null;
  n.hinted = n.hinted || {};
  const dx = tdx(best), dy = tdy(best), dir = dirWord(dx, dy);
  const far = bd < 45 ? 'Not far' : bd < 110 ? 'A fair walk' : 'A long way';
  const text = pick(Math.random, HINT_LINES)(dir, far);
  G.hintArrow = { d: best, t: 12 };
  if (!n.hinted[best.id]) {
    n.hinted[best.id] = 1; G.prog.hints[best.id] = (G.prog.hints[best.id] || 0) + 1;
    if (G.prog.hints[best.id] >= DIFF.hintN) {
      G.prog.marked[best.id] = 1; best.seen = true;
      setTimeout(() => toast('Marked on your map', `Enough people have said it. The stairs to the ${dir}.`, 4), 1200);
    } else setTimeout(() => toast('A lead', `${DIFF.hintN - G.prog.hints[best.id]} more ${DIFF.hintN - G.prog.hints[best.id] === 1 ? 'villager' : 'villagers'} saying it and you'll mark it on your map.`, 3.2), 1200);
    saveGame();
  }
  return text;
}
export function drawHintArrow() {
  const h = G.hintArrow; if (!h || h.t <= 0 || !G.L || G.L.kind !== 'over') return;
  const P = G.P, dx = wdx(G.L, h.d.x * TS + 8 - P.x), dy = wdy(G.L, h.d.y * TS + 8 - P.y), dd = Math.hypot(dx, dy); if (dd < TS * 6) return;
  const a = Math.atan2(dy, dx), r = Math.min(SW, SH) * 0.36, x = SW / 2 + Math.cos(a) * r, y = SH / 2 + Math.sin(a) * r, s = UI.s;
  ctx.globalAlpha = Math.min(1, h.t / 2) * (0.75 + 0.25 * Math.sin(G.t * 6));
  ctx.save(); ctx.translate(x, y); ctx.rotate(a);
  ctx.fillStyle = '#ff3048'; ctx.strokeStyle = '#200'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(16 * s, 0); ctx.lineTo(-8 * s, -10 * s); ctx.lineTo(-3 * s, 0); ctx.lineTo(-8 * s, 10 * s); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
  txt(`${Math.round(dd / TS)} m`, x, y + 16 * s, 11 * s, '#ffb0b8', 'center');
  ctx.globalAlpha = 1;
}
