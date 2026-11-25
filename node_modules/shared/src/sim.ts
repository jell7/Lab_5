import {
  asEntityId,
  asSeq,
  asTick,
  type BulletEntity,
  type EntityId,
  type PlayerInput,
  type ShipEntity,
  type Vector2,
  type WorldState,
} from './types.js';

export const FIXED_DT = 1 / 30;
export const WORLD_WIDTH = 1600;
export const WORLD_HEIGHT = 900;
export const SHIP_ACCEL = 420;
export const SHIP_TURN_SPEED = 4.2;
export const SHIP_DRAG = 0.985;
export const BULLET_SPEED = 780;
export const BULLET_TTL = 1.2;
export const FIRE_COOLDOWN = 0.22;

export function createRng(seed = 1337): () => number {
  let state = seed >>> 0;
  return function next(): number {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function vec2(x: number, y: number): Vector2 {
  return { x, y };
}

export function wrapCoord(val: number, max: number): number {
  return ((val % max) + max) % max;
}

export function normalizeAngle(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function createShip(
  id: EntityId,
  name: string,
  x = WORLD_WIDTH / 2,
  y = WORLD_HEIGHT / 2,
  angle = 0
): ShipEntity {
  return {
    kind: 'ship',
    id,
    name,
    pos: vec2(x, y),
    vel: vec2(0, 0),
    angle,
    hp: 100,
    cooldown: 0,
    lastProcessedSeq: asSeq(0),
  };
}

export function createBullet(
  id: EntityId,
  ownerId: EntityId,
  x: number,
  y: number,
  vx: number,
  vy: number,
  ttl = BULLET_TTL
): BulletEntity {
  return {
    kind: 'bullet',
    id,
    ownerId,
    pos: vec2(x, y),
    vel: vec2(vx, vy),
    ttl,
  };
}

export function createWorld(seed = 1337): WorldState {
  return {
    tick: asTick(0),
    seed,
    nextBulletId: 1,
    ships: [],
    bullets: [],
  };
}

export function integrateShip(
  ship: ShipEntity,
  input: Pick<PlayerInput, 'thrust' | 'turn'>,
  dt = FIXED_DT
): ShipEntity {
  const thrust = Math.max(-1, Math.min(1, input.thrust));
  const turn = Math.max(-1, Math.min(1, input.turn));

  const angle = normalizeAngle(ship.angle + turn * SHIP_TURN_SPEED * dt);
  const ax = Math.cos(angle) * thrust * SHIP_ACCEL;
  const ay = Math.sin(angle) * thrust * SHIP_ACCEL;

  const dragFactor = Math.pow(SHIP_DRAG, dt * 60);
  const vx = (ship.vel.x + ax * dt) * dragFactor;
  const vy = (ship.vel.y + ay * dt) * dragFactor;

  const x = wrapCoord(ship.pos.x + vx * dt, WORLD_WIDTH);
  const y = wrapCoord(ship.pos.y + vy * dt, WORLD_HEIGHT);
  const cooldown = Math.max(0, ship.cooldown - dt);

  return {
    ...ship,
    pos: vec2(x, y),
    vel: vec2(vx, vy),
    angle,
    cooldown,
  };
}

export function stepWorld(
  state: WorldState,
  inputsMap: ReadonlyMap<EntityId, readonly PlayerInput[]> = new Map(),
  dt = FIXED_DT
): WorldState {
  const nextTick = asTick(state.tick + 1);
  let nextBulletId = state.nextBulletId;
  const spawnedBullets: BulletEntity[] = [];

  const ships = state.ships.map((rawShip): ShipEntity => {
    let ship: ShipEntity = rawShip;
    const playerInputs = inputsMap.get(ship.id) ?? [];

    for (const inp of playerInputs) {
      ship = integrateShip(ship, inp, dt);
      const nextProcessed =
        inp.seq > ship.lastProcessedSeq ? inp.seq : ship.lastProcessedSeq;
      ship = { ...ship, lastProcessedSeq: nextProcessed };

      if (inp.fire && ship.cooldown <= 0) {
        ship = { ...ship, cooldown: FIRE_COOLDOWN };
        const bx = wrapCoord(ship.pos.x + Math.cos(ship.angle) * 20, WORLD_WIDTH);
        const by = wrapCoord(ship.pos.y + Math.sin(ship.angle) * 20, WORLD_HEIGHT);
        const bvx = ship.vel.x + Math.cos(ship.angle) * BULLET_SPEED;
        const bvy = ship.vel.y + Math.sin(ship.angle) * BULLET_SPEED;
        spawnedBullets.push(
          createBullet(asEntityId(nextBulletId++), ship.id, bx, by, bvx, bvy, BULLET_TTL)
        );
      }
    }

    if (playerInputs.length === 0) {
      ship = integrateShip(ship, { thrust: 0, turn: 0 }, dt);
    }

    return ship;
  });

  const bullets = [...state.bullets, ...spawnedBullets]
    .map((b): BulletEntity => ({
      ...b,
      pos: vec2(
        wrapCoord(b.pos.x + b.vel.x * dt, WORLD_WIDTH),
        wrapCoord(b.pos.y + b.vel.y * dt, WORLD_HEIGHT)
      ),
      ttl: b.ttl - dt,
    }))
    .filter((b) => b.ttl > 0);

  return {
    ...state,
    tick: nextTick,
    nextBulletId,
    ships,
    bullets,
  };
}