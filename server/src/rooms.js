import { EventEmitter, on } from 'node:events';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import fs from 'node:fs';
import path from 'node:path';
import {
  FIXED_DT,
  createWorld,
  createShip,
  stepWorld,
  cloneState,
} from 'shared/sim';
import { encodeJson, encodeBinarySnapshot } from 'shared/codec';
import { LOG_DIR } from './config.js';
import { JsonLinesTransform } from './log/matchlog.js';
import { netSim } from './netSim.js';

const TICK_RATE = 30;
const TICK_INTERVAL_MS = 1000 / TICK_RATE;

export class Room extends EventEmitter {
  constructor(id, seed = 1337) {
    super();
    this.id = id;
    this.players = new Map(); // socket -> { id, name, useBinary }
    this.pendingInputs = new Map(); // playerId -> input[]
    this.world = createWorld(seed);

    this.lastTickDurationMs = 0;
    this.maxTickDurationMs = 0;
    this.tickCount = 0;
    this.nextTickTarget = performance.now() + TICK_INTERVAL_MS;
    this.loopTimer = null;

    this.startLogging();
    this.startLoop();
  }

  startLoop() {
    this.nextTickTarget = performance.now() + TICK_INTERVAL_MS;

    const tick = () => {
      const t0 = performance.now();

      const inputsForStep = new Map();
      for (const [playerId, list] of this.pendingInputs.entries()) {
        if (list.length > 0) {
          inputsForStep.set(playerId, list.splice(0, list.length));
        }
      }

      this.world = stepWorld(this.world, inputsForStep, FIXED_DT);
      this.tickCount++;

      const t1 = performance.now();
      this.lastTickDurationMs = t1 - t0;
      if (this.lastTickDurationMs > this.maxTickDurationMs) {
        this.maxTickDurationMs = this.lastTickDurationMs;
      }

      this.broadcastSnapshot();

      this.nextTickTarget += TICK_INTERVAL_MS;
      const delay = Math.max(0, this.nextTickTarget - performance.now());
      this.loopTimer = setTimeout(tick, delay);
    };

    this.loopTimer = setTimeout(tick, TICK_INTERVAL_MS);
  }

  stopLoop() {
    if (this.loopTimer) {
      clearTimeout(this.loopTimer);
      this.loopTimer = null;
    }
  }

  broadcastSnapshot() {
    for (const [socket, player] of this.players.entries()) {
      if (socket.readyState !== 1) continue;
      const ship = this.world.ships.find((s) => s.id === player.id);

      const snapshotObj = {
        type: 'snapshot',
        tick: this.world.tick,
        serverTime: Date.now(),
        yourId: player.id,
        lastProcessedSeq: ship ? ship.lastProcessedSeq : 0,
        state: cloneState(this.world),
      };

      const payload = player.useBinary
        ? encodeBinarySnapshot(snapshotObj)
        : encodeJson(snapshotObj);

      netSim.sendWithDelay(() => {
        if (socket.readyState === 1) {
          socket.send(payload);
        }
      });
    }
  }

  setPlayerCodec(socket, useBinary) {
    const p = this.players.get(socket);
    if (p) p.useBinary = Boolean(useBinary);
  }

  queueInput(playerId, input) {
    if (!this.pendingInputs.has(playerId)) {
      this.pendingInputs.set(playerId, []);
    }
    this.pendingInputs.get(playerId).push(input);
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

  join(socket, name, playerId, useBinary = true) {
    this.players.set(socket, { id: playerId, name, useBinary });
    this.pendingInputs.set(playerId, []);

    if (!this.world.ships.some((s) => s.id === playerId)) {
      const spawnX = 350 + (this.world.ships.length * 250) % 900;
      const spawnY = 450;
      this.world.ships.push(createShip(playerId, name, spawnX, spawnY, 0));
    }

    const roster = Array.from(this.players.values()).map((p) => p.name);
    this.broadcast({ type: 'roster', players: roster });
    this.emit('join', { name, playerId });
    this.logEvent('join', { name, playerId });
  }

  leave(socket, name, playerId) {
    this.players.delete(socket);
    if (playerId) {
      this.pendingInputs.delete(playerId);
      this.world.ships = this.world.ships.filter((s) => s.id !== playerId);
    }

    const roster = Array.from(this.players.values()).map((p) => p.name);
    this.broadcast({ type: 'roster', players: roster });
    this.emit('leave', { name, playerId });
    this.logEvent('leave', { name, playerId });

    if (this.players.size === 0) {
      this.stopLoop();
      this.emit('empty');
    }
  }

  chat(name, text) {
    this.broadcast({ type: 'chat', name, text });
    this.emit('chat', { name, text });
    this.logEvent('chat', { name, text });
  }

  broadcast(msg) {
    const data = encodeJson(msg);
    for (const socket of this.players.keys()) {
      if (socket.readyState === 1) {
        netSim.sendWithDelay(() => {
          if (socket.readyState === 1) socket.send(data);
        });
      }
    }
  }

  getStats() {
    return {
      roomId: this.id,
      tick: this.world.tick,
      players: this.players.size,
      lastTickDurationMs: Number(this.lastTickDurationMs.toFixed(3)),
      maxTickDurationMs: Number(this.maxTickDurationMs.toFixed(3)),
    };
  }
}

export class RoomManager {
  constructor() {
    this.rooms = new Map();
  }

  createRoom(id, seed = 1337) {
    const room = new Room(id, seed);
    this.rooms.set(id, room);
    room.once('empty', () => {
      this.rooms.delete(id);
    });
    return room;
  }

  getRooms() {
    return Array.from(this.rooms.keys()).map((id) => ({ id, name: id, maxPlayers: 8 }));
  }

  getStats() {
    return {
      netSim: netSim.getConfig(),
      rooms: Array.from(this.rooms.values()).map((r) => r.getStats()),
    };
  }
}

export const roomManager = new RoomManager();