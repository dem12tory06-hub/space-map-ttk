import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { createAppServer } from './app.js';
import { createVenueStore } from './venue-store.js';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';
const bindHost = process.env.BIND_HOST ?? '0.0.0.0';
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  throw new Error('PORT должен быть целым числом от 0 до 65535.');
}

const dataDirectory = resolve(process.env.DATA_DIR ?? join(homedir(), '.local', 'share', 'space-map-ttk'));
const store = createVenueStore(join(dataDirectory, 'venues.json'));
await store.initialize();
const server = createAppServer({
  store,
  organizerToken: process.env.ORGANIZER_TOKEN ?? '',
  backgroundDirectory: join(dataDirectory, 'backgrounds'),
  panoramaDirectory: join(dataDirectory, 'panoramas'),
  stitchServiceUrl: process.env.STITCH_SERVICE_URL ?? 'http://127.0.0.1:5000',
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Порт ${port} занят. Закрой другой запуск проекта или выбери другой PORT.`);
  } else {
    console.error(error.message);
  }
  process.exitCode = 1;
});

server.listen(port, bindHost, () => {
  console.log(`Карта пространства: http://${host}:${server.address().port}`);
  console.log('Хранилище площадок: настроено. Остановка: Ctrl + C.');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => server.close());
}
