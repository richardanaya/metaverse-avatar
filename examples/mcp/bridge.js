import { randomUUID } from 'node:crypto';

// Relays MCP tool calls to the browser scene over WebSocket.

export class SceneBridge {
  constructor() {
    this.client = null;
    this.pending = new Map();
  }

  setClient(ws) {
    this.client = ws;
  }

  clearClient(ws) {
    if (this.client === ws) this.client = null;
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error('Browser disconnected'));
      this.pending.delete(id);
    }
  }

  get connected() {
    return this.client?.readyState === 1;
  }

  request(method, params = {}, timeoutMs = 12_000) {
    if (!this.connected) {
      throw new Error(
        'No browser scene connected. Open this app in a browser (npm run dev → http://localhost:4173).',
      );
    }
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Scene command timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.client.send(JSON.stringify({ id, method, params }));
    });
  }

  handleMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const entry = this.pending.get(msg.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(msg.id);
    if (msg.error) entry.reject(new Error(msg.error));
    else entry.resolve(msg.result);
  }
}