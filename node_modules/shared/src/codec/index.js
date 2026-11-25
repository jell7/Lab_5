/**
 * СПЕЦИФІКАЦІЯ БІНАРНОГО ПРОТОКОЛУ (little-endian = true всюди, PROTOCOL_VERSION = 1)
 *
 * 1. Клієнт -> Сервер: INPUT (13 байт)
 *    Offset 0: Uint8  - version (1)
 *    Offset 1: Uint8  - packetType (1 = INPUT)
 *    Offset 2: Uint32 - seq (номер послідовності інпуту)
 *    Offset 6: Uint32 - tick (тік клієнта)
 *    Offset 10: Int8  - thrust * 100 (-100..100)
 *    Offset 11: Int8  - turn * 100 (-100..100)
 *    Offset 12: Uint8 - flags (bit 0 = fire)
 *
 * 2. Сервер -> Клієнт: SNAPSHOT (заголовок 21 байт + кораблі по 20 байт + кулі по 16 байт)
 *    Offset 0:  Uint8   - version (1)
 *    Offset 1:  Uint8   - packetType (2 = SNAPSHOT)
 *    Offset 2:  Uint32  - tick (авторитетний тік сервера)
 *    Offset 6:  Float64 - serverTime (мітка часу сервера)
 *    Offset 14: Uint16  - yourId (ID корабля отримувача)
 *    Offset 16: Uint32  - lastProcessedSeq (останній оброблений seq цього гравця)
 *    Offset 20: Uint8   - shipCount (N)
 *    Далі N кораблів (по 20 байт кожен):
 *      +0:  Uint16  - id
 *      +2:  Float32 - x
 *      +6:  Float32 - y
 *      +10: Float32 - vx
 *      +14: Float32 - vy
 *      +18: Int16   - angle (квантовано: Math.round(angle * 1000))
 *    Після кораблів: Uint16 - bulletCount (M)
 *    Далі M куль (по 16 байт кожна):
 *      +0:  Uint32  - id
 *      +4:  Uint16  - ownerId
 *      +6:  Float32 - x
 *      +10: Float32 - y
 *      +14: Int16   - angle (Math.round(Math.atan2(vy, vx) * 1000))
 */

export const BINARY_VERSION = 1;
export const BIN_PACKET = {
  INPUT: 1,
  SNAPSHOT: 2,
};

export function encodeJson(msg) {
  return JSON.stringify(msg);
}

export function decodeJson(raw) {
  const text = typeof raw === 'string'
    ? raw
    : raw instanceof ArrayBuffer || ArrayBuffer.isView(raw)
      ? new TextDecoder().decode(raw)
      : String(raw);
  return JSON.parse(text);
}

export function encodeBinaryInput(msg) {
  const buf = new ArrayBuffer(13);
  const view = new DataView(buf);
  view.setUint8(0, BINARY_VERSION);
  view.setUint8(1, BIN_PACKET.INPUT);
  view.setUint32(2, msg.seq >>> 0, true);
  view.setUint32(6, (msg.tick || 0) >>> 0, true);
  view.setInt8(10, Math.round(Math.max(-1, Math.min(1, msg.thrust || 0)) * 100));
  view.setInt8(11, Math.round(Math.max(-1, Math.min(1, msg.turn || 0)) * 100));
  view.setUint8(12, msg.fire ? 1 : 0);
  return buf;
}

export function decodeBinaryInput(bufferLike) {
  const view = toDataView(bufferLike);
  if (view.byteLength < 13) return null;
  const version = view.getUint8(0);
  const packetType = view.getUint8(1);
  if (version !== BINARY_VERSION || packetType !== BIN_PACKET.INPUT) return null;

  return {
    type: 'input',
    seq: view.getUint32(2, true),
    tick: view.getUint32(6, true),
    thrust: view.getInt8(10) / 100,
    turn: view.getInt8(11) / 100,
    fire: (view.getUint8(12) & 1) === 1,
  };
}

