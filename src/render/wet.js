// Мокрые герои и животные: постоял под душем (или под краном) — ещё немного с него капает,
// под ногами лужица, которая подсыхает. Животное, выйдя из-под воды, отряхивается брызгами.
// Ничего не сохраняется: «мокрость» живёт только пока открыта игра.
const DRY = 2;             // сколько секунд капает и сохнет после воды
const now = () => performance.now() / 1000;
const st = new Map();      // ключ ('char:girl', 'item:12') → { until, under (когда последний раз под водой), shook }

// Этот кадр — под водой.
export function soak(key) {
  const t = now(), s = st.get(key) || { until: 0, under: 0, shook: true };
  s.under = t; s.until = t + DRY; s.shook = false;
  st.set(key, s);
}
// Насколько мокрый: 1 — только что из-под воды, 0 — сухой.
export function wetness(key) {
  const s = st.get(key); if (!s) return 0;
  const v = (s.until - now()) / DRY;
  if (v <= 0) { st.delete(key); return 0; }
  return Math.min(1, v);
}
export const underWater = (key) => { const s = st.get(key); return !!s && now() - s.under < 0.25; };
// Только что вышел из-под воды и ещё не отряхивался (для животных). Отряхнулся — сохнет быстрее.
export function wantsShake(key) {
  const s = st.get(key);
  if (!s || s.shook || now() - s.under < 0.4) return false;
  s.shook = true; s.until = now() + DRY * 0.35;
  return true;
}
export const anyWet = () => st.size > 0;

// Детерминированный «случайный» шум (без хранения капель).
const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

// Капли с героя/животного: b — рамка (мир), from — откуда капает (доли высоты: [верх, низ]), ground — пол.
export function drawDrips(ctx, b, level, seed = 0, from = [0.12, 0.65], ground = b.y + b.h) {
  if (level <= 0) return;
  const t = now(), N = 12;
  ctx.save();
  for (let k = 0; k < N; k++) {
    const P = 0.35 + hash(seed + k) * 0.35, off = hash(seed + k * 7) * P, cyc = Math.floor((t + off) / P), q = ((t + off) % P) / P;
    if (hash(seed + k * 13 + cyc * 3.1) > level * 0.95) continue; // сохнет — капель меньше
    const x = b.x + b.w * (0.22 + 0.56 * hash(seed + k * 3 + cyc)), y0 = b.y + b.h * (from[0] + (from[1] - from[0]) * hash(seed + k * 5 + cyc));
    if (q < 0.85) {
      const y = y0 + (ground - y0) * (q / 0.85) ** 2;
      ctx.fillStyle = 'rgba(150,215,255,.9)';
      ctx.beginPath(); ctx.ellipse(x, y, 3.8, 6.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.8)';
      ctx.beginPath(); ctx.arc(x - 1, y - 2, 1.2, 0, Math.PI * 2); ctx.fill();
    } else { // шлёп о пол
      const s = (q - 0.85) / 0.15;
      ctx.strokeStyle = `rgba(150,215,255,${0.8 * (1 - s)})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(x, ground - 2, 4 + s * 9, 1.5 + s * 2.5, 0, 0, Math.PI * 2); ctx.stroke();
    }
  }
  ctx.restore();
}

// Лужица под ногами — растёт, пока мокрый, и подсыхает.
export function drawPuddle(ctx, cx, y, w, level) {
  if (level <= 0) return;
  ctx.save();
  ctx.fillStyle = `rgba(140,205,250,${0.32 * level})`;
  ctx.beginPath(); ctx.ellipse(cx, y, w * (0.35 + 0.25 * level), 7 + 5 * level, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = `rgba(255,255,255,${0.3 * level})`;
  ctx.beginPath(); ctx.ellipse(cx - w * 0.12, y - 2, w * 0.08, 2, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// Брызги, когда животное отряхивается: летят в стороны от туловища. p — 0..1 (время отряхивания).
export function drawShakeSpray(ctx, b, p, seed = 0) {
  ctx.save();
  ctx.fillStyle = 'rgba(150,215,255,.9)';
  for (let k = 0; k < 16; k++) {
    const side = k % 2 ? 1 : -1, a = (hash(seed + k) - 0.5) * 1.6, sp = 60 + hash(seed + k * 3) * 90;
    const x = b.x + b.w / 2 + side * (b.w * 0.25 + Math.cos(a) * sp * p), y = b.y + b.h * 0.45 + Math.sin(a) * sp * p + 120 * p * p;
    const r = 3.5 * (1 - p) + 1;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}
