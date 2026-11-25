export interface NetGraphCallbacks {
  readonly onToggleBinary?: (useBinary: boolean) => void;
  readonly onApplyNetSim?: (cfg: { delayMs: number; jitterMs: number; dropRate: number }) => void;
}

export class NetGraph {
  private rttMs = 0;
  private snapshotAgeMs = 0;
  private bytesInPerSec = 0;
  private bytesOutPerSec = 0;
  private pendingInputs = 0;
  private correctionMag = 0;
  predictionEnabled = true;
  binaryEnabled = true;
  interpDelayMs = 67;

  private bytesInAcc = 0;
  private bytesOutAcc = 0;
  private lastRateTime = performance.now();
  private readonly statsBox: HTMLDivElement;

  constructor(callbacks: NetGraphCallbacks = {}) {
    const el = document.createElement('div');
    el.style.cssText = [
      'position:fixed',
      'top:10px',
      'right:10px',
      'z-index:9999',
      'background:rgba(10,14,24,0.88)',
      'color:#9ef0ff',
      'font:12px/1.45 monospace',
      'padding:10px 12px',
      'border:1px solid rgba(158,240,255,0.4)',
      'border-radius:8px',
      'min-width:245px',
    ].join(';');

    this.statsBox = document.createElement('div');
    const controlsBox = document.createElement('div');
    controlsBox.style.marginTop = '8px';
    controlsBox.style.borderTop = '1px solid rgba(158,240,255,0.25)';
    controlsBox.style.paddingTop = '6px';

    controlsBox.innerHTML = `
      <label style="display:block;cursor:pointer">
        <input type="checkbox" id="ng-pred" checked /> Prediction + Reconcile
      </label>
      <label style="display:block;cursor:pointer">
        <input type="checkbox" id="ng-bin" checked /> Binary DataView Codec
      </label>
      <label style="display:block;margin-top:4px">
        Interp: <span id="ng-interp-val">67</span> ms
        <input type="range" id="ng-interp" min="0" max="200" value="67" style="width:100%" />
      </label>
      <div style="display:flex;gap:6px;margin-top:6px">
        <button id="ng-lag-0" style="flex:1;cursor:pointer">Lag 0ms</button>
        <button id="ng-lag-100" style="flex:1;cursor:pointer">Lag 100ms</button>
      </div>
    `;

    el.appendChild(this.statsBox);
    el.appendChild(controlsBox);
    document.body.appendChild(el);

    const predInput = el.querySelector<HTMLInputElement>('#ng-pred');
    predInput?.addEventListener('change', () => {
      this.predictionEnabled = predInput.checked;
    });

    const binInput = el.querySelector<HTMLInputElement>('#ng-bin');
    binInput?.addEventListener('change', () => {
      this.binaryEnabled = binInput.checked;
      callbacks.onToggleBinary?.(this.binaryEnabled);
    });

    const interpSlider = el.querySelector<HTMLInputElement>('#ng-interp');
    const interpVal = el.querySelector<HTMLSpanElement>('#ng-interp-val');
    interpSlider?.addEventListener('input', () => {
      this.interpDelayMs = Number(interpSlider.value);
      if (interpVal) interpVal.textContent = String(this.interpDelayMs);
    });

    el.querySelector('#ng-lag-0')?.addEventListener('click', () => {
      callbacks.onApplyNetSim?.({ delayMs: 0, jitterMs: 0, dropRate: 0 });
    });

    el.querySelector('#ng-lag-100')?.addEventListener('click', () => {
      callbacks.onApplyNetSim?.({ delayMs: 100, jitterMs: 30, dropRate: 0.02 });
    });
  }

  recordIn(bytes: number): void {
    this.bytesInAcc += bytes;
    this.flushRate();
  }

  recordOut(bytes: number): void {
    this.bytesOutAcc += bytes;
    this.flushRate();
  }

  private flushRate(): void {
    const now = performance.now();
    const elapsed = now - this.lastRateTime;
    if (elapsed >= 500) {
      this.bytesInPerSec = Math.round((this.bytesInAcc * 1000) / elapsed);
      this.bytesOutPerSec = Math.round((this.bytesOutAcc * 1000) / elapsed);
      this.bytesInAcc = 0;
      this.bytesOutAcc = 0;
      this.lastRateTime = now;
    }
  }

  update(metrics: {
    rttMs: number;
    snapshotAgeMs: number;
    pendingInputs: number;
    correctionMag: number;
  }): void {
    this.rttMs = Math.round(metrics.rttMs);
    this.snapshotAgeMs = Math.round(metrics.snapshotAgeMs);
    this.pendingInputs = metrics.pendingInputs;
    this.correctionMag = Number(metrics.correctionMag.toFixed(2));
    this.flushRate();

    this.statsBox.innerHTML = [
      `<div><b>NETGRAPH (${this.binaryEnabled ? 'BINARY TS' : 'JSON TS'})</b></div>`,
      `<div>RTT: <b>${this.rttMs} ms</b> | Snap age: ${this.snapshotAgeMs} ms</div>`,
      `<div>RX: <b>${this.bytesInPerSec} B/s</b> | TX: <b>${this.bytesOutPerSec} B/s</b></div>`,
      `<div>Pending inputs: ${this.pendingInputs}</div>`,
      `<div>Correction: <b>${this.correctionMag} px</b></div>`,
    ].join('');
  }
}