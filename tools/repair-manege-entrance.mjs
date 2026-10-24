import { join, resolve } from 'node:path';
import { createVenueStore } from '../server/venue-store.js';
import { isWalkableAt, planRoute } from '../src/shared/pathfinder.js';

// Run as the service user while space-map.service is stopped.
const directory = process.argv[2];
if (!directory) throw new Error('Укажите DATA_DIR, например /var/lib/space-map-ttk.');
const store = createVenueStore(join(resolve(directory), 'venues.json'));
const id = '6e03d42c-872f-4f2b-8b20-42b0b1ecaefc';
const venue = await store.get(id);
if (!venue) throw new Error('Новая площадка манежа не найдена; данные не менялись.');
const entrance = venue.floors[0]?.places.find((place) => place.id === 'manege-entrance');
if (!entrance) throw new Error('Точка входа не найдена; данные не менялись.');
if (entrance.x === 0.5 && entrance.y === 0.91) {
  console.log('Вход уже исправлен; данные не менялись.');
  process.exit(0);
}
if (venue.revision !== 2 || Math.abs(entrance.x - 0.4550137023925782) > 1e-9
  || Math.abs(entrance.y - 0.9242496236165365) > 1e-9) {
  throw new Error('Площадку уже редактировали. Автоматическое исправление остановлено; данные не менялись.');
}
entrance.x = 0.5;
entrance.y = 0.91;
const floor = venue.floors[0];
for (const place of floor.places.filter((place) => place.id !== entrance.id)) {
  if (!isWalkableAt(floor, place) || !planRoute(floor, entrance, place)) {
    throw new Error(`Маршрут к «${place.name}» не проходит проверку; данные не менялись.`);
  }
}
const saved = await store.replace(id, { name: venue.name, floors: venue.floors }, venue.revision);
console.log(`Вход исправлен; площадка ${id}, версия ${saved.revision}. Остальные площадки сохранены.`);
