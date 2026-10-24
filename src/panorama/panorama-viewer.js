let pannellumPromise;

function loadPannellum() {
  if (window.pannellum) return Promise.resolve(window.pannellum);
  if (!pannellumPromise) {
    pannellumPromise = new Promise((resolve, reject) => {
      const style = document.createElement('link');
      style.rel = 'stylesheet';
      style.href = 'https://cdn.jsdelivr.net/npm/pannellum@2.5.7/build/pannellum.css';
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/pannellum@2.5.7/build/pannellum.js';
      script.onload = () => window.pannellum ? resolve(window.pannellum) : reject(new Error('Просмотрщик не загрузился.'));
      script.onerror = () => reject(new Error('Не удалось загрузить просмотрщик панорамы.'));
      document.head.append(style, script);
    }).catch((error) => {
      pannellumPromise = null;
      throw error;
    });
  }
  return pannellumPromise;
}

export async function openPanorama(container, panoramaPoints, firstId, places) {
  const scenes = panoramaPoints.filter((point) => point.imageUrl);
  if (!scenes.some((point) => point.id === firstId)) return;
  const previousFocus = document.activeElement;
  const overlay = document.createElement('div');
  overlay.className = 'panorama-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Осмотр панорамы');
  overlay.innerHTML = `
    <div class="panorama-overlay__bar">
      <button type="button" data-close>← К карте</button>
      <strong data-title></strong>
      <button type="button" data-location>Где я на плане?</button>
    </div>
    <div class="panorama-overlay__viewer" data-viewer></div>
    <div class="panorama-overlay__info" data-info role="status" hidden></div>
  `;
  document.body.append(overlay);
  const title = overlay.querySelector('[data-title]');
  const info = overlay.querySelector('[data-info]');
  const closeButton = overlay.querySelector('[data-close]');
  const previousOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  let viewer = null;
  let closed = false;
  let currentId = firstId;

  function close() {
    if (closed) return;
    closed = true;
    viewer?.destroy();
    overlay.remove();
    document.body.style.overflow = previousOverflow;
    window.removeEventListener('keydown', onKeydown);
    previousFocus?.focus?.();
  }
  function onKeydown(event) {
    if (event.key === 'Escape') close();
  }
  window.addEventListener('keydown', onKeydown);
  closeButton.addEventListener('click', close);
  closeButton.focus();
  overlay.querySelector('[data-location]').addEventListener('click', () => {
    const point = scenes.find((item) => item.id === currentId);
    info.hidden = false;
    info.textContent = `На плане открыта точка «${point.name}». Она отмечена бирюзовым значком. Вернитесь к карте, чтобы увидеть маршрут.`;
  });

  try {
    const pannellum = await loadPannellum();
    if (closed) return;
    const sceneConfig = {};
    for (const point of scenes) {
      const hotSpots = [];
      for (const marker of point.hotspots ?? []) {
        const place = places.find((item) => item.id === marker.placeId);
        if (!place) continue;
        hotSpots.push({
          pitch: marker.pitch, yaw: marker.yaw, type: 'info', text: place.name,
          clickHandlerFunc: () => {
            info.hidden = false;
            info.textContent = `${place.name}: ${place.description || place.category || 'Описание пока не добавлено.'}`;
          },
        });
      }
      for (const link of point.links ?? []) {
        const next = scenes.find((item) => item.id === link.toPanoramaId);
        if (next) hotSpots.push({
          pitch: link.pitch, yaw: link.yaw, type: 'scene', sceneId: next.id,
          text: `Перейти: ${next.name}`,
        });
      }
      const stitched = /^\/api\/panoramas\/[a-f0-9]{32}\.jpg$/.test(point.imageUrl);
      const haov = stitched ? Math.min(point.haov ?? 180, 180) : (point.haov ?? 360);
      const vaov = stitched ? Math.min(point.vaov ?? 120, 120) : (point.vaov ?? 180);
      sceneConfig[point.id] = {
        type: 'equirectangular', panorama: point.imageUrl, title: point.name,
        haov, vaov, vOffset: point.vOffset ?? 0,
        // OpenCV stitches a partial view. Stop rotation at its photographed edges.
        ...(stitched ? {
          minYaw: -haov / 2, maxYaw: haov / 2,
          minPitch: -vaov / 2, maxPitch: vaov / 2,
          hfov: 65, maxHfov: 75, ignoreGPanoXMP: true,
        } : {}),
        avoidShowingBackground: true, autoLoad: true, hotSpots,
      };
    }
    viewer = pannellum.viewer(overlay.querySelector('[data-viewer]'), {
      default: { firstScene: firstId, sceneFadeDuration: 500, escapeHTML: true },
      scenes: sceneConfig,
    });
    title.textContent = scenes.find((item) => item.id === firstId).name;
    viewer.on('scenechange', (id) => {
      currentId = id;
      title.textContent = scenes.find((item) => item.id === id)?.name ?? 'Панорама';
      info.hidden = true;
    });
  } catch (error) {
    if (!closed) {
      info.hidden = false;
      info.textContent = error.message;
    }
  }
}
