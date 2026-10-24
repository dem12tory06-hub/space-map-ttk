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
  root.innerHTML = `
    <div class="eyebrow">Площадка начинается с понятного пути</div>
    <h1>Осмотритесь.<br>Найдите своё место.</h1>
    <p class="intro">План помещений, интересные места и панорамы — в одной карте.</p>
    <div class="choices">
      <a class="choice" href="/map"><span class="number">01</span><h2>Посетителю</h2><p>Открыть карту площадки</p><span class="arrow" aria-hidden="true">↗</span></a>
      <a class="choice" href="/constructor"><span class="number">02</span><h2>Организатору</h2><p>Перейти к управлению картой</p><span class="arrow" aria-hidden="true">↗</span></a>
    </div>`;
} else {
  root.innerHTML = '<h1>Страница не найдена</h1><a href="/">На главную</a>';
}
