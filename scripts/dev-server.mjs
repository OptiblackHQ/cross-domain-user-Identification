import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

const site = process.argv[2];
const port = parseInt(process.argv[3] || '3000', 10);

if (!site || !['alpha', 'bravo'].includes(site)) {
  console.error('Usage: node scripts/dev-server.mjs <alpha|bravo> [port]');
  process.exit(1);
}

const siteRoot = path.join(repoRoot, site);
const publicDir = path.join(siteRoot, 'public');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/\r$/, '');
    process.env[key] = value;
  }
}

function loadEnv(dir) {
  loadEnvFile(path.join(dir, '.env'));
  loadEnvFile(path.join(dir, '.env.local'));
}

loadEnv(siteRoot);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function serveStatic(req, res) {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = 'index.html';
  urlPath = urlPath.replace(/^\//, '');
  const filePath = path.resolve(publicDir, urlPath);
  const publicResolved = path.resolve(publicDir);

  if (!filePath.startsWith(publicResolved + path.sep) && filePath !== publicResolved) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }

  const ext = path.extname(filePath);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

async function handleTrack(req, res) {
  const token = process.env.MIXPANEL_TOKEN;
  if (!token) {
    sendJson(res, 500, { error: 'MIXPANEL_TOKEN not configured' });
    return;
  }

  let body = '';
  for await (const chunk of req) {
    body += chunk;
  }

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch (e) {
    sendJson(res, 400, { error: 'Invalid JSON' });
    return;
  }

  const { event, properties = {} } = parsed;
  if (!event || !properties.distinct_id) {
    sendJson(res, 400, { error: 'Missing event or distinct_id' });
    return;
  }

  const payload = [
    {
      event,
      properties: {
        ...properties,
        token,
        distinct_id: properties.distinct_id,
        time: Math.floor(Date.now() / 1000),
      },
    },
  ];

  const data = Buffer.from(JSON.stringify(payload)).toString('base64');
  const url =
    'https://api.mixpanel.com/track?ip=1&data=' + encodeURIComponent(data);

  try {
    const mpRes = await fetch(url);
    const text = await mpRes.text();
    sendJson(res, 200, { ok: text === '1' });
  } catch (e) {
    sendJson(res, 502, { error: 'Mixpanel request failed' });
  }
}

const server = http.createServer((req, res) => {
  const pathname = req.url.split('?')[0];

  if (req.method === 'GET' && pathname === '/api/config') {
    sendJson(res, 200, {
      token: process.env.MIXPANEL_TOKEN || '',
      otherSiteUrl: process.env.OTHER_SITE_URL || '',
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/track') {
    handleTrack(req, res);
    return;
  }

  if (req.method === 'GET') {
    serveStatic(req, res);
    return;
  }

  res.writeHead(405, { 'Content-Type': 'text/plain' });
  res.end('Method not allowed');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use.`);
    console.error(`Stop the other server, or use a different port:`);
    console.error(`  node scripts/dev-server.mjs ${site} ${port + 1}`);
    process.exit(1);
  }
  throw err;
});

server.listen(port, () => {
  console.log(`${site} → http://localhost:${port}`);
  console.log(`  public: ${publicDir}`);
  console.log(`  env:    ${path.join(siteRoot, '.env')}`);
});
