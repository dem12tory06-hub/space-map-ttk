import assert from 'node:assert/strict';
import test from 'node:test';
import { initialVenueId } from '../src/constructor/constructor.js';

test('reopens remembered venue while explicit venue and new map override it', () => {
  assert.equal(initialVenueId('', 'previous-map'), 'previous-map');
  assert.equal(initialVenueId('?venue=another-map', 'previous-map'), 'another-map');
  assert.equal(initialVenueId('?new=1', 'previous-map'), '');
});
