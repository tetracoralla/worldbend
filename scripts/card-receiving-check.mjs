import assert from 'node:assert/strict';
import { cardReceivingChecks as check, cardReceivingStartupChecks, failInitialCardReceipt } from './card-browser-checks.mjs';
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
      if (file.endsWith('index.html') && relative.includes('card-receiving')) {
        const startup=url.searchParams.has('fail-initial');
        let html=bytes.toString();
        if(startup)html=html.replace('<head>',`<head><script>(${failInitialCardReceipt.toString()})()</script>`);
        bytes = Buffer.from(html.replace('</body>', `<script>(${(startup?cardReceivingStartupChecks:check).toString()})()</script></body>`));
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
  const viewports=process.argv.includes('--compact')?[{width:300,height:640}]:[{width:1200,height:900},{width:300,height:640}];
  for (const viewport of viewports) {
    const target = await createPage(browser.debugUrl, 'about:blank');
    const result = await readPageResult(target.webSocketDebuggerUrl, {...viewport,focus:true,
      url:`http://127.0.0.1:${server.address().port}/examples/card-receiving/index.html?test=1`});
    assert(!result.error, result.error);
    assert(result.checks >= 30, `expected at least 30 checks, saw ${result.checks}`);
    console.log(
      `Card receiving browser PASS (${result.checks} checks, ${viewport.width}px): artifact receipt, business activation, revision/recovery, responsive controls and repeated reattachment`,
    );
  }
  const startupTarget=await createPage(browser.debugUrl,'about:blank');
  const startup=await readPageResult(startupTarget.webSocketDebuggerUrl,{width:300,height:640,focus:true,
    url:`http://127.0.0.1:${server.address().port}/examples/card-receiving/index.html?fail-initial=1`});
  assert(!startup.error,startup.error);
  assert.equal(startup.checks,5,'Incomplete startup recovery flow');
  console.log('Card receiving startup recovery PASS (5 checks): missing receipt, retry and preserved business action');
} finally {
  if (browser) await closeChrome(browser);
  if (server) await new Promise((resolve) => server.close(resolve));
}
