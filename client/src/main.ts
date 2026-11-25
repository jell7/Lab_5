import { z } from 'zod';
import {
  FIXED_DT,
  WORLD_WIDTH,
  WORLD_HEIGHT,
  BULLET_SPEED,
  FIRE_COOLDOWN,
  integrateShip,
  wrapCoord,
  normalizeAngle,
} from 'shared/sim';
import {
  asSeq,
  asTick,
  type EntityId,
  type InputMessage,
  type SnapshotMessage,
} from 'shared/protocol';
import type { BulletEntity, ShipEntity } from 'shared/types';
import { TypedBus, type GameEvents } from './bus.js';
import { GameConnection } from './connection.js';
import { NetGraph } from './netgraph.js';
import { SoundFX } from './sound.js';

const RoomListSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
  })
);

const sound = new SoundFX();
const bus = new TypedBus<GameEvents>();

const canvas = document.createElement('canvas');
document.body.style.margin = '0';
document.body.style.overflow = 'hidden';
document.body.appendChild(canvas);
const maybeCtx = canvas.getContext('2d');
if (!maybeCtx) {
  throw new Error('2D canvas context unavailable');
}
const ctx: CanvasRenderingContext2D = maybeCtx;

function resize(): void {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

const keys = new Set<string>();
window.addEventListener('keydown', (e) => keys.add(e.code));
window.addEventListener('keyup', (e) => keys.delete(e.code));

let myId: EntityId | null = null;
let myName = 'Pilot_' + Math.floor(100 + Math.random() * 900);
let inGame = false;
let clientTickNum = 0;
let nextSeqNum = 1;
let pendingInputs: InputMessage[] = [];

let predictedShip: ShipEntity | null = null;
let renderOffsetX = 0;
let renderOffsetY = 0;
let lastCorrectionMag = 0;

interface LocalBullet {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly ttl: number;
}

let localBullets: LocalBullet[] = [];
let localFireCooldown = 0;
let thrustSoundCooldown = 0;

interface TimedSnapshot {
  readonly recvTime: number;
  readonly state: SnapshotMessage['state'];
}

const snapshotBuffer: TimedSnapshot[] = [];
let lastSnapshotRecvTime = performance.now();
let currentRtt = 0;

const netGraph = new NetGraph({
  onToggleBinary: (useBin) => connection.setCodec(useBin),
  onApplyNetSim: (cfg) => {
    void fetch('/api/net', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg),
    });
  },
});

const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = `${protocol}//${window.location.host}/ws`;
const connection = new GameConnection(wsUrl, bus, {
  onBytesIn: (b) => netGraph.recordIn(b),
  onBytesOut: (b) => netGraph.recordOut(b),
});

bus.on('welcome', ({ playerId }) => {
  myId = playerId;
});

bus.on('rtt', ({ rttMs }) => {
  currentRtt = rttMs;
});

bus.on('roster', ({ players }) => {
  console.log('[Кімната] Гравці:', players);
});

bus.on('chat', ({ name, text }) => {
  console.log(`[Чат] ${name}: ${text}`);
});

setInterval(() => {
  if (inGame) {
    connection.send({ type: 'ping_rtt', t: performance.now() });
  }
}, 1000);

bus.on('snapshot', (snap) => {
  const now = performance.now();
  lastSnapshotRecvTime = now;
  myId = snap.yourId;

  snapshotBuffer.push({ recvTime: now, state: snap.state });
  while (snapshotBuffer.length > 30) {
    snapshotBuffer.shift();
  }

  const serverSelf = snap.state.ships.find((s) => s.id === myId);
  if (!serverSelf) return;

  pendingInputs = pendingInputs.filter((inp) => inp.seq > snap.lastProcessedSeq);

  if (!netGraph.predictionEnabled || !predictedShip) {
    predictedShip = serverSelf;
    renderOffsetX = 0;
    renderOffsetY = 0;
    lastCorrectionMag = 0;
    return;
  }

  const prevX = predictedShip.pos.x;
  const prevY = predictedShip.pos.y;

  let reconciled: ShipEntity = serverSelf;
  for (const inp of pendingInputs) {
    reconciled = integrateShip(reconciled, inp, FIXED_DT);
  }

  let dx = prevX - reconciled.pos.x;
  let dy = prevY - reconciled.pos.y;
  if (dx > WORLD_WIDTH / 2) dx -= WORLD_WIDTH;
  if (dx < -WORLD_WIDTH / 2) dx += WORLD_WIDTH;
  if (dy > WORLD_HEIGHT / 2) dy -= WORLD_HEIGHT;
  if (dy < -WORLD_HEIGHT / 2) dy += WORLD_HEIGHT;

  lastCorrectionMag = Math.hypot(dx, dy);
  renderOffsetX += dx;
  renderOffsetY += dy;
  predictedShip = reconciled;
});

