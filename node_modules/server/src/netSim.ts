import { z } from 'zod';

export const NetSimPatchSchema = z.object({
  delayMs: z.number().min(0).max(5000).optional(),
  jitterMs: z.number().min(0).max(2000).optional(),
  dropRate: z.number().min(0).max(1).optional(),
});

export type NetSimConfig = {
  delayMs: number;
  jitterMs: number;
  dropRate: number;
};

export class NetworkSimulator {
  private delayMs: number;
  private jitterMs: number;
  private dropRate: number;

  constructor(initial: Partial<NetSimConfig> = {}) {
    this.delayMs = initial.delayMs ?? 0;
    this.jitterMs = initial.jitterMs ?? 0;
    this.dropRate = initial.dropRate ?? 0;
  }

  configure(patch: z.infer<typeof NetSimPatchSchema>): void {
    if (patch.delayMs !== undefined) this.delayMs = patch.delayMs;
    if (patch.jitterMs !== undefined) this.jitterMs = patch.jitterMs;
    if (patch.dropRate !== undefined) this.dropRate = patch.dropRate;
  }

  getConfig(): NetSimConfig {
    return {
      delayMs: this.delayMs,
      jitterMs: this.jitterMs,
      dropRate: this.dropRate,
    };
  }

  sendWithDelay(fn: () => void): void {
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