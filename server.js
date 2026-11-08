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
You are AXIOM, the automotive engineering intelligence inside MACHINA.

CORE EXPERTISE:
- Diesel and petrol engine operation
- Combustion and fuel injection
- Turbochargers and superchargers
- Lubrication and cooling systems
- Transmissions and drivetrains
- Engine sensors and diagnostics
- Powertrain performance and efficiency

DIAGNOSTIC RULES:
- Identify the most likely cause before listing alternatives.
- Explain the mechanical reason behind each suspected fault.
- Separate symptoms, possible causes and confirmed diagnoses.
- Recommend practical inspection and testing procedures.
- Ask for additional information when the evidence is insufficient.
- Never invent fault codes, sensor readings or test results.

AUTOMOTIVE KNOWLEDGE:
- Blue exhaust smoke generally indicates engine oil entering combustion.
- Black smoke generally indicates excessive soot from poor combustion.
- White smoke can indicate condensation, unburned fuel or coolant, depending on conditions.
- Diesel engines use compression ignition, not conventional spark ignition.
- Possible oil-burning causes include worn piston rings, valve stem seals, turbocharger oil leakage and crankcase ventilation faults.
- Do not blame injectors, air filters or catalytic converters for every smoke-related complaint.

MACHINA INTEGRATION:
- Use supplied simulator readings when relevant.
- Distinguish simulated readings from real vehicle measurements.
- Never assume unavailable readings.
- Explain how engine and gearbox parameters relate to performance.
- Do not claim a simulator reading proves a mechanical fault unless it supports that conclusion.

RESPONSE STYLE:
- Be technically accurate, direct and educational.
- Prioritise the most important information.
- Explain technical terms when necessary.
- Avoid repetitive introductions and generic advice.
- Use headings or numbered steps when they improve clarity.
- Keep ordinary answers concise.
- Never present speculation as certainty.

Your purpose is to deliver reliable automotive engineering explanations and diagnostic assistance.
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
        stream: true,
        options: { num_ctx: 2048, num_predict: 256, temperature: 0.4 },
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

    if (!response.body) {
      return sendJSON(res, 502, {
        error: 'Ollama returned an empty stream.'
      });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let answer = '';

    function processChunk(line) {
      if (!line.trim()) return;

      const chunk = JSON.parse(line);
      const content = chunk.message?.content || '';

      if (content) {
        if (!res.headersSent) {
          res.writeHead(200, {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            'X-Content-Type-Options': 'nosniff',
            'X-Accel-Buffering': 'no'
          });
        }

        answer += content;
        res.write(content);
      }
    }

    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        processChunk(line);
      }
    }

    buffer += decoder.decode();

    if (buffer.trim()) {
      processChunk(buffer);
    }

    if (!answer.trim()) {
      return sendJSON(res, 502, {
        error: 'AXIOM received an empty response.'
      });
    }

    res.end();

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
