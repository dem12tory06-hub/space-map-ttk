import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';

const elementTypes = new Set(['zone', 'table', 'stand', 'stage', 'partition']);
const placeTypes = new Set(['entrance', 'registration', 'service', 'wifi']);
const storeSchemaVersion = 1;
const planWidth = 1000;
const planHeight = 600;

export class VenueStoreError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'VenueStoreError';
    this.code = code;
  }
}

function invalid(message) {
  throw new VenueStoreError('invalid', message);
}

function requireObject(value, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    invalid(`${path} должен быть объектом.`);
  }
  return value;
}

function requireKeys(value, required, optional, path) {
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (!Object.hasOwn(value, key)) invalid(`${path}.${key} обязателен.`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) invalid(`Неизвестное поле ${path}.${key}.`);
  }
}

function requireString(value, path, maxLength, allowEmpty = false) {
  if (typeof value !== 'string') invalid(`${path} должен быть строкой.`);
  const result = value.trim();
  if ((!allowEmpty && result.length === 0) || result.length > maxLength) {
    invalid(`${path} должен содержать ${allowEmpty ? 'не более' : 'от 1 до'} ${maxLength} символов.`);
  }
  return result;
}

function requireId(value, path, usedIds) {
  const id = requireString(value, path, 80);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id)) invalid(`${path} имеет недопустимый формат.`);
  if (usedIds.has(id)) invalid(`Идентификатор ${id} повторяется.`);
  usedIds.add(id);
  return id;
}

function requireCoordinate(value, path, allowZero = true) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1 || (!allowZero && value === 0)) {
    invalid(`${path} должен быть числом от 0 до 1.`);
  }
  return value;
}

function validatePoint(value, path) {
  requireObject(value, path);
  requireKeys(value, ['x', 'y'], [], path);
  return {
    x: requireCoordinate(value.x, `${path}.x`),
    y: requireCoordinate(value.y, `${path}.y`),
  };
}

function validateElements(value, path, usedIds) {
  if (!Array.isArray(value) || value.length > 2000) invalid(`${path} должен быть массивом до 2000 объектов.`);
  return value.map((item, index) => {
    const itemPath = `${path}[${index}]`;
    requireObject(item, itemPath);
    requireKeys(item, ['id', 'type', 'name', 'x', 'y', 'width', 'height'], ['rotation'], itemPath);
    const type = requireString(item.type, `${itemPath}.type`, 24);
    if (!elementTypes.has(type)) invalid(`${itemPath}.type не поддерживается.`);
    if (typeof item.x !== 'number' || !Number.isFinite(item.x)) invalid(`${itemPath}.x должен быть конечным числом.`);
    if (typeof item.y !== 'number' || !Number.isFinite(item.y)) invalid(`${itemPath}.y должен быть конечным числом.`);
    const x = item.x;
    const y = item.y;
    const width = requireCoordinate(item.width, `${itemPath}.width`, false);
    const height = requireCoordinate(item.height, `${itemPath}.height`, false);
    const rotation = item.rotation === undefined ? 0 : item.rotation;
    if (typeof rotation !== 'number' || !Number.isFinite(rotation) || rotation < 0 || rotation >= 360) {
      invalid(`${itemPath}.rotation должен быть числом от 0 до 360.`);
    }
    const radians = rotation * Math.PI / 180;
    const pixelWidth = width * planWidth;
    const pixelHeight = height * planHeight;
    const centerX = x * planWidth + pixelWidth / 2;
    const centerY = y * planHeight + pixelHeight / 2;
    const boundsWidth = Math.abs(pixelWidth * Math.cos(radians)) + Math.abs(pixelHeight * Math.sin(radians));
    const boundsHeight = Math.abs(pixelWidth * Math.sin(radians)) + Math.abs(pixelHeight * Math.cos(radians));
    const edgeTolerance = 0.5;
    if (centerX - boundsWidth / 2 < -edgeTolerance || centerY - boundsHeight / 2 < -edgeTolerance
      || centerX + boundsWidth / 2 > planWidth + edgeTolerance
      || centerY + boundsHeight / 2 > planHeight + edgeTolerance) {
      invalid(`${itemPath}: визуальные границы элемента выходят за границы плана.`);
    }
    return {
      id: requireId(item.id, `${itemPath}.id`, usedIds),
      type,
      name: requireString(item.name, `${itemPath}.name`, 120),
      x,
      y,
      width,
      height,
      rotation,
    };
  });
}

