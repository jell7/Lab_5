import fs from 'node:fs';
import { Transform } from 'node:stream';
import { LOG_DIR } from '../config.js';

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

export class JsonLinesTransform extends Transform {
  constructor() {
    super({ objectMode: true });
  }

  _transform(chunk, encoding, callback) {
    const eventData = Array.isArray(chunk) ? chunk[0] : chunk;
    this.push(JSON.stringify(eventData) + '\n');
    callback();
  }
}