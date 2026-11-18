import { dist, pick, TAU, TS } from './core.js';
import { DIFF, floorsN } from './difficulty.js';
import { rgb } from './art.js';
import { sfx } from './audio.js';
import {
  bctx, burst, damageEnemy, G, IN, nearX, nearY, pop, saveGame, toast, wdx, wdy, wrapPos
} from './game.js';

// ================= guns =================
export const GUNS = {
  bat: { name: 'Bat', melee: true, dmg: 1, rate: 0.42, range: 64, reach: 24, arc: 1.25, kick: 1.5, desc: 'Never runs out.' },
  pistol: { name: 'Pistol', ammo: 'light', mag: 12, dmg: 1, rate: 0.26, spread: 0.035, bloom: 0.03, bloomMax: 0.16, kick: 1.2, push: 0, pellets: 1, range: 150, speed: 360, reload: 1.0, col: [255, 236, 160], desc: 'Reliable. Barely kicks.' },
  revolver: { name: 'Revolver', ammo: 'heavy', mag: 6, dmg: 3, rate: 0.55, spread: 0.02, bloom: 0.13, bloomMax: 0.3, kick: 3.5, push: 30, pellets: 1, range: 180, speed: 430, reload: 1.6, col: [255, 214, 120], desc: 'Hits hard. Jumps in your hand.' },
  smg: { name: 'SMG', ammo: 'light', mag: 30, dmg: 1, rate: 0.085, spread: 0.06, bloom: 0.03, bloomMax: 0.32, kick: 0.7, push: 5, pellets: 1, range: 140, speed: 360, reload: 1.4, col: [255, 240, 180], desc: 'Hold to spray. Climbs as it fires.' },
  shotgun: { name: 'Shotgun', ammo: 'shell', mag: 5, dmg: 1, rate: 0.8, spread: 0.26, bloom: 0.08, bloomMax: 0.2, kick: 5, push: 80, pellets: 6, range: 95, speed: 320, reload: 2.0, col: [255, 200, 120], desc: 'Six pellets up close. Shoves you back.' },
  rifle: { name: 'Rifle', ammo: 'heavy', mag: 5, dmg: 5, rate: 0.95, spread: 0.005, bloom: 0.16, bloomMax: 0.3, kick: 4.5, push: 40, pellets: 1, range: 230, speed: 540, reload: 1.8, pierce: 2, col: [255, 250, 220], desc: 'Long reach. Punches through.' },
};
export const AMMO_NAME = { light: 'pistol rounds', shell: 'shells', heavy: 'heavy rounds' };
export const AMMO_SHORT = { light: 'rounds', shell: 'shells', heavy: 'heavy' };
export const gunOf = P => P.guns[P.gi];
export function giveGun(P, id) {
  if (P.guns.some(g => g.id === id)) { giveAmmo(P, GUNS[id].ammo, GUNS[id].mag); return false; }
  P.guns.push({ id, mag: GUNS[id].mag }); P.gi = P.guns.length - 1; P.reload = 0; sfx('upgrade');
  return true;
}
export function giveAmmo(P, type, n) {
  P.ammo[type] = (P.ammo[type] || 0) + n;
  // if you were knocked onto the bat by an empty gun, pick that gun back up when its ammo turns up
  const back = P.guns[P.autoBatFrom];
  if (back && GUNS[gunOf(P).id].melee && GUNS[back.id].ammo === type) { P.gi = P.autoBatFrom; P.autoBatFrom = undefined; P.target = null; setTimeout(() => toast('Back to the ' + GUNS[back.id].name.toLowerCase(), 'Ammo found.', 2.2), 400); }
}
export const isEmpty = (P, g) => { const D = GUNS[g.id]; return !D.melee && g.mag <= 0 && !(P.ammo[D.ammo] > 0); };
export function nextGun(P, good) {
  const c = ['revolver', 'smg', 'shotgun'].concat(good ? ['rifle'] : []).filter(id => !P.guns.some(g => g.id === id));
  return c.length ? pick(Math.random, c) : null;
}
export function ammoTypeFor(P) {
  const owned = [...new Set(P.guns.map(g => GUNS[g.id].ammo).filter(Boolean))];
  if (!owned.length) return 'light';
  const cur = gunOf(P) && GUNS[gunOf(P).id].ammo;
  return Math.random() < 0.5 && cur ? cur : pick(Math.random, owned);
}
export function ammoAmt(type, k = 1) { const [a, b] = type === 'light' ? [10, 18] : [3, 6]; return Math.max(1, Math.round((a + Math.random() * (b - a)) * k * DIFF.ammo)); }
function los(L, x0, y0, x1, y1) {
  const d = Math.hypot(x1 - x0, y1 - y0), n = Math.ceil(d / 4);
  for (let i = 1; i < n; i++) { const t = i / n; if (L.solid(Math.floor((x0 + (x1 - x0) * t) / TS), Math.floor((y0 + (y1 - y0) * t) / TS))) return false; }
  return true;
}
function findTarget(P, L, range) {
  const t = P.target, nx = e => nearX(L, e.x, P.x), ny = e => nearY(L, e.y, P.y);
  if (t && !t.dead && !t.shielded && dist(nx(t), ny(t), P.x, P.y) < range * 1.15 && los(L, P.x, P.y - 3, nx(t), ny(t) - 3)) return t;
  let best = null, bd = range;
  for (const e of G.hittables) { if (e.shielded) continue; const ex = nx(e), ey = ny(e), d = dist(ex, ey, P.x, P.y); if (d < bd && los(L, P.x, P.y - 3, ex, ey - 3)) { bd = d; best = e; } }
  return best;
}
function startReload(P, D) { if (P.reload > 0) return; P.reload = D.reload; P.reloadMax = D.reload; sfx('reload'); }
export function updateGun(P, L, dt, frozen) {
  P.fireCool = Math.max(0, P.fireCool - dt); P.bloom = Math.max(0, P.bloom - dt * 0.55); P.aimT = Math.max(0, P.aimT - dt); P.swing = Math.max(0, (P.swing || 0) - dt);
  let g = gunOf(P); if (!g) return; let D = GUNS[g.id];
  // out of ammo for this gun: drop to the bat automatically
  if (isEmpty(P, g) && P.reload <= 0) {
    const bi = P.guns.findIndex(x => x.id === 'bat');
    if (bi >= 0) { P.autoBatFrom = P.gi; P.gi = bi; P.target = null; P.tgtT = 0; sfx('reload'); toast('Out of ammo', `Switched to the bat. Search houses for ${AMMO_NAME[D.ammo]}.`, 3); g = gunOf(P); D = GUNS[g.id]; }
  }
  if (P.reload > 0) {
    P.reload -= dt;
    if (P.reload <= 0) { const take = Math.min(D.mag - g.mag, P.ammo[D.ammo] || 0); g.mag += take; P.ammo[D.ammo] -= take; P.reload = 0; sfx('reload2'); }
  }
  P.tgtT = (P.tgtT || 0) - dt;
  if (P.tgtT <= 0) { P.tgtT = 0.1; P.target = findTarget(P, L, D.range); }
  if (P.target && P.target.dead) P.target = null;
  if (frozen) return;
  if (IN.switchPress && P.guns.length > 1) {
    for (let k = 1; k <= P.guns.length; k++) { const j = (P.gi + k) % P.guns.length; if (!isEmpty(P, P.guns[j])) { if (j !== P.gi) { P.gi = j; P.reload = 0; P.bloom = 0; P.target = null; P.tgtT = 0; P.autoBatFrom = undefined; sfx('reload'); } break; } }
    return;
  }
  if (IN.medPress) useMed(P);
  if (D.melee) { if ((IN.atkHeld || IN.atkPress) && P.fireCool <= 0) swingBat(P, L, D); return; }
  if (IN.reloadPress && P.reload <= 0 && g.mag < D.mag && (P.ammo[D.ammo] || 0) > 0) startReload(P, D);
  if (!(IN.atkHeld || IN.atkPress) || P.fireCool > 0 || P.reload > 0) return;
  if (g.mag <= 0) {
    if ((P.ammo[D.ammo] || 0) > 0) startReload(P, D);
    else if (IN.atkPress) {
      sfx('click');
      if (!P.dryWarn || G.t - P.dryWarn > 4) { P.dryWarn = G.t; toast('Out of ammo', `No ${AMMO_NAME[D.ammo]} left.` + (P.guns.length > 1 ? ' Tap the gun panel to switch.' : ' Search houses for more.')); }
    }
    return;
  }
  fireGun(P, L, g, D);
}
function fireGun(P, L, g, D) {
  const t = P.target, ang = t ? Math.atan2(nearY(L, t.y, P.y) - P.y, nearX(L, t.x, P.x) - P.x) : Math.atan2(P.fy, P.fx);
  P.aimAng = ang; P.aimT = 0.7; g.mag--; P.fireCool = D.rate;
  const sp = D.spread + P.bloom, ca = Math.cos(ang), sa = Math.sin(ang);
  for (let k = 0; k < D.pellets; k++) {
    const a = D.pellets > 1 ? ang + (k / (D.pellets - 1) - 0.5) * 2 * sp + (Math.random() - 0.5) * 0.08 : ang + (Math.random() - 0.5) * 2 * sp;
    const v = D.speed * (D.pellets > 1 ? 0.85 + Math.random() * 0.3 : 1);
    L.ents.push({ type: 'bullet', x: P.x + ca * 8, y: P.y - 3 + sa * 8, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: D.range / D.speed * 1.1, dmg: D.dmg, pierce: D.pierce || 0, hit: [], col: D.col });
  }
  P.bloom = Math.min(D.bloomMax, P.bloom + D.bloom);
  G.kick.x -= ca * D.kick; G.kick.y -= sa * D.kick;
  P.kx -= ca * D.push; P.ky -= sa * D.push;
  G.flash = 0.06; G.flashAt = [P.x + ca * 11, P.y - 3 + sa * 11];
  sfx('shot', D);
  G.parts.push({ x: P.x, y: P.y - 2, vx: -sa * 40 + (Math.random() - 0.5) * 20, vy: ca * 40 - 30, life: 0.5, max: 0.5, col: D.ammo === 'shell' ? [200, 50, 40] : [220, 190, 90], sz: 1 });
  P.fx = ca; P.fy = sa; P.dir = Math.abs(ca) > Math.abs(sa) ? (ca < 0 ? 2 : 3) : (sa < 0 ? 1 : 0);
  if (g.mag === 0 && (P.ammo[D.ammo] || 0) > 0) startReload(P, D);
}
function swingBat(P, L, D) {
  const t = P.target, ang = t ? Math.atan2(nearY(L, t.y, P.y) - P.y, nearX(L, t.x, P.x) - P.x) : Math.atan2(P.fy, P.fx);
  P.aimAng = ang; P.aimT = 0.5; P.fireCool = D.rate; P.swing = 0.2; P.swAng = ang; sfx('swing');
  const c = Math.cos(ang), s = Math.sin(ang);
  P.kx += c * 70; P.ky += s * 70; G.kick.x += c * D.kick; G.kick.y += s * D.kick;
  P.fx = c; P.fy = s; P.dir = Math.abs(c) > Math.abs(s) ? (c < 0 ? 2 : 3) : (s < 0 ? 1 : 0);
  for (const e of G.hittables) {
    const dx = wdx(L, e.x - P.x), dy = wdy(L, e.y - P.y), d = Math.hypot(dx, dy); if (d > D.reach + e.r) continue;
    const da = Math.abs(((Math.atan2(dy, dx) - ang + Math.PI * 3) % TAU) - Math.PI);
    if (d > e.r + 6 && da > D.arc) continue;
    damageEnemy(e, D.dmg, dx / (d || 1), dy / (d || 1), 230);
  }
}
// a dotted laser to whatever you're aiming at, plus the spread cone so recoil is visible
export function drawAim(P, L, cx, cy) {
  if (P.dead || G.fade) return; const g = gunOf(P); if (!g) return; const D = GUNS[g.id], t0 = P.target && !P.target.dead ? P.target : null, t = t0 ? { x: nearX(L, t0.x, P.x), y: nearY(L, t0.y, P.y), r: t0.r } : null;
  const a = t ? Math.atan2(t.y - 3 - (P.y - 3), t.x - P.x) : (P.aimT > 0 ? P.aimAng : Math.atan2(P.fy, P.fx));
  const c = Math.cos(a), s = Math.sin(a), sx = P.x + c * 8, sy = P.y - 3 + s * 8;
  if (D.melee) {
    const r = D.reach, pulse = t ? 0.85 : 0.4;
    for (let k = -4; k <= 4; k++) { const aa = a + k / 4 * D.arc * 0.8; bctx.fillStyle = t ? `rgba(255,70,80,${pulse})` : `rgba(255,240,220,${pulse})`; bctx.fillRect(Math.round(P.x + Math.cos(aa) * r - cx), Math.round(P.y - 3 + Math.sin(aa) * r - cy), 1, 1); }
    return;
  }
  const maxL = t ? Math.max(0, Math.hypot(t.x - sx, t.y - 3 - sy) - t.r) : D.range;
  let len = 0; for (; len < maxL; len += 2) if (L.solid(Math.floor((sx + c * len) / TS), Math.floor((sy + s * len) / TS))) break;
  const col = t ? '255,40,55' : '255,250,235', al = t ? 1 : 0.7, px = -s, py = c;
  for (let d = 0; d < len; d += 2) {
    const k = al * (1 - d / (len + 1) * 0.5), x = Math.round(sx + c * d - cx), y = Math.round(sy + s * d - cy);
    bctx.fillStyle = `rgba(${col},${k * 0.3})`; bctx.fillRect(Math.round(x + px), Math.round(y + py), 1, 1); bctx.fillRect(Math.round(x - px), Math.round(y - py), 1, 1);
    if ((d >> 1) % 3 !== 2) { bctx.fillStyle = `rgba(0,0,0,${k * 0.35})`; bctx.fillRect(x, y + 1, 1, 1); bctx.fillStyle = `rgba(${col},${k})`; bctx.fillRect(x, y, 1, 1); }
  }
  const sp = D.spread + P.bloom, cl = Math.min(len, 60);
  for (const sg of [-1, 1]) { const aa = a + sg * sp, ca = Math.cos(aa), sa = Math.sin(aa);
    for (let d = 14; d < cl; d += 5) { bctx.fillStyle = `rgba(${col},${0.18 + P.bloom})`; bctx.fillRect(Math.round(sx + ca * d - cx), Math.round(sy + sa * d - cy), 1, 1); } }
  if (!t) { const ex = Math.round(sx + c * len - cx), ey = Math.round(sy + s * len - cy); bctx.fillStyle = 'rgba(255,250,235,0.7)'; bctx.fillRect(ex - 2, ey, 5, 1); bctx.fillRect(ex, ey - 2, 1, 5); }
}
export function updBullet(b, dt, L) {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.vx, b.vy) * dt / 4));
  for (let s = 0; s < steps; s++) {
    b.x += b.vx * dt / steps; b.y += b.vy * dt / steps; wrapPos(L, b);
    if (L.solid(Math.floor(b.x / TS), Math.floor(b.y / TS))) { b.dead = true; burst(b.x - b.vx * 0.012, b.y - b.vy * 0.012, [210, 200, 170], 3, 0.4); return; }
    for (const e of G.hittables) {
      if (e.dead || b.hit.includes(e)) continue;
      const rr = e.r + 2, dx = wdx(L, e.x - b.x), dy = wdy(L, e.y - 3 - b.y);
      if (dx * dx + dy * dy < rr * rr) {
        b.hit.push(e); const l = Math.hypot(b.vx, b.vy);
        damageEnemy(e, b.dmg, b.vx / l, b.vy / l, 70);
        if (b.pierce-- <= 0) { b.dead = true; return; }
      }
    }
  }
  b.life -= dt; if (b.life <= 0) b.dead = true;
}
export function drawBullet(b, cx, cy) {
  const l = Math.hypot(b.vx, b.vy), nx = b.vx / l, ny = b.vy / l, x = b.x - cx, y = b.y - cy;
  bctx.fillStyle = rgb(b.col); bctx.fillRect(Math.round(x), Math.round(y), 1, 1); bctx.fillRect(Math.round(x - nx * 2), Math.round(y - ny * 2), 1, 1);
  bctx.fillStyle = rgb(b.col, 0.5); bctx.fillRect(Math.round(x - nx * 4), Math.round(y - ny * 4), 1, 1);
}
export function drawGun(P, cx, cy) {
  const a = P.aimT > 0 ? P.aimAng : Math.atan2(P.fy, P.fx), c = Math.cos(a), s = Math.sin(a);
  const hx = P.x + c * 3 - cx, hy = P.y - 3 + s * 2 - cy, g = gunOf(P), len = g && (g.id === 'rifle' || g.id === 'shotgun') ? 8 : g && g.id === 'smg' ? 6 : 5;
  if (g && GUNS[g.id].melee) {
    const ba = P.swing > 0 ? P.swAng - 1.15 + (1 - P.swing / 0.2) * 2.3 : a - 0.9, bc = Math.cos(ba), bs = Math.sin(ba);
    for (let i = 0; i < 9; i++) { bctx.fillStyle = i < 3 ? '#4a3020' : i > 6 ? '#c08a50' : '#a2703e'; bctx.fillRect(Math.round(hx + bc * i), Math.round(hy + bs * i), i > 5 ? 2 : 1, i > 5 ? 2 : 1); }
    return;
  }
  for (let i = 0; i < len; i++) { bctx.fillStyle = i < 2 ? '#2a2a30' : '#46464f'; bctx.fillRect(Math.round(hx + c * i), Math.round(hy + s * i), 1, 1); }
  if (G.flash > 0) { const fx = hx + c * (len + 1), fy = hy + s * (len + 1); bctx.fillStyle = '#fff6c8'; bctx.fillRect(Math.round(fx) - 1, Math.round(fy) - 1, 3, 3); bctx.fillStyle = '#ffd060'; bctx.fillRect(Math.round(fx + c * 2), Math.round(fy + s * 2), 1, 1); }
}
export function drawReticle(P, cx, cy) {
  const t = P.target; if (!t || t.dead) return; const L = G.L;
  const r = Math.round(t.r + 5 + Math.sin(G.t * 8)), x = Math.round(nearX(L, t.x, P.x) - cx), y = Math.round(nearY(L, t.y, P.y) - 3 - cy);
  bctx.fillStyle = '#ff2a3c';
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    bctx.fillRect(x + sx * r - (sx > 0 ? 3 : 0), y + sy * r - (sy > 0 ? 1 : 0), 4, 2);
    bctx.fillRect(x + sx * r - (sx > 0 ? 1 : 0), y + sy * r - (sy > 0 ? 3 : 0), 2, 4);
  }
  bctx.fillStyle = 'rgba(255,40,60,0.9)'; bctx.fillRect(x, y, 1, 1);
}
function useMed(P) {
  if (P.meds <= 0) return;
  if (P.hp >= P.maxHp) { toast('Already patched up', 'Save the medkit.', 2); return; }
  P.meds--; P.hp = Math.min(P.maxHp, P.hp + 4); sfx('heal'); burst(P.x, P.y, [255, 255, 255], 8);
}

