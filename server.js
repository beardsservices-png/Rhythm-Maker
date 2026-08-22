// Minimal static + API server for Rhythm Shop — no framework, so Railway
// deploy stays a single `node server.js` with zero extra dependencies.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
const ROOT = path.join(__dirname, 'public');
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.wav': 'audio/wav'
};

const ASSIST_SYSTEM_PROMPT = `You are a rhythm-game assistant embedded in "Rhythm Shop," a beat-making tool.
The person is not musically trained and does not want you to generate a beat for them —
you assist, you do not create. You may explain music concepts in plain language, and you
may propose SMALL, targeted nudges to their existing pattern. Never invent a whole new beat.

Respond with ONLY a JSON object, no prose outside it, no markdown fences, matching this shape:
{
  "explanation": "<one or two short sentences in plain, non-technical language>",
  "actions": [
    { "type": "adjust_density", "target": "<instrument family id, or 'all'>", "direction": "more" | "less", "amount": <0.1 to 0.5> },
    { "type": "toggle_swing", "target": "<instrument family id, or 'all'>", "amount": <0.1 to 0.4> },
    { "type": "set_bpm", "bpm": <number 60-200> }
  ]
}
Only include actions the person's instruction actually calls for — "actions" can be an empty array
if they only asked a question. Valid family ids: kick, snare, hihat, clap, tom, bass, lead, pad, bell, perc.`;

// Binary-safe. The text reader below concatenates chunks onto a string, which
// silently mangles PCM — every byte that isn't valid UTF-8 becomes U+FFFD and
// the audio comes back as noise. Loop uploads must use this one.
function readBinaryBody(req, limitBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limitBytes) { req.destroy(); reject(new Error('Payload too large')); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 1e6) { req.destroy(); reject(new Error('Payload too large')); }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function handleAssist(req, res) {
  if (!ANTHROPIC_API_KEY) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Assist is not configured yet — ANTHROPIC_API_KEY is missing on the server.' }));
    return;
  }
  try {
    const raw = await readBody(req);
    const body = JSON.parse(raw || '{}');
    const instruction = String(body.instruction || '').slice(0, 500);
    const context = body.context ? JSON.stringify(body.context).slice(0, 2000) : '{}';

    if (!instruction.trim()) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing instruction.' }));
      return;
    }

    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 400,
        system: ASSIST_SYSTEM_PROMPT,
        messages: [
          { role: 'user', content: `Current pattern state: ${context}\n\nRequest: ${instruction}` }
        ]
      })
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text().catch(() => '');
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Assist request failed.', detail: errText.slice(0, 300) }));
      return;
    }

    const data = await apiRes.json();
    const textBlock = (data.content || []).find(b => b.type === 'text');
    let parsed;
    try {
      const cleaned = (textBlock?.text || '{}').replace(/```json|```/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (e) {
      parsed = { explanation: textBlock?.text || 'Could not parse a response.', actions: [] };
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      explanation: parsed.explanation || '',
      actions: Array.isArray(parsed.actions) ? parsed.actions : []
    }));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Server error handling assist request.' }));
  }
}

function modeFile(mode) {
  const safe = mode.replace(/[^a-z0-9_-]/gi, '');
  return path.join(DATA_DIR, `${safe}.json`);
}

function readModeStore(mode) {
  try {
    const raw = fs.readFileSync(modeFile(mode), 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}

function writeModeStore(mode, store) {
  fs.writeFileSync(modeFile(mode), JSON.stringify(store, null, 2));
}

const PROJECT_DIR = path.join(DATA_DIR, 'projects');
const AUDIO_DIR = path.join(DATA_DIR, 'audio');
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

function safeName(n) {
  return String(n || '').replace(/[^a-z0-9 _-]/gi, '').trim().slice(0, 64);
}

function ensureDirs() {
  if (!fs.existsSync(PROJECT_DIR)) fs.mkdirSync(PROJECT_DIR, { recursive: true });
  if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true });
}

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

/**
 * Projects are JSON plus sidecar WAVs, never one document.
 * Recorded loops are megabytes of PCM; base64 in JSON inflates them ~33% and
 * would make every save rewrite the whole thing.
 *
 *   /api/projects                        GET  -> { names }
 *   /api/projects/:name                  GET  -> project JSON
 *                                        POST -> save project JSON
 *                                        DELETE
 *   /api/projects/:name/audio/:slot      GET  -> WAV bytes
 *                                        POST -> store WAV bytes
 */
