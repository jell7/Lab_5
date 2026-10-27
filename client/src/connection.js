export class GameConnection {
  constructor(url) {
    this.url = url;
    this.socket = null;
    this.sendQueue = [];
    this.reconnectDelay = 1000;
    this.listeners = new Map();
    this.connect();
  }

  connect() {
    this.socket = new WebSocket(this.url);

    this.socket.onopen = () => {
      console.log('Connected to server');
      this.reconnectDelay = 1000;
      while (this.sendQueue.length > 0) {
        this.socket.send(this.sendQueue.shift());
      }
    };

    this.socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const callbacks = this.listeners.get(msg.type) || [];
        callbacks.forEach(cb => cb(msg));
      } catch (e) {
        console.error('Failed to parse message', e);
      }
    };

    this.socket.onclose = () => {
      console.log(`Disconnected. Reconnecting in ${this.reconnectDelay}ms...`);
      setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
    };

    this.socket.onerror = (err) => console.error('WebSocket error:', err);
  }

  send(msg) {
    const data = JSON.stringify(msg);
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(data);
    } else {
      this.sendQueue.push(data); 
    }
  }

  on(type, callback) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type).push(callback);
  }
}