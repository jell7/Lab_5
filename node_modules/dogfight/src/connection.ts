import { parseServerMessage, type ClientMessage } from 'shared/protocol';
import { decodeBinarySnapshot, encodeBinaryInput, encodeJson } from 'shared/codec';
import type { TypedBus, GameEvents } from './bus.js';

export interface ConnectionHooks {
  readonly onBytesIn?: (bytes: number) => void;
  readonly onBytesOut?: (bytes: number) => void;
}

export class GameConnection {
  private readonly url: string;
  private readonly bus: TypedBus<GameEvents>;
  private readonly hooks: ConnectionHooks;
  private socket: WebSocket | null = null;
  private readonly sendQueue: Array<ArrayBuffer | string> = [];
  private reconnectDelay = 1000;
  useBinary = true;

  constructor(url: string, bus: TypedBus<GameEvents>, hooks: ConnectionHooks = {}) {
    this.url = url;
    this.bus = bus;
    this.hooks = hooks;
    this.connect();
  }

  private connect(): void {
    const ws = new WebSocket(this.url);
    ws.binaryType = 'arraybuffer';
    this.socket = ws;

    ws.onopen = () => {
      this.reconnectDelay = 1000;
      while (this.sendQueue.length > 0) {
        const next = this.sendQueue.shift();
        if (next !== undefined) this.rawSend(next);
      }
    };

    ws.onmessage = (event: MessageEvent<unknown>) => {
      if (event.data instanceof ArrayBuffer) {
        this.hooks.onBytesIn?.(event.data.byteLength);
        const snap = decodeBinarySnapshot(event.data);
        if (snap.ok) {
          this.bus.emit('snapshot', snap.data);
        } else {
          console.warn('Bad binary snapshot:', snap.error);
        }
        return;
      }

      if (typeof event.data !== 'string') return;
      this.hooks.onBytesIn?.(new TextEncoder().encode(event.data).byteLength);
      const parsed = parseServerMessage(event.data);
      if (!parsed.ok) {
        console.warn('Bad server JSON:', parsed.error);
        return;
      }

      const msg = parsed.data;
      switch (msg.type) {
        case 'welcome':
          this.bus.emit('welcome', { playerId: msg.playerId, room: msg.room });
          break;
        case 'snapshot':
          this.bus.emit('snapshot', msg);
          break;
        case 'roster':
          this.bus.emit('roster', { players: msg.players });
          break;
        case 'chat':
          this.bus.emit('chat', { name: msg.name, text: msg.text });
          break;
        case 'pong_rtt':
          this.bus.emit('rtt', { rttMs: performance.now() - msg.t });
          break;
        default: {
          const _exhaustive: never = msg;
          return _exhaustive;
        }
      }
    };

    ws.onclose = () => {
      setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
    };

    ws.onerror = (err) => console.error('WebSocket error:', err);
  }

  private rawSend(payload: ArrayBuffer | string): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    if (payload instanceof ArrayBuffer) {
      this.hooks.onBytesOut?.(payload.byteLength);
    } else {
      this.hooks.onBytesOut?.(new TextEncoder().encode(payload).byteLength);
    }
    this.socket.send(payload);
  }

  send(msg: ClientMessage): void {
    const payload =
      this.useBinary && msg.type === 'input'
        ? encodeBinaryInput(msg)
        : encodeJson(msg);

    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.rawSend(payload);
    } else {
      this.sendQueue.push(payload);
    }
  }

  setCodec(useBinary: boolean): void {
    this.useBinary = useBinary;
    this.send({ type: 'codec', codec: useBinary ? 'binary' : 'json' });
  }
}