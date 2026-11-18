import { dist, TS } from './core.js';
import { DIFF, firstNightTown, floorsN } from './difficulty.js';
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
  if (L.kind === 'maze') return L.depth >= floorsN() ? 'Goal: find the way into the Shift (red glow)' : L.stage === 'gradient' ? 'Goal: go in, and find the stairs down (red glow)' : 'Goal: find the stairs down (red glow)';
  if (L.kind === 'house') return 'Search the cupboards. Leave by the mat.';
  const ft = firstNightTown(); if (ft) return `Goal: check on ${ft.name}`;
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
let HEART_WARN_T = 0;
export function fleshNudges(L, dt) {
  // if you walk up to a shielded heart, say why it won't die
  HEART_WARN_T -= dt;
  const h = L.heart, P = G.P; if (!h || h.dead || G.prog.won || HEART_WARN_T > 0) return;
  if (gangliaLeft(L) && dist(h.x, h.y, P.x, P.y) < TS * 9) { HEART_WARN_T = 20; toast('The heart is shielded', `${gangliaLeft(L)} ${gangliaLeft(L) === 1 ? 'nerve still feeds' : 'nerves still feed'} it. Follow the purple arrow.`, 4.5); }
}

// ================= how to play =================
// from: 'title' or 'menu', so Back returns to the right place
export function showHowTo(from) {
  const now = G.running && G.L ? `<p class="now"><b>Right now:</b> ${goalText().replace(/^Goal: /, '')}</p>` : '';
  $('howtoBody').innerHTML = `${now}
    <h3>Controls</h3>
    <table class="ctl">
      <tr><th></th><th>Touch</th><th>Keyboard</th></tr>
      <tr><td>Walk</td><td>Drag anywhere on the left half</td><td>WASD / arrows</td></tr>
      <tr><td>Shoot</td><td>Crosshair button, or tap the right half</td><td>Space</td></tr>
      <tr><td>Use</td><td>Round button above the crosshair</td><td>E</td></tr>
      <tr><td>Swap weapon</td><td>Weapon panel</td><td>Q</td></tr>
      <tr><td>Reload</td><td>Automatic when empty</td><td>R</td></tr>
      <tr><td>Medkit</td><td>Red cross button</td><td>H</td></tr>
      <tr><td>Map</td><td>Map button, top right</td><td>M</td></tr>
      <tr><td>Pause</td><td>Pause button, top right</td><td>Esc / P</td></tr>
    </table>
    <p class="kit">Guns aim at the nearest enemy for you. The Use button changes to whatever is next to you: Talk, Enter, Search, Descend, Climb.</p>
    <h3>The hunt</h3>
    <ul>
      <li><b>Find the old stairs.</b> Talk to villagers. Each one points the way, and once enough have, the stairs show on your map as a red dot.</li>
      <li><b>Stock up.</b> Empty houses can be entered. Search their cupboards and any bodies for guns, ammo and medkits. Anything that sparkles can be used.</li>
      <li><b>Go down.</b> In the mazes, follow the red glow to the stairs down. The last floor leads into the Shift.</li>
      <li><b>Kill it.</b> Inside the Shift, sever the purple nerves, then destroy the heart.</li>
    </ul>
    <h3>Staying alive</h3>
    <ul>
      <li>Towns are safe: nothing follows you in. Healers fix you up for free.</li>
      <li>Night brings more enemies, and wolves. Grey fog towns are quarantined: dangerous, but well stocked.</li>
      <li>Out of ammo? You switch to the bat, which never runs out. Cupboards restock every day.</li>
      <li>If you fall, you wake in the last town you visited${DIFF.perma ? '. Not on Impossible' : ''}.</li>
    </ul>`;
  $('howto').dataset.from = from;
  $('menu').classList.add('hidden'); $('title').classList.add('hidden');
  $('howto').classList.remove('hidden'); $('howto').scrollTop = 0;
}
export function closeHowTo() {
  $('howto').classList.add('hidden');
  $($('howto').dataset.from === 'menu' ? 'menu' : 'title').classList.remove('hidden');
}