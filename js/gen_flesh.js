import { clamp, dist, Level, mulberry32, pick, T, TAU, TS } from './core.js';
import { DIFF, floorsN } from './difficulty.js';
import { SPR, SPRC, SPRW } from './art.js';
import { makeEnemy, moveBody } from './entities.js';
import { DX4, DY4 } from './gen_overworld.js';
import { drawEyes, getLevel, mazeOver, reachDepth, stageInfo } from './gen_maze.js';
import { fleshNudges, showFleshGuide } from './guide.js';
import { sfx } from './audio.js';
import { giveFile } from './weapons.js';
import {
  bctx, beatEnv, BH, burst, BW, ctx, drawShadow, drawSpr, enterLevel, G, hurtPlayer, makeCorpse,
  saveGame, SH, SW, toast, transition, txt, UI
} from './game.js';

// ================= the flesh (level 3): inside the living world =================
export function genFlesh(seed) {
  const R = mulberry32(seed >>> 0), S = 92, N = S * S;
  let g = null, open = 0;
  for (let attempt = 0; attempt < 8; attempt++) {
    g = new Uint8Array(N);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) g[y * S + x] = (x < 2 || y < 2 || x >= S - 2 || y >= S - 2) ? 1 : (R() < 0.46 ? 1 : 0);
    for (let it = 0; it < 5; it++) {
      const g2 = new Uint8Array(N);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        if (x < 2 || y < 2 || x >= S - 2 || y >= S - 2) { g2[y * S + x] = 1; continue; }
        let c = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) c += g[(y + dy) * S + x + dx];
        g2[y * S + x] = c >= 5 ? 1 : 0;
      }
      g = g2;
    }
    // keep only the largest connected cavity
    const lab = new Int32Array(N).fill(-1); let best = -1, bestN = 0, id = 0; const q = new Int32Array(N);
    for (let i = 0; i < N; i++) {
      if (g[i] || lab[i] >= 0) continue;
      let qh = 0, qt = 0; q[qt++] = i; lab[i] = id;
      while (qh < qt) { const c = q[qh++], x = c % S, y = (c / S) | 0; for (let k = 0; k < 4; k++) { const n = (y + DY4[k]) * S + x + DX4[k]; if (!g[n] && lab[n] < 0) { lab[n] = id; q[qt++] = n; } } }
      if (qt > bestN) { bestN = qt; best = id; } id++;
    }
    for (let i = 0; i < N; i++) if (!g[i] && lab[i] !== best) g[i] = 1;
    open = bestN; if (open > N * 0.36) break;
  }
  const L = new Level('flesh', S, S); L.edge = T.FWALL; L.key = 'flesh'; L.alive = 1; L.name = 'Inside the Shift'; L.lightR = 96; L.revealR = 6;
  const carve = (cx, cy, r) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const x = cx + dx, y = cy + dy; if (x > 2 && y > 2 && x < S - 3 && y < S - 3 && dx * dx + dy * dy <= r * r + 1) g[y * S + x] = 0; } };
  // entrance near the bottom-left, heart at the far end of the body
  let ent = -1, eb = 1e9;
  for (let i = 0; i < N; i++) if (!g[i]) { const x = i % S, y = (i / S) | 0, v = x + (S - y); if (v < eb) { eb = v; ent = i; } }
  const ex = ent % S, ey = (ent / S) | 0; carve(ex, ey, 2);
  const bfs = (src) => {
    const D = new Int32Array(N).fill(-1), q = new Int32Array(N); let qh = 0, qt = 0; D[src] = 0; q[qt++] = src;
    while (qh < qt) { const c = q[qh++], x = c % S, y = (c / S) | 0; for (let k = 0; k < 4; k++) { const n = (y + DY4[k]) * S + x + DX4[k]; if (!g[n] && D[n] < 0) { D[n] = D[c] + 1; q[qt++] = n; } } }
    return D;
  };
  let D = bfs(ent), hi = ent;
  for (let i = 0; i < N; i++) if (D[i] > D[hi]) hi = i;
  const hx = clamp(hi % S, 10, S - 11), hy = clamp((hi / S) | 0, 10, S - 11);
  carve(hx, hy, 8);
  D = bfs(ent);
  // four ganglia spread far apart (farthest-point sampling over reachable cells)
  const maxD = Math.max(...D);
  const cand = []; for (let i = 0; i < N; i++) if (D[i] > maxD * 0.25) cand.push(i);
  const placed = [[ex, ey], [hx, hy]], gang = [];
  for (let k = 0; k < 4; k++) {
    let bi = -1, bd = -1;
    for (let s = 0; s < 500; s++) {
      const i = cand[Math.floor(R() * cand.length)], x = i % S, y = (i / S) | 0;
      if (x < 6 || y < 6 || x > S - 7 || y > S - 7) continue;
      const m = Math.min(...placed.map(p => Math.hypot(p[0] - x, p[1] - y)));
      if (m > bd) { bd = m; bi = i; }
    }
    const gx = bi % S, gy = (bi / S) | 0; carve(gx, gy, 3); placed.push([gx, gy]); gang.push([gx, gy]);
  }
  // paint tiles
  for (let i = 0; i < N; i++) L.t[i] = g[i] ? T.FWALL : T.FFLOOR;
  const isOpen = (x, y) => L.inb(x, y) && !g[y * S + x];
  const veinWalk = (x, y, n, a) => {
    for (let s = 0; s < n; s++) {
      if (isOpen(x, y) && L.get(x, y) === T.FFLOOR) L.set(x, y, T.FVEIN);
      a += (R() - 0.5) * 0.9; const nx = Math.round(x + Math.cos(a)), ny = Math.round(y + Math.sin(a));
      if (!isOpen(nx, ny)) { a += Math.PI * (0.5 + R()); continue; } x = nx; y = ny;
    }
  };
  for (let k = 0; k < 10; k++) veinWalk(hx, hy, 34, k / 10 * TAU);
  for (let k = 0; k < 26; k++) { const i = cand[Math.floor(R() * cand.length)]; veinWalk(i % S, (i / S) | 0, 14, R() * TAU); }
  // bile pools only in wide-open spots so they never block a passage
  let pools = 0;
  for (let s = 0; s < 400 && pools < 8; s++) {
    const i = cand[Math.floor(R() * cand.length)], x = i % S, y = (i / S) | 0;
    if (placed.some(p => Math.hypot(p[0] - x, p[1] - y) < 9)) continue;
    let ok = true; for (let dy = -3; dy <= 3 && ok; dy++) for (let dx = -3; dx <= 3; dx++) if (!isOpen(x + dx, y + dy)) { ok = false; break; }
    if (!ok) continue;
    const r = 1 + R() * 1.2; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (dx * dx + dy * dy <= r * r + 0.5) L.set(x + dx, y + dy, T.FBILE);
    pools++;
  }
  L.eyes = [];
  for (let y = 1; y < S - 1; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x; if (L.t[i] !== T.FWALL || !isOpen(x, y + 1)) continue;
    const r = R(); if (r < 0.035) { L.t[i] = T.FEYE; L.eyes.push({ x, y, h: R(), big: true }); } else if (r < 0.14) L.t[i] = T.FTEETH;
  }
  L.set(ex, ey, T.FMOUTH);
  L.randomizeVariants(seed + 5);
  L.start = { x: ex * TS + 8, y: (ey + 1) * TS + 8 };
  if (!isOpen(ex, ey + 1)) L.start = { x: (ex + 1) * TS + 8, y: ey * TS + 8 };
  L.lights.push({ x: ex * TS + 8, y: ey * TS + 8, r: 44, col: [255, 200, 200] });
  L.noEnemy = new Uint8Array(N);
  for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) if (L.inb(ex + dx, ey + dy)) L.noEnemy[(ey + dy) * S + ex + dx] = 1;
  L.floors = []; for (let i = 0; i < N; i++) if (L.t[i] === T.FFLOOR || L.t[i] === T.FVEIN) L.floors.push(i);
  L.immune = { level: 0, at: 0, warned: false };
  L.spT = 4; L.bpm = 70;
  // ganglia and the heart
  L.ganglia = gang.map(([x, y], idx) => makeGanglion(idx, x * TS + 8, y * TS + 8));
  for (const gn of L.ganglia) if (!G.prog.ganglia[gn.idx] && gn.idx < DIFF.nerves) L.ents.push(gn); else gn.dead = true;
  L.immune.level = L.ganglia.filter(x => G.prog.ganglia[x.idx]).length;
  L.ganglia.slice(0, 3).forEach((gn, k) => {
    for (const [ox, oy] of [[-30, 22], [30, 22], [-30, -20], [30, -20], [0, 32]]) {
      if (L.blockedFor(Math.floor((gn.x + ox) / TS), Math.floor((gn.y + oy) / TS), true)) continue;
      const c = makeCorpse(gn.x + ox, gn.y + oy); c.key = 'f' + k; c.pool = 'flesh'; L.ents.push(c); break;
    }
  });
  L.heart = makeHeart(hx * TS + 8, hy * TS + 8);
  if (!G.prog.won) L.ents.push(L.heart); else L.heart.dead = true;
  // fauna
  if (!G.prog.won) {
    const far = L.floors.filter(i => D[i] > 16 && Math.hypot((i % S) - hx, ((i / S) | 0) - hy) > 9);
    const add = (kind, n, mul) => { for (let k = 0; k < n && far.length; k++) { const i = far[Math.floor(R() * far.length)]; L.ents.push(makeEnemy(kind, (i % S) * TS + 8, ((i / S) | 0) * TS + 8, mul)); } };
    add('worm', 10, 1.6); add('mite', 8, 1.6); add('antibody', 3, 1.4);
    const wide = far.filter(i => { const x = i % S, y = (i / S) | 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!isOpen(x + dx, y + dy)) return false; return true; });
    for (let k = 0; k < 8 && wide.length; k++) { const i = wide[Math.floor(R() * wide.length)]; L.ents.push(makeEnemy('polyp', (i % S) * TS + 8, ((i / S) | 0) * TS + 8, 1.6)); }
    for (const gn of L.ganglia) if (!gn.dead) spawnNear(L, 'polyp', gn.x + 36, gn.y + 8, 1.6);
  }
  L.baseCount = Math.round(22 * DIFF.spawn);
  L.tick = fleshNudges; L.spawner = fleshSpawner; L.goUp = fleshUp; L.audio = fleshAudio;
  L.drawUnder = drawEyes; L.drawOver = fleshOver; L.markers = fleshMarkers; L.hud = fleshHud;
  return L;
}
export function gangliaLeft(L) { return L.ganglia.filter(g => !g.dead).length; }
function pushOut(P, e, L) {
  const dx = P.x - e.x, dy = P.y - e.y, d = Math.hypot(dx, dy) || 1, m = e.r + P.r;
  if (d < m) moveBody(P, dx / d * (m - d), dy / d * (m - d), L, false);
  return d < m;
}
function makeGanglion(idx, x, y) {
  return {
    type: 'ganglion', idx, hittable: true, heavy: true, x, y, r: 9, hp: 8, hurt: 0, col: [224, 200, 124], glow: 80, glowCol: [190, 110, 255],
    update(e, dt, L, P) { e.hurt = Math.max(0, e.hurt - dt); pushOut(P, e, L); },
    draw(e, cx, cy) { drawShadow(e.x, e.y + 9, 16, cx, cy); drawSpr('ganglion' + (beatEnv() > 0.5 ? 1 : 0), e.x, e.y + 14, e.hurt > 0, cx, cy); },
    onHit(e) { if (Math.random() < 0.35) G.L.ents.push(makeEnemy('mite', e.x + (Math.random() - 0.5) * 20, e.y + 14, 1.6)); },
    onDeath(e) {
      const L = G.L; G.prog.ganglia[e.idx] = 1; L.immune.level++; const left = gangliaLeft(L);
      sfx('roar'); G.shake = 0.9; burst(e.x, e.y, [210, 150, 255], 30, 2);
      fleshAlarm(L, e.x, e.y);
      if (left) toast('A nerve is severed', `${left} remain. The whole body shudders.`); else toast('The heart is exposed', 'Its shield is gone. Go to it.', 4.5);
      saveGame();
    },
  };
}
function makeHeart(x, y) {
  const max = Math.round(40 * DIFF.boss * (1 + 0.5 * (G.ngp || 0)));
  return {
    type: 'boss', hittable: true, heavy: true, x, y, r: 20, hp: max, max, hurt: 0, col: [200, 30, 50], glow: 120, glowCol: [255, 40, 60], prevBeat: 0, beats: 0, spin: 0, warnT: 0,
    update(h, dt, L, P) {
      h.hurt = Math.max(0, h.hurt - dt); h.warnT = Math.max(0, h.warnT - dt);
      h.shielded = gangliaLeft(L) > 0;
      const frac = h.hp / h.max; L.bpm = 66 + (1 - frac) * 60 + (h.shielded ? 0 : 8);
      if (pushOut(P, h, L)) hurtPlayer(2, h.x, h.y);
      const beat = G.beat < h.prevBeat; h.prevBeat = G.beat;
      if (!beat || P.dead || G.fade) return;
      h.beats++;
      const d = dist(h.x, h.y, P.x, P.y); if (d > TS * 15) return;
      if (h.shielded) { if (h.beats % 3 === 0) heartRing(h, L, 8, 60); return; }
      if (frac > 0.66) { if (h.beats % 2 === 0) heartRing(h, L, 10, 70); }
      else if (frac > 0.33) { heartRing(h, L, 12, 76); if (h.beats % 3 === 0) spawnNear(L, 'antibody', h.x, h.y + h.r + 10, 1.2); }
      else { h.spin += 0.35; heartRing(h, L, 7, 88); if (h.beats % 2 === 0) spawnNear(L, 'mite', h.x, h.y + h.r + 10, 1.6); }
    },
    draw(h, cx, cy) {
      const env = beatEnv(), sc = 1 + 0.07 * env, s = SPR[env > 0.45 ? 'boss1' : 'boss0'];
      const w = s.w * sc, hh = s.h * sc;
      bctx.drawImage(h.hurt > 0 ? SPRW : SPRC, s.x, s.y, s.w, s.h, Math.round(h.x - w / 2 - cx), Math.round(h.y - hh / 2 - cy - 4), Math.round(w), Math.round(hh));
      if (h.shielded) {
        const r = h.r + 10 + env * 2, sx = h.x - cx, sy = h.y - cy - 2;
        bctx.fillStyle = `rgba(170,110,230,${0.14 + 0.12 * env})`; bctx.beginPath(); bctx.arc(sx, sy, r, 0, TAU); bctx.fill();
        bctx.strokeStyle = `rgba(220,170,255,${0.55 + 0.3 * env})`; bctx.lineWidth = 1;
        bctx.beginPath(); bctx.arc(sx, sy, r, 0, TAU); bctx.stroke();
        for (let k = 0; k < 4; k++) { const a = k * 1.7 + G.t * 0.2; bctx.beginPath(); bctx.arc(sx, sy, r - 3 - k * 2, a, a + 1.2); bctx.stroke(); }
      }
    },
    onShield(h) {
      if (h.warnT <= 0) { h.warnT = 4; toast('The membrane holds', `${gangliaLeft(G.L)} nerves still feed it. Find them on your map.`); }
    },
    onDeath: heartDies,
  };
}
function heartRing(h, L, n, spd) {
  sfx('spit');
  for (let k = 0; k < n; k++) {
    const a = k / n * TAU + h.spin + (h.beats % 2) * (Math.PI / n);
    L.ents.push({ type: 'proj', x: h.x + Math.cos(a) * (h.r + 4), y: h.y + Math.sin(a) * (h.r + 4), vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, r: 2.5, dmg: 1, life: 4, spr: 'spore' });
  }
}
function spawnNear(L, kind, x, y, mul) { if (!L.blockedFor(Math.floor(x / TS), Math.floor(y / TS), true)) L.ents.push(makeEnemy(kind, x, y, mul)); }
export function fleshAlarm(L, x, y) {
  const im = L.immune; if (!im || G.prog.won) return;
  im.at = 8;
  if (!im.warned) { im.warned = true; toast('The Shift has noticed you', 'White cells are coming. Keep moving.'); }
}
function fleshSpawner(L, dt) {
  const im = L.immune; im.at = Math.max(0, im.at - dt);
  L.spT -= dt; if (L.spT > 0 || G.prog.won) return;
  const P = G.P, lvl = im.level, ngp = G.ngp || 0;
  L.spT = im.at > 0 ? Math.max(1.1, 3 - lvl * 0.45) : 6;
  let ab = 0, other = 0; for (const e of L.ents) if (e.type === 'enemy') { if (e.kind === 'antibody') ab++; else other++; }
  const cap = Math.round(((im.at > 0 ? 5 : 2) + lvl * 2 + ngp) * DIFF.spawn);
  const kind = ab < cap ? 'antibody' : (other < 14 ? pick(Math.random, ['worm', 'mite']) : null);
  if (!kind) return;
  for (let tries = 0; tries < 14; tries++) {
    const i = L.floors[Math.floor(Math.random() * L.floors.length)], x = (i % L.w) * TS + 8, y = ((i / L.w) | 0) * TS + 8, d = dist(x, y, P.x, P.y);
    if (d < TS * 9 || d > TS * 18 || L.noEnemy[i]) continue;
    if (Math.abs(x - P.x) < BW / 2 + 8 && Math.abs(y - P.y) < BH / 2 + 8) continue;
    L.ents.push(makeEnemy(kind, x, y, 1.4 + lvl * 0.15)); break;
  }
}
function fleshAudio(L, P) {
  if (G.prog.won) return { wind: 0.012, windF: 160, drone: 0, droneF: 30, bpm: 40, beatVol: 0 };
  const h = L.heart, near = h && !h.dead ? 1 - clamp(dist(h.x, h.y, P.x, P.y) / (TS * 40), 0, 1) : 0;
  return { wind: 0.035, windF: 200, drone: 0.1 + 0.06 * near, droneF: 38, bpm: L.bpm, beatVol: 0.3 + 0.45 * near };
}
function fleshMarkers(L, proj, sz, labels) {
  const pulse = 0.6 + 0.4 * beatEnv();
  for (const gn of L.ganglia) if (!gn.dead) { const [x, y] = proj(gn.x / TS, gn.y / TS); ctx.fillStyle = `rgba(200,130,255,${pulse})`; ctx.beginPath(); ctx.arc(x, y, sz + 1, 0, TAU); ctx.fill(); }
  const h = L.heart; if (h && !h.dead) { const [x, y] = proj(h.x / TS, h.y / TS); ctx.fillStyle = `rgba(255,40,60,${pulse})`; ctx.beginPath(); ctx.arc(x, y, sz + 3, 0, TAU); ctx.fill(); if (labels) txt('the heart', x, y + sz + 6, 12 * UI.s, '#ff8090', 'center'); }
}
function fleshOver(L, cx, cy) {
  mazeOver(L, cx, cy);
  drawCords(L, cx, cy);
  const env = beatEnv();
  const g = bctx.createRadialGradient(BW / 2, BH / 2, Math.min(BW, BH) * 0.25, BW / 2, BH / 2, Math.max(BW, BH) * 0.7);
  g.addColorStop(0, 'rgba(120,0,20,0)'); g.addColorStop(1, `rgba(140,0,24,${G.prog.won ? 0 : 0.18 + 0.35 * env})`);
  bctx.fillStyle = g; bctx.fillRect(0, 0, BW, BH);
  if (L.immune.at > 0 && !G.prog.won) { bctx.fillStyle = `rgba(255,255,255,${0.04 * (0.5 + 0.5 * Math.sin(G.t * 8))})`; bctx.fillRect(0, 0, BW, BH); }
  if (G.prog.won) {
    const k = clamp((G.stillT || 0) / 4, 0, 0.85);
    bctx.globalCompositeOperation = 'saturation'; bctx.fillStyle = `rgba(128,128,128,${k})`; bctx.fillRect(0, 0, BW, BH);
    bctx.globalCompositeOperation = 'source-over';
  }
}
// purple cords run from the heart's membrane out to every living nerve, with pulses flowing in on the beat
function drawCords(L, cx, cy) {
  const h = L.heart; if (!h || h.dead || G.prog.won) return;
  const env = beatEnv();
  for (const g of L.ganglia) {
    if (g.dead) continue;
    const dx = h.x - g.x, dy = h.y - g.y, len = Math.hypot(dx, dy), nx = dx / len, ny = dy / len;
    const flow = (G.t * 40) % 24;
    for (let d = 12; d < len - h.r - 8; d += 4) {
      const x = Math.round(g.x + nx * d - cx), y = Math.round(g.y + ny * d - cy);
      if (x < -2 || y < -2 || x > BW + 2 || y > BH + 2) continue;
      const pulse = Math.abs(((d - flow) % 24 + 24) % 24 - 12) < 3;
      bctx.fillStyle = pulse ? `rgba(230,180,255,${0.7 + 0.3 * env})` : `rgba(170,100,230,${0.35 + 0.2 * env})`;
      bctx.fillRect(x, y, pulse ? 2 : 1, pulse ? 2 : 1);
    }
  }
}
function fleshHud(L) {
  const h = L.heart, P = G.P; if (!h || h.dead || dist(h.x, h.y, P.x, P.y) > TS * 16) return;
  const s = UI.s, w = Math.min(SW * 0.62, 380), x = (SW - w) / 2, y = SH - (SW > SH * 1.2 ? 40 : 250) * s;
  ctx.fillStyle = 'rgba(10,4,6,0.8)'; ctx.fillRect(x - 3, y - 3, w + 6, 16 * s + 6);
  ctx.fillStyle = '#3a0c14'; ctx.fillRect(x, y, w, 16 * s);
  ctx.fillStyle = h.shielded ? '#9a6cd0' : '#d8203c'; ctx.fillRect(x, y, w * h.hp / h.max, 16 * s);
  const n = gangliaLeft(L);
  txt(h.shielded ? `Shielded: cut ${n} more ${n === 1 ? 'nerve' : 'nerves'} first` : 'Heart of the Shift: shoot it now', SW / 2, y - 20 * s, 13 * s, h.shielded ? '#e0c0ff' : '#ffd0d4', 'center');
}
function heartDies(h) {
  const L = G.L; G.prog.won = true; G.stillT = 0; G.endT = 6;
  sfx('roar'); G.shake = 1.6; burst(h.x, h.y, [210, 30, 50], 70, 2.6);
  for (const e of L.ents) if (e.type === 'enemy' || e.type === 'proj') { e.dead = true; burst(e.x, e.y, [200, 40, 60], 6); }
  toast('The Shift\'s heart stops', 'Listen.', 5); giveFile('end');
  saveGame();
}
export function enterFlesh(from) {
  G.fleshFrom = from.eid;
  transition('Inside the Shift', 'You are inside it now. Everything here is alive.', () => {
    const F = getLevel('flesh'); enterLevel(F, F.start.x, F.start.y); reachDepth(floorsN() + 1);
    if (!F.introduced && !G.prog.won) { F.introduced = true; setTimeout(showFleshGuide, 900); }
  }, 2.4);
}
function fleshUp(L) {
  sfx('ascend');
  const eid = G.fleshFrom ?? (G.dungeon ? G.dungeon.id : 0);
  const fl = floorsN(); transition(stageInfo(fl).title, 'Back into the stone. It flinches as you pass.', () => { const M = getLevel(`m${eid}-${fl}`); enterLevel(M, M.downAt.x, M.downAt.y); });
}
