const WIDTH = 1000;
const HEIGHT = 600;
const STEP = 10;
const COLS = WIDTH / STEP + 1;
const ROWS = HEIGHT / STEP + 1;
const CLEARANCE = 8;

function obstacles(floor) {
  return (floor.plan?.elements ?? []).filter((item) => ['partition', 'stage', 'stand'].includes(item.type));
}

function pointInside(element, x, y, margin = CLEARANCE) {
  const width = element.width * WIDTH;
  const height = element.height * HEIGHT;
  const cx = element.x * WIDTH + width / 2;
  const cy = element.y * HEIGHT + height / 2;
  const angle = (element.rotation ?? 0) * Math.PI / 180;
  const dx = x - cx;
  const dy = y - cy;
  const localX = dx * Math.cos(angle) + dy * Math.sin(angle);
  const localY = -dx * Math.sin(angle) + dy * Math.cos(angle);
  return Math.abs(localX) <= width / 2 + margin && Math.abs(localY) <= height / 2 + margin;
}

function blockedBy(shapes, x, y) {
  return shapes.find((shape) => pointInside(shape, x, y)) ?? null;
}

export function isWalkableAt(floor, point) {
  const x = point.x * WIDTH;
  const y = point.y * HEIGHT;
  return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= WIDTH && y >= 0 && y <= HEIGHT
    && !blockedBy(obstacles(floor), x, y);
}

function heapPush(heap, item) {
  let i = heap.length;
  heap.push(item);
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (heap[parent].priority <= item.priority) break;
    heap[i] = heap[parent];
    i = parent;
  }
  heap[i] = item;
}

function heapPop(heap) {
  const result = heap[0];
  const last = heap.pop();
  if (heap.length) {
    let i = 0;
    while (i * 2 + 1 < heap.length) {
      let child = i * 2 + 1;
      if (child + 1 < heap.length && heap[child + 1].priority < heap[child].priority) child++;
      if (heap[child].priority >= last.priority) break;
      heap[i] = heap[child];
      i = child;
    }
    heap[i] = last;
  }
  return result;
}

function lineClear(shapes, a, b) {
  const distance = Math.hypot(b.x - a.x, b.y - a.y);
  const samples = Math.ceil(distance / 4);
  for (let i = 0; i <= samples; i++) {
    const x = a.x + (b.x - a.x) * i / (samples || 1);
    const y = a.y + (b.y - a.y) * i / (samples || 1);
    if (blockedBy(shapes, x, y)) return false;
  }
  return true;
}

function solveSegment(floor, start, finish) {
  const shapes = obstacles(floor);
  const from = { x: start.x * WIDTH, y: start.y * HEIGHT };
  const to = { x: finish.x * WIDTH, y: finish.y * HEIGHT };
  if (![from.x, from.y, to.x, to.y].every(Number.isFinite)
    || [from.x, to.x].some((value) => value < 0 || value > WIDTH)
    || [from.y, to.y].some((value) => value < 0 || value > HEIGHT)) return null;
  // Named stands and stages can be destinations; their centers are inside
  // obstacles, so the route ends at the nearest accessible perimeter cell.
  if ([from, to].some((point) => blockedBy(shapes, point.x, point.y)?.type === 'partition')) return null;

  const size = COLS * ROWS;
  const free = new Uint8Array(size);
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
    free[row * COLS + col] = blockedBy(shapes, col * STEP, row * STEP) ? 0 : 1;
  }
  function nearest(point, other) {
    let best = -1;
    let score = Infinity;
    const accessible = !blockedBy(shapes, point.x, point.y);
    for (let index = 0; index < size; index++) {
      if (!free[index]) continue;
      const x = index % COLS * STEP;
      const y = Math.floor(index / COLS) * STEP;
      const distance = Math.hypot(point.x - x, point.y - y);
      if (accessible && (distance > STEP * 2 || !lineClear(shapes, point, { x, y }))) continue;
      const candidate = distance + 0.001 * Math.hypot(other.x - x, other.y - y);
      if (candidate < score) { score = candidate; best = index; }
    }
    return best;
  }
  const source = nearest(from, to);
  const target = nearest(to, from);
  if (source < 0 || target < 0) return null;
  const cost = new Float64Array(size).fill(Infinity);
  const previous = new Int32Array(size).fill(-1);
  cost[source] = 0;
  const open = [];
  const tx = target % COLS;
  const ty = Math.floor(target / COLS);
  heapPush(open, { index: source, priority: 0 });
  while (open.length) {
    const current = heapPop(open);
    const index = current.index;
    const col = index % COLS;
    const row = Math.floor(index / COLS);
    if (current.priority > cost[index] + Math.hypot(tx - col, ty - row) + 1e-8) continue;
    if (index === target) break;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = col + dx;
      const ny = row + dy;
      if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
      const next = ny * COLS + nx;
      if (!free[next]) continue;
      if (dx && dy && (!free[row * COLS + nx] || !free[ny * COLS + col])) continue;
      const nextCost = cost[index] + Math.hypot(dx, dy);
      if (nextCost >= cost[next]) continue;
      cost[next] = nextCost;
      previous[next] = index;
      heapPush(open, { index: next, priority: nextCost + Math.hypot(tx - nx, ty - ny) });
    }
  }
  if (!Number.isFinite(cost[target])) return null;
  const cells = [];
  for (let index = target; index !== -1; index = previous[index]) {
    cells.push({ x: index % COLS * STEP, y: Math.floor(index / COLS) * STEP });
  }
  cells.reverse();
  const smooth = [cells[0]];
  for (let i = 0; i < cells.length - 1;) {
    let next = cells.length - 1;
    while (next > i + 1 && !lineClear(shapes, cells[i], cells[next])) next--;
    smooth.push(cells[next]);
    i = next;
  }
  if (!blockedBy(shapes, from.x, from.y) && lineClear(shapes, from, smooth[0])) smooth.unshift(from);
  if (!blockedBy(shapes, to.x, to.y) && lineClear(shapes, smooth.at(-1), to)) smooth.push(to);
  return smooth.filter((point, index) => index === 0
    || point.x !== smooth[index - 1].x || point.y !== smooth[index - 1].y);
}

export function planRoute(floor, start, finish, via = []) {
  const points = [start, ...via, finish];
  const result = [];
  for (let index = 1; index < points.length; index++) {
    const leg = solveSegment(floor, points[index - 1], points[index]);
    if (!leg) return null;
    result.push(...(index === 1 ? leg : leg.slice(1)));
  }
  return result;
}
