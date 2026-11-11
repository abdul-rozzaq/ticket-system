// Tiny static server for the smoke-test harness: serves fake Telegram pages at /k/ and /a/
// (so detectVersion() works) and the built extension under /dist/. Usage: pnpm harness
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = process.cwd();
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const port = Number(process.env.PORT || 5179);

createServer(async (req, res) => {
  let path = decodeURIComponent((req.url || '/').split('?')[0]);
  if (path === '/' || path === '/k' || path === '/k/') path = '/harness/k.html';
  else if (path === '/a' || path === '/a/') path = '/harness/a.html';
  const file = normalize(join(root, path));
  if (!file.startsWith(root) || !(path.startsWith('/harness/') || path.startsWith('/dist/'))) {
    res.writeHead(404).end('not found');
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, () => console.log(`[TP harness] http://localhost:${port}/k/#-1001234567890  and  /a/#-1009876543210`));
