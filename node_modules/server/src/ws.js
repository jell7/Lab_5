import { WebSocketServer } from 'ws';
import { validateMessage } from './protocol.js';
import { roomManager } from './rooms.js';

export function setupWebSocket(server) {
  const wss = new WebSocketServer({ server, maxPayload: 4096 });

  wss.on('connection', (socket) => {
    socket.isAlive = true;
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

    socket.on('message', (rawData) => {
      messageCount++;
      
      if (messageCount > 20) {
        socket.close(1008, 'Rate limit exceeded');
        return;
      }

      const msg = validateMessage(rawData);
      if (!msg) {
        socket.close(1007, 'Invalid protocol');
        return;
      }

      if (socket.bufferedAmount > 50000) {
        console.warn(`Slow client detected (bufferedAmount: ${socket.bufferedAmount}).`);
      }

      if (msg.type === 'join') {
        clearTimeout(joinTimeout);
        playerName = msg.name || 'Anonymous';
        const room = roomManager.rooms.get(msg.room);
        
        if (!room) {
          socket.close(1008, 'Room not found');
          return;
        }
        playerRoom = room;
        playerRoom.join(socket, playerName);
      } 
      else if (msg.type === 'chat' && playerRoom) {
        playerRoom.chat(playerName, msg.text);
      } 
      else {
        socket.close(1007, 'Unknown type');
      }
    });

    socket.on('close', () => {
      clearInterval(rateLimitInterval);
      if (playerRoom) {
        playerRoom.leave(socket, playerName);
      }
    });
  });

  // Перевірка "мертвих" з'єднань кожні 15 секунд (перевірка пінгів)
  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        return ws.terminate(); // Розриваємо з'єднання, якщо клієнт не відповів на ping
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