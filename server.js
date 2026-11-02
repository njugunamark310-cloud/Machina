// MACHINA - AXIOM Backend

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

// Server configuration
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.AXIOM_MODEL || 'claude-sonnet-5-5';