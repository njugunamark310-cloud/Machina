// MACHINA - AXIOM Backend

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

// Server configuration
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.AXIOM_MODEL || 'claude-sonnet-5-5';

// AXIOM personality and engineering instructions
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
- Use the simulator readings when relevant.
- Distinguish simulated readings from real vehicle measurements.
- Never invent sensor readings.
- Keep answers focused and educational.
`;

// Send JSON responses to the browser
function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });

  res.end(JSON.stringify(data));
}

// Read JSON data from an incoming request
function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', chunk => {
      body += chunk;

      if (body.length > 32 * 1024) {
        reject(new Error('Request body is too large.'));
        req.destroy();
      }
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

// Validate incoming conversation messages
function cleanMessages(messages) {
  if (!Array.isArray(messages)) {
    throw new Error('Messages must be an array.');
  }

  const cleaned = messages.slice(-12);

  if (cleaned.length === 0) {
    throw new Error('No messages provided.');
  }

  for (const message of cleaned) {
    if (
      !message ||
      !['user', 'assistant'].includes(message.role) ||
      typeof message.content !== 'string' ||
      message.content.trim().length === 0 ||
      message.content.length > 1000
    ) {
      throw new Error('Invalid conversation message.');
    }
  }

  return cleaned;
}

// Safely format simulator information
function simBlock(sim) {
  if (!sim || typeof sim !== 'object') {
    return 'Simulator data unavailable.';
  }

  const engine = sim.engine || {};
  const gearbox = sim.gearbox || {};

  return `
CURRENT MACHINA SIMULATOR READINGS

ENGINE
RPM: ${String(engine.rpm ?? 'Unavailable').slice(0, 30)}
Temperature: ${String(engine.temperature ?? 'Unavailable').slice(0, 30)}
Boost: ${String(engine.boost ?? 'Unavailable').slice(0, 30)}

GEARBOX
Gear: ${String(gearbox.gear ?? 'Unavailable').slice(0, 30)}
RPM: ${String(gearbox.rpm ?? 'Unavailable').slice(0, 30)}
Speed: ${String(gearbox.speed ?? 'Unavailable').slice(0, 30)}
`;
}

// Track API requests by client IP
const requestCounts = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxRequests = 20;

  let record = requestCounts.get(ip);

  if (!record || now - record.start > windowMs) {
    record = {
      start: now,
      count: 0
    };
  }

  record.count++;
  requestCounts.set(ip, record);

  return record.count <= maxRequests;
}