import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { VenueStoreError } from './venue-store.js';

const maxRequestBytes = 1024 * 1024;
const maxBackgroundBytes = 10 * 1024 * 1024;
const planViewBoxWidth = 1000;
const planViewBoxHeight = 600;
const indexFile = new URL('../index.html', import.meta.url);
const pages = new Map([
  ['/', indexFile],
  ['/map/demo', indexFile],
  ['/editor/demo', indexFile],
  ['/constructor', indexFile],
  ['/test/venue', new URL('../test/venue-test.html', import.meta.url)],
]);
const assets = new Map([
  ['/src/main.js', [new URL('../src/main.js', import.meta.url), 'text/javascript; charset=utf-8']],
  ['/src/styles/base.css', [new URL('../src/styles/base.css', import.meta.url), 'text/css; charset=utf-8']],
  ['/src/editor/editor.js', [new URL('../src/editor/editor.js', import.meta.url), 'text/javascript; charset=utf-8']],
  ['/src/editor/editor.css', [new URL('../src/editor/editor.css', import.meta.url), 'text/css; charset=utf-8']],
  ['/test/venue-test.js', [new URL('../test/venue-test.js', import.meta.url), 'text/javascript; charset=utf-8']],
  ['/test/venue-test.css', [new URL('../test/venue-test.css', import.meta.url), 'text/css; charset=utf-8']],
  ['/src/constructor/constructor.js', [new URL('../src/constructor/constructor.js', import.meta.url), 'text/javascript; charset=utf-8']],
  ['/src/constructor/constructor.css', [new URL('../src/constructor/constructor.css', import.meta.url), 'text/css; charset=utf-8']],
]);

class ApiError extends Error {
  constructor(status, code, message, headers = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

function respond(req, res, status, type, body, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

function respondJson(req, res, status, value, headers = {}) {
  return respond(req, res, status, 'application/json; charset=utf-8', JSON.stringify(value), headers);
}

async function readJson(req) {
  const contentType = req.headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    throw new ApiError(415, 'unsupported_media_type', 'Ожидается Content-Type: application/json.');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxRequestBytes) throw new ApiError(413, 'request_too_large', 'Размер запроса превышает 1 МБ.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ApiError(400, 'invalid_json', 'Тело запроса должно содержать корректный JSON.');
  }
}

function authorize(req, organizerToken) {
  if (!organizerToken) {
    throw new ApiError(503, 'organizer_access_not_configured', 'Запись отключена: доступ организатора не настроен.');
  }
  const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '');
  if (!match) {
    throw new ApiError(401, 'unauthorized', 'Требуется токен организатора.', { 'WWW-Authenticate': 'Bearer' });
  }
  const expected = createHash('sha256').update(organizerToken).digest();
  const supplied = createHash('sha256').update(match[1]).digest();
  if (!timingSafeEqual(expected, supplied)) {
    throw new ApiError(401, 'unauthorized', 'Требуется токен организатора.', { 'WWW-Authenticate': 'Bearer' });
  }
}

function expectedRevision(req) {
  const value = req.headers['if-match'];
  if (value === undefined) {
    throw new ApiError(428, 'revision_required', 'Для сохранения передайте ETag последней загруженной версии в If-Match.');
  }
  const match = /^"([1-9][0-9]*)"$/.exec(value);
  if (!match || !Number.isSafeInteger(Number(match[1]))) {
    throw new ApiError(400, 'invalid_revision', 'If-Match должен содержать ETag вида "1".');
  }
  return Number(match[1]);
}

function storeErrorResponse(error) {
  if (!(error instanceof VenueStoreError)) return null;
  const mapped = {
    invalid: [400, 'invalid_data'],
    not_found: [404, 'not_found'],
    precondition_required: [428, 'revision_required'],
    revision_conflict: [412, 'revision_conflict'],
  }[error.code];
  return mapped ? { status: mapped[0], code: mapped[1], message: error.message } : null;
}

const pngCrcTable = new Uint32Array(256);
for (let index = 0; index < pngCrcTable.length; index += 1) {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  pngCrcTable[index] = crc >>> 0;
}

function pngCrc32(bytes, start, end) {
  let crc = 0xffffffff;
  for (let index = start; index < end; index += 1) {
    crc = pngCrcTable[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function imageDimensions(bytes, mediaType) {
  if (mediaType === 'image/png') {
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (bytes.length < 33 || !bytes.subarray(0, 8).equals(signature)) {
      throw new ApiError(415, 'invalid_image', 'Файл не является корректным PNG-изображением.');
    }
    let offset = 8;
    let dimensions;
    let hasHeader = false;
    let hasImageData = false;
    let hasEnd = false;
    while (offset + 12 <= bytes.length) {
      const chunkLength = bytes.readUInt32BE(offset);
      const chunkEnd = offset + 12 + chunkLength;
      if (chunkEnd > bytes.length) break;
      const chunkType = bytes.toString('ascii', offset + 4, offset + 8);
      const chunkCrc = bytes.readUInt32BE(offset + 8 + chunkLength);
      if (pngCrc32(bytes, offset + 4, offset + 8 + chunkLength) !== chunkCrc) break;
      if (!hasHeader) {
        if (chunkType !== 'IHDR' || chunkLength !== 13) break;
        dimensions = { width: bytes.readUInt32BE(offset + 8), height: bytes.readUInt32BE(offset + 12) };
        hasHeader = true;
      } else if (chunkType === 'IDAT') {
        hasImageData = true;
      } else if (chunkType === 'IEND') {
        hasEnd = chunkLength === 0 && hasImageData && chunkEnd === bytes.length;
        break;
      }
      offset = chunkEnd;
    }
    if (!hasHeader || !hasImageData || !hasEnd) {
      throw new ApiError(415, 'invalid_image', 'PNG должен содержать заголовок, данные изображения и завершающий блок.');
    }
    return dimensions;
  }

  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8
    || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
    throw new ApiError(415, 'invalid_image', 'Файл не является корректным JPEG-изображением.');
  }
  const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  let dimensions;
  let hasImageData = false;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) break;
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xd9 || offset + 1 >= bytes.length) break;
    if (marker === 0xda) {
      hasImageData = true;
      break;
    }
    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
    if (startOfFrame.has(marker) && segmentLength >= 7) {
      dimensions = { height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) };
    }
    offset += segmentLength;
  }
  if (!dimensions || !hasImageData) throw new ApiError(415, 'invalid_image', 'Не удалось прочитать изображение JPEG целиком.');
  return dimensions;
}

