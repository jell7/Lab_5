import {
  PROTOCOL_VERSION,
  type InputMessage,
  type ParseResult,
  type SnapshotMessage,
} from './protocol.js';
import { asEntityId, asSeq, asTick, type BulletEntity, type ShipEntity } from './types.js';

export const BIN_PACKET = {
  INPUT: 1,
  SNAPSHOT: 2,
} as const;

export interface SnapshotCodec {
  readonly name: 'binary' | 'json';
  encodeSnapshot(msg: SnapshotMessage): ArrayBuffer | string;
}

export function encodeJson(msg: unknown): string {
  return JSON.stringify(msg);
}

export function encodeBinaryInput(msg: InputMessage): ArrayBuffer {
  const buf = new ArrayBuffer(13);
  const view = new DataView(buf);
  view.setUint8(0, PROTOCOL_VERSION);
  view.setUint8(1, BIN_PACKET.INPUT);
  view.setUint32(2, msg.seq >>> 0, true);
  view.setUint32(6, msg.tick >>> 0, true);
  view.setInt8(10, Math.round(Math.max(-1, Math.min(1, msg.thrust)) * 100));
  view.setInt8(11, Math.round(Math.max(-1, Math.min(1, msg.turn)) * 100));
  view.setUint8(12, msg.fire ? 1 : 0);
  return buf;
}

export function decodeBinaryInput(bufferLike: ArrayBuffer | ArrayBufferView): ParseResult<InputMessage> {
  const view = toDataView(bufferLike);
  if (view.byteLength !== 13) {
    return { ok: false, error: `Invalid input packet length: ${view.byteLength}` };
  }
  const version = view.getUint8(0);
  const packetType = view.getUint8(1);
  if (version !== PROTOCOL_VERSION || packetType !== BIN_PACKET.INPUT) {
    return { ok: false, error: 'Unsupported binary input version or packet type' };
  }

  const rawThrust = view.getInt8(10);
  const rawTurn = view.getInt8(11);
  if (rawThrust < -100 || rawThrust > 100 || rawTurn < -100 || rawTurn > 100) {
    return { ok: false, error: 'Input control values out of range' };
  }

  return {
    ok: true,
    data: {
      type: 'input',
      seq: asSeq(view.getUint32(2, true)),
      tick: asTick(view.getUint32(6, true)),
      thrust: rawThrust / 100,
      turn: rawTurn / 100,
      fire: (view.getUint8(12) & 1) === 1,
    },
  };
}

export function encodeBinarySnapshot(msg: SnapshotMessage): ArrayBuffer {
  const ships = msg.state.ships;
  const bullets = msg.state.bullets;
  const totalBytes = 21 + ships.length * 20 + 2 + bullets.length * 16;

  const buf = new ArrayBuffer(totalBytes);
  const view = new DataView(buf);

  view.setUint8(0, PROTOCOL_VERSION);
  view.setUint8(1, BIN_PACKET.SNAPSHOT);
  view.setUint32(2, msg.tick >>> 0, true);
  view.setFloat64(6, msg.serverTime, true);
  view.setUint16(14, msg.yourId & 0xffff, true);
  view.setUint32(16, msg.lastProcessedSeq >>> 0, true);
  view.setUint8(20, ships.length & 0xff);

  let offset = 21;
  for (const s of ships) {
    view.setUint16(offset, s.id & 0xffff, true);
    view.setFloat32(offset + 2, s.pos.x, true);
    view.setFloat32(offset + 6, s.pos.y, true);
    view.setFloat32(offset + 10, s.vel.x, true);
    view.setFloat32(offset + 14, s.vel.y, true);
    view.setInt16(offset + 18, Math.round(s.angle * 1000), true);
    offset += 20;
  }

  view.setUint16(offset, bullets.length & 0xffff, true);
  offset += 2;

  for (const b of bullets) {
    view.setUint32(offset, b.id >>> 0, true);
    view.setUint16(offset + 4, b.ownerId & 0xffff, true);
    view.setFloat32(offset + 6, b.pos.x, true);
    view.setFloat32(offset + 10, b.pos.y, true);
    const bAngle = Math.atan2(b.vel.y, b.vel.x);
    view.setInt16(offset + 14, Math.round(bAngle * 1000), true);
    offset += 16;
  }

  return buf;
}

