import { navigationDisplayName, navigationTargets } from '../shared/navigation-targets.js';
import { isWalkableAt, planRoute } from '../shared/pathfinder.js';

const NS = 'http://www.w3.org/2000/svg';
const WIDTH = 1000;
const HEIGHT = 600;

function svg(name, attributes = {}) {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}

function xy(point) {
  return { x: point.x * WIDTH, y: point.y * HEIGHT };
}

function backgroundPlacement(background) {
  if (background.placement) return background.placement;
  const ratio = background.width / background.height;
  const planRatio = WIDTH / HEIGHT;
  const width = ratio >= planRatio ? 1 : ratio / planRatio;
  const height = ratio >= planRatio ? planRatio / ratio : 1;
  return { x: (1 - width) / 2, y: (1 - height) / 2, width, height };
}

export function routeBetween(floor, fromPlaceId, toPlaceId) {
  const nodes = floor.routeNodes ?? [];
  const edges = floor.routeEdges ?? [];
  const start = nodes.find((node) => node.placeId === fromPlaceId);
  const finish = nodes.find((node) => node.placeId === toPlaceId);
  if (!start || !finish) return null;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const adjacency = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    const a = nodeById.get(edge.fromNodeId);
    const b = nodeById.get(edge.toNodeId);
    if (!a || !b) continue;
    const points = [a, ...(edge.points ?? []), b].map(xy);
    let weight = 0;
    for (let i = 1; i < points.length; i++) {
      weight += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    }
    adjacency.get(a.id).push({ to: b.id, edge, weight, reverse: false });
    adjacency.get(b.id).push({ to: a.id, edge, weight, reverse: true });
  }
  const distance = new Map([[start.id, 0]]);
  const previous = new Map();
  const visited = new Set();
  while (true) {
    let current = null;
    for (const id of distance.keys()) {
      if (!visited.has(id) && (current === null || distance.get(id) < distance.get(current))) current = id;
    }
    if (current === null || current === finish.id) break;
    visited.add(current);
    for (const next of adjacency.get(current) ?? []) {
      const proposed = distance.get(current) + next.weight;
      if (proposed < (distance.get(next.to) ?? Infinity)) {
        distance.set(next.to, proposed);
        previous.set(next.to, { from: current, ...next });
      }
    }
  }
  if (!distance.has(finish.id)) return null;
  const steps = [];
  for (let id = finish.id; id !== start.id;) {
    const step = previous.get(id);
    if (!step) return null;
    steps.unshift(step);
    id = step.from;
  }
  const coordinates = [xy(start)];
  for (const step of steps) {
    const middle = (step.edge.points ?? []).map(xy);
    coordinates.push(...(step.reverse ? middle.reverse() : middle), xy(nodeById.get(step.to)));
  }
  return coordinates;
}

export function plannedRoute(floor, from, to) {
  if (!from || !to) return null;
  const preferred = from.id && to.id ? routeBetween(floor, from.id, to.id) : null;
  if (preferred && preferred.length <= 120) {
    const via = preferred.slice(1, -1).map((point) => ({ x: point.x / WIDTH, y: point.y / HEIGHT }));
    const guided = planRoute(floor, from, to, via);
    if (guided) return guided;
  }
  return planRoute(floor, from, to);
}

export function mountVisitorMap(container, venueId) {
  const controller = new AbortController();
  container.innerHTML = `
    <div class="visitor-map" role="status">Загружаю план площадки…</div>`;

  fetch(`/api/venues/${encodeURIComponent(venueId)}`, { signal: controller.signal })
    .then(async (response) => {
      if (!response.ok) throw new Error(response.status === 404 ? 'Площадка не найдена.' : 'Не удалось загрузить карту.');
      return response.json();
    })
    .then((venue) => {
      if (controller.signal.aborted) return;
      const floor = venue.floors?.[0];
      if (!floor) throw new Error('У площадки пока нет плана.');
      const shell = container.closest('.visitor-shell');
      for (const label of shell?.querySelectorAll('.visitor-shell__heading h1, .visitor-shell__venue, .visitor-shell__screen-venue') ?? []) {
        label.textContent = venue.name;
      }
      renderVenue(container, venue, floor);
    })
    .catch((error) => {
      if (!controller.signal.aborted) {
        container.replaceChildren();
        const status = document.createElement('p');
        status.className = 'visitor-map__error';
        status.textContent = error.message;
        container.append(status);
      }
    });

  return () => controller.abort();
}

function renderVenue(container, venue, floor) {
  container.innerHTML = `
    <div class="visitor-map">
      <div class="visitor-map__toolbar">
        <label>Откуда <select data-start></select></label>
        <label>Куда <select data-finish></select></label>
        <button type="button" data-route>Показать путь</button>
        <button type="button" data-pick-start>Старт на плане</button>
        <button type="button" data-pick-finish>Финиш на плане</button>
      </div>
      <p class="visitor-map__status" data-status role="status">Нажмите на место на плане.</p>
      <div class="visitor-map__canvas">
        <svg viewBox="0 0 1000 600" role="img" aria-label="План площадки с местами и панорамами" data-svg></svg>
      </div>
      <section class="visitor-map__card" data-card hidden>
        <h2 data-card-title></h2><p data-card-description></p>
        <button type="button" data-open-panorama hidden>Осмотреть панораму</button>
      </section>
    </div>`;
  const image = container.querySelector('[data-svg]');
  const status = container.querySelector('[data-status]');
  const card = container.querySelector('[data-card]');
  const start = container.querySelector('[data-start]');
  const finish = container.querySelector('[data-finish]');
  const targets = navigationTargets(floor);
  let selectedPanoramaId = null;
  let path = null;
  let customStart = null;
  let customFinish = null;
  let picking = null;

  for (const select of [start, finish]) {
    select.append(new Option('Выберите место', ''));
    for (const target of targets) select.append(new Option(navigationDisplayName(target), target.id));
    select.append(new Option('Точка на плане', '__custom'));
  }
  const entrance = floor.places.find((place) => place.type === 'entrance');
  if (entrance) start.value = entrance.id;

  function draw() {
    image.replaceChildren(svg('rect', { width: WIDTH, height: HEIGHT, fill: '#eef3eb' }));
    const background = floor.plan.background;
    if (background?.visible) {
      const placement = backgroundPlacement(background);
      image.append(svg('image', {
        href: `/api/venues/${encodeURIComponent(venue.id)}/floors/${encodeURIComponent(floor.id)}/background/${encodeURIComponent(background.id)}`,
        x: placement.x * WIDTH, y: placement.y * HEIGHT,
        width: placement.width * WIDTH, height: placement.height * HEIGHT,
        opacity: background.opacity,
        preserveAspectRatio: 'none',
      }));
    }
    for (const element of floor.plan.elements ?? []) {
      const x = element.x * WIDTH;
      const y = element.y * HEIGHT;
      const width = element.width * WIDTH;
      const height = element.height * HEIGHT;
      const rectangle = svg('rect', {
        x, y, width, height, rx: element.type === 'zone' ? 12 : 3,
        transform: `rotate(${element.rotation ?? 0} ${x + width / 2} ${y + height / 2})`,
        fill: element.type === 'partition' ? '#52615c' : element.type === 'zone' ? '#cfe3c5' : '#e9d4ab',
        'fill-opacity': element.type === 'zone' ? 0.45 : 0.9,
        stroke: '#52615c', 'stroke-width': 2,
        ...(['stand', 'stage'].includes(element.type) ? {
          'data-target-id': element.id, tabindex: 0, role: 'button', 'aria-label': navigationDisplayName(element),
        } : {}),
      });
      image.append(rectangle);
      if (['zone', 'stand', 'stage'].includes(element.type)) {
        const label = svg('text', {
          x: x + width / 2, y: y + height / 2, 'text-anchor': 'middle',
          class: 'visitor-map__label', 'pointer-events': 'none',
        });
        label.textContent = element.name;
        image.append(label);
      }
    }
    if (path) image.append(svg('polyline', {
      points: path.map((point) => `${point.x},${point.y}`).join(' '),
      fill: 'none', stroke: '#e3343e', 'stroke-width': 9, 'stroke-linecap': 'round',
      'stroke-linejoin': 'round', 'pointer-events': 'none',
    }));
    for (const [point, label, color] of [[customStart, 'Начало маршрута', '#147c47'], [customFinish, 'Конец маршрута', '#333fd1']]) {
      if (!point) continue;
      const pixel = xy(point);
      image.append(svg('circle', {
        cx: pixel.x, cy: pixel.y, r: 13, fill: color, stroke: '#fff', 'stroke-width': 4,
        'aria-label': label, 'pointer-events': 'none',
      }));
    }
    for (const place of floor.places) {
      const point = xy(place);
      const marker = svg('g', { 'data-place-id': place.id, tabindex: 0, role: 'button', 'aria-label': place.name });
      marker.append(svg('circle', {
        cx: point.x, cy: point.y, r: 15,
        fill: place.type === 'zone' ? '#7553ae' : place.type === 'wifi' ? '#257c9b' : '#e3343e',
        stroke: '#fff', 'stroke-width': 4,
      }));
      const label = svg('text', { x: point.x + 21, y: point.y - 16, class: 'visitor-map__label' });
      label.textContent = place.name;
      marker.append(label);
      image.append(marker);
    }
    for (const panorama of floor.panoramaPoints ?? []) {
      const point = xy(panorama);
      const marker = svg('g', {
        'data-panorama-id': panorama.id, tabindex: 0, role: 'button',
        'aria-label': `Панорама: ${panorama.name}`,
      });
      marker.append(svg('circle', { cx: point.x, cy: point.y, r: 17, fill: '#247b85', stroke: '#fff', 'stroke-width': 4 }));
      const icon = svg('text', { x: point.x, y: point.y + 7, 'text-anchor': 'middle', fill: '#fff', 'font-size': 20 });
      icon.textContent = '◉';
      marker.append(icon);
      image.append(marker);
    }
  }

  function showTarget(target) {
    selectedPanoramaId = null;
    card.hidden = false;
    card.querySelector('[data-card-title]').textContent = target.name;
    card.querySelector('[data-card-description]').textContent = target.description;
    const nearest = (floor.panoramaPoints ?? []).find((pano) => pano.placeId === target.id);
    const open = card.querySelector('[data-open-panorama]');
    open.hidden = !nearest?.imageUrl;
    if (nearest) selectedPanoramaId = nearest.id;
    finish.value = target.id;
    customFinish = null;
    path = null;
    draw();
  }

  function showPanorama(panorama) {
    selectedPanoramaId = panorama.id;
    card.hidden = false;
    card.querySelector('[data-card-title]').textContent = panorama.name;
    card.querySelector('[data-card-description]').textContent = panorama.imageUrl
      ? 'Выберите обзор, чтобы осмотреть эту точку.'
      : 'К этой точке ещё не прикреплено изображение панорамы.';
    card.querySelector('[data-open-panorama]').hidden = !panorama.imageUrl;
  }

  function selectMarker(target) {
    const place = target.closest('[data-place-id]');
    const object = target.closest('[data-target-id]');
    const panorama = target.closest('[data-panorama-id]');
    if (place) showTarget(targets.find((item) => item.id === place.dataset.placeId));
    else if (object) showTarget(targets.find((item) => item.id === object.dataset.targetId));
    else if (panorama) showPanorama(floor.panoramaPoints.find((item) => item.id === panorama.dataset.panoramaId));
  }
  image.addEventListener('click', (event) => {
    if (!picking) return selectMarker(event.target);
    const targetId = event.target.closest('[data-place-id]')?.dataset.placeId
      ?? event.target.closest('[data-target-id]')?.dataset.targetId;
    const select = picking === 'start' ? start : finish;
    if (targetId) {
      select.value = targetId;
      if (picking === 'start') customStart = null;
      else customFinish = null;
    } else {
      const p = image.createSVGPoint();
      p.x = event.clientX;
      p.y = event.clientY;
      const local = p.matrixTransform(image.getScreenCTM().inverse());
      const point = { x: local.x / WIDTH, y: local.y / HEIGHT };
      if (!isWalkableAt(floor, point)) {
        status.textContent = 'Выберите доступную точку вне стен, сцены и стенда.';
        return;
      }
      if (picking === 'start') customStart = point;
      else customFinish = point;
      select.value = '__custom';
    }
    status.textContent = picking === 'start' ? 'Начало отмечено. Выберите конец маршрута.' : 'Конец отмечен. Нажмите «Показать путь».';
    picking = null;
    image.classList.remove('is-picking');
    path = null;
    draw();
  });
  image.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectMarker(event.target);
    }
  });
  for (const [button, type] of [['[data-pick-start]', 'start'], ['[data-pick-finish]', 'finish']]) {
    container.querySelector(button).addEventListener('click', () => {
      picking = type;
      image.classList.add('is-picking');
      status.textContent = type === 'start' ? 'Нажмите на доступную точку начала на плане.' : 'Нажмите на доступную точку назначения на плане.';
    });
  }
  start.addEventListener('change', () => { customStart = null; path = null; draw(); });
  finish.addEventListener('change', () => { customFinish = null; path = null; draw(); });
  container.querySelector('[data-route]').addEventListener('click', () => {
    picking = null;
    image.classList.remove('is-picking');
    const from = start.value === '__custom' ? customStart : targets.find((target) => target.id === start.value);
    const to = finish.value === '__custom' ? customFinish : targets.find((target) => target.id === finish.value);
    if (!from || !to) {
      status.textContent = 'Выберите начальную и конечную точки.';
      return;
    }
    path = plannedRoute(floor, from, to);
    status.textContent = path
      ? 'Маршрут показан красной линией на плане. Стены и сцена обходятся.'
      : 'Проход между точками не найден. Проверьте стены и сцену на плане.';
    draw();
  });
  card.querySelector('[data-open-panorama]').addEventListener('click', async () => {
    const panorama = floor.panoramaPoints.find((item) => item.id === selectedPanoramaId);
    if (!panorama?.imageUrl) return;
    const { openPanorama } = await import('../panorama/panorama-viewer.js');
    openPanorama(container, floor.panoramaPoints, panorama.id, floor.places);
  });
  draw();
}