async function openLobby(): Promise<void> {
  const overlay = document.createElement('div');
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:10000',
    'background:rgba(7,11,20,0.92)', 'color:#e2f1ff',
    'display:flex', 'flex-direction:column', 'align-items:center', 'justify-content:center',
    'font:15px/1.5 monospace', 'gap:12px',
  ].join(';');

  let rooms: Array<{ id: string; name: string }> = [{ id: 'Alpha Sector', name: 'Alpha Sector' }];
  try {
    const res = await fetch('/api/rooms');
    const raw: unknown = await res.json();
    const parsed = RoomListSchema.safeParse(raw);
    if (parsed.success && parsed.data.length > 0) {
      rooms = parsed.data;
    }
  } catch {
    // Використовуємо стандартну кімнату
  }

  const optionsHtml = rooms.map((r) => `<option value="${r.id}">${r.name}</option>`).join('');

  overlay.innerHTML = `
    <h2 style="margin:0;color:#38b6ff">COSMIC DOGFIGHT (TypeScript Strict)</h2>
    <div><label>Нікнейм: <input id="lb-name" value="${myName}" style="padding:4px 8px" /></label></div>
    <div><label>Кімната: <select id="lb-room" style="padding:4px 8px">${optionsHtml}</select></label></div>
    <div style="display:flex;gap:6px">
      <input id="lb-new-room" placeholder="Нова кімната..." style="padding:4px 8px" />
      <button id="lb-create" style="padding:4px 10px;cursor:pointer">Створити</button>
    </div>
    <button id="lb-join" style="padding:8px 24px;font-weight:bold;cursor:pointer;background:#38b6ff;border:none;border-radius:4px">
      УВІЙТИ В БІЙ
    </button>
  `;
  document.body.appendChild(overlay);

  const createBtn = overlay.querySelector<HTMLButtonElement>('#lb-create');
  const newRoomInput = overlay.querySelector<HTMLInputElement>('#lb-new-room');
  const selectEl = overlay.querySelector<HTMLSelectElement>('#lb-room');

  createBtn?.addEventListener('click', () => {
    void (async () => {
      const newId = newRoomInput?.value.trim() ?? '';
      if (!newId) return;
      await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: newId }),
      });
      const opt = document.createElement('option');
      opt.value = newId;
      opt.textContent = newId;
      opt.selected = true;
      selectEl?.appendChild(opt);
    })();
  });

  const joinBtn = overlay.querySelector<HTMLButtonElement>('#lb-join');
  const nameInput = overlay.querySelector<HTMLInputElement>('#lb-name');
  joinBtn?.addEventListener('click', () => {
    myName = nameInput?.value.trim() || myName;
    const chosenRoom = selectEl?.value || 'Alpha Sector';
    inGame = true;
    connection.send({
      type: 'join',
      room: chosenRoom,
      name: myName,
      codec: netGraph.binaryEnabled ? 'binary' : 'json',
    });
    overlay.remove();
  });
}

void openLobby();

