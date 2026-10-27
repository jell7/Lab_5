export class SoundManager {
  constructor(audioBuffers, volume = 0.5) {
    this.audioBuffers = audioBuffers;
    this.audioCtx = null;
    this.masterGain = null;
    this.initialVolume = volume;
  }

  init() {
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioContextClass();
      
      this.masterGain = this.audioCtx.createGain();
      this.masterGain.gain.setValueAtTime(this.initialVolume, this.audioCtx.currentTime);
      this.masterGain.connect(this.audioCtx.destination);
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  setVolume(volume) {
    this.initialVolume = Math.max(0, Math.min(1, volume));
    if (this.masterGain && this.audioCtx) {
      this.masterGain.gain.setValueAtTime(this.initialVolume, this.audioCtx.currentTime);
    }
  }

  getVolume() {
    return this.initialVolume;
  }

  play(name) {
    // Якщо контекст ще не створений або заблокований — намагаємося його відновити
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioContextClass();
      this.masterGain = this.audioCtx.createGain();
      this.masterGain.gain.setValueAtTime(this.initialVolume, this.audioCtx.currentTime);
      this.masterGain.connect(this.audioCtx.destination);
    }
    
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }

    if (!this.audioBuffers[name] || !this.masterGain) {
      console.warn(`Audio buffer not found for: ${name}`);
      return;
    }
    
    const source = this.audioCtx.createBufferSource();
    source.buffer = this.audioBuffers[name];
    source.connect(this.masterGain);
    source.start(0);
  }

  listenTo(eventBus) {
    eventBus.addEventListener('fired', () => this.play('shoot'));
    eventBus.addEventListener('exploded', () => this.play('explosion'));
    eventBus.addEventListener('hit', () => this.play('explosion'));
    eventBus.addEventListener('pickup', () => this.play('pickup'));
  }
}

export const gameEvents = new EventTarget();