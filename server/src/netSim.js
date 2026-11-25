export class NetworkSimulator {
  constructor({ delayMs = 0, jitterMs = 0, dropRate = 0 } = {}) {
    this.delayMs = delayMs;
    this.jitterMs = jitterMs;
    this.dropRate = dropRate;
  }

  configure({ delayMs, jitterMs, dropRate }) {
    if (typeof delayMs === 'number') this.delayMs = Math.max(0, delayMs);
    if (typeof jitterMs === 'number') this.jitterMs = Math.max(0, jitterMs);
    if (typeof dropRate === 'number') this.dropRate = Math.max(0, Math.min(1, dropRate));
  }

  getConfig() {
    return {
      delayMs: this.delayMs,
      jitterMs: this.jitterMs,
      dropRate: this.dropRate,
    };
  }

  sendWithDelay(fn) {
    if (this.dropRate > 0 && Math.random() < this.dropRate) {
      return;
    }
    const jitter = this.jitterMs > 0 ? (Math.random() * 2 - 1) * this.jitterMs : 0;
    const wait = Math.max(0, Math.round(this.delayMs + jitter));

    if (wait === 0) {
      fn();
    } else {
      setTimeout(fn, wait);
    }
  }
}

export const netSim = new NetworkSimulator();