function readInput(): { thrust: number; turn: number; fire: boolean } {
  const thrust =
    (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) -
    (keys.has('KeyS') || keys.has('ArrowDown') ? 0.5 : 0);
  const turn =
    (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) -
    (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  const fire = keys.has('Space');
  return { thrust, turn, fire };
}

setInterval(() => {
  if (!inGame) return;

  clientTickNum++;
  const raw = readInput();
  const inputPacket: InputMessage = {
    type: 'input',
    seq: asSeq(nextSeqNum++),
    tick: asTick(clientTickNum),
    thrust: raw.thrust,
    turn: raw.turn,
    fire: raw.fire,
  };

  connection.send(inputPacket);

  thrustSoundCooldown = Math.max(0, thrustSoundCooldown - FIXED_DT);
  if (inputPacket.thrust > 0 && thrustSoundCooldown <= 0) {
    thrustSoundCooldown = 0.09;
    sound.playThrust();
  }

  localFireCooldown = Math.max(0, localFireCooldown - FIXED_DT);
  if (inputPacket.fire && localFireCooldown <= 0) {
    localFireCooldown = FIRE_COOLDOWN;
    sound.playLaser();

    if (netGraph.predictionEnabled && predictedShip) {
      localBullets.push({
        x: wrapCoord(predictedShip.pos.x + Math.cos(predictedShip.angle) * 20, WORLD_WIDTH),
        y: wrapCoord(predictedShip.pos.y + Math.sin(predictedShip.angle) * 20, WORLD_HEIGHT),
        vx: predictedShip.vel.x + Math.cos(predictedShip.angle) * BULLET_SPEED,
        vy: predictedShip.vel.y + Math.sin(predictedShip.angle) * BULLET_SPEED,
        ttl: 0.25,
      });
    }
  }

  if (netGraph.predictionEnabled && predictedShip) {
    pendingInputs.push(inputPacket);
    predictedShip = integrateShip(predictedShip, inputPacket, FIXED_DT);
  }

  localBullets = localBullets
    .map((b) => ({
      ...b,
      x: wrapCoord(b.x + b.vx * FIXED_DT, WORLD_WIDTH),
      y: wrapCoord(b.y + b.vy * FIXED_DT, WORLD_HEIGHT),
      ttl: b.ttl - FIXED_DT,
    }))
    .filter((b) => b.ttl > 0);
}, 1000 / 30);

function lerpAngle(a: number, b: number, t: number): number {
  const diff = normalizeAngle(b - a);
  return a + diff * t;
}

function lerpWrap(a: number, b: number, t: number, max: number): number {
  let d = b - a;
  if (d > max / 2) d -= max;
  if (d < -max / 2) d += max;
  return wrapCoord(a + d * t, max);
}

function getInterpolatedRemoteEntities(now: number): {
  ships: readonly ShipEntity[];
  bullets: readonly BulletEntity[];
} {
  const first = snapshotBuffer[0];
  if (!first) return { ships: [], bullets: [] };
  const renderTime = now - netGraph.interpDelayMs;

  if (snapshotBuffer.length === 1 || renderTime <= first.recvTime) {
    return {
      ships: first.state.ships.filter((sh) => sh.id !== myId),
      bullets: first.state.bullets,
    };
  }

  let i = snapshotBuffer.length - 2;
  while (i > 0) {
    const candidate = snapshotBuffer[i];
    if (!candidate || candidate.recvTime <= renderTime) break;
    i--;
  }

  const s0 = snapshotBuffer[i] ?? first;
  const s1 = snapshotBuffer[i + 1] ?? s0;
  const span = Math.max(1, s1.recvTime - s0.recvTime);
  const t = Math.max(0, Math.min(1, (renderTime - s0.recvTime) / span));

  const ships: ShipEntity[] = [];
  for (const bShip of s1.state.ships) {
    if (bShip.id === myId) continue;
    const aShip = s0.state.ships.find((s) => s.id === bShip.id);
    if (!aShip) {
      ships.push(bShip);
    } else {
      ships.push({
        ...bShip,
        pos: {
          x: lerpWrap(aShip.pos.x, bShip.pos.x, t, WORLD_WIDTH),
          y: lerpWrap(aShip.pos.y, bShip.pos.y, t, WORLD_HEIGHT),
        },
        angle: lerpAngle(aShip.angle, bShip.angle, t),
      });
    }
  }

  const bullets: BulletEntity[] = s1.state.bullets.map((bBul) => {
    const aBul = s0.state.bullets.find((b) => b.id === bBul.id);
    if (!aBul) return bBul;
    return {
      ...bBul,
      pos: {
        x: lerpWrap(aBul.pos.x, bBul.pos.x, t, WORLD_WIDTH),
        y: lerpWrap(aBul.pos.y, bBul.pos.y, t, WORLD_HEIGHT),
      },
    };
  });

  return { ships, bullets };
}

function drawShip(x: number, y: number, angle: number, color: string, label: string): void {
  const scaleX = canvas.width / WORLD_WIDTH;
  const scaleY = canvas.height / WORLD_HEIGHT;
  const sx = x * scaleX;
  const sy = y * scaleY;

  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(18, 0);
  ctx.lineTo(-12, -10);
  ctx.lineTo(-7, 0);
  ctx.lineTo(-12, 10);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = '#e2f1ff';
  ctx.font = '12px monospace';
  ctx.fillText(label, sx - 24, sy - 18);
}

let lastFrameTime = performance.now();

function render(now: number): void {
  const frameDt = (now - lastFrameTime) / 1000;
  lastFrameTime = now;

  const decay = Math.exp(-frameDt / 0.1);
  renderOffsetX *= decay;
  renderOffsetY *= decay;

  ctx.fillStyle = '#070b14';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  for (let gx = 0; gx < canvas.width; gx += 80) {
    ctx.beginPath();
    ctx.moveTo(gx, 0);
    ctx.lineTo(gx, canvas.height);
    ctx.stroke();
  }
  for (let gy = 0; gy < canvas.height; gy += 80) {
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(canvas.width, gy);
    ctx.stroke();
  }

  const remote = getInterpolatedRemoteEntities(now);
  const scaleX = canvas.width / WORLD_WIDTH;
  const scaleY = canvas.height / WORLD_HEIGHT;

  ctx.fillStyle = '#ffd166';
  for (const b of remote.bullets) {
    ctx.beginPath();
    ctx.arc(b.pos.x * scaleX, b.pos.y * scaleY, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = '#72efdd';
  for (const b of localBullets) {
    ctx.beginPath();
    ctx.arc(b.x * scaleX, b.y * scaleY, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const s of remote.ships) {
    drawShip(s.pos.x, s.pos.y, s.angle, '#ff5964', s.name);
  }

  if (predictedShip) {
    const vx = wrapCoord(predictedShip.pos.x + renderOffsetX, WORLD_WIDTH);
    const vy = wrapCoord(predictedShip.pos.y + renderOffsetY, WORLD_HEIGHT);
    drawShip(vx, vy, predictedShip.angle, '#38b6ff', `${myName} (YOU)`);
  }

  netGraph.update({
    rttMs: currentRtt,
    snapshotAgeMs: now - lastSnapshotRecvTime,
    pendingInputs: pendingInputs.length,
    correctionMag: lastCorrectionMag,
  });

  requestAnimationFrame(render);
}

requestAnimationFrame(render);