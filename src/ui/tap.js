// Надёжное нажатие на телефоне. После перетаскивания некоторые браузеры не присылают
// событие click — кнопка «не нажимается». Здесь кнопка срабатывает сразу, как палец
// поднят без сдвига; «опоздавший» click от браузера после этого игнорируется.
const TAPPABLE = 'button, .stack, .ie-card';
const MOVE_LIMIT = 12;

export function installFastTap(root) {
  let press = null;
  let synthetic = false;
  let last = null; // { t, x, y } — где и когда мы сами нажали кнопку

  root.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return; // мышь работает обычным click
    const el = e.target.closest(TAPPABLE);
    press = el && root.contains(el) && !el.disabled ? { el, id: e.pointerId, x: e.clientX, y: e.clientY } : null;
  }, true);

  root.addEventListener('pointermove', (e) => {
    if (press && press.id === e.pointerId && Math.hypot(e.clientX - press.x, e.clientY - press.y) > MOVE_LIMIT) press = null;
  }, true);

  root.addEventListener('pointercancel', () => { press = null; }, true);

  root.addEventListener('pointerup', (e) => {
    const p = press; press = null;
    if (!p || p.id !== e.pointerId) return;
    if (e.target.closest(TAPPABLE) !== p.el || p.el.disabled || !p.el.isConnected) return;
    last = { t: performance.now(), x: e.clientX, y: e.clientY };
    synthetic = true;
    try { p.el.click(); } finally { synthetic = false; }
  }, true);

  // «Родной» click после нашего — пропускаем, чтобы кнопка не сработала дважды
  // (даже если панель уже перерисовалась и под пальцем другая кнопка).
  root.addEventListener('click', (e) => {
    if (synthetic || !last) return;
    if (performance.now() - last.t < 800 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 40) {
      e.stopImmediatePropagation(); e.preventDefault();
    }
  }, true);
}