async function readBackgroundUpload(req) {
  const mediaType = req.headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
  if (mediaType !== 'image/jpeg' && mediaType !== 'image/png') {
    throw new ApiError(415, 'unsupported_image_type', 'Разрешены только JPG и PNG.');
  }
  const declaredLength = Number(req.headers['content-length'] ?? 0);
  if (declaredLength > maxBackgroundBytes) {
    throw new ApiError(413, 'background_too_large', 'Размер изображения не должен превышать 10 МБ.');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBackgroundBytes) throw new ApiError(413, 'background_too_large', 'Размер изображения не должен превышать 10 МБ.');
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  const dimensions = imageDimensions(bytes, mediaType);
  if (dimensions.width < 1 || dimensions.height < 1 || dimensions.width > 20000 || dimensions.height > 20000
    || dimensions.width * dimensions.height > 50_000_000) {
    throw new ApiError(415, 'invalid_image_dimensions', 'Размер изображения должен быть не больше 20000 пикселей по стороне и 50 мегапикселей суммарно.');
  }
  return { bytes, mediaType, ...dimensions };
}

function backgroundFilePath(backgroundDirectory, venueId, background) {
  const extension = background.mediaType === 'image/png' ? 'png' : 'jpg';
  return join(backgroundDirectory, venueId, `${background.id}.${extension}`);
}

function fitBackgroundPlacement(width, height) {
  const imageAspect = width / height;
  const planAspect = planViewBoxWidth / planViewBoxHeight;
  const placement = imageAspect >= planAspect
    ? { width: 1, height: planViewBoxWidth / imageAspect / planViewBoxHeight }
    : { width: imageAspect * planViewBoxHeight / planViewBoxWidth, height: 1 };
  return {
    x: (1 - placement.width) / 2,
    y: (1 - placement.height) / 2,
    ...placement,
  };
}

