const tokenInput = document.querySelector('#organizer-token');
const createForm = document.querySelector('#create-form');
const loadForm = document.querySelector('#load-form');
const elementForm = document.querySelector('#element-form');
const placeForm = document.querySelector('#place-form');
const saveButton = document.querySelector('#save-button');
const status = document.querySelector('#status');
const venueIdInput = document.querySelector('#venue-id');
const venueSummary = document.querySelector('#venue-summary');
const elementsList = document.querySelector('#elements-list');
const placesList = document.querySelector('#places-list');
const planPreview = document.querySelector('#plan-preview');

let organizerToken = '';
let venue = null;
let isDirty = false;

const elementLabels = {
  zone: 'Зона', table: 'Стол', stand: 'Стенд', stage: 'Сцена', partition: 'Перегородка',
};
const placeLabels = {
  entrance: 'Вход', registration: 'Регистрация', service: 'Сервисная точка',
};

tokenInput.addEventListener('input', () => {
  organizerToken = tokenInput.value.trim();
});

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function showStatus(message, kind = 'info') {
  status.textContent = message;
  status.dataset.kind = kind;
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers ?? {});
  if (organizerToken) headers.set('Authorization', `Bearer ${organizerToken}`);
  const response = await fetch(path, { ...options, headers });
  let body = null;
  if (response.headers.get('content-type')?.includes('application/json')) {
    body = await response.json();
  }
  if (!response.ok) {
    throw new Error(body?.message ?? `HTTP ${response.status}`);
  }
  return { body, etag: response.headers.get('etag') };
}

function currentFloor() {
  return venue?.floors?.[0] ?? null;
}

function getCollection(floor, collection) {
  return collection === 'elements' ? floor.plan.elements : floor[collection];
}

function markDirty() {
  isDirty = true;
  saveButton.disabled = false;
  showStatus('Есть несохранённые изменения. Нажмите «Сохранить изменения».');
}

function renderPlan() {
  const floor = currentFloor();
  planPreview.replaceChildren();
  const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  background.setAttribute('class', 'plan-background');
  background.setAttribute('width', '1000');
  background.setAttribute('height', '600');
  planPreview.append(background);
  if (!floor) return;

  for (const item of floor.plan.elements) {
    const x = item.x * 1000;
    const y = item.y * 600;
    const width = item.width * 1000;
    const height = item.height * 600;
    const rectangle = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rectangle.setAttribute('class', 'plan-element');
    rectangle.setAttribute('data-type', item.type);
    rectangle.setAttribute('x', String(x));
    rectangle.setAttribute('y', String(y));
    rectangle.setAttribute('width', String(width));
    rectangle.setAttribute('height', String(height));
    rectangle.setAttribute('transform', `rotate(${item.rotation} ${x + width / 2} ${y + height / 2})`);
    planPreview.append(rectangle);
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('class', 'plan-element-label');
    label.setAttribute('x', String(x + width / 2));
    label.setAttribute('y', String(y + height / 2));
    label.textContent = item.name;
    planPreview.append(label);
  }

  for (const place of floor.places) {
    const x = place.x * 1000;
    const y = place.y * 600;
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('class', 'plan-place');
    circle.setAttribute('cx', String(x));
    circle.setAttribute('cy', String(y));
    circle.setAttribute('r', '13');
    planPreview.append(circle);
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('class', 'plan-place-label');
    label.setAttribute('x', String(x + 18));
    label.setAttribute('y', String(y));
    label.textContent = place.name;
    planPreview.append(label);
  }
}

function renderObjectList(collection, container, labels) {
  const floor = currentFloor();
  const items = floor ? getCollection(floor, collection) : [];
  if (items.length === 0) {
    container.innerHTML = '<p class="empty-list">Пока нет объектов.</p>';
    return;
  }

  container.innerHTML = items.map((item, index) => {
    const typeOptions = Object.entries(labels).map(([value, label]) =>
      `<option value="${value}"${value === item.type ? ' selected' : ''}>${label}</option>`).join('');
    const fields = collection === 'elements'
      ? `<label>Тип<select data-collection="${collection}" data-index="${index}" data-field="type">${typeOptions}</select></label>
         <label class="wide">Название<input data-collection="${collection}" data-index="${index}" data-field="name" value="${escapeHtml(item.name)}" maxlength="120"></label>
         ${numberField(collection, index, 'x', item.x)}${numberField(collection, index, 'y', item.y)}
         ${numberField(collection, index, 'width', item.width)}${numberField(collection, index, 'height', item.height)}
         ${numberField(collection, index, 'rotation', item.rotation)}`
      : `<label>Тип<select data-collection="${collection}" data-index="${index}" data-field="type">${typeOptions}</select></label>
         <label class="wide">Название<input data-collection="${collection}" data-index="${index}" data-field="name" value="${escapeHtml(item.name)}" maxlength="120"></label>
         <label>Категория<input data-collection="${collection}" data-index="${index}" data-field="category" value="${escapeHtml(item.category)}" maxlength="80"></label>
         <label class="wide">Описание<input data-collection="${collection}" data-index="${index}" data-field="description" value="${escapeHtml(item.description)}" maxlength="2000"></label>
         ${numberField(collection, index, 'x', item.x)}${numberField(collection, index, 'y', item.y)}`;
    return `<article class="object-item" data-id="${escapeHtml(item.id)}">${fields}
      <button type="button" data-delete="${collection}" data-index="${index}">Удалить</button></article>`;
  }).join('');
}

