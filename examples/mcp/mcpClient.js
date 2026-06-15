// Browser-side bridge: executes scene commands relayed from the MCP dev server.

export class McpClient {
  constructor({ api, onStatus }) {
    this.api = api;
    this.onStatus = onStatus ?? (() => {});
    this.ws = null;
    this._reconnectMs = 1500;
    this._shouldRun = false;
  }

  start() {
    this._shouldRun = true;
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
    this._connect();
  }

  stop() {
    this._shouldRun = false;
    this.ws?.close();
    this.ws = null;
    this.onStatus({ connected: false, reason: 'stopped' });
  }

  _connect() {
    if (!this._shouldRun) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/ws`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.onStatus({ connected: true, url });
    });

    ws.addEventListener('close', () => {
      this.onStatus({ connected: false, reason: 'disconnected' });
      this.ws = null;
      if (this._shouldRun) setTimeout(() => this._connect(), this._reconnectMs);
    });

    ws.addEventListener('error', () => {
      this.onStatus({ connected: false, reason: 'error' });
    });

    ws.addEventListener('message', async (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      const { id, method, params } = msg;
      if (!id || !method) return;
      try {
        const handler = this.api[method];
        if (!handler) throw new Error(`Unknown method: ${method}`);
        const result = await handler(params ?? {});
        ws.send(JSON.stringify({ id, result }));
      } catch (err) {
        ws.send(JSON.stringify({ id, error: err.message ?? String(err) }));
      }
    });
  }
}