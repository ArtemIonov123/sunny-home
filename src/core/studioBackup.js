// Студия целиком в одном файле: свои предметы, одежда и животные, правки встроенных, рецепты, зоны карты,
// свои районы, места и отделки, картинки героев, галочки «выдать игроку» (и, если попросили, ключ GitHub).
// Нужно, чтобы перейти на новую версию studio.html: на телефоне каждый скачанный файл — как отдельная
// программа и не видит, что сохранил прошлый.
import { listRecords, listOverrides, importPack, saveOverride } from './library.js';
import { listOwnRecipes } from './recipes.js';
import { saveOwnRecipe } from './library.js';
import { ownZones, saveOwnZones } from './mapZones.js';
import { ownWorld, saveOwnWorld, cleanWorld } from './world.js';
import { ownHeroArt, saveOwnHeroArt } from '../render/heroArt.js';
import { lockedList, studioSetLocked } from './access.js';
import { getSettings, saveSettings } from './publish.js';

export const BACKUP_FORMAT = 'sunny-studio-backup';

export function makeStudioBackup(withKey = false) {
  const gh = getSettings();
  return {
    format: BACKUP_FORMAT, version: 1, created: new Date().toISOString(),
    items: listRecords(), overrides: listOverrides(), recipes: listOwnRecipes(),
    zones: ownZones(), world: ownWorld(), heroArt: ownHeroArt(), locked: lockedList(),
    ...(withKey && gh.token ? { github: { repo: gh.repo, branch: gh.branch, token: gh.token } } : {}),
  };
}

// Загрузить копию в эту студию (добавляется к тому, что уже есть; одинаковое — заменяется). Возвращает счётчики.
export async function restoreStudioBackup(raw) {
  if (!raw || raw.format !== BACKUP_FORMAT) throw new Error('Это не резервная копия студии');
  const n = { items: 0, overrides: 0, recipes: 0, zones: 0, places: 0, heroArt: 0, key: false };
  if (Array.isArray(raw.items) && raw.items.length) n.items = await importPack({ format: 'sunny-home-items', version: 2, items: raw.items });
  for (const o of Array.isArray(raw.overrides) ? raw.overrides : []) { try { await saveOverride(o); n.overrides++; } catch (e) { /* неизвестный предмет */ } }
  for (const r of Array.isArray(raw.recipes) ? raw.recipes : []) { try { await saveOwnRecipe(r); n.recipes++; } catch (e) { /* пропуск */ } }
  if (raw.zones && typeof raw.zones === 'object') for (const [d, list] of Object.entries(raw.zones)) { saveOwnZones(d, list); n.zones++; }
  if (raw.world) {
    const cur = ownWorld(), add = cleanWorld(raw.world), ids = new Set(add.districts.map((d) => d.id));
    await saveOwnWorld({ districts: [...cur.districts.filter((d) => !ids.has(d.id)), ...add.districts], places: { ...cur.places, ...add.places }, finishes: { ...cur.finishes, ...add.finishes } });
    n.places = add.districts.length + Object.keys(add.places).length + Object.keys(add.finishes).length;
  }
  if (raw.heroArt && Object.keys(raw.heroArt).length) { await saveOwnHeroArt({ ...ownHeroArt(), ...raw.heroArt }); n.heroArt = Object.keys(raw.heroArt).length; }
  if (Array.isArray(raw.locked)) studioSetLocked(raw.locked);
  if (raw.github?.token) { saveSettings({ repo: raw.github.repo || 'ArtemIonov123/sunny-home', branch: raw.github.branch || 'main', token: raw.github.token }); n.key = true; }
  return n;
}