function numberField(collection, index, field, value) {
  const min = field === 'width' || field === 'height' ? '0.01' : '0';
  const max = field === 'rotation' ? '359.99' : '1';
  const step = field === 'rotation' ? '1' : '0.01';
  return `<label>${field}<input type="number" min="${min}" max="${max}" step="${step}" data-collection="${collection}" data-index="${index}" data-field="${field}" value="${value}" required></label>`;
}

function render() {
  const floor = currentFloor();
  venueSummary.textContent = venue
    ? `${venue.name} · ID ${venue.id} · revision ${venue.revision} · этажей ${venue.floors.length}`
    : 'Площадка ещё не загружена.';
  if (venue) venueIdInput.value = venue.id;
  saveButton.disabled = !venue || !isDirty;
  renderObjectList('elements', elementsList, elementLabels);
  renderObjectList('places', placesList, placeLabels);
  renderPlan();
}

function numericValue(formData, field) {
  return Number(formData.get(field));
}

createForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const { body } = await request('/api/venues', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: new FormData(createForm).get('name') }),
    });
    venue = body;
    isDirty = false;
    render();
    showStatus('Площадка создана на сервере. Скопируйте ID для повторной загрузки.');
  } catch (error) {
    showStatus(error.message, 'error');
  }
});

loadForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const id = new FormData(loadForm).get('id').trim();
  try {
    const { body } = await request(`/api/venues/${encodeURIComponent(id)}`);
    venue = body;
    isDirty = false;
    render();
    showStatus('Площадка повторно загружена с сервера.');
  } catch (error) {
    showStatus(error.message, 'error');
  }
});

elementForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const floor = currentFloor();
  if (!floor) return showStatus('Сначала создайте или загрузите площадку.', 'error');
  const data = new FormData(elementForm);
  floor.plan.elements.push({
    id: crypto.randomUUID(),
    type: data.get('type'),
    name: data.get('name').trim(),
    x: numericValue(data, 'x'),
    y: numericValue(data, 'y'),
    width: numericValue(data, 'width'),
    height: numericValue(data, 'height'),
    rotation: numericValue(data, 'rotation'),
  });
  markDirty();
  render();
});

placeForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const floor = currentFloor();
  if (!floor) return showStatus('Сначала создайте или загрузите площадку.', 'error');
  const data = new FormData(placeForm);
  floor.places.push({
    id: crypto.randomUUID(),
    type: data.get('type'),
    name: data.get('name').trim(),
    category: data.get('category').trim(),
    description: data.get('description').trim(),
    x: numericValue(data, 'x'),
    y: numericValue(data, 'y'),
  });
  markDirty();
  render();
});

document.addEventListener('input', (event) => {
  const input = event.target.closest('[data-collection][data-field]');
  if (!input || !venue) return;
  const item = getCollection(currentFloor(), input.dataset.collection)[Number(input.dataset.index)];
  if (!item) return;
  item[input.dataset.field] = input.type === 'number' ? Number(input.value) : input.value;
  markDirty();
  renderPlan();
});

document.addEventListener('change', (event) => {
  const input = event.target.closest('[data-collection][data-field]');
  if (!input || !venue) return;
  const item = getCollection(currentFloor(), input.dataset.collection)[Number(input.dataset.index)];
  if (!item) return;
  item[input.dataset.field] = input.type === 'number' ? Number(input.value) : input.value;
  markDirty();
  render();
});

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-delete]');
  if (!button || !venue) return;
  const collection = button.dataset.delete;
  getCollection(currentFloor(), collection).splice(Number(button.dataset.index), 1);
  markDirty();
  render();
});

saveButton.addEventListener('click', async () => {
  if (!venue) return;
  try {
    const { body } = await request(`/api/venues/${encodeURIComponent(venue.id)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': `"${venue.revision}"`,
      },
      body: JSON.stringify({ name: venue.name, floors: venue.floors }),
    });
    venue = body;
    isDirty = false;
    render();
    showStatus('Сохранено на сервере. Теперь нажмите «Загрузить по ID» для проверки чтения.');
  } catch (error) {
    showStatus(error.message, 'error');
  }
});

render();