import { dist, TS } from './core.js';
import { DIFF, floorsN } from './difficulty.js';
import { gangliaLeft } from './gen_flesh.js';
import { $, ctx, DPR, G, SCALE, SH, SW, toast, txt, UI } from './game.js';

// ================= telling the player what to do next =================
export function goalText() {
  const L = G.L; if (!L) return '';
  if (G.prog.won) return L.kind === 'flesh' ? 'The Shift is dead. Climb out when ready.' : 'The Shift is dead.';
  if (L.kind === 'flesh') {
    const total = L.ganglia.filter(g => g.idx < DIFF.nerves).length, left = gangliaLeft(L);
    return left ? `Goal: sever the nerves  ${total - left}/${total}` : 'Goal: destroy the heart';
  }
  if (L.kind === 'maze') return L.depth >= floorsN() ? 'Goal: find the way into the Shift (red glow)' : 'Goal: find the stairs down (red glow)';
  if (L.kind === 'house') return 'Search the cupboards. Leave by the mat.';
  const known = L.dungeons.some(d => d.seen);
  return known ? 'Goal: go down the old stairs (red on map)' : 'Goal: find the old stairs. Ask villagers.';
}
const toScreen = (x, y) => [(x - G.rc.cx) * SCALE / DPR, (y - G.rc.cy) * SCALE / DPR];
function fleshTarget(L) {
  if (G.prog.won || L.kind !== 'flesh') return null;
  const P = G.P; let best = null, bd = 1e9;
  for (const g of L.ganglia) if (!g.dead) { const d = dist(g.x, g.y, P.x, P.y); if (d < bd) { bd = d; best = g; } }
  if (best) return { e: best, col: '#c890ff', name: 'nerve', d: bd };
  if (L.heart && !L.heart.dead) return { e: L.heart, col: '#ff3048', name: 'heart', d: dist(L.heart.x, L.heart.y, P.x, P.y) };
  return null;
}
// a label over the target when it's on screen, an arrow at the edge when it isn't
export function drawObjective() {
  const L = G.L, t = fleshTarget(L); if (!t || G.fade || G.P.dead) return;
  const s = UI.s, [x, y] = toScreen(t.e.x, t.e.y - t.e.r - 8);
  const onScreen = x > 20 && x < SW - 20 && y > 90 && y < SH - 150;
  if (onScreen) {
    const bob = Math.sin(G.t * 5) * 3 * s;
    txt(t.name === 'heart' ? 'THE HEART' : 'NERVE', x, y - 22 * s + bob, 13 * s, t.col, 'center');
    ctx.fillStyle = t.col; ctx.beginPath(); ctx.moveTo(x - 7 * s, y - 6 * s + bob); ctx.lineTo(x + 7 * s, y - 6 * s + bob); ctx.lineTo(x, y + 2 * s + bob); ctx.closePath(); ctx.fill();
    return;
  }
  const P = G.P, [px, py] = toScreen(P.x, P.y), a = Math.atan2(y - py, x - px), r = Math.min(SW, SH) * 0.36;
  const ax = SW / 2 + Math.cos(a) * r, ay = SH / 2 + Math.sin(a) * r;
  ctx.globalAlpha = 0.8 + 0.2 * Math.sin(G.t * 6);
  ctx.save(); ctx.translate(ax, ay); ctx.rotate(a); ctx.fillStyle = t.col; ctx.strokeStyle = '#1a0610'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(18 * s, 0); ctx.lineTo(-9 * s, -11 * s); ctx.lineTo(-3 * s, 0); ctx.lineTo(-9 * s, 11 * s); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore(); ctx.globalAlpha = 1;
  txt(`${t.name} ${Math.round(t.d / TS)} m`, ax, ay + 17 * s, 12 * s, t.col, 'center');
}
export function showFleshGuide() {
  const n = DIFF.nerves;
  $('guideBody').innerHTML = `
    <p><b>1.</b> Find the <span style="color:#7a3aa8">${n} nerves</span>: purple knots that pulse. The purple arrow on screen always points to the nearest one.</p>
    <p><b>2.</b> Shoot or hit each nerve until it bursts.</p>
    <p><b>3.</b> When the last nerve goes, the heart's shield drops. Follow the <span style="color:#b01828">red arrow</span> to the heart and destroy it.</p>
    <p class="kit">When you hurt it, white cells come hunting. Keep moving and they lose you. The mouth you came in by takes you back up. Your goal is always shown under the place name.</p>`;
  G.paused = true; $('guide').classList.remove('hidden');
}
export function showHelp() {
  $('menu').classList.add('hidden');
  if (G.L.kind === 'flesh') { showFleshGuide(); $('guideTitle').textContent = 'INSIDE THE SHIFT · WHAT TO DO'; return; }
  $('guideTitle').textContent = 'WHAT TO DO';
  $('guideBody').innerHTML = `
    <p><b>On the surface:</b> villagers tell you which way the old stairs are. Once enough of them have said it, the stairs appear on your map as a red dot. A red arrow points the way after each hint.</p>
    <p><b>Supplies:</b> walk into empty houses and search the cupboards for guns, ammo and medkits. Lived-in houses stay locked. Healers in towns fix you up for free.</p>
    <p><b>The mazes:</b> follow the red glow to the stairs down. The last floor leads into the Shift.</p>
    <p><b>Inside the Shift:</b> sever the purple nerves, then destroy the heart.</p>
    <p class="kit">Right now: ${goalText()}</p>`;
  G.paused = true; $('guide').classList.remove('hidden');
}
let HEART_WARN_T = 0;
export function fleshNudges(L, dt) {
  // if you walk up to a shielded heart, say why it won't die
  HEART_WARN_T -= dt;
  const h = L.heart, P = G.P; if (!h || h.dead || G.prog.won || HEART_WARN_T > 0) return;
  if (gangliaLeft(L) && dist(h.x, h.y, P.x, P.y) < TS * 9) { HEART_WARN_T = 20; toast('The heart is shielded', `${gangliaLeft(L)} ${gangliaLeft(L) === 1 ? 'nerve still feeds' : 'nerves still feed'} it. Follow the purple arrow.`, 4.5); }
}
