// Звуки без файлов: короткие синтезированные «бульки», «пыхи» и «тыки» (Web Audio).
// Браузер разрешает звук только после первого касания — контекст создаётся тогда же.
let ctx = null;
let on = true;
try { on = localStorage.getItem('sunny-home-sound') !== '0'; } catch (e) { /* без хранилища — звук включён */ }

function audio() {
  if (!on) return null;
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  } catch (e) { return null; }
}

function tone({ f0, f1, dur = 0.15, type = 'sine', vol = 0.12, delay = 0 }) {
  const a = audio(); if (!a) return;
  const t = a.currentTime + delay, o = a.createOscillator(), g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(a.destination);
  o.start(t); o.stop(t + dur + 0.02);
}

const SOUNDS = {
  pick:   () => tone({ f0: 420, f1: 720, dur: 0.09, type: 'triangle', vol: 0.08 }),
  drop:   () => tone({ f0: 240, f1: 110, dur: 0.12, type: 'sine', vol: 0.14 }),
  land:   () => { tone({ f0: 300, f1: 140, dur: 0.1, vol: 0.12 }); tone({ f0: 520, f1: 480, dur: 0.06, type: 'triangle', vol: 0.04, delay: 0.05 }); },
  pop:    () => tone({ f0: 600, f1: 900, dur: 0.08, type: 'sine', vol: 0.1 }),
  boing:  () => { tone({ f0: 300, f1: 620, dur: 0.18, type: 'triangle', vol: 0.1 }); tone({ f0: 620, f1: 440, dur: 0.14, type: 'sine', vol: 0.06, delay: 0.16 }); },
  meow:   () => { tone({ f0: 700, f1: 1100, dur: 0.12, type: 'sine', vol: 0.07 }); tone({ f0: 1100, f1: 600, dur: 0.22, type: 'sine', vol: 0.06, delay: 0.11 }); },
  stash:  () => { tone({ f0: 800, f1: 300, dur: 0.16, type: 'triangle', vol: 0.08 }); },
  nope:   () => { tone({ f0: 330, f1: 300, dur: 0.08, type: 'triangle', vol: 0.06 }); tone({ f0: 300, f1: 260, dur: 0.1, type: 'triangle', vol: 0.06, delay: 0.09 }); },
  open:   () => { tone({ f0: 180, f1: 260, dur: 0.12, type: 'triangle', vol: 0.09 }); tone({ f0: 700, f1: 900, dur: 0.08, type: 'sine', vol: 0.05, delay: 0.08 }); },
  close:  () => { tone({ f0: 260, f1: 140, dur: 0.1, type: 'triangle', vol: 0.1 }); tone({ f0: 120, f1: 90, dur: 0.06, type: 'sine', vol: 0.08, delay: 0.07 }); },
  tvOn:   () => { tone({ f0: 1400, f1: 1500, dur: 0.05, type: 'square', vol: 0.025 }); tone({ f0: 300, f1: 900, dur: 0.22, type: 'sine', vol: 0.07, delay: 0.04 }); },
  tvOff:  () => { tone({ f0: 900, f1: 120, dur: 0.18, type: 'sine', vol: 0.07 }); },
  lampOn: () => { tone({ f0: 1200, f1: 1000, dur: 0.04, type: 'triangle', vol: 0.06 }); tone({ f0: 520, f1: 780, dur: 0.16, type: 'sine', vol: 0.05, delay: 0.03 }); },
  lampOff:() => { tone({ f0: 1000, f1: 800, dur: 0.04, type: 'triangle', vol: 0.06 }); },
  lid:    () => { tone({ f0: 500, f1: 380, dur: 0.07, type: 'triangle', vol: 0.08 }); },
  flush:  () => { for (let k = 0; k < 6; k++) tone({ f0: 900 - k * 110, f1: 300 - k * 30, dur: 0.22, type: 'sine', vol: 0.05, delay: k * 0.08 }); tone({ f0: 160, f1: 90, dur: 0.5, type: 'triangle', vol: 0.05, delay: 0.05 }); },
  waterOn: () => { for (let k = 0; k < 5; k++) tone({ f0: 700 + ((k * 37) % 5) * 90, f1: 1100 + k * 40, dur: 0.07, type: 'sine', vol: 0.04, delay: k * 0.05 }); },
  waterOff: () => { tone({ f0: 900, f1: 600, dur: 0.06, type: 'sine', vol: 0.05 }); tone({ f0: 300, f1: 200, dur: 0.06, type: 'triangle', vol: 0.05, delay: 0.05 }); },
  click:  () => tone({ f0: 900, f1: 700, dur: 0.05, type: 'triangle', vol: 0.05 }),
  whoosh: () => tone({ f0: 200, f1: 500, dur: 0.2, type: 'sawtooth', vol: 0.02 }),
};

export function play(name) { try { SOUNDS[name]?.(); } catch (e) { /* звук не обязателен */ } }
export const soundOn = () => on;
export function setSound(v) {
  on = !!v;
  try { localStorage.setItem('sunny-home-sound', on ? '1' : '0'); } catch (e) { /* ничего */ }
  if (on) play('click');
}