async function handleProjects(req, res, urlObj) {
  ensureDirs();
  const parts = urlObj.pathname.split('/').filter(Boolean); // api, projects, name?, 'audio', slot?
  const name = parts[2] ? safeName(decodeURIComponent(parts[2])) : null;
  const isAudio = parts[3] === 'audio';
  const slot = parts[4] != null ? String(parseInt(parts[4], 10)) : null;

  if (req.method === 'GET' && !name) {
    const names = fs.existsSync(PROJECT_DIR)
      ? fs.readdirSync(PROJECT_DIR).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5))
      : [];
    return json(res, 200, { names });
  }

  if (!name) return json(res, 400, { error: 'Missing or invalid project name.' });

  if (isAudio) {
    if (slot == null || !/^\d+$/.test(slot)) return json(res, 400, { error: 'Bad slot.' });
    const file = path.join(AUDIO_DIR, `${name}__${slot}.wav`);

    if (req.method === 'GET') {
      if (!fs.existsSync(file)) return json(res, 404, { error: 'No audio for that slot.' });
      const buf = fs.readFileSync(file);
      res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': buf.length });
      return res.end(buf);
    }
    if (req.method === 'POST') {
      try {
        const body = await readBinaryBody(req, MAX_AUDIO_BYTES);
        fs.writeFileSync(file, body);
        return json(res, 200, { ok: true, bytes: body.length });
      } catch (e) {
        return json(res, 413, { error: e.message });
      }
    }
    if (req.method === 'DELETE') {
      if (fs.existsSync(file)) fs.unlinkSync(file);
      return json(res, 200, { ok: true });
    }
    return json(res, 405, { error: 'Method not allowed.' });
  }

  const file = path.join(PROJECT_DIR, `${name}.json`);

  if (req.method === 'GET') {
    if (!fs.existsSync(file)) return json(res, 404, { error: 'Not found.' });
    try {
      return json(res, 200, { name, data: JSON.parse(fs.readFileSync(file, 'utf8')) });
    } catch (e) {
      return json(res, 500, { error: 'Project file is corrupt.' });
    }
  }

  if (req.method === 'POST') {
    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw || '{}');
      fs.writeFileSync(file, JSON.stringify(body.data ?? body, null, 2));
      return json(res, 200, { ok: true });
    } catch (e) {
      return json(res, 400, { error: 'Invalid request body.' });
    }
  }

  if (req.method === 'DELETE') {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    if (fs.existsSync(AUDIO_DIR)) {
      fs.readdirSync(AUDIO_DIR)
        .filter(f => f.startsWith(name + '__'))
        .forEach(f => fs.unlinkSync(path.join(AUDIO_DIR, f)));
    }
    return json(res, 200, { ok: true });
  }

  return json(res, 405, { error: 'Method not allowed.' });
}

async function handlePatterns(req, res, urlObj) {
  const parts = urlObj.pathname.split('/').filter(Boolean); // ['api','patterns', mode?, name?]
  const mode = parts[2];
  const name = parts[3] ? decodeURIComponent(parts[3]) : null;

  if (!mode || !/^[a-z0-9_-]+$/i.test(mode)) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing or invalid mode.' }));
    return;
  }

  if (req.method === 'GET' && !name) {
    const store = readModeStore(mode);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ names: Object.keys(store) }));
    return;
  }

  if (req.method === 'GET' && name) {
    const store = readModeStore(mode);
    if (!(name in store)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found.' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ name, data: store[name] }));
    return;
  }

  if (req.method === 'POST' && name) {
    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw || '{}');
      const store = readModeStore(mode);
      store[name] = body.data;
      writeModeStore(mode, store);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid request body.' }));
    }
    return;
  }

  if (req.method === 'DELETE' && name) {
    const store = readModeStore(mode);
    delete store[name];
    writeModeStore(mode, store);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.writeHead(405, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Method not allowed.' }));
}

const server = http.createServer((req, res) => {
  // A malformed request target (e.g. "//") makes the URL constructor throw,
  // and an uncaught throw in this handler takes the whole process down — one
  // stray request would end the app. Answer 400 instead.
  let urlObj;
  try {
    urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Bad Request');
    return;
  }

  // Health check for Railway — cheap, no disk/network touch, always 200 when up.
  if (urlObj.pathname === '/health' || urlObj.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', dataDir: DATA_DIR }));
    return;
  }

  if (req.method === 'POST' && urlObj.pathname === '/api/assist') {
    handleAssist(req, res);
    return;
  }

  if (urlObj.pathname.startsWith('/api/projects')) {
    handleProjects(req, res, urlObj);
    return;
  }

  if (urlObj.pathname.startsWith('/api/patterns')) {
    handlePatterns(req, res, urlObj);
    return;
  }

  let reqPath = decodeURIComponent(urlObj.pathname);
  if (reqPath === '/') reqPath = '/index.html';
  const filePath = path.join(ROOT, reqPath);

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => console.log(`Rhythm Shop serving on port ${PORT}`));
