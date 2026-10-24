// Route endpoints include places, stands and stages. A zone marks a large
// area; use a place at its entrance to route visitors there.
// Coordinates are always normalized to the 1000 × 600 plan.
export function navigationTargets(floor) {
  return [
    ...(floor.places ?? []).map((place) => ({
      id: place.id, name: place.name, x: place.x, y: place.y,
      description: place.type === 'wifi' && (place.wifiLogin || place.wifiPassword)
        ? `Логин (сеть): ${place.wifiLogin || 'не указан'}\nПароль: ${place.wifiPassword || 'не указан'}`
        : place.description || place.category || 'Описание пока не добавлено.',
      kind: 'place', type: place.type,
    })),
    ...(floor.plan?.elements ?? []).filter((element) => ['stand', 'stage'].includes(element.type)).map((element) => ({
      id: element.id, name: element.name,
      x: element.x + element.width / 2, y: element.y + element.height / 2,
      description: `${navigationLabel(element)} на плане площадки.`, kind: 'element', type: element.type,
    })),
  ];
}

export function navigationLabel(target) {
  return {
    zone: 'Зона', stand: 'Стенд', stage: 'Сцена',
    entrance: 'Вход', registration: 'Регистрация', wifi: 'Wi-Fi', wc: 'WC', service: 'Место',
  }[target.type] ?? 'Место';
}

export function navigationDisplayName(target) {
  const label = navigationLabel(target);
  const name = String(target.name ?? '').trim();
  return !name || name.toLocaleLowerCase() === label.toLocaleLowerCase() ? label : `${label}: ${name}`;
}
