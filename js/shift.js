import { dist, smooth, T, TAU, TP, TS } from './core.js';
import { DIFF } from './difficulty.js';
import { DX8, DY8, moveBody } from './entities.js';
import { computeFog, DX4, DY4, hexDist, isGround } from './gen_overworld.js';
import { sfx } from './audio.js';
import { bctx, BH, burst, BW, G, paintSeen, saveGame, toast } from './game.js';

// ================= the Shift stalks the surface at night =================
export function nightRaw() { const l = 0.5 - 0.5 * Math.cos(G.day * TAU); return 1 - smooth(0.22, 0.5, l); }
export function shiftTick(dt) {
  const L = G.over; if (!L || !L.dungeons || G.prog.won) return;
  const nr = nightRaw();
  if (nr > 0.55) G.wasNight = true;
  if (G.wasNight && nr < 0.3) { G.wasNight = false; dawnFog(L); }
  if (nr <= 0.55) { for (const d of L.dungeons) d.crawling = false; return; }
  G.entT = (G.entT || 0) - dt;
  if (G.entT <= 0) { G.entT = 1; for (const d of L.dungeons) entrance(L, d); }
  if (G.L !== L || G.P.dead || G.fade) return; // the stairs only stalk you while you're out in the open
  const P = G.P, ptx = Math.floor(P.x / TS), pty = Math.floor(P.y / TS), ph = L.hexOf[pty * L.w + ptx];
  if (ph < 0) return; const pH = L.hexes[ph];
  for (const d of L.dungeons) {
    d.crawling = hexDist(L.hexes[d.hex], pH) === 1;
    if (!d.crawling) continue;
    d.moveT = (d.moveT || 0) - dt; if (d.moveT > 0) continue; d.moveT = DIFF.crawl;
    crawlStep(L, d, ptx, pty);
  }
}
function crawlOK(L, x, y, ptx, pty) {
  if (L.wrap) { x = L.wx(x); y = L.wy(y); } else if (!L.inb(x, y)) return false;
  if (x === ptx && y === pty) return false;
  const i = y * L.w + x, h = L.hexOf[i];
  if (h < 0 || L.hexes[h].type !== 'wild' || L.townMap[i]) return false;
  const t = L.t[i];
  if (t === T.DEEP || t === T.DUNGEON || TP[t].wall) return false;
  return !TP[t].solid || t === T.TREE || t === T.PINE; // it wades rivers and flattens trees
}
const CR = 40, CW = CR * 2 + 1, CRAWL_D = new Int16Array(CW * CW), CRAWL_Q = new Int32Array(CW * CW);
function crawlStep(L, d, ptx, pty) {
  // breadth-first search out from the player over tiles the stairs may cross, then step downhill
  const D = CRAWL_D, Q = CRAWL_Q; D.fill(-1);
  const ox = ptx - CR, oy = pty - CR; let qh = 0, qt = 0; D[CR * CW + CR] = 0; Q[qt++] = CR * CW + CR;
  const wd = (v, S) => L.wrap ? v - S * Math.round(v / S) : v;
  const lx0 = wd(d.x - ptx, L.w) + CR, ly0 = wd(d.y - pty, L.h) + CR, inWin = lx0 >= 0 && ly0 >= 0 && lx0 < CW && ly0 < CW;
  while (qh < qt) {
    const c = Q[qh++], lx = c % CW, ly = (c / CW) | 0;
    if (lx === lx0 && ly === ly0) break;
    for (let k = 0; k < 4; k++) {
      const nx = lx + DX4[k], ny = ly + DY4[k]; if (nx < 0 || ny < 0 || nx >= CW || ny >= CW) continue;
      const n = ny * CW + nx; if (D[n] >= 0) continue;
      const gx = nx + ox, gy = ny + oy;
      if (!(nx === lx0 && ny === ly0) && !crawlOK(L, gx, gy, ptx, pty)) continue;
      D[n] = D[c] + 1; Q[qt++] = n;
    }
  }
  let best = null;
  if (inWin && D[ly0 * CW + lx0] > 0) {
    let bd = D[ly0 * CW + lx0];
    for (let k = 0; k < 4; k++) {
      const nx = d.x + DX4[k], ny = d.y + DY4[k], lx = lx0 + DX4[k], ly = ly0 + DY4[k];
      if (lx < 0 || ly < 0 || lx >= CW || ly >= CW) continue;
      const dn = D[ly * CW + lx]; if (dn >= 0 && dn < bd && crawlOK(L, nx, ny, ptx, pty)) { bd = dn; best = [nx, ny]; }
    }
  }
  if (!best) { // no route (you're inside a town): creep as close to the border as it can
    const td = (x, y) => Math.hypot(wd(x - ptx, L.w), wd(y - pty, L.h));
    let bd = td(d.x, d.y);
    for (let k = 0; k < 8; k++) {
      const nx = d.x + DX8[k], ny = d.y + DY8[k]; if (!crawlOK(L, nx, ny, ptx, pty)) continue;
      const dd = td(nx, ny); if (dd < bd - 0.01) { bd = dd; best = [nx, ny]; }
    }
  }
  if (best) moveDungeon(L, d, L.wrap ? L.wx(best[0]) : best[0], L.wrap ? L.wy(best[1]) : best[1], true);
}
export function moveDungeon(L, d, nx, ny, fx) {
  const W = L.w, oi = d.y * W + d.x, ni = ny * W + nx;
  L.t[oi] = (isGround(d.under) || d.under === T.VEINS || d.under === T.TREE || d.under === T.PINE) ? T.VEINS : d.under;
  d.under = L.t[ni]; L.t[ni] = T.DUNGEON; d.x = nx; d.y = ny;
  d.light.x = nx * TS + 8; d.light.y = ny * TS + 8;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const x = nx + dx, y = ny + dy; if (!L.inb(x, y)) continue; const i = y * W + x;
    if ((dx || dy) && isGround(L.t[i]) && Math.random() < 0.35) L.t[i] = T.VEINS;
    if (L.seen[i]) { paintSeen(L, i); L.mapDirty = true; }
  }
  if (L.seen[oi]) paintSeen(L, oi);
  const nh = L.hexOf[ni];
  if (nh !== d.hex) { d.hex = nh; computeFog(L); }
  if (fx && G.L === L) {
    const dp = dist(nx * TS + 8, ny * TS + 8, G.P.x, G.P.y);
    if (dp < TS * 15) {
      sfx('drag'); G.shake = Math.max(G.shake, 0.18 * (1 - dp / (TS * 15)));
      burst(nx * TS + 8, ny * TS + 8, [150, 30, 40], 7, 0.6);
      if (!G.crawlWarned) { G.crawlWarned = true; toast('The stairs are moving', 'At night they crawl toward you. Step into their hex and they stop.', 5); }
    }
  }
}
// towns bordering the stairs lose their people: eyes red, they walk down into the dark
function entrance(L, d) {
  for (const n of L.hexes[d.hex].nb) {
    const h = L.hexes[n]; if (h.type !== 'town') continue;
    const t = L.towns[h.settle]; if (t.fog || t.doomed) continue;
    t.doomed = true; G.prog.doomed[t.idx] = 1;
    for (const e of L.ents) if (e.type === 'npc' && e.town === t) { e.entranced = d; e.idle = false; e.glow = 18; e.glowCol = [255, 30, 40]; }
    for (const hs of t.houses) if (hs.light) hs.light.r = 0;
    if (G.L === L && dist(t.x * TS, t.y * TS, G.P.x, G.P.y) < TS * 30) { toast(t.name, 'Their eyes are glowing red. They are walking out into the dark.', 5); sfx('entrance'); }
    saveGame();
  }
}
export function updEntranced(n, dt, L) {
  const d = n.entranced, tx = d.x * TS + 8, ty = d.y * TS + 8, dx = tx - n.x, dy = ty - n.y, l = Math.hypot(dx, dy) || 1;
  n.anim += dt; n.moving = true;
  if (l < 10) { n.dead = true; burst(n.x, n.y, [200, 30, 40], 10); if (dist(n.x, n.y, G.P.x, G.P.y) < TS * 12) sfx('squelch'); return; }
  let mx = dx / l, my = dy / l;
  if (n.bumpT > 0) { n.bumpT -= dt; mx = Math.cos(n.wdir); my = Math.sin(n.wdir); }
  moveBody(n, mx * 26 * dt, my * 26 * dt, L, false);
  if (n.bumped && !(n.bumpT > 0)) { n.bumpT = 0.7; n.wdir = Math.atan2(my, mx) + (Math.random() < 0.5 ? 1 : -1) * Math.PI / 2; }
  n.dir = Math.abs(mx) > Math.abs(my) ? (mx < 0 ? 2 : 3) : (my < 0 ? 1 : 0);
}
export function drawRedEyes(L, cx, cy) {
  for (const n of L.ents) {
    if (n.type !== 'npc' || !n.entranced || n.dir === 1) continue;
    const x = Math.round(n.x) - cx, y = Math.round(n.y + n.r + 2) - cy - 12;
    if (x < -10 || y < -10 || x > BW + 10 || y > BH + 10) continue;
    const pulse = 0.6 + 0.4 * Math.sin(G.t * 6 + n.x);
    bctx.fillStyle = `rgba(255,40,50,${0.3 * pulse})`; bctx.fillRect(x - 4, y - 2, 9, 5);
    bctx.fillStyle = '#ff1828';
    if (n.dir === 0) { bctx.fillRect(x - 2, y, 2, 1); bctx.fillRect(x + 1, y, 2, 1); }
    else bctx.fillRect(x + (n.dir === 2 ? -4 : 2), y, 2, 1);
  }
}
export function makeFogTown(L, t) {
  t.fog = true; L.hexes[t.hex].fogTown = true;
  for (const e of L.ents) if (e.type === 'npc' && e.town === t) e.dead = true;
  for (const h of t.houses) if (h.light) h.light.r = 0;
  for (let i = 0; i < L.townMap.length; i++) if (L.townMap[i] === t.idx + 1) L.noEnemy[i] = 0;
  if (G.lastTown === t.idx) G.lastTown = -1;
  G.prog.lost[t.idx] = 1;
}
function dawnFog(L) {
  let changed = false;
  for (const t of L.towns) {
    if (!t.doomed || t.fog) continue;
    makeFogTown(L, t); changed = true;
    if (t.seen || (G.L === L && dist(t.x * TS, t.y * TS, G.P.x, G.P.y) < TS * 40)) toast('Fog over ' + t.name, 'It rolled in at dawn. Nobody is left.', 5);
  }
  if (changed) { computeFog(L); saveGame(); }
}
// nearest town that still has people, for waking up after a fall
export function findHaven(L, x, y) {
  let best = null, bd = 1e18;
  for (const t of L.towns) { if (t.fog || t.doomed || t.kind === 'hamlet') continue; const d = dist(t.x, t.y, x, y); if (d < bd) { bd = d; best = t; } }
  return best || L.towns[L.spawnTown];
}
