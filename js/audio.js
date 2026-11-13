import { G } from './game.js';

// ================= synthesized audio =================
export const AU = { ctx: null, master: null, on: true, beatT: 0, ready: false };
function auInit() {
  if (AU.ctx) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext; AU.ctx = new AC();
    AU.master = AU.ctx.createGain(); AU.master.gain.value = 0.7; AU.master.connect(AU.ctx.destination);
    const n = AU.ctx.sampleRate * 2, b = AU.ctx.createBuffer(1, n, AU.ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    AU.noise = b;
    const src = AU.ctx.createBufferSource(); src.buffer = b; src.loop = true;
    const lp = AU.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 400;
    const g = AU.ctx.createGain(); g.gain.value = 0; src.connect(lp); lp.connect(g); g.connect(AU.master); src.start();
    AU.amb = { lp, g };
    const o = AU.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 46;
    const o2 = AU.ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = 69.3;
    const og = AU.ctx.createGain(); og.gain.value = 0; o.connect(og); o2.connect(og); og.connect(AU.master); o.start(); o2.start();
    AU.drone = { o, o2, g: og };
    AU.ready = true;
  } catch (e) { AU.ctx = null; }
}
export function auResume() { if (!AU.ctx) auInit(); if (AU.ctx && AU.ctx.state === 'suspended') AU.ctx.resume().catch(() => {}); }
function tone(freq, dur, type = 'square', vol = 0.2, slide = 0, delay = 0) {
  if (!AU.ready || !AU.on) return;
  const t = AU.ctx.currentTime + delay, o = AU.ctx.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
  const g = AU.ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
  o.connect(g); g.connect(AU.master); o.start(t); o.stop(t + dur + 0.05);
}
function noiseHit(dur, freq, vol, delay = 0, type = 'bandpass', q = 1) {
  if (!AU.ready || !AU.on) return;
  const t = AU.ctx.currentTime + delay, s = AU.ctx.createBufferSource(); s.buffer = AU.noise;
  const f = AU.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = AU.ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
  s.connect(f); f.connect(g); g.connect(AU.master); s.start(t, Math.random()); s.stop(t + dur + 0.05);
}
export function sfx(name) {
  switch (name) {
    case 'swing': noiseHit(0.12, 2600, 0.22, 0, 'highpass'); break;
    case 'hit': tone(190, 0.1, 'square', 0.12, 0.5); noiseHit(0.08, 1200, 0.2); break;
    case 'kill': tone(320, 0.22, 'square', 0.12, 0.3); noiseHit(0.2, 600, 0.18, 0, 'lowpass'); break;
    case 'hurt': tone(130, 0.28, 'sawtooth', 0.18, 0.5); break;
    case 'pickup': tone(660, 0.08, 'square', 0.1); tone(990, 0.14, 'square', 0.1, 1, 0.08); break;
    case 'upgrade': [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.18, 'square', 0.09, 1, i * 0.09)); break;
    case 'descend': tone(220, 1.1, 'sine', 0.25, 0.25); noiseHit(1.0, 300, 0.22, 0, 'lowpass'); break;
    case 'ascend': tone(110, 0.9, 'sine', 0.22, 3); break;
    case 'talk': tone(420 + Math.random() * 90, 0.04, 'square', 0.04); break;
    case 'heal': [392, 494, 587].forEach((f, i) => tone(f, 0.3, 'sine', 0.12, 1, i * 0.1)); break;
    case 'pulse': tone(150, 0.7, 'sine', 0.25, 3); noiseHit(0.5, 900, 0.12); break;
    case 'squelch': noiseHit(0.22, 480, 0.25, 0, 'lowpass'); tone(90, 0.2, 'sine', 0.2, 0.6); break;
    case 'spit': noiseHit(0.12, 1500, 0.16); tone(300, 0.1, 'sine', 0.08, 0.5); break;
    case 'chirp': { const f = 2200 + Math.random() * 900; tone(f, 0.07, 'sine', 0.035, 1.3); tone(f * 1.1, 0.06, 'sine', 0.03, 0.8, 0.1); break; }
    case 'howl': tone(380, 1.4, 'sine', 0.04, 1.6); break;
    case 'static': for (let k = 0; k < 5; k++) noiseHit(0.05 + Math.random() * 0.08, 1800 + Math.random() * 1500, 0.05, k * 0.09 + Math.random() * 0.05, 'bandpass', 3); break;
    case 'siren': tone(480, 1.8, 'sine', 0.035, 1.45); tone(700, 1.8, 'sine', 0.03, 0.68, 1.8); break;
    case 'shot': { const D = arguments[1] || {}; const k = D.kick || 1;
      noiseHit(0.08 + k * 0.03, 900 + 400 / k, 0.22 + k * 0.03, 0, 'lowpass', 0.7); tone(140 - k * 12, 0.08 + k * 0.025, 'square', 0.1 + k * 0.02, 0.4);
      if (D.pellets > 1) noiseHit(0.25, 400, 0.25, 0.01, 'lowpass'); break; }
    case 'click': tone(1800, 0.03, 'square', 0.06); break;
    case 'reload': tone(900, 0.04, 'square', 0.05); tone(600, 0.05, 'square', 0.05, 1, 0.08); break;
    case 'reload2': tone(1200, 0.04, 'square', 0.06); tone(700, 0.06, 'square', 0.06, 1, 0.05); break;
    case 'rummage': noiseHit(0.1 + Math.random() * 0.1, 1200 + Math.random() * 1600, 0.05, 0, 'bandpass', 2); break;
    case 'drag': noiseHit(0.5, 160, 0.3, 0, 'lowpass', 1); tone(55, 0.5, 'sawtooth', 0.06, 0.7); break;
    case 'entrance': [330, 311, 294, 262].forEach((f, i) => tone(f, 0.9, 'sine', 0.05, 0.98, i * 0.35)); break;
    case 'door': noiseHit(0.25, 300, 0.15, 0, 'lowpass'); tone(180, 0.2, 'triangle', 0.05, 0.8); break;
    case 'knock': for (let k = 0; k < 3; k++) { noiseHit(0.06, 220, 0.3, k * 0.18, 'lowpass', 2); tone(90, 0.06, 'sine', 0.2, 0.7, k * 0.18); } break;
    case 'roar': tone(70, 1.5, 'sawtooth', 0.22, 0.5); noiseHit(1.4, 200, 0.3, 0, 'lowpass'); break;
  }
}
function heartbeat(vol) {
  if (!AU.ready || !AU.on || vol < 0.005) return;
  tone(62, 0.18, 'sine', vol, 0.55); tone(54, 0.16, 'sine', vol * 0.75, 0.55, 0.22);
}
// env: {wind, windF, drone, droneF, bpm, beatVol}
export function auUpdate(dt, env) {
  // the beat clock runs even when muted so visuals stay in sync
  AU.beatT -= dt;
  if (AU.beatT <= 0) { AU.beatT = 60 / env.bpm; G.beat = 0; heartbeat(env.beatVol); }
  if (!AU.ready) return;
  const t = AU.ctx.currentTime, on = AU.on ? 1 : 0;
  AU.amb.g.gain.setTargetAtTime(env.wind * on, t, 0.6);
  AU.amb.lp.frequency.setTargetAtTime(env.windF, t, 0.6);
  AU.drone.g.gain.setTargetAtTime(env.drone * on, t, 0.9);
  AU.drone.o.frequency.setTargetAtTime(env.droneF, t, 0.9);
  AU.drone.o2.frequency.setTargetAtTime(env.droneF * 1.5, t, 0.9);
}