export function encodeBinarySnapshot(msg) {
  const ships = msg.state.ships || [];
  const bullets = msg.state.bullets || [];
  const totalBytes = 21 + ships.length * 20 + 2 + bullets.length * 16;

  const buf = new ArrayBuffer(totalBytes);
  const view = new DataView(buf);

  view.setUint8(0, BINARY_VERSION);
  view.setUint8(1, BIN_PACKET.SNAPSHOT);
  view.setUint32(2, msg.tick >>> 0, true);
  view.setFloat64(6, msg.serverTime || 0, true);
  view.setUint16(14, msg.yourId & 0xffff, true);
  view.setUint32(16, (msg.lastProcessedSeq || 0) >>> 0, true);
  view.setUint8(20, ships.length & 0xff);

  let offset = 21;
  for (const s of ships) {
    view.setUint16(offset, s.id & 0xffff, true);
    view.setFloat32(offset + 2, s.x, true);
    view.setFloat32(offset + 6, s.y, true);
    view.setFloat32(offset + 10, s.vx || 0, true);
    view.setFloat32(offset + 14, s.vy || 0, true);
    view.setInt16(offset + 18, Math.round((s.angle || 0) * 1000), true);
    offset += 20;
  }

  view.setUint16(offset, bullets.length & 0xffff, true);
  offset += 2;

  for (const b of bullets) {
    view.setUint32(offset, b.id >>> 0, true);
    view.setUint16(offset + 4, (b.ownerId || 0) & 0xffff, true);
    view.setFloat32(offset + 6, b.x, true);
    view.setFloat32(offset + 10, b.y, true);
    const bAngle = Math.atan2(b.vy || 0, b.vx || 0);
    view.setInt16(offset + 14, Math.round(bAngle * 1000), true);
    offset += 16;
  }

  return buf;
}

export function decodeBinarySnapshot(bufferLike) {
  const view = toDataView(bufferLike);
  if (view.byteLength < 23) return null;
  const version = view.getUint8(0);
  const packetType = view.getUint8(1);
  if (version !== BINARY_VERSION || packetType !== BIN_PACKET.SNAPSHOT) return null;

  const tick = view.getUint32(2, true);
  const serverTime = view.getFloat64(6, true);
  const yourId = view.getUint16(14, true);
  const lastProcessedSeq = view.getUint32(16, true);
  const shipCount = view.getUint8(20);

  let offset = 21;
  const ships = [];
  for (let i = 0; i < shipCount; i++) {
    const id = view.getUint16(offset, true);
    const x = view.getFloat32(offset + 2, true);
    const y = view.getFloat32(offset + 6, true);
    const vx = view.getFloat32(offset + 10, true);
    const vy = view.getFloat32(offset + 14, true);
    const angle = view.getInt16(offset + 18, true) / 1000;
    ships.push({ id, name: `Player_${id}`, x, y, vx, vy, angle, hp: 100 });
    offset += 20;
  }

  const bulletCount = view.getUint16(offset, true);
  offset += 2;
  const bullets = [];
  for (let i = 0; i < bulletCount; i++) {
    const id = view.getUint32(offset, true);
    const ownerId = view.getUint16(offset + 4, true);
    const x = view.getFloat32(offset + 6, true);
    const y = view.getFloat32(offset + 10, true);
    const angle = view.getInt16(offset + 14, true) / 1000;
    const speed = 780;
    bullets.push({
      id,
      ownerId,
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
    });
    offset += 16;
  }

  return {
    type: 'snapshot',
    tick,
    serverTime,
    yourId,
    lastProcessedSeq,
    state: { tick, ships, bullets },
  };
}

function toDataView(bufferLike) {
  if (bufferLike instanceof DataView) return bufferLike;
  if (bufferLike instanceof ArrayBuffer) return new DataView(bufferLike);
  if (ArrayBuffer.isView(bufferLike)) {
    return new DataView(bufferLike.buffer, bufferLike.byteOffset, bufferLike.byteLength);
  }
  throw new TypeError('Expected ArrayBuffer or TypedArray');
}