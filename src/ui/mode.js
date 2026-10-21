// Режим игры. Как в Toca Boca:
//   игра     — двигаются герои и мелкие вещи (еда, игрушки, одежда); мебель стоит на месте,
//              её можно нажать (открыть холодильник) или листать дом, касаясь её;
//   редактор — двигается вся мебель, герои спрятаны, чтобы не мешали.
import { emitter } from '../util.js';

const ev = emitter();
export const mode = {
  design: false,
  on: ev.on,
  set(design) { if (mode.design === design) return; mode.design = design; ev.emit('change', design); },
};
