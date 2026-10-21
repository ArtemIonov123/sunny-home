// Временная лужайка, нарисованная кодом, пока GPT не нарисует настоящую.
import { VIEW_H } from '../config.js';

function blob(c, x, y, r, color) { c.fillStyle = color; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); }

export function drawLawn(c, room) {
  const W = room.width, ground = room.split * VIEW_H;
  const sky = c.createLinearGradient(0, 0, 0, ground);
  sky.addColorStop(0, '#8fd0f5'); sky.addColorStop(1, '#d9f0fb');
  c.fillStyle = sky; c.fillRect(0, 0, W, ground);

  for (const [x, y, s] of [[260, 120, 1], [820, 80, 0.8], [1300, 150, 1.1]]) {
    for (const [dx, dy, r] of [[0, 0, 34], [38, -14, 42], [80, 0, 34], [40, 12, 30]]) blob(c, x + dx * s, y + dy * s, r * s, 'rgba(255,255,255,.92)');
  }
  // Дальние кусты.
  for (let x = -40; x < W + 60; x += 95) blob(c, x, ground - 30 + Math.sin(x) * 8, 70, '#9fd38a');
  for (let x = 10; x < W + 60; x += 120) blob(c, x, ground - 10, 60, '#86c573');

  // Заборчик.
  const fy = ground - 150;
  c.fillStyle = '#fffaf0'; c.strokeStyle = '#b89a76'; c.lineWidth = 3;
  c.fillRect(0, fy + 40, W, 16); c.strokeRect(-2, fy + 40, W + 4, 16);
  c.fillRect(0, fy + 100, W, 16); c.strokeRect(-2, fy + 100, W + 4, 16);
  for (let x = 20; x < W; x += 62) {
    c.beginPath(); c.moveTo(x, fy + 150); c.lineTo(x, fy + 14); c.lineTo(x + 20, fy); c.lineTo(x + 40, fy + 14); c.lineTo(x + 40, fy + 150); c.closePath();
    c.fill(); c.stroke();
  }

  // Дерево.
  c.fillStyle = '#a7774c'; c.strokeStyle = '#7c5434'; c.lineWidth = 4;
  c.beginPath(); c.roundRect(250, ground - 330, 60, 340, 18); c.fill(); c.stroke();
  for (const [x, y, r] of [[280, 140, 120], [190, 210, 95], [380, 210, 100], [280, 270, 105], [200, 120, 80], [370, 120, 85]]) blob(c, x, y, r, '#6fb45a');
  for (const [x, y, r] of [[250, 120, 50], [340, 190, 45], [220, 240, 40]]) blob(c, x, y, r, '#86c96d');

  // Трава.
  const grass = c.createLinearGradient(0, ground, 0, VIEW_H);
  grass.addColorStop(0, '#8fcf6a'); grass.addColorStop(1, '#79bd58');
  c.fillStyle = grass; c.fillRect(0, ground, W, VIEW_H - ground);
  c.strokeStyle = 'rgba(70,130,50,.45)'; c.lineWidth = 3;
  for (let i = 0; i < 160; i++) {
    const x = (i * 97) % W, y = ground + 30 + ((i * 53) % (VIEW_H - ground - 40));
    c.beginPath(); c.moveTo(x, y); c.lineTo(x - 5, y - 14); c.moveTo(x + 6, y); c.lineTo(x + 9, y - 12); c.stroke();
  }
  // Цветы.
  for (let i = 0; i < 26; i++) {
    const x = (i * 211 + 60) % W, y = ground + 60 + ((i * 89) % (VIEW_H - ground - 90));
    for (let p = 0; p < 5; p++) { const a = (p * Math.PI * 2) / 5; blob(c, x + Math.cos(a) * 8, y + Math.sin(a) * 8, 6, i % 3 ? '#fff' : '#ffc7d6'); }
    blob(c, x, y, 5, '#f2c14e');
  }
  // Дорожка к дому.
  c.fillStyle = '#d9d2c2'; c.strokeStyle = '#b3aa96'; c.lineWidth = 3;
  for (let k = 0; k < 6; k++) {
    const x = 700 + k * 150, y = VIEW_H - 120 - k * 30;
    c.beginPath(); c.ellipse(x, y, 62, 22, 0, 0, Math.PI * 2); c.fill(); c.stroke();
  }
}
