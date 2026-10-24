"""Local UI preview only. The production service remains server/index.js."""
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit
import json
import mimetypes
import uuid

ROOT = Path(__file__).resolve().parent
VENUES = {}


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
        if path.startswith('/api/venues/'):
            venue = VENUES.get(path.removeprefix('/api/venues/'))
            if not venue:
                return self.error_json(404, 'not_found', 'Площадка не найдена.')
            return self.reply(200, json.dumps(venue, ensure_ascii=False))
        if path in ('/map/demo', '/editor/demo'):
            return self.reply(302, b'', headers={'Location': '/map' if path == '/map/demo' else '/constructor'})
        if path == '/' or path in ('/map', '/constructor') or (path.startswith('/map/') and path.count('/') == 2):
            file = ROOT / 'index.html'
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
        self.reply(201, json.dumps(venue, ensure_ascii=False))

    def do_PUT(self):
        path = urlsplit(self.path).path
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
        self.reply(200, json.dumps(venue, ensure_ascii=False))


if __name__ == '__main__':
    server = ThreadingHTTPServer(('127.0.0.1', 8765), Preview)
    print('Предпросмотр: http://127.0.0.1:8765/constructor', flush=True)
    print('Ключ организатора для предпросмотра: preview', flush=True)
    print('Данные удалятся после закрытия окна. Остановка: Ctrl+C.', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
