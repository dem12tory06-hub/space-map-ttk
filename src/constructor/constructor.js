import { navigationDisplayName, navigationTargets } from '../shared/navigation-targets.js';
import { plannedRoute } from '../visitor/visitor-map.js';

const PLAN_WIDTH = 1000;
const PLAN_HEIGHT = 600;
const HISTORY_LIMIT = 100;

// The API accepts only editable fields, not the metadata returned by GET.
export function venueSavePayload(value) {
  return { name: value.name, floors: value.floors };
}

export function recoverSaveRequest(body, revision, status, error) {
  if (status !== 400) return null;
  if (error?.error === 'invalid_data'
    && /^Неизвестное поле venue\.(id|revision|createdAt|updatedAt)\.$/.test(error.message ?? '')
    && typeof body?.name === 'string' && Array.isArray(body.floors)
    && Object.keys(body).every((key) => ['name', 'floors', 'id', 'revision', 'createdAt', 'updatedAt'].includes(key))) {
    return { body: venueSavePayload(body), revision };
  }
  if (error?.error === 'invalid_revision' && /^[1-9][0-9]*$/.test(revision ?? '')
    && Number.isSafeInteger(Number(revision))) {
    return { body, revision: `"${revision}"` };
  }
  return null;
}

async function downloadVenueBackup(payload, id, revision) {
  const backup = {
    format: 'space-map-recovery-v1',
    exportedAt: new Date().toISOString(),
    venueId: id,
    revision,
    payload: structuredClone(venueSavePayload(payload)),
    backgrounds: [],
  };
  // Fetch only image bodies. Never copy request headers or the organizer key.
  for (const floor of backup.payload.floors) {
    const background = floor.plan?.background;
    if (!background) continue;
    const response = await fetch(`/api/venues/${encodeURIComponent(id)}/floors/${encodeURIComponent(floor.id)}/background/${encodeURIComponent(background.id)}`);
    if (!response.ok) throw new Error(`Не удалось выгрузить подложку (${response.status}). Вкладку не закрывайте.`);
    const blob = await response.blob();
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Не удалось прочитать подложку.'));
      reader.readAsDataURL(blob);
    });
    backup.backgrounds.push({ floorId: floor.id, backgroundId: background.id, dataUrl });
  }
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `space-map-${id}-${Date.now()}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// Import this function in the existing page without mounting or reloading it.
// It observes the next actual PUT, keeps its editable payload, and returns the
// original response unless a specific, lossless protocol repair is confirmed.
export function installSaveRecovery() {
  if (document.getElementById('space-map-save-recovery')) return;
  const originalFetch = window.fetch.bind(window);
  let captured = null;
  const panel = document.createElement('aside');
  panel.id = 'space-map-save-recovery';
  panel.style.cssText = 'position:fixed;bottom:12px;left:12px;right:12px;z-index:2147483647;padding:12px;background:#fff;border:2px solid #087f7b;box-shadow:0 2px 12px #0003;max-height:40vh;overflow:auto;font:14px/1.4 Arial;color:#263331';
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  status.textContent = 'Восстановление подключено без перезагрузки. Нажмите «Повторить сохранение» или «Сохранить». Здесь появится точный ответ сервера.';
  const download = document.createElement('button');
  download.textContent = 'Выгрузить карту и подложку в JSON';
  download.disabled = true;
  download.onclick = async () => {
    download.disabled = true;
    try {
      await downloadVenueBackup(captured.body, captured.id, captured.revision);
      status.textContent += ' JSON с объектами и подложкой передан браузеру для скачивания. Проверьте файл в Загрузках.';
    } catch (error) {
      status.textContent = error.message;
    } finally {
      download.disabled = false;
    }
  };
  const hide = document.createElement('button');
  hide.textContent = 'Свернуть сообщение';
  hide.onclick = () => { status.hidden = !status.hidden; };
  panel.append(status, download, hide);
  document.body.append(panel);
  window.fetch = async function (input, init) {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const match = /^\/api\/venues\/([^/]+)$/.exec(url.pathname);
    if (request.method !== 'PUT' || url.origin !== location.origin || !match
      || !request.headers.get('content-type')?.includes('application/json')) {
      return originalFetch(input, init);
    }
    let body;
    try { body = await request.clone().json(); } catch { return originalFetch(input, init); }
    if (!body || typeof body.name !== 'string' || !Array.isArray(body.floors)) return originalFetch(input, init);
    captured = { body: structuredClone(venueSavePayload(body)), id: decodeURIComponent(match[1]), revision: request.headers.get('if-match') };
    download.disabled = false;
    status.hidden = false;
    status.textContent = 'Данные следующего PUT сохранены в памяти для выгрузки. Ожидаю ответ сервера…';
    try {
      let response = await originalFetch(request.clone());
      let result = await response.clone().json().catch(() => null);
      const firstStatus = response.status;
      const firstMessage = result?.message;
      // At most two narrowly scoped repairs: read-only top-level metadata and
      // quotes around the SAME revision. Never drop placement or update revision.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const repaired = recoverSaveRequest(body, request.headers.get('if-match'), response.status, result);
        if (!repaired) break;
        body = repaired.body;
        request.headers.set('if-match', repaired.revision);
        response = await originalFetch(new Request(request, { body: JSON.stringify(body) }));
        result = await response.clone().json().catch(() => null);
      }
      const summary = body.floors.map((floor) => `${floor.plan?.elements?.length ?? 0} объектов, ${floor.places?.length ?? 0} мест, подложка ${floor.plan?.background ? 'есть' : 'нет'}`).join('; ');
      const first = firstStatus === 400 ? `Первый ответ 400: ${firstMessage ?? 'без сообщения'}. ` : '';
      status.textContent = response.ok
        ? `${first}PUT ${response.status}: сервер подтвердил сохранение. ${summary}. Откройте ту же площадку в новой вкладке для проверки.`
        : `${first}PUT ${response.status}: ${result?.error ?? ''} — ${result?.message ?? 'нет описания'}. Карта осталась в памяти. Выгрузите JSON; исходную вкладку не обновляйте.`;
      return response;
    } catch (error) {
      status.textContent = 'Сеть недоступна. Карта захвачена для выгрузки в JSON; исходную вкладку не обновляйте.';
      throw error;
    }
  };
  // Refresh CSS only. The document, map, key and event handlers stay in memory.
  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = `/src/constructor/constructor.css?recovery=${Date.now()}`;
  document.head.append(style);
}

const elementTypes = {
  zone: 'Зона',
  table: 'Стол',
  stand: 'Стенд',
  stage: 'Сцена',
  partition: 'Стена',
};

const placeTypes = {
  entrance: 'Вход',
  registration: 'Регистрация',
  service: 'Сервисная точка',
  wifi: 'Wi-Fi',
  wc: 'WC',
};

const availableElementTools = ['zone', 'stand', 'stage', 'partition'];
const availablePlaceTools = ['entrance', 'registration', 'wifi', 'wc'];

const handleCorners = {
  nw: [-1, -1],
  ne: [1, -1],
  sw: [-1, 1],
  se: [1, 1],
};

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return `obj-${Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')}`;
  }
  return `obj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function rotateVector(x, y, degrees) {
  const radians = degrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return { x: x * cosine - y * sine, y: x * sine + y * cosine };
}

export function initialVenueId(search, rememberedId = '') {
  const params = new URLSearchParams(search);
  if (params.has('new')) return '';
  return params.get('venue') || rememberedId;
}

export function mountConstructor(container) {
  document.body.classList.add('constructor-page');

  const query = new URLSearchParams(window.location.search);
  let rememberedId = '';
  try { rememberedId = window.localStorage.getItem('space-map-last-venue') || ''; } catch { /* Storage may be disabled. */ }
  let venueId = initialVenueId(window.location.search, rememberedId);
  if (venueId && !query.has('venue')) {
    window.history.replaceState(null, '', `/constructor?venue=${encodeURIComponent(venueId)}`);
  }
  let organizerKey = '';
  const keyStore = `space-map-organizer-key:${venueId}`;
  try { organizerKey = window.sessionStorage.getItem(keyStore) || ''; } catch { /* Session storage may be disabled. */ }
  let needsOrganizerKey = false;
  let retryAfterOrganizerKey = null;
  let pendingBackgroundFile = null;
  let venue = null;
  let selected = null;
  let activeTab = 'objects';
  let activeTool = 'select';
  let routeFromId = '';
  let routeToId = '';
  let routeWaypoints = [];
  let editingRouteEdgeId = null;
  let showRouteNetwork = false;
  let previewRoutePath = null;
  let selectedRouteEdgeId = null;
  let helpOpen = false;
  let temporaryHand = false;
  let isSaving = false;
  let isDirty = false;
  let backgroundEditing = false;
  let backgroundEditBefore = null;
  let notice = '';
  let noticeKind = 'info';
  let view = { scale: 1, x: 0, y: 0 };
  let pointerAction = null;
  let propertyStart = null;
  let savedSnapshot = '';
  let backgroundOpacityStart = null;
  const undoStack = [];
  const redoStack = [];

  function snapshot() {
    if (!venue) return '';
    return JSON.stringify(venueSavePayload(venue));
  }

  function refreshDirty() {
    isDirty = snapshot() !== savedSnapshot;
  }

  function currentFloor() {
    return venue?.floors?.[0] ?? null;
  }

  function fitBackgroundPlacement(background) {
    const imageAspect = background.width / background.height;
    const planAspect = PLAN_WIDTH / PLAN_HEIGHT;
    const size = imageAspect >= planAspect
      ? { width: 1, height: PLAN_WIDTH / imageAspect / PLAN_HEIGHT }
      : { width: imageAspect * PLAN_HEIGHT / PLAN_WIDTH, height: 1 };
    return { x: (1 - size.width) / 2, y: (1 - size.height) / 2, ...size };
  }

  function getBackgroundPlacement(background) {
    return background.placement ?? fitBackgroundPlacement(background);
  }

  function getBackgroundRect(background) {
    const placement = getBackgroundPlacement(background);
    return {
      x: placement.x * PLAN_WIDTH,
      y: placement.y * PLAN_HEIGHT,
      width: placement.width * PLAN_WIDTH,
      height: placement.height * PLAN_HEIGHT,
    };
  }

  function setBackgroundRect(background, rect) {
    const aspect = background.width / background.height;
    const maxWidth = Math.min(PLAN_WIDTH, PLAN_HEIGHT * aspect);
    const width = clamp(rect.width, Math.min(40, maxWidth), maxWidth);
    const height = width / aspect;
    const x = clamp(rect.x, 0, PLAN_WIDTH - width);
    const y = clamp(rect.y, 0, PLAN_HEIGHT - height);
    background.placement = {
      x: x / PLAN_WIDTH,
      y: y / PLAN_HEIGHT,
      width: width / PLAN_WIDTH,
      height: height / PLAN_HEIGHT,
    };
  }

  function beginBackgroundAdjustment() {
    const floor = currentFloor();
    const background = floor?.plan.background;
    if (!background || backgroundEditing || isSaving) return;
    const hasContent = floor.plan.elements.length > 0 || floor.places.length > 0
      || floor.panoramaPoints.length > 0 || floor.routeNodes.length > 0 || floor.routeEdges.length > 0;
    if (hasContent && !window.confirm('Изменение подложки не перемещает объекты. После настройки проверьте их расположение')) return;

    backgroundEditBefore = captureSnapshot();
    if (!background.placement) background.placement = fitBackgroundPlacement(background);
    backgroundEditing = true;
    pointerAction = null;
    notice = 'Настройка подложки: перемещайте изображение или тяните уголки. Объекты временно заблокированы.';
    noticeKind = 'info';
    container.classList.remove('is-hand');
    renderAll();
  }

  function finishBackgroundAdjustment(commit) {
    if (!backgroundEditing || backgroundEditBefore === null) return;
    const before = backgroundEditBefore;
    backgroundEditing = false;
    backgroundEditBefore = null;
    pointerAction = null;
    if (commit) {
      recordChange(before);
      renderAll();
      setNotice('Подложка закреплена. Нажмите «Сохранить», чтобы записать настройки на сервер.', 'info');
    } else {
      restoreSnapshot(before);
      notice = 'Настройка подложки отменена; предыдущее положение восстановлено.';
      noticeKind = 'info';
      updateHeader();
    }
  }

  function fitBackgroundToPlan() {
    if (!backgroundEditing || isSaving) return;
    const background = currentFloor()?.plan.background;
    if (!background) return;
    const placement = fitBackgroundPlacement(background);
    setBackgroundRect(background, {
      x: placement.x * PLAN_WIDTH,
      y: placement.y * PLAN_HEIGHT,
      width: placement.width * PLAN_WIDTH,
      height: placement.height * PLAN_HEIGHT,
    });
    renderCanvas();
  }

  function currentSelection() {
    const floor = currentFloor();
    if (!floor || !selected) return null;
    const collection = selected.kind === 'element' ? floor.plan.elements
      : selected.kind === 'panorama' ? floor.panoramaPoints : floor.places;
    const item = collection.find((entry) => entry.id === selected.id);
    return item ? { item, collection } : null;
  }

  function setNotice(message, kind = 'info') {
    notice = message;
    noticeKind = kind;
    const status = container.querySelector('[data-role="save-status"]');
    if (status) {
      status.textContent = notice;
      status.dataset.kind = noticeKind;
    }
  }

  function cancelActivePointerAction() {
    if (!pointerAction) return;
    const action = pointerAction;
    pointerAction = null;
    if (action.type === 'pan') {
      view.x = action.startX;
      view.y = action.startY;
      updateWorldTransform();
    } else if (action.moved) {
      restoreSnapshot(action.before);
      notice = 'Перетаскивание отменено; изменения возвращены.';
      noticeKind = 'info';
      updateHeader();
    }
  }

  async function requestJson(path, options = {}, withOrganizerKey = false) {
    const headers = new Headers(options.headers ?? {});
    if (withOrganizerKey) headers.set('Authorization', `Bearer ${organizerKey}`);
    const response = await fetch(path, { ...options, headers });
    const body = response.headers.get('content-type')?.includes('application/json')
      ? await response.json()
      : null;
    if (!response.ok) {
      const error = new Error(body?.message ?? `Ошибка сервера (${response.status}).`);
      error.status = response.status;
      error.code = body?.error;
      throw error;
    }
    return body;
  }

  function renderAccessScreen() {
    const isOpening = Boolean(venueId);
    container.innerHTML = `
      <section class="constructor-access" aria-labelledby="constructor-access-title">
        <form class="constructor-access__form" data-form="access" autocomplete="off">
          <p class="constructor-eyebrow">Локальный конструктор</p>
          <h1 id="constructor-access-title">${isOpening ? 'Открыть площадку' : 'Создать площадку'}</h1>
          ${isOpening
            ? `<p class="constructor-access__venue">ID площадки: <code>${escapeHtml(venueId)}</code></p>`
            : `<label>Название площадки<input name="name" maxlength="120" required autofocus placeholder="Например, Манеж ДГТУ"></label>`}
          <label>Ключ доступа организатора<input name="key" type="password" autocomplete="off" required></label>
          <button class="constructor-primary" type="submit">${isOpening ? 'Загрузить площадку' : 'Создать площадку'}</button>
          ${isOpening ? '<a href="/constructor?new=1">Создать новую площадку</a>' : ''}
          <p class="constructor-access__hint" data-role="access-status" role="status" aria-live="polite">${isOpening
            ? 'Введите ключ. Сервер проверит его при сохранении, без пробного запроса на запись.'
            : 'Ключ проверяется настоящим запросом создания. Он не сохраняется браузером.'}</p>
        </form>
      </section>`;

    const form = container.querySelector('[data-form="access"]');
    form.addEventListener('submit', handleAccessSubmit);
    form.querySelector('[name="key"]').focus();
  }

  async function handleAccessSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const keyInput = form.elements.namedItem('key');
    const key = keyInput.value.trim();
    const submit = form.querySelector('button[type="submit"]');
    const status = form.querySelector('[data-role="access-status"]');
    if (!key) {
      status.textContent = 'Введите ключ доступа организатора.';
      return;
    }

    organizerKey = key;
    submit.disabled = true;
    status.textContent = venueId
      ? 'Загружаю площадку. Сам запрос чтения не подтверждает права на запись.'
      : 'Отправляю запрос создания площадки…';

    try {
      if (venueId) {
        venue = await requestJson(`/api/venues/${encodeURIComponent(venueId)}`);
        try { window.localStorage.setItem('space-map-last-venue', venue.id); } catch { /* Storage may be disabled. */ }
        try { window.sessionStorage.setItem(keyStore, organizerKey); } catch { /* Session storage may be disabled. */ }
        savedSnapshot = snapshot();
        undoStack.length = 0;
        redoStack.length = 0;
        isDirty = false;
        renderConstructor();
        setNotice('Площадка загружена. Ключ будет проверен сервером при сохранении.');
      } else {
        const name = form.elements.namedItem('name').value.trim();
        venue = await requestJson('/api/venues', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        }, true);
        venueId = venue.id;
        try { window.sessionStorage.setItem(`space-map-organizer-key:${venueId}`, organizerKey); } catch { /* Session storage may be disabled. */ }
        window.history.replaceState(null, '', `/constructor?venue=${encodeURIComponent(venueId)}`);
        try { window.localStorage.setItem('space-map-last-venue', venueId); } catch { /* Storage may be disabled. */ }
        savedSnapshot = snapshot();
        undoStack.length = 0;
        redoStack.length = 0;
        isDirty = false;
        renderConstructor();
        setNotice('Площадка создана. Сервер проверил ключ в запросе создания.');
      }
    } catch (error) {
      organizerKey = '';
      try { window.sessionStorage.removeItem(keyStore); } catch { /* Session storage may be disabled. */ }
      submit.disabled = false;
      status.textContent = error.message;
      status.dataset.kind = 'error';
      keyInput.focus();
    }
  }

  function makeButton(label, action, options = {}) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.dataset.action = action;
    if (options.selected) button.setAttribute('aria-pressed', 'true');
    if (options.disabled) button.disabled = true;
    return button;
  }

  function renderToolPanel() {
    const panel = container.querySelector('[data-role="tool-panel"]');
    panel.replaceChildren();
    const tools = activeTab === 'routes'
      ? [['select', 'Просмотр'], ['route:point', 'Изгибы (необязательно)'], ['hand', 'Сдвиг карты']]
      : activeTab === 'objects'
      ? [
        ['select', 'Выбор'], ['hand', 'Сдвиг карты'],
        ...availableElementTools.map((key) => [`element:${key}`, elementTypes[key]]),
      ]
      : activeTab === 'panoramas'
      ? [['select', 'Выбор'], ['hand', 'Сдвиг карты']]
      : [
        ['select', 'Выбор'], ['hand', 'Сдвиг карты'],
        ...availablePlaceTools.map((key) => [`place:${key}`, placeTypes[key]]),
      ];
    for (const [tool, label] of tools) {
      panel.append(makeButton(label, `tool:${tool}`, { selected: activeTool === tool }));
    }
    const panoramaActions = container.querySelector('[data-role="panorama-actions"]');
    panoramaActions.hidden = activeTab !== 'panoramas';
    panoramaActions.querySelector('[data-action="capture-selected"]').disabled = selected?.kind !== 'panorama';
    panoramaActions.querySelector('[data-action="tool:panorama"]').setAttribute('aria-pressed', String(activeTool === 'panorama'));
  }

  function toolLabel(tool) {
    if (tool === 'select') return 'Выбор';
    if (tool === 'hand') return 'Сдвиг карты';
    if (tool === 'route:point') return 'Поставьте точки вдоль прохода';
    if (tool === 'panorama') return 'Точка панорамы';
    const type = tool.startsWith('element:') ? tool.slice(8) : tool.slice(6);
    return elementTypes[type] ?? placeTypes[type] ?? 'Размещение';
  }

  function renderList(containerSelector, kind, labelMap, items) {
    const list = container.querySelector(containerSelector);
    list.replaceChildren();
    if (items.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'constructor-empty';
      empty.textContent = 'Пока пусто';
      list.append(empty);
      return;
    }
    for (const item of items) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'constructor-list-item';
      button.dataset.action = 'select-item';
      button.dataset.kind = kind;
      button.dataset.id = item.id;
      if (selected?.kind === kind && selected.id === item.id) button.setAttribute('aria-current', 'true');
      const title = document.createElement('span');
      title.textContent = item.name;
      const meta = document.createElement('small');
      meta.textContent = `${kind === 'panorama' ? ((item.imageUrl || item.imageId) ? 'Снимок готов' : 'Ждёт съёмки') : labelMap[item.type]} · ${item.id.slice(0, 8)}`;
      button.append(title, meta);
      list.append(button);
    }
  }

  function renderProperties() {
    const panel = container.querySelector('[data-role="properties"]');
    const match = currentSelection();
    if (!match) {
      panel.innerHTML = '<p class="constructor-empty">Выберите объект на плане или в списке.</p>';
      return;
    }

    const { item } = match;
    const isElement = selected.kind === 'element';
    const isPanorama = selected.kind === 'panorama';
    const labelMap = isElement ? elementTypes : placeTypes;
    const fields = [
      `<label>Тип<input value="${isPanorama ? 'Точка панорамы' : escapeHtml(labelMap[item.type])}" disabled></label>`,
      `<label>Название<input data-property="name" maxlength="120" value="${escapeHtml(item.name)}"></label>`,
    ];
    if (isPanorama) {
      fields.push(`<p class="constructor-panorama-status">${item.imageUrl || item.imageId ? 'Панорама готова и доступна посетителю.' : 'Изображения пока нет. Сначала сохраните точку, затем снимите серию кадров.'}</p>`);
      fields.push('<label>Загрузить готовую панораму JPEG<input data-role="panorama-file" type="file" accept="image/jpeg,.jpg,.jpeg"></label>');
      fields.push('<button type="button" class="constructor-primary" data-action="capture-selected">Снять и собрать кадры</button>');
      if (item.imageUrl || item.imageId) fields.push('<button type="button" data-action="preview-panorama">Посмотреть панораму</button>');
    } else if (!isElement) {
      if (item.type === 'wifi') {
        fields.push(`<label>Логин (название сети)<input data-property="wifiLogin" maxlength="120" value="${escapeHtml(item.wifiLogin ?? '')}" placeholder="Например: EventWiFi"></label>`);
        fields.push(`<label>Пароль<input data-property="wifiPassword" maxlength="120" value="${escapeHtml(item.wifiPassword ?? '')}" placeholder="Пароль для посетителей"></label>`);
      } else {
        fields.push(`<label>Категория<input data-property="category" maxlength="80" value="${escapeHtml(item.category)}"></label>`);
        fields.push(`<label>Описание (видно посетителю в карточке места)<textarea data-property="description" maxlength="2000" rows="3">${escapeHtml(item.description)}</textarea></label>`);
      }
    }
    if (isElement) {
      fields.push(`<label>Цвет на плане<input data-property="color" type="color" value="${escapeHtml(item.color ?? '#aadbd1')}"></label>`);
      fields.push(`<button type="button" data-action="rotate">Повернуть на 90°</button>`);
    }
    fields.push('<div class="constructor-property-actions">');
    fields.push('<button type="button" data-action="duplicate">Дублировать</button>');
    fields.push('<button type="button" class="constructor-danger" data-action="delete">Удалить</button>');
    fields.push('</div>');
    panel.innerHTML = fields.join('');
  }

  function renderCanvas() {
    const world = container.querySelector('[data-role="world"]');
    if (!world) return;
    world.setAttribute('transform', `translate(${view.x} ${view.y}) scale(${view.scale})`);
    world.replaceChildren();

    const background = svgElement('rect', {
      class: 'constructor-plan-background', x: 0, y: 0, width: PLAN_WIDTH, height: PLAN_HEIGHT,
    });
    world.append(background);

    const floor = currentFloor();
    if (!floor) return;
    const planBackground = floor.plan.background;
    if (planBackground && (planBackground.visible || backgroundEditing)) {
      const rect = getBackgroundRect(planBackground);
      const image = svgElement('image', {
        href: `/api/venues/${encodeURIComponent(venue.id)}/floors/${encodeURIComponent(floor.id)}/background/${encodeURIComponent(planBackground.id)}`,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        opacity: backgroundEditing ? 1 : planBackground.opacity,
        preserveAspectRatio: 'none',
        'pointer-events': 'none',
        'data-role': 'plan-background-image',
      });
      world.append(image);
    }
    const zones = floor.plan.elements.filter((item) => item.type === 'zone');
    const otherElements = floor.plan.elements.filter((item) => item.type !== 'zone');
    for (const item of [...zones, ...otherElements]) renderElement(world, item);
    const nodeById = new Map(floor.routeNodes.map((node) => [node.id, node]));
    for (const edge of floor.routeEdges) {
      if (edge.id === editingRouteEdgeId) continue;
      if (!showRouteNetwork && edge.id !== selectedRouteEdgeId) continue;
      const from = nodeById.get(edge.fromNodeId);
      const to = nodeById.get(edge.toNodeId);
      if (!from || !to) continue;
      const points = [from, ...edge.points, to].map((point) => `${point.x * PLAN_WIDTH},${point.y * PLAN_HEIGHT}`).join(' ');
      world.append(svgElement('polyline', {
        class: edge.id === selectedRouteEdgeId ? 'constructor-route-line constructor-route-line--selected' : 'constructor-route-line',
        points, 'pointer-events': 'none',
      }));
    }
    if (previewRoutePath) world.append(svgElement('polyline', {
      class: 'constructor-route-result',
      points: previewRoutePath.map((point) => `${point.x},${point.y}`).join(' '),
      'pointer-events': 'none',
    }));
    const targets = navigationTargets(floor);
    const from = targets.find((target) => target.id === routeFromId);
    const to = targets.find((target) => target.id === routeToId);
    if (activeTab === 'routes' && from && to && (routeWaypoints.length || editingRouteEdgeId)) {
      const points = [from, ...routeWaypoints, to].map((point) => `${point.x * PLAN_WIDTH},${point.y * PLAN_HEIGHT}`).join(' ');
      world.append(svgElement('polyline', { class: 'constructor-route-preview', points, 'pointer-events': 'none' }));
      for (const [index, point] of routeWaypoints.entries()) world.append(svgElement('circle', {
        class: 'constructor-route-waypoint', cx: point.x * PLAN_WIDTH, cy: point.y * PLAN_HEIGHT,
        r: 10, 'data-waypoint-index': index, 'aria-label': `Точка изгиба ${index + 1}`,
      }));
    }
    for (const item of floor.places) renderPlace(world, item);
    for (const item of floor.panoramaPoints) renderPanoramaPoint(world, item);
    if (backgroundEditing && planBackground) renderBackgroundEditFrame(world, planBackground);
    else renderSelection(world);
  }

  function renderBackgroundEditFrame(world, background) {
    const rect = getBackgroundRect(background);
    world.append(svgElement('rect', {
      class: 'constructor-background-edit-frame',
      'data-role': 'background-frame',
      x: rect.x, y: rect.y, width: rect.width, height: rect.height,
    }));
    for (const [handle, [horizontal, vertical]] of Object.entries(handleCorners)) {
      world.append(svgElement('circle', {
        class: 'constructor-background-resize-handle',
        'data-background-handle': handle,
        cx: horizontal < 0 ? rect.x : rect.x + rect.width,
        cy: vertical < 0 ? rect.y : rect.y + rect.height,
        r: 9 / view.scale,
      }));
    }
  }

  function svgElement(name, attributes = {}) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
    return element;
  }

  function renderElement(world, item) {
    const x = item.x * PLAN_WIDTH;
    const y = item.y * PLAN_HEIGHT;
    const width = item.width * PLAN_WIDTH;
    const height = item.height * PLAN_HEIGHT;
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    const group = svgElement('g', {
      class: `constructor-element constructor-element--${item.type}`,
      'data-entity-kind': 'element',
      'data-entity-id': item.id,
      transform: `rotate(${item.rotation} ${centerX} ${centerY})`,
      ...(item.color ? { style: `--element-fill: ${item.color}` } : {}),
    });
    group.append(svgElement('rect', { x, y, width, height, rx: 4 }));
    const label = svgElement('text', { x: centerX, y: centerY, class: 'constructor-canvas-label' });
    label.textContent = item.name;
    group.append(label);
    world.append(group);
  }

  function renderPlace(world, item) {
    const x = item.x * PLAN_WIDTH;
    const y = item.y * PLAN_HEIGHT;
    const group = svgElement('g', {
      class: `constructor-place constructor-place--${item.type}`,
      'data-entity-kind': 'place',
      'data-entity-id': item.id,
    });
    group.append(svgElement('circle', { cx: x, cy: y, r: 12 }));
    const label = svgElement('text', { x: x + 18, y: y - 13, class: 'constructor-place-label' });
    label.textContent = item.name;
    group.append(label);
    world.append(group);
  }

  function renderPanoramaPoint(world, item) {
    const x = item.x * PLAN_WIDTH;
    const y = item.y * PLAN_HEIGHT;
    const group = svgElement('g', {
      class: `constructor-panorama-point${item.imageUrl || item.imageId ? ' constructor-panorama-point--ready' : ''}`,
      'data-entity-kind': 'panorama', 'data-entity-id': item.id,
    });
    group.append(svgElement('circle', { cx: x, cy: y, r: 15 }));
    const icon = svgElement('text', { x, y: y + 6, class: 'constructor-panorama-icon' });
    icon.textContent = '◉';
    group.append(icon);
    const label = svgElement('text', { x: x + 20, y: y - 14, class: 'constructor-place-label' });
    label.textContent = item.name;
    group.append(label);
    world.append(group);
  }

  function renderSelection(world) {
    const match = currentSelection();
    if (!match) return;
    const { item } = match;
    if (selected.kind === 'place' || selected.kind === 'panorama') {
      world.append(svgElement('circle', {
        class: 'constructor-place-selection',
        cx: item.x * PLAN_WIDTH,
        cy: item.y * PLAN_HEIGHT,
        r: 19,
      }));
      return;
    }

    const x = item.x * PLAN_WIDTH;
    const y = item.y * PLAN_HEIGHT;
    const width = item.width * PLAN_WIDTH;
    const height = item.height * PLAN_HEIGHT;
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    const outline = svgElement('rect', {
      class: 'constructor-selection-outline',
      x, y, width, height,
      transform: `rotate(${item.rotation} ${centerX} ${centerY})`,
    });
    world.append(outline);

    for (const [handle, [horizontal, vertical]] of Object.entries(handleCorners)) {
      const point = rotateVector(horizontal * width / 2, vertical * height / 2, item.rotation);
      world.append(svgElement('circle', {
        class: 'constructor-resize-handle',
        'data-handle': handle,
        cx: centerX + point.x,
        cy: centerY + point.y,
        r: 7 / view.scale,
      }));
    }
  }

  function renderConstructor() {
    const planBackground = currentFloor().plan.background;
    container.innerHTML = `
      <section class="constructor-app" aria-label="Конструктор площадки">
        <header class="constructor-header">
          <div class="constructor-header__identity">
            <span class="constructor-mark" aria-hidden="true">К</span>
            <div><strong data-role="venue-title"></strong><small data-role="venue-id"></small></div>
          </div>
          <div class="constructor-header__actions">
            <button type="button" data-action="undo" title="Отменить" aria-label="Отменить">↶</button>
            <button type="button" data-action="redo" title="Повторить" aria-label="Повторить">↷</button>
            <span class="constructor-save-status" data-role="save-status" role="status" aria-live="polite"></span>
            <button type="button" class="constructor-primary" data-action="save">Сохранить</button>
            <button type="button" data-action="export">Выгрузить JSON</button>
            <button type="button" data-action="share">Ссылка на карту</button>
            <a data-role="visitor-preview" href="/map/${encodeURIComponent(venue.id)}" target="_blank" rel="noopener">Просмотреть карту</a>
            <small class="constructor-share-note">${isDirty ? 'Сначала сохраните изменения' : 'Откройте карту посетителя'}</small>
            <button type="button" data-action="exit">Выйти</button>
          </div>
          ${needsOrganizerKey ? `<form class="constructor-auth-retry" data-form="organizer-retry" autocomplete="off">
            <label>Ключ доступа организатора<input data-role="retry-organizer-key" type="password" autocomplete="off" required></label>
            <button type="submit">Повторить сохранение</button>
          </form>` : ''}
        </header>
        <div class="constructor-layout">
          <aside class="constructor-left-panel">
            <div class="constructor-tabs" role="tablist" aria-label="Разделы конструктора">
              <button type="button" role="tab" aria-selected="${activeTab === 'objects'}" data-action="tab" data-tab="objects">Объекты</button>
              <button type="button" role="tab" aria-selected="${activeTab === 'places'}" data-action="tab" data-tab="places">Места</button>
              <button type="button" role="tab" aria-selected="${activeTab === 'routes'}" data-action="tab" data-tab="routes">Маршрут</button>
              <button type="button" role="tab" aria-selected="${activeTab === 'panoramas'}" data-action="tab" data-tab="panoramas">Панорамы</button>
            </div>
            <details class="constructor-help" data-help ${helpOpen ? 'open' : ''}>
              <summary>Как работать с картой и маршрутами</summary>
              <ol>
                <li>Загрузите подложку плана либо рисуйте на пустом плане. Во вкладке «Объекты» нарисуйте «Зону» как большую область, например рабочее пространство с множеством столов. Размер зоны можно менять за углы. «Стенд» и «Сцена» — объекты, к которым можно вести маршрут. «Стена» — препятствие без маршрута.</li>
                <li>Во вкладке «Места» поставьте вход, регистрацию, WC и при необходимости точку Wi-Fi. Для панорамы выберите «Поставить панораму», нажмите на план, затем в свойствах точки — «Снять и собрать кадры». Изменения сохранятся перед переходом к съёмке.</li>
                <li>Посетитель может начать и закончить маршрут в любой свободной точке плана. Без ручной разметки путь автоматически обходит стены, стенды и сцену, но рабочая зона остаётся проходимой. К сцене путь подходит со свободной стороны и заканчивается у края.</li>
                <li>Маршруты строятся автоматически: организатору достаточно разместить препятствия и места. Во вкладке «Маршрут» проверьте несколько пар точек. Если нужен конкретный проход, можно необязательно добавить предпочтительный участок и отредактировать его изгибы.</li>
                <li>Кнопка «Проверить путь» показывает один синий маршрут; сеть проходов скрыта по умолчанию и включается отдельно. Получите «Ссылку на карту» и проверьте путь как посетитель.</li>
              </ol>
              <p>«Сдвиг карты» перемещает только вид увеличенного плана. Для переноса объекта используйте «Выбор».</p>
            </details>
            <p class="constructor-panel-heading">${activeTab === 'panoramas' ? 'Панорамные точки' : 'Инструменты'}</p>
            <div class="constructor-panorama-actions" data-role="panorama-actions" hidden>
              <button type="button" data-action="tool:panorama">◉ Поставить панораму</button>
              <button type="button" data-action="capture-selected" disabled>Снять выбранную</button>
            </div>
            <div class="constructor-tools" data-role="tool-panel"></div>
            <p class="constructor-tool-hint">${activeTab === 'routes' ? 'Выберите начало и конец и нажмите «Проверить путь». Рисовать линии не нужно.' : activeTab === 'panoramas' ? 'Поставьте точку на плане. Выберите её, измените название в свойствах и нажмите «Снять и собрать кадры».' : 'Выберите инструмент и щёлкните по плану, чтобы разместить объект.'}</p>
            <section class="constructor-route-panel" data-role="route-panel" ${activeTab === 'routes' ? '' : 'hidden'}></section>
          </aside>

          <section class="constructor-canvas-panel" aria-label="Рабочая область плана">
            <div class="constructor-canvas-toolbar">
              <div class="constructor-mode-label" data-role="mode-label">Выбор</div>
              <div class="constructor-zoom-controls">
                ${backgroundEditing
                  ? `<div class="constructor-background-edit-controls" data-role="background-edit-controls">
                      <strong>Настройка подложки</strong>
                      <button type="button" data-action="background-fit">Вписать в план</button>
                      <button type="button" class="constructor-primary" data-action="background-commit">Закрепить</button>
                      <button type="button" data-action="background-cancel">Отмена</button>
                    </div>`
                  : `<label class="constructor-background-upload">${planBackground ? 'Заменить подложку' : 'Подложка'}<input data-role="background-file" type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png"></label>
                    <div class="constructor-background-controls" data-role="background-controls" ${planBackground ? '' : 'hidden'}>
                      <button type="button" data-action="background-configure">Настроить подложку</button>
                      <button type="button" data-action="background-toggle">${planBackground?.visible ? 'Скрыть подложку' : 'Показать подложку'}</button>
                      <button type="button" class="constructor-danger" data-action="background-delete">Удалить подложку</button>
                      <label class="constructor-background-opacity">Прозрачность<input data-role="background-opacity" type="range" min="0" max="1" step="0.05" value="${planBackground?.opacity ?? 1}"></label>
                    </div>`}
                <button type="button" data-action="zoom-out" aria-label="Уменьшить">−</button>
                <button type="button" data-action="zoom-in" aria-label="Увеличить">+</button>
                <button type="button" data-action="fit">Показать весь план</button>
                <span class="constructor-pan-controls" aria-label="Сдвиг просмотра">
                  <button type="button" data-action="pan-left" aria-label="Сдвинуть план влево">←</button>
                  <button type="button" data-action="pan-up" aria-label="Сдвинуть план вверх">↑</button>
                  <button type="button" data-action="pan-down" aria-label="Сдвинуть план вниз">↓</button>
                  <button type="button" data-action="pan-right" aria-label="Сдвинуть план вправо">→</button>
                </span>
              </div>
            </div>
            <div class="constructor-canvas-viewport" data-role="canvas-viewport">
              <svg class="constructor-canvas" viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid meet" role="img" aria-label="План площадки">
                <defs>
                  <pattern id="constructor-grid" width="40" height="40" patternUnits="userSpaceOnUse">
                    <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#e6ece7" stroke-width="1" />
                  </pattern>
                </defs>
                <g data-role="world"></g>
              </svg>
            </div>
          </section>

          <aside class="constructor-right-panel">
            <section class="constructor-properties">
              <h2>Свойства</h2>
              <div data-role="properties"></div>
            </section>
            <section class="constructor-object-list">
              <h2>Объекты и места</h2>
              <h3>Элементы плана</h3>
              <div data-role="element-list" class="constructor-list"></div>
              <h3>Места</h3>
              <div data-role="place-list" class="constructor-list"></div>
              <h3>Панорамы</h3>
              <div data-role="panorama-list" class="constructor-list"></div>
            </section>
          </aside>
        </div>
      </section>`;

    const title = container.querySelector('[data-role="venue-title"]');
    title.textContent = venue.name;
    container.querySelector('[data-role="venue-id"]').textContent = `План · ID ${venue.id}`;
    renderToolPanel();
    container.querySelector('[data-role="mode-label"]').textContent = toolLabel(activeTool);
    renderListsAndProperties();
    renderCanvas();
    updateHeader();
    container.querySelector('.constructor-layout').inert = isSaving;
    container.querySelector('.constructor-left-panel').inert = isSaving || backgroundEditing;
    container.querySelector('.constructor-right-panel').inert = isSaving || backgroundEditing;
    container.classList.toggle('is-saving', isSaving);
  }

  function renderListsAndProperties() {
    const floor = currentFloor();
    renderProperties();
    renderList('[data-role="element-list"]', 'element', elementTypes, floor.plan.elements);
    renderList('[data-role="place-list"]', 'place', placeTypes, floor.places);
    renderList('[data-role="panorama-list"]', 'panorama', {}, floor.panoramaPoints);
    renderRoutePanel();
  }

  function renderRoutePanel() {
    const panel = container.querySelector('[data-role="route-panel"]');
    if (!panel || activeTab !== 'routes') return;
    const floor = currentFloor();
    if (editingRouteEdgeId && !floor.routeEdges.some((edge) => edge.id === editingRouteEdgeId)) {
      editingRouteEdgeId = null;
      routeWaypoints = [];
    }
    const targets = navigationTargets(floor);
    if (!targets.some((target) => target.id === routeFromId)) routeFromId = targets[0]?.id ?? '';
    if (!targets.some((target) => target.id === routeToId)) routeToId = targets.find((target) => target.id !== routeFromId)?.id ?? '';
    const options = targets.map((target) => `<option value="${escapeHtml(target.id)}">${escapeHtml(navigationDisplayName(target))}</option>`).join('');
    const nodeById = new Map(floor.routeNodes.map((node) => [node.id, node]));
    const placeById = new Map(targets.map((target) => [target.id, target]));
    panel.innerHTML = `
      <h2>Автоматический маршрут</h2>
      <p>Разместите стены, сцену и стенды. Система сама найдёт путь между доступными точками и обойдёт препятствия. На этой вкладке можно проверить результат; сохранять маршрут для каждой пары не требуется.</p>
      <label>Откуда<select data-route-from><option value="">Выберите место</option>${options}</select></label>
      <label>Куда<select data-route-to><option value="">Выберите место</option>${options}</select></label>
      <div class="constructor-route-actions">
        <button type="button" class="constructor-primary" data-action="route-check" ${targets.length > 1 ? '' : 'disabled'}>Проверить путь</button>
      </div>
      <p>Синяя линия — автоматически рассчитанный путь.</p>
      ${activeTool === 'route:point' || editingRouteEdgeId || routeWaypoints.length ? `
      <h3>Дополнительно: предпочтительный проход</h3>
      <p>Эта настройка необязательна. Отметьте изгибы на плане, если путь должен идти через определённое место. После сохранения система всё равно проверит обход препятствий.</p>
      <p>${editingRouteEdgeId ? 'Редактирование участка' : 'Новый участок'} · точек изгиба: <strong>${routeWaypoints.length}</strong></p>
      <div class="constructor-route-waypoint-list">${routeWaypoints.map((point, index) => `
        <div class="constructor-route-point-row">
          <strong>Изгиб ${index + 1}</strong>
          <label>X, %<input type="number" min="0" max="100" step="0.1" value="${(point.x * 100).toFixed(1)}" data-waypoint-coordinate="x" data-index="${index}"></label>
          <label>Y, %<input type="number" min="0" max="100" step="0.1" value="${(point.y * 100).toFixed(1)}" data-waypoint-coordinate="y" data-index="${index}"></label>
          <button type="button" data-action="route-remove-point" data-index="${index}" aria-label="Удалить изгиб ${index + 1}">×</button>
        </div>`).join('')}</div>
      <div class="constructor-route-actions">
        <button type="button" data-action="route-undo-point" ${routeWaypoints.length ? '' : 'disabled'}>Убрать последнюю</button>
        <button type="button" class="constructor-primary" data-action="route-add" ${targets.length > 1 ? '' : 'disabled'}>${editingRouteEdgeId ? 'Сохранить участок' : 'Добавить участок'}</button>
        ${editingRouteEdgeId ? '<button type="button" data-action="route-cancel-edit">Отмена правки</button>' : ''}
      </div>
      ` : '<p>Для особого участка можно выбрать инструмент «Изгибы (необязательно)».</p>'}
      ${floor.routeEdges.length ? `<h3>Сохранённые предпочтительные участки</h3>
      <p>Кнопка «Показать» выделяет один участок на плане; «Изменить» открывает его изгибы.</p>
      ${floor.routeEdges.length > 1 ? `<button type="button" data-action="route-toggle-network" aria-pressed="${showRouteNetwork}">${showRouteNetwork ? 'Скрыть все участки' : 'Показать все участки'}</button>
      <p>Все участки отображаются тонкими линиями для общей проверки. Посетитель видит только рассчитанный для него путь.</p>` : ''}
      <div class="constructor-route-edges">${floor.routeEdges.map((edge) => {
        const from = placeById.get(nodeById.get(edge.fromNodeId)?.placeId)?.name ?? 'Узел';
        const to = placeById.get(nodeById.get(edge.toNodeId)?.placeId)?.name ?? 'Узел';
        return `<div><span>${escapeHtml(from)} → ${escapeHtml(to)}</span><button type="button" data-action="route-show-edge" data-id="${escapeHtml(edge.id)}">Показать</button><button type="button" data-action="route-edit" data-id="${escapeHtml(edge.id)}">Изменить</button><button type="button" data-action="route-delete" data-id="${escapeHtml(edge.id)}" aria-label="Удалить участок ${escapeHtml(from)} — ${escapeHtml(to)}">Удалить</button></div>`;
      }).join('')}</div>` : ''}`;
    panel.querySelector('[data-route-from]').value = routeFromId;
    panel.querySelector('[data-route-to]').value = routeToId;
  }

  function syncRouteNodes() {
    const floor = currentFloor();
    const placeById = new Map(navigationTargets(floor).map((target) => [target.id, target]));
    for (const node of floor.routeNodes) {
      const place = placeById.get(node.placeId);
      if (place) { node.x = place.x; node.y = place.y; node.name = place.name; }
    }
  }

  function routeNodeForPlace(place) {
    const floor = currentFloor();
    let node = floor.routeNodes.find((entry) => entry.placeId === place.id);
    if (!node) {
      node = { id: createId(), name: place.name, x: place.x, y: place.y, placeId: place.id };
      floor.routeNodes.push(node);
    }
    return node;
  }

  function addRouteSegment() {
    const floor = currentFloor();
    const targets = navigationTargets(floor);
    const from = targets.find((target) => target.id === routeFromId);
    const to = targets.find((target) => target.id === routeToId);
    if (!from || !to || from.id === to.id) return setNotice('Выберите два разных места.', 'error');
    const fromNode = floor.routeNodes.find((node) => node.placeId === from.id);
    const toNode = floor.routeNodes.find((node) => node.placeId === to.id);
    if (fromNode && toNode && floor.routeEdges.some((edge) => edge.id !== editingRouteEdgeId && (
      (edge.fromNodeId === fromNode.id && edge.toNodeId === toNode.id)
      || (edge.fromNodeId === toNode.id && edge.toNodeId === fromNode.id)))) {
      return setNotice('Эти точки уже соединены. Удалите старый участок, чтобы перерисовать его.', 'error');
    }
    const before = captureSnapshot();
    const first = routeNodeForPlace(from);
    const last = routeNodeForPlace(to);
    const edited = floor.routeEdges.find((edge) => edge.id === editingRouteEdgeId);
    if (edited) {
      edited.fromNodeId = first.id;
      edited.toNodeId = last.id;
      edited.points = routeWaypoints.map((point) => ({ ...point }));
    } else {
      floor.routeEdges.push({ id: createId(), fromNodeId: first.id, toNodeId: last.id, points: routeWaypoints.map((point) => ({ ...point })) });
    }
    routeWaypoints = [];
    editingRouteEdgeId = null;
    selectedRouteEdgeId = null;
    previewRoutePath = null;
    activeTool = 'route:point';
    recordChange(before);
    renderAll();
    setNotice('Участок записан в карту. Нажмите «Сохранить», чтобы посетитель увидел маршрут.');
  }

  function editRouteSegment(id) {
    const floor = currentFloor();
    const edge = floor.routeEdges.find((entry) => entry.id === id);
    if (!edge) return;
    const first = floor.routeNodes.find((node) => node.id === edge.fromNodeId);
    const last = floor.routeNodes.find((node) => node.id === edge.toNodeId);
    if (!first?.placeId || !last?.placeId) return setNotice('Этот участок нельзя редактировать без привязанных точек.', 'error');
    editingRouteEdgeId = edge.id;
    selectedRouteEdgeId = null;
    previewRoutePath = null;
    routeFromId = first.placeId;
    routeToId = last.placeId;
    routeWaypoints = edge.points.map((point) => ({ ...point }));
    activeTool = 'route:point';
    renderAll();
    setNotice('Измените изгибы на плане или в списке. Затем нажмите «Сохранить участок» и «Сохранить».');
  }

  function updateHeader() {
    const status = container.querySelector('[data-role="save-status"]');
    if (!status) return;
    status.textContent = isSaving ? 'Сохраняю…' : notice || (isDirty ? 'Есть несохранённые изменения' : 'Сохранено');
    status.dataset.kind = noticeKind;
    const save = container.querySelector('[data-action="save"]');
    const routeDraft = Boolean(editingRouteEdgeId || routeWaypoints.length);
    save.disabled = isSaving || backgroundEditing || !isDirty || routeDraft;
    save.title = routeDraft ? 'Сначала сохраните участок или уберите точки изгиба' : 'Сохранить площадку';
    const share = container.querySelector('[data-action="share"]');
    share.disabled = isSaving || backgroundEditing || isDirty || routeDraft;
    share.title = routeDraft ? 'Сначала закончите правку участка' : isDirty ? 'Сначала сохраните изменения' : 'Ссылка на карту посетителя';
    const visitorPreview = container.querySelector('[data-role="visitor-preview"]');
    visitorPreview.setAttribute('aria-disabled', String(isDirty || routeDraft || isSaving));
    visitorPreview.tabIndex = isDirty || routeDraft || isSaving ? -1 : 0;
    container.querySelector('.constructor-share-note').textContent = routeDraft ? 'Закончите правку участка' : isDirty ? 'Сначала сохраните изменения' : 'Откройте карту посетителя';
    const undo = container.querySelector('[data-action="undo"]');
    const redo = container.querySelector('[data-action="redo"]');
    undo.disabled = isSaving || undoStack.length === 0;
    redo.disabled = isSaving || redoStack.length === 0;
    container.querySelector('[data-action="exit"]').disabled = isSaving || backgroundEditing;
  }

  function renderAll() {
    if (!venue) return;
    renderConstructor();
  }

  function updateWorldTransform() {
    const world = container.querySelector('[data-role="world"]');
    if (world) world.setAttribute('transform', `translate(${view.x} ${view.y}) scale(${view.scale})`);
  }

  function captureSnapshot() {
    return snapshot();
  }

  function recordChange(before) {
    syncRouteNodes();
    previewRoutePath = null;
    const after = snapshot();
    if (before === after) return;
    undoStack.push(before);
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    redoStack.length = 0;
    refreshDirty();
    notice = '';
    noticeKind = 'info';
    updateHeader();
  }

  function restoreSnapshot(value) {
    const content = JSON.parse(value);
    venue.name = content.name;
    venue.floors = content.floors;
    refreshDirty();
    renderAll();
  }

  function undo() {
    if (isSaving || undoStack.length === 0) return;
    const current = snapshot();
    const previous = undoStack.pop();
    redoStack.push(current);
    restoreSnapshot(previous);
    notice = '';
    updateHeader();
  }

  function redo() {
    if (isSaving || redoStack.length === 0) return;
    const current = snapshot();
    const next = redoStack.pop();
    undoStack.push(current);
    restoreSnapshot(next);
    notice = '';
    updateHeader();
  }

  function propertyValue(item, field, value) {
    if (field === 'name') item.name = value.slice(0, 120);
    if (field === 'category') item.category = value.slice(0, 80);
    if (field === 'description') item.description = value.slice(0, 2000);
    if (field === 'wifiLogin' && item.type === 'wifi') item.wifiLogin = value.slice(0, 120);
    if (field === 'wifiPassword' && item.type === 'wifi') item.wifiPassword = value.slice(0, 120);
    if (field === 'color' && selected?.kind === 'element' && /^#[0-9a-fA-F]{6}$/.test(value)) item.color = value;
    if (['x', 'y'].includes(field)) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) item[field] = Math.min(1, Math.max(0, parsed));
    }
    if (['width', 'height'].includes(field)) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) item[field] = Math.max(0.01, Math.min(1, parsed));
    }
    if (field === 'rotation') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) item.rotation = ((parsed % 360) + 360) % 360;
    }
    if (selected?.kind === 'element') clampElement(item);
  }

  function markDirectChange(before) {
    refreshDirty();
    notice = '';
    recordChange(before);
    renderAll();
  }

  function findEntity(kind, id) {
    const floor = currentFloor();
    if (!floor) return null;
    return (kind === 'element' ? floor.plan.elements : kind === 'panorama' ? floor.panoramaPoints : floor.places)
      .find((item) => item.id === id) ?? null;
  }

  function setSelection(kind, id) {
    selected = { kind, id };
    renderAll();
  }

  function deleteSelected() {
    if (isSaving || !selected) return;
    const before = captureSnapshot();
    const floor = currentFloor();
    const removedTargetId = selected.kind === 'place'
      || (selected.kind === 'element' && floor.plan.elements.some((item) => item.id === selected.id && ['zone', 'stand', 'stage'].includes(item.type)))
      ? selected.id : null;
    if (selected.kind === 'element') {
      floor.plan.elements = floor.plan.elements.filter((item) => item.id !== selected.id);
    } else if (selected.kind === 'panorama') {
      floor.panoramaPoints = floor.panoramaPoints.filter((item) => item.id !== selected.id);
    } else {
      floor.places = floor.places.filter((item) => item.id !== selected.id);
    }
    if (removedTargetId) {
      const removed = new Set(floor.routeNodes.filter((node) => node.placeId === removedTargetId).map((node) => node.id));
      floor.routeNodes = floor.routeNodes.filter((node) => !removed.has(node.id));
      floor.routeEdges = floor.routeEdges.filter((edge) => !removed.has(edge.fromNodeId) && !removed.has(edge.toNodeId));
      if (routeFromId === removedTargetId) routeFromId = '';
      if (routeToId === removedTargetId) routeToId = '';
      routeWaypoints = [];
      editingRouteEdgeId = null;
    }
    selected = null;
    recordChange(before);
    renderAll();
  }

  function duplicateSelected() {
    if (isSaving || !selected) return;
    const original = findEntity(selected.kind, selected.id);
    if (!original) return;
    const before = captureSnapshot();
    const duplicate = { ...original, id: createId() };
    if (selected.kind === 'element') {
      const width = duplicate.width * PLAN_WIDTH;
      const height = duplicate.height * PLAN_HEIGHT;
      const centerX = duplicate.x * PLAN_WIDTH + width / 2 + 24;
      const centerY = duplicate.y * PLAN_HEIGHT + height / 2 + 24;
      setElementGeometry(duplicate, centerX, centerY, width, height, duplicate.rotation);
      currentFloor().plan.elements.push(duplicate);
    } else if (selected.kind === 'panorama') {
      delete duplicate.imageUrl;
      delete duplicate.imageId;
      delete duplicate.placeId;
      delete duplicate.haov;
      delete duplicate.vaov;
      duplicate.name = `${duplicate.name} — копия`.slice(0, 120);
      duplicate.x = Math.min(1, duplicate.x + 0.03);
      duplicate.y = Math.min(1, duplicate.y + 0.03);
      currentFloor().panoramaPoints.push(duplicate);
    } else {
      duplicate.x = Math.min(1, duplicate.x + 0.03);
      duplicate.y = Math.min(1, duplicate.y + 0.03);
      currentFloor().places.push(duplicate);
    }
    selected = { ...selected, id: duplicate.id };
    recordChange(before);
    renderAll();
  }

  function rotateSelected() {
    if (isSaving || selected?.kind !== 'element') return;
    const item = findEntity('element', selected.id);
    if (!item) return;
    const before = captureSnapshot();
    const width = item.width * PLAN_WIDTH;
    const height = item.height * PLAN_HEIGHT;
    setElementGeometry(item, item.x * PLAN_WIDTH + width / 2, item.y * PLAN_HEIGHT + height / 2,
      width, height, (item.rotation + 90) % 360);
    recordChange(before);
    renderAll();
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function setElementGeometry(item, centerX, centerY, width, height, rotation) {
    width = Math.max(18, Math.min(PLAN_WIDTH, width));
    height = Math.max(18, Math.min(PLAN_HEIGHT, height));
    const angle = rotation * Math.PI / 180;
    let boundsWidth = Math.abs(width * Math.cos(angle)) + Math.abs(height * Math.sin(angle));
    let boundsHeight = Math.abs(width * Math.sin(angle)) + Math.abs(height * Math.cos(angle));
    const scale = Math.min(1, PLAN_WIDTH / boundsWidth, PLAN_HEIGHT / boundsHeight);
    width = Math.max(18, width * scale);
    height = Math.max(18, height * scale);
    boundsWidth = Math.abs(width * Math.cos(angle)) + Math.abs(height * Math.sin(angle));
    boundsHeight = Math.abs(width * Math.sin(angle)) + Math.abs(height * Math.cos(angle));
    centerX = clamp(centerX, boundsWidth / 2, PLAN_WIDTH - boundsWidth / 2);
    centerY = clamp(centerY, boundsHeight / 2, PLAN_HEIGHT - boundsHeight / 2);
    item.x = (centerX - width / 2) / PLAN_WIDTH;
    item.y = (centerY - height / 2) / PLAN_HEIGHT;
    item.width = width / PLAN_WIDTH;
    item.height = height / PLAN_HEIGHT;
    item.rotation = rotation;
  }

  function clampElement(item) {
    const width = item.width * PLAN_WIDTH;
    const height = item.height * PLAN_HEIGHT;
    setElementGeometry(item, item.x * PLAN_WIDTH + width / 2, item.y * PLAN_HEIGHT + height / 2,
      width, height, item.rotation);
  }

  function pointInElement(event) {
    const svg = container.querySelector('.constructor-canvas');
    const world = container.querySelector('[data-role="world"]');
    const matrix = world?.getScreenCTM();
    if (!svg || !matrix) return null;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const local = point.matrixTransform(matrix.inverse());
    return { x: local.x, y: local.y };
  }

  function pointInSvg(event) {
    const svg = container.querySelector('.constructor-canvas');
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return null;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const local = point.matrixTransform(matrix.inverse());
    return { x: local.x, y: local.y };
  }

  function handleCanvasPointerDown(event) {
    if (isSaving || event.button !== 0) return;
    const svg = event.target.closest('.constructor-canvas');
    if (!svg) return;
    const point = pointInElement(event);
    if (!point) return;
    event.preventDefault();

    if (backgroundEditing) {
      const handle = event.target.closest('[data-background-handle]');
      if (handle) {
        beginBackgroundResize(event, point, handle.dataset.backgroundHandle);
      } else if (event.target.closest('[data-role="background-frame"]')) {
        const background = currentFloor().plan.background;
        const rect = getBackgroundRect(background);
        pointerAction = {
          type: 'background-move', pointerId: event.pointerId, start: point,
          startRect: rect,
        };
        container.setPointerCapture(event.pointerId);
      }
      return;
    }

    if (activeTool === 'hand' || temporaryHand) {
      const screenPoint = pointInSvg(event);
      if (!screenPoint) return;
      pointerAction = {
        type: 'pan', pointerId: event.pointerId, start: screenPoint, startX: view.x, startY: view.y,
      };
      svg.setPointerCapture(event.pointerId);
      return;
    }

    if (activeTool === 'route:point') {
      const marker = event.target.closest('[data-waypoint-index]');
      if (marker) {
        const index = Number(marker.dataset.waypointIndex);
        pointerAction = {
          type: 'route-waypoint', pointerId: event.pointerId, index,
          original: { ...routeWaypoints[index] },
        };
        svg.setPointerCapture(event.pointerId);
        return;
      }
      if (routeWaypoints.length >= 60) return setNotice('Для одного участка достаточно 60 точек.', 'error');
      routeWaypoints.push({ x: clamp(point.x / PLAN_WIDTH, 0, 1), y: clamp(point.y / PLAN_HEIGHT, 0, 1) });
      previewRoutePath = null;
      renderRoutePanel();
      renderCanvas();
      updateHeader();
      return;
    }

    if (activeTool === 'panorama' || activeTool.startsWith('element:') || activeTool.startsWith('place:')) {
      const before = captureSnapshot();
      if (activeTool === 'panorama') {
        const item = {
          id: createId(), name: `Панорама ${currentFloor().panoramaPoints.length + 1}`,
          x: clamp(point.x / PLAN_WIDTH, 0, 1), y: clamp(point.y / PLAN_HEIGHT, 0, 1),
        };
        currentFloor().panoramaPoints.push(item);
        selected = { kind: 'panorama', id: item.id };
      } else if (activeTool.startsWith('element:')) {
        const type = activeTool.slice('element:'.length);
        const width = 170;
        const height = 100;
        const item = {
          id: createId(), type, name: elementTypes[type],
          x: 0, y: 0, width: 0.17, height: 0.16, rotation: 0,
        };
        setElementGeometry(item, point.x, point.y, width, height, 0);
        currentFloor().plan.elements.push(item);
        selected = { kind: 'element', id: item.id };
      } else {
        const type = activeTool.slice('place:'.length);
        const item = {
          id: createId(), type, name: placeTypes[type], category: '', description: '',
          x: clamp(point.x / PLAN_WIDTH, 0, 1),
          y: clamp(point.y / PLAN_HEIGHT, 0, 1),
        };
        if (type === 'wifi') { item.wifiLogin = ''; item.wifiPassword = ''; }
        currentFloor().places.push(item);
        selected = { kind: 'place', id: item.id };
      }
      activeTool = 'select';
      recordChange(before);
      renderAll();
      return;
    }

    const handle = event.target.closest('[data-handle]');
    if (handle && selected?.kind === 'element') {
      const item = findEntity('element', selected.id);
      if (item) beginResize(event, point, item, handle.dataset.handle);
      return;
    }

    const target = event.target.closest('[data-entity-kind][data-entity-id]');
    if (!target) {
      selected = null;
      renderAll();
      return;
    }

    const kind = target.dataset.entityKind;
    const id = target.dataset.entityId;
    selected = { kind, id };
    const item = findEntity(kind, id);
    renderAll();
    if (!item) return;
    const selectedItem = findEntity(kind, id);
    pointerAction = {
      type: 'move', pointerId: event.pointerId, kind, id, start: point,
      before: captureSnapshot(),
      startX: selectedItem.x,
      startY: selectedItem.y,
      startWidth: kind === 'element' ? selectedItem.width * PLAN_WIDTH : 0,
      startHeight: kind === 'element' ? selectedItem.height * PLAN_HEIGHT : 0,
      startRotation: kind === 'element' ? selectedItem.rotation : 0,
      moved: false,
    };
    container.setPointerCapture(event.pointerId);
  }

  function beginBackgroundResize(event, point, handle) {
    const background = currentFloor()?.plan.background;
    const signs = handleCorners[handle];
    if (!background || !signs) return;
    const rect = getBackgroundRect(background);
    const anchor = {
      x: signs[0] < 0 ? rect.x + rect.width : rect.x,
      y: signs[1] < 0 ? rect.y + rect.height : rect.y,
    };
    pointerAction = {
      type: 'background-resize',
      pointerId: event.pointerId,
      start: point,
      anchor,
      signs,
      startRect: rect,
      aspect: background.width / background.height,
    };
    container.setPointerCapture(event.pointerId);
  }

  function beginResize(event, point, item, handle) {
    const signs = handleCorners[handle];
    if (!signs) return;
    const width = item.width * PLAN_WIDTH;
    const height = item.height * PLAN_HEIGHT;
    const center = { x: item.x * PLAN_WIDTH + width / 2, y: item.y * PLAN_HEIGHT + height / 2 };
    const anchorLocal = { x: -signs[0] * width / 2, y: -signs[1] * height / 2 };
    const anchorOffset = rotateVector(anchorLocal.x, anchorLocal.y, item.rotation);
    pointerAction = {
      type: 'resize', pointerId: event.pointerId, id: item.id, handle, signs, start: point,
      before: captureSnapshot(),
      startCenter: center,
      startWidth: width,
      startHeight: height,
      rotation: item.rotation,
      anchorLocal,
      anchorWorld: { x: center.x + anchorOffset.x, y: center.y + anchorOffset.y },
      moved: false,
    };
    container.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event) {
    const action = pointerAction;
    if (!action || action.pointerId !== event.pointerId || isSaving) return;
    if (action.type === 'route-waypoint') {
      const point = pointInElement(event);
      if (!point || !routeWaypoints[action.index]) return;
      routeWaypoints[action.index] = {
        x: clamp(point.x / PLAN_WIDTH, 0, 1), y: clamp(point.y / PLAN_HEIGHT, 0, 1),
      };
      previewRoutePath = null;
      renderCanvas();
      return;
    }
    if (action.type === 'background-move' || action.type === 'background-resize') {
      const point = pointInElement(event);
      if (!point) return;
      if (Math.abs(point.x - action.start.x) + Math.abs(point.y - action.start.y) > 0.5) action.moved = true;
      if (!action.moved) return;
      const background = currentFloor()?.plan.background;
      if (!background) return;
      if (action.type === 'background-move') {
        setBackgroundRect(background, {
          ...action.startRect,
          x: action.startRect.x + point.x - action.start.x,
          y: action.startRect.y + point.y - action.start.y,
        });
      } else {
        const rawWidth = (point.x - action.anchor.x) * action.signs[0];
        const rawHeight = (point.y - action.anchor.y) * action.signs[1];
        const aspect = action.aspect;
        const projectedWidth = (rawWidth + rawHeight / aspect) / (1 + 1 / (aspect * aspect));
        const maxWidth = Math.min(
          action.signs[0] > 0 ? PLAN_WIDTH - action.anchor.x : action.anchor.x,
          (action.signs[1] > 0 ? PLAN_HEIGHT - action.anchor.y : action.anchor.y) * aspect,
        );
        const width = clamp(projectedWidth, Math.min(40, maxWidth), maxWidth);
        const height = width / aspect;
        setBackgroundRect(background, {
          x: action.signs[0] < 0 ? action.anchor.x - width : action.anchor.x,
          y: action.signs[1] < 0 ? action.anchor.y - height : action.anchor.y,
          width,
          height,
        });
      }
      renderCanvas();
      return;
    }
    if (action.type === 'pan') {
      const point = pointInSvg(event);
      if (!point) return;
      view.x = action.startX + point.x - action.start.x;
      view.y = action.startY + point.y - action.start.y;
      action.moved = true;
      updateWorldTransform();
      return;
    }

    const point = pointInElement(event);
    if (!point) return;
    if (Math.abs(point.x - action.start.x) + Math.abs(point.y - action.start.y) > 0.5) action.moved = true;
    if (!action.moved) return;

    if (action.type === 'move') {
      const item = findEntity(action.kind, action.id);
      if (!item) return;
      if (action.kind === 'place' || action.kind === 'panorama') {
        item.x = clamp(action.startX + (point.x - action.start.x) / PLAN_WIDTH, 0, 1);
        item.y = clamp(action.startY + (point.y - action.start.y) / PLAN_HEIGHT, 0, 1);
      } else {
        const width = action.startWidth;
        const height = action.startHeight;
        setElementGeometry(item,
          action.startX * PLAN_WIDTH + width / 2 + point.x - action.start.x,
          action.startY * PLAN_HEIGHT + height / 2 + point.y - action.start.y,
          width, height, action.startRotation);
      }
    } else if (action.type === 'resize') {
      const item = findEntity('element', action.id);
      if (!item) return;
      const dx = point.x - action.startCenter.x;
      const dy = point.y - action.startCenter.y;
      const radians = action.rotation * Math.PI / 180;
      const localX = dx * Math.cos(radians) + dy * Math.sin(radians);
      const localY = -dx * Math.sin(radians) + dy * Math.cos(radians);
      const width = Math.max(18, (localX - action.anchorLocal.x) * action.signs[0]);
      const height = Math.max(18, (localY - action.anchorLocal.y) * action.signs[1]);
      const endpoint = {
        x: action.anchorLocal.x + action.signs[0] * width,
        y: action.anchorLocal.y + action.signs[1] * height,
      };
      const localCenter = {
        x: (action.anchorLocal.x + endpoint.x) / 2,
        y: (action.anchorLocal.y + endpoint.y) / 2,
      };
      const centerOffset = rotateVector(localCenter.x - action.anchorLocal.x, localCenter.y - action.anchorLocal.y, action.rotation);
      setElementGeometry(item,
        action.anchorWorld.x + centerOffset.x,
        action.anchorWorld.y + centerOffset.y,
        width, height, action.rotation);
    }
    renderCanvas();
  }

  function handlePointerUp(event) {
    const action = pointerAction;
    if (!action || action.pointerId !== event.pointerId) return;
    pointerAction = null;
    if (action.type === 'route-waypoint') { renderRoutePanel(); return; }
    if (action.type === 'background-move' || action.type === 'background-resize') return;
    if (action.type !== 'pan' && action.moved) {
      recordChange(action.before);
      renderAll();
    }
  }

  function handlePointerCancel(event) {
    if (!pointerAction || pointerAction.pointerId !== event.pointerId) return;
    const action = pointerAction;
    if (action.type === 'route-waypoint') {
      pointerAction = null;
      routeWaypoints[action.index] = action.original;
      renderRoutePanel();
      renderCanvas();
      return;
    }
    if (action.type === 'background-move' || action.type === 'background-resize') {
      finishBackgroundAdjustment(false);
      return;
    }
    pointerAction = null;
    if (action.type !== 'pan' && action.moved) {
      restoreSnapshot(action.before);
      notice = 'Перетаскивание отменено; изменения возвращены.';
      updateHeader();
    }
  }

  function zoom(factor) {
    const svg = container.querySelector('.constructor-canvas');
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const point = svg.createSVGPoint();
    point.x = rect.left + rect.width / 2;
    point.y = rect.top + rect.height / 2;
    const local = point.matrixTransform(svg.getScreenCTM().inverse());
    const centerX = (local.x - view.x) / view.scale;
    const centerY = (local.y - view.y) / view.scale;
    const nextScale = clamp(view.scale * factor, 0.35, 4);
    view.x = local.x - centerX * nextScale;
    view.y = local.y - centerY * nextScale;
    view.scale = nextScale;
    updateWorldTransform();
  }

  function fitPlan() {
    view = { scale: 1, x: 0, y: 0 };
    updateWorldTransform();
  }

  async function saveVenue() {
    if (!venue || isSaving || backgroundEditing) return false;
    if (editingRouteEdgeId || routeWaypoints.length) {
      setNotice('Сначала нажмите «Сохранить участок» или уберите точки изгиба.', 'error');
      return false;
    }
    syncRouteNodes();
    if (!isDirty) return true;
    isSaving = true;
    notice = '';
    renderAll();
    try {
      const saved = await requestJson(`/api/venues/${encodeURIComponent(venue.id)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'If-Match': `"${venue.revision}"`,
        },
        body: JSON.stringify(venueSavePayload(venue)),
      }, true);
      venue = saved;
      savedSnapshot = snapshot();
      undoStack.length = 0;
      redoStack.length = 0;
      refreshDirty();
      notice = 'Сохранено на сервере.';
      noticeKind = 'success';
      renderAll();
      return true;
    } catch (error) {
      if (error.status === 401) {
        organizerKey = '';
        needsOrganizerKey = true;
        retryAfterOrganizerKey = () => saveVenue();
      }
      noticeKind = 'error';
      notice = error.status === 401
        ? 'Сервер не принял ключ. Введите ключ доступа организатора ниже; карта останется в памяти.'
        : error.status === 412
          ? 'Версия на сервере изменилась. Локальные данные сохранены в памяти; сохранение не выполнено. Скопируйте изменения или выйдите без перезагрузки страницы.'
          : `Сохранение не выполнено: ${error.message}. Изменения остались в памяти; можно повторить.`;
      renderAll();
      return false;
    } finally {
      isSaving = false;
      renderAll();
    }
  }

  async function uploadBackground(file) {
    if (!file || !venue || isSaving || backgroundEditing) return;
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      setNotice('Выберите файл JPG или PNG.', 'error');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setNotice('Размер изображения не должен превышать 10 МБ.', 'error');
      return;
    }
    if (isDirty) {
      if (!window.confirm('Сначала сохранить текущие изменения перед загрузкой подложки?')) return;
      const saved = await saveVenue();
      if (!saved) return;
    }

    const floor = currentFloor();
    const previous = floor.plan.background;
    isSaving = true;
    notice = '';
    renderAll();
    try {
      const saved = await requestJson(`/api/venues/${encodeURIComponent(venue.id)}/floors/${encodeURIComponent(floor.id)}/background`, {
        method: 'PUT',
        headers: {
          'Content-Type': file.type,
          'If-Match': `"${venue.revision}"`,
        },
        body: file,
      }, true);
      venue = saved;
      pendingBackgroundFile = null;
      savedSnapshot = snapshot();
      undoStack.length = 0;
      redoStack.length = 0;
      refreshDirty();
      noticeKind = 'success';
      const current = currentFloor().plan.background;
      const oldRatio = previous ? previous.width / previous.height : 0;
      const newRatio = current.width / current.height;
      notice = oldRatio && Math.abs(oldRatio - newRatio) / oldRatio > 0.02
        ? 'Подложка заменена. Пропорции изображения изменились; проверьте расположение объектов.'
        : 'Подложка сохранена на сервере.';
      renderAll();
    } catch (error) {
      if (error.status === 401) {
        organizerKey = '';
        needsOrganizerKey = true;
        pendingBackgroundFile = file;
        retryAfterOrganizerKey = () => uploadBackground(file);
      }
      noticeKind = 'error';
      notice = error.status === 401
        ? 'Сервер не принял ключ. Введите ключ ниже; выберите файл ещё раз после повторного входа, если загрузка не повторится автоматически.'
        : error.status === 412
          ? 'Версия на сервере изменилась. Подложка не заменена; перезагрузите площадку и повторите.'
          : `Подложка не заменена: ${error.message}. Предыдущий файл сохранён.`;
      renderAll();
    } finally {
      isSaving = false;
      renderAll();
      const input = container.querySelector('[data-role="background-file"]');
      if (input) input.value = '';
    }
  }

  async function uploadPanorama(file, pointId) {
    if (!file || !pointId || !venue || isSaving || backgroundEditing) return;
    if (file.type !== 'image/jpeg' || file.size > 10 * 1024 * 1024) {
      setNotice('Для панорамы нужен JPEG размером до 10 МБ.', 'error');
      return;
    }
    if (isDirty && !await saveVenue()) return;
    const floor = currentFloor();
    if (!floor.panoramaPoints.some((point) => point.id === pointId)) return;
    isSaving = true;
    notice = '';
    renderAll();
    try {
      const saved = await requestJson(`/api/venues/${encodeURIComponent(venue.id)}/floors/${encodeURIComponent(floor.id)}/panoramas/${encodeURIComponent(pointId)}/image`, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg', 'If-Match': `"${venue.revision}"` },
        body: file,
      }, true);
      venue = saved;
      savedSnapshot = snapshot();
      undoStack.length = 0;
      redoStack.length = 0;
      refreshDirty();
      notice = 'Панорама сохранена на сервере и привязана к точке.';
      noticeKind = 'success';
    } catch (error) {
      if (error.status === 401) {
        organizerKey = '';
        needsOrganizerKey = true;
        retryAfterOrganizerKey = () => uploadPanorama(file, pointId);
      }
      notice = `Панорама не загружена: ${error.message}. Точка и прежний файл сохранены.`;
      noticeKind = 'error';
    } finally {
      isSaving = false;
      renderAll();
    }
  }

  async function deleteBackground() {
    const floor = currentFloor();
    if (!floor?.plan.background || isSaving || backgroundEditing) return;
    if (!window.confirm('Удалить подложку и сохранить карту? Объекты и остальные изменения будут сохранены вместе.')) return;
    const before = captureSnapshot();
    floor.plan.background = null;
    recordChange(before);
    renderAll();
    if (await saveVenue()) {
      setNotice('Подложка удалена и сохранена на сервере. Объекты и места сохранены.', 'success');
    }
    // On failure the deletion remains a dirty, undoable edit. A key retry uses
    // the same full PUT; no successful save is claimed and no image file is erased.
  }

  function toggleBackground() {
    const background = currentFloor()?.plan.background;
    if (!background || isSaving || backgroundEditing) return;
    const before = captureSnapshot();
    background.visible = !background.visible;
    recordChange(before);
    renderAll();
  }

  function handleBackgroundOpacityInput(event) {
    const input = event.target.closest('[data-role="background-opacity"]');
    const background = currentFloor()?.plan.background;
    if (!input || !background || isSaving || backgroundEditing) return;
    if (backgroundOpacityStart === null) backgroundOpacityStart = captureSnapshot();
    background.opacity = Number(input.value);
    refreshDirty();
    notice = '';
    renderCanvas();
    updateHeader();
  }

  function handleBackgroundOpacityChange(event) {
    if (!event.target.closest('[data-role="background-opacity"]') || backgroundOpacityStart === null) return;
    const before = backgroundOpacityStart;
    backgroundOpacityStart = null;
    recordChange(before);
    renderAll();
  }

  function handleBackgroundFileChange(event) {
    const input = event.target.closest('[data-role="background-file"]');
    if (input) uploadBackground(input.files?.[0]);
  }

  function chooseTool(tool) {
    activeTool = tool;
    container.classList.toggle('is-hand', activeTool === 'hand' || temporaryHand);
    renderToolPanel();
    renderRoutePanel();
    container.querySelector('[data-role="mode-label"]').textContent = toolLabel(tool);
    if (tool === 'hand') setNotice('Сначала увеличьте план кнопкой «+», затем удерживайте и перетаскивайте его. Стрелки рядом с масштабом тоже сдвигают вид.');
  }

  async function handleAction(action, button) {
    if (isSaving) return;
    if (backgroundEditing && !['background-fit', 'background-commit', 'background-cancel', 'zoom-in', 'zoom-out', 'fit'].includes(action)) return;
    if (action.startsWith('tool:')) return chooseTool(action.slice('tool:'.length));
    if (action === 'tab') {
      activeTab = button.dataset.tab;
      activeTool = 'select';
      for (const tab of container.querySelectorAll('[data-action="tab"]')) {
        tab.setAttribute('aria-selected', String(tab.dataset.tab === activeTab));
      }
      renderAll();
      return;
    }
    if (action === 'route-check') {
      const targets = navigationTargets(currentFloor());
      const from = targets.find((target) => target.id === routeFromId);
      const to = targets.find((target) => target.id === routeToId);
      if (!from || !to) return setNotice('Выберите начало и конец пути.', 'error');
      previewRoutePath = plannedRoute(currentFloor(), from, to);
      renderCanvas();
      setNotice(previewRoutePath
        ? 'Синий путь учитывает стены и сцену. Участки сети отображаются только по запросу.'
        : 'Проход не найден: препятствия разделяют эти точки.', previewRoutePath ? 'info' : 'error');
      return;
    }
    if (action === 'route-toggle-network') {
      showRouteNetwork = !showRouteNetwork;
      renderRoutePanel();
      renderCanvas();
      return;
    }
    if (action === 'route-show-edge') {
      selectedRouteEdgeId = selectedRouteEdgeId === button.dataset.id ? null : button.dataset.id;
      renderCanvas();
      return;
    }
    if (action === 'route-add') return addRouteSegment();
    if (action === 'route-edit') return editRouteSegment(button.dataset.id);
    if (action === 'route-cancel-edit') {
      editingRouteEdgeId = null;
      routeWaypoints = [];
      previewRoutePath = null;
      renderAll();
      return;
    }
    if (action === 'route-remove-point') {
      routeWaypoints.splice(Number(button.dataset.index), 1);
      previewRoutePath = null;
      renderRoutePanel();
      renderCanvas();
      updateHeader();
      return;
    }
    if (action === 'route-undo-point') {
      routeWaypoints.pop();
      previewRoutePath = null;
      renderRoutePanel();
      renderCanvas();
      updateHeader();
      return;
    }
    if (action === 'route-delete') {
      const before = captureSnapshot();
      const floor = currentFloor();
      floor.routeEdges = floor.routeEdges.filter((edge) => edge.id !== button.dataset.id);
      if (editingRouteEdgeId === button.dataset.id) { editingRouteEdgeId = null; routeWaypoints = []; }
      if (selectedRouteEdgeId === button.dataset.id) selectedRouteEdgeId = null;
      recordChange(before);
      renderAll();
      return;
    }
    if (action === 'save') return saveVenue();
    if (action === 'capture-selected') {
      const point = selected?.kind === 'panorama' && findEntity('panorama', selected.id);
      if (!point) return setNotice('Сначала выберите точку панорамы на плане или в списке.', 'error');
      if (!(await saveVenue())) return;
      window.location.assign(`/panorama-capture?venue=${encodeURIComponent(venue.id)}&floor=${encodeURIComponent(currentFloor().id)}&point=${encodeURIComponent(point.id)}`);
      return;
    }
    if (action === 'preview-panorama') {
      const point = selected?.kind === 'panorama' && findEntity('panorama', selected.id);
      if (!point || !(point.imageUrl || point.imageId)) return setNotice('Для этой точки пока нет готовой панорамы.', 'error');
      const { openPanorama } = await import('../panorama/panorama-viewer.js');
      const floor = currentFloor();
      const scenes = floor.panoramaPoints.map((entry) => ({ ...entry,
        imageUrl: entry.imageUrl ?? (entry.imageId
          ? `/api/venues/${encodeURIComponent(venue.id)}/floors/${encodeURIComponent(floor.id)}/panoramas/${encodeURIComponent(entry.id)}/image`
          : undefined),
      }));
      await openPanorama(container, scenes, point.id, floor.places);
      return;
    }
    if (action === 'export') {
      try {
        await downloadVenueBackup(venue, venue.id, venue.revision);
        setNotice('JSON с картой и подложкой передан браузеру для скачивания. Проверьте файл в Загрузках.');
      } catch (error) { setNotice(error.message, 'error'); }
      return;
    }
    if (action === 'share') {
      if (isDirty) return setNotice('Сначала сохраните изменения.', 'error');
      const link = `${window.location.origin}/map/${encodeURIComponent(venue.id)}`;
      window.prompt('Скопируйте ссылку для посетителя:', link);
      return;
    }
    if (action === 'undo') return undo();
    if (action === 'redo') return redo();
    if (action === 'delete') return deleteSelected();
    if (action === 'duplicate') return duplicateSelected();
    if (action === 'rotate') return rotateSelected();
    if (action === 'zoom-in') return zoom(1.2);
    if (action === 'zoom-out') return zoom(1 / 1.2);
    if (action === 'fit') return fitPlan();
    if (action.startsWith('pan-')) {
      const moves = { 'pan-left': [-80, 0], 'pan-right': [80, 0], 'pan-up': [0, -80], 'pan-down': [0, 80] };
      const delta = moves[action];
      if (delta) { view.x += delta[0]; view.y += delta[1]; updateWorldTransform(); }
      return;
    }
    if (action === 'background-configure') return beginBackgroundAdjustment();
    if (action === 'background-fit') return fitBackgroundToPlan();
    if (action === 'background-commit') return finishBackgroundAdjustment(true);
    if (action === 'background-cancel') return finishBackgroundAdjustment(false);
    if (action === 'background-toggle') return toggleBackground();
    if (action === 'background-delete') return deleteBackground();
    if (action === 'select-item') return setSelection(button.dataset.kind, button.dataset.id);
    if (action === 'exit') {
      if (isDirty && !window.confirm('Есть несохранённые изменения. Выйти без сохранения?')) return;
      organizerKey = '';
      try { window.sessionStorage.removeItem(keyStore); } catch { /* Session storage may be disabled. */ }
      window.location.assign(`/constructor?venue=${encodeURIComponent(venue.id)}`);
    }
  }

  function isTextEntry(target) {
    return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
  }

  function handleKeyDown(event) {
    if (isTextEntry(event.target)) return;
    if (event.key === 'Escape' && backgroundEditing) {
      event.preventDefault();
      finishBackgroundAdjustment(false);
      return;
    }
    if (event.key === 'Escape' && pointerAction) {
      event.preventDefault();
      cancelActivePointerAction();
      return;
    }
    if (backgroundEditing) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo(); else undo();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      redo();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      saveVenue();
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      deleteSelected();
      return;
    }
    if (event.code === 'Space' && !event.repeat) {
      event.preventDefault();
      temporaryHand = true;
      container.classList.add('is-hand');
    }
  }

  function handleKeyUp(event) {
    if (event.code === 'Space') {
      temporaryHand = false;
      container.classList.remove('is-hand');
    }
  }

  function handlePropertyInput(event) {
    const input = event.target.closest('[data-property]');
    if (!input || isSaving) return;
    const match = currentSelection();
    if (!match) return;
    if (propertyStart === null) propertyStart = captureSnapshot();
    propertyValue(match.item, input.dataset.property, input.value);
    refreshDirty();
    notice = '';
    renderCanvas();
    updateHeader();
  }

  function handlePropertyChange(event) {
    const input = event.target.closest('[data-property]');
    if (!input || isSaving) return;
    const match = currentSelection();
    if (!match) return;
    if (propertyStart === null) propertyStart = captureSnapshot();
    propertyValue(match.item, input.dataset.property, input.value);
    const before = propertyStart;
    propertyStart = null;
    recordChange(before);
    renderAll();
  }

  function handleSubmit(event) {
    if (event.target.matches('[data-form="access"]')) return;
    if (!event.target.matches('[data-form="organizer-retry"]')) return;
    event.preventDefault();
    const input = event.target.querySelector('[data-role="retry-organizer-key"]');
    const key = input.value.trim();
    if (!key) return;
    organizerKey = key;
    needsOrganizerKey = false;
    const retry = retryAfterOrganizerKey ?? (() => saveVenue());
    retryAfterOrganizerKey = null;
    renderAll();
    retry();
  }

  container.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (button) handleAction(button.dataset.action, button);
  });
  container.addEventListener('pointerdown', handleCanvasPointerDown);
  container.addEventListener('pointermove', handlePointerMove);
  container.addEventListener('pointerup', handlePointerUp);
  container.addEventListener('pointercancel', handlePointerCancel);
  container.addEventListener('lostpointercapture', handlePointerCancel);
  container.addEventListener('focusin', (event) => {
    if (event.target.closest('[data-property]') && propertyStart === null) propertyStart = captureSnapshot();
  });
  container.addEventListener('input', handlePropertyInput);
  container.addEventListener('change', handlePropertyChange);
  container.addEventListener('input', handleBackgroundOpacityInput);
  container.addEventListener('change', handleBackgroundOpacityChange);
  container.addEventListener('change', handleBackgroundFileChange);
  container.addEventListener('change', (event) => {
    if (event.target.matches('[data-role="panorama-file"]')) {
      uploadPanorama(event.target.files?.[0], selected?.kind === 'panorama' ? selected.id : null);
    }
  });
  container.addEventListener('toggle', (event) => {
    if (event.target.matches('[data-help]')) helpOpen = event.target.open;
  }, true);
  container.addEventListener('change', (event) => {
    if (event.target.matches('[data-waypoint-coordinate]')) {
      const index = Number(event.target.dataset.index);
      const coordinate = event.target.dataset.waypointCoordinate;
      const value = Number(event.target.value);
      if (routeWaypoints[index] && ['x', 'y'].includes(coordinate) && Number.isFinite(value)) {
        routeWaypoints[index][coordinate] = clamp(value / 100, 0, 1);
      }
      previewRoutePath = null;
      renderRoutePanel();
      renderCanvas();
      updateHeader();
      return;
    }
    if (event.target.matches('[data-route-from]')) routeFromId = event.target.value;
    else if (event.target.matches('[data-route-to]')) routeToId = event.target.value;
    else return;
    previewRoutePath = null;
    renderCanvas();
  });
  container.addEventListener('submit', handleSubmit);
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);
  window.addEventListener('blur', () => {
    temporaryHand = false;
    container.classList.remove('is-hand');
  });
  window.addEventListener('beforeunload', (event) => {
    if (!isDirty) return;
    event.preventDefault();
    event.returnValue = '';
  });

  if (venueId && organizerKey) {
    requestJson(`/api/venues/${encodeURIComponent(venueId)}`).then((loaded) => {
      venue = loaded;
      savedSnapshot = snapshot();
      renderConstructor();
    }).catch(() => renderAccessScreen());
  } else renderAccessScreen();

  return function unmountConstructor() {
    organizerKey = '';
    document.body.classList.remove('constructor-page');
  };
}
