import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { isWalkableAt, planRoute } from '../src/shared/pathfinder.js';

test('imported manege entrance reaches every place', async () => {
  const venue = JSON.parse(await readFile(new URL('../fixtures/manege-venue.json', import.meta.url), 'utf8'));
  const floor = venue.floors[0];
  const entrance = floor.places.find((place) => place.id === 'manege-entrance');
  assert.ok(entrance);
  assert.equal(isWalkableAt(floor, entrance), true, 'entrance must be outside the partition');
  for (const place of floor.places.filter((place) => place.id !== entrance.id)) {
    assert.equal(isWalkableAt(floor, place), true, place.name);
    assert.ok(planRoute(floor, entrance, place)?.length > 1, `no route to ${place.name}`);
  }
});