export function decodeBinarySnapshot(
  bufferLike: ArrayBuffer | ArrayBufferView
): ParseResult<SnapshotMessage> {
  const view = toDataView(bufferLike);
  if (view.byteLength < 23) {
    return { ok: false, error: 'Snapshot buffer too short' };
  }
  const version = view.getUint8(0);
  const packetType = view.getUint8(1);
  if (version !== PROTOCOL_VERSION || packetType !== BIN_PACKET.SNAPSHOT) {
    return { ok: false, error: 'Invalid snapshot header or version' };
  }

  const tick = asTick(view.getUint32(2, true));
  const serverTime = view.getFloat64(6, true);
  const yourId = asEntityId(view.getUint16(14, true));
  const lastProcessedSeq = asSeq(view.getUint32(16, true));
  const shipCount = view.getUint8(20);

  const minAfterShips = 21 + shipCount * 20 + 2;
  if (view.byteLength < minAfterShips) {
    return { ok: false, error: 'Truncated ship section in snapshot' };
  }

  let offset = 21;
  const ships: ShipEntity[] = [];
  for (let i = 0; i < shipCount; i++) {
    const id = asEntityId(view.getUint16(offset, true));
    const x = view.getFloat32(offset + 2, true);
    const y = view.getFloat32(offset + 6, true);
    const vx = view.getFloat32(offset + 10, true);
    const vy = view.getFloat32(offset + 14, true);
    const angle = view.getInt16(offset + 18, true) / 1000;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return { ok: false, error: 'Non-finite coordinates in snapshot' };
    }
    ships.push({
      kind: 'ship',
      id,
      name: `Pilot_${id}`,
      pos: { x, y },
      vel: { x: vx, y: vy },
      angle,
      hp: 100,
      cooldown: 0,
      lastProcessedSeq: asSeq(0),
    });
    offset += 20;
  }

  const bulletCount = view.getUint16(offset, true);
  offset += 2;
  if (view.byteLength !== offset + bulletCount * 16) {
    return { ok: false, error: 'Bullet section byteLength mismatch' };
  }

  const bullets: BulletEntity[] = [];
  for (let i = 0; i < bulletCount; i++) {
    const id = asEntityId(view.getUint32(offset, true));
    const ownerId = asEntityId(view.getUint16(offset + 4, true));
    const x = view.getFloat32(offset + 6, true);
    const y = view.getFloat32(offset + 10, true);
    const angle = view.getInt16(offset + 14, true) / 1000;
    bullets.push({
      kind: 'bullet',
      id,
      ownerId,
      pos: { x, y },
      vel: { x: Math.cos(angle) * 780, y: Math.sin(angle) * 780 },
      ttl: 1,
    });
    offset += 16;
  }

  return {
    ok: true,
    data: {
      type: 'snapshot',
      tick,
      serverTime,
      yourId,
      lastProcessedSeq,
      state: {
        tick,
        seed: 1337,
        nextBulletId: 1,
        ships,
        bullets,
      },
    },
  };
}

export const BinarySnapshotCodec: SnapshotCodec = {
  name: 'binary',
  encodeSnapshot: (msg) => encodeBinarySnapshot(msg),
};

export const JsonSnapshotCodec: SnapshotCodec = {
  name: 'json',
  encodeSnapshot: (msg) => encodeJson(msg),
};

function toDataView(bufferLike: ArrayBuffer | ArrayBufferView): DataView {
  if (bufferLike instanceof DataView) return bufferLike;
  if (bufferLike instanceof ArrayBuffer) return new DataView(bufferLike);
  return new DataView(bufferLike.buffer, bufferLike.byteOffset, bufferLike.byteLength);
}