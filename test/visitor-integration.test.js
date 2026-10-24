import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createAppServer } from '../server/app.js';
import { createVenueStore } from '../server/venue-store.js';
import { routeBetween } from '../src/visitor/visitor-map.js';
import { navigationTargets } from '../src/shared/navigation-targets.js';

test('organizer venue is available on the visitor route and demo redirects to real entry points', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'visitor-map-'));
  const store = createVenueStore(join(directory, 'venues.json'));
  await store.initialize();
  const server = createAppServer({ store, organizerToken: 'test-token', backgroundDirectory: join(directory, 'backgrounds') });
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const created = await fetch(`${base}/api/venues`, {
      method: 'POST', headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Реальная площадка' }),
    });
    assert.equal(created.status, 201);
    const venue = await created.json();
    const edited = await fetch(`${base}/api/venues/${venue.id}`, {
      method: 'PUT',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json', 'If-Match': '"1"' },
      body: JSON.stringify({ name: venue.name, floors: [{
        ...venue.floors[0], places: [{
          id: 'entrance', type: 'entrance', name: 'Вход', category: '', description: 'Главный вход', x: 0.1, y: 0.2,
        }],
      }] }),
    });
    assert.equal(edited.status, 200);
    const visitorPage = await fetch(`${base}/map/${venue.id}`);
    assert.equal(visitorPage.status, 200);
    assert.match(await visitorPage.text(), /src\/main\.js/);
    const visitorData = await fetch(`${base}/api/venues/${venue.id}`);
    assert.equal((await visitorData.json()).floors[0].places[0].name, 'Вход');
    for (const path of ['/src/visitor/visitor-shell.js', '/src/visitor/visitor-map.js', '/src/visitor/visitor-map.css',
      '/src/shared/navigation-targets.js', '/src/shared/pathfinder.js']) {
      assert.equal((await fetch(`${base}${path}`)).status, 200);
    }
    for (const [path, destination] of [['/map/demo', '/map'], ['/editor/demo', '/constructor']]) {
      const response = await fetch(`${base}${path}`, { redirect: 'manual' });
      assert.equal(response.status, 302);
      assert.equal(response.headers.get('location'), destination);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test('saved walkable segments connect places through the shorter valid path', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'visitor-routes-'));
  const store = createVenueStore(join(directory, 'venues.json'));
  await store.initialize();
  try {
    const created = await store.create('Маршрут');
    const floor = created.floors[0];
    floor.places = [
      { id: 'entrance', type: 'entrance', name: 'Вход', category: '', description: '', x: 0.1, y: 0.2 },
      { id: 'registration', type: 'registration', name: 'Регистрация', category: '', description: '', x: 0.5, y: 0.2 },
      { id: 'partners', type: 'service', name: 'Партнёры', category: '', description: '', x: 0.9, y: 0.2 },
    ];
    floor.routeNodes = floor.places.map((place) => ({
      id: `node-${place.id}`, name: place.name, x: place.x, y: place.y, placeId: place.id,
    }));
    floor.routeEdges = [
      { id: 'walk-1', fromNodeId: 'node-entrance', toNodeId: 'node-registration', points: [{ x: 0.3, y: 0.4 }] },
      { id: 'walk-2', fromNodeId: 'node-registration', toNodeId: 'node-partners', points: [] },
      { id: 'walk-long', fromNodeId: 'node-entrance', toNodeId: 'node-partners', points: [{ x: 0.5, y: 0.9 }] },
    ];
    const saved = await store.replace(created.id, { name: created.name, floors: [floor] }, created.revision);
    const reloaded = await store.get(saved.id);
    assert.deepEqual(routeBetween(reloaded.floors[0], 'entrance', 'partners'), [
      { x: 100, y: 120 }, { x: 300, y: 240 }, { x: 500, y: 120 }, { x: 900, y: 120 },
    ]);
    reloaded.floors[0].routeEdges = [];
    assert.equal(routeBetween(reloaded.floors[0], 'entrance', 'partners'), null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('older routes to plan zones remain valid, though zones are no longer new endpoints', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'visitor-zone-routes-'));
  const store = createVenueStore(join(directory, 'venues.json'));
  await store.initialize();
  try {
    const created = await store.create('С зоной');
    const floor = created.floors[0];
    floor.plan.elements.push({
      id: 'partner-zone', type: 'zone', name: 'Зона партнёров',
      x: 0.6, y: 0.3, width: 0.2, height: 0.2, rotation: 0,
    });
    floor.places.push({
      id: 'entrance', type: 'entrance', name: 'Вход', category: '', description: '', x: 0.1, y: 0.2,
    });
    const targets = navigationTargets(floor);
    assert.equal(targets.some((target) => target.id === 'partner-zone'), false);
    floor.routeNodes = [...targets, { id: 'partner-zone', name: 'Зона партнёров', x: 0.7, y: 0.4 }].map((target) => ({
      id: `node-${target.id}`, name: target.name, x: target.x, y: target.y, placeId: target.id,
    }));
    floor.routeEdges.push({
      id: 'walk-zone', fromNodeId: 'node-entrance', toNodeId: 'node-partner-zone',
      points: [{ x: 0.4, y: 0.2 }],
    });
    const saved = await store.replace(created.id, { name: created.name, floors: [floor] }, created.revision);
    const reloaded = await store.get(saved.id);
    assert.deepEqual(routeBetween(reloaded.floors[0], 'entrance', 'partner-zone'), [
      { x: 100, y: 120 }, { x: 400, y: 120 }, { x: 700, y: 240 },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('zone and wall are areas without new endpoints; stand and stage are targets; Wi-Fi is a place', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'visitor-targets-'));
  const store = createVenueStore(join(directory, 'venues.json'));
  await store.initialize();
  try {
    const created = await store.create('Типы точек');
    const floor = created.floors[0];
    floor.places = [
      { id: 'entrance', type: 'entrance', name: 'Вход', category: '', description: '', x: 0.1, y: 0.1 },
      { id: 'reg', type: 'registration', name: 'Регистрация', category: '', description: '', x: 0.2, y: 0.1 },
      { id: 'wifi', type: 'wifi', name: 'Wi-Fi', category: '', description: '', wifiLogin: 'EventWiFi', wifiPassword: '12345678', x: 0.4, y: 0.1 },
    ];
    floor.plan.elements = [
      { id: 'zone', type: 'zone', name: 'Рабочая зона', x: 0.3, y: 0.3, width: 0.15, height: 0.15, rotation: 0 },
      { id: 'stand', type: 'stand', name: 'Стенд', x: 0.5, y: 0.2, width: 0.1, height: 0.1, rotation: 0 },
      { id: 'stage', type: 'stage', name: 'Сцена', x: 0.7, y: 0.2, width: 0.1, height: 0.1, rotation: 0 },
      { id: 'wall', type: 'partition', name: 'Стена', x: 0.9, y: 0.2, width: 0.05, height: 0.1, rotation: 0 },
    ];
    assert.deepEqual(navigationTargets(floor).map((item) => item.id), ['entrance', 'reg', 'wifi', 'stand', 'stage']);
    assert.equal(navigationTargets(floor).find((item) => item.id === 'wifi').description, 'Логин (сеть): EventWiFi\nПароль: 12345678');
    floor.routeNodes = [
      { id: 'from', name: 'Вход', x: 0.1, y: 0.1, placeId: 'entrance' },
      { id: 'to', name: 'Стенд', x: 0.55, y: 0.25, placeId: 'stand' },
    ];
    floor.routeEdges = [{ id: 'edge', fromNodeId: 'from', toNodeId: 'to', points: [{ x: 0.3, y: 0.2 }] }];
    const saved = await store.replace(created.id, { name: created.name, floors: [floor] }, created.revision);
    assert.equal((await store.get(saved.id)).floors[0].places.find((place) => place.id === 'wifi').wifiPassword, '12345678');
    assert.equal(routeBetween(saved.floors[0], 'entrance', 'stand').length, 3);
    floor.routeNodes[1].placeId = 'wall';
    await assert.rejects(store.replace(created.id, { name: created.name, floors: [floor] }, saved.revision),
      /недоступную точку маршрута/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
