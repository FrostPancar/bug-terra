import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const ROOT = process.argv[2];
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.json':'application/json',
  '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml' };
http.createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p);
  try {
    const buf = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    res.end(buf);
  } catch { res.writeHead(404); res.end('nope'); }
}).listen(8899, () => console.log('up'));
