"""Local UI preview only. The production service remains server/index.js."""
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
import json
import mimetypes
import os
import re
import struct
import uuid

ROOT = Path(__file__).resolve().parent
PREVIEW_DATA = ROOT / 'data' / 'preview'
PREVIEW_FILE = PREVIEW_DATA / 'venues.json'
BACKGROUND_DIR = PREVIEW_DATA / 'backgrounds'
PANORAMA_DIR = PREVIEW_DATA / 'panoramas'
WORKER_URL = os.environ.get('STITCH_SERVICE_URL', 'http://127.0.0.1:5000')
VENUES = json.loads(PREVIEW_FILE.read_text(encoding='utf-8')) if PREVIEW_FILE.exists() else {}


def persist():
    PREVIEW_DATA.mkdir(parents=True, exist_ok=True)
    temporary = PREVIEW_FILE.with_suffix('.tmp')
    temporary.write_text(json.dumps(VENUES, ensure_ascii=False), encoding='utf-8')
    temporary.replace(PREVIEW_FILE)


def image_size(data, mime):
    if mime == 'image/png' and data[:8] == b'\x89PNG\r\n\x1a\n' and len(data) >= 24:
        return struct.unpack('>II', data[16:24])
    if mime == 'image/jpeg' and data.startswith(b'\xff\xd8'):
        index = 2
        while index < len(data) - 9:
            if data[index] != 255:
                index += 1
                continue
            marker = data[index + 1]
            index += 2
            if marker in (0xD8, 0xD9, 0x01) or 0xD0 <= marker <= 0xD7:
                continue
            if index + 2 > len(data): break
            size = int.from_bytes(data[index:index + 2], 'big')
            if size < 2 or index + size > len(data): break
            if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB):
                return (int.from_bytes(data[index + 5:index + 7], 'big'),
                        int.from_bytes(data[index + 3:index + 5], 'big'))
            index += size
    raise ValueError('Ожидается корректное изображение JPG или PNG.')


def background_placement(width, height):
    ratio = width / height
    plan_ratio = 1000 / 600
    w = 1 if ratio >= plan_ratio else ratio / plan_ratio
    h = plan_ratio / ratio if ratio >= plan_ratio else 1
    return {'x': (1 - w) / 2, 'y': (1 - h) / 2, 'width': w, 'height': h}


def stamp():
    return datetime.now(timezone.utc).isoformat()


