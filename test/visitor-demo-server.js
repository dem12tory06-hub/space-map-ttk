// Local, read-only demonstration. Never opens the default/shared DATA_DIR.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { createVenueStore } from '../server/venue-store.js';
import { createAppServer } from '../server/app.js';
import { demoInput } from '../src/visitor/demo.js';

const directory = resolve('data/visitor-demo');
const store = createVenueStore(join(directory, 'venues.json'));
await store.initialize();
// A tiny generated PNG floor sketch: genuine PNG bytes, no image tooling or dependencies.
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : crc >>> 1;
  }
  const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, body, checksum]);
}
const width = 500, height = 300;
const pixels = Buffer.alloc((width * 3 + 1) * height);
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  const wall = x < 4 || y < 4 || x > 495 || y > 295 || (x > 320 && x < 325 && y < 200);
  const index = y * (width * 3 + 1) + 1 + x * 3;
  pixels.set(wall ? [115, 145, 150] : [238, 245, 242], index);
}
const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
const created = await store.create(demoInput.name);
const input = structuredClone(demoInput);
input.floors[0].plan.background = { id: 'demo-background', mediaType: 'image/png', width, height, visible: true, opacity: .7,
  placement: { x: .1, y: .15, width: .7, height: .7 } };
await mkdir(join(directory, 'backgrounds', created.id), { recursive: true });
await writeFile(join(directory, 'backgrounds', created.id, 'demo-background.png'), png);
await store.replace(created.id, input, created.revision);
const server = createAppServer({ store, backgroundDirectory: join(directory, 'backgrounds') });
server.listen(Number(process.env.PORT ?? 0), '127.0.0.1', () => {
  console.log(`Saved demo via API: http://127.0.0.1:${server.address().port}/map/${created.id}`);
  console.log(`Static demo (no API): http://127.0.0.1:${server.address().port}/map/demo`);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
