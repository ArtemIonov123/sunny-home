// Вода из крана, лейки душа и т. п. — с «физикой»: струя вылетает из точки в своём направлении
// с напором, падает по дуге (тяжесть) и разбивается брызгами на заданной высоте (дно раковины, ванна).
// Ничего не хранится: положение капель считается из времени, поэтому кадры дешёвые.
//
// Параметры (в мире): x, y — откуда; yEnd — докуда падает; width — ширина струи у крана;
// dir — направление в градусах (0 — вниз, плюс — вправо, минус — влево); push — напор 0..1.
const G = 2600;            // тяжесть (единиц мира в секунду²)
const SPEED = 950;         // скорость струи при напоре 1

// Точка струи через время tau после вылета.
function at(x, y, vx, vy, tau) { return [x + vx * tau, y + vy * tau + 0.5 * G * tau * tau]; }
// За сколько струя долетит до высоты yEnd.
function fallTime(y, vy, yEnd) {
  const d = Math.max(1, yEnd - y);
  return Math.min(1.5, (-vy + Math.sqrt(Math.max(0, vy * vy + 2 * G * d))) / G);
}

// Струи: тонкий кран — одна, широкая лейка — веер из нескольких.
export function streams({ x, y, yEnd, width = 8, dir = 0, push = 0 }) {
  const n = width > 40 ? 7 : width > 16 ? 3 : 1;
  const fan = n > 3 ? 22 : n > 1 ? 6 : 0; // разлёт веера, градусы
  const out = [];
  for (let k = 0; k < n; k++) {
    const u = n === 1 ? 0 : k / (n - 1) - 0.5;
    const a = ((dir + u * fan) * Math.PI) / 180, v = Math.max(40, push * SPEED);
    const sx = x + u * width, vx = Math.sin(a) * v, vy = Math.cos(a) * v;
    out.push({ sx, sy: y, vx, vy, T: fallTime(y, vy, yEnd), thick: n > 1 ? 4 : Math.max(5, Math.min(12, width * 0.6)) });
  }
  return out;
}

// Нарисовать путь струй (для студии и для игры).
export function drawStreams(ctx, list, alpha = 0.6) {
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = `rgba(120,200,255,${alpha})`;
  for (const s of list) {
    ctx.lineWidth = s.thick;
    ctx.beginPath();
    for (let i = 0; i <= 14; i++) { const [px, py] = at(s.sx, s.sy, s.vx, s.vy, (s.T * i) / 14); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
    ctx.stroke();
  }
  ctx.restore();
}

export function drawWater(ctx, t, params) {
  const list = streams(params);
  drawStreams(ctx, list);
  ctx.save();
  // Капли бегут по струе.
  ctx.fillStyle = 'rgba(225,246,255,1)';
  list.forEach((s, k) => {
    for (let d = 0; d < 3; d++) {
      const q = (t * 1.6 + k * 0.37 + d / 3) % 1;
      const [px, py] = at(s.sx, s.sy, s.vx, s.vy, s.T * q);
      const vyNow = s.vy + G * s.T * q, ang = Math.atan2(vyNow, s.vx) - Math.PI / 2;
      ctx.beginPath(); ctx.ellipse(px, py, 3, 6, ang, 0, Math.PI * 2); ctx.fill();
    }
  });
  // Брызги там, где вода ударяется (отлетают в сторону движения струи).
  ctx.fillStyle = 'rgba(190,235,255,.85)';
  list.forEach((s, k) => {
    const [ex, ey] = at(s.sx, s.sy, s.vx, s.vy, s.T), side = Math.sign(s.vx) || 1;
    for (let j = 0; j < (list.length > 1 ? 2 : 5); j++) {
      const q = (t * 2.4 + j / 5 + k * 0.21) % 1, a = (j / 5) * Math.PI;
      const dx = Math.cos(a) * 26 * q + side * Math.abs(s.vx) * 0.02 * q;
      ctx.beginPath(); ctx.arc(ex + dx, ey - Math.sin(a) * 20 * q * (1 - q) * 4, 3.2 * (1 - q) + 1, 0, Math.PI * 2); ctx.fill();
    }
  });
  ctx.restore();
}

// power.water у предмета: [x, y, yEnd, ширина, направление°, напор] (первые четыре — доли картинки).
export function waterParams(arr, x, y, w, h) {
  const [wx, wy, we, ws, dir = 0, push = 0] = arr;
  return { x: x + wx * w, y: y + wy * h, yEnd: y + we * h, width: ws * w, dir, push };
}

// Струя попала на героя или животное: вода разбивается о него (ниже не летит), а он мокнет.
// boxes — [{ key, x0, y0, x1, y1 }] в тех же координатах, что и params. Возвращает { params, hits }.
export function cutStreams(params, boxes) {
  if (!boxes.length) return { params, hits: [] };
  let yEnd = params.yEnd;
  const hits = new Set();
  for (const s of streams(params)) {
    for (let i = 1; i <= 24; i++) {
      const [px, py] = at(s.sx, s.sy, s.vx, s.vy, (s.T * i) / 24);
      const b = boxes.find((o) => px >= o.x0 && px <= o.x1 && py >= o.y0 && py <= o.y1);
      if (b) { hits.add(b.key); yEnd = Math.min(yEnd, Math.max(params.y + 4, py)); break; }
    }
  }
  return { params: { ...params, yEnd }, hits: [...hits] };
}
