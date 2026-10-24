import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createVenueStore } from '../server/venue-store.js';

async function withTemporaryDirectory(callback) {
  const directory = await mkdtemp(join(tmpdir(), 'space-map-store-'));
  try {
    await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('creates a venue with one empty floor and persists edits and deletions across reopen', async () => {
  await withTemporaryDirectory(async (directory) => {
    const filePath = join(directory, 'venues.json');
    const store = createVenueStore(filePath);
    await store.initialize();

    const created = await store.create('Тестовая площадка');
    assert.equal(created.floors.length, 1);
    assert.deepEqual(created.floors[0].plan.elements, []);
    assert.deepEqual(created.floors[0].places, []);
    assert.deepEqual(created.floors[0].panoramaPoints, []);
    assert.deepEqual(created.floors[0].routeNodes, []);

    const floor = created.floors[0];
    const edited = await store.replace(created.id, {
      name: 'Тестовая площадка 2',
      floors: [{
        ...floor,
        plan: {
          ...floor.plan,
          elements: [{
            id: 'element-stable-1', type: 'stage', name: 'Сцена',
            x: 0.2, y: 0.1, width: 0.4, height: 0.2, rotation: 0,
          }],
        },
        places: [{
          id: 'place-stable-1', type: 'registration', name: 'Регистрация',
          category: 'Сервис', description: 'У входа', x: 0.1, y: 0.8,
        }],
      }],
    }, created.revision);

    assert.equal(edited.id, created.id);
    assert.equal(edited.floors[0].plan.elements[0].id, 'element-stable-1');
    assert.equal(edited.floors[0].places[0].id, 'place-stable-1');

    const deleted = await store.replace(created.id, {
      name: edited.name,
      floors: [{ ...edited.floors[0], places: [] }],
    }, edited.revision);
    assert.deepEqual(deleted.floors[0].places, []);

    const reopened = createVenueStore(filePath);
    await reopened.initialize();
    assert.deepEqual(await reopened.get(created.id), deleted);
  });
});

test('rejects out-of-range normalized geometry', async () => {
  await withTemporaryDirectory(async (directory) => {
    const store = createVenueStore(join(directory, 'venues.json'));
    await store.initialize();
    const venue = await store.create('Площадка');
    const floor = venue.floors[0];

    await assert.rejects(store.replace(venue.id, {
      name: venue.name,
      floors: [{
        ...floor,
        plan: {
          ...floor.plan,
          elements: [{ id: 'bad', type: 'zone', name: 'Зона', x: 0.8, y: 0.2, width: 0.4, height: 0.2 }],
        },
      }],
    }, venue.revision), /выходят за границы плана/);
  });
});

test('accepts rotated geometry whose visible bounding box fits inside the plan', async () => {
  await withTemporaryDirectory(async (directory) => {
    const store = createVenueStore(join(directory, 'venues.json'));
    await store.initialize();
    const venue = await store.create('Площадка с повёрнутой зоной');
    const floor = venue.floors[0];
    const updated = await store.replace(venue.id, {
      name: venue.name,
      floors: [{
        ...floor,
        plan: {
          ...floor.plan,
          elements: [{
            id: 'rotated-zone-1', type: 'zone', name: 'Повернутая зона',
            x: 0.13868234252929687, y: -0.155928955078125,
            width: 0.2707959594726562, height: 0.91360107421875, rotation: 90,
          }],
        },
      }],
    }, venue.revision);
    assert.equal(updated.floors[0].plan.elements[0].id, 'rotated-zone-1');
    assert.equal(updated.floors[0].plan.elements[0].rotation, 90);
  });
});

test('does not replace stored data when the backing file cannot be written', async () => {
  await withTemporaryDirectory(async (directory) => {
    const filePath = join(directory, 'venues.json');
    const store = createVenueStore(filePath);
    await store.initialize();
    const venue = await store.create('Неизменённая площадка');
    await rm(filePath);
    await mkdir(filePath);

    await assert.rejects(store.replace(venue.id, {
      name: 'Новое имя',
      floors: venue.floors,
    }, venue.revision));
    assert.equal((await store.get(venue.id)).name, 'Неизменённая площадка');
  });
});

test('accepts legacy backgrounds, stores normalized placement, preserves it when omitted, and rejects invalid placement', async () => {
  await withTemporaryDirectory(async (directory) => {
    const store = createVenueStore(join(directory, 'venues.json'));
    await store.initialize();
    const created = await store.create('Площадка с подложкой');
    const floor = created.floors[0];
    const background = {
      id: 'background-stable-1',
      mediaType: 'image/png',
      width: 1200,
      height: 600,
      visible: true,
      opacity: 0.8,
    };

    const legacy = await store.replace(created.id, {
      name: created.name,
      floors: [{ ...floor, plan: { ...floor.plan, background } }],
    }, created.revision);
    assert.equal(Object.hasOwn(legacy.floors[0].plan.background, 'placement'), false);

    const withPlacement = await store.replace(created.id, {
      name: legacy.name,
      floors: [{
        ...legacy.floors[0],
        plan: {
          ...legacy.floors[0].plan,
          background: {
            ...background,
            placement: { x: 0, y: 1 / 12, width: 1, height: 5 / 6 },
          },
        },
      }],
    }, legacy.revision);
    assert.deepEqual(withPlacement.floors[0].plan.background.placement, {
      x: 0, y: 1 / 12, width: 1, height: 5 / 6,
    });

    const portrait = await store.replace(created.id, {
      name: withPlacement.name,
      floors: [{
        ...withPlacement.floors[0],
        plan: {
          ...withPlacement.floors[0].plan,
          background: {
            ...withPlacement.floors[0].plan.background,
            width: 600,
            height: 1200,
            placement: { x: 0.35, y: 0, width: 0.3, height: 1 },
          },
        },
      }],
    }, withPlacement.revision);
    assert.deepEqual(portrait.floors[0].plan.background.placement, {
      x: 0.35, y: 0, width: 0.3, height: 1,
    });

    const oldClientUpdate = await store.replace(created.id, {
      name: portrait.name,
      floors: [{
        id: portrait.floors[0].id,
        name: portrait.floors[0].name,
        plan: {
          id: portrait.floors[0].plan.id,
          width: portrait.floors[0].plan.width,
          height: portrait.floors[0].plan.height,
          elements: portrait.floors[0].plan.elements,
        },
        places: portrait.floors[0].places,
        panoramaPoints: portrait.floors[0].panoramaPoints,
        routeNodes: portrait.floors[0].routeNodes,
        routeEdges: portrait.floors[0].routeEdges,
      }],
    }, portrait.revision);
    assert.deepEqual(oldClientUpdate.floors[0].plan.background.placement, portrait.floors[0].plan.background.placement);

    await assert.rejects(store.replace(created.id, {
      name: oldClientUpdate.name,
      floors: [{
        ...oldClientUpdate.floors[0],
        plan: {
          ...oldClientUpdate.floors[0].plan,
          background: {
            ...oldClientUpdate.floors[0].plan.background,
            placement: { x: 0.5, y: 0, width: 1, height: 5 / 6 },
          },
        },
      }],
    }, oldClientUpdate.revision), /выходит за границы плана/);
  });
});