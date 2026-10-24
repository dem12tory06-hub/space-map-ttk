import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import test from 'node:test';
import { createAppServer } from '../server/app.js';
import { createVenueStore } from '../server/venue-store.js';

const organizerToken = 'test-organizer-token-not-for-production';

async function startServer(directory, token = organizerToken) {
  const store = createVenueStore(join(directory, 'venues.json'));
  await store.initialize();
  const server = createAppServer({
    store,
    organizerToken: token,
    backgroundDirectory: join(directory, 'backgrounds'),
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function stopServer(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function withTemporaryDirectory(callback) {
  const directory = await mkdtemp(join(tmpdir(), 'space-map-api-'));
  try {
    await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function startProjectProcess(directory) {
  const projectDirectory = fileURLToPath(new URL('../', import.meta.url));
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: projectDirectory,
    env: {
      ...process.env,
      PORT: '0',
      HOST: '127.0.0.1',
      BIND_HOST: '127.0.0.1',
      DATA_DIR: directory,
      ORGANIZER_TOKEN: organizerToken,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const lines = createInterface({ input: child.stdout });
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
  const line = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Project server startup timeout')), 5000);
    lines.once('line', (value) => {
      clearTimeout(timer);
      resolve(value);
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Project server exited early (${code}): ${stderr}`));
    });
  });
  const match = /http:\/\/127\.0\.0\.1:(\d+)/.exec(line);
  if (!match) throw new Error(`Could not read test server address: ${line}`);
  return { child, lines, baseUrl: `http://127.0.0.1:${match[1]}` };
}

async function stopProjectProcess(project) {
  if (project.child.exitCode === null) {
    const exited = once(project.child, 'exit');
    project.child.kill();
    await exited;
  }
  project.lines.close();
}

test('protects writes and persists venue creation, edits, and deletions after app restart', async () => {
  await withTemporaryDirectory(async (directory) => {
    let app = await startServer(directory);
    let venueId;
    let finalVenue;
    try {
      const denied = await fetch(`${app.baseUrl}/api/venues`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Закрытая площадка' }),
      });
      assert.equal(denied.status, 401);

      const createdResponse = await fetch(`${app.baseUrl}/api/venues`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${organizerToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Демо-площадка' }),
      });
      assert.equal(createdResponse.status, 201);
      const created = await createdResponse.json();
      venueId = created.id;
      assert.equal(created.floors.length, 1);
      assert.deepEqual(created.floors[0].plan.elements, []);
      assert.deepEqual(created.floors[0].places, []);
      assert.equal(createdResponse.headers.get('etag'), '"1"');

      const floor = created.floors[0];
      const invalidResponse = await fetch(`${app.baseUrl}/api/venues/${venueId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${organizerToken}`,
          'Content-Type': 'application/json',
          'If-Match': '"1"',
        },
        body: JSON.stringify({ name: 'Площадка', floors: [{
          ...floor,
          plan: { ...floor.plan, elements: [{
            id: 'bad-geometry', type: 'table', name: 'Стол', x: 0.9, y: 0.1, width: 0.2, height: 0.2,
          }] },
        }] }),
      });
      assert.equal(invalidResponse.status, 400);

      const unauthorizedUpdate = await fetch(`${app.baseUrl}/api/venues/${venueId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'If-Match': '"1"' },
        body: JSON.stringify({ name: created.name, floors: created.floors }),
      });
      assert.equal(unauthorizedUpdate.status, 401);

      const updatedResponse = await fetch(`${app.baseUrl}/api/venues/${venueId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${organizerToken}`,
          'Content-Type': 'application/json',
          'If-Match': '"1"',
        },
        body: JSON.stringify({
          name: 'Демо-площадка обновлена',
          floors: [{
            ...floor,
            plan: { ...floor.plan, elements: [{
              id: 'table-keep-id', type: 'table', name: 'Стол A', x: 0.1, y: 0.2, width: 0.2, height: 0.1,
            }] },
            places: [{
              id: 'registration-keep-id', type: 'registration', name: 'Регистрация',
              category: 'Сервис', description: 'У главного входа', x: 0.5, y: 0.9,
            }],
          }],
        }),
      });
      assert.equal(updatedResponse.status, 200);
      const updated = await updatedResponse.json();
      assert.equal(updated.revision, 2);
      assert.equal(updated.floors[0].plan.elements[0].id, 'table-keep-id');

      const movedResponse = await fetch(`${app.baseUrl}/api/venues/${venueId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${organizerToken}`,
          'Content-Type': 'application/json',
          'If-Match': '"2"',
        },
        body: JSON.stringify({
          name: updated.name,
          floors: [{
            ...updated.floors[0],
            plan: { ...updated.floors[0].plan, elements: [{
              ...updated.floors[0].plan.elements[0],
              name: 'Стол A перемещён',
              x: 0.3,
              y: 0.4,
            }] },
          }],
        }),
      });
      assert.equal(movedResponse.status, 200);
      const moved = await movedResponse.json();
      assert.equal(moved.revision, 3);
      assert.equal(moved.floors[0].plan.elements[0].id, 'table-keep-id');
      assert.equal(moved.floors[0].plan.elements[0].x, 0.3);

      const staleResponse = await fetch(`${app.baseUrl}/api/venues/${venueId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${organizerToken}`,
          'Content-Type': 'application/json',
          'If-Match': '"1"',
        },
        body: JSON.stringify({ name: moved.name, floors: moved.floors }),
      });
      assert.equal(staleResponse.status, 412);

      const deletedResponse = await fetch(`${app.baseUrl}/api/venues/${venueId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${organizerToken}`,
          'Content-Type': 'application/json',
          'If-Match': '"3"',
        },
        body: JSON.stringify({ name: moved.name, floors: [{
          ...moved.floors[0],
          plan: { ...updated.floors[0].plan, elements: [] },
          places: [],
        }] }),
      });
      assert.equal(deletedResponse.status, 200);
      finalVenue = await deletedResponse.json();
      assert.deepEqual(finalVenue.floors[0].places, []);
    } finally {
      await stopServer(app.server);
    }

    app = await startServer(directory);
    try {
      const loadedResponse = await fetch(`${app.baseUrl}/api/venues/${venueId}`);
      assert.equal(loadedResponse.status, 200);
      assert.deepEqual(await loadedResponse.json(), finalVenue);
    } finally {
      await stopServer(app.server);
    }
  });
});

test('returns 503 instead of allowing writes when organizer access is not configured', async () => {
  await withTemporaryDirectory(async (directory) => {
    const app = await startServer(directory, '');
    try {
      const response = await fetch(`${app.baseUrl}/api/venues`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${organizerToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Площадка' }),
      });
      assert.equal(response.status, 503);
    } finally {
      await stopServer(app.server);
    }
  });
});

test('loads the venue after restarting the actual Node server process', async () => {
  await withTemporaryDirectory(async (directory) => {
    let project = await startProjectProcess(directory);
    let venueId;
    let expectedVenue;
    try {
      const response = await fetch(`${project.baseUrl}/api/venues`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${organizerToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Площадка после перезапуска' }),
      });
      assert.equal(response.status, 201);
      expectedVenue = await response.json();
      venueId = expectedVenue.id;
    } finally {
      await stopProjectProcess(project);
    }

    project = await startProjectProcess(directory);
    try {
      const response = await fetch(`${project.baseUrl}/api/venues/${venueId}`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), expectedVenue);
    } finally {
      await stopProjectProcess(project);
    }
  });
});

test('serves only the explicit venue browser test page and its assets', async () => {
  await withTemporaryDirectory(async (directory) => {
    const app = await startServer(directory);
    try {
      for (const [path, type] of [
        ['/map/venue-test-id', 'text/html'],
        ['/constructor', 'text/html'],
        ['/src/constructor/constructor.js', 'text/javascript'],
        ['/src/constructor/constructor.css', 'text/css'],
        ['/test/venue', 'text/html'],
        ['/test/venue-test.js', 'text/javascript'],
        ['/test/venue-test.css', 'text/css'],
      ]) {
        const response = await fetch(`${app.baseUrl}${path}`);
        assert.equal(response.status, 200);
        assert.ok(response.headers.get('content-type').includes(type));
      }
      const privateSource = await fetch(`${app.baseUrl}/server/venue-store.js`);
      assert.equal(privateSource.status, 404);
    } finally {
      await stopServer(app.server);
    }
  });
});

test('protects background upload, keeps images outside JSON, and preserves old image and objects on invalid replacement', async () => {
  await withTemporaryDirectory(async (directory) => {
    const app = await startServer(directory);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWJiYGD4DwAAAP//cGajQwAAAAZJREFUAwABDgEC81VxbAAAAABJRU5ErkJggg==', 'base64');
    const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJUAB//Z', 'base64');
    let venueId;
    let floorId;
    let currentBackgroundId;
    try {
      const create = await fetch(`${app.baseUrl}/api/venues`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${organizerToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Подложка' }),
      });
      const created = await create.json();
      venueId = created.id;
      const floor = created.floors[0];
      const element = {
        id: 'stable-table-id', type: 'table', name: 'Стол',
        x: 0.1, y: 0.1, width: 0.2, height: 0.2, rotation: 0,
      };
      const updated = await fetch(`${app.baseUrl}/api/venues/${venueId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${organizerToken}`,
          'Content-Type': 'application/json',
          'If-Match': '"1"',
        },
        body: JSON.stringify({
          name: created.name,
          floors: [{ ...floor, plan: { ...floor.plan, elements: [element] } }],
        }),
      });
      assert.equal(updated.status, 200);
      const venue = await updated.json();
      floorId = venue.floors[0].id;
      const uploadUrl = `${app.baseUrl}/api/venues/${venueId}/floors/${floorId}/background`;

      const unauthorized = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/png', 'If-Match': '"2"' },
        body: png,
      });
      assert.equal(unauthorized.status, 401);

      const firstUpload = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${organizerToken}`,
          'Content-Type': 'image/png',
          'If-Match': '"2"',
        },
        body: png,
      });
      assert.equal(firstUpload.status, 200);
      const withBackground = await firstUpload.json();
      const firstBackground = withBackground.floors[0].plan.background;
      assert.equal(firstBackground.width, 1);
      assert.equal(firstBackground.height, 1);
      assert.deepEqual(firstBackground.placement, { x: 0.2, y: 0, width: 0.6, height: 1 });
      assert.equal(withBackground.floors[0].plan.elements[0].id, 'stable-table-id');
      assert.equal(Object.hasOwn(withBackground.floors[0].plan.background, 'data'), false);

      const imageUrl = `${app.baseUrl}/api/venues/${venueId}/floors/${floorId}/background/${firstBackground.id}`;
      const imageRead = await fetch(imageUrl);
      assert.equal(imageRead.status, 200);
      assert.deepEqual(Buffer.from(await imageRead.arrayBuffer()), png);

      const corruptPng = Buffer.from(png);
      corruptPng[32] ^= 0xff;
      const corruptUpload = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${organizerToken}`,
          'Content-Type': 'image/png',
          'If-Match': '"3"',
        },
        body: corruptPng,
      });
      assert.equal(corruptUpload.status, 415);
      const afterCorruptUpload = await fetch(`${app.baseUrl}/api/venues/${venueId}`);
      assert.equal((await afterCorruptUpload.json()).floors[0].plan.background.id, firstBackground.id);

      const legacyUpdate = await fetch(`${app.baseUrl}/api/venues/${venueId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${organizerToken}`,
          'Content-Type': 'application/json',
          'If-Match': '"3"',
        },
        body: JSON.stringify({
          name: withBackground.name,
          floors: withBackground.floors.map((entry) => ({
            ...entry,
            plan: {
              id: entry.plan.id,
              width: entry.plan.width,
              height: entry.plan.height,
              elements: entry.plan.elements,
            },
          })),
        }),
      });
      assert.equal(legacyUpdate.status, 200);
      const afterLegacyUpdate = await legacyUpdate.json();
      assert.equal(afterLegacyUpdate.floors[0].plan.background.id, firstBackground.id);

      const invalidReplacement = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${organizerToken}`,
          'Content-Type': 'image/png',
          'If-Match': '"4"',
        },
        body: Buffer.from('not an image'),
      });
      assert.equal(invalidReplacement.status, 415);
      const afterRejectedUpload = await fetch(`${app.baseUrl}/api/venues/${venueId}`);
      const unchanged = await afterRejectedUpload.json();
      assert.equal(unchanged.floors[0].plan.background.id, firstBackground.id);
      assert.equal(unchanged.floors[0].plan.elements[0].id, 'stable-table-id');

      const secondUpload = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${organizerToken}`,
          'Content-Type': 'image/png',
          'If-Match': '"4"',
        },
        body: png,
      });
      assert.equal(secondUpload.status, 200);
      const replaced = await secondUpload.json();
      assert.notEqual(replaced.floors[0].plan.background.id, firstBackground.id);
      assert.equal(replaced.floors[0].plan.elements[0].id, 'stable-table-id');
      assert.equal((await fetch(imageUrl)).status, 404);

      const jpegUpload = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${organizerToken}`,
          'Content-Type': 'image/jpeg',
          'If-Match': '"5"',
        },
        body: jpeg,
      });
      assert.equal(jpegUpload.status, 200);
      const withJpeg = await jpegUpload.json();
      const jpegBackground = withJpeg.floors[0].plan.background;
      assert.equal(jpegBackground.mediaType, 'image/jpeg');
      assert.equal(jpegBackground.width, 2);
      assert.equal(jpegBackground.height, 1);
      assert.equal(jpegBackground.placement.x, 0);
      assert.ok(Math.abs(jpegBackground.placement.y - 1 / 12) < 1e-12);
      assert.equal(jpegBackground.placement.width, 1);
      assert.ok(Math.abs(jpegBackground.placement.height - 5 / 6) < 1e-12);
      assert.equal(withJpeg.floors[0].plan.elements[0].id, 'stable-table-id');
      currentBackgroundId = jpegBackground.id;
      const jpegUrl = `${app.baseUrl}/api/venues/${venueId}/floors/${floorId}/background/${currentBackgroundId}`;
      const jpegRead = await fetch(jpegUrl);
      assert.equal(jpegRead.status, 200);
      assert.equal(jpegRead.headers.get('content-type'), 'image/jpeg');
      assert.deepEqual(Buffer.from(await jpegRead.arrayBuffer()), jpeg);
    } finally {
      await stopServer(app.server);
    }

    const reopened = await startServer(directory);
    try {
      const persistedVenue = await fetch(`${reopened.baseUrl}/api/venues/${venueId}`);
      assert.equal(persistedVenue.status, 200);
      const persisted = await persistedVenue.json();
      assert.equal(persisted.floors[0].plan.background.id, currentBackgroundId);
      const persistedImage = await fetch(`${reopened.baseUrl}/api/venues/${venueId}/floors/${floorId}/background/${currentBackgroundId}`);
      assert.equal(persistedImage.status, 200);
      assert.equal(persistedImage.headers.get('content-type'), 'image/jpeg');
      assert.deepEqual(Buffer.from(await persistedImage.arrayBuffer()), jpeg);

      const deleteUrl = `${reopened.baseUrl}/api/venues/${venueId}/floors/${floorId}/background`;
      const deniedDelete = await fetch(deleteUrl, {
        method: 'DELETE',
        headers: { 'If-Match': '"6"' },
      });
      assert.equal(deniedDelete.status, 401);
        const backgroundDeleteUrl = `${reopened.baseUrl}/api/venues/${venueId}/floors/${floorId}/background`;
        const unauthorizedDelete = await fetch(backgroundDeleteUrl, {
          method: 'DELETE',
          headers: { 'If-Match': '"6"' },
        });
        assert.equal(unauthorizedDelete.status, 401);
        const authorizedDelete = await fetch(backgroundDeleteUrl, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${organizerToken}`,
            'If-Match': '"6"',
          },
        });
        assert.equal(authorizedDelete.status, 200);
        const withoutBackground = await authorizedDelete.json();
        assert.equal(withoutBackground.floors[0].plan.background, null);
        assert.equal(withoutBackground.floors[0].plan.elements[0].id, 'stable-table-id');
        assert.equal((await fetch(`${reopened.baseUrl}/api/venues/${venueId}/floors/${floorId}/background/${currentBackgroundId}`)).status, 404);

        const point = { id: 'panorama-entrance', name: 'Вход', x: 0.25, y: 0.7, haov: 180 };
        const pointSave = await fetch(`${reopened.baseUrl}/api/venues/${venueId}`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${organizerToken}`,
            'Content-Type': 'application/json',
            'If-Match': '"7"',
          },
          body: JSON.stringify({ name: withoutBackground.name, floors: [
            { ...withoutBackground.floors[0], panoramaPoints: [point] },
          ] }),
        });
        assert.equal(pointSave.status, 200);
        const panoramaUrl = `${reopened.baseUrl}/api/venues/${venueId}/floors/${floorId}/panoramas/${point.id}/image`;
        assert.equal((await fetch(panoramaUrl)).status, 404);
        const noKey = await fetch(panoramaUrl, {
          method: 'PUT', headers: { 'Content-Type': 'image/jpeg', 'If-Match': '"8"' }, body: jpeg,
        });
        assert.equal(noKey.status, 401);
        const uploaded = await fetch(panoramaUrl, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${organizerToken}`, 'Content-Type': 'image/jpeg', 'If-Match': '"8"' },
          body: jpeg,
        });
        assert.equal(uploaded.status, 200);
        const withPanorama = await uploaded.json();
        assert.match(withPanorama.floors[0].panoramaPoints[0].imageId, /^[a-f0-9-]{36}$/);
        assert.equal(withPanorama.floors[0].panoramaPoints[0].haov, 180);
        const imageRead = await fetch(panoramaUrl);
        assert.equal(imageRead.status, 200);
        assert.deepEqual(Buffer.from(await imageRead.arrayBuffer()), jpeg);
        const staleUpload = await fetch(panoramaUrl, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${organizerToken}`, 'Content-Type': 'image/jpeg', 'If-Match': '"8"' },
          body: jpeg,
        });
        assert.equal(staleUpload.status, 412);
        assert.equal((await fetch(panoramaUrl)).status, 200);
    } finally {
      await stopServer(reopened.server);
    }
    const afterPanoramaRestart = await startServer(directory);
    try {
      const persisted = await (await fetch(`${afterPanoramaRestart.baseUrl}/api/venues/${venueId}`)).json();
      assert.equal(persisted.floors[0].panoramaPoints[0].name, 'Вход');
      assert.ok(persisted.floors[0].panoramaPoints[0].imageId);
      const image = await fetch(`${afterPanoramaRestart.baseUrl}/api/venues/${venueId}/floors/${floorId}/panoramas/panorama-entrance/image`);
      assert.equal(image.status, 200);
      assert.deepEqual(Buffer.from(await image.arrayBuffer()), jpeg);
    } finally {
      await stopServer(afterPanoramaRestart.server);
    }
  });
});
