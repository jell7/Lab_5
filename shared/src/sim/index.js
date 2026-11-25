import { createRng } from './rng.js';

export { createRng };

export const FIXED_DT = 1 / 30;
export const WORLD_WIDTH = 1600;
export const WORLD_HEIGHT = 900;
export const SHIP_ACCEL = 420;
export const SHIP_TURN_SPEED = 4.2;
export const SHIP_DRAG = 0.985;
export const BULLET_SPEED = 780;
export const BULLET_TTL = 1.2;
export const FIRE_COOLDOWN = 0.22;

export function wrapCoord(val, max) {
  return ((val % max) + max) % max;
}

export function normalizeAngle(angle) {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function createShip(id, name, x = WORLD_WIDTH / 2, y = WORLD_HEIGHT / 2, angle = 0) {
  return {
    id,
    name,
    x,
    y,
    vx: 0,
    vy: 0,
    angle,
    hp: 100,
    cooldown: 0,
    lastProcessedSeq: 0,
  };
}

export function createBullet(id, ownerId, x, y, vx, vy, ttl = BULLET_TTL) {
  return {
    id,
    ownerId,
    x,
    y,
    vx,
    vy,
    ttl,
  };
}

export function createWorld(seed = 1337) {
  return {
    tick: 0,
    seed,
    nextBulletId: 1,
    ships: [],
    bullets: [],
  };
}

export function cloneState(state) {
  return structuredClone(state);
}

/**
 * Чиста функція інтеграції одного корабля за input та dt.
 * Використовується і на сервері, і для client-side prediction + reconciliation.
 */
export function integrateShip(ship, input, dt = FIXED_DT) {
  const thrust = input && typeof input.thrust === 'number'
    ? Math.max(-1, Math.min(1, input.thrust))
    : 0;
  const turn = input && typeof input.turn === 'number'
    ? Math.max(-1, Math.min(1, input.turn))
    : 0;

  const angle = normalizeAngle(ship.angle + turn * SHIP_TURN_SPEED * dt);
  const ax = Math.cos(angle) * thrust * SHIP_ACCEL;
  const ay = Math.sin(angle) * thrust * SHIP_ACCEL;

  const dragFactor = Math.pow(SHIP_DRAG, dt * 60);
  const vx = (ship.vx + ax * dt) * dragFactor;
  const vy = (ship.vy + ay * dt) * dragFactor;

  const x = wrapCoord(ship.x + vx * dt, WORLD_WIDTH);
  const y = wrapCoord(ship.y + vy * dt, WORLD_HEIGHT);
  const cooldown = Math.max(0, (ship.cooldown || 0) - dt);

  return {
    ...ship,
    x,
    y,
    vx,
    vy,
    angle,
    cooldown,
  };
}

/**
 * Один крок симуляції світу на сервері:
 * inputsMap: Map<playerId, input[]>
 */
export function stepWorld(state, inputsMap = new Map(), dt = FIXED_DT) {
  const nextTick = state.tick + 1;
  let nextBulletId = state.nextBulletId;
  const newBullets = [];

  const ships = state.ships.map((rawShip) => {
    let ship = { ...rawShip };
    const playerInputs = inputsMap.get(ship.id) || [];

    for (const inp of playerInputs) {
      ship = integrateShip(ship, inp, dt);
      if (typeof inp.seq === 'number' && inp.seq > ship.lastProcessedSeq) {
        ship.lastProcessedSeq = inp.seq;
      }
      if (inp.fire && ship.cooldown <= 0) {
        ship.cooldown = FIRE_COOLDOWN;
        const bx = wrapCoord(ship.x + Math.cos(ship.angle) * 20, WORLD_WIDTH);
        const by = wrapCoord(ship.y + Math.sin(ship.angle) * 20, WORLD_HEIGHT);
        const bvx = ship.vx + Math.cos(ship.angle) * BULLET_SPEED;
        const bvy = ship.vy + Math.sin(ship.angle) * BULLET_SPEED;
        newBullets.push(createBullet(nextBulletId++, ship.id, bx, by, bvx, bvy, BULLET_TTL));
      }
    }

    if (playerInputs.length === 0) {
      ship = integrateShip(ship, { thrust: 0, turn: 0, fire: false }, dt);
    }

    return ship;
  });

  const bullets = [...state.bullets, ...newBullets]
    .map((b) => ({
      ...b,
      x: wrapCoord(b.x + b.vx * dt, WORLD_WIDTH),
      y: wrapCoord(b.y + b.vy * dt, WORLD_HEIGHT),
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