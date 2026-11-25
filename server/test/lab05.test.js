import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createWorld, createShip, stepWorld, FIXED_DT } from 'shared/sim';
import {
  encodeJson,
  decodeJson,
  encodeBinaryInput,
  decodeBinaryInput,
  encodeBinarySnapshot,
  decodeBinarySnapshot,
} from 'shared/codec';

function runSimHash(steps = 1000) {
  let world = createWorld(42);
  world.ships.push(createShip(1, 'A', 200, 300, 0.5));
  world.ships.push(createShip(2, 'B', 800, 500, -1.2));

  for (let i = 1; i <= steps; i++) {
    const inputs = new Map([
      [1, [{ seq: i, thrust: i % 3 === 0 ? 1 : 0.4, turn: Math.sin(i * 0.1), fire: i % 15 === 0 }]],
      [2, [{ seq: i, thrust: 0.7, turn: -0.3, fire: i % 20 === 0 }]],
    ]);
    world = stepWorld(world, inputs, FIXED_DT);
  }
  return createHash('sha256').update(JSON.stringify(world)).digest('hex');
}

test('shared/sim runs deterministically without DOM', () => {
  const hash1 = runSimHash(1000);
  const hash2 = runSimHash(1000);
  assert.equal(hash1, hash2);
});

test('DataView binary codec round-trip within Int16 angle tolerance', () => {
  const inputMsg = { type: 'input', seq: 77, tick: 300, thrust: 0.85, turn: -0.5, fire: true };
  const decodedInput = decodeBinaryInput(encodeBinaryInput(inputMsg));
  assert.deepEqual(decodedInput, inputMsg);

  const snapMsg = {
    type: 'snapshot',
    tick: 120,
    serverTime: 1700000000000,
    yourId: 2,
    lastProcessedSeq: 55,
    state: {
      tick: 120,
      ships: [
        { id: 1, name: 'Player_1', x: 123.5, y: 456.25, vx: 12.5, vy: -8.25, angle: 1.234, hp: 100 },
        { id: 2, name: 'Player_2', x: 789.0, y: 210.5, vx: -40.0, vy: 15.0, angle: -2.345, hp: 100 },
      ],
      bullets: [
        { id: 9, ownerId: 1, x: 300.5, y: 400.5, vx: 780, vy: 0 },
      ],
    },
  };

  const decodedSnap = decodeBinarySnapshot(encodeBinarySnapshot(snapMsg));
  assert.equal(decodedSnap.tick, snapMsg.tick);
  assert.equal(decodedSnap.yourId, snapMsg.yourId);
  assert.equal(decodedSnap.lastProcessedSeq, snapMsg.lastProcessedSeq);
  assert.equal(decodedSnap.state.ships.length, 2);
  assert.ok(Math.abs(decodedSnap.state.ships[0].angle - 1.234) < 0.002);
  assert.ok(Math.abs(decodedSnap.state.ships[1].angle - (-2.345)) < 0.002);
});

test('Benchmark JSON vs Binary DataView (30 Hz, 4 players)', () => {
  const sampleInput = { type: 'input', seq: 1024, tick: 900, thrust: 1, turn: -0.5, fire: true };
  const sampleSnap = {
    type: 'snapshot',
    tick: 900,
    serverTime: Date.now(),
    yourId: 1,
    lastProcessedSeq: 1024,
    state: {
      tick: 900,
      ships: Array.from({ length: 4 }, (_, i) => ({
        id: i + 1,
        name: `Player_${i + 1}`,
        x: 400 + i * 150,
        y: 300 + i * 80,
        vx: 45.5,
        vy: -22.25,
        angle: 0.785,
        hp: 100,
      })),
      bullets: Array.from({ length: 4 }, (_, i) => ({
        id: i + 1,
        ownerId: (i % 4) + 1,
        x: 500 + i * 40,
        y: 350,
        vx: 780,
        vy: 0,
      })),
    },
  };

  const iterations = 10000;

  // JSON
  const jsonSnapBytes = Buffer.byteLength(encodeJson(sampleSnap));
  const jsonInBytes = Buffer.byteLength(encodeJson(sampleInput));
  const t0 = performance.now();
  for (let i = 0; i < iterations; i++) {
    decodeJson(encodeJson(sampleSnap));
  }
  const jsonUs = ((performance.now() - t0) * 1000) / iterations;

  // Binary
  const binSnapBytes = encodeBinarySnapshot(sampleSnap).byteLength;
  const binInBytes = encodeBinaryInput(sampleInput).byteLength;
  const t1 = performance.now();
  for (let i = 0; i < iterations; i++) {
    decodeBinarySnapshot(encodeBinarySnapshot(sampleSnap));
  }
  const binUs = ((performance.now() - t1) * 1000) / iterations;

  console.log('\n=== BENCHMARK (30 Hz, 4 players) ===');
  console.table([
    {
      Codec: 'JSON',
      'Bytes/snapshot': jsonSnapBytes,
      'KB/s down (30Hz)': ((jsonSnapBytes * 30) / 1024).toFixed(2),
      'KB/s up (30Hz)': ((jsonInBytes * 30) / 1024).toFixed(2),
      'Encode+decode us': jsonUs.toFixed(2),
    },
    {
      Codec: 'Binary (DataView)',
      'Bytes/snapshot': binSnapBytes,
      'KB/s down (30Hz)': ((binSnapBytes * 30) / 1024).toFixed(2),
      'KB/s up (30Hz)': ((binInBytes * 30) / 1024).toFixed(2),
      'Encode+decode us': binUs.toFixed(2),
    },
  ]);
});