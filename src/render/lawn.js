// Лужайка: небо и трава — повторяющиеся картинки, забор — полоса на линии травы.
// Дерево, кусты и грядки — обычные предметы каталога (их можно переставлять).
import { VIEW_H } from '../config.js';
import { img } from '../assets.js';

function tileX(c, im, y, h, width) {
  if (!im) return;
  const w = (im.width * h) / im.height;
  for (let x = 0; x < width; x += w - 0.5) c.drawImage(im, x, y, w, h);
}

export function drawLawn(c, room) {
  const W = room.width, ground = room.split * VIEW_H;
  // Небо: нижний край с далёкими кустами стоит чуть ниже линии травы.
  c.fillStyle = '#8fd0f5'; c.fillRect(0, 0, W, ground);
  tileX(c, img('rooms/lawn/sky'), 0, ground + 20, W);
  // Трава.
  tileX(c, img('rooms/lawn/ground'), ground, VIEW_H - ground, W);
  const shade = c.createLinearGradient(0, ground, 0, ground + 50);
  shade.addColorStop(0, 'rgba(40,90,30,.22)'); shade.addColorStop(1, 'rgba(40,90,30,0)');
  c.fillStyle = shade; c.fillRect(0, ground, W, 50);
  // Забор стоит на траве.
  const fence = img('rooms/lawn/fence');
  if (fence) tileX(c, fence, ground - 150, 175, W);
  // Дорожка к дому (камни).
  c.fillStyle = '#ddd5c3'; c.strokeStyle = '#a99f8a'; c.lineWidth = 3;
  for (let k = 0; k < 6; k++) {
    const x = 640 + k * 160, y = VIEW_H - 110 - k * 32;
    c.beginPath(); c.ellipse(x, y, 64, 22, 0, 0, Math.PI * 2); c.fill(); c.stroke();
  }
}
