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