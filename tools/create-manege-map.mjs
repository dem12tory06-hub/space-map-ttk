import { manegeLayout } from '../src/shared/manege-template.js';

const baseUrl = process.env.BASE_URL?.replace(/\/$/, '');
const token = process.env.ORGANIZER_TOKEN;
const existingId = process.env.VENUE_ID;

if (!baseUrl || !/^https?:\/\//.test(baseUrl) || !token) {
  console.error('Задайте BASE_URL и ORGANIZER_TOKEN. VENUE_ID необязателен для пустой существующей площадки.');
  process.exit(1);
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...options.headers },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${body.message ?? body.error ?? 'Ошибка сервера'}`);
  return body;
}

try {
  const venue = existingId
    ? await request(`/api/venues/${encodeURIComponent(existingId)}`)
    : await request('/api/venues', { method: 'POST', body: JSON.stringify({ name: 'Манеж ДГТУ — Хакатон Осень 2026' }) });
  const floor = venue.floors?.[0];
  if (!floor || venue.floors.length !== 1 || floor.plan.background || floor.plan.elements.length || floor.places.length
    || floor.panoramaPoints.length || floor.routeNodes.length || floor.routeEdges.length) {
    throw new Error(`Площадка ${venue.id} не пустая. Данные не менялись.`);
  }
  const saved = await request(`/api/venues/${encodeURIComponent(venue.id)}`, {
    method: 'PUT',
    headers: { 'If-Match': `"${venue.revision}"` },
    body: JSON.stringify({ name: 'Манеж ДГТУ — Хакатон Осень 2026', floors: [manegeLayout(floor)] }),
  });
  const check = await request(`/api/venues/${encodeURIComponent(saved.id)}`);
  if (check.revision !== saved.revision || check.floors[0].places.length !== 9) throw new Error('Повторное чтение сохранённой карты не совпало.');
  console.log(`Карта сохранена на сервере: ${baseUrl}/map/${encodeURIComponent(saved.id)}`);
  console.log(`Редактор: ${baseUrl}/constructor?venue=${encodeURIComponent(saved.id)}`);
  console.log(`ID площадки: ${saved.id}; версия: ${saved.revision}`);
} catch (error) {
  console.error(`Не удалось создать карту: ${error.message}`);
  process.exitCode = 1;
}
