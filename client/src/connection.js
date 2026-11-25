import { encodeBinaryInput, decodeBinarySnapshot, encodeJson, decodeJson } from 'shared/codec';

export class GameConnection {
  constructor(url, { onBytesIn, onBytesOut } = {}) {
    this.url = url;
    this.socket = null;
    this.sendQueue = [];
    this.reconnectDelay = 1000;
    this.listeners = new Map();
    this.useBinary = true;
    this.onBytesIn = onBytesIn || (() => {});
    this.onBytesOut = onBytesOut || (() => {});
    this.connect();
  }

  connect() {
    this.socket = new WebSocket(this.url);
    this.socket.binaryType = 'arraybuffer';

    this.socket.onopen = () => {
      this.reconnectDelay = 1000;
      while (this.sendQueue.length > 0) {
        const payload = this.sendQueue.shift();
        this._rawSend(payload);
      }
    };

    this.socket.onmessage = (event) => {
      try {
        if (event.data instanceof ArrayBuffer) {
          this.onBytesIn(event.data.byteLength);
          const snap = decodeBinarySnapshot(event.data);
          if (snap) {
            const cbs = this.listeners.get(snap.type) || [];
            cbs.forEach((cb) => cb(snap));
          }
          return;
        }

        const text = String(event.data);
        this.onBytesIn(new TextEncoder().encode(text).byteLength);
        const msg = decodeJson(text);
        const callbacks = this.listeners.get(msg.type) || [];
        callbacks.forEach((cb) => cb(msg));
      } catch (e) {
        console.error('Failed to parse message', e);
      }
    };

    this.socket.onclose = () => {
      setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
    };

    this.socket.onerror = (err) => console.error('WebSocket error:', err);
  }

  _rawSend(payload) {
    if (payload instanceof ArrayBuffer) {
      this.onBytesOut(payload.byteLength);
    } else {
      this.onBytesOut(new TextEncoder().encode(payload).byteLength);
    }
    this.socket.send(payload);
  }

  send(msg) {
    const payload =
      this.useBinary && msg.type === 'input'
        ? encodeBinaryInput(msg)
        : encodeJson(msg);

    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this._rawSend(payload);
    } else {
      this.sendQueue.push(payload);
    }
  }

  setCodec(useBinary) {
    this.useBinary = Boolean(useBinary);
    this.send({ type: 'codec', codec: this.useBinary ? 'binary' : 'json' });
  }

  on(type, callback) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type).push(callback);
  }
}