function validatePlaces(value, path, usedIds) {
  if (!Array.isArray(value) || value.length > 2000) invalid(`${path} должен быть массивом до 2000 объектов.`);
  return value.map((item, index) => {
    const itemPath = `${path}[${index}]`;
    requireObject(item, itemPath);
    requireKeys(item, ['id', 'type', 'name', 'category', 'description', 'x', 'y'], ['wifiLogin', 'wifiPassword'], itemPath);
    const type = requireString(item.type, `${itemPath}.type`, 24);
    if (!placeTypes.has(type)) invalid(`${itemPath}.type не поддерживается.`);
    if (type !== 'wifi' && (Object.hasOwn(item, 'wifiLogin') || Object.hasOwn(item, 'wifiPassword'))) invalid(`${itemPath}: поля Wi-Fi допускаются только для точки Wi-Fi.`);
    return {
      id: requireId(item.id, `${itemPath}.id`, usedIds),
      type,
      name: requireString(item.name, `${itemPath}.name`, 120),
      category: requireString(item.category, `${itemPath}.category`, 80, true),
      description: requireString(item.description, `${itemPath}.description`, 2000, true),
      ...(type === 'wifi' ? {
        wifiLogin: requireString(item.wifiLogin ?? '', `${itemPath}.wifiLogin`, 120, true),
        wifiPassword: requireString(item.wifiPassword ?? '', `${itemPath}.wifiPassword`, 120, true),
      } : {}),
      ...validatePoint({ x: item.x, y: item.y }, itemPath),
    };
  });
}

function validatePanoramaPoints(value, path, usedIds) {
  if (!Array.isArray(value) || value.length > 1000) invalid(`${path} должен быть массивом до 1000 объектов.`);
  return value.map((item, index) => {
    const itemPath = `${path}[${index}]`;
    requireObject(item, itemPath);
    requireKeys(item, ['id', 'name', 'x', 'y'], [], itemPath);
    return {
      id: requireId(item.id, `${itemPath}.id`, usedIds),
      name: requireString(item.name, `${itemPath}.name`, 120),
      ...validatePoint({ x: item.x, y: item.y }, itemPath),
    };
  });
}

function validateRouteNodes(value, path, usedIds) {
  if (!Array.isArray(value) || value.length > 5000) invalid(`${path} должен быть массивом до 5000 узлов.`);
  return value.map((item, index) => {
    const itemPath = `${path}[${index}]`;
    requireObject(item, itemPath);
    requireKeys(item, ['id', 'name', 'x', 'y'], ['placeId'], itemPath);
    return {
      id: requireId(item.id, `${itemPath}.id`, usedIds),
      name: requireString(item.name, `${itemPath}.name`, 120),
      ...validatePoint({ x: item.x, y: item.y }, itemPath),
      ...(item.placeId === undefined || item.placeId === null
        ? {}
        : { placeId: requireString(item.placeId, `${itemPath}.placeId`, 80) }),
    };
  });
}

function validateRouteEdges(value, path, usedIds, routeNodes) {
  if (!Array.isArray(value) || value.length > 10000) invalid(`${path} должен быть массивом до 10000 связей.`);
  return value.map((item, index) => {
    const itemPath = `${path}[${index}]`;
    requireObject(item, itemPath);
    requireKeys(item, ['id', 'fromNodeId', 'toNodeId', 'points'], [], itemPath);
    if (!Array.isArray(item.points) || item.points.length > 1000) invalid(`${itemPath}.points должен быть массивом точек.`);
    const fromNodeId = requireString(item.fromNodeId, `${itemPath}.fromNodeId`, 80);
    const toNodeId = requireString(item.toNodeId, `${itemPath}.toNodeId`, 80);
    if (!routeNodes.has(fromNodeId) || !routeNodes.has(toNodeId) || fromNodeId === toNodeId) {
      invalid(`${itemPath} ссылается на недопустимые узлы маршрута.`);
    }
    return {
      id: requireId(item.id, `${itemPath}.id`, usedIds),
      fromNodeId,
      toNodeId,
      points: item.points.map((point, pointIndex) => validatePoint(point, `${itemPath}.points[${pointIndex}]`)),
    };
  });
}

