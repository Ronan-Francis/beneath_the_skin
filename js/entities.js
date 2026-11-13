import { TAU, TS } from './core.js';
import { DIFF } from './difficulty.js';
import { DX4, DY4 } from './gen_overworld.js';
import { G } from './game.js';

// ================= physics =================
export function collides(L, x, y, r, enemy) {
  const x0 = Math.floor((x - r) / TS), x1 = Math.floor((x + r - 0.001) / TS), y0 = Math.floor((y - r) / TS), y1 = Math.floor((y + r - 0.001) / TS);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (L.blockedFor(tx, ty, enemy)) return true;
  return false;
}
function moveAxis(e, L, enemy, dx, dy) {
  if (!collides(L, e.x + dx, e.y + dy, e.r, enemy)) { e.x += dx; e.y += dy; return true; }
  // corner assist: slide around the edge of a block if we're only slightly overlapping it
  const amt = Math.abs(dx || dy);
  for (let o = 1; o <= 7; o++) for (const s of [1, -1]) {
    const ox = dx ? 0 : s * o, oy = dx ? s * o : 0;
    if (!collides(L, e.x + ox, e.y + oy, e.r, enemy) && !collides(L, e.x + ox + dx, e.y + oy + dy, e.r, enemy)) {
      const step = Math.min(amt, o);
      e.x += dx ? 0 : s * step; e.y += dx ? s * step : 0; return false;
    }
  }
  let sx = dx, sy = dy;
  for (let i = 0; i < 4; i++) { sx /= 2; sy /= 2; if (!collides(L, e.x + sx, e.y + sy, e.r, enemy)) { e.x += sx; e.y += sy; } }
  return false;
}
export function moveBody(e, dx, dy, L, enemy) {
  e.bumped = false;
  if (dx && !moveAxis(e, L, enemy, dx, 0)) e.bumped = true;
  if (dy && !moveAxis(e, L, enemy, 0, dy)) e.bumped = true;
}

// ================= definitions =================
const EDEF = {
  slime: { hp: 2, spd: 30, r: 5, dmg: 1, aggro: 100, spr: 'slime', beh: 'hop', drop: 0.22, col: [92, 190, 90] },
  wolf: { hp: 3, spd: 66, r: 6, dmg: 1, aggro: 160, spr: 'wolf', flip: true, beh: 'chase', drop: 0.3, col: [124, 124, 136] },
  husk: { hp: 3, spd: 40, r: 5, dmg: 1, aggro: 120, spr: 'husk', hum: true, beh: 'chase', drop: 0.25, col: [118, 126, 108] },
  mite: { hp: 1, spd: 82, r: 3.5, dmg: 1, aggro: 130, spr: 'mite', beh: 'chase', drop: 0.1, col: [150, 30, 40] },
  antibody: { hp: 4, spd: 50, r: 6, dmg: 2, aggro: 220, spr: 'antibody', beh: 'chase', drop: 0.3, col: [230, 230, 240] },
  worm: { hp: 2, spd: 62, r: 5, dmg: 1, aggro: 150, spr: 'worm', flip: true, beh: 'chase', drop: 0.2, col: [220, 130, 140] },
  polyp: { hp: 5, spd: 0, r: 6, dmg: 1, aggro: 150, spr: 'polyp', beh: 'turret', shoot: 2.2, drop: 0.4, col: [176, 70, 86] },
};
export function makeEnemy(kind, x, y, hpMul = 1) {
  const d = EDEF[kind];
  return { type: 'enemy', hittable: true, kind, d, x, y, r: d.r, hp: Math.max(1, Math.round(d.hp * hpMul * DIFF.hp * (1 + 0.5 * (G.ngp || 0)))), kx: 0, ky: 0, hurt: 0, anim: Math.random() * 10, wdir: Math.random() * TAU, wt: 0, idle: false, face: 1, dir: 0, hopT: Math.random(), cool: 1 + Math.random() * 2, moving: false };
}
export function makeNPC(pal, x, y, town, role, name) {
  return { type: 'npc', pal, x, y, r: 5, dir: 0, anim: 0, home: { x, y, rad: role === 'healer' ? 18 : TS * (town.r - 1) }, wdir: 0, wt: Math.random() * 2, idle: true, moving: false, town, role, name };
}
export const NPC_NAMES = ['Aoife', 'Cian', 'Niamh', 'Ciarán', 'Saoirse', 'Pádraig', 'Orla', 'Fionn', 'Róisín', 'Darragh', 'Clodagh', 'Tadhg', 'Siobhán', 'Eoin', 'Gráinne', 'Oisín'];
export const LINES_CALM = [
  'Fine weather for the road.',
  'Mind the wolves after dark. They come down out of the hills.',
  'Keep to the roads at night. The lamps keep the worst of it off.',
  'The river\'s been good to us this year.',
  'Rest in town if you\'re hurt. Nothing follows you in here.',
  'There are old stairs out in the wilds. Grandmother called them the throats.',
  'Grandmother said the island moves when the Shift dreams. I never felt it. Until lately.',
  'If you go searching houses, leave the ones with a candle in the window. People still live there.',
  'I sleep well. The ground hums me to sleep.',
  'Roads run between every town. Follow them and you won\'t get lost.',
];
export const LINES_UNEASY = [
  'The ground was warm this morning. Warm like a hand.',
  'Our well has started tasting of iron.',
  'Something under the hills keeps time. Lie still at night and you\'ll feel it.',
  'Don\'t go near the old stairs. They breathe out when you stand close.',
  'The roots in my garden came up red.',
  'My dog won\'t stop digging. He\'s frightened of whatever he hears.',
  'You\'ve the look of someone going down. Don\'t.',
  'The fog took the next town over. The soldiers who went in are still in there.',
  'You\'re hunting it, aren\'t you? The Shift. You have the eyes for it.',
];
export const LINES_DEEP = [
  'You smell of it now. Like a butcher\'s floor.',
  'You went down there, didn\'t you? The fields have been twitching since.',
  'The well water came up warm today. And thick.',
  'Whatever you\'re doing down there, it\'s noticed you.',
];
export const LINES_HEALER = [
  'Sit. I\'ll mend what I can.',
  'There. Good as new, near enough.',
  'Whatever\'s under us, it isn\'t a cave. Caves don\'t heal over.',
  'Rest. You\'ll want your strength if you\'re going down.',
];

