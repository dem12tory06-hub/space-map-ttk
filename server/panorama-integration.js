import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';

const limit = 150 * 1024 * 1024;
const imageName = /^[a-f0-9]{32}\.jpg$/;

function findPanoramaTarget(floor, id) {
  const panorama = floor.panoramaPoints.find((item) => item.id === id);
  if (panorama) return panorama;
  const place = floor.places.find((item) => item.id === id);
  if (place) return place;
  const element = floor.plan.elements.find((item) => item.id === id && ['zone', 'stand', 'stage'].includes(item.type));
  return element ? { id, name: element.name, x: element.x + element.width / 2, y: element.y + element.height / 2 } : null;
}

export async function handlePanoramaRequest(req, res, pathname, { store, organizerToken, panoramaDirectory, stitchServiceUrl }) {
  const reply = (status, value, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(req.method === 'HEAD' ? undefined : JSON.stringify(value));
  };
  const imageMatch = /^\/api\/panoramas\/([^/]+)$/.exec(pathname);
  if (imageMatch) {
    if (!['GET', 'HEAD'].includes(req.method)) return reply(405, { error: 'method_not_allowed' }, { Allow: 'GET, HEAD' });
    const name = imageMatch[1];
    if (!imageName.test(name)) return reply(404, { error: 'not_found' });
    try {
      const bytes = await readFile(join(panoramaDirectory, name));
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': bytes.length, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=86400' });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch (error) {
      if (error.code === 'ENOENT') return reply(404, { error: 'not_found' });
      throw error;
    }
    return true;
  }
  const match = /^\/api\/venues\/([^/]+)\/floors\/([^/]+)\/targets\/([^/]+)\/stitch$/.exec(pathname);
  if (!match) return false;
  if (req.method !== 'POST') return reply(405, { error: 'method_not_allowed' }, { Allow: 'POST' });
  const [venueId, floorId, targetId] = match.slice(1).map(decodeURIComponent);
  const validId = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
  if (![venueId, floorId, targetId].every((value) => validId.test(value))) return reply(400, { error: 'invalid_id', message: 'Некорректная точка съёмки.' });
  const matchToken = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '');
  const expectedToken = createHash('sha256').update(organizerToken).digest();
  const receivedToken = createHash('sha256').update(matchToken?.[1] ?? '').digest();
  if (!organizerToken || !matchToken || !timingSafeEqual(expectedToken, receivedToken)) {
    return reply(401, { error: 'unauthorized', message: 'Требуется ключ организатора.' });
  }
  if (!panoramaDirectory || !stitchServiceUrl) return reply(503, { error: 'stitch_not_configured', message: 'Сервер склейки не настроен.' });
  if (!req.headers['content-type']?.startsWith('multipart/form-data;')) return reply(415, { error: 'unsupported_media_type', message: 'Ожидаются фотографии из формы.' });
  const length = Number(req.headers['content-length']);
  if (!Number.isSafeInteger(length) || length < 1 || length > limit) return reply(413, { error: 'request_too_large', message: 'Серия должна быть не больше 150 МБ.' });
  const venue = await store.get(venueId);
  const floor = venue?.floors.find((item) => item.id === floorId);
  const place = floor && findPanoramaTarget(floor, targetId);
  if (!place) return reply(404, { error: 'not_found', message: 'Точка на карте не найдена.' });
  const currentRevision = `"${venue.revision}"`;
  if (req.headers['if-match'] !== currentRevision) return reply(412, { error: 'revision_conflict', message: 'Карта изменилась. Обновите страницу перед склейкой.' });

  let used = 0;
  const bounded = new Transform({ transform(chunk, encoding, callback) {
    used += chunk.length;
    callback(used > limit ? new Error('Серия превышает 150 МБ.') : null, chunk);
  } });
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 180_000);
  let result;
  try {
    const endpoint = new URL('/api/stitch', stitchServiceUrl);
    endpoint.searchParams.set('pointId', targetId);
    endpoint.searchParams.set('pointName', place.name);
    const response = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': req.headers['content-type'], 'Content-Length': String(length) },
      body: Readable.toWeb(req.pipe(bounded)), duplex: 'half', signal: abort.signal,
    });
    result = await response.json();
    if (!response.ok) return reply([400, 413, 422].includes(response.status) ? response.status : 502, { error: 'stitch_failed', message: result.error ?? 'Склейка не удалась.' });
  } catch (error) {
    return reply(502, { error: 'stitch_unavailable', message: error.name === 'AbortError' ? 'Склейка заняла слишком много времени.' : 'Сервер склейки недоступен.' });
  } finally {
    clearTimeout(timeout);
  }
  // The worker only returns a filename; never trust a client supplied filesystem path.
  if (!imageName.test(result.filename ?? '')) return reply(502, { error: 'invalid_stitch_result', message: 'Сервер склейки вернул неверный файл.' });
  const imageUrl = `/api/panoramas/${result.filename}`;
  const latest = await store.get(venueId);
  const latestFloor = latest?.floors.find((item) => item.id === floorId);
  const latestPlace = latestFloor && findPanoramaTarget(latestFloor, targetId);
  if (!latestPlace || latest.revision !== venue.revision) {
    await rm(join(panoramaDirectory, result.filename), { force: true });
    return reply(412, { error: 'revision_conflict', message: 'Пока собирались снимки, карта изменилась. Обновите страницу и повторите.' });
  }
  const explicitPoint = latestFloor.panoramaPoints.find((item) => item.id === targetId);
  const point = explicitPoint ?? latestFloor.panoramaPoints.find((item) => item.placeId === targetId);
  if (point) {
    Object.assign(point, { name: latestPlace.name, x: latestPlace.x, y: latestPlace.y, imageUrl, haov: 180, vaov: 120 });
  } else {
    latestFloor.panoramaPoints.push({ id: randomUUID(), name: latestPlace.name, x: latestPlace.x, y: latestPlace.y,
      placeId: targetId, imageUrl, haov: 180, vaov: 120 });
  }
  try {
    const saved = await store.replace(venueId, { name: latest.name, floors: latest.floors }, latest.revision);
    return reply(200, { ...result, imageUrl, revision: saved.revision, pointId: point?.id ?? latestFloor.panoramaPoints.find((item) => item.placeId === targetId).id });
  } catch (error) {
    await rm(join(panoramaDirectory, result.filename), { force: true });
    if (error.code === 'revision_conflict') return reply(412, { error: 'revision_conflict', message: 'Карта изменилась. Повторите склейку после обновления.' });
    throw error;
  }
}