function validateBackground(value, path, usedIds) {
  if (value === null) return null;
  requireObject(value, path);
  requireKeys(value, ['id', 'mediaType', 'width', 'height', 'visible', 'opacity'], ['placement'], path);
  if (!['image/jpeg', 'image/png'].includes(value.mediaType)) invalid(`${path}.mediaType не поддерживается.`);
  for (const field of ['width', 'height']) {
    if (!Number.isSafeInteger(value[field]) || value[field] < 1 || value[field] > 20000) {
      invalid(`${path}.${field} должен быть целым числом от 1 до 20000.`);
    }
  }
  if (value.width * value.height > 50_000_000) invalid(`${path} не должен превышать 50 мегапикселей.`);
  if (typeof value.visible !== 'boolean') invalid(`${path}.visible должен быть логическим значением.`);
  if (typeof value.opacity !== 'number' || !Number.isFinite(value.opacity) || value.opacity < 0 || value.opacity > 1) {
    invalid(`${path}.opacity должен быть числом от 0 до 1.`);
  }
  const background = {
    id: requireId(value.id, `${path}.id`, usedIds),
    mediaType: value.mediaType,
    width: value.width,
    height: value.height,
    visible: value.visible,
    opacity: value.opacity,
  };
  if (Object.hasOwn(value, 'placement')) {
    requireObject(value.placement, `${path}.placement`);
    requireKeys(value.placement, ['x', 'y', 'width', 'height'], [], `${path}.placement`);
    const placement = {
      x: requireCoordinate(value.placement.x, `${path}.placement.x`),
      y: requireCoordinate(value.placement.y, `${path}.placement.y`),
      width: requireCoordinate(value.placement.width, `${path}.placement.width`, false),
      height: requireCoordinate(value.placement.height, `${path}.placement.height`, false),
    };
    if (placement.x + placement.width > 1 || placement.y + placement.height > 1) {
      invalid(`${path}.placement выходит за границы плана.`);
    }
    const storedAspect = placement.width * 1000 / (placement.height * 600);
    const imageAspect = value.width / value.height;
    if (Math.abs(storedAspect - imageAspect) / imageAspect > 0.01) {
      invalid(`${path}.placement не сохраняет пропорции изображения.`);
    }
    background.placement = placement;
  }
  return background;
}

function validateFloors(value, usedIds) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
    invalid('floors должен содержать от 1 до 20 этажей.');
  }

  return value.map((floor, index) => {
    const path = `floors[${index}]`;
    requireObject(floor, path);
    requireKeys(floor, ['id', 'name', 'plan', 'places', 'panoramaPoints', 'routeNodes', 'routeEdges'], [], path);
    const id = requireId(floor.id, `${path}.id`, usedIds);
    requireObject(floor.plan, `${path}.plan`);
    requireKeys(floor.plan, ['id', 'width', 'height', 'elements'], ['background'], `${path}.plan`);
    const planId = requireId(floor.plan.id, `${path}.plan.id`, usedIds);
    const width = requireCoordinate(floor.plan.width, `${path}.plan.width`, false);
    const height = requireCoordinate(floor.plan.height, `${path}.plan.height`, false);
    const elements = validateElements(floor.plan.elements, `${path}.plan.elements`, usedIds);
    const places = validatePlaces(floor.places, `${path}.places`, usedIds);
    const panoramaPoints = validatePanoramaPoints(floor.panoramaPoints, `${path}.panoramaPoints`, usedIds);
    const routeNodes = validateRouteNodes(floor.routeNodes, `${path}.routeNodes`, usedIds);
    const routeNodeIds = new Set(routeNodes.map((node) => node.id));
    const placeIds = new Set([...places.map((place) => place.id),
      ...elements.filter((element) => ['zone', 'stand', 'stage'].includes(element.type)).map((element) => element.id)]);
    for (const node of routeNodes) {
      if (node.placeId && !placeIds.has(node.placeId)) invalid(`${path}.routeNodes содержит ссылку на недоступную точку маршрута.`);
    }
    const routeEdges = validateRouteEdges(floor.routeEdges, `${path}.routeEdges`, usedIds, routeNodeIds);
    const plan = { id: planId, width, height, elements };
    if (Object.hasOwn(floor.plan, 'background')) {
      plan.background = validateBackground(floor.plan.background, `${path}.plan.background`, usedIds);
    }
    return {
      id,
      name: requireString(floor.name, `${path}.name`, 120),
      plan,
      places,
      panoramaPoints,
      routeNodes,
      routeEdges,
    };
  });
}

function validateVenueInput(value) {
  requireObject(value, 'venue');
  requireKeys(value, ['name', 'floors'], [], 'venue');
  const usedIds = new Set();
  return {
    name: requireString(value.name, 'name', 120),
    floors: validateFloors(value.floors, usedIds),
  };
}

