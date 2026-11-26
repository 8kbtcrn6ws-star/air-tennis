// All sounds are synthesised with WebAudio at runtime. No audio files.
let ctx = null;
let master = null;
let noiseBuf = null;
export const audio = { muted: false, volume: 0.7 };

function ensure() {
  if (ctx) return ctx;
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = audio.volume;
  master.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return ctx;
}

export function unlockAudio() {
  const c = ensure();
  if (c && c.state === "suspended") c.resume().catch(() => {});
}

export function setVolume(v) {
  audio.volume = v;
  if (master) master.gain.value = v;
}

function tone(freq, dur, type = "sine", gain = 0.3, slideTo = null, when = 0) {
  const c = ensure();
  if (!c || audio.muted) return;
  const t = c.currentTime + when;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur, freq, q = 1, gain = 0.3, type = "bandpass", when = 0, attack = 0.003) {
  const c = ensure();
  if (!c || audio.muted) return;
  const t = c.currentTime + when;
  const s = c.createBufferSource();
  s.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(master);
  s.start(t, Math.random() * 0.5);
  s.stop(t + dur + 0.05);
}

export const sfx = {
  hit(power = 0.5, perfect = false) {
    // punchy "thwack": sharp noise crack + body thump + string ping
    noise(0.05, 3000 + power * 1500, 1.8, 0.7);
    noise(0.12, 900, 1.2, 0.35, "lowpass");
    tone(180 + power * 90, 0.11, "triangle", 0.45, 90);
    tone(1500, 0.05, "sine", 0.08, 900);
    if (perfect) { tone(880, 0.18, "sine", 0.12, 1320, 0.02); tone(1320, 0.22, "sine", 0.08, 1760, 0.06); }
  },
  aiHit() { noise(0.07, 2000, 2.5, 0.4); tone(200, 0.08, "triangle", 0.25, 110); },
  bounce() { tone(140, 0.08, "sine", 0.3, 70); noise(0.04, 900, 1, 0.12); },
  net() { noise(0.25, 500, 0.8, 0.3, "lowpass"); tone(90, 0.2, "sine", 0.2, 60); },
  swing() { noise(0.18, 1200, 0.7, 0.18, "bandpass", 0, 0.05); },
  miss() { tone(330, 0.16, "square", 0.08, 220); },
  beep(hi = false) { tone(hi ? 1046 : 660, hi ? 0.35 : 0.14, "square", 0.12); },
  cheer(big = false) {
    noise(big ? 2.2 : 1.2, 1800, 0.4, big ? 0.32 : 0.2, "bandpass", 0, 0.25);
    noise(big ? 2.0 : 1.0, 3200, 0.6, big ? 0.18 : 0.1, "bandpass", 0.05, 0.3);
  },
  groan() { noise(0.8, 500, 0.6, 0.18, "lowpass", 0, 0.15); },
  ui() { tone(720, 0.05, "triangle", 0.12); },
  ok() { tone(660, 0.07, "triangle", 0.14); tone(990, 0.1, "triangle", 0.12, null, 0.06); },
  win() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.3, "triangle", 0.16, null, i * 0.12)); }
};

// Upbeat procedural synth loop (original, generated note by note). 120 BPM, 4-bar progression.
const music = { on: false, timer: null, step: 0, next: 0, bus: null };
const PROG = [[45, 57, 60, 64], [41, 53, 57, 60], [36, 48, 52, 55], [43, 55, 59, 62]]; // Am F C G (midi)
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

function note(freq, t, dur, type, gain, dest) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function hat(t, dest, gain = 0.05) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = "highpass";
  f.frequency.value = 7000;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  s.connect(f).connect(g).connect(dest);
  s.start(t, Math.random() * 0.5);
  s.stop(t + 0.06);
}

function kick(t, dest) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.setValueAtTime(140, t);
  o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
  g.gain.setValueAtTime(0.35, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + 0.2);
}

function schedule() {
  const sixteenth = 60 / 120 / 4;
  while (music.next < ctx.currentTime + 0.15) {
    const s = music.step % 64;
    const chord = PROG[Math.floor(s / 16)];
    const t = music.next;
    if (s % 4 === 0) kick(t, music.bus);
    if (s % 2 === 1) hat(t, music.bus);
    if (s % 4 === 0 || s % 4 === 3) note(mtof(chord[0]), t, sixteenth * 1.6, "sawtooth", 0.07, music.bus);
    const arp = [1, 2, 3, 2];
    if (s % 2 === 0) note(mtof(chord[arp[(s / 2) % 4]] + 12), t, sixteenth * 1.4, "square", 0.025, music.bus);
    music.step++;
    music.next += sixteenth;
  }
}

export function setMusic(on) {
  music.on = !!on;
  if (!music.on) {
    if (music.timer) clearInterval(music.timer);
    music.timer = null;
    if (music.bus) { music.bus.disconnect(); music.bus = null; }
    return;
  }
  const c = ensure();
  if (!c || music.timer) return;
  music.bus = c.createGain();
  music.bus.gain.value = 0.55;
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 3200;
  music.bus.connect(lp).connect(master);
  music.next = c.currentTime + 0.05;
  music.timer = setInterval(schedule, 50);
}
export const musicState = music;
