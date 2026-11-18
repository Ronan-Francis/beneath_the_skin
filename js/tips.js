import { clamp, TAU } from './core.js';
import { GUNS, gunOf, isEmpty } from './weapons.js';
import { ctx, G, IN, SH, SW, txt, UI } from './game.js';

// ================= one-time tips =================
// Each tip waits until it matters, points at its control, and is retired for good once you've done it.
// Done tips are remembered across worlds (cleared by "Clear all saves").
const TIP_KEY = 'beneath_the_skin_tips';
let DONE = {};
try { DONE = JSON.parse(localStorage.getItem(TIP_KEY) || '{}') || {}; } catch (e) { DONE = {}; }
export function retireTip(id) { retire(id); }
function retire(id) { if (DONE[id]) return; DONE[id] = 1; try { localStorage.setItem(TIP_KEY, JSON.stringify(DONE)); } catch (e) { } }

const touch = () => IN.mode !== 'keys';
const verb = () => (IN.mode === 'mouse' ? 'Click' : 'Tap');
// progress counters for the current session
const C = { walked: 0, shots: 0, lastX: 0, lastY: 0, playT: 0 };

// what each use-button label means the first time you see it
const USE_TIPS = {
  Talk: 'villagers point the way to the old stairs',
  Heal: 'healers patch you up for free',
  Enter: 'empty houses hold guns, ammo and medkits',
  Search: 'look for guns, ammo and medkits',
  Knock: 'lived-in houses stay locked. Look for empty ones',
  Descend: 'the stairs lead down to the Shift',
  Open: 'supply caches hold ammo and medkits',
};
export function noteUse(label) { if (USE_TIPS[label]) retire('use-' + label); }

const TIPS = [
  { id: 'move', anchor: () => ({ ...UI.stickHome, r: UI.stickR, ghost: true }),
    when: () => true, text: () => (touch() ? 'Drag anywhere on the left side to walk' : 'WASD or the arrow keys to walk') },
  { id: 'shoot', anchor: () => UI.atk,
    when: () => !!G.P.target,
    text: () => { const D = GUNS[gunOf(G.P).id]; return (touch() ? `${verb()} here` : 'Space') + (D.melee ? ' to swing the bat' : ' to shoot. It aims for you'); } },
  { id: 'use', dynamic: true, anchor: () => UI.use,
    when: () => G.use && USE_TIPS[G.use.label] && !DONE['use-' + G.use.label],
    text: () => `${touch() ? verb() : 'E:'} ${G.use.label}: ${USE_TIPS[G.use.label]}` },
  { id: 'med', anchor: () => UI.med,
    when: () => G.P.meds > 0 && G.P.hp <= G.P.maxHp / 2,
    text: () => (touch() ? `Hurt? ${verb()} the red cross` : 'Hurt? Press H') + ' to use a medkit' },
  { id: 'switch', anchor: () => ({ rect: UI.gun }),
    when: () => G.P.guns.filter(g => !GUNS[g.id].melee && !isEmpty(G.P, g)).length >= 1 && G.P.guns.length >= 3,
    text: () => (touch() ? `${verb()} the weapon panel` : 'Press Q') + ' to swap weapons' },
  { id: 'map', anchor: () => UI.mapBtn,
    when: () => G.L.kind === 'over' && (G.over.dungeons.some(d => d.seen) || C.playT > 90),
    text: () => (touch() ? `${verb()} for the map` : 'Press M for the map') + '. Red dots are stairs down' },
  { id: 'help', anchor: () => UI.menuBtn, timed: 9,
    when: () => C.playT > 240,
    text: () => 'Stuck? Pause, then How to play' },
];

