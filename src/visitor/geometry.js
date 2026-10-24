// The constructor and background validator use this canvas, even when plan.width/height are 1.
export const PLAN_WIDTH = 1000;
export const PLAN_HEIGHT = 600;

export function backgroundRect(background) {
  let placement = background.placement;
  if (!placement) {
    const aspect = background.width / background.height;
    const width = Math.min(PLAN_WIDTH, PLAN_HEIGHT * aspect);
    const height = width / aspect;
    placement = { x: (PLAN_WIDTH - width) / 2 / PLAN_WIDTH, y: (PLAN_HEIGHT - height) / 2 / PLAN_HEIGHT,
      width: width / PLAN_WIDTH, height: height / PLAN_HEIGHT };
  }
  return { x: placement.x * PLAN_WIDTH, y: placement.y * PLAN_HEIGHT,
    width: placement.width * PLAN_WIDTH, height: placement.height * PLAN_HEIGHT };
}

export function planBounds(elements) {
  const xs = [0, PLAN_WIDTH], ys = [0, PLAN_HEIGHT];
  for (const item of elements) {
    const w = item.width * PLAN_WIDTH, h = item.height * PLAN_HEIGHT;
    const cx = item.x * PLAN_WIDTH + w / 2, cy = item.y * PLAN_HEIGHT + h / 2;
    const angle = (item.rotation ?? 0) * Math.PI / 180;
    for (const dx of [-w / 2, w / 2]) for (const dy of [-h / 2, h / 2]) {
      xs.push(cx + dx * Math.cos(angle) - dy * Math.sin(angle));
      ys.push(cy + dx * Math.sin(angle) + dy * Math.cos(angle));
    }
  }
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

export function fitCamera(width, height, bounds) {
  const scale = Math.max(0.01, Math.min((width - 56) / bounds.width, (height - 56) / bounds.height));
  return { scale, x: (width - bounds.width * scale) / 2 - bounds.x * scale,
    y: (height - bounds.height * scale) / 2 - bounds.y * scale };
}

export function zoomCamera(camera, scale, anchor) {
  const ratio = scale / camera.scale;
  return { scale, x: anchor.x - (anchor.x - camera.x) * ratio, y: anchor.y - (anchor.y - camera.y) * ratio };
}