function validateStoredVenue(value) {
  requireObject(value, 'stored venue');
  requireKeys(value, ['id', 'name', 'revision', 'createdAt', 'updatedAt', 'floors'], [], 'stored venue');
  const venueInput = validateVenueInput({ name: value.name, floors: value.floors });
  if (!Number.isSafeInteger(value.revision) || value.revision < 1) invalid('revision хранилища повреждён.');
  for (const timestamp of [value.createdAt, value.updatedAt]) {
    if (typeof timestamp !== 'string' || Number.isNaN(Date.parse(timestamp))) invalid('Дата площадки в хранилище повреждена.');
  }
  const usedIds = new Set(venueInput.floors.flatMap((floor) => [floor.id, floor.plan.id,
    ...floor.plan.elements.map((item) => item.id), ...floor.places.map((item) => item.id),
    ...floor.panoramaPoints.map((item) => item.id), ...floor.routeNodes.map((item) => item.id),
    ...floor.routeEdges.map((item) => item.id)]));
  return {
    id: requireId(value.id, 'id', usedIds),
    name: venueInput.name,
    revision: value.revision,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    floors: venueInput.floors,
  };
}

function createEmptyFloor() {
  return {
    id: randomUUID(),
    name: 'Этаж 1',
    plan: { id: randomUUID(), width: 1, height: 1, elements: [] },
    places: [],
    panoramaPoints: [],
    routeNodes: [],
    routeEdges: [],
  };
}

export function createVenueStore(filePath) {
  let venues = new Map();
  let initialized = false;
  let initialization;
  let writeQueue = Promise.resolve();

  async function initialize() {
    if (initialized) return;
    if (!initialization) {
      initialization = (async () => {
        await mkdir(dirname(filePath), { recursive: true });
        try {
          const content = await readFile(filePath, 'utf8');
          const stored = JSON.parse(content);
          if (stored.schemaVersion !== storeSchemaVersion || !Array.isArray(stored.venues)) {
            throw new Error('Неизвестная версия файла площадок.');
          }
          venues = new Map(stored.venues.map((item) => {
            const venue = validateStoredVenue(item);
            return [venue.id, venue];
          }));
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
        initialized = true;
      })();
    }
    await initialization;
  }

  function enqueue(operation) {
    const result = writeQueue.then(operation);
    writeQueue = result.catch(() => {});
    return result;
  }

  async function persist(nextVenues) {
    const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    const content = JSON.stringify({ schemaVersion: storeSchemaVersion, venues: [...nextVenues.values()] }, null, 2);
    try {
      await writeFile(temporaryPath, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      await rename(temporaryPath, filePath);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => {});
      throw error;
    }
  }

  return {
    async initialize() {
      await initialize();
    },

    async get(id) {
      await initialize();
      const venue = venues.get(id);
      return venue ? structuredClone(venue) : null;
    },

    async create(name) {
      await initialize();
      const venueName = requireString(name, 'name', 120);
      return enqueue(async () => {
        const now = new Date().toISOString();
        const venue = {
          id: randomUUID(),
          name: venueName,
          revision: 1,
          createdAt: now,
          updatedAt: now,
          floors: [createEmptyFloor()],
        };
        const nextVenues = new Map(venues).set(venue.id, venue);
        await persist(nextVenues);
        venues = nextVenues;
        return structuredClone(venue);
      });
    },

    async replace(id, input, expectedRevision) {
      await initialize();
      const venueInput = validateVenueInput(input);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
        throw new VenueStoreError('precondition_required', 'Для обновления нужна текущая revision площадки.');
      }
      return enqueue(async () => {
        const existing = venues.get(id);
        if (!existing) throw new VenueStoreError('not_found', 'Площадка не найдена.');
        if (existing.revision !== expectedRevision) {
          throw new VenueStoreError('revision_conflict', 'Площадка уже изменена другим запросом. Загрузите её заново.');
        }
        const floors = venueInput.floors.map((floor) => {
          if (Object.hasOwn(floor.plan, 'background')) return floor;
          const existingFloor = existing.floors.find((entry) => entry.id === floor.id);
          return existingFloor?.plan.background
            ? { ...floor, plan: { ...floor.plan, background: existingFloor.plan.background } }
            : floor;
        });
        const now = new Date().toISOString();
        const venue = {
          id: existing.id,
          name: venueInput.name,
          revision: existing.revision + 1,
          createdAt: existing.createdAt,
          updatedAt: now,
          floors,
        };
        const nextVenues = new Map(venues).set(id, venue);
        await persist(nextVenues);
        venues = nextVenues;
        return structuredClone(venue);
      });
    },
  };
}
