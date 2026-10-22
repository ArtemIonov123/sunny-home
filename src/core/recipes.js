// Рецепты: положил продукты на прибор (в блендер, на плиту, в тостер) → нажал на прибор →
// он работает (трясётся, жужжит) → вместо продуктов появляется результат.
// Рецепт: { id, machine, inputs:[вещи], outputs:[вещи], time (сек), sound }.
// Встроенные — ниже; свои — из студии (хранятся в браузере и входят в паки), из паков — при установке.
import { itemDef } from './catalog.js';

export const SOUNDS = { buzz: 'Жужжит (блендер)', sizzle: 'Шипит (плита)', bubble: 'Булькает (кастрюля)', tick: 'Тикает (тостер, духовка)' };

export const BUILTIN_RECIPES = [
  { id: 'b_banana2', machine: 'blender', inputs: ['banana', 'banana'], outputs: ['smoothie_banana'], time: 2.5, sound: 'buzz' },
  { id: 'b_banana', machine: 'blender', inputs: ['banana'], outputs: ['smoothie_banana'], time: 2, sound: 'buzz' },
  { id: 'b_milkbanana', machine: 'blender', inputs: ['banana', 'milk'], outputs: ['smoothie_banana'], time: 2.5, sound: 'buzz' },
  { id: 'b_apple', machine: 'blender', inputs: ['apple'], outputs: ['juice'], time: 2, sound: 'buzz' },
  // Тостер и плита.
  { id: 't_toast', machine: 'toaster', inputs: ['bread'], outputs: ['toast'], time: 2.5, sound: 'tick' },
  { id: 't_toast2', machine: 'toaster', inputs: ['bread', 'bread'], outputs: ['toast', 'toast'], time: 3, sound: 'tick' },
  { id: 's_egg', machine: 'stove', inputs: ['egg'], outputs: ['fried_egg'], time: 2.5, sound: 'sizzle' },
  { id: 's_pizza', machine: 'stove', inputs: ['bread', 'tomato', 'cheese'], outputs: ['pizza'], time: 3.5, sound: 'sizzle' },
  { id: 's_soup', machine: 'stove', inputs: ['carrot', 'potato'], outputs: ['soup'], time: 3.5, sound: 'bubble' },
  { id: 's_soup3', machine: 'stove', inputs: ['carrot', 'potato', 'tomato'], outputs: ['soup'], time: 3.5, sound: 'bubble' },
];

const own = new Map();   // свои рецепты из студии (id → рецепт)
const fromPacks = new Map();

export function validateRecipe(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Рецепт повреждён');
  const id = String(raw.id || '');
  if (!/^[a-z0-9_]{2,60}$/.test(id)) throw new Error('У рецепта неверный ID');
  const list = (a, max) => (Array.isArray(a) ? a : []).filter((d) => typeof d === 'string' && /^[a-z0-9_]{1,80}$/.test(d)).slice(0, max);
  const r = {
    id, machine: String(raw.machine || ''), inputs: list(raw.inputs, 4), outputs: list(raw.outputs, 3),
    time: Math.max(0.5, Math.min(10, Number(raw.time) || 2)), sound: SOUNDS[raw.sound] ? raw.sound : 'buzz',
  };
  if (!/^[a-z0-9_]{1,80}$/.test(r.machine)) throw new Error('Не выбран прибор');
  if (!r.inputs.length) throw new Error('Добавь хотя бы один продукт');
  if (!r.outputs.length) throw new Error('Добавь, что получится');
  return r;
}

export const setOwnRecipes = (list) => { own.clear(); for (const r of list) own.set(r.id, r); };
export const listOwnRecipes = () => [...own.values()];
export function addPackRecipes(list) { for (const raw of list || []) { try { const r = validateRecipe(raw); fromPacks.set(r.id, r); } catch (e) { /* пропуск */ } } }

const key = (r) => r.machine + '|' + [...r.inputs].sort().join('+');
// Все рецепты: свои важнее паков, паки важнее встроенных (по одинаковому прибору и продуктам).
export function allRecipes() {
  const out = new Map();
  for (const r of [...BUILTIN_RECIPES, ...fromPacks.values(), ...own.values()]) out.set(key(r), r);
  return [...out.values()].filter((r) => itemDef(r.machine) && r.inputs.every(itemDef) && r.outputs.every(itemDef));
}
export const isMachine = (defId) => allRecipes().some((r) => r.machine === defId);

// Что получится из того, что лежит на приборе (точное совпадение продуктов, порядок не важен).
export function findRecipe(machineDef, inputDefs) {
  const k = machineDef + '|' + [...inputDefs].sort().join('+');
  return allRecipes().find((r) => key(r) === k) || null;
}
