export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const copy = (x) => JSON.parse(JSON.stringify(x));
export const isHex = (s) => typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s);
export const $ = (sel, root = document) => root.querySelector(sel);

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Маленький «издатель событий»: store.on('change', fn)
export function emitter() {
  const map = new Map();
  return {
    on(ev, fn) { if (!map.has(ev)) map.set(ev, new Set()); map.get(ev).add(fn); return () => map.get(ev).delete(fn); },
    emit(ev, data) { for (const fn of map.get(ev) || []) fn(data); },
  };
}
