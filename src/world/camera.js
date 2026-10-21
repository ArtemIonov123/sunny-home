// Камера — одно число x: левый край видимой части дома в игровых единицах.
// Плавный полёт к цели, инерция после листания, ограничение краями дома.
import { clamp } from '../util.js';

export function createCamera() {
  const cam = {
    x: 0, target: 0, vel: 0, viewW: 1600, worldW: 1600,
    mode: 'idle', // idle | fly | coast | hold

    limits() {
      const max = Math.max(0, cam.worldW - cam.viewW);
      return cam.worldW <= cam.viewW ? [(cam.worldW - cam.viewW) / 2, (cam.worldW - cam.viewW) / 2] : [0, max];
    },
    clampX(x) { const [a, b] = cam.limits(); return clamp(x, a, b); },

    flyTo(x) { cam.target = cam.clampX(x); cam.mode = 'fly'; cam.vel = 0; },
    // Пальцем: камера идёт строго за пальцем, без задержки.
    holdAt(x) { cam.x = cam.clampX(x); cam.target = cam.x; cam.mode = 'hold'; },
    release(vel) { cam.vel = vel; cam.mode = Math.abs(vel) > 60 ? 'coast' : 'idle'; },
    nudge(dx) { cam.x = cam.clampX(cam.x + dx); cam.target = cam.x; },

    // Возвращает true, пока камера движется (нужен следующий кадр).
    update(dt) {
      if (cam.mode === 'fly') {
        cam.x += (cam.target - cam.x) * (1 - Math.exp(-9 * dt));
        if (Math.abs(cam.target - cam.x) < 0.5) { cam.x = cam.target; cam.mode = 'idle'; }
        return cam.mode !== 'idle';
      }
      if (cam.mode === 'coast') {
        const before = cam.x;
        cam.x = cam.clampX(cam.x + cam.vel * dt);
        cam.vel *= Math.exp(-3.5 * dt);
        if (Math.abs(cam.vel) < 20 || cam.x === before) { cam.mode = 'idle'; cam.vel = 0; }
        return cam.mode !== 'idle';
      }
      const fixed = cam.clampX(cam.x);
      if (fixed !== cam.x) { cam.x = fixed; return true; }
      return false;
    },
  };
  return cam;
}
