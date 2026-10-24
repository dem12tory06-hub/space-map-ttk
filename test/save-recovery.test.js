import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAppServer } from '../server/app.js';
import { createVenueStore } from '../server/venue-store.js';
import { recoverSaveRequest, venueSavePayload } from '../src/constructor/constructor.js';

test('repair real 400 without dropping map data; clear background through PUT and reopen store', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'space-map-recovery-test-'));
  const store = createVenueStore(join(directory, 'venues.json'));
  const server = createAppServer({ store, organizerToken: 'qa-only', backgroundDirectory: join(directory, 'backgrounds') });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { Authorization: 'Bearer qa-only', 'Content-Type': 'application/json' };
  try {
    let venue = await store.create('Recovery test');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWJiYGD4DwAAAP//cGajQwAAAAZJREFUAwABDgEC81VxbAAAAABJRU5ErkJggg==', 'base64');
    const upload = await fetch(`${base}/api/venues/${venue.id}/floors/${venue.floors[0].id}/background`, {
      method: 'PUT', headers: { Authorization: 'Bearer qa-only', 'Content-Type': 'image/png', 'If-Match': '"1"' }, body: png,
    });
    assert.equal(upload.status, 200);
    venue = await upload.json();
    venue.floors[0].plan.elements.push({ id: 'table', type: 'table', name: 'Unsaved table', x: 0.1, y: 0.2, width: 0.15, height: 0.1, rotation: 0 });
    venue.floors[0].plan.background.opacity = 0.65;
    const url = `${base}/api/venues/${venue.id}`;
    const denied = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': '"2"' }, body: JSON.stringify(venue) });
    assert.equal(denied.status, 401);
    const invalid = await fetch(url, { method: 'PUT', headers: { ...headers, 'If-Match': '"2"' }, body: JSON.stringify(venue) });
    assert.equal(invalid.status, 400);
    const repaired = recoverSaveRequest(venue, '"2"', invalid.status, await invalid.json());
    assert.deepEqual(repaired.body.floors, venue.floors);
    const saved = await fetch(url, { method: 'PUT', headers: { ...headers, 'If-Match': repaired.revision }, body: JSON.stringify(repaired.body) });
    assert.equal(saved.status, 200);
    const loaded = await (await fetch(url)).json();
    assert.deepEqual(loaded.floors, venue.floors);
    const imageUrl = `${url}/floors/${loaded.floors[0].id}/background/${loaded.floors[0].plan.background.id}`;
    assert.deepEqual(Buffer.from(await (await fetch(imageUrl)).arrayBuffer()), png);
    const invalidRevision = await fetch(url, { method: 'PUT', headers: { ...headers, 'If-Match': '3' }, body: JSON.stringify(venueSavePayload(loaded)) });
    assert.equal(invalidRevision.status, 400);
    assert.equal(recoverSaveRequest(venueSavePayload(loaded), '3', 400, await invalidRevision.json()).revision, '"3"');
    loaded.floors[0].plan.background = null;
    const deleted = await fetch(url, { method: 'PUT', headers: { ...headers, 'If-Match': '"3"' }, body: JSON.stringify(venueSavePayload(loaded)) });
    assert.equal(deleted.status, 200);
    const reopened = await createVenueStore(join(directory, 'venues.json')).get(loaded.id);
    assert.equal(reopened.floors[0].plan.background, null);
    assert.deepEqual(reopened.floors[0].plan.elements, venue.floors[0].plan.elements);
    const conflict = await fetch(url, { method: 'PUT', headers: { ...headers, 'If-Match': '"3"' }, body: JSON.stringify(venueSavePayload(loaded)) });
    assert.equal(conflict.status, 412);
    assert.equal(recoverSaveRequest(loaded, '"3"', 412, await conflict.json()), null);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('does not discard unknown fields, background placement or validation failures', () => {
  const body = { id: 'id', name: 'Venue', floors: [], customContent: 'must not disappear' };
  assert.equal(recoverSaveRequest(body, '"1"', 400, { error: 'invalid_data', message: 'Неизвестное поле venue.id.' }), null);
  assert.equal(recoverSaveRequest(body, '"1"', 400, { error: 'invalid_data', message: 'Неизвестное поле floors[0].plan.background.placement.' }), null);
});
