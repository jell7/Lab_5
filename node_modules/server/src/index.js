import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { PORT, LOG_DIR } from './config.js';
import { roomManager } from './rooms.js';
import { setupWebSocket } from './ws.js';

roomManager.createRoom('Alpha Sector');
roomManager.createRoom('Beta Void');

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (req.method === 'GET' && req.url === '/api/rooms') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(roomManager.getRooms()));
    return;
  }

  if (req.method === 'POST' && req.url === '/api/rooms') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 10000) req.destroy();
    });
    
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const roomId = data.id || `room-${Date.now()}`;
        roomManager.createRoom(roomId);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: roomId }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  if (req.method === 'GET' && req.url.startsWith('/api/replays/')) {
    const filename = decodeURIComponent(req.url.split('/').pop());
    
    if (filename.includes('..') || !filename.endsWith('.ndjson')) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      return res.end('Forbidden');
    }
// Статистика тіків сервера та налаштування мережі
  if (req.method === 'GET' && req.url === '/api/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(roomManager.getStats()));
    return;
  }

  // Налаштування штучної затримки / джиттера / втрат пакетів
  if (req.method === 'POST' && req.url === '/api/net') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
      if (body.length > 4096) req.destroy();
    });
    req.on('end', () => {
      try {
        const cfg = JSON.parse(body);
        netSim.configure(cfg);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(netSim.getConfig()));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }
    const filePath = path.join(LOG_DIR, filename);
    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not Found');
    }

    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    const readStream = fs.createReadStream(filePath);

    pipeline(readStream, res).catch(err => {
      console.error('Replay stream error:', err);
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

const wss = setupWebSocket(server);

server.listen(PORT, () => {
  console.log(`HTTP API Server is running on http://localhost:${PORT}`);
});

const shutdown = () => {
  console.log('\nShutting down gracefully...');
  
  wss.clients.forEach(socket => socket.close());
  
  server.close(() => {
    console.log('HTTP server closed.');
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);