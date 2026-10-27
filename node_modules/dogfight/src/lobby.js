import { fetchJson, withRetry } from './assets/loader.js';

export class Lobby extends EventTarget {
  constructor(apiUrl = '/assets/manifest.json') {
    super();
    this.apiUrl = apiUrl;
    this.rooms = [];
    this.controller = null;
    this.timer = null;
  }

  async refresh() {
    this.controller = new AbortController();
    try {
      // Використовуємо AbortSignal.timeout для обмеження часу запиту
      const signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(3000)]);
      const data = await withRetry(() => fetchJson(this.apiUrl, { signal }), { signal });
      
      this.rooms = data.rooms || [];
      this.dispatchEvent(new CustomEvent('roomsUpdated', { detail: this.rooms }));
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.warn('Failed to fetch rooms:', error);
      }
    }
  }

  startAutoRefresh(intervalMs = 5000) {
    this.refresh();
    this.timer = setInterval(() => this.refresh(), intervalMs);
  }

  destroy() {
    if (this.timer) clearInterval(this.timer);
    if (this.controller) this.controller.abort();
  }

  join(roomId) {
    this.destroy();
    this.dispatchEvent(new CustomEvent('roomJoined', { detail: roomId }));
  }
}