// Единое место, где живёт состояние игры. Все изменения идут через change(),
// поэтому отмена и сохранение работают одинаково для любых действий.
import { UNDO_LIMIT } from '../config.js';
import { layout } from './house.js';
import { copy, emitter } from '../util.js';

export function createStore(initial) {
  const events = emitter();
  let state = initial;
  let lay = layout(state.rooms);
  const undoStack = [];

  const store = {
    on: events.on,
    get state() { return state; },
    get layout() { return lay; },
    get canUndo() { return undoStack.length > 0; },

    // Запомнить состояние до изменения (для «отменить»). Для перетаскивания
    // вызывается один раз в начале, а само движение идёт без новых снимков.
    checkpoint() {
      undoStack.push(copy(state));
      if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    },
    dropCheckpoint() { undoStack.pop(); },

    // fn меняет state на месте. undo:false — без отдельного шага отмены.
    change(fn, { undo = true, save = true } = {}) {
      if (undo) store.checkpoint();
      fn(state);
      lay = layout(state.rooms);
      events.emit('change', { save });
    },

    undo() {
      if (!undoStack.length) return false;
      state = undoStack.pop();
      lay = layout(state.rooms);
      events.emit('change', { save: true, undo: true });
      return true;
    },

    replace(next) {
      store.checkpoint();
      state = next;
      lay = layout(state.rooms);
      events.emit('change', { save: true });
    },

    // Подменить дом целиком (в гости к другу и обратно, новый дом от хозяина): без отмены и без сохранения.
    swap(next) {
      undoStack.length = 0;
      state = next;
      lay = layout(state.rooms);
      events.emit('change', { save: false, remote: true });
    },

    // Последнее изменение во время перетаскивания: без сохранения на каждый кадр.
    touch() { lay = layout(state.rooms); events.emit('change', { save: false }); },
  };
  return store;
}
