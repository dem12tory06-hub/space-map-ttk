import assert from 'node:assert/strict';
import test from 'node:test';
import { backgroundRect, fitCamera, planBounds, zoomCamera } from '../src/visitor/geometry.js';
import { createAppServer } from '../server/app.js';

test('saved background placement takes precedence; legacy images match the constructor', () => {
  assert.deepEqual(backgroundRect({ width: 1000, height: 600, placement: { x: .2, y: .3, width: .5, height: .5 } }),
    { x: 200, y: 180, width: 500, height: 300 });
  assert.deepEqual(backgroundRect({ width: 600, height: 1200 }), { x: 350, y: 0, width: 300, height: 600 });
  assert.deepEqual(backgroundRect({ width: 2000, height: 600 }), { x: 0, y: 150, width: 1000, height: 300 });
});

test('zoom keeps a map point under the cursor, fit includes rotated objects on mobile and desktop', () => {
  const camera = { x: 20, y: 30, scale: .5 }, anchor = { x: 120, y: 90 };
  const zoomed = zoomCamera(camera, 2, anchor);
  assert.equal((anchor.x - camera.x) / camera.scale, (anchor.x - zoomed.x) / zoomed.scale);
  assert.equal((anchor.y - camera.y) / camera.scale, (anchor.y - zoomed.y) / zoomed.scale);
  const bounds = planBounds([{ x: 0, y: 0, width: .9, height: .1, rotation: 90 }]);
  assert.ok(bounds.y < 0);
  for (const [width, height] of [[320, 390], [1000, 600]]) {
    const fit = fitCamera(width, height, bounds);
    assert.ok(fit.x + bounds.x * fit.scale >= 27.99);
    assert.ok(fit.y + bounds.y * fit.scale >= 27.99);
    assert.ok(fit.x + (bounds.x + bounds.width) * fit.scale <= width - 27.99);
    assert.ok(fit.y + (bounds.y + bounds.height) * fit.scale <= height - 27.99);
  }
});

test('visitor deep links and modules are public, private server source stays private', async () => {
  const server = createAppServer({ store: { get: async () => null } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const path of ['/map/a-saved-id', '/map/demo', '/src/visitor/visitor.js', '/src/visitor/geometry.js', '/src/visitor/demo.js', '/src/visitor/visitor.css']) {
      const response = await fetch(base + path);
      assert.equal(response.status, 200, path);
    }
    assert.equal((await fetch(base + '/api/venues/missing')).status, 404);
    assert.equal((await fetch(base + '/server/venue-store.js')).status, 404);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
