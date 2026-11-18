import { dist, T, TP, TS } from './core.js';
import { DX8, DY8 } from './entities.js';
import {
  DX4, DY4, fixCount, genOverworld, hexDist, isGround, nearestTile, wdistT
} from './gen_overworld.js';
import { auResume } from './audio.js';
import { $, freshProg, G, newGame, setupOverworld } from './game.js';
import { descentProblems } from './gen_maze.js';

// ================= world checks: do the biomes and the towns match up? =================
// Each check returns { count, examples: [{ msg, x, y }] }. A world passes a check when count is 0.
export const WATER_T = t => t === T.DEEP || t === T.SHALLOW || t === T.RIVER;
const BUILDING_T = t => t === T.ROOF || t === T.WALL || t === T.DOOR || t === T.CWALL || t === T.CDOOR;
const ROADLIKE_T = t => t === T.ROAD || t === T.BRIDGE_H || t === T.BRIDGE_V || t === T.COBBLE;
function wcResult() { const r = { count: 0, examples: [] }; r.add = (msg, x, y) => { r.count++; if (r.examples.length < 5) r.examples.push({ msg, x, y }); }; return r; }
// walkable flood fill from the spawn point (cached per world)
function wcReach(L) {
  if (L._reach) return L._reach;
  const W = L.w, N = W * L.h, R = new Uint8Array(N), q = new Int32Array(N);
  const s = Math.floor(L.spawn.y / TS) * W + Math.floor(L.spawn.x / TS); let qh = 0, qt = 0;
  if (!TP[L.t[s]].solid) { R[s] = 1; q[qt++] = s; }
  while (qh < qt) { const c = q[qh++], x = c % W, y = (c / W) | 0;
    for (let k = 0; k < 4; k++) { const n = L.idx(x + DX4[k], y + DY4[k]); if (R[n] || TP[L.t[n]].solid) continue; R[n] = 1; q[qt++] = n; } }
  return (L._reach = R);
}
// distance (in tiles, capped) to the nearest water tile
export function wcWaterDist(L, cap) {
  const W = L.w, N = W * L.h, D = new Uint8Array(N).fill(255), q = new Int32Array(N); let qh = 0, qt = 0;
  for (let i = 0; i < N; i++) if (WATER_T(L.t[i]) || L.t[i] === T.BRIDGE_H || L.t[i] === T.BRIDGE_V) { D[i] = 0; q[qt++] = i; }
  while (qh < qt) { const c = q[qh++], d = D[c]; if (d >= cap) continue; const x = c % W, y = (c / W) | 0;
    for (let k = 0; k < 4; k++) { const n = L.idx(x + DX4[k], y + DY4[k]); if (D[n] > d + 1) { D[n] = d + 1; q[qt++] = n; } } }
  return D;
}
function townTiles(L, t) { const out = []; for (let i = 0; i < L.townMap.length; i++) if (L.townMap[i] === t.idx + 1) out.push(i); return out; }
function houseTiles(h) { const out = []; for (let y = h.y; y < h.y + h.h; y++) for (let x = h.x; x < h.x + h.w; x++) out.push([x, y]); return out; }