export function createAppServer({ store, organizerToken = '', backgroundDirectory }) {
  return createServer(async (req, res) => {
    try {
      let pathname;
      try {
        pathname = new URL(req.url, 'http://localhost').pathname;
      } catch {
        return respondJson(req, res, 400, { error: 'invalid_url', message: 'Некорректный адрес.' });
      }

      if (pathname === '/api/health' && (req.method === 'GET' || req.method === 'HEAD')) {
        return respondJson(req, res, 200, { ok: true, stage: 'venue-storage', mapSavingImplemented: true });
      }

      const backgroundFileMatch = /^\/api\/venues\/([^/]+)\/floors\/([^/]+)\/background\/([^/]+)$/.exec(pathname);
      if (backgroundFileMatch && (req.method === 'GET' || req.method === 'HEAD')) {
        const [, venueId, floorId, backgroundId] = backgroundFileMatch.map(decodeURIComponent);
        const venue = await store.get(venueId);
        const floor = venue?.floors.find((entry) => entry.id === floorId);
        const background = floor?.plan.background;
        if (!background || background.id !== backgroundId) {
          throw new ApiError(404, 'not_found', 'Файл подложки не найден.');
        }
        try {
          const bytes = await readFile(backgroundFilePath(backgroundDirectory, venueId, background));
          return respond(req, res, 200, background.mediaType, bytes, { 'Content-Length': bytes.length });
        } catch (error) {
          if (error.code === 'ENOENT') throw new ApiError(404, 'background_file_missing', 'Файл подложки отсутствует в каталоге данных.');
          throw error;
        }
      }

      const backgroundUploadMatch = /^\/api\/venues\/([^/]+)\/floors\/([^/]+)\/background$/.exec(pathname);
      if (backgroundUploadMatch) {
          if (req.method === 'DELETE') {
            authorize(req, organizerToken);
            if (!backgroundDirectory) throw new ApiError(503, 'background_storage_not_configured', 'Каталог подложек не настроен.');
            const [, venueId, floorId] = backgroundUploadMatch.map(decodeURIComponent);
            const revision = expectedRevision(req);
            const venue = await store.get(venueId);
            if (!venue) throw new ApiError(404, 'not_found', 'Площадка не найдена.');
            const floor = venue.floors.find((entry) => entry.id === floorId);
            if (!floor) throw new ApiError(404, 'not_found', 'Этаж не найден.');
            const previous = floor.plan.background;
            if (!previous) throw new ApiError(404, 'background_not_found', 'Подложка не найдена.');
            floor.plan.background = null;
            const saved = await store.replace(venueId, { name: venue.name, floors: venue.floors }, revision);
            await rm(backgroundFilePath(backgroundDirectory, venueId, previous), { force: true }).catch(() => {});
            return respondJson(req, res, 200, saved, { ETag: `"${saved.revision}"` });
          }
        if (req.method === 'DELETE') {
          authorize(req, organizerToken);
          if (!backgroundDirectory) throw new ApiError(503, 'background_storage_not_configured', 'Каталог подложек не настроен.');
          const [, venueId, floorId] = backgroundUploadMatch.map(decodeURIComponent);
          const revision = expectedRevision(req);
          const venue = await store.get(venueId);
          if (!venue) throw new ApiError(404, 'not_found', 'Площадка не найдена.');
          const floor = venue.floors.find((entry) => entry.id === floorId);
          if (!floor) throw new ApiError(404, 'not_found', 'Этаж не найден.');
          const previous = floor.plan.background;
          if (!previous) throw new ApiError(404, 'background_not_found', 'Подложка не найдена.');
          floor.plan.background = null;
          const saved = await store.replace(venueId, { name: venue.name, floors: venue.floors }, revision);
          await rm(backgroundFilePath(backgroundDirectory, venueId, previous), { force: true }).catch(() => {});
          return respondJson(req, res, 200, saved, { ETag: `"${saved.revision}"` });
        }
        if (req.method !== 'PUT') {
          return respondJson(req, res, 405, { error: 'method_not_allowed' }, { Allow: 'PUT' });
        }
        authorize(req, organizerToken);
        if (!backgroundDirectory) throw new ApiError(503, 'background_storage_not_configured', 'Каталог подложек не настроен.');
        const [, venueId, floorId] = backgroundUploadMatch.map(decodeURIComponent);
        const revision = expectedRevision(req);
        const venue = await store.get(venueId);
        if (!venue) throw new ApiError(404, 'not_found', 'Площадка не найдена.');
        const floor = venue.floors.find((entry) => entry.id === floorId);
        if (!floor) throw new ApiError(404, 'not_found', 'Этаж не найден.');
        const upload = await readBackgroundUpload(req);
        const previous = floor.plan.background;
        const background = {
          id: randomUUID(),
          mediaType: upload.mediaType,
          width: upload.width,
          height: upload.height,
          visible: previous?.visible ?? true,
          opacity: previous?.opacity ?? 1,
          placement: fitBackgroundPlacement(upload.width, upload.height),
        };
        const destination = backgroundFilePath(backgroundDirectory, venueId, background);
        const temporary = `${destination}.${randomUUID()}.tmp`;
        try {
          await mkdir(join(backgroundDirectory, venueId), { recursive: true });
          await writeFile(temporary, upload.bytes, { flag: 'wx', mode: 0o600 });
          await rename(temporary, destination);
        } catch (error) {
          await rm(temporary, { force: true }).catch(() => {});
          throw error;
        }

        floor.plan.background = background;
        let saved;
        try {
          saved = await store.replace(venueId, { name: venue.name, floors: venue.floors }, revision);
        } catch (error) {
          await rm(destination, { force: true }).catch(() => {});
          throw error;
        }
        if (previous) await rm(backgroundFilePath(backgroundDirectory, venueId, previous), { force: true }).catch(() => {});
        return respondJson(req, res, 200, saved, { ETag: `"${saved.revision}"` });
      }

      if (pathname === '/api/venues') {
        if (req.method !== 'POST') {
          return respondJson(req, res, 405, { error: 'method_not_allowed' }, { Allow: 'POST' });
        }
        authorize(req, organizerToken);
        const body = await readJson(req);
        if (body === null || typeof body !== 'object' || Array.isArray(body)
          || Object.keys(body).some((key) => key !== 'name') || !Object.hasOwn(body, 'name')) {
          throw new ApiError(400, 'invalid_data', 'Для создания передайте объект только с полем name.');
        }
        const venue = await store.create(body.name);
        return respondJson(req, res, 201, venue, {
          ETag: `"${venue.revision}"`,
          Location: `/api/venues/${venue.id}`,
        });
      }

      const venueMatch = /^\/api\/venues\/([^/]+)$/.exec(pathname);
      if (venueMatch) {
        let venueId;
        try {
          venueId = decodeURIComponent(venueMatch[1]);
        } catch {
          throw new ApiError(400, 'invalid_id', 'Некорректный идентификатор площадки.');
        }
        if (req.method === 'GET' || req.method === 'HEAD') {
          const venue = await store.get(venueId);
          if (!venue) throw new ApiError(404, 'not_found', 'Площадка не найдена.');
          return respondJson(req, res, 200, venue, { ETag: `"${venue.revision}"` });
        }
        if (req.method === 'PUT') {
          authorize(req, organizerToken);
          const revision = expectedRevision(req);
          const body = await readJson(req);
          const venue = await store.replace(venueId, body, revision);
          return respondJson(req, res, 200, venue, { ETag: `"${venue.revision}"` });
        }
        return respondJson(req, res, 405, { error: 'method_not_allowed' }, { Allow: 'GET, HEAD, PUT' });
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return respondJson(req, res, 405, { error: 'method_not_allowed' }, { Allow: 'GET, HEAD' });
      }
      if (/^\/map\/[^/]+$/.test(pathname) && pathname !== '/map/demo') {
        return respond(req, res, 200, 'text/html; charset=utf-8', await readFile(indexFile));
      }
      if (pages.has(pathname)) {
        return respond(req, res, 200, 'text/html; charset=utf-8', await readFile(pages.get(pathname)));
      }
      if (assets.has(pathname)) {
        const [file, type] = assets.get(pathname);
        return respond(req, res, 200, type, await readFile(file));
      }
      return respondJson(req, res, 404, { error: 'not_found', message: 'Страница не найдена.' });
    } catch (error) {
      const storeResponse = storeErrorResponse(error);
      if (error instanceof ApiError || storeResponse) {
        const status = error instanceof ApiError ? error.status : storeResponse.status;
        const body = error instanceof ApiError
          ? { error: error.code, message: error.message }
          : { error: storeResponse.code, message: storeResponse.message };
        return respondJson(req, res, status, body, error.headers ?? {});
      }
      console.error(error);
      return respondJson(req, res, 500, { error: 'storage_error', message: 'Не удалось обработать запрос.' });
    }
  });
}