// Legacy endpoint. The browser flow now uploads directly to Vercel Blob via
// /api/blob/token + client-token PUT, which is the supported client upload flow.
// This multipart fallback was removed because it conflicted with that flow.
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

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }
  sendJson(res, 410, {
    error: 'This upload endpoint was retired. Upload directly to Vercel Blob: POST /api/blob/token for a client token, then PUT the file to the Blob API with that token.'
  });
};
