import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  asEntityId,
  parseClientMessage,
  type ClientMessage,
  type ParseResult,
  type ServerMessage,
} from 'shared/protocol';
import { decodeBinaryInput, encodeJson } from 'shared/codec';
import { roomManager, type Room } from './rooms.js';
import { netSim } from './netSim.js';

interface AliveWebSocket extends WebSocket {
  isAlive?: boolean;
}

let nextPlayerNum = 1;

function sendJson(socket: WebSocket, msg: ServerMessage): void {
  if (socket.readyState === 1) {
    socket.send(encodeJson(msg));
  }
}

export function setupWebSocket(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server, maxPayload: 4096 });

  wss.on('connection', (rawSocket: WebSocket) => {
    const socket: AliveWebSocket = rawSocket;
    socket.isAlive = true;
    const playerId = asEntityId(nextPlayerNum++);
    let playerRoom: Room | null = null;
    let playerName = `Pilot_${playerId}`;
    let messageCount = 0;

    socket.on('pong', () => {
      socket.isAlive = true;
    });

    socket.on('error', (err: Error) => {
      console.error('Socket error:', err.message);
    });

    const joinTimeout = setTimeout(() => {
      if (!playerRoom) socket.close(1008, 'Join timeout');
    }, 5000);

    const rateLimitInterval = setInterval(() => {
      messageCount = 0;
    }, 1000);

    socket.on('message', (rawData: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
      messageCount++;
      if (messageCount > 60) {
        socket.close(1008, 'Rate limit exceeded');
        return;
      }

      let parsed: ParseResult<ClientMessage>;
      if (isBinary) {
        if (Array.isArray(rawData)) {
          parsed = decodeBinaryInput(Buffer.concat(rawData));
        } else {
          parsed = decodeBinaryInput(rawData);
        }
      } else {
        const text = Array.isArray(rawData)
          ? Buffer.concat(rawData).toString('utf8')
          : Buffer.isBuffer(rawData)
            ? rawData.toString('utf8')
            : new TextDecoder().decode(rawData);
        parsed = parseClientMessage(text);
      }

      if (!parsed.ok) {
        console.warn(`Invalid client payload from #${playerId}: ${parsed.error}`);
        socket.close(1007, 'Invalid protocol');
        return;
      }

      if (socket.bufferedAmount > 50000) {
        console.warn(`Slow client detected (bufferedAmount: ${socket.bufferedAmount}).`);
      }

      const msg = parsed.data;
      switch (msg.type) {
        case 'join': {
          clearTimeout(joinTimeout);
          playerName = msg.name;
          const codec = msg.codec ?? 'binary';
          const room = roomManager.rooms.get(msg.room) ?? roomManager.createRoom(msg.room);
          playerRoom = room;

          netSim.sendWithDelay(() => {
            sendJson(socket, {
              type: 'welcome',
              playerId,
              room: room.id,
              seed: room.world.seed,
            });
            room.join(socket, playerName, playerId, codec);
          });
          break;
        }
        case 'input': {
          if (!playerRoom) break;
          const activeRoom = playerRoom;
          netSim.sendWithDelay(() => {
            activeRoom.queueInput(playerId, msg);
          });
          break;
        }
        case 'chat': {
          if (!playerRoom) break;
          const activeRoom = playerRoom;
          netSim.sendWithDelay(() => {
            activeRoom.chat(playerName, msg.text);
          });
          break;
        }
        case 'codec': {
          if (playerRoom) {
            playerRoom.setPlayerCodec(socket, msg.codec);
          }
          break;
        }
        case 'ping_rtt': {
          netSim.sendWithDelay(() => {
            sendJson(socket, { type: 'pong_rtt', t: msg.t });
          });
          break;
        }
        default: {
          const _exhaustive: never = msg;
          return _exhaustive;
        }
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
    wss.clients.forEach((client) => {
      const ws: AliveWebSocket = client;
      if (ws.isAlive === false) {
        ws.terminate();
        return;
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