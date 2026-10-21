// Экран игры всегда горизонтальный. Если телефон держат вертикально,
// весь блок #app поворачивается на 90°, а координаты касаний пересчитываются обратно.
import { VIEW_H } from '../config.js';

export function createViewport(app, onResize) {
  const vp = {
    rotated: false, cssW: 0, cssH: 0,

    apply() {
      const v = window.visualViewport;
      const vw = Math.round(v ? v.width : innerWidth), vh = Math.round(v ? v.height : innerHeight);
      vp.rotated = vh > vw;
      vp.cssW = vp.rotated ? vh : vw;
      vp.cssH = vp.rotated ? vw : vh;
      app.style.width = vp.cssW + 'px';
      app.style.height = vp.cssH + 'px';
      app.style.transform = vp.rotated ? `translateX(${vw}px) rotate(90deg)` : 'none';
      app.classList.toggle('compact', vp.cssH < 520);
      onResize(vp.cssW, vp.cssH);
    },

    // Точка касания → координаты внутри #app (CSS-пиксели, до поворота).
    toLocal(clientX, clientY) {
      const r = app.getBoundingClientRect();
      return vp.rotated ? { x: clientY - r.top, y: r.right - clientX } : { x: clientX - r.left, y: clientY - r.top };
    },

    // Точка касания → координаты экрана в игровых единицах (высота = 900).
    toScreen(clientX, clientY) {
      const p = vp.toLocal(clientX, clientY), k = VIEW_H / vp.cssH;
      return { x: p.x * k, y: p.y * k };
    },
  };
  let t = 0;
  const later = () => { clearTimeout(t); t = setTimeout(vp.apply, 60); };
  window.addEventListener('resize', later);
  window.visualViewport?.addEventListener('resize', later);
  window.addEventListener('orientationchange', later);
  document.addEventListener('fullscreenchange', later);
  return vp;
}