class Preview(BaseHTTPRequestHandler):
    def reply(self, status, body, content_type='application/json; charset=utf-8', headers=None):
        data = body if isinstance(body, bytes) else body.encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(data)

    def error_json(self, status, code, message):
        self.reply(status, json.dumps({'error': code, 'message': message}, ensure_ascii=False))

    def body_json(self):
        size = int(self.headers.get('Content-Length', '0'))
        if size > 1024 * 1024 or size < 1:
            raise ValueError('Ожидается JSON размером до 1 МБ.')
        return json.loads(self.rfile.read(size))

    def authorized(self):
        if self.headers.get('Authorization') != 'Bearer preview':
            self.error_json(401, 'unauthorized', 'Для локального предпросмотра введите ключ preview.')
            return False
        return True

    def do_GET(self):
        path = unquote(urlsplit(self.path).path)
        parts = path.strip('/').split('/')
        if len(parts) == 3 and parts[:2] == ['api', 'panoramas']:
            name = parts[2]
            if not re.fullmatch(r'[a-f0-9]{32}\.jpg', name):
                return self.error_json(404, 'not_found', 'Панорама не найдена.')
            image = PANORAMA_DIR / name
            if not image.is_file():
                return self.error_json(404, 'not_found', 'Панорама не найдена.')
            return self.reply(200, image.read_bytes(), 'image/jpeg')
        if len(parts) == 7 and parts[:2] == ['api', 'venues'] and parts[3] == 'floors' and parts[5] == 'background':
            venue = VENUES.get(parts[2])
            floor = next((f for f in venue.get('floors', []) if f['id'] == parts[4]), None) if venue else None
            bg = floor.get('plan', {}).get('background') if floor else None
            file = BACKGROUND_DIR / parts[2] / parts[6]
            if not bg or bg['id'] != parts[6] or not file.is_file():
                return self.error_json(404, 'not_found', 'Подложка не найдена.')
            return self.reply(200, file.read_bytes(), bg['mediaType'])
        if path.startswith('/api/venues/'):
            venue = VENUES.get(path.removeprefix('/api/venues/'))
            if not venue:
                return self.error_json(404, 'not_found', 'Площадка не найдена.')
            return self.reply(200, json.dumps(venue, ensure_ascii=False))
        if path in ('/map/demo', '/editor/demo'):
            return self.reply(302, b'', headers={'Location': '/map' if path == '/map/demo' else '/constructor'})
        if path == '/' or path in ('/map', '/constructor') or (path.startswith('/map/') and path.count('/') == 2):
            file = ROOT / 'index.html'
        elif path == '/panorama-capture':
            file = ROOT / 'server' / 'panorama-capture.html'
        elif path.startswith(('/src/', '/test/')):
            file = (ROOT / path.lstrip('/')).resolve()
            if not file.is_relative_to(ROOT / 'src') and not file.is_relative_to(ROOT / 'test'):
                return self.error_json(404, 'not_found', 'Файл не найден.')
        else:
            return self.error_json(404, 'not_found', 'Страница не найдена.')
        if not file.is_file():
            return self.error_json(404, 'not_found', 'Файл не найден.')
        mime = mimetypes.guess_type(file.name)[0] or 'application/octet-stream'
        if file.suffix == '.js':
            mime = 'text/javascript'
        return self.reply(200, file.read_bytes(), f'{mime}; charset=utf-8')

    def do_POST(self):
        parts = urlsplit(self.path).path.strip('/').split('/')
        if len(parts) == 8 and parts[:2] == ['api', 'venues'] and parts[3] == 'floors' and parts[5] == 'targets' and parts[7] == 'stitch':
            return self.stitch_panorama(parts[2], parts[4], parts[6])
        if urlsplit(self.path).path != '/api/venues':
            return self.error_json(404, 'not_found', 'Страница не найдена.')
        if not self.authorized():
            return
        try:
            name = self.body_json()['name'].strip()
            if not name:
                raise ValueError('Укажите название площадки.')
        except (ValueError, KeyError, TypeError, json.JSONDecodeError) as error:
            return self.error_json(400, 'invalid_data', str(error))
        venue_id = str(uuid.uuid4())
        venue = {
            'id': venue_id, 'name': name, 'revision': 1,
            'createdAt': stamp(), 'updatedAt': stamp(),
            'floors': [{
                'id': str(uuid.uuid4()), 'name': 'План',
                'plan': {'id': str(uuid.uuid4()), 'width': 1, 'height': 1, 'elements': []},
                'places': [], 'panoramaPoints': [], 'routeNodes': [], 'routeEdges': [],
            }],
        }
        VENUES[venue_id] = venue
        persist()
        self.reply(201, json.dumps(venue, ensure_ascii=False))

    def stitch_panorama(self, venue_id, floor_id, target_id):
        if not self.authorized(): return
        venue = VENUES.get(venue_id)
        floor = next((item for item in venue['floors'] if item['id'] == floor_id), None) if venue else None
        if not floor: return self.error_json(404, 'not_found', 'План не найден.')
        point = next((item for item in floor['panoramaPoints'] if item['id'] == target_id), None)
        place = next((item for item in floor['places'] if item['id'] == target_id), None)
        element = next((item for item in floor['plan']['elements'] if item['id'] == target_id and item['type'] in ('zone', 'stand', 'stage')), None)
        target = point or place or element
        if not target: return self.error_json(404, 'not_found', 'Точка съёмки не найдена.')
        if self.headers.get('If-Match') != f'"{venue["revision"]}"':
            return self.error_json(412, 'revision_conflict', 'Карта изменилась. Обновите страницу съёмки.')
        content_type = self.headers.get('Content-Type', '')
        size = int(self.headers.get('Content-Length', '0'))
        if not content_type.startswith('multipart/form-data;'):
            return self.error_json(415, 'unsupported_media_type', 'Ожидаются фотографии из формы.')
        if not 0 < size <= 150 * 1024 * 1024:
            return self.error_json(413, 'request_too_large', 'Серия должна быть не больше 150 МБ.')
        original_revision = venue['revision']
        body = self.rfile.read(size)
        url = f'{WORKER_URL}/api/stitch?pointId={quote(target_id)}&pointName={quote(target["name"])}'
        try:
            with urlopen(Request(url, data=body, headers={'Content-Type': content_type}, method='POST'), timeout=190) as response:
                result = json.load(response)
        except HTTPError as error:
            try: message = json.load(error).get('error', 'Не удалось собрать панораму.')
            except (ValueError, AttributeError): message = 'Не удалось собрать панораму.'
            return self.error_json(error.code if error.code in (400, 413, 422) else 502, 'stitch_failed', message)
        except (URLError, TimeoutError, ValueError):
            return self.error_json(502, 'stitch_unavailable', 'Сервер склейки недоступен. Запустите start-panorama-worker-windows.cmd в отдельном окне и оставьте его открытым.')
        name = result.get('filename', '')
        if not re.fullmatch(r'[a-f0-9]{32}\.jpg', name) or not (PANORAMA_DIR / name).is_file():
            return self.error_json(502, 'invalid_stitch_result', 'Склейка не сохранила итоговый JPEG.')
        if venue['revision'] != original_revision:
            (PANORAMA_DIR / name).unlink(missing_ok=True)
            return self.error_json(412, 'revision_conflict', 'Карта изменилась во время склейки.')
        if not point:
            if place:
                x, y = place['x'], place['y']
            else:
                x, y = element['x'] + element['width'] / 2, element['y'] + element['height'] / 2
            point = next((item for item in floor['panoramaPoints'] if item.get('placeId') == target_id), None)
            if not point:
                point = {'id': str(uuid.uuid4()), 'name': target['name'], 'x': x, 'y': y, 'placeId': target_id}
                floor['panoramaPoints'].append(point)
        point.update(imageUrl=f'/api/panoramas/{name}', haov=180, vaov=120)
        venue['revision'] += 1
        venue['updatedAt'] = stamp()
        persist()
        self.reply(200, json.dumps({**result, 'imageUrl': point['imageUrl'], 'revision': venue['revision'], 'pointId': point['id']}, ensure_ascii=False))

    def do_PUT(self):
        path = urlsplit(self.path).path
        parts = path.strip('/').split('/')
        if len(parts) == 6 and parts[:2] == ['api', 'venues'] and parts[3] == 'floors' and parts[5] == 'background':
            if not self.authorized(): return
            venue = VENUES.get(parts[2])
            if not venue: return self.error_json(404, 'not_found', 'Площадка не найдена.')
            floor = next((f for f in venue['floors'] if f['id'] == parts[4]), None)
            if not floor: return self.error_json(404, 'not_found', 'План не найден.')
            if self.headers.get('If-Match') != f'"{venue["revision"]}"':
                return self.error_json(412, 'revision_conflict', 'Площадка уже изменилась.')
            mime = self.headers.get('Content-Type', '').split(';')[0]
            if mime not in ('image/jpeg', 'image/png'):
                return self.error_json(415, 'unsupported_media_type', 'Выберите JPG или PNG.')
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 10 * 1024 * 1024:
                return self.error_json(413, 'request_too_large', 'Подложка должна быть не больше 10 МБ.')
            data = self.rfile.read(size)
            try:
                width, height = image_size(data, mime)
                if not 0 < width <= 20000 or not 0 < height <= 20000: raise ValueError('Размеры изображения не поддерживаются.')
            except ValueError as error:
                return self.error_json(400, 'invalid_image', str(error))
            previous = floor['plan'].get('background')
            bg = {'id': str(uuid.uuid4()), 'mediaType': mime, 'width': width, 'height': height,
                  'visible': previous.get('visible', True) if previous else True,
                  'opacity': previous.get('opacity', 1) if previous else 1,
                  'placement': background_placement(width, height)}
            folder = BACKGROUND_DIR / parts[2]
            folder.mkdir(parents=True, exist_ok=True)
            (folder / bg['id']).write_bytes(data)
            floor['plan']['background'] = bg
            venue['revision'] += 1
            venue['updatedAt'] = stamp()
            persist()
            if previous: (folder / previous['id']).unlink(missing_ok=True)
            return self.reply(200, json.dumps(venue, ensure_ascii=False))
        if not path.startswith('/api/venues/') or '/' in path.removeprefix('/api/venues/'):
            return self.error_json(404, 'not_found', 'Площадка не найдена.')
        if not self.authorized():
            return
        venue = VENUES.get(path.removeprefix('/api/venues/'))
        if not venue:
            return self.error_json(404, 'not_found', 'Площадка не найдена.')
        if self.headers.get('If-Match') != f'"{venue["revision"]}"':
            return self.error_json(412, 'revision_conflict', 'Площадка уже изменилась.')
        try:
            body = self.body_json()
            if not isinstance(body['floors'], list) or not body['floors']:
                raise ValueError('План не указан.')
            name = body['name'].strip()
            if not name:
                raise ValueError('Название не указано.')
        except (ValueError, KeyError, TypeError, json.JSONDecodeError) as error:
            return self.error_json(400, 'invalid_data', str(error))
        venue.update(name=name, floors=body['floors'], revision=venue['revision'] + 1, updatedAt=stamp())
        persist()
        self.reply(200, json.dumps(venue, ensure_ascii=False))


if __name__ == '__main__':
    server = ThreadingHTTPServer(('127.0.0.1', 8765), Preview)
    print('Предпросмотр: http://127.0.0.1:8765/constructor', flush=True)
    print('Ключ организатора для предпросмотра: preview', flush=True)
    print('Данные предпросмотра сохраняются в data/preview/. Остановка: Ctrl+C.', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