const WORLD_CHECKS = [
  // ---------------- towns on sensible land ----------------
  { group: 'Towns on sensible land', id: 'town-centre', name: 'Every town centre stands on dry, open ground', run(L) {
    const r = wcResult();
    for (const t of L.towns) { const ok = nearestTile(L, t.x, t.y + 1, 1, (x, y) => !TP[L.get(x, y)].solid && !WATER_T(L.get(x, y))); if (!ok) r.add(`${t.name} centre is blocked or wet`, t.x, t.y); }
    return r; } },
  { group: 'Towns on sensible land', id: 'door-front', name: 'Every front door opens onto dry ground', run(L) {
    const r = wcResult();
    for (const t of L.towns) for (const h of t.houses) { const tt = L.get(h.door[0], h.door[1]); if (TP[tt].solid || WATER_T(tt)) r.add(`House door in ${t.name} opens onto ${TP[tt].solid ? 'a wall' : 'water'}`, h.door[0], h.door[1]); }
    return r; } },
  { group: 'Towns on sensible land', id: 'house-in-hex', name: 'Houses sit fully inside their own hex', run(L) {
    const r = wcResult();
    for (const t of L.towns) for (const h of t.houses) if (houseTiles(h).some(([x, y]) => L.hexOf[y * L.w + x] !== t.hex)) r.add(`A house in ${t.name} crosses its hex border`, h.x, h.y);
    return r; } },
  { group: 'Towns on sensible land', id: 'house-intact', name: 'Houses are whole: nothing paved or built over them', run(L) {
    const r = wcResult(); const seen = new Set();
    for (const t of L.towns) for (const h of t.houses) for (const [x, y] of houseTiles(h)) {
      const k = x + ',' + y; if (seen.has(k)) { r.add(`Two houses overlap in ${t.name}`, x, y); break; } seen.add(k);
      if (!BUILDING_T(L.get(x, y))) { r.add(`A house in ${t.name} has a missing piece`, x, y); break; }
    }
    return r; } },
  { group: 'Towns on sensible land', id: 'town-access', name: 'Every town opens north, south, east and west (water sides are fine)', run(L) {
    const r = wcResult();
    for (const t of L.towns) for (const d of townAccess(L, t)) r.add(`${t.name} is walled in to the ${d.name}`, t.x, t.y);
    return r; } },
  { group: 'Towns on sensible land', id: 'not-in-swamp', name: 'Towns are not sunk in swamp or half under water', run(L) {
    const r = wcResult();
    for (const t of L.towns) { const tl = townTiles(L, t); let sw = 0, wet = 0; for (const i of tl) { if (L.t[i] === T.SWAMP) sw++; else if (L.t[i] === T.SHALLOW || L.t[i] === T.DEEP) wet++; }
      if (sw / tl.length > 0.05) r.add(`${t.name} is ${Math.round(sw / tl.length * 100)}% swamp`, t.x, t.y);
      else if (wet / tl.length > 0.35) r.add(`${t.name} is ${Math.round(wet / tl.length * 100)}% under water`, t.x, t.y); }
    return r; } },
  { group: 'Towns on sensible land', id: 'well-plaza', name: 'Villages and cities have their square and well', run(L) {
    const r = wcResult();
    for (const t of L.towns) { if (t.kind === 'hamlet') continue; let wells = 0; for (let dy = -3; dy <= 6; dy++) for (let dx = -3; dx <= 6; dx++) if (L.get(t.x + dx, t.y + dy) === T.WELL) wells++; if (!wells) r.add(`${t.name} has no well`, t.x, t.y); }
    return r; } },
  { group: 'Biomes make sense', id: 'wrap-seam', name: 'The world wraps without a seam at the edges', run(L) {
    const r = wcResult(), W = L.w, H = L.h, E = L.el; if (!E) return r;
    let seamX = 0, inX = 0, seamY = 0, inY = 0;
    for (let y = 0; y < H; y++) { seamX += Math.abs(E[y * W] - E[y * W + W - 1]); inX += Math.abs(E[y * W + (W >> 1)] - E[y * W + (W >> 1) - 1]); }
    for (let x = 0; x < W; x++) { seamY += Math.abs(E[x] - E[(H - 1) * W + x]); inY += Math.abs(E[(H >> 1) * W + x] - E[((H >> 1) - 1) * W + x]); }
    if (seamX > inX * 2.5 + 1e-6) r.add(`East-west edge jumps ${(seamX / inX).toFixed(1)}x more than the interior`, 0, H >> 1);
    if (seamY > inY * 2.5 + 1e-6) r.add(`North-south edge jumps ${(seamY / inY).toFixed(1)}x more than the interior`, W >> 1, 0);
    return r; } },
  // ---------------- hex rules ----------------
  { group: 'Hex rules', id: 'split', name: 'Land is about 70% wild, 25% towns, 3% cities', run(L) {
    const r = wcResult(), s = L.hexStats, w = s.wild / s.land, tw = s.town / s.land, c = s.city / s.land;
    if (w < 0.64 || w > 0.76) r.add(`Wilderness is ${Math.round(w * 100)}%`, 0, 0);
    if (tw < 0.19 || tw > 0.31) r.add(`Towns are ${Math.round(tw * 100)}%`, 0, 0);
    if (c < 0.015 || c > 0.045) r.add(`Cities are ${(c * 100).toFixed(1)}%`, 0, 0);
    return r; } },
  { group: 'Hex rules', id: 'city-ring', name: 'Cities only border towns (or sea)', run(L) {
    const r = wcResult();
    for (const h of L.hexes) if (h.type === 'city') for (const n of h.nb) { const t = L.hexes[n].type; if (t !== 'town' && t !== 'sea') r.add(`City borders ${t}`, h.cx, h.cy); }
    return r; } },
  { group: 'Hex rules', id: 'one-per-hex', name: 'Every town and city hex holds exactly one settlement', run(L) {
    const r = wcResult(), byHex = new Map();
    for (const t of L.towns) byHex.set(t.hex, (byHex.get(t.hex) || 0) + 1);
    for (const h of L.hexes) { const n = byHex.get(h.id) || 0, want = (h.type === 'town' || h.type === 'city') ? 1 : 0; if (n !== want) r.add(`${h.type} hex has ${n} settlements`, h.cx, h.cy); }
    return r; } },
  { group: 'Hex rules', id: 'stairs-wild', name: 'Stairs start in wilderness with 4+ wild neighbours', run(L) {
    const r = wcResult();
    for (const d of L.dungeons) { const h = L.hexes[d.hex0 ?? d.hex], w = h.nb.filter(n => L.hexes[n].type === 'wild').length; if (h.type !== 'wild' || w < 4) r.add(`Stairs in a ${h.type} hex with ${w} wild neighbours`, d.x, d.y); }
    return r; } },
  { group: 'Hex rules', id: 'stairs-spread', name: 'Six sets of stairs, at least 4 hexes apart', run(L) {
    const r = wcResult(), ds = L.dungeons;
    if (ds.length < 6) r.add(`Only ${ds.length} sets of stairs`, 0, 0);
    for (let a = 0; a < ds.length; a++) for (let b = a + 1; b < ds.length; b++) if (hexDist(L.hexes[ds[a].hex], L.hexes[ds[b].hex]) < 4) r.add('Two sets of stairs are too close', ds[b].x, ds[b].y);
    return r; } },
  { group: 'Hex rules', id: 'fog-rule', name: 'Fog towns are exactly the towns next to stairs (except the first-night town)', run(L) {
    const r = wcResult(), shouldFog = new Set();
    for (const d of L.dungeons) for (const n of L.hexes[d.hex].nb) if (L.hexes[n].type === 'town' && L.hexes[n].settle !== L.fallTown) shouldFog.add(L.hexes[n].settle);
    for (const t of L.towns) { const want = shouldFog.has(t.idx); if (!!t.fog !== want) r.add(`${t.name} ${t.fog ? 'is foggy but no stairs are near' : 'borders stairs but has no fog'}`, t.x, t.y); }
    return r; } },
  { group: 'Hex rules', id: 'spawn-safe', name: 'You start in a living village away from the stairs', run(L) {
    const r = wcResult(), t = L.towns[L.spawnTown];
    if (t.kind !== 'village') r.add(`Start town is a ${t.kind}`, t.x, t.y);
    if (t.fog) r.add('Start town is quarantined', t.x, t.y);
    for (const d of L.dungeons) if (hexDist(L.hexes[d.hex], L.hexes[t.hex]) < 2) r.add('Stairs right next to the start town', d.x, d.y);
    return r; } },
  { group: 'Hex rules', id: 'first-night', name: 'A living village near the start borders the first stairs (it falls on night one)', run(L) {
    const r = wcResult(), sp = L.towns[L.spawnTown], t = L.towns[L.fallTown];
    if (!t) { r.add('No first-night town', sp.x, sp.y); return r; }
    if (t === sp) r.add('The first-night town is the start town', t.x, t.y);
    if (t.fog) r.add(`${t.name} starts in fog`, t.x, t.y);
    if (t.kind !== 'village') r.add(`${t.name} is a ${t.kind}, not a village`, t.x, t.y);
    const th = L.hexes[t.hex];
    if (hexDist(th, L.hexes[sp.hex]) > 2) r.add(`${t.name} is more than 2 hexes from the start`, t.x, t.y);
    if (!L.dungeons.some(d => hexDist(L.hexes[d.hex], th) === 1)) r.add(`${t.name} doesn't border any stairs`, t.x, t.y);
    if (!L.ents.some(e => e.type === 'npc' && e.town === t)) r.add(`Nobody lives in ${t.name}`, t.x, t.y);
    return r; } },
  // ---------------- the descent ----------------
  { group: 'The descent', id: 'descent', name: 'Every floor below the first stairs can be walked, even while the breach walls move', run(L) {
    const r = wcResult(), sp = L.towns[L.spawnTown];
    for (const msg of descentProblems(G.seed)) r.add(msg, sp.x, sp.y);
    return r; } },
  // ---------------- biomes make sense ----------------
  { group: 'Biomes make sense', id: 'snow-high', name: 'Snow never touches beach, swamp or water', run(L) {
    const r = wcResult(), W = L.w;
    for (let i = 0; i < L.t.length; i++) { if (L.t[i] !== T.SNOW) continue; const x = i % W, y = (i / W) | 0;
      for (let k = 0; k < 4; k++) { const t = L.get(x + DX4[k], y + DY4[k]); if (t === T.SAND || t === T.SWAMP || WATER_T(t)) { r.add('Snow next to ' + (t === T.SAND ? 'beach' : t === T.SWAMP ? 'swamp' : 'water'), x, y); break; } } }
    return r; } },
  { group: 'Biomes make sense', id: 'beach-water', name: 'Beaches are within 3 tiles of water', run(L) {
    const r = wcResult(), D = wcWaterDist(L, 4);
    for (let i = 0; i < L.t.length; i++) if (L.t[i] === T.SAND && D[i] > 3) r.add('Sand far from any water', i % L.w, (i / L.w) | 0);
    return r; } },
  { group: 'Biomes make sense', id: 'swamp-low', name: 'Swamps sit within 6 tiles of water', run(L) {
    const r = wcResult(), D = wcWaterDist(L, 7);
    for (let i = 0; i < L.t.length; i++) if (L.t[i] === T.SWAMP && D[i] > 6) r.add('Swamp far from water', i % L.w, (i / L.w) | 0);
    return r; } },
  { group: 'Biomes make sense', id: 'river-mouth', name: 'Every river reaches the sea or a lake', run(L) {
    const r = wcResult(), W = L.w, N = W * L.h, R = new Uint8Array(N), q = new Int32Array(N); let qh = 0, qt = 0;
    const flows = t => t === T.RIVER || t === T.BRIDGE_H || t === T.BRIDGE_V || t === T.SHALLOW || t === T.DEEP;
    for (let i = 0; i < N; i++) if (L.t[i] === T.SHALLOW || L.t[i] === T.DEEP) { R[i] = 1; q[qt++] = i; }
    while (qh < qt) { const c = q[qh++], x = c % W, y = (c / W) | 0; for (let k = 0; k < 4; k++) { const n = L.idx(x + DX4[k], y + DY4[k]); if (!R[n] && flows(L.t[n])) { R[n] = 1; q[qt++] = n; } } }
    for (let i = 0; i < N; i++) if (L.t[i] === T.RIVER && !R[i]) r.add('River cut off from the sea', i % W, (i / W) | 0);
    return r; },
    cut(L) { const W = L.w, N = W * L.h, R = new Uint8Array(N), q = new Int32Array(N); let qh = 0, qt = 0;
      const flows = t => t === T.RIVER || t === T.BRIDGE_H || t === T.BRIDGE_V || t === T.SHALLOW || t === T.DEEP;
      for (let i = 0; i < N; i++) if (L.t[i] === T.SHALLOW || L.t[i] === T.DEEP) { R[i] = 1; q[qt++] = i; }
      while (qh < qt) { const c = q[qh++], x = c % W, y = (c / W) | 0; for (let k = 0; k < 4; k++) { const n = L.idx(x + DX4[k], y + DY4[k]); if (!R[n] && flows(L.t[n])) { R[n] = 1; q[qt++] = n; } } }
      const out = []; for (let i = 0; i < N; i++) if (L.t[i] === T.RIVER && !R[i]) out.push(i); return out; } },
  { group: 'Biomes make sense', id: 'river-downhill', name: 'Rivers never flow uphill', run(L) {
    const r = wcResult(), W = L.w, F = L.fillEl; if (!F) return r;
    for (let i = 0; i < L.t.length; i++) { if (L.t[i] !== T.RIVER) continue; const x = i % W, y = (i / W) | 0; let ok = false;
      for (let k = 0; k < 8 && !ok; k++) { const n = L.idx(x + DX8[k], y + DY8[k]), t = L.t[n]; if ((WATER_T(t) || t === T.BRIDGE_H || t === T.BRIDGE_V) && F[n] <= F[i] + 1e-4) ok = true; }
      if (!ok) r.add('River tile with nowhere downhill to go', x, y); }
    return r; } },
  { group: 'Biomes make sense', id: 'pine-hills', name: 'Pines only grow on hills', run(L) {
    const r = wcResult(), W = L.w, hilly = t => t === T.HILL || t === T.PINE || t === T.MOUNTAIN || t === T.SNOW || t === T.VEINS || t === T.ROAD || t === T.RIVER;
    for (let i = 0; i < L.t.length; i++) { if (L.t[i] !== T.PINE) continue; const x = i % W, y = (i / W) | 0; let n = 0;
      for (let k = 0; k < 4; k++) if (hilly(L.get(x + DX4[k], y + DY4[k]))) n++; if (!n) r.add('Lone pine away from the hills', x, y); }
    return r; } },
  // ---------------- everything reachable ----------------
  { group: 'Everything reachable', id: 'reach-towns', name: 'Every town can be walked to from the start', run(L) {
    const r = wcResult(), R = wcReach(L);
    for (const t of L.towns) if (!nearestTile(L, t.x, t.y + 1, 3, (x, y) => R[y * L.w + x])) r.add(`${t.name} can't be reached on foot`, t.x, t.y);
    return r; } },
  { group: 'Everything reachable', id: 'reach-doors', name: 'Every house door can be reached', run(L) {
    const r = wcResult(), R = wcReach(L);
    for (const t of L.towns) for (const h of t.houses) if (!R[h.door[1] * L.w + h.door[0]]) r.add(`A door in ${t.name} can't be reached`, h.door[0], h.door[1]);
    return r; } },
  { group: 'Everything reachable', id: 'reach-stairs', name: 'Every set of stairs can be reached', run(L) {
    const r = wcResult(), R = wcReach(L);
    for (const d of L.dungeons) if (!R[d.y * L.w + d.x]) r.add('Stairs cut off', d.x, d.y);
    return r; } },
  { group: 'Everything reachable', id: 'road-net', name: 'Roads join every village and city', run(L) {
    const r = wcResult(), W = L.w, N = W * L.h, R = new Uint8Array(N), q = new Int32Array(N); let qh = 0, qt = 0;
    const sp = L.towns[L.spawnTown], s = nearestTile(L, sp.x, sp.y + 1, 3, (x, y) => ROADLIKE_T(L.get(x, y)));
    if (s) { R[s[1] * W + s[0]] = 1; q[qt++] = s[1] * W + s[0]; }
    while (qh < qt) { const c = q[qh++], x = c % W, y = (c / W) | 0; for (let k = 0; k < 4; k++) { const n = L.idx(x + DX4[k], y + DY4[k]); if (!R[n] && ROADLIKE_T(L.t[n])) { R[n] = 1; q[qt++] = n; } } }
    for (const t of L.towns) { if (t.kind === 'hamlet') continue; if (!townTiles(L, t).some(i => R[i])) r.add(`No road into ${t.name}`, t.x, t.y); }
    return r; } },
  // ---------------- what spawns where ----------------
  { group: 'Spawns match their place', id: 'npc-home', name: 'Villagers start inside their own town, on open ground', run(L) {
    const r = wcResult();
    for (const e of L.ents) { if (e.type !== 'npc') continue; const tx = Math.floor(e.x / TS), ty = Math.floor(e.y / TS);
      if (TP[L.get(tx, ty)].solid) r.add(`${e.name} starts inside a wall`, tx, ty);
      else if (!nearestTile(L, tx, ty, 2, (x, y) => L.townMap[y * L.w + x] === e.town.idx + 1)) r.add(`${e.name} starts outside ${e.town.name}`, tx, ty); }
    return r; } },
  { group: 'Spawns match their place', id: 'fog-empty', name: 'Quarantined towns have no people; living towns have a healer', run(L) {
    const r = wcResult(), people = new Map(), healers = new Map();
    for (const e of L.ents) if (e.type === 'npc') { people.set(e.town, (people.get(e.town) || 0) + 1); if (e.role === 'healer') healers.set(e.town, (healers.get(e.town) || 0) + 1); }
    for (const t of L.towns) {
      if (t.fog && people.get(t)) r.add(`${people.get(t)} people left in quarantined ${t.name}`, t.x, t.y);
      if (!t.fog && t.kind !== 'hamlet' && healers.get(t) !== 1) r.add(`${t.name} has ${healers.get(t) || 0} healers`, t.x, t.y);
    }
    return r; } },
  { group: 'Spawns match their place', id: 'bodies-fog', name: 'Bodies only lie in quarantined towns', run(L) {
    const r = wcResult();
    for (const e of L.ents) { if (e.type !== 'corpse') continue; const tx = Math.floor(e.x / TS), ty = Math.floor(e.y / TS);
      const near = L.towns.some(t => t.fog && dist(t.x, t.y, tx, ty) <= t.r + 6); if (!near) r.add('Body outside any quarantine', tx, ty); }
    return r; } },
  { group: 'Spawns match their place', id: 'safe-towns', name: 'Enemies can never spawn inside a living town', run(L) {
    const r = wcResult();
    for (let i = 0; i < L.townMap.length; i++) { const ti = L.townMap[i]; if (!ti) continue; const t = L.towns[ti - 1], x = i % L.w, y = (i / L.w) | 0;
      const blocked = L.blockedFor(x, y, true);
      if (!t.fog && !blocked) r.add(`Enemies could spawn inside ${t.name}`, x, y);
      if (t.fog && L.noEnemy[i]) r.add(`Quarantined ${t.name} is wrongly marked safe`, x, y); }
    return r; } },
];
function checkWorld(L) { const out = {}; for (const c of WORLD_CHECKS) out[c.id] = c.run(L); L._reach = null; return out; }

