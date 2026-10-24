// Fixture in the existing venue input format. No alternate persistence model.
export const demoInput = {
  name: 'Демо · Пространство ТТК',
  floors: [{
    id: 'demo-floor', name: 'Первый этаж',
    plan: { id: 'demo-plan', width: 1, height: 1, elements: [
      { id: 'demo-zone', type: 'zone', name: 'Выставка', x: 0.1, y: 0.12, width: 0.5, height: 0.55, rotation: 0 },
      { id: 'demo-stage', type: 'stage', name: 'Сцена', x: 0.68, y: 0.15, width: 0.22, height: 0.3, rotation: 0 },
      { id: 'demo-table', type: 'table', name: 'Стол команды', x: 0.22, y: 0.3, width: 0.16, height: 0.12, rotation: 25 },
      { id: 'demo-stand', type: 'stand', name: 'Стенд ТТК', x: 0.45, y: 0.25, width: 0.1, height: 0.22, rotation: 0 },
      { id: 'demo-wall', type: 'partition', name: 'Перегородка', x: 0.65, y: 0.55, width: 0.26, height: 0.025, rotation: 0 },
    ] },
    places: [
      { id: 'demo-entry', type: 'entrance', name: 'Главный вход', category: 'Вход', description: 'Вход в пространство со стороны центральной площади.', x: 0.12, y: 0.85 },
      { id: 'demo-registration', type: 'registration', name: 'Регистрация', category: 'Помощь', description: 'Здесь можно получить бейдж и задать вопросы организаторам.', x: 0.3, y: 0.75 },
      { id: 'demo-talks', type: 'service', name: 'Выступления', category: 'Программа', description: 'Презентации команд на главной сцене.', x: 0.79, y: 0.3 },
      { id: 'demo-help', type: 'service', name: 'Информация', category: '', description: '', x: 0.5, y: 0.5 },
    ], panoramaPoints: [], routeNodes: [], routeEdges: [],
  }, {
    id: 'demo-floor-empty', name: 'Второй этаж · без мест',
    plan: { id: 'demo-plan-empty', width: 1, height: 1, elements: [] },
    places: [], panoramaPoints: [], routeNodes: [], routeEdges: [],
  }],
};
