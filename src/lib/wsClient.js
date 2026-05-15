/**
 * wsClient.js — WebSocket Manager (Phase 6 stub)
 *
 * Provides the event bus interface now so all service files can import it.
 * Full WebSocket connection is wired up in Phase 6.
 *
 * Usage:
 *   import wsClient from '../lib/wsClient';
 *   wsClient.on('timesheet:updated', (data) => { ... });
 *   wsClient.off('timesheet:updated', handler);
 *   wsClient.connect();   // called in AuthContext after login
 *   wsClient.disconnect(); // called on logout
 */

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
    this._ws       = null;
    this._handlers = {}; // event → [handler, ...]
    this._token    = null;
    this._reconnectTimer = null;
    this._reconnectDelay = 2000;
    this._maxDelay       = 30000;
    this._intentionalClose = false;
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
    // Wildcard listeners
    const wildcards = this._handlers['*'] || [];
    wildcards.forEach((h) => {
      try { h(event, data); } catch (e) { /* silent */ }
    });
  }

  // ── Connect (called after login) ───────────────────────────────────────────
  connect(token) {
    if (token) this._token = token;
    if (!this._token) return;

    // Phase 6: Enable live WebSocket
    this._openSocket();
  }

  // ── Disconnect (called on logout) ──────────────────────────────────────────
  disconnect() {
    this._intentionalClose = true;
    this._token = null;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
  }

  // ── Phase 6 — real socket ─────────────────────────────────────────────────
  _openSocket() {
    this._intentionalClose = false;
    this._ws = new WebSocket(`${WS_URL}?token=${this._token}`);

    this._ws.onopen = () => {
      console.log('[wsClient] Connected');
      this._reconnectDelay = 2000; // Reset backoff
    };

    this._ws.onmessage = (e) => {
      try {
        const { event, data } = JSON.parse(e.data);
        this._emit(event, data);
      } catch { /* ignore malformed */ }
    };

    this._ws.onclose = () => {
      if (!this._intentionalClose) {
        console.log(`[wsClient] Disconnected — retrying in ${this._reconnectDelay}ms`);
        this._reconnectTimer = setTimeout(() => {
          this._reconnectDelay = Math.min(this._reconnectDelay * 2, this._maxDelay);
          this._openSocket();
        }, this._reconnectDelay);
      }
    };

    this._ws.onerror = (e) => console.error('[wsClient] Error:', e);
  }
}

const wsClient = new WsClient();
export default wsClient;
