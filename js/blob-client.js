// Browser upload helper that follows the exact @vercel/blob client protocol.
(function () {
  'use strict';

  const BLOB_API_URL = 'https://vercel.com/api/blob';
  const BLOB_API_VERSION = String(globalThis.VERCEL_BLOB_API_VERSION || 13);

  function parseStoreId(token) {
    const parts = String(token || '').split('_');
    return parts.length > 3 ? parts[3] : '';
  }

  function randomSegment() {
    if (globalThis.crypto && globalThis.crypto.getRandomValues) {
      const arr = new Uint8Array(8);
      globalThis.crypto.getRandomValues(arr);
      return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    return String(Math.floor(Math.random() * 0xffffffffffff).toString(16));
  }

  async function blobPut(pathname, body, accessToken) {
    const storeId = parseStoreId(accessToken);
    if (!storeId) throw new Error('Could not parse upload token.');
    // Header set must match @vercel/blob/client exactly. Extra headers such as
    // x-content-type / x-add-random-suffix are NOT sent by the browser SDK and
    // make the Blob control plane's CORS preflight fail ("Failed to fetch").
    // Content type and random suffix are enforced server-side via the client
    // token (onBeforeGenerateToken), not by browser headers.
    const headers = {
      'authorization': 'Bearer ' + accessToken,
      'x-api-version': BLOB_API_VERSION,
      'x-api-blob-request-id': `${storeId}:${Date.now()}:${randomSegment()}`,
      'x-api-blob-request-attempt': '0',
      'x-vercel-blob-store-id': storeId,
      'x-vercel-blob-access': 'public'
    };
    const url = `${BLOB_API_URL}/?pathname=${encodeURIComponent(pathname)}`;
    const res = await fetch(url, { method: 'PUT', body, headers });
    let json = null;
    try {
      json = await res.json();
    } catch (e) {
      throw new Error(`Blob upload failed (${res.status})`);
    }
    if (!res.ok) {
      const msg = json && json.error ? String(json.error.code || json.error) : '';
      let custom = msg;
      if (msg === 'forbidden' || msg === 'forbidden_blob_file') custom = 'Store denied access. Verify BLOB_READ_WRITE_TOKEN and store connection.';
      else if (msg === 'content_type_not_allowed') custom = 'This file type is not allowed for this upload.';
      else if (msg === 'client_token_expired') custom = 'Upload token expired. Please retry.';
      else if (msg === 'store_not_found') custom = 'Blob store not found.';
      else if (msg === 'store_suspended') custom = 'Blob store is suspended.';
      else if (msg === 'service_rate_limited') custom = 'Upload service is rate limited. Please retry in a moment.';
      throw new Error(`Blob upload failed (${res.status}) ${custom}`);
    }
    if (!json || !json.url) throw new Error('Blob upload returned no URL');
    return json;
  }

  async function upload(pathname, file, options) {
    options = options || {};
    if (options.access !== 'public') throw new Error('Only public access is supported.');
    const handleUploadUrl = options.handleUploadUrl || '/api/blob/token';
    const tokenRes = await fetch(handleUploadUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'blob.generate-client-token',
        payload: { pathname, clientPayload: options.clientPayload ?? null, multipart: false }
      })
    });
    const tokenBody = await tokenRes.json().catch(() => null);
    if (!tokenRes.ok) {
      const msg = tokenBody && tokenBody.error ? tokenBody.error : `Token request failed (${tokenRes.status}).`;
      throw new Error(msg);
    }
    if (!tokenBody || !tokenBody.clientToken) throw new Error('Missing client token from server.');
    return blobPut(pathname, file, tokenBody.clientToken);
  }

  globalThis.blobUploadUpload = upload;
})();