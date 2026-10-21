// Фон комнаты: стена + обои + пол + плинтус. Рисуется ОДИН раз в отдельный холст
// и потом просто копируется на экран. Перерисовывается, только когда меняется отделка.
import { VIEW_H } from '../config.js';
import { img } from '../assets.js';
import { drawLawn } from './lawn.js';

const cache = new Map(); // roomId → { key, canvas, used }
const MAX_CACHED = 4;
let frame = 0;

export function backgroundFor(room, k) {
  frame++;
  const key = JSON.stringify([room.type, room.width, room.split, room.wall, room.floor, k]);
  let entry = cache.get(room.id);
  if (!entry || entry.key !== key) {
    entry = { key, canvas: paint(room, k), used: frame };
    cache.set(room.id, entry);
    evict();
  }
  entry.used = frame;
  return entry.canvas;
}

export function clearBackgrounds() { cache.clear(); }

function evict() {
  if (cache.size <= MAX_CACHED) return;
  const oldest = [...cache.entries()].sort((a, b) => a[1].used - b[1].used);
  while (cache.size > MAX_CACHED) cache.delete(oldest.shift()[0]);
}

function paint(room, k) {
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(room.width * k);
  cv.height = Math.ceil(VIEW_H * k);
  const c = cv.getContext('2d');
  c.setTransform(k, 0, 0, k, 0, 0);
  if (room.type === 'lawn') drawLawn(c, room);
  else drawIndoor(c, room);
  return cv;
}

// Повтор картинки по горизонтали в режиме «умножение» (перекрашивание серой фактуры).
function tile(c, key, y, h, width, mode = 'multiply') {
  const im = img(key);
  if (!im) return;
  const w = (im.width * h) / im.height;
  c.save();
  c.globalCompositeOperation = mode;
  for (let x = 0; x < width; x += w - 0.5) c.drawImage(im, x, y, w, h);
  c.restore();
}

function drawPattern(c, pattern, width, wallH) {
  if (pattern === 'plain') return;
  c.save();
  c.beginPath(); c.rect(0, 0, width, wallH); c.clip();
  c.fillStyle = 'rgba(255,255,255,.42)';
  if (pattern === 'stripes') for (let x = 0; x < width; x += 90) c.fillRect(x, 0, 36, wallH);
  if (pattern === 'dots' || pattern === 'flowers') {
    for (let y = 54; y < wallH - 20; y += 90) {
      for (let x = 45 + (Math.floor(y / 90) % 2) * 45; x < width; x += 90) {
        c.beginPath();
        if (pattern === 'dots') { c.arc(x, y, 6, 0, Math.PI * 2); c.fill(); continue; }
        for (let i = 0; i < 5; i++) { const a = (i * Math.PI * 2) / 5; c.moveTo(x + Math.cos(a) * 9 + 6, y + Math.sin(a) * 9); c.arc(x + Math.cos(a) * 9, y + Math.sin(a) * 9, 6, 0, Math.PI * 2); }
        c.fill();
        c.fillStyle = 'rgba(230,180,80,.55)'; c.beginPath(); c.arc(x, y, 4, 0, Math.PI * 2); c.fill();
        c.fillStyle = 'rgba(255,255,255,.42)';
      }
    }
  }
  c.restore();
}

function drawIndoor(c, room) {
  const W = room.width, wallH = room.split * VIEW_H, floorH = VIEW_H - wallH;
  // Стена: цвет → узор → серая фактура умножением (тени и штукатурка).
  c.fillStyle = room.wall.color; c.fillRect(0, 0, W, wallH);
  drawPattern(c, room.wall.pattern, W, wallH);
  tile(c, 'rooms/living/wall', 0, wallH, W);

  // Пол.
  c.fillStyle = room.floor.color; c.fillRect(0, wallH, W, floorH);
  if (room.floor.material === 'tile') {
    c.save();
    c.strokeStyle = 'rgba(255,255,255,.75)'; c.lineWidth = 4;
    for (let x = 0; x <= W; x += 150) { c.beginPath(); c.moveTo(x, wallH); c.lineTo(x, VIEW_H); c.stroke(); }
    for (let y = wallH + 75; y < VIEW_H; y += 90) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
    c.strokeStyle = 'rgba(90,80,70,.12)'; c.lineWidth = 2;
    for (let x = 2; x <= W; x += 150) { c.beginPath(); c.moveTo(x, wallH); c.lineTo(x, VIEW_H); c.stroke(); }
    c.restore();
  } else {
    tile(c, 'rooms/living/floor_wood', wallH, floorH, W);
  }
  // Мягкая тень у стены — пол «уходит» под плинтус.
  const g = c.createLinearGradient(0, wallH, 0, wallH + 70);
  g.addColorStop(0, 'rgba(70,45,25,.22)'); g.addColorStop(1, 'rgba(70,45,25,0)');
  c.fillStyle = g; c.fillRect(0, wallH, W, 70);
  // Плинтус в настоящих цветах.
  tile(c, 'rooms/living/baseboard', wallH - 24, 28, W, 'source-over');
}
