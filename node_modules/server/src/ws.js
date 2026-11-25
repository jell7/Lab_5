import { WebSocketServer } from 'ws';
import { validateMessage } from './protocol.js';
import { roomManager } from './rooms.js';
import { netSim } from './netSim.js';

let nextPlayerNum = 1;

export function setupWebSocket(server) {
  const wss = new WebSocketServer({ server, maxPayload: 4096 });

  wss.on('connection', (socket) => {
    socket.isAlive = true;
    const playerId = nextPlayerNum++;
    let playerRoom = null;
    let playerName = null;
    let messageCount = 0;

    socket.on('pong', () => {
      socket.isAlive = true;
    });

    socket.on('error', (err) => {
      console.error('Socket error:', err.message);
    });

    const joinTimeout = setTimeout(() => {
      if (!playerRoom) socket.close(1008, 'Join timeout');
    }, 5000);

    const rateLimitInterval = setInterval(() => {
      messageCount = 0;
    }, 1000);

    socket.on('message', (rawData, isBinary) => {
      messageCount++;
      if (messageCount > 60) {
        socket.close(1008, 'Rate limit exceeded');
        return;
      }

      const msg = validateMessage(rawData, isBinary);
      if (!msg) {
        socket.close(1007, 'Invalid protocol');
        return;
      }

      if (socket.bufferedAmount > 50000) {
        console.warn(`Slow client detected (bufferedAmount: ${socket.bufferedAmount}).`);
      }

      if (msg.type === 'join') {
        clearTimeout(joinTimeout);
        playerName = msg.name || `Player_${playerId}`;
        const useBinary = msg.codec !== 'json';
        const room = roomManager.rooms.get(msg.room) || roomManager.createRoom(msg.room);
        playerRoom = room;

        netSim.sendWithDelay(() => {
          if (socket.readyState === 1) {
            socket.send(JSON.stringify({
              type: 'welcome',
              playerId,
              room: room.id,
              seed: room.world.seed,
            }));
            playerRoom.join(socket, playerName, playerId, useBinary);
          }
        });
      } else if (msg.type === 'codec' && playerRoom) {
        playerRoom.setPlayerCodec(socket, msg.codec !== 'json');
      } else if (msg.type === 'ping_rtt') {
        netSim.sendWithDelay(() => {
          if (socket.readyState === 1) {
            socket.send(JSON.stringify({ type: 'pong_rtt', t: msg.t }));
          }
        });
      } else if (msg.type === 'input' && playerRoom) {
        netSim.sendWithDelay(() => {
          if (playerRoom && socket.readyState === 1) {
            playerRoom.queueInput(playerId, msg);
          }
        });
      } else if (msg.type === 'chat' && playerRoom) {
        netSim.sendWithDelay(() => {
          if (playerRoom && socket.readyState === 1) {
            playerRoom.chat(playerName, msg.text);
          }
        });
      } else {
        socket.close(1007, 'Unknown type');
      }
    });

    socket.on('close', () => {
      clearInterval(rateLimitInterval);
      if (playerRoom) {
        playerRoom.leave(socket, playerName, playerId);
      }
    });
  });

  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 15000);

  wss.on('close', () => {
    clearInterval(interval);
  });

  return wss;
}