// ================= classified files =================
export const FILES = [
  { pool: 'surface', title: 'Notice to residents', body: 'By order of the ██████ council this settlement is closed.\n\nDo not drink from the wells. Do not sleep on bare ground. If the floor of your house is warm, leave the house.\n\nThe fog is not weather. It is the Shift breathing out.' },
  { pool: 'surface', title: 'Warden\'s log, day 4', body: 'Fog rose at dusk from the old stairs north of the village. ██ of my men went down to look. They came back up eleven hours later and could not tell us their names.\n\nWe burned their clothes. The clothes bled.\n\nThe old ones here call what lives down there the Shift. I have stopped telling them to hush.' },
  { pool: 'surface', title: 'Survey note, hill country', body: 'Ground temperature 37°C at one metre. Constant, day and night.\n\nSamples from the deep bore came up as ██████ tissue. Not rock.\n\nThe island is not resting on stone. It is resting on something alive and very large. Locals say it moves in its sleep. They call it the Shift.' },
  { pool: 'surface', title: 'Letter, never sent', body: 'Mam,\n\nDon\'t come for the harvest. The cows won\'t go into the low field. Last night Seán said he heard a heartbeat under the kitchen floor. I laughed at him.\n\nTonight I can hear it too.' },
  { pool: 'surface', title: 'Parish register, margin', body: 'Burials suspended.\n\nThe graves won\'t stay shut. The ground takes them down and some mornings it gives them back.\n\nWhat it gives back is not ours anymore.' },
  { pool: 'maze1', title: 'Hunter\'s journal, 1', body: 'First stair found. The mortar sweats.\n\nMy lamp gutters like the air is being breathed in around me. I am not the first down here. There are bones, and the bones are clean.' },
  { pool: 'maze2', title: 'Hunter\'s journal, 2', body: 'The walls are warm and they flinch when I fire near them. The bullet holes close over.\n\nThe Shift isn\'t under the island. We are inside it, and it is under everything.' },
  { pool: 'maze3', title: 'Hunter\'s journal, 3', body: 'It knows I\'m here. The eyes in the walls follow me.\n\nSomewhere below there is a sound like a fist on a door, sixty times a minute. It gets faster when I get closer.' },
  { pool: 'flesh', title: 'Anatomy, drawn in blood', body: 'Four knots of nerve, one in each quarter of the body. They feed the membrane round the heart.\n\nCut them and the Shift can\'t shield itself.\n\nCut them and it will feel every one.' },
  { pool: 'flesh', title: 'Last entry', body: 'The white ones come when it hurts. Don\'t stay where you bled. Keep moving and they lose your scent.\n\nI bled. I\'m writing this sitting down.' },
  { pool: 'flesh', title: 'Note pinned with a knife', body: 'If you\'re reading this you got further than ██ of us.\n\nIts heart beats faster when it\'s afraid. So does mine.\n\nMake it count.' },
  { pool: 'end', title: 'Unsigned', body: 'The ground is cold this morning. Only cold. The wells run clear.\n\nSomewhere under every island there is another one sleeping. ████████████.\n\nRest, hunter. Then go and find it.' },
];
export function giveFile(pool) {
  const i = FILES.findIndex((f, k) => f.pool === pool && !G.prog.files[k]);
  if (i < 0) return false;
  G.prog.files[i] = 1; sfx('upgrade');
  setTimeout(() => toast('File recovered', `"${FILES[i].title}". Read it from the pause menu.`, 4), 900);
  return true;
}

