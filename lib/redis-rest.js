// Minimal, dependency-free Upstash Redis REST client (the service behind
// Vercel KV's KV_REST_API_URL / KV_REST_API_TOKEN). Used directly because
// wrapper packages (@vercel/kv / @upstash/redis) fail to resolve inside the
// serverless bundle.
'use strict';

const url = () => String(process.env.KV_REST_API_URL || '').replace(/\/+$/, '');
const token = () => String(process.env.KV_REST_API_TOKEN || '');

function isConfigured() {
  return Boolean(url() && token());
}

async function parse(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    if (!res.ok) throw new Error(`Redis REST error (HTTP ${res.status})`);
    throw new Error(`Redis REST returned invalid JSON (HTTP ${res.status})`);
  }
}

// Executes one pipeline batch of commands, e.g. [["set", "k", "v"], ["get", "k"]].
async function pipeline(commands) {
  if (!isConfigured()) throw new Error('Redis is not configured (missing KV_REST_API_URL / KV_REST_API_TOKEN).');
  const res = await fetch(`${url()}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token()}`,
      'Content-Type': 'application/json',
      'Upstash-Direct': 'true'
    },
    body: JSON.stringify(commands)
  });
  const out = await parse(res);
  if (!Array.isArray(out)) throw new Error('Unexpected Redis REST response.');
  for (const item of out) {
    if (item && item.error) throw new Error(`Redis command failed: ${item.error}`);
  }
  return out.map((item) => (item && 'result' in item ? item.result : undefined));
}

async function setJSON(key, value) {
  await pipeline([['set', key, JSON.stringify(value)]]);
  return value;
}

async function getJSON(key) {
  const [result] = await pipeline([['get', key]]);
  if (result === null || result === undefined) return null;
  try {
    return JSON.parse(result);
  } catch (e) {
    // Stored non-JSON scalar; return raw string.
    return result;
  }
}

module.exports = { isConfigured, pipeline, setJSON, getJSON };
