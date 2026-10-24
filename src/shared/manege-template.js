// Editable starting layout traced from the event reference, not a measured floor plan.
// Coordinates are fractions of the 1000 × 600 canvas.
export function manegeLayout(floor) {
  const element = (id, type, name, x, y, width, height, color) => ({
    id: `manege-${id}`, type, name, x, y, width, height, rotation: 0,
    ...(color ? { color } : {}),
  });
  const place = (id, type, name, x, y, description = '') => ({
    id: `manege-${id}`, type, name, category: '', description, x, y,
    ...(type === 'wifi' ? { wifiLogin: '', wifiPassword: '' } : {}),
  });
  return {
    ...floor,
    plan: {
      ...floor.plan,
      elements: [
        element('wall-top', 'partition', 'Верхняя стена', .07, .075, .84, .011),
        element('wall-left', 'partition', 'Левая стена', .07, .075, .008, .57),
        element('wall-right', 'partition', 'Правая стена', .902, .075, .008, .57),
        element('wall-bottom-left', 'partition', 'Нижняя стена слева', .07, .635, .38, .011),
        element('wall-bottom-right', 'partition', 'Нижняя стена справа', .57, .635, .34, .011),
        element('partners', 'zone', 'Зона партнёров', .17, .14, .105, .46, '#72c879'),
        element('participants', 'zone', 'Зона участников', .31, .20, .36, .33, '#667de2'),
        element('rest', 'zone', 'Зона отдыха', .755, .13, .12, .13, '#70cee5'),
        element('food', 'zone', 'Зона питания', .39, .84, .15, .105, '#edcf65'),
        element('stage', 'stage', 'Сцена', .42, .085, .10, .055, '#cf4d47'),
        element('stand-a', 'stand', 'Стенд A', .70, .23, .095, .075, '#bd9957'),
        element('stand-b', 'stand', 'Стенд B', .70, .41, .095, .075, '#bd9957'),
      ],
    },
    places: [
      place('entrance', 'entrance', 'Главный вход', .50, .69, 'Вход в манеж.'),
      place('registration', 'registration', 'Регистрация', .56, .79, 'Стойка регистрации у главного входа.'),
      place('wardrobe', 'service', 'Гардероб', .31, .79, 'Гардероб рядом со входом.'),
      place('wc', 'wc', 'WC', .43, .81, 'Туалет рядом с зоной регистрации.'),
      place('wifi', 'wifi', 'Wi-Fi', .64, .79),
      place('partners-entry', 'service', 'Партнёры', .29, .39, 'Вход в зону партнёров.'),
      place('participants-entry', 'service', 'Участники', .49, .37, 'Зона участников хакатона.'),
      place('rest-entry', 'service', 'Отдых', .84, .35, 'Вход в зону отдыха.'),
      place('food-entry', 'service', 'Питание', .46, .80, 'Вход в зону питания.'),
    ],
    panoramaPoints: [
      { id: 'manege-panorama-entrance', name: 'Панорама у входа', x: .50, y: .69, placeId: 'manege-entrance' },
      { id: 'manege-panorama-partners', name: 'Панорама зоны партнёров', x: .19, y: .28, placeId: 'manege-partners' },
    ],
  };
}
