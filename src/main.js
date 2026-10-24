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
};

if (window.location.pathname === '/constructor') {
  root.classList.remove('shell');
  const { mountConstructor } = await import('./constructor/constructor.js');
  mountConstructor(root);
} else if (/^\/map\/[^/]+$/.test(window.location.pathname)) {
  root.classList.remove('shell');
  const { mountVisitor } = await import('./visitor/visitor.js');
  let venueId;
  try { venueId = decodeURIComponent(window.location.pathname.slice(5)); }
  catch { venueId = ''; }
  mountVisitor(root, { venueId, demo: venueId === 'demo' });
} else if (window.location.pathname === '/editor/demo') {
  // У редактора своя адаптивная оболочка без ограничений стартового экрана.
  root.classList.remove('shell');
  const { mountEditor } = await import('./editor/editor.js');
  mountEditor(root);
} else {
  root.innerHTML = screens[window.location.pathname] ?? '<h1>Страница не найдена</h1><a href="/">На главную</a>';
}
