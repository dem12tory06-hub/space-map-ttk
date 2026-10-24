export function mountEditor(container) {
  if (!(container instanceof HTMLElement)) {
    throw new Error("Для редактора нужен HTML-элемент.");
  }

  const editor = document.createElement("div");
  editor.className = "editor";

  editor.innerHTML = `
    <header class="editor__header">
      <div>
        <p class="editor__eyebrow">Организатор</p>
        <h1>Редактор карты</h1>
        <p class="editor__subtitle">Подготовьте план и места для посетителей</p>
      </div>

      <div class="editor__save">
        <button type="button" disabled>Сохранить</button>
        <span>Сохранение пока не подключено</span>
      </div>
    </header>

    <div class="editor__workspace">
      <section class="editor__plan-section" aria-labelledby="editor-plan-title">
        <div class="editor__section-heading">
          <h2 id="editor-plan-title">План площадки</h2>
          <span>Один этаж</span>
        </div>

        <div class="editor__plan">
          <div class="editor__plan-message">
            <strong>Здесь появится план</strong>
            <span>Загрузка или рисование плана будет следующим шагом.</span>
          </div>
        </div>

        <p class="editor__hint">
          Места, точки панорам и узлы проходов будут отдельными объектами на плане.
        </p>
      </section>

      <aside class="editor__sidebar" aria-label="Инструменты редактора">
        <h2>Инструменты</h2>

        <div class="editor__tools">
          <button
            type="button"
            data-editor-panel="place"
            aria-pressed="true"
          >
            + Добавить место
          </button>
          <button
            type="button"
            data-editor-panel="panorama"
            aria-pressed="false"
          >
            + Добавить панораму
          </button>
        </div>

        <section class="editor__panel" data-panel="place">
          <h3>Новое место</h3>
          <p>Например, регистрация, зал или стойка информации.</p>

          <label for="editor-place-name">Название</label>
          <input
            id="editor-place-name"
            type="text"
            placeholder="Например, Регистрация"
          />

          <label for="editor-place-category">Категория</label>
          <input
            id="editor-place-category"
            type="text"
            placeholder="Например, Сервис"
          />

          <label for="editor-place-description">Описание</label>
          <textarea
            id="editor-place-description"
            rows="4"
            placeholder="Что посетителю нужно знать об этом месте?"
          ></textarea>

          <p class="editor__hint">
            Поля показывают будущую форму. Добавление на план подключим после
            согласования формата данных.
          </p>
        </section>

        <section
          class="editor__panel"
          data-panel="panorama"
          hidden
        >
          <h3>Точка панорамы</h3>
          <p>
            Здесь организатор выберет место съёмки на плане и привяжет
            панораму, подготовленную участником 3.
          </p>
          <p class="editor__hint">
            Загрузка и привязка пока не подключены.
          </p>
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

  // Участник 1 сможет вызвать эту функцию при смене экрана.
  return function unmountEditor() {
    editor.removeEventListener("click", handleToolClick);
    editor.remove();
  };
}
