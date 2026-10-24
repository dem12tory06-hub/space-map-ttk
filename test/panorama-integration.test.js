import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createAppServer } from '../server/app.js';
import { createVenueStore } from '../server/venue-store.js';

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}
async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

test('organizer stitches a saved place and visitor can open persisted panorama image', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'space-panorama-'));
  const filename = 'abcdefabcdefabcdefabcdefabcdefab.jpg';
  const token = 'panorama-test-secret';
  let received;
  const worker = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const url = new URL(req.url, 'http://localhost');
    received = { name: url.searchParams.get('pointName'), body: Buffer.concat(chunks).toString('latin1') };
    await writeFile(join(directory, filename), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ filename, width: 1942, height: 1113, inputCount: 3 }));
  });
  let server;
  try {
    const workerUrl = await listen(worker);
    const store = createVenueStore(join(directory, 'venues.json'));
    await store.initialize();
    server = createAppServer({ store, organizerToken: token, backgroundDirectory: join(directory, 'backgrounds'),
      panoramaDirectory: directory, stitchServiceUrl: workerUrl });
    const base = await listen(server);
    const venue = await store.create('Манеж');
    const floor = venue.floors[0];
    floor.places.push({ id: 'entrance', type: 'entrance', name: 'Вход', category: '', description: '', x: 0.2, y: 0.3 });
    floor.panoramaPoints.push({ id: 'pano-entrance', name: 'Обзор входа', x: 0.24, y: 0.32 });
    await store.replace(venue.id, { name: venue.name, floors: venue.floors }, venue.revision);
    const path = `${base}/api/venues/${venue.id}/floors/${floor.id}/targets/entrance/stitch`;
    const form = new FormData();
    form.append('photos', new Blob(['shot-one'], { type: 'image/jpeg' }), '1.jpg');
    form.append('photos', new Blob(['shot-two'], { type: 'image/jpeg' }), '2.jpg');
    const denied = await fetch(path, { method: 'POST', body: form });
    assert.equal(denied.status, 401);
    const response = await fetch(path, { method: 'POST', body: form, headers: {
      Authorization: `Bearer ${token}`, 'If-Match': '"2"',
    } });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.imageUrl, `/api/panoramas/${filename}`);
    assert.equal(received.name, 'Вход');
    assert.match(received.body, /shot-one/);
    const reopened = createVenueStore(join(directory, 'venues.json'));
    const saved = await reopened.get(venue.id);
    const linked = saved.floors[0].panoramaPoints.find((item) => item.placeId === 'entrance');
    assert.equal(linked?.imageUrl, result.imageUrl);
    const pointPath = `${base}/api/venues/${venue.id}/floors/${floor.id}/targets/pano-entrance/stitch`;
    const explicit = await fetch(pointPath, { method: 'POST', body: form, headers: {
      Authorization: `Bearer ${token}`, 'If-Match': `"${result.revision}"`,
    } });
    assert.equal(explicit.status, 200);
    const explicitResult = await explicit.json();
    assert.equal(explicitResult.pointId, 'pano-entrance');
    assert.equal(received.name, 'Обзор входа');
    const afterExplicit = await store.get(venue.id);
    assert.equal(afterExplicit.floors[0].panoramaPoints.length, 2);
    const capturedPoint = afterExplicit.floors[0].panoramaPoints.find((item) => item.id === 'pano-entrance');
    assert.equal(capturedPoint.imageUrl, explicitResult.imageUrl);
    assert.deepEqual([capturedPoint.x, capturedPoint.y], [0.24, 0.32]);
    const image = await fetch(base + result.imageUrl);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/jpeg');
    const capturePage = await fetch(base + '/panorama-capture');
    assert.equal(capturePage.status, 200);
    assert.match(await capturePage.text(), /Собрать панораму/);
    const oldRevision = await fetch(path, { method: 'POST', body: form, headers: {
      Authorization: `Bearer ${token}`, 'If-Match': '"2"',
    } });
    assert.equal(oldRevision.status, 412);
    assert.deepEqual(await readFile(join(directory, filename)), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  } finally {
    if (server) await close(server);
    await close(worker);
    await rm(directory, { recursive: true, force: true });
  }
});
