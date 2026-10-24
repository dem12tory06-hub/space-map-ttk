"""Exercise the local preview's organizer -> worker -> saved visitor image path."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
from urllib.request import Request, urlopen
import importlib.util
import json
import unittest


SOURCE = Path(__file__).resolve().parents[1] / 'preview-local.py'
spec = importlib.util.spec_from_file_location('preview_local', SOURCE)
preview = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preview)


class Worker(BaseHTTPRequestHandler):
    def do_POST(self):
        self.rfile.read(int(self.headers['Content-Length']))
        preview.PANORAMA_DIR.mkdir(parents=True, exist_ok=True)
        name = 'a' * 32 + '.jpg'
        (preview.PANORAMA_DIR / name).write_bytes(b'\xff\xd8\xff\xd9')
        body = json.dumps({'filename': name, 'width': 200, 'height': 100, 'inputCount': 2}).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


class QuietPreview(preview.Preview):
    def log_message(self, *args):
        pass


class PanoramaPreviewTest(unittest.TestCase):
    def test_saved_explicit_point_is_visible_after_reopen(self):
        with TemporaryDirectory() as directory:
            preview.PREVIEW_DATA = Path(directory)
            preview.PREVIEW_FILE = Path(directory) / 'venues.json'
            preview.PANORAMA_DIR = Path(directory) / 'panoramas'
            floor = {'id': 'floor', 'plan': {'elements': []}, 'places': [],
                     'panoramaPoints': [{'id': 'point', 'name': 'Вход', 'x': .2, 'y': .3}]}
            preview.VENUES = {'venue': {'id': 'venue', 'revision': 2, 'floors': [floor]}}
            worker = ThreadingHTTPServer(('127.0.0.1', 0), Worker)
            app = ThreadingHTTPServer(('127.0.0.1', 0), QuietPreview)
            preview.WORKER_URL = f'http://127.0.0.1:{worker.server_address[1]}'
            threads = [Thread(target=server.serve_forever, daemon=True) for server in (worker, app)]
            for thread in threads: thread.start()
            try:
                base = f'http://127.0.0.1:{app.server_address[1]}'
                request = Request(base + '/api/venues/venue/floors/floor/targets/point/stitch',
                                  data=b'fake-series', method='POST', headers={
                                      'Authorization': 'Bearer preview', 'If-Match': '"2"',
                                      'Content-Type': 'multipart/form-data; boundary=test'})
                with urlopen(request) as response:
                    result = json.load(response)
                self.assertEqual(result['pointId'], 'point')
                self.assertEqual(result['revision'], 3)
                self.assertEqual(preview.VENUES['venue']['floors'][0]['panoramaPoints'][0]['imageUrl'], result['imageUrl'])
                self.assertEqual(json.loads(preview.PREVIEW_FILE.read_text())['venue']['revision'], 3)
                with urlopen(base + result['imageUrl']) as response:
                    self.assertEqual(response.read(), b'\xff\xd8\xff\xd9')
                with urlopen(base + '/panorama-capture?venue=venue&floor=floor&point=point') as response:
                    self.assertIn(b'pointSelect', response.read())
            finally:
                for server in (app, worker): server.shutdown(); server.server_close()


if __name__ == '__main__':
    unittest.main()