let CUR = null, CUR_T = 0, LOST_T = 0;
export function tipsUpdate(dt) {
  const P = G.P; if (!P) return;
  C.playT += dt;
  if (P.moving) C.walked += Math.hypot(P.x - C.lastX, P.y - C.lastY) < 40 ? Math.hypot(P.x - C.lastX, P.y - C.lastY) : 0;
  C.lastX = P.x; C.lastY = P.y;
  if (IN.atkPress) C.shots++;
  // finished?
  if (C.walked > 64) retire('move');
  if (C.shots >= 3) retire('shoot');
  if (IN.medPress && P.hp < P.maxHp) retire('med');
  if (IN.switchPress) retire('switch');
  if (G.mapSeen) retire('map');
  if (CUR) {
    CUR_T += dt;
    const live = !DONE[CUR.id] && (CUR.dynamic ? CUR.when() : true) && !(CUR.timed && CUR_T > CUR.timed);
    if (CUR.timed && CUR_T > CUR.timed) retire(CUR.id);
    // keep a tip up briefly even if it stops applying, so it doesn't flicker
    if (!live || !CUR.when()) LOST_T += dt; else LOST_T = 0;
    if (!live || LOST_T > 1.2) CUR = null;
    return;
  }
  for (const t of TIPS) if (!DONE[t.id] && t.when()) { CUR = t; CUR_T = 0; LOST_T = 0; break; }
}
export function tipsReset() { CUR = null; C.walked = 0; C.shots = 0; C.playT = 0; if (G.P) { C.lastX = G.P.x; C.lastY = G.P.y; } }

export function drawTip() {
  if (!CUR || G.paused || G.fade || G.mapOpen || G.dialog || !G.P || G.P.dead) return;
  const a = clamp(CUR_T / 0.35, 0, 1) * clamp(1 - LOST_T / 1.2, 0, 1); if (a <= 0) return;
  const s = UI.s, an = CUR.anchor(), pulse = 0.5 + 0.5 * Math.sin(CUR_T * 5);
  ctx.save(); ctx.globalAlpha = a;
  // pulsing ring around the control (or a ghost stick where your thumb goes)
  ctx.strokeStyle = `rgba(255,214,120,${0.45 + 0.4 * pulse})`; ctx.lineWidth = 2.5;
  let bx, by, bw, bh, side;
  if (an.rect) {
    const r = an.rect, g = 3 + 3 * pulse; ctx.strokeRect(r.x - g, r.y - g, r.w + 2 * g, r.h + 2 * g);
    bx = r.x; by = r.y + r.h / 2; bw = r.w; bh = r.h; side = 'left';
  } else {
    const rr = an.r + 4 + 4 * pulse;
    if (an.ghost) { ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.beginPath(); ctx.arc(an.x, an.y, an.r, 0, TAU); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.beginPath(); ctx.arc(an.x + Math.sin(CUR_T * 1.6) * an.r * 0.45, an.y, an.r * 0.42, 0, TAU); ctx.fill(); }
    ctx.beginPath(); ctx.arc(an.x, an.y, rr, 0, TAU); ctx.stroke();
    bx = an.x - an.r; by = an.y; bw = bh = an.r * 2; side = an.x < SW / 2 ? 'right' : 'left';
  }
  // the text, in a small dark pill beside the control
  const fs = Math.round(13 * s), msg = CUR.text();
  ctx.font = `${fs}px "Pixelify Sans", ui-monospace, monospace`; // same font txt() draws with
  const maxW = Math.min(SW * 0.42, 300 * s), words = msg.split(' '), lines = []; let ln = '';
  for (const w of words) { const t = ln ? ln + ' ' + w : w; if (ctx.measureText(t).width > maxW && ln) { lines.push(ln); ln = w; } else ln = t; }
  if (ln) lines.push(ln);
  const tw = Math.max(...lines.map(l => ctx.measureText(l).width)), pad = 8 * s, lh = fs * 1.3, ph = lines.length * lh + pad * 1.4, pw = tw + pad * 2;
  let px = side === 'right' ? bx + bw + 14 * s : bx - 14 * s - pw;
  let py = by - ph / 2;
  if (an.ghost) py = by - bh / 2 - ph - 10 * s, px = Math.max(10, bx);
  px = clamp(px, 8, SW - pw - 8); py = clamp(py, 8, SH - ph - 8);
  ctx.fillStyle = 'rgba(14,8,14,0.86)'; ctx.fillRect(px, py, pw, ph);
  ctx.strokeStyle = 'rgba(255,214,150,0.55)'; ctx.lineWidth = 1.5; ctx.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1);
  lines.forEach((l, i) => txt(l, px + pad, py + pad * 0.7 + i * lh, fs, '#ffe9b0'));
  ctx.restore();
}
