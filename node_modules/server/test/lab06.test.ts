import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createWorld, createShip, stepWorld, FIXED_DT } from 'shared/sim';
import {
  asEntityId,
  asSeq,
  asTick,
  parseClientMessage,
  type InputMessage,
  type SnapshotMessage,
} from 'shared/protocol';
import {
  encodeBinaryInput,
  decodeBinaryInput,
  encodeBinarySnapshot,
  decodeBinarySnapshot,
} from 'shared/codec';

test('deterministic simulation produces identical SHA-256 hash in TypeScript', () => {
  const run = (): string => {
    const id1 = asEntityId(1);
    const id2 = asEntityId(2);
    let world = createWorld(42);
    world = {
      ...world,
      ships: [createShip(id1, 'A', 200, 300, 0.5), createShip(id2, 'B', 800, 500, -1.2)],
    };

    for (let i = 1; i <= 1000; i++) {
      const inputs = new Map<typeof id1, readonly InputMessage[]>([
        [
          id1,
          [{ type: 'input', seq: asSeq(i), tick: asTick(i), thrust: 0.8, turn: Math.sin(i * 0.1), fire: i % 15 === 0 }],
        ],
        [
          id2,
          [{ type: 'input', seq: asSeq(i), tick: asTick(i), thrust: 0.6, turn: -0.3, fire: i % 20 === 0 }],
        ],
      ]);
      world = stepWorld(world, inputs, FIXED_DT);
    }
    return createHash('sha256').update(JSON.stringify(world)).digest('hex');
  };

  assert.equal(run(), run());
});

test('Zod boundary parser rejects malformed JSON and out-of-range inputs safely', () => {
  const badJson = parseClientMessage('{broken json');
  assert.equal(badJson.ok, false);

  const cheatTurn = parseClientMessage({
    type: 'input',
    seq: 1,
    tick: 1,
    thrust: 1,
    turn: 9999,
    fire: false,
  });
  assert.equal(cheatTurn.ok, false);
});

test('Binary DataView codec round-trip and validation', () => {
  const inp: InputMessage = {
    type: 'input',
    seq: asSeq(42),
    tick: asTick(100),
    thrust: 0.75,
    turn: -0.5,
    fire: true,
  };
  const decodedInp = decodeBinaryInput(encodeBinaryInput(inp));
  assert.equal(decodedInp.ok, true);
  if (decodedInp.ok) {
    assert.deepEqual(decodedInp.data, inp);
  }

  const snap: SnapshotMessage = {
    type: 'snapshot',
    tick: asTick(50),
    serverTime: 1700000000000,
    yourId: asEntityId(1),
    lastProcessedSeq: asSeq(42),
    state: {
      tick: asTick(50),
      seed: 1337,
      nextBulletId: 2,
      ships: [createShip(asEntityId(1), 'Pilot_1', 320.5, 410.25, 1.123)],
      bullets: [],
    },
  };
  const decodedSnap = decodeBinarySnapshot(encodeBinarySnapshot(snap));
  assert.equal(decodedSnap.ok, true);
});