// ================= flow field (enemy pathing toward the player) =================
const FLR = 20, FLW = FLR * 2 + 1;
export const FLOW = { d: new Int16Array(FLW * FLW), q: new Int32Array(FLW * FLW), ox: 0, oy: 0, t: 0, ptx: -9999, pty: -9999 };
export const DX8 = [1, -1, 0, 0, 1, 1, -1, -1], DY8 = [0, 0, 1, -1, 1, -1, 1, -1];
export function updateFlow(L, P, dt) {
  FLOW.t -= dt;
  const ptx = Math.floor(P.x / TS), pty = Math.floor(P.y / TS);
  if (FLOW.t > 0 && ptx === FLOW.ptx && pty === FLOW.pty) return;
  FLOW.t = 0.3; FLOW.ptx = ptx; FLOW.pty = pty; FLOW.ox = ptx - FLR; FLOW.oy = pty - FLR;
  const d = FLOW.d, q = FLOW.q; d.fill(-1);
  let qh = 0, qt = 0; const c0 = FLR * FLW + FLR; d[c0] = 0; q[qt++] = c0;
  while (qh < qt) {
    const c = q[qh++], lx = c % FLW, ly = (c / FLW) | 0, dc = d[c];
    for (let k = 0; k < 4; k++) {
      const nx = lx + DX4[k], ny = ly + DY4[k]; if (nx < 0 || ny < 0 || nx >= FLW || ny >= FLW) continue;
      const n = ny * FLW + nx; if (d[n] >= 0) continue;
      if (L.blockedFor(nx + FLOW.ox, ny + FLOW.oy, true)) continue;
      d[n] = dc + 1; q[qt++] = n;
    }
  }
}
export function flowDir(e) {
  const L = G.L, tx = Math.floor(e.x / TS), ty = Math.floor(e.y / TS);
  let ddx = tx - FLOW.ptx, ddy = ty - FLOW.pty; if (L.wrap) { ddx -= L.w * Math.round(ddx / L.w); ddy -= L.h * Math.round(ddy / L.h); }
  const lx = ddx + FLR, ly = ddy + FLR;
  if (lx < 0 || ly < 0 || lx >= FLW || ly >= FLW) return null;
  const d0 = FLOW.d[ly * FLW + lx]; if (d0 < 0) return null;
  if (d0 <= 1) return 'direct';
  let best = d0, bx = 0, by = 0;
  for (let k = 0; k < 8; k++) {
    const nx = lx + DX8[k], ny = ly + DY8[k]; if (nx < 0 || ny < 0 || nx >= FLW || ny >= FLW) continue;
    const dn = FLOW.d[ny * FLW + nx]; if (dn < 0 || dn >= best) continue;
    if (k >= 4 && (FLOW.d[ly * FLW + nx] < 0 || FLOW.d[ny * FLW + lx] < 0)) continue;
    best = dn; bx = DX8[k]; by = DY8[k];
  }
  if (best === d0) return null;
  const vx = (tx + bx) * TS + 8 - e.x, vy = (ty + by) * TS + 8 - e.y, l = Math.hypot(vx, vy) || 1; // relative to e's own tile, so wrapping doesn't matter
  return [vx / l, vy / l];
}
