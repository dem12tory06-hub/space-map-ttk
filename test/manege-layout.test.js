import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createVenueStore } from '../server/venue-store.js';
import { manegeLayout } from '../src/shared/manege-template.js';
import { isWalkableAt, planRoute } from '../src/shared/pathfinder.js';

test('reference layout saves WC, zones and panorama locations and remains navigable after reopen', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'manege-layout-'));
  try {
    const path = join(directory, 'venues.json');
    const store = createVenueStore(path);
    await store.initialize();
    const created = await store.create('Манеж ДГТУ');
    const floor = manegeLayout(created.floors[0]);
    const saved = await store.replace(created.id, { name: created.name, floors: [floor] }, created.revision);
    const reopened = createVenueStore(path);
    await reopened.initialize();
    const reread = await reopened.get(created.id);
    assert.deepEqual(reread, saved);
    const plan = reread.floors[0];
    assert.equal(plan.places.find((place) => place.type === 'wc')?.name, 'WC');
    assert.equal(plan.plan.elements.find((element) => element.id === 'manege-participants')?.color, '#667de2');
    assert.equal(plan.panoramaPoints.length, 2);
    for (const place of plan.places) assert.equal(isWalkableAt(plan, place), true, place.name);
    const entrance = plan.places.find((place) => place.type === 'entrance');
    for (const destination of plan.places.filter((place) => place.id !== entrance.id)) {
      assert.ok(planRoute(plan, entrance, destination)?.length > 1, destination.name);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
