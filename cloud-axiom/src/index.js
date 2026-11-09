import { lookup } from './knowledge.js';
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

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

AUTOMOTIVE ENGINEERING ACCURACY:
- A conventional turbocharger turbine is driven by exhaust gas energy, not directly by the engine crankshaft.
- The turbocharger turbine drives a shaft connected to the compressor, which compresses incoming intake air.
- A turbocharger does not itself ignite fuel or directly drive the vehicle's wheels.
- A conventional four-stroke engine operates through intake, compression, power and exhaust strokes.
- Diesel engines normally use compression ignition; petrol engines normally use spark ignition.
- Explain the physical sequence of operation before discussing performance benefits.
- Distinguish engine components that produce power from components that recover or transfer energy.
- Never describe a component's function using an incorrect mechanical relationship.

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

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
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
      message.content.length >
        (message.role === 'user' ? 1000 : 4000)
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

  const safe = value => String(value ?? 'Unavailable').slice(0, 30);

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

function facts(messages) {
  const q = messages.slice(-3).map(m => m.content).join(' ');
  const f = lookup(q);
  return f ? '\nVERIFIED REFERENCE FACTS (trust these over your own memory):\n' + f + '\n' : '';
}

function plainTextStream(source) {
  const { readable, writable } = new TransformStream();
  const encoder = new TextEncoder();
  const writer = writable.getWriter();

  (async () => {
    const reader = source.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    async function processLine(line) {
      if (!line.startsWith('data:')) return;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') return;

      try {
        const chunk = JSON.parse(data);
        const content = chunk.response ?? chunk.choices?.[0]?.delta?.content ?? chunk.delta?.content ?? chunk.message?.content ?? '';
        if (content) await writer.write(encoder.encode(content));
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
      }
    }

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) await processLine(line);
      }
      buffer += decoder.decode();
      if (buffer.trim()) await processLine(buffer);
      await writer.close();
    } catch (error) {
      await writer.abort(error);
    }
  })();

  return readable;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
    }

    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed.' }, 405);
    }

    if (Number(request.headers.get('content-length') || 0) > 32768) {
      return json({ error: 'Request body is too large.' }, 413);
    }

    let data;

    try {
      data = await request.json();
    } catch {
      return json({ error: 'Invalid JSON request.' }, 400);
    }

    let messages;

    try {
      messages = cleanMessages(data.messages);
    } catch (error) {
      return json({ error: error.message }, 400);
    }

    try {
      const stream = await env.AI.run(MODEL, {
        messages: [
          {
            role: 'system',
            content: SYSTEM + '\n' + simBlock(data.sim) + facts(messages)
          },
          ...messages
        ],
        stream: true,
        max_tokens: 600,
        temperature: 0.4
      });

      return new Response(plainTextStream(stream), {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'X-Content-Type-Options': 'nosniff',
          'Access-Control-Allow-Origin': '*'
        }
      });
    } catch (error) {
      console.error('AXIOM AI error:', error);
      return json({
        error: 'AXIOM could not generate a response. Please try again.'
      }, 502);
    }
  }
};
