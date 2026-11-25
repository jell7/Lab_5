import fs from 'node:fs';
import { Transform, type TransformCallback } from 'node:stream';
import { config } from '../config.js';

if (!fs.existsSync(config.LOG_DIR)) {
  fs.mkdirSync(config.LOG_DIR, { recursive: true });
}

export class JsonLinesTransform extends Transform {
  constructor() {
    super({ objectMode: true });
  }

  override _transform(chunk: unknown, _encoding: BufferEncoding, callback: TransformCallback): void {
    const eventData = Array.isArray(chunk) ? chunk[0] : chunk;
    this.push(JSON.stringify(eventData) + '\n');
    callback();
  }
}