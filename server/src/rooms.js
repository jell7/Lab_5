import { EventEmitter, on } from 'node:events';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import fs from 'node:fs';
import path from 'node:path';
import { LOG_DIR } from './config.js';
import { JsonLinesTransform } from './log/matchlog.js';

export class Room extends EventEmitter {
  constructor(id) {
    super();
    this.id = id;
    this.players = new Map();
    this.startLogging();
  }

  async startLogging() {
    const timestamp = Date.now();
    const logPath = path.join(LOG_DIR, `${this.id}-${timestamp}.ndjson`);
    const writeStream = fs.createWriteStream(logPath);
    
    try {
      await pipeline(
        Readable.from(on(this, 'log')),
        new JsonLinesTransform(),
        writeStream
      );
    } catch (err) {
      console.error(`Log pipeline error for ${this.id}:`, err);
    }
  }

  logEvent(type, data) {
    this.emit('log', { t: Date.now(), type, ...data });
  }

  join(socket, name) {
    this.players.set(socket, name);
    this.broadcast({ type: 'roster', players: Array.from(this.players.values()) });
    this.emit('join', { name });
    this.logEvent('join', { name });
  }

  leave(socket, name) {
    this.players.delete(socket);
    this.broadcast({ type: 'roster', players: Array.from(this.players.values()) });
    this.emit('leave', { name });
    this.logEvent('leave', { name });
    
    if (this.players.size === 0) {
      this.emit('empty');
    }
  }

  chat(name, text) {
    this.broadcast({ type: 'chat', name, text });
    this.emit('chat', { name, text });
    this.logEvent('chat', { name, text });
  }

  broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const socket of this.players.keys()) {
      if (socket.readyState === 1) socket.send(data);
    }
  }
}

export class RoomManager {
  constructor() {
    this.rooms = new Map();
  }

  createRoom(id) {
    const room = new Room(id);
    this.rooms.set(id, room);
    room.once('empty', () => {
      this.rooms.delete(id);
    });
    return room;
  }

  getRooms() {
    return Array.from(this.rooms.keys()).map(id => ({ id, name: id, maxPlayers: 8 }));
  }
}

export const roomManager = new RoomManager();