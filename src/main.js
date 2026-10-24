// Владелец: участник 1. Подключение экранов организатора и посетителя.
const root = document.querySelector('#app');

const screens = {
  '/': `
    <div class="eyebrow">Площадка начинается с понятного пути</div>
    <h1>Осмотритесь.<br>Найдите своё место.</h1>
    <p class="intro">План помещений, интересные места и панорамы — в одной карте.</p>
    <div class="choices">
      <a class="choice" href="/map/demo"><span class="number">01</span><h2>Посетителю</h2><p>Открыть карту площадки</p><span class="arrow" aria-hidden="true">↗</span></a>
      <a class="choice" href="/editor/demo"><span class="number">02</span><h2>Организатору</h2><p>Перейти к управлению картой</p><span class="arrow" aria-hidden="true">↗</span></a>
    </div>
    <p class="notice">Начальная версия проекта. Карта площадки ещё не опубликована.</p>`,
  '/map/demo': `
    <a class="back" href="/">← На главную</a><div class="eyebrow">Посетителю</div>
    <h1>Карта готовится.</h1>
    <p class="intro">План площадки, места и панорамы появятся после публикации карты организатором.</p>
    <div class="empty"><span class="empty-mark" aria-hidden="true">⌖</span><p>Опубликованной карты пока нет</p></div>`,
};

if (window.location.pathname === '/constructor') {
  root.classList.remove('shell');
  const { mountConstructor } = await import('./constructor/constructor.js');
  mountConstructor(root);
} else if (/^\/map\/[^/]+$/.test(window.location.pathname) && window.location.pathname !== '/map/demo') {
  root.innerHTML = `
    <a class="back" href="/">← На главную</a>
    <div class="eyebrow">Для посетителя</div>
    <h1>Просмотр площадки ещё не подключён.</h1>
    <p class="intro">Ссылка ведёт на площадку, но компонент просмотра готовит участник 2.</p>`;
} else if (window.location.pathname === '/editor/demo') {
  // У редактора своя адаптивная оболочка без ограничений стартового экрана.
  root.classList.remove('shell');
  const { mountEditor } = await import('./editor/editor.js');
  mountEditor(root);
} else {
  root.innerHTML = screens[window.location.pathname] ?? '<h1>Страница не найдена</h1><a href="/">На главную</a>';
}
