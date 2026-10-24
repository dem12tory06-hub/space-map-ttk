export function mountEditor(container) {
  if (!(container instanceof HTMLElement)) {
    throw new Error("Для редактора нужен HTML-элемент.");
  }

  const editor = document.createElement("div");
  editor.className = "editor";

  editor.innerHTML = `
    <header class="editor__header">
      <div class="editor__heading">
        <p class="editor__eyebrow">Карта пространства / организатор</p>
        <h1>Редактор площадки</h1>
        <p class="editor__subtitle">Манеж ДГТУ · демонстрационный пример</p>
      </div>
      <div class="editor__save">
        <button type="button" disabled>Сохранить</button>
        <span>Сохранение пока не подключено</span>
      </div>
    </header>

    <div class="editor__workspace">
      <section class="editor__plan-section" aria-labelledby="editor-plan-title">
        <div class="editor__section-heading">
          <div>
            <p class="editor__eyebrow">Рабочее поле</p>
            <h2 id="editor-plan-title">План манежа</h2>
          </div>
          <span class="editor__badge">Эскиз · без сохранения</span>
        </div>

        <div class="editor__map-scroll" tabindex="0" role="region" aria-label="Демонстрационная схема манежа, прокручивается по горизонтали">
          <svg class="editor__map" viewBox="0 0 900 570" role="img" aria-labelledby="editor-map-title editor-map-desc">
            <title id="editor-map-title">Демонстрационная схема манежа ДГТУ</title>
            <desc id="editor-map-desc">Прямоугольный зал с овальной дорожкой, центральной зоной участников, зоной партнёров слева и местами обслуживания у входа. Положения требуют проверки на площадке.</desc>
            <rect x="28" y="32" width="844" height="456" rx="28" fill="#F5F4E8" stroke="#819184" stroke-width="3" />
            <rect x="128" y="101" width="645" height="308" rx="154" fill="#FAFAF5" stroke="#C5CEC0" stroke-width="25" />
            <rect x="128" y="101" width="645" height="308" rx="154" fill="none" stroke="#6F8275" stroke-width="2" />
            <rect x="159" y="132" width="583" height="246" rx="123" fill="none" stroke="#D8DFD2" stroke-width="2" />

            <rect x="264" y="162" width="385" height="186" rx="18" fill="#D3E892" stroke="#788E4F" stroke-width="2" />
            <text x="456" y="246" text-anchor="middle" class="editor__map-label">Зона участников</text>
            <text x="456" y="274" text-anchor="middle" class="editor__map-detail">Хакатон</text>

            <rect x="169" y="171" width="76" height="170" rx="10" fill="#D3E892" stroke="#788E4F" stroke-width="2" />
            <text x="207" y="234" text-anchor="middle" class="editor__map-small">Зона</text>
            <text x="207" y="257" text-anchor="middle" class="editor__map-small">партнёров</text>

            <rect x="340" y="45" width="204" height="50" rx="12" fill="#F0B88F" stroke="#A66B4B" stroke-width="2" />
            <text x="442" y="77" text-anchor="middle" class="editor__map-label">Сцена</text>

            <rect x="42" y="48" width="172" height="58" rx="12" fill="#F0B88F" stroke="#A66B4B" stroke-width="2" />
            <text x="128" y="83" text-anchor="middle" class="editor__map-small">Зона питания</text>

            <rect x="681" y="43" width="174" height="59" rx="12" fill="#F0B88F" stroke="#A66B4B" stroke-width="2" />
            <text x="768" y="78" text-anchor="middle" class="editor__map-small">Зона отдыха</text>

            <path d="M414 488 L414 530 M486 488 L486 530" fill="none" stroke="#819184" stroke-width="3" />
            <text x="450" y="553" text-anchor="middle" class="editor__map-small">Вход</text>

            <rect x="238" y="428" width="147" height="52" rx="12" fill="#E8D5A0" stroke="#9B8353" stroke-width="2" />
            <text x="311" y="461" text-anchor="middle" class="editor__map-small">Гардероб</text>

            <rect x="514" y="428" width="128" height="52" rx="12" fill="#E8D5A0" stroke="#9B8353" stroke-width="2" />
            <text x="578" y="461" text-anchor="middle" class="editor__map-small">WC</text>

            <circle cx="450" cy="445" r="19" fill="#E64938" stroke="#FFFFFF" stroke-width="5" />
            <circle cx="450" cy="445" r="5" fill="#FFFFFF" />
            <text x="450" y="416" text-anchor="middle" class="editor__map-small editor__map-selected">Регистрация · пример</text>
          </svg>
        </div>

        <div class="editor__legend" aria-label="Цвета зон демонстрационной схемы">
          <span><i class="editor__swatch editor__swatch--work" aria-hidden="true"></i>Рабочие зоны</span>
          <span><i class="editor__swatch editor__swatch--service" aria-hidden="true"></i>Сервисы</span>
          <span><i class="editor__swatch editor__swatch--rest" aria-hidden="true"></i>Сцена и отдых</span>
        </div>
        <p class="editor__hint">Это эскиз по материалам мероприятия. Уточните реальные стены, входы и проходы на площадке. Метки здесь пока нельзя перемещать или сохранять.</p>
      </section>

      <aside class="editor__sidebar" aria-label="Инструменты редактора">
        <p class="editor__eyebrow">Инструменты</p>
        <h2>Свойства объекта</h2>
        <div class="editor__tools" aria-label="Выбор панели свойств">
          <button type="button" data-editor-panel="place" aria-pressed="true">Место · поля</button>
          <button type="button" data-editor-panel="panorama" aria-pressed="false">Панорама · справка</button>
        </div>

        <section class="editor__panel" data-panel="place">
          <h3>Карточка места</h3>
          <p>Пример полей для места на карте. Данные пока не добавляются на план.</p>
          <label for="editor-place-name">Название</label>
          <input id="editor-place-name" type="text" placeholder="Например, Регистрация" />
          <label for="editor-place-category">Категория</label>
          <input id="editor-place-category" type="text" placeholder="Например, Сервис" />
          <label for="editor-place-description">Описание</label>
          <textarea id="editor-place-description" rows="4" placeholder="Что посетителю нужно знать об этом месте?"></textarea>
          <p class="editor__hint">Поля станут редактированием карты после подключения согласованного формата и сохранения.</p>
        </section>

        <section class="editor__panel" data-panel="panorama" hidden>
          <h3>Точка съёмки</h3>
          <p>Положение камеры на плане и файл панорамы — отдельный объект. Привязку результата участника 3 подключим после согласования данных.</p>
          <p class="editor__hint">Загрузка и привязка пока не подключены.</p>
        </section>
      </aside>
    </div>
  `;

  container.replaceChildren(editor);

  function handleToolClick(event) {
    const button = event.target.closest("[data-editor-panel]");
    if (!button || !editor.contains(button)) return;

    const selectedPanel = button.dataset.editorPanel;

    for (const tool of editor.querySelectorAll("[data-editor-panel]")) {
      tool.setAttribute(
        "aria-pressed",
        String(tool.dataset.editorPanel === selectedPanel),
      );
    }

    for (const panel of editor.querySelectorAll("[data-panel]")) {
      panel.hidden = panel.dataset.panel !== selectedPanel;
    }

    if (selectedPanel === "place") {
      editor.querySelector("#editor-place-name").focus();
    }
  }

  editor.addEventListener("click", handleToolClick);

  return function unmountEditor() {
    editor.removeEventListener("click", handleToolClick);
    editor.remove();
  };
}
