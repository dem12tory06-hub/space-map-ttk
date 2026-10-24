import assert from 'node:assert/strict';
import test from 'node:test';
import { isWalkableAt, planRoute } from '../src/shared/pathfinder.js';
import { plannedRoute } from '../src/visitor/visitor-map.js';

function floorWith(elements) {
  return { plan: { elements }, places: [], routeNodes: [], routeEdges: [] };
}

function element(id, type, x, y, width, height, rotation = 0) {
  return { id, type, name: id, x, y, width, height, rotation };
}

function assertSafe(floor, path) {
  assert.ok(path?.length >= 2, 'path exists');
  for (let index = 1; index < path.length; index++) {
    const a = path[index - 1];
    const b = path[index];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    for (let i = 0; i <= Math.ceil(length / 3); i++) {
      const point = { x: (a.x + (b.x - a.x) * i / (Math.ceil(length / 3) || 1)) / 1000,
        y: (a.y + (b.y - a.y) * i / (Math.ceil(length / 3) || 1)) / 600 };
      assert.equal(isWalkableAt(floor, point), true, `blocked segment ${index} at ${JSON.stringify(point)}`);
    }
  }
}

test('walkable zone stays traversable; stage and wall are avoided', () => {
  const floor = floorWith([
    element('work', 'zone', .2, .2, .7, .6),
    element('stage', 'stage', .4, .3, .2, .4),
    element('wall', 'partition', .72, .1, .03, .6),
    element('stand', 'stand', .82, .3, .07, .1),
  ]);
  const path = planRoute(floor, { x: .1, y: .5 }, { x: .9, y: .5 });
  assertSafe(floor, path);
  assert.ok(path.length > 2);
});

test('unobstructed zone permits a direct route, including arbitrary points', () => {
  const floor = floorWith([element('work', 'zone', .2, .2, .6, .6)]);
  const path = planRoute(floor, { x: .1, y: .5 }, { x: .9, y: .5 });
  assertSafe(floor, path);
  assert.ok(path.every((point) => point.y === 300));
});

test('blocked-off area has no route, stage destination stops on its perimeter', () => {
  const sealed = floorWith([element('wall', 'partition', 0, .46, 1, .08)]);
  assert.equal(planRoute(sealed, { x: .5, y: .2 }, { x: .5, y: .8 }), null);
  const stage = floorWith([element('stage', 'stage', .4, .3, .2, .3, 20)]);
  const path = planRoute(stage, { x: .1, y: .45 }, { x: .5, y: .45 });
  assertSafe(stage, path);
  assert.notDeepEqual(path.at(-1), { x: 500, y: 270 });
});

test('named endpoints follow editable preferred bends safely; arbitrary endpoints fall back to automatic routing', () => {
  const floor = floorWith([element('wall', 'partition', .45, .2, .04, .5)]);
  floor.routeNodes = [
    { id: 'a', name: 'A', x: .1, y: .5, placeId: 'a' },
    { id: 'b', name: 'B', x: .9, y: .5, placeId: 'b' },
  ];
  floor.routeEdges = [{ id: 'ab', fromNodeId: 'a', toNodeId: 'b', points: [{ x: .5, y: .9 }] }];
  const from = { id: 'a', x: .1, y: .5 };
  const to = { id: 'b', x: .9, y: .5 };
  const guided = plannedRoute(floor, from, to);
  assertSafe(floor, guided);
  assert.ok(guided.some((point) => point.y >= 500));
  const arbitrary = plannedRoute(floor, { x: .12, y: .4 }, { x: .88, y: .45 });
  assertSafe(floor, arbitrary);
});

test('rotated wall also diverts a route without cutting through it', () => {
  const floor = floorWith([element('angled-wall', 'partition', .46, .17, .04, .65, 25)]);
  assertSafe(floor, planRoute(floor, { x: .15, y: .5 }, { x: .85, y: .5 }));
});
