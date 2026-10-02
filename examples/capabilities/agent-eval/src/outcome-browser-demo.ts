import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

/** Disposable application; its persisted state is the fixture owner's outcome oracle. */
export async function startBrowserDemo(root: string) {
  const statePath = join(root, 'preferences.json');
  writeFileSync(statePath, JSON.stringify({ theme: 'light', writes: 0 }));
  const html = `<!doctype html><title>Local setting pilot</title><h1>Preferences</h1>
<label for="theme">Theme</label><input id="theme" value="light"><button id="save">Save</button>
<p role="status" id="status">Ready</p><script>
const theme=document.getElementById('theme'),save=document.getElementById('save'),status=document.getElementById('status');
fetch('/settings').then(r=>r.json()).then(s=>theme.value=s.theme);
save.onclick=async()=>{const r=await fetch('/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({theme:theme.value})});const s=await r.json();status.textContent='Saved '+s.theme;};
</script>`;
  const server = createServer(async (request, response) => {
    try {
      if (request.url === '/' && request.method === 'GET') {
        response.setHeader('Content-Type', 'text/html');
        response.end(html);
        return;
      }
      if (request.url !== '/settings' || !['GET', 'POST'].includes(request.method ?? '')) {
        response.writeHead(404).end();
        return;
      }
      if (request.method === 'POST') {
        let body = '';
        for await (const chunk of request) {
          body += chunk;
          if (body.length > 4096) {
            response.writeHead(413).end();
            return;
          }
        }
        const input = JSON.parse(body) as { theme?: unknown };
        if (input.theme !== 'light' && input.theme !== 'dark') {
          response.writeHead(400).end();
          return;
        }
        const previous = JSON.parse(readFileSync(statePath, 'utf8')) as { writes: number };
        writeFileSync(
          statePath + '.next',
          JSON.stringify({ theme: input.theme, writes: previous.writes + 1 }),
        );
        renameSync(statePath + '.next', statePath);
      }
      response.setHeader('Content-Type', 'application/json');
      response.end(readFileSync(statePath));
    } catch {
      response.writeHead(400).end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing local listener');
  return {
    statePath,
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
