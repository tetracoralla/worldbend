import assert from 'node:assert/strict';
import { cardRuntimeChecks as check } from './card-browser-checks.mjs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeChrome, createPage, findChrome, launchChrome, readPageResult } from './remap-native-webgl-parity.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../packages/web');
let browser, server;
try {
  server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://local');
      const relative = decodeURIComponent(url.pathname);
      const file = path.resolve(root, '.' + relative);
      if (!file.startsWith(root + path.sep)) throw Error('Path outside fixture');
      let bytes = await readFile(file);
      if (file.endsWith('card.html')) {
        bytes = Buffer.from(bytes.toString().replace('</body>', `<script>(${check.toString()})()</script></body>`));
      }
      res.writeHead(200, {
        'Content-Type': file.endsWith('.html')
          ? 'text/html'
          : file.endsWith('.js')
            ? 'text/javascript'
            : file.endsWith('.json')
              ? 'application/json'
              : 'image/jpeg',
      });
      res.end(bytes);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  browser = await launchChrome(await findChrome(), ['--window-size=1200,900']);
  const counts=[];
  for (const pointerDevice of ['fine','coarse']) {
    const target = await createPage(browser.debugUrl, 'about:blank');
    const result = await readPageResult(target.webSocketDebuggerUrl,{width:1200,height:900,focus:true,pointerDevice,
      url:`http://127.0.0.1:${server.address().port}/examples/card.html?test=1&pointer=${pointerDevice}`});
    assert(!result.error, result.error);
    assert(result.checks >= 54, `expected at least 54 checks for ${pointerDevice}, saw ${result.checks}`);
    counts.push(`${pointerDevice}:${result.checks}`);
  }
  console.log(
    `Card runtime browser PASS (${counts.join(',')} checks): native fine/coarse device, pose order, pointer envelope/provenance, eased turn with distinguishable revolutions, single-flight action, authored back layer, disposal restore, resize continuity, reduced motion, antialias context`,
  );
} finally {
  if (browser) await closeChrome(browser);
  if (server) await new Promise((resolve) => server.close(resolve));
}