// ================= searching houses and bodies =================
export function startSearch(target) { G.search = { target, t: 0, dur: target.type === 'corpse' ? 0.9 : 1.2 }; sfx('rummage'); }
export function updateSearch(dt) {
  const S = G.search; if (!S) return;
  if (G.P.moving || G.fade || G.P.dead) { G.search = null; return; }
  S.t += dt; if (Math.random() < dt * 5) sfx('rummage');
  if (S.t >= S.dur) { G.search = null; if (S.target.type === 'corpse') searchCorpse(S.target); else searchStash(S.target); }
}
export function stashSearchable(st) { const last = G.prog.houses[st.key]; return last === undefined || last < G.dayN; }
export function searchStash(st) {
  const P = G.P, town = st.town, first = G.prog.houses[st.key] === undefined, R = Math.random, found = [];
  if (!stashSearchable(st)) { toast('Already searched', 'Nothing new until tomorrow.', 2.4); return; }
  G.prog.houses[st.key] = G.dayN;
  if (first) {
    const gunP = town.fog ? 0.2 : town.kind === 'city' ? 0.13 : town.kind === 'village' ? 0.08 : 0.07;
    if (R() < gunP) { const id = nextGun(P, town.kind === 'city' || town.fog); if (id) { giveGun(P, id); found.push(gunPop(id)); } }
    if (R() < 0.6) { const t = ammoTypeFor(P), n = ammoAmt(t, town.fog ? 1.2 : 0.8); giveAmmo(P, t, n); found.push(ammoPop(t, n)); }
    if (R() < 0.16 && giveMed(P)) found.push(MED_POP);
    if (R() < 0.1 && giveFile('surface')) found.push(FILE_POP);
  } else {
    if (R() < 0.5) { const t = ammoTypeFor(P), n = ammoAmt(t, 0.5); giveAmmo(P, t, n); found.push(ammoPop(t, n)); }
    if (R() < 0.1 && giveMed(P)) found.push(MED_POP);
  }
  if (found.length) { sfx('pickup'); popAll(found); }
  else toast('Nothing', pick(R, ['Empty drawers. Someone got here first.', 'Just dust, and a smell of iron.', 'Nothing useful. The floor is warm.', 'A cold dinner, half eaten. Nobody home.']), 2.8);
  saveGame();
}
function searchCorpse(c) {
  const P = G.P, found = []; c.searched = true; G.prog.searched[c.key] = 1;
  const k = c.pool === 'surface' ? 1 : c.pool === 'flesh' ? 2 : 1.5;
  if (c.pool === 'surface' && !P.guns.some(g => g.id === 'shotgun') && Math.random() < 0.3) { giveGun(P, 'shotgun'); found.push(gunPop('shotgun')); }
  const t = c.pool === 'surface' ? (Math.random() < 0.5 ? 'shell' : 'heavy') : ammoTypeFor(P), n = ammoAmt(t, k);
  giveAmmo(P, t, n); found.push(ammoPop(t, n));
  if ((c.pool !== 'surface' || Math.random() < 0.5) && giveMed(P)) found.push(MED_POP);
  let gotFile = giveFile(c.pool);
  // shorter descents on easier modes: the deepest hunter carries the pages of the floors you skip
  if (c.pool.startsWith('maze') && +c.pool.slice(4) >= floorsN()) for (let k = 1; k <= 3; k++) gotFile = giveFile('maze' + k) || gotFile;
  if (gotFile) found.push(FILE_POP);
  sfx('pickup'); popAll([[c.pool === 'surface' ? 'A quarantine warden' : 'A hunter, long dead', '#c8b8ac'], ...found]);
  saveGame();
}
// ---- pop-ups: what you just picked up, floating over your head ----
export const MED_POP = ['+1 medkit', '#ff8a8a'], FILE_POP = ['+1 file (pause menu to read)', '#b8d0ff'];
export function ammoPop(t, n) { return [`+${n} ${AMMO_NAME[t]}`, '#ffe29a']; }
export function gunPop(id) { return ['New gun: ' + GUNS[id].name, '#ffffff']; }
export function popAll(list) { list.forEach(([text, col], i) => pop(text, col, i * 0.55)); }
export function giveMed(P) { if (P.meds >= 5) return false; P.meds++; return true; }
export function listText(a) { return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }
