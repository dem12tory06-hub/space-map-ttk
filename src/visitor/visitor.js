import { PLAN_WIDTH, PLAN_HEIGHT, backgroundRect, planBounds, fitCamera, zoomCamera } from './geometry.js';

const typeNames = { entrance: 'Вход', registration: 'Регистрация', service: 'Сервис' };
const svgNS = 'http://www.w3.org/2000/svg';
function svgNode(tag, attributes, text) {
  const node = document.createElementNS(svgNS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

// Returns a disposer for future integration into a router. The viewer only performs GET requests.
export function mountVisitor(container, { venueId, demo = false }) {
  document.body.classList.add('visitor-page');
  const events = new AbortController();
  let request, resizeObserver, disposed = false;
  const listen = (node, type, fn, options = {}) => node.addEventListener(type, fn, { ...options, signal: events.signal });
  const query = (selector) => container.querySelector(selector);

  function message(title, description, retry = false) {
    container.innerHTML = `<section class="visitor visitor-state"><a href="/">← На главную</a><h1></h1><p role="status"></p></section>`;
    query('h1').textContent = title;
    query('[role="status"]').textContent = description;
    if (retry) {
      const button = document.createElement('button');
      button.textContent = 'Попробовать снова';
      listen(button, 'click', load);
      query('section').append(button);
    }
  }

  async function load() {
    message('Загружаем карту…', 'Получаем сохранённую площадку.');
    request?.abort();
    request = new AbortController();
    const timeout = setTimeout(() => request.abort(), 15000);
    try {
      let venue;
      if (demo) {
        const { demoInput } = await import('./demo.js');
        venue = { id: 'demo', ...structuredClone(demoInput) };
      } else {
        const response = await fetch(`/api/venues/${encodeURIComponent(venueId)}`, { signal: request.signal, cache: 'no-store' });
        if (response.status === 404) {
          message('Площадка не найдена', 'Проверьте ссылку или попросите организатора прислать актуальный адрес.');
          return;
        }
        if (!response.ok) throw new Error(`server:${response.status}`);
        venue = await response.json();
      }
      if (!venue?.floors?.length || !venue.floors.every((floor) => floor.plan && Array.isArray(floor.plan.elements) && Array.isArray(floor.places))) {
        throw new Error('format');
      }
      if (!disposed) render(venue);
    } catch (error) {
      if (disposed) return;
      const formatError = error.message === 'format' || error instanceof SyntaxError;
      message(formatError ? 'Не удалось прочитать карту' : 'Не удалось загрузить карту',
        formatError ? 'Формат ответа не поддерживается. Сообщите организатору.'
          : error.message.startsWith('server:') ? 'Сервер временно недоступен. Попробуйте ещё раз.'
            : 'Проверьте подключение к сети и попробуйте снова.', true);
    } finally { clearTimeout(timeout); }
  }

  function render(venue) {
    container.innerHTML = `
      <section class="visitor" aria-label="Карта для посетителя">
        <header class="visitor-header"><div><a href="/">← На главную</a><h1 data-venue-title></h1><p data-source></p></div>
          <label>Этаж<select data-floor></select></label></header>
        <div class="visitor-layout">
          <section class="visitor-map-panel" aria-label="План площадки">
            <div class="visitor-toolbar"><button type="button" data-zoom-out aria-label="Отдалить карту">−</button>
              <output data-zoom aria-label="Масштаб относительно всего плана"></output>
              <button type="button" data-zoom-in aria-label="Приблизить карту">+</button>
              <button type="button" data-fit>Показать весь план</button></div>
            <p class="visitor-map-status" data-background-status role="status"></p>
            <div class="visitor-viewport" tabindex="0" aria-label="Карта. Стрелки — перемещение, плюс и минус — масштаб, Home — весь план" aria-describedby="visitor-map-help">
              <svg class="visitor-canvas" aria-label="Объекты плана" role="img"><g data-world></g></svg>
              <div class="visitor-markers" data-markers></div>
            </div>
            <p class="visitor-help" id="visitor-map-help">Перетаскивайте карту. Масштаб: + / −, колесо мыши или два пальца. Нажмите номер места.</p>
          </section>
          <aside class="visitor-sidebar" aria-label="Места на этаже">
            <section class="visitor-card" data-card hidden aria-labelledby="visitor-place-title" tabindex="-1">
              <div class="visitor-card-heading"><h2 id="visitor-place-title"></h2><button type="button" data-close aria-label="Закрыть карточку">×</button></div>
              <p data-category></p><p data-description></p>
            </section>
            <label class="visitor-search">Найти место<input type="search" data-search placeholder="Название места" autocomplete="off"></label>
            <p data-count role="status"></p><ul class="visitor-list" data-list></ul>
          </aside>
        </div>
      </section>`;
    query('[data-venue-title]').textContent = venue.name;
    query('[data-source]').textContent = demo ? 'Демонстрационный пример · не загружен из API' : 'Сохранённая карта · только просмотр';
    const floorSelect = query('[data-floor]');
    for (const floor of venue.floors) {
      const option = document.createElement('option');
      option.value = floor.id; option.textContent = floor.name; floorSelect.append(option);
    }
    const viewport = query('.visitor-viewport'), world = query('[data-world]'), markers = query('[data-markers]');
    let floor = venue.floors[0], selectedId = null, camera, fitted = true, size, bounds;
    const pointers = new Map();
    let gesture = null, selectionOrigin = null;
    const markerButtons = new Map();

    function updateCamera() {
      world.setAttribute('transform', `translate(${camera.x} ${camera.y}) scale(${camera.scale})`);
      for (const place of floor.places) {
        const marker = markerButtons.get(place.id);
        marker.style.left = `${camera.x + place.x * PLAN_WIDTH * camera.scale}px`;
        marker.style.top = `${camera.y + place.y * PLAN_HEIGHT * camera.scale}px`;
      }
      const ratio = camera.scale / fitCamera(size.width, size.height, bounds).scale;
      query('[data-zoom]').textContent = `${Math.round(ratio * 100)}%`;
      query('[data-zoom-out]').disabled = ratio <= 0.501;
      query('[data-zoom-in]').disabled = ratio >= 7.999;
    }
    function fit() {
      camera = fitCamera(size.width, size.height, bounds); fitted = true; updateCamera();
    }
    function zoom(factor, anchor = { x: size.width / 2, y: size.height / 2 }) {
      const base = fitCamera(size.width, size.height, bounds).scale;
      camera = zoomCamera(camera, Math.min(base * 8, Math.max(base * 0.5, camera.scale * factor)), anchor);
      fitted = false; updateCamera();
    }
    function markSelection() {
      for (const [id, button] of markerButtons) button.setAttribute('aria-pressed', String(id === selectedId));
      for (const button of query('[data-list]').querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.placeId === selectedId));
    }
    function select(place, origin) {
      selectedId = place.id; selectionOrigin = origin;
      query('[data-card]').hidden = false;
      query('#visitor-place-title').textContent = place.name;
      query('[data-category]').textContent = place.category || typeNames[place.type] || '';
      query('[data-description]').textContent = place.description || 'Описание пока не добавлено.';
      // Selecting from the list also brings an off-screen marker back into view.
      camera.x = size.width / 2 - place.x * PLAN_WIDTH * camera.scale;
      camera.y = size.height / 2 - place.y * PLAN_HEIGHT * camera.scale;
      fitted = false; updateCamera(); markSelection();
      query('[data-card]').focus({ preventScroll: true });
      query('[data-card]').scrollIntoView({ block: 'nearest', behavior: 'auto' });
    }
    function renderList() {
      const search = query('[data-search]').value.trim().toLocaleLowerCase('ru');
      const matches = floor.places.filter((place) => place.name.toLocaleLowerCase('ru').includes(search));
      query('[data-count]').textContent = !floor.places.length ? 'На этом этаже пока нет мест.'
        : !matches.length ? 'Места не найдены. Попробуйте другое название.' : `Мест: ${matches.length} из ${floor.places.length}`;
      const list = query('[data-list]'); list.replaceChildren();
      for (const place of matches) {
        const li = document.createElement('li'), button = document.createElement('button');
        button.type = 'button'; button.dataset.placeId = place.id;
        const number = document.createElement('span'); number.className = 'visitor-number';
        number.textContent = floor.places.indexOf(place) + 1;
        const name = document.createElement('span'); name.textContent = place.name;
        button.append(number, name);
        button.addEventListener('click', () => select(place, button)); li.append(button); list.append(li);
      }
      markSelection();
    }
    function renderFloor() {
      pointers.clear(); gesture = null; dragged = false;
      selectedId = null; query('[data-card]').hidden = true; query('[data-search]').value = '';
      world.replaceChildren(); markers.replaceChildren(); markerButtons.clear();
      bounds = planBounds(floor.plan.elements);
      world.append(svgNode('rect', { x: 0, y: 0, width: PLAN_WIDTH, height: PLAN_HEIGHT, class: 'visitor-plan' }));
      const background = floor.plan.background;
      const status = query('[data-background-status]');
      status.textContent = !background ? 'Подложка не добавлена. Объекты и места показаны на плане.'
        : !background.visible ? 'Подложка скрыта организатором.' : '';
      status.hidden = !status.textContent;
      if (background?.visible) {
        const image = svgNode('image', { ...backgroundRect(background), opacity: background.opacity, preserveAspectRatio: 'none',
          href: `/api/venues/${encodeURIComponent(venue.id)}/floors/${encodeURIComponent(floor.id)}/background/${encodeURIComponent(background.id)}` });
        const imageFloor = floor.id;
        image.addEventListener('error', () => {
          if (floor.id !== imageFloor) return;
          status.hidden = false; status.textContent = 'Не удалось загрузить подложку. Объекты и места доступны. Обновите страницу, чтобы повторить.';
        });
        world.append(image);
      }
      const ordered = [...floor.plan.elements.filter((item) => item.type === 'zone'), ...floor.plan.elements.filter((item) => item.type !== 'zone')];
      for (const item of ordered) {
        const x = item.x * PLAN_WIDTH, y = item.y * PLAN_HEIGHT, width = item.width * PLAN_WIDTH, height = item.height * PLAN_HEIGHT;
        const group = svgNode('g', { class: `visitor-element visitor-element--${item.type}`, 'data-element-id': item.id,
          transform: `rotate(${item.rotation ?? 0} ${x + width / 2} ${y + height / 2})` });
        group.append(svgNode('title', {}, item.name), svgNode('rect', { x, y, width, height, rx: item.type === 'partition' ? 0 : 4 }));
        if (item.type !== 'partition') group.append(svgNode('text', { x: x + width / 2, y: y + height / 2, 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, item.name.length > 22 ? `${item.name.slice(0, 21)}…` : item.name));
        world.append(group);
      }
      floor.places.forEach((place, index) => {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'visitor-marker';
        button.dataset.placeId = place.id; button.textContent = index + 1;
        button.setAttribute('aria-label', `${index + 1}. ${place.name}`); button.title = place.name;
        button.addEventListener('click', () => select(place, button));
        markers.append(button); markerButtons.set(place.id, button);
      });
      size = { width: viewport.clientWidth, height: viewport.clientHeight };
      fit(); renderList();
    }
    listen(floorSelect, 'change', () => { floor = venue.floors.find((entry) => entry.id === floorSelect.value); renderFloor(); });
    listen(query('[data-search]'), 'input', renderList);
    listen(query('[data-close]'), 'click', () => {
      selectedId = null; query('[data-card]').hidden = true; markSelection();
      (selectionOrigin?.isConnected ? selectionOrigin : viewport).focus({ preventScroll: true });
    });
    listen(query('[data-fit]'), 'click', fit);
    listen(query('[data-zoom-in]'), 'click', () => zoom(1.3));
    listen(query('[data-zoom-out]'), 'click', () => zoom(1 / 1.3));
    const point = (event) => {
      const rect = viewport.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    function pointerSnapshot() {
      const [a, b] = [...pointers.values()];
      return b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.hypot(a.x - b.x, a.y - b.y) }
        : a ? { ...a, distance: 0 } : null;
    }
    let dragged = false, startPoint;
    listen(viewport, 'pointerdown', (event) => {
      if (event.button !== 0) return;
      const p = point(event); pointers.set(event.pointerId, p);
      if (pointers.size === 1) { dragged = false; startPoint = p; }
      else dragged = true;
      gesture = pointerSnapshot();
      // Keep a marker as the capture target so taps still generate its click.
      event.target.setPointerCapture(event.pointerId);
    });
    listen(viewport, 'pointermove', (event) => {
      if (!pointers.has(event.pointerId)) return;
      const p = point(event); pointers.set(event.pointerId, p);
      if (!dragged && Math.hypot(p.x - startPoint.x, p.y - startPoint.y) < 5) return;
      dragged = true;
      const next = pointerSnapshot();
      if (gesture?.distance && next.distance) zoom(next.distance / gesture.distance, gesture);
      camera.x += next.x - gesture.x; camera.y += next.y - gesture.y;
      gesture = next; fitted = false; updateCamera();
    });
    const release = (event) => { pointers.delete(event.pointerId); gesture = pointerSnapshot(); };
    listen(viewport, 'pointerup', release); listen(viewport, 'pointercancel', release); listen(viewport, 'lostpointercapture', release);
    listen(viewport, 'click', (event) => { if (dragged && event.detail !== 0) { event.preventDefault(); event.stopPropagation(); dragged = false; } }, { capture: true });
    listen(viewport, 'wheel', (event) => { event.preventDefault(); zoom(Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * 0.002), point(event)); }, { passive: false });
    listen(viewport, 'keydown', (event) => {
      if (event.target !== viewport) return;
      if (event.key === '+' || event.key === '=') zoom(1.3);
      else if (event.key === '-') zoom(1 / 1.3);
      else if (event.key === 'Home') fit();
      else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        camera.x += event.key === 'ArrowLeft' ? 50 : event.key === 'ArrowRight' ? -50 : 0;
        camera.y += event.key === 'ArrowUp' ? 50 : event.key === 'ArrowDown' ? -50 : 0;
        fitted = false; updateCamera();
      } else return;
      event.preventDefault();
    });
    renderFloor();
    resizeObserver = new ResizeObserver(() => {
      const previous = size; size = { width: viewport.clientWidth, height: viewport.clientHeight };
      if (fitted) fit();
      else {
        const factor = Math.min(size.width / previous.width, size.height / previous.height);
        camera = { scale: camera.scale * factor, x: size.width / 2 + (camera.x - previous.width / 2) * factor,
          y: size.height / 2 + (camera.y - previous.height / 2) * factor };
        updateCamera();
      }
    });
    resizeObserver.observe(viewport);
  }
  load();
  return () => { disposed = true; request?.abort(); events.abort(); resizeObserver?.disconnect(); document.body.classList.remove('visitor-page'); };
}
