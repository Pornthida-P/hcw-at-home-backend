/**
 * Shared HTTP client for the mediasoup-api server.
 *
 * Environment variables:
 *   MEDIASOUP_URL                 base URL of mediasoup-api, e.g. https://media.example.org
 *                                 or https://host:3443 (no trailing slash needed)
 *   MEDIASOUP_USER / MEDIASOUP_SECRET  API_USER / API_SECRET of mediasoup-api
 *   MEDIASOUP_ACCEPT_SELF_SIGNED  "true" to accept a self-signed TLS cert (dev only)
 *   MEDIASOUP_TIMEOUT_MS          HTTP timeout for /session and /rooms-count (default 10000)
 *   MEDIASOUP_TOKEN_ORIGIN_ONLY   "true" to return wss://<origin>?token=... (no path) to the
 *                                 clients; see nginx-mediasoup-socket-fix.conf
 */
const https = require('https');
const axios = require('axios');

const DEFAULT_TIMEOUT_MS = 10000;

function isTrue(value) {
  return String(value || '').trim().toLowerCase() === 'true';
}

function getTimeoutMs() {
  const value = parseInt(process.env.MEDIASOUP_TIMEOUT_MS, 10);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
}

let insecureAgent;
function getHttpsAgent() {
  if (!isTrue(process.env.MEDIASOUP_ACCEPT_SELF_SIGNED)) {
    return undefined;
  }
  if (!insecureAgent) {
    insecureAgent = new https.Agent({ rejectUnauthorized: false });
  }
  return insecureAgent;
}

/** "https://host/path///" -> "https://host/path" */
function normalizeBaseUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

function getFallbackServer() {
  return {
    url: normalizeBaseUrl(process.env.MEDIASOUP_URL),
    password: process.env.MEDIASOUP_SECRET,
    username: process.env.MEDIASOUP_USER,
    isFallback: true,
  };
}

/** origin of a URL without credentials, safe to log / show */
function safeOrigin(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname === '/' ? '' : u.pathname}`;
  } catch (e) {
    return String(url || '(empty)');
  }
}

/**
 * Turn an axios error into an Error carrying an HTTP status for our API
 * response (httpStatus) and a message that tells the operator what to check.
 * The message never contains the mediasoup credentials.
 */
function toMediasoupError(error, server, action) {
  const where = safeOrigin(server && server.url);
  let httpStatus = 502;
  let code = 'MEDIASOUP_ERROR';
  let message;

  if (error && error.response) {
    const status = error.response.status;
    if (status === 401 || status === 403) {
      code = 'MEDIASOUP_AUTH_FAILED';
      message = `Video server ${where} rejected the credentials (HTTP ${status}) on ${action}. Check MEDIASOUP_USER/MEDIASOUP_SECRET (or the server in Admin > Mediasoup) against API_USER/API_SECRET of mediasoup-api.`;
    } else if (status === 404) {
      code = 'MEDIASOUP_BAD_URL';
      message = `Video server ${where} answered 404 on ${action}. MEDIASOUP_URL must point to the mediasoup-api base URL (the one that serves /session and /rooms-count).`;
    } else if (status >= 500) {
      code = 'MEDIASOUP_UNAVAILABLE';
      message = `Video server ${where} is unavailable (HTTP ${status}) on ${action}.${[502, 503, 504].includes(status) ? ' The reverse proxy in front of mediasoup-api cannot reach the mediasoup service: check that the service is running and the proxy upstream/port.' : ''}`;
    } else {
      message = `Video server ${where} returned HTTP ${status} on ${action}.`;
    }
  } else if (error && (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT' || /timeout/i.test(error.message || ''))) {
    httpStatus = 504;
    code = 'MEDIASOUP_TIMEOUT';
    message = `Video server ${where} did not answer within ${getTimeoutMs()} ms on ${action}.`;
  } else if (error && ['DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID'].includes(error.code)) {
    code = 'MEDIASOUP_TLS_ERROR';
    message = `TLS error (${error.code}) when connecting to video server ${where}. Use a valid certificate or set MEDIASOUP_ACCEPT_SELF_SIGNED=true (development only).`;
  } else if (error && error.code) {
    httpStatus = 503;
    code = 'MEDIASOUP_UNREACHABLE';
    message = `Cannot connect to video server ${where} (${error.code}) on ${action}. Check MEDIASOUP_URL and that mediasoup-api is running.`;
  } else {
    message = `Video server ${where} error on ${action}: ${(error && error.message) || error}`;
  }

  const err = new Error(message);
  err.httpStatus = httpStatus;
  err.code = code;
  err.isMediasoupError = true;
  return err;
}

function requestConfig(server) {
  return {
    headers: { 'Content-Type': 'application/json' },
    auth: { username: server.username, password: server.password },
    timeout: getTimeoutMs(),
    httpsAgent: getHttpsAgent(),
  };
}

function assertConfigured(server) {
  if (!server || !normalizeBaseUrl(server.url)) {
    const err = new Error('No video server configured: set MEDIASOUP_URL (and MEDIASOUP_USER / MEDIASOUP_SECRET) in the backend environment or add a server in Admin > Mediasoup.');
    err.httpStatus = 503;
    err.code = 'MEDIASOUP_NOT_CONFIGURED';
    err.isMediasoupError = true;
    throw err;
  }
}

async function getRoomsCount(server) {
  assertConfigured(server);
  try {
    const response = await axios.get(normalizeBaseUrl(server.url) + '/rooms-count', requestConfig(server));
    return response.data && response.data.count;
  } catch (error) {
    throw toMediasoupError(error, server, 'GET /rooms-count');
  }
}

async function createSession(server, roomId, peerId) {
  assertConfigured(server);
  let response;
  try {
    response = await axios.post(normalizeBaseUrl(server.url) + '/session', { roomId, peerId }, requestConfig(server));
  } catch (error) {
    throw toMediasoupError(error, server, 'POST /session');
  }
  if (!response.data || !response.data.token) {
    const err = new Error(`Video server ${safeOrigin(server.url)} returned no token on POST /session.`);
    err.httpStatus = 502;
    err.code = 'MEDIASOUP_NO_TOKEN';
    err.isMediasoupError = true;
    throw err;
  }
  return response.data.token;
}

/** URL handed to the browser (socket.io) for the given token */
function buildClientUrl(server, token) {
  const base = normalizeBaseUrl(server.url);
  let wsBase = base.replace(/^.+?:/, 'wss:');
  if (isTrue(process.env.MEDIASOUP_TOKEN_ORIGIN_ONLY)) {
    try {
      const u = new URL(base);
      wsBase = `wss://${u.host}`;
    } catch (e) {
      // keep wsBase
    }
  }
  return `${wsBase}?token=${token}`;
}

module.exports = {
  normalizeBaseUrl,
  getFallbackServer,
  safeOrigin,
  toMediasoupError,
  getRoomsCount,
  createSession,
  buildClientUrl,
  getTimeoutMs,
};
