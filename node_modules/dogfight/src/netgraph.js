export class NetGraph {
  constructor({ onTogglePrediction, onToggleBinary, onChangeInterpDelay, onApplyNetSim } = {}) {
    this.rttMs = 0;
    this.snapshotAgeMs = 0;
    this.bytesInPerSec = 0;
    this.bytesOutPerSec = 0;
    this.pendingInputs = 0;
    this.correctionMag = 0;
    this.predictionEnabled = true;
    this.binaryEnabled = true;
    this.interpDelayMs = 67;

    this._bytesInAcc = 0;
    this._bytesOutAcc = 0;
    this._lastRateTime = performance.now();

    this.el = document.createElement('div');
    this.el.style.cssText = [
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
    this.controlsBox = document.createElement('div');
    this.controlsBox.style.marginTop = '8px';
    this.controlsBox.style.borderTop = '1px solid rgba(158,240,255,0.25)';
    this.controlsBox.style.paddingTop = '6px';

    this.controlsBox.innerHTML = `
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

    this.el.appendChild(this.statsBox);
    this.el.appendChild(this.controlsBox);
    document.body.appendChild(this.el);

    this.el.querySelector('#ng-pred').addEventListener('change', (e) => {
      this.predictionEnabled = e.target.checked;
      if (onTogglePrediction) onTogglePrediction(this.predictionEnabled);
    });

    this.el.querySelector('#ng-bin').addEventListener('change', (e) => {
      this.binaryEnabled = e.target.checked;
      if (onToggleBinary) onToggleBinary(this.binaryEnabled);
    });

    const interpSlider = this.el.querySelector('#ng-interp');
    const interpVal = this.el.querySelector('#ng-interp-val');
    interpSlider.addEventListener('input', () => {
      this.interpDelayMs = Number(interpSlider.value);
      interpVal.textContent = String(this.interpDelayMs);
      if (onChangeInterpDelay) onChangeInterpDelay(this.interpDelayMs);
    });

    this.el.querySelector('#ng-lag-0').addEventListener('click', () => {
      if (onApplyNetSim) onApplyNetSim({ delayMs: 0, jitterMs: 0, dropRate: 0 });
    });

    this.el.querySelector('#ng-lag-100').addEventListener('click', () => {
      if (onApplyNetSim) onApplyNetSim({ delayMs: 100, jitterMs: 30, dropRate: 0.02 });
    });
  }

  recordIn(bytes) {
    this._bytesInAcc += bytes;
    this._flushRate();
  }

  recordOut(bytes) {
    this._bytesOutAcc += bytes;
    this._flushRate();
  }

  _flushRate() {
    const now = performance.now();
    const elapsed = now - this._lastRateTime;
    if (elapsed >= 500) {
      this.bytesInPerSec = Math.round((this._bytesInAcc * 1000) / elapsed);
      this.bytesOutPerSec = Math.round((this._bytesOutAcc * 1000) / elapsed);
      this._bytesInAcc = 0;
      this._bytesOutAcc = 0;
      this._lastRateTime = now;
    }
  }

  update({ rttMs, snapshotAgeMs, pendingInputs, correctionMag }) {
    if (typeof rttMs === 'number') this.rttMs = Math.round(rttMs);
    if (typeof snapshotAgeMs === 'number') this.snapshotAgeMs = Math.round(snapshotAgeMs);
    if (typeof pendingInputs === 'number') this.pendingInputs = pendingInputs;
    if (typeof correctionMag === 'number') this.correctionMag = Number(correctionMag.toFixed(2));
    this._flushRate();

    this.statsBox.innerHTML = [
      `<div><b>NETGRAPH (${this.binaryEnabled ? 'BINARY' : 'JSON'})</b></div>`,
      `<div>RTT: <b>${this.rttMs} ms</b> | Snap age: ${this.snapshotAgeMs} ms</div>`,
      `<div>RX: <b>${this.bytesInPerSec} B/s</b> | TX: <b>${this.bytesOutPerSec} B/s</b></div>`,
      `<div>Pending inputs: ${this.pendingInputs}</div>`,
      `<div>Correction: <b>${this.correctionMag} px</b></div>`,
    ].join('');
  }
}