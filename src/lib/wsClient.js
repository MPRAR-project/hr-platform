/**
 * wsClient.js — WebSocket Manager
 *
 * Usage:
 *   import wsClient from '../lib/wsClient';
 *   wsClient.on('timesheet:updated', (data) => { ... });
 *   wsClient.off('timesheet:updated', handler);
 *   wsClient.connect();   // called in AuthContext after login
 *   wsClient.disconnect(); // called on logout
 */

import hrApiClient, { tokenStore } from './hrApiClient';

const WS_URL = (() => {
  const raw = import.meta.env.VITE_HR_WS_URL || 'ws://localhost:5001';
  if (raw.startsWith('http://'))  return raw.replace('http://',  'ws://');
  if (raw.startsWith('https://')) return raw.replace('https://', 'wss://');
  if (!raw.startsWith('ws://') && !raw.startsWith('wss://')) {
    console.warn(`[wsClient] VITE_HR_WS_URL "${raw}" is not a valid WebSocket URL — falling back to ws://localhost:5001`);
    return 'ws://localhost:5001';
  }
  return raw;
})();

class WsClient {
  constructor() {
    this._ws             = null;
    this._handlers       = {};
    this._token          = null;
    this._reconnectTimer = null;
    this._reconnectDelay = 2000;
    this._maxDelay       = 30000;
    this._intentionalClose = false;
    this._retryCount       = 0;
    this._maxRetries       = 10;
  }

  // ── Register event handler ─────────────────────────────────────────────────
  on(event, handler) {
    if (!this._handlers[event]) this._handlers[event] = [];
    this._handlers[event].push(handler);
  }

  // ── Remove event handler ───────────────────────────────────────────────────
  off(event, handler) {
    if (!this._handlers[event]) return;
    this._handlers[event] = this._handlers[event].filter((h) => h !== handler);
  }

  // ── Emit internally (from WS message) ─────────────────────────────────────
  _emit(event, data) {
    const handlers = this._handlers[event] || [];
    handlers.forEach((h) => {
      try { h(data); } catch (e) { console.warn(`[wsClient] handler error for ${event}:`, e); }
    });
    const wildcards = this._handlers['*'] || [];
    wildcards.forEach((h) => {
      try { h(event, data); } catch (e) { /* silent */ }
    });
  }

  // ── Connect (called after login) ───────────────────────────────────────────
  connect(token) {
    if (token) this._token = token;
    if (!this._token) return;
    this._openSocket();
  }

  // ── Disconnect (called on logout) ──────────────────────────────────────────
  disconnect() {
    this._intentionalClose = true;
    this._token = null;
    this._retryCount = 0;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
  }

  // ── Schedule next reconnect attempt with exponential backoff ───────────────
  _scheduleReconnect() {
    if (this._intentionalClose) return;

    this._retryCount++;
    if (this._retryCount > this._maxRetries) {
      console.warn('[wsClient] Max reconnect attempts reached — giving up. Refresh the page to reconnect.');
      this._emit('ws:disconnected', { reason: 'max_retries' });
      return;
    }

    console.log(`[wsClient] Retrying in ${this._reconnectDelay}ms (attempt ${this._retryCount}/${this._maxRetries})`);
    this._reconnectTimer = setTimeout(() => {
      this._reconnectDelay = Math.min(this._reconnectDelay * 2, this._maxDelay);
      this._openSocket();
    }, this._reconnectDelay);
  }

  // ── Open WebSocket ─────────────────────────────────────────────────────────
  async _openSocket() {
    this._intentionalClose = false;

    // Always read the latest token — hrApiClient's refresh interceptor may have
    // updated it since we last called connect().
    const currentToken = tokenStore.getAccess();
    if (!currentToken) {
      console.warn('[wsClient] No access token — skipping WebSocket connection.');
      return;
    }
    this._token = currentToken;

    // Fetch a one-time ticket via hrApiClient so expired tokens are auto-refreshed
    // by its 401 interceptor before we reach here.
    let wsUrl;
    try {
      const { data } = await hrApiClient.get('/hr/auth/ws-ticket');
      wsUrl = `${WS_URL}?ticket=${data.ticket}`;
    } catch (err) {
      const status = err.response?.status;
      if (status === 401 || status === 403) {
        // The interceptor already attempted a token refresh — session is truly expired.
        // hrApiClient will have dispatched 'hr:auth:logout' to force a full logout.
        // Do NOT retry with the stale token — that's what causes the rate-limit cascade.
        console.warn('[wsClient] Auth failed fetching ws-ticket — session expired. Stopping reconnect.');
        this._emit('ws:auth:failed', { reason: 'session_expired' });
        return;
      }
      // Network or server error — retry with backoff.
      console.warn('[wsClient] ws-ticket fetch failed, will retry:', err.message);
      this._scheduleReconnect();
      return;
    }

    this._ws = new WebSocket(wsUrl);

    this._ws.onopen = () => {
      console.log('[wsClient] Connected');
      this._reconnectDelay = 2000;
      this._retryCount = 0;
    };

    this._ws.onmessage = (e) => {
      try {
        const { event, data } = JSON.parse(e.data);
        console.log(`[wsClient] Message received: ${event}`, data);
        this._emit(event, data);
      } catch { /* ignore malformed */ }
    };

    this._ws.onclose = () => {
      if (!this._intentionalClose) {
        this._scheduleReconnect();
      }
    };

    this._ws.onerror = (e) => console.error('[wsClient] Error:', e);
  }
}

const wsClient = new WsClient();
export default wsClient;
