// Один рабочий конструктор и просмотр существующей площадки по её ID.
const root = document.querySelector('#app');
const path = window.location.pathname;

if (path === '/constructor') {
  root.classList.remove('shell');
  const { mountConstructor } = await import('./constructor/constructor.js');
  mountConstructor(root);
} else if (/^\/map\/[^/]+$/.test(path)) {
  root.classList.remove('shell');
  const venueId = decodeURIComponent(path.slice('/map/'.length));
  const [{ mountVisitorShell }, { mountVisitorMap }] = await Promise.all([
    import('./visitor/visitor-shell.js'),
    import('./visitor/visitor-map.js'),
  ]);
  mountVisitorShell(root, (slot) => mountVisitorMap(slot, venueId));
} else if (path === '/map') {
  root.innerHTML = `
    <a class="back" href="/">← На главную</a>
    <div class="eyebrow">Для посетителя</div>
    <h1>Откройте план площадки</h1>
    <p class="intro">Введите ID площадки из ссылки организатора.</p>
    <form id="venue-link-form">
      <label for="venue-link-id">ID площадки</label>
      <input id="venue-link-id" name="venue" required autocomplete="off">
      <button type="submit">Открыть карту</button>
    </form>`;
  root.querySelector('#venue-link-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const id = new FormData(event.currentTarget).get('venue').trim();
    if (id) window.location.assign(`/map/${encodeURIComponent(id)}`);
  });
} else if (path === '/') {
  document.body.classList.add('home-page');
  root.innerHTML = `
    <section class="home-hero" aria-labelledby="home-title">
      <div class="home-event"><span>Хакатон Осень 2026</span><span>23–25 октября</span></div>
      <div class="home-hero__content">
        <div class="home-copy">
          <p class="home-eyebrow">Карта пространства</p>
          <h1 id="home-title">Манеж рядом.<br><em>Путь понятен.</em></h1>
          <p>Найдите регистрацию, зону участников и нужное место на плане манежа. Откройте карту прямо на телефоне.</p>
          <div class="home-venue"><span class="home-venue__icon" aria-hidden="true">⌖</span><span><strong>Манеж ДГТУ</strong><small>Ростов-на-Дону · Юфимцева, 16</small></span></div>
        </div>
        <div class="home-actions">
          <a class="home-map-link" href="/map" aria-label="Для посетителя: открыть карту площадки">
            <span class="home-map-link__dots" aria-hidden="true">•••</span>
            <span class="home-map-link__label" aria-hidden="true">КАРТА / МАНЕЖ</span>
            <svg class="home-map-link__route" viewBox="0 0 280 190" aria-hidden="true"><path d="M40 145 C65 100 135 155 145 83 S205 100 245 42"/><circle cx="40" cy="145" r="10"/><circle cx="245" cy="42" r="10"/></svg>
            <strong>Для<br>посетителя ↗</strong><small>Открыть карту площадки</small>
          </a>
          <a class="home-organizer-link" href="/constructor">Для организатора ↗</a>
        </div>
      </div>
    </section>`;
} else {
  root.innerHTML = '<h1>Страница не найдена</h1><a href="/">На главную</a>';
}