// ================= four-sides access and auto-fixes =================
const ACCESS_DIRS = [{ x: 1, y: 0, name: 'east' }, { x: 0, y: 1, name: 'south' }, { x: -1, y: 0, name: 'west' }, { x: 0, y: -1, name: 'north' }];
export function townCentre(L, t) { return nearestTile(L, t.x, t.y + 1, 4, (x, y) => !TP[L.get(x, y)].solid && !WATER_T(L.get(x, y))) || [t.x, t.y + 1]; }
// which cardinal directions are walled in by rock or trees (sides facing water don't count)
const ACCESS_PAD = 24; // how far past the edge of town a way out may run before it counts
function townAccess(L, t) {
  const [cx, cy] = townCentre(L, t), rr = t.r + 3, B = rr + ACCESS_PAD, BW = B * 2 + 1, seen = new Uint8Array(BW * BW), q = [B * BW + B];
  seen[B * BW + B] = 1;
  for (let qi = 0; qi < q.length; qi++) { const c = q[qi], lx = c % BW, ly = (c / BW) | 0;
    for (let k = 0; k < 4; k++) { const nx = lx + DX4[k], ny = ly + DY4[k]; if (nx < 0 || ny < 0 || nx >= BW || ny >= BW) continue; const n = ny * BW + nx; if (seen[n]) continue;
      if (TP[L.get(nx - B + cx, ny - B + cy)].solid) continue; seen[n] = 1; q.push(n); } }
  const out = [];
  for (const d of ACCESS_DIRS) {
    let ok = false, wet = 0, rock = 0;
    for (let ly = 0; ly < BW && !ok; ly++) for (let lx = 0; lx < BW; lx++) {
      const dx = lx - B, dy = ly - B, along = dx * d.x + dy * d.y, perp = Math.abs(dx * d.y - dy * d.x);
      if (along < rr || perp > along) continue;
      if (seen[ly * BW + lx] && !WATER_T(L.get(cx + dx, cy + dy))) { ok = true; break; }
      const tt = L.get(cx + dx, cy + dy); if (WATER_T(tt) || tt === T.SWAMP) wet++; else if (TP[tt].solid) rock++;
    }
    if (!ok && rock > wet) out.push(d);
  }
  return out;
}
// breadth-first search that may cut through rock and trees (never through buildings or deep water); lays a path
function carvePath(L, sx, sy, isGoal, rad, stats, id, allow) {
  const B = rad, BW = B * 2 + 1, prev = new Int32Array(BW * BW).fill(-2), q = [B * BW + B]; prev[B * BW + B] = -1;
  let found = -1;
  const blocked = t => BUILDING_T(t) || t === T.WELL || t === T.LAMP || t === T.DEEP || t === T.DUNGEON;
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi], lx = c % BW, ly = (c / BW) | 0, gx = lx - B + sx, gy = ly - B + sy;
    if (qi > 0 && isGoal(gx, gy)) { found = c; break; }
    for (let k = 0; k < 4; k++) { const nx = lx + DX4[k], ny = ly + DY4[k]; if (nx < 0 || ny < 0 || nx >= BW || ny >= BW) continue; const n = ny * BW + nx; if (prev[n] !== -2) continue;
      if (blocked(L.get(nx - B + sx, ny - B + sy)) || (allow && !allow(nx - B + sx, ny - B + sy))) continue; prev[n] = c; q.push(n); }
  }
  if (found < 0) return false;
  const path = []; for (let c = found; c >= 0; c = prev[c]) path.push(c);
  for (let k = 0; k < path.length; k++) {
    const c = path[k], x = c % BW - B + sx, y = ((c / BW) | 0) - B + sy, t = L.get(x, y);
    if (ROADLIKE_T(t) || t === T.DOOR || t === T.CDOOR) continue;
    if (WATER_T(t)) { const a = path[Math.max(0, k - 1)], b = path[Math.min(path.length - 1, k + 1)]; L.set(x, y, Math.abs(b - a) <= 2 ? T.BRIDGE_H : T.BRIDGE_V); }
    else if (TP[t].solid || t === T.SWAMP || k < path.length - 1) L.set(x, y, T.ROAD);
  }
  fixCount(L, id); return true;
}
export function settlementFixes(L) {
  const W = L.w;
  for (const t of L.towns) {
    // drain swamp inside town limits
    let n = 0; for (let i = 0; i < L.townMap.length; i++) if (L.townMap[i] === t.idx + 1 && L.t[i] === T.SWAMP) { L.t[i] = T.GRASS; n++; }
    if (n) fixCount(L, 'not-in-swamp');
    // a town more than a third under water gets a sandy shore built out over the shallows, nearest the centre first
    const tl = townTiles(L, t); let wet = tl.filter(i => L.t[i] === T.SHALLOW || L.t[i] === T.DEEP).length;
    if (wet / tl.length > 0.3) {
      const nearRiver = i => { const x = i % W, y = (i / W) | 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (L.get(x + dx, y + dy) === T.RIVER) return true; return false; };
      const sh = tl.filter(i => (L.t[i] === T.SHALLOW || L.t[i] === T.DEEP) && !nearRiver(i)).map(i => [i, wdistT(L, { x: i % W, y: (i / W) | 0 }, t)]).sort((a, b) => a[1] - b[1]);
      for (const [i] of sh) { if (wet / tl.length <= 0.3) break; L.t[i] = T.SAND; wet--; fixCount(L, 'not-in-swamp'); }
    }
    // a square whose well fell in the water gets its well back on dry ground
    if (t.kind !== 'hamlet') {
      let wells = 0; for (let dy = -3; dy <= 6; dy++) for (let dx = -3; dx <= 6; dx++) if (L.get(t.x + dx, t.y + dy) === T.WELL) wells++;
      if (!wells) {
        const inWin = (x, y) => { const dx = L.wx(x - t.x + W / 2) - W / 2, dy = y - t.y; return dx >= -3 && dx <= 6 && dy >= -3 && dy <= 6; };
        const noDoor = (x, y) => { for (let k = 0; k < 4; k++) if (L.get(x + DX4[k], y + DY4[k]) === T.DOOR) return false; return true; };
        const p = (t.kind === 'city' && nearestTile(L, t.x + 3, t.y + 3, 3, (x, y) => L.get(x, y) === T.COBBLE && (x - t.x) % 6 && (y - t.y) % 6))
          || nearestTile(L, t.x + 1, t.y + 2, 6, (x, y) => { const tt = L.get(x, y); return inWin(x, y) && isGround(tt) && tt !== T.ROAD && tt !== T.COBBLE && !TP[tt].solid && !WATER_T(tt) && noDoor(x, y); });
        if (p) { L.set(p[0], p[1], T.WELL); fixCount(L, 'well-plaza'); }
      }
    }
    // open up any side walled in by rock with a path out
    for (const d of townAccess(L, t)) {
      const [cx, cy] = townCentre(L, t), rr = t.r + 3;
      const cone = (x, y) => { const dx = x - cx, dy = y - cy, along = dx * d.x + dy * d.y; return { along, perp: Math.abs(dx * d.y - dy * d.x), r2: dx * dx + dy * dy }; };
      // the new pass stays inside the side it opens (or inside town), so it really leads out that way
      carvePath(L, cx, cy, (x, y) => { const c = cone(x, y), tt = L.get(x, y); return c.along >= rr && c.perp <= c.along && !TP[tt].solid && !WATER_T(tt); }, rr + 45, null, 'town-access',
        (x, y) => { const c = cone(x, y); return c.r2 <= (rr + 1) * (rr + 1) || (c.along >= 0 && c.perp <= c.along); });
    }
  }
  // anything you can't walk to gets a path cut to the nearest place you can
  const R = () => { L._reach = null; return wcReach(L); };
  let reach = R();
  const connect = (x, y, id) => { if (reach[L.idx(x, y)]) return; if (carvePath(L, x, y, (gx, gy) => reach[L.idx(gx, gy)], 60, null, id)) reach = R(); };
  for (const t of L.towns) { const [cx, cy] = townCentre(L, t); connect(cx, cy, 'reach-towns'); }
  for (const t of L.towns) for (const h of t.houses) connect(h.door[0], h.door[1], 'reach-doors');
  for (const d of L.dungeons) connect(d.x, d.y, 'reach-stairs');
  L._reach = null;
  const hilly = t => t === T.HILL || t === T.PINE || t === T.MOUNTAIN || t === T.SNOW || t === T.RIVER || t === T.VEINS || t === T.ROAD;
  for (let i = 0; i < L.t.length; i++) { if (L.t[i] !== T.PINE) continue; const x = i % W, y = (i / W) | 0; let n = 0; for (let k = 0; k < 4; k++) if (hilly(L.get(x + DX4[k], y + DY4[k]))) n++; if (!n) { L.t[i] = T.TREE; fixCount(L, 'pine-hills'); } }
  const rm = WORLD_CHECKS.find(c => c.id === 'river-mouth').cut(L);
  for (const i of rm) { L.t[i] = T.GRASS; } if (rm.length) fixCount(L, 'river-mouth', rm.length);
  // last of all: any beach left high and dry by the work above (paved rivers, cut channels, new shores) turns to grass, or desert beside desert
  const D = wcWaterDist(L, 4); let dry = 0;
  for (let i = 0; i < L.t.length; i++) { if (L.t[i] !== T.SAND || D[i] <= 3) continue; const x = i % W, y = (i / W) | 0; let des = false;
    for (let dy = -1; dy <= 1 && !des; dy++) for (let dx = -1; dx <= 1; dx++) if (L.get(x + dx, y + dy) === T.DESERT) { des = true; break; }
    L.t[i] = des ? T.DESERT : T.GRASS; dry++; }
  if (dry) fixCount(L, 'beach-water', dry);
}

// ================= world variants =================
// A seed always makes the same world. If that world still fails a check after its fixes, the game quietly
// uses the next variant of the seed instead, so every seed you can type gives one clean, repeatable world.
const WORLD_TRIES = 4;
function worldSeed(seed, v) { return v ? (seed + v * 7919) >>> 0 : seed >>> 0; }
function failedIds(res) { return WORLD_CHECKS.filter(c => res[c.id].count > 0).map(c => c.id); }
export function makeWorld(seed, forceV) {
  let v = forceV == null ? 0 : forceV, L, res = null;
  for (;;) {
    L = genOverworld(worldSeed(seed, v)); setupOverworld(L);
    if (forceV != null) break;
    res = checkWorld(L);
    if (!failedIds(res).length || v >= WORLD_TRIES - 1) break;
    v++;
  }
  L.variant = v; L.checkRes = res; return L;
}

// ================= the in-game test page =================
const WT = { running: false, cancel: false, n: 50 };
function wtEsc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }
async function runWorldTests() {
  if (WT.running) return;
  WT.running = true; WT.cancel = false;
  const keepSeed = G.seed, keepProg = G.prog, n = WT.n, base = (Math.random() * 1e9) >>> 0, t0 = performance.now();
  const agg = {}; for (const c of WORLD_CHECKS) agg[c.id] = { pass: 0, fixed: 0 };
  const fails = []; let done = 0, retried = 0, stuck = 0, firstClean = 0;
  $('wtRun').textContent = 'Stop'; $('wtFails').innerHTML = ''; WT.shown = -1; WT.after = null; wtRender(agg, 0, n, fails, 0, 0, 0, 0);
  try {
    for (let k = 0; k < n && !WT.cancel; k++) {
      const seed = (base + k * 104729) >>> 0;
      G.seed = seed; G.prog = freshProg();
      const L = genOverworld(seed); setupOverworld(L);
      const res = checkWorld(L), bad = failedIds(res);
      for (const c of WORLD_CHECKS) { if (!res[c.id].count) agg[c.id].pass++; agg[c.id].fixed += L.fixes[c.id] || 0; }
      if (!bad.length) firstClean++;
      else {
        for (const id of bad) for (const ex of res[id].examples.slice(0, 2)) fails.push({ seed, v: 0, id, msg: ex.msg, x: ex.x, y: ex.y });
        // would the game still give you a clean world from this seed?
        retried++; let ok = false;
        for (let v = 1; v < WORLD_TRIES && !ok; v++) { G.prog = freshProg(); const L2 = genOverworld(worldSeed(seed, v)); setupOverworld(L2); ok = !failedIds(checkWorld(L2)).length; }
        if (!ok) stuck++;
      }
      done = k + 1;
      wtRender(agg, done, n, fails, firstClean, retried, stuck, performance.now() - t0);
      await new Promise(r => setTimeout(r, 0));
    }
  } finally {
    G.seed = keepSeed; G.prog = keepProg; WT.running = false; $('wtRun').textContent = 'Run 50 new worlds';
    wtRender(agg, done, n, fails, firstClean, retried, stuck, performance.now() - t0, true);
    if (WT.after) { const f = WT.after; WT.after = null; f(); }
  }
}
function wtRender(agg, done, n, fails, clean, retried, stuck, ms, final) {
  const pct = n ? Math.round(done / n * 100) : 0;
  $('wtBar').style.width = pct + '%';
  $('wtStatus').textContent = !done && final ? `Builds ${n} random worlds and runs every check on each. Takes a minute or two.` : done < n && !final ? `Checking world ${done + 1} of ${n}...` : `${done} worlds checked in ${(ms / 1000).toFixed(0)}s`;
  const play = done - stuck;
  $('wtSummary').innerHTML = done ? `<b>${clean}/${done}</b> clean on the first try` + (retried ? ` · ${retried} needed the next variant` : '') + `<br><b>${play}/${done}</b> worlds you would actually play are clean` : '';
  let html = '', grp = '';
  for (const c of WORLD_CHECKS) {
    if (c.group !== grp) { grp = c.group; html += `<div class="wtgrp">${wtEsc(grp)}</div>`; }
    const a = agg[c.id], ok = a.pass === done;
    html += `<div class="wtrow ${done ? (ok ? 'ok' : 'bad') : ''}"><span class="wtname">${wtEsc(c.name)}</span><span class="wtnum">${done ? a.pass + '/' + done : '–'}${a.fixed ? ` · ${a.fixed.toLocaleString()} fixed` : ''}</span></div>`;
  }
  $('wtList').innerHTML = html;
  const box = $('wtFails');
  if (!fails.length) { box.innerHTML = done ? '<div class="wtnone">No failures left after auto-fix.</div>' : ''; return; }
  if (WT.shown === fails.length) return; WT.shown = fails.length;
  box.innerHTML = `<div class="wtgrp">Failures · tap one to walk to it</div>`;
  fails.slice(0, 40).forEach(f => {
    const b = document.createElement('button'); b.className = 'filebtn';
    const name = (WORLD_CHECKS.find(c => c.id === f.id) || {}).name || f.id;
    b.innerHTML = `<b>${wtEsc(f.msg)}</b><br><span class="wtsub">seed ${f.seed} · tile ${f.x},${f.y} · ${wtEsc(name)}</span>`;
    b.onclick = () => wtJump(f);
    box.appendChild(b);
  });
}
function wtJump(f) {
  auResume();
  const go = () => { G.testJump = { v: f.v, x: f.x, y: f.y, msg: `${f.msg} · seed ${f.seed}. Follow the blue ring.` }; newGame(f.seed, null, null, G.pickDiff ? G.pickDiff() : 'easy'); };
  if (WT.running) { WT.cancel = true; WT.after = go; } else go();
}
export function setupWorldTests() {
  $('btnTests').onclick = () => { $('title').classList.add('hidden'); $('tests').classList.remove('hidden'); if (!WT.running && !$('wtList').innerHTML) wtRender(Object.fromEntries(WORLD_CHECKS.map(c => [c.id, { pass: 0, fixed: 0 }])), 0, WT.n, [], 0, 0, 0, 0, true); };
  $('wtRun').onclick = () => { if (WT.running) WT.cancel = true; else runWorldTests(); };
  $('wtBack').onclick = () => { WT.cancel = true; $('tests').classList.add('hidden'); $('title').classList.remove('hidden'); };
}
