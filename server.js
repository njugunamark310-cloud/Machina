// MACHINA - AXIOM Backend
// Local AI powered by Ollama. No external API key required.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const OLLAMA_URL = 'http://127.0.0.1:11434/api/chat';
const MODEL = 'llama3.2:1b';

const SYSTEM = `
You are AXIOM, the intelligent automotive engineering assistant
inside MACHINA.

Your responsibilities:
- Explain automotive engineering concepts.
- Analyse engine and gearbox simulator readings.
- Explain turbocharging and powertrain systems.
- Help users understand vehicle diagnostics.
- Guide users through MACHINA's simulation modules.

Your behaviour:
- Be technically accurate.
- Explain complex concepts clearly.
- Use simulator readings when relevant.
- Distinguish simulated readings from real vehicle measurements.
- Never invent sensor readings.
- Keep answers focused, clear and educational.
`;

function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });

  res.end(JSON.stringify(data));
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;

    req.on('data', chunk => {
      size += chunk.length;

      if (size > 32 * 1024) {
        reject(new Error('Request body is too large.'));
        req.resume();
        return;
      }

      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON request.'));
      }
    });

    req.on('error', reject);
  });
}

function cleanMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('No conversation messages provided.');
  }

  const cleaned = messages.slice(-12).map(message => {
    if (
      !message ||
      !['user', 'assistant'].includes(message.role) ||
      typeof message.content !== 'string' ||
      !message.content.trim() ||
      message.content.length > 1000
    ) {
      throw new Error('Invalid conversation message.');
    }

    return {
      role: message.role,
      content: message.content.trim()
    };
  });

  while (cleaned.length && cleaned[0].role === 'assistant') {
    cleaned.shift();
  }

  if (!cleaned.length || cleaned[cleaned.length - 1].role !== 'user') {
    throw new Error('The conversation must end with a user message.');
  }

  return cleaned;
}

function simBlock(sim) {
  if (!sim || typeof sim !== 'object') {
    return 'Simulator data unavailable.';
  }

  const engine = sim.engine || {};
  const gearbox = sim.gearbox || {};

  const safe = value =>
    String(value ?? 'Unavailable').slice(0, 30);

  return `
CURRENT MACHINA SIMULATOR READINGS

ENGINE
RPM: ${safe(engine.rpm)}
Temperature: ${safe(engine.temperature)}
Boost: ${safe(engine.boost)}

GEARBOX
Gear: ${safe(gearbox.gear)}
RPM: ${safe(gearbox.rpm)}
Speed: ${safe(gearbox.speed)}
`;
}

const requestCounts = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  let record = requestCounts.get(ip);

  if (!record || now - record.start > 60000) {
    record = { start: now, count: 0 };
  }

  record.count++;
  requestCounts.set(ip, record);

  return record.count <= 20;
}

async function handleAxiom(req, res) {
  if (req.method !== 'POST') {
    return sendJSON(res, 405, {
      error: 'Method not allowed.'
    });
  }

  const ip = req.socket.remoteAddress || 'unknown';

  if (!checkRateLimit(ip)) {
    return sendJSON(res, 429, {
      error: 'Too many requests. Please wait a minute.'
    });
  }

  let data;

  try {
    data = await readRequestBody(req);
  } catch (error) {
    return sendJSON(res, 400, {
      error: error.message
    });
  }

  let messages;

  try {
    messages = cleanMessages(data.messages);
  } catch (error) {
    return sendJSON(res, 400, {
      error: error.message
    });
  }

  const controller = new AbortController();

  res.on('close', () => {
    if (!res.writableEnded) {
      controller.abort();
    }
  });

  try {
    const response = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        messages: [
          {
            role: 'system',
            content: SYSTEM + '\n' + simBlock(data.sim)
          },
          ...messages
        ]
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const errorText = await response.text();

      console.error('Ollama error:', errorText);

      return sendJSON(res, 502, {
        error: 'Ollama could not generate a response.'
      });
    }

    const result = await response.json();
    const answer = result.message?.content;

    if (!answer) {
      return sendJSON(res, 502, {
        error: 'AXIOM received an empty response.'
      });
    }

    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });

    res.end(answer);

  } catch (error) {
    if (error.name === 'AbortError') return;

    console.error('AXIOM connection error:', error.message);

    if (!res.headersSent) {
      sendJSON(res, 503, {
        error: 'Could not connect to Ollama. Make sure Ollama is running.'
      });
    } else {
      res.end();
    }
  }
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

function serveStatic(req, res, pathname) {
  if (!['GET', 'HEAD'].includes(req.method)) {
    return sendJSON(res, 405, {
      error: 'Method not allowed.'
    });
  }

  let requestedPath;

  try {
    requestedPath = decodeURIComponent(pathname);
  } catch {
    return sendJSON(res, 400, {
      error: 'Invalid URL.'
    });
  }

  if (requestedPath === '/') {
    requestedPath = '/index.html';
  }

  const filePath = path.resolve(ROOT, '.' + requestedPath);
  const filename = path.basename(filePath);

  if (
    !filePath.startsWith(ROOT + path.sep) ||
    filename.startsWith('.') ||
    filename.startsWith('server.') ||
    filename.includes('.before-') ||
    filename.endsWith('.bak')
  ) {
    return sendJSON(res, 403, {
      error: 'Access denied.'
    });
  }

  const contentType = MIME_TYPES[path.extname(filePath).toLowerCase()];

  if (!contentType) {
    return sendJSON(res, 403, {
      error: 'File type not allowed.'
    });
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      return sendJSON(res, 404, {
        error: 'File not found.'
      });
    }

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });

    res.end(req.method === 'HEAD' ? undefined : content);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/api/axiom') {
    return handleAxiom(req, res);
  }

  serveStatic(req, res, url.pathname);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('===================================');
  console.log(' MACHINA - AXIOM LOCAL SERVER');
  console.log('===================================');
  console.log(` Website: http://localhost:${PORT}`);
  console.log(` AI model: ${MODEL}`);
  console.log(' AI provider: Ollama (local)');
  console.log(' API key required: No');
  console.log('===================================');
});
