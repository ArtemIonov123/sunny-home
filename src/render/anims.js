// Короткие анимации «живости»: падение с отскоком, покачивание, прыжок героя, возврат на место.
// Это не данные игры — в сохранение не попадают. Ключ: 'item:12' или 'char:girl'.
const list = new Map();
const now = () => performance.now() / 1000;

const easeOutBack = (t) => 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2);

export const anims = {
  // Падение: начинается на dy выше конечной точки (dy < 0), в конце — лёгкий «плюх».
  fall(key, dy, dx = 0) {
    if (Math.abs(dy) < 4 && Math.abs(dx) < 4) return this.squash(key);
    const dur = Math.min(0.55, 0.16 + Math.sqrt(Math.abs(dy)) / 55);
    list.set(key, { type: 'fall', t0: now(), dur, dy, dx });
  },
  squash(key) { list.set(key, { type: 'squash', t0: now(), dur: 0.28 }); },
  // delay — очередь (холодильник: вещи качаются одна за другой)
  wobble(key, delay = 0) { list.set(key, { type: 'wobble', t0: now() + delay, dur: 0.6 }); },
  hop(key) { list.set(key, { type: 'hop', t0: now(), dur: 0.5 }); },
  // Будильник: звенит — часто дрожит и подпрыгивает, затихая.
  ring(key) { list.set(key, { type: 'ring', t0: now(), dur: 1.3 }); },
  // Прибор работает: мелко трясётся всё время готовки.
  shake(key, dur) { list.set(key, { type: 'shake', t0: now(), dur }); },
  // Прибор работает: подпрыгивает (тостер).
  bounce(key, dur) { list.set(key, { type: 'bounce', t0: now(), dur }); },
  // Готовое выпрыгивает из прибора: по дуге от (dx, dy) до своего места.
  pop(key, dx, dy) { list.set(key, { type: 'pop', t0: now(), dur: 0.6, dx, dy }); },
  // Вернуться туда, откуда взяли (если положить некуда).
  back(key, dx, dy) { list.set(key, { type: 'back', t0: now(), dur: 0.35, dx, dy }); },

  active() {
    const t = now();
    for (const [k, a] of list) if (t - a.t0 > a.dur) list.delete(k); // t0 может быть в будущем (очередь)
    return list.size > 0;
  },

  // Смещение и поворот для отрисовки: { dx, dy, rot, sx, sy }.
  pose(key) {
    const a = list.get(key);
    if (!a) return null;
    const p = Math.max(0, Math.min(1, (now() - a.t0) / a.dur)); // до начала (очередь) p = 0
    switch (a.type) {
      case 'fall': {
        if (p < 0.8) { const q = p / 0.8; return { dx: a.dx * (1 - q), dy: a.dy * (1 - q * q), rot: 0, sx: 1, sy: 1 }; }
        const q = (p - 0.8) / 0.2, s = Math.sin(q * Math.PI) * 0.12;
        return { dx: 0, dy: 0, rot: 0, sx: 1 + s, sy: 1 - s };
      }
      case 'squash': { const s = Math.sin(p * Math.PI) * 0.1; return { dx: 0, dy: 0, rot: 0, sx: 1 + s, sy: 1 - s }; }
      case 'wobble': return { dx: 0, dy: 0, rot: Math.sin(p * Math.PI * 5) * 0.12 * (1 - p), sx: 1, sy: 1 };
      case 'hop': {
        const up = Math.sin(p * Math.PI);
        return { dx: 0, dy: -60 * up, rot: Math.sin(p * Math.PI * 2) * 0.06, sx: 1 - 0.05 * up, sy: 1 + 0.07 * up };
      }
      case 'ring': { const f = (1 - p) ** 0.6; return { dx: Math.sin(p * 90) * 2.5 * f, dy: -Math.abs(Math.sin(p * 45)) * 6 * f, rot: Math.sin(p * 110) * 0.16 * f, sx: 1, sy: 1 }; }
      case 'shake': { const f = Math.min(1, (1 - p) * 6, p * 10); return { dx: Math.sin(p * a.dur * 80) * 3 * f, dy: -Math.abs(Math.sin(p * a.dur * 47)) * 2 * f, rot: Math.sin(p * a.dur * 63) * 0.03 * f, sx: 1, sy: 1 }; }
      case 'bounce': { const f = Math.min(1, (1 - p) * 6, p * 10), u = Math.abs(Math.sin(p * a.dur * 9)); return { dx: 0, dy: -u * 9 * f, rot: 0, sx: 1 + (1 - u) * 0.04 * f, sy: 1 - (1 - u) * 0.04 * f }; }
      case 'pop': {
        if (p < 0.82) { const q = p / 0.82; return { dx: a.dx * (1 - q), dy: a.dy * (1 - q) - 140 * 4 * q * (1 - q), rot: (1 - q) * 0.6 * Math.sign(-a.dx || 1), sx: 0.6 + 0.4 * Math.min(1, q * 2), sy: 0.6 + 0.4 * Math.min(1, q * 2) }; }
        const q = (p - 0.82) / 0.18, s = Math.sin(q * Math.PI) * 0.14; return { dx: 0, dy: 0, rot: 0, sx: 1 + s, sy: 1 - s };
      }
      case 'back': { const q = easeOutBack(p); return { dx: a.dx * (1 - q), dy: a.dy * (1 - q), rot: 0, sx: 1, sy: 1 }; }
      default: return null;
    }
  },
};
