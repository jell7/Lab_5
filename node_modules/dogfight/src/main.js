import { GameConnection } from './connection.js';
import { setupCanvas } from './render/canvas.js';
import { createInput } from './input.js';
import { loadAll } from './assets/loader.js';
import { SoundManager, gameEvents } from './audio.js';
import { Lobby } from './lobby.js';
import { Ship, Asteroid, Pickup } from './sim/entity.js';
import { World } from './sim/world.js';
import { checkCollisions } from './sim/collision.js';
import { Vector2 } from './sim/vector.js';
import { createLoop } from './loop.js';
import { drawEntity, drawHud } from './render/draw.js';

const canvas = document.getElementById('gameCanvas');
const { ctx, width, height } = setupCanvas(canvas);
const input = createInput();

// 1. Екран завантаження (M1)
async function initGame() {
  let progress = 0;
  
  function renderLoading(p) {
    ctx.fillStyle = '#0b0f19';
    ctx.fillRect(0, 0, width(), height());
    
    ctx.fillStyle = '#00ffcc';
    ctx.font = '20px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('LOADING ASSETS...', width() / 2, height() / 2 - 30);

    ctx.strokeStyle = '#00ffcc';
    ctx.lineWidth = 4;
    ctx.strokeRect(width() / 4, height() / 2, width() / 2, 20);

    ctx.fillStyle = '#00ffcc';
    ctx.fillRect(width() / 4, height() / 2, (width() / 2) * p, 20);
  }

  renderLoading(0);

  const TempAudioContext = window.AudioContext || window.webkitAudioContext;
  const tempCtx = new TempAudioContext();

  let assets;
  try {
    assets = await loadAll('./public/assets/manifest.json', tempCtx, {
      onProgress: (p) => {
        progress = p;
        renderLoading(progress);
      }
    });
  } catch (e) {
    console.error('Asset loading failed, starting with fallbacks:', e);
    assets = { sprites: {}, audioBuffers: {}, rooms: [] };
  }

  const soundManager = new SoundManager(assets.audioBuffers, 0.08);
  soundManager.listenTo(gameEvents);

  showLobby(assets.rooms, soundManager);
}

function showLobby(rooms, soundManager) {
  const lobby = new Lobby('./assets/manifest.json');
  let currentRooms = rooms;

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;
  
  const connection = new GameConnection(wsUrl);
  const myName = 'Player_' + Math.floor(Math.random() * 1000);

  connection.on('roster', (msg) => {
    console.log('[Кімната] Гравці в кімнаті:', msg.players);
  });

  connection.on('chat', (msg) => {
    console.log(`[Чат] ${msg.name}: ${msg.text}`);
  });

  connection.send({ type: 'join', room: 'Alpha Sector', name: myName });

  window.sendChatMessage = (text) => {
    connection.send({ type: 'chat', text });
  };
  function renderLobbyUI() {
    ctx.fillStyle = '#0b0f19';
    ctx.fillRect(0, 0, width(), height());

    ctx.fillStyle = '#00ffcc';
    ctx.font = '24px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('COSMIC DOGFIGHT - LOBBY', width() / 2, height() / 3 - 50);

    ctx.font = '16px monospace';
    ctx.fillText('Click anywhere or Press ENTER to Join', width() / 2, height() / 3 + 20);
  }

  renderLobbyUI();
  lobby.startAutoRefresh();

  lobby.addEventListener('roomsUpdated', (e) => {
    currentRooms = e.detail;
  });

  const startGameAction = () => {
    try {
      soundManager.init();
    } catch (e) {
      console.warn("Audio context init warning:", e);
    }
    
    window.removeEventListener('keydown', handleKey);
    window.removeEventListener('click', handleClick);
    lobby.destroy();
    startMainGame(soundManager);
  };

  const handleKey = (e) => {
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      startGameAction();
    }
  };

  const handleClick = () => {
    startGameAction();
  };

  window.addEventListener('keydown', handleKey);
  window.addEventListener('click', handleClick);
}

// 3. Запуск основної ігрової механіки
function startMainGame(soundManager) {
  const world = new World();

  function spawnPlayer() {
    return new Ship(width() / 2, height() / 2);
  }

  let playerShip = spawnPlayer();
  world.spawn(playerShip);

  let score = 0;
  let asteroidTimer = 0;
  let pickupTimer = 0;

  const loop = createLoop({
    step: 1 / 60,
    simulate: (dt) => {
      if (!playerShip.alive) {
        if (input.isDown('Enter') || input.isDown('NumpadEnter')) {
          world.clear();
          score = 0;
          asteroidTimer = 0;
          pickupTimer = 0;
          playerShip = spawnPlayer();
          world.spawn(playerShip);
        }
        return;
      }

      if (input.isDown('Space')) {
        const canFireBefore = playerShip.cooldown <= 0;
        playerShip.fire(world);
        if (canFireBefore && playerShip.cooldown > 0) {
          gameEvents.dispatchEvent(new CustomEvent('fired'));
        }
      }

      asteroidTimer += dt;
      if (asteroidTimer > 2.0) {
        asteroidTimer = 0;
        const ax = Math.random() * width();
        const ay = Math.random() * height();
        const aVel = new Vector2((Math.random() - 0.5) * 100, (Math.random() - 0.5) * 100);
        world.spawn(new Asteroid(ax, ay, aVel, 20 + Math.random() * 15));
      }

      pickupTimer += dt;
      if (pickupTimer > 5.0) {
        pickupTimer = 0;
        world.spawn(new Pickup(Math.random() * width(), Math.random() * height()));
      }

      world.step(dt, input, width(), height());

      checkCollisions(world, (arg1, arg2) => {
        const isPickup = (arg1 instanceof Pickup) || (arg2 instanceof Pickup);
        
        score += isPickup ? 50 : 10;
        
        if (isPickup) {
          gameEvents.dispatchEvent(new CustomEvent('pickup'));
        } else {
          gameEvents.dispatchEvent(new CustomEvent('hit'));
        }
      });

      input.clear();
    },
    render: (alpha, stats) => {
      ctx.fillStyle = '#0b0f19';
      ctx.fillRect(0, 0, width(), height());

      for (const entity of world) {
        drawEntity(ctx, entity);
      }

      drawHud(ctx, stats, score, playerShip.alive ? playerShip.hp : 0);

      if (!playerShip.alive) {
        ctx.save();
        ctx.fillStyle = 'rgba(255, 0, 0, 0.8)';
        ctx.font = '24px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('GAME OVER - Press ENTER to Restart', width() / 2, height() / 2);
        ctx.restore();
      }
    }
  });

  loop.start();
}

initGame();