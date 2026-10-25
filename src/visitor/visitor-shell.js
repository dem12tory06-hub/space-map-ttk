// Визуальная оболочка экрана посетителя. mountMap — функция участника 3,
// которая рисует настоящую карту в переданном ей элементе и сохраняет свои обработчики.
export function mountVisitorShell(container, mountMap) {
  if (!(container instanceof HTMLElement)) {
    throw new Error("Для экрана посетителя нужен HTML-элемент.");
  }

  const view = document.createElement("div");
  view.className = "visitor-shell";
  view.innerHTML = `
    <svg class="visitor-shell__wires" viewBox="0 0 1200 900" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="visitor-wave-gradient" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#D9ED98" />
          <stop offset="34%" stop-color="#E8D885" />
          <stop offset="66%" stop-color="#AFC477" />
          <stop offset="100%" stop-color="#D9ED98" />
        </linearGradient>
      </defs>
      <g class="visitor-shell__wave">
        <ellipse cx="-22" cy="15" rx="235" ry="410" /><ellipse cx="-22" cy="15" rx="262" ry="438" />
        <ellipse cx="-22" cy="15" rx="289" ry="466" /><ellipse cx="-22" cy="15" rx="316" ry="494" />
        <ellipse cx="-22" cy="15" rx="343" ry="522" /><ellipse cx="-22" cy="15" rx="370" ry="550" />
        <ellipse cx="1070" cy="665" rx="205" ry="245" /><ellipse cx="1070" cy="665" rx="232" ry="273" />
        <ellipse cx="1070" cy="665" rx="259" ry="301" /><ellipse cx="1070" cy="665" rx="286" ry="329" />
        <ellipse cx="1070" cy="665" rx="313" ry="357" /><ellipse cx="1070" cy="665" rx="340" ry="385" />
      </g>
      <g class="visitor-shell__spark">
        <path d="M328 308 l3 -11 M340 311 l9 -7" />
        <path d="M827 460 l2 -9 M838 465 l8 -5" />
      </g>
    </svg>

    <div class="visitor-shell__inner">
      <nav class="visitor-shell__nav" aria-label="Навигация посетителя">
        <a class="visitor-shell__back" href="/"><span aria-hidden="true">←</span> На главную</a>
        <a class="visitor-shell__role" href="/map" aria-current="page"><span class="visitor-shell__role-mark" aria-hidden="true">⌖</span> Посетителю</a>
        <span class="visitor-shell__venue">Площадка</span>
      </nav>

      <header class="visitor-shell__heading">
        <p>Путеводитель / площадка</p>
        <h1>Карта площадки</h1>
      </header>

      <section class="visitor-shell__device" aria-label="Карта площадки">
        <div class="visitor-shell__screen">
          <div class="visitor-shell__screenbar"><span>Карта</span><span class="visitor-shell__screen-venue">Площадка</span></div>
          <div class="visitor-shell__map-slot" data-visitor-map-slot>
            <div class="visitor-shell__empty" role="status">
              <span class="visitor-shell__empty-icon" aria-hidden="true">⌖</span>
              <strong>Опубликованной карты пока нет</strong>
              <span>План и места появятся здесь после публикации организатором.</span>
            </div>
          </div>
        </div>
      </section>
      <p class="visitor-shell__hint">Экран посетителя · пространство карты занимает центр страницы.</p>
    </div>
  `;

  container.replaceChildren(view);
  const mapSlot = view.querySelector("[data-visitor-map-slot]");
  let cleanupMap;
  if (typeof mountMap === "function") {
    mapSlot.replaceChildren();
    cleanupMap = mountMap(mapSlot);
  }

  return function unmountVisitorShell() {
    if (typeof cleanupMap === "function") cleanupMap();
    view.remove();
  };
}
