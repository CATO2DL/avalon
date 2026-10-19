import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createVisualDemo } from '../src/visual-demo.ts';
import { roleAssetFiles } from '../web/asset-map.js';

const files = new Map([
  ['/', ['web/index.html', 'text/html; charset=utf-8']],
  ...['app.js','multiplayer.js','asset-map.js','ui.js','layout.js','history.js'].map(n => [`/${n}`, [`web/${n}`, 'text/javascript; charset=utf-8']]),
  ['/style.css', ['web/style.css', 'text/css; charset=utf-8']],
  ...roleAssetFiles.map(n => [`/assets/roles/${n}`, [`.local/web-assets/roles/${n}`, 'image/webp']]),
]);
export function createDemoServer() {
  const sessions = new Map();
  return createServer(async (req, res) => {
    const send = (status, body, type = 'application/json; charset=utf-8') => {
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" });
      res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
    };
    try {
      const host = `127.0.0.1:${req.socket.localPort}`;
      if (req.headers.host !== host) return send(403, { error: 'INVALID_HOST' });
      if (req.headers.origin && req.headers.origin !== `http://${host}`) return send(403, { error: 'INVALID_ORIGIN' });
      if (req.headers['sec-fetch-site'] === 'cross-site') return send(403, { error: 'INVALID_ORIGIN' });
      if (req.method === 'GET' && files.has(req.url)) {
        const [file, type] = files.get(req.url);
        try { return send(200, await readFile(new URL(`../${file}`, import.meta.url)), type); }
        catch (e) { if (e.code === 'ENOENT') return send(404, { error: 'ASSET_MISSING' }); throw e; }
      }
      const now = Date.now();
      for (const [key, item] of sessions) if (now - item.lastSeen > 3600000) sessions.delete(key);
      const cookieName = `avalon_session_${req.socket.localPort}`;
      let token = req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith(`${cookieName}=`))?.slice(cookieName.length+1);
      let session = sessions.get(token);
      // Session capability is created only by the public bootstrap, never by a private request.
      if (req.method === 'GET' && req.url === '/api/state') {
        if (!session) {
          if (sessions.size >= 200) return send(503, { error: 'SESSION_LIMIT' });
          token = randomBytes(32).toString('hex');
          session = { demo: createVisualDemo('practice'), lastSeen: now };
          sessions.set(token, session);
          res.setHeader('Set-Cookie', `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600`);
        }
        session.lastSeen = now;
        return send(200, session.demo.snapshot());
      }
      const known = ['/api/me', '/api/action', '/api/step', '/api/reset'];
      if (!known.includes(req.url)) return send(404, { error: 'NOT_FOUND' });
      if (!session) return send(401, { error: 'SESSION_REQUIRED' });
      session.lastSeen = now;
      const demo = session.demo;
      if (req.method === 'GET' && req.url === '/api/me') return send(200, { revision: demo.snapshot().revision, player: demo.privateView() });
      if (req.method !== 'POST' || req.url === '/api/me') return send(405, { error: 'METHOD_NOT_ALLOWED' });
      if (req.headers['content-type'] !== 'application/json') return send(415, { error: 'JSON_REQUIRED' });
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 4096) return send(413, { error: 'BODY_TOO_LARGE' }); }
      let input;
      try { input = JSON.parse(body); } catch { return send(400, { error: 'INVALID_JSON' }); }
      const reset = req.url === '/api/reset';
      const action = req.url === '/api/action';
      const keys = reset ? ['revision', 'scenario', 'playerCount', 'mode', ...(input?.roles !== undefined ? ['roles'] : [])] : action ? ['revision', 'action'] : ['revision'];
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== keys.length ||
          Object.keys(input).some(k => !keys.includes(k)) || !Number.isSafeInteger(input.revision)) return send(400, { error: 'INVALID_REQUEST' });
      if (reset && (typeof input.scenario !== 'string' || !Number.isInteger(input.playerCount) || typeof input.mode !== 'string')) return send(400, { error: 'INVALID_REQUEST' });
      const result = action ? demo.submit(input.revision, input.action) : reset ? demo.change(input.revision, input.scenario, input.playerCount, input.mode, input.roles) : demo.change(input.revision);
      return send(result.ok ? 200 : 409, result);
    } catch { send(500, { error: 'DEMO_ERROR' }); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const server = createDemoServer();
  server.on('error', e => { console.error(e.message); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`Avalon local practice: http://127.0.0.1:${port}\nLocal capability session · eight roles · no multiplayer rooms`));
}
