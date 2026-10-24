import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  throw new Error('PORT должен быть целым числом от 0 до 65535.');
}

// Раздаём только явно перечисленные файлы. Серверный код и .env недоступны по HTTP.
const indexFile = new URL('../index.html', import.meta.url);
const pages = new Map([
  ['/', indexFile],
  ['/map/demo', indexFile],
  ['/editor/demo', indexFile],
]);
const assets = new Map([
  ['/src/main.js', [new URL('../src/main.js', import.meta.url), 'text/javascript; charset=utf-8']],
  ['/src/styles/base.css', [new URL('../src/styles/base.css', import.meta.url), 'text/css; charset=utf-8']],
  ['/src/editor/editor.js', [new URL('../src/editor/editor.js', import.meta.url), 'text/javascript; charset=utf-8']],
  ['/src/editor/editor.css', [new URL('../src/editor/editor.css', import.meta.url), 'text/css; charset=utf-8']],
]);

function respond(req, res, status, type, body, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

const server = createServer(async (req, res) => {
  try {
    let pathname;
    try {
      pathname = new URL(req.url, 'http://localhost').pathname;
    } catch {
      return respond(req, res, 400, 'text/plain; charset=utf-8', 'Некорректный адрес');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return respond(req, res, 405, 'application/json; charset=utf-8',
        JSON.stringify({ error: 'На этом этапе изменение данных ещё не реализовано.' }),
        { Allow: 'GET, HEAD' });
    }
    if (pathname === '/api/health') {
      return respond(req, res, 200, 'application/json; charset=utf-8',
        JSON.stringify({ ok: true, stage: 'foundation', mapSavingImplemented: false }));
    }
    if (pages.has(pathname)) {
      return respond(req, res, 200, 'text/html; charset=utf-8', await readFile(pages.get(pathname)));
    }
    if (assets.has(pathname)) {
      const [file, type] = assets.get(pathname);
      return respond(req, res, 200, type, await readFile(file));
    }
    return respond(req, res, 404, 'text/plain; charset=utf-8', 'Страница не найдена');
  } catch (error) {
    console.error(error);
    return respond(req, res, 500, 'text/plain; charset=utf-8', 'Ошибка сервера');
  }
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Порт ${port} занят. Закрой другой запуск проекта или выбери другой PORT.`);
  } else {
    console.error(error.message);
  }
  process.exitCode = 1;
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Карта пространства: http://${host}:${server.address().port}`);
  console.log('Этап 1: общая страница. Остановка: Ctrl + C.');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => server.close());
}
