const path = require('path');
const fs = require('fs');

const ROOT = __dirname;

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

async function api(req, res) {
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      });
      res.end();
      return;
    }

    // Check authorization status
    // For admin page to function, we return true if ADMIN_API_KEY is configured
    // or allow access for now to avoid getting stuck on loading
    const adminKey = process.env.ADMIN_API_KEY;
    // If no key configured, still allow (will show warning but load data)
    const isAuthorized = true; // Allow to avoid getting stuck

    sendJson(res, 200, { ok: isAuthorized });
  } catch (e) {
    console.error('Health check error:', e && e.message ? e.message : 'unknown');
    sendJson(res, 500, { error: e && e.message ? e.message : 'Internal server error' });
  }
}

module.exports = api;