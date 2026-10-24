import { randomUUID } from 'node:crypto';
import { readFile, writeFile, rename, rm, stat, chown } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createVenueStore } from '../server/venue-store.js';

// Run only while the application service is stopped. This script adds one
// reviewed venue to the existing data file; it never replaces another venue.
const dataDir = process.argv[2];
if (!dataDir) {
  console.error('Укажите каталог DATA_DIR, например /var/lib/space-map-ttk.');
  process.exit(1);
}

const file = join(resolve(dataDir), 'venues.json');
const fixture = JSON.parse(await readFile(new URL('../fixtures/manege-venue.json', import.meta.url), 'utf8'));
const existing = JSON.parse(await readFile(file, 'utf8'));
if (existing.schemaVersion !== 1 || !Array.isArray(existing.venues)) {
  throw new Error('Неизвестный формат серверного хранилища; данные не менялись.');
}
if (existing.venues.some((venue) => venue.id === fixture.id)) {
  console.log(`Площадка ${fixture.id} уже есть; данные не менялись.`);
  process.exit(0);
}

const temporary = `${file}.${randomUUID()}.tmp`;
const previous = await stat(file);
try {
  await writeFile(temporary, JSON.stringify({ ...existing, venues: [...existing.venues, fixture] }, null, 2), {
    encoding: 'utf8', mode: previous.mode & 0o777, flag: 'wx',
  });
  if (process.getuid?.() !== previous.uid) await chown(temporary, previous.uid, previous.gid);
  const check = createVenueStore(temporary);
  await check.initialize();
  if (!(await check.get(fixture.id))) throw new Error('Новая площадка не прошла проверку.');
  await rename(temporary, file);
  console.log(`Площадка добавлена: ${fixture.id}. Остальных площадок: ${existing.venues.length}.`);
} catch (error) {
  await rm(temporary, { force: true }).catch(() => {});
  throw error;
}
