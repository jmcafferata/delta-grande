import { AssetLoader } from './AssetLoader.js';

export const AudioManager = {
  unlocked: false,
  audioContext: null,
  audios: {},

  async unlock() {
    if (this.unlocked) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) {
        this.unlocked = true;
        return;
      }
      this.audioContext = new Ctx();
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      // Create a tiny silent buffer and play it to ensure the context is active
      const buffer = this.audioContext.createBuffer(1, 1, this.audioContext.sampleRate);
      const src = this.audioContext.createBufferSource();
      src.buffer = buffer;
      src.connect(this.audioContext.destination);
      src.start(0);

      this.unlocked = true;
      return;
    } catch (e) {
      console.warn('AudioManager.unlock fallback:', e);
      this.unlocked = true;
    }
  },

  load(name, url, opts = {}) {
    // Crear elemento Audio de forma tradicional (sin depender de AssetLoader)
    const a = new Audio();
    a.src = url;
    a.preload = 'auto';
    a.crossOrigin = 'anonymous';
    a.loop = !!opts.loop;
    if (typeof opts.volume === 'number') a.volume = opts.volume;
    try { a.load(); } catch (e) { /* ignore */ }
    // Intentar agregar al DOM oculto para maximizar compatibilidad en algunos navegadores
    try {
      a.style.display = 'none';
      document.body && document.body.appendChild(a);
    } catch (e) {}
    this.audios[name] = a;
    return a;
  },

  play(nameOrUrl, opts = {}) {
    let a = null;
    if (this.audios[nameOrUrl]) a = this.audios[nameOrUrl];
    else if (typeof nameOrUrl === 'string') {
      // Treat as URL — cache by URL
      if (!this.audios[nameOrUrl]) this.audios[nameOrUrl] = AssetLoader.audio(nameOrUrl);
      a = this.audios[nameOrUrl];
    }

    if (!a) {
      console.warn('AudioManager.play: audio not found', nameOrUrl);
      return null;
    }

    if (typeof opts.loop !== 'undefined') a.loop = !!opts.loop;
    if (typeof opts.volume === 'number') a.volume = opts.volume;

    a.play().catch(async (e) => {
      console.warn('Audio play failed (maybe blocked by browser). Trying WebAudio fallback:', e);
      // Fallback: try to fetch + decode via Web Audio API and play buffer source
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!this.audioContext && Ctx) {
          this.audioContext = new Ctx();
          if (this.audioContext.state === 'suspended') await this.audioContext.resume();
        }

        if (!this.audioContext) {
          console.warn('No WebAudio AudioContext available for fallback');
          return;
        }

        const resp = await fetch(a.src, { mode: 'cors' });
        if (!resp.ok) {
          console.warn('Fallback fetch failed', resp.status, resp.statusText);
          return;
        }
        const arrayBuffer = await resp.arrayBuffer();
        const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer.slice(0));
        const srcNode = this.audioContext.createBufferSource();
        srcNode.buffer = audioBuffer;
        srcNode.loop = a.loop;
        const gainNode = this.audioContext.createGain();
        gainNode.gain.value = typeof a.volume === 'number' ? a.volume : 1.0;
        srcNode.connect(gainNode);
        gainNode.connect(this.audioContext.destination);
        srcNode.start(0);

        // store node so we can stop it later
        this._bufferNodes = this._bufferNodes || {};
        this._bufferNodes[name] = { srcNode, gainNode };
      } catch (err2) {
        console.warn('WebAudio fallback also failed:', err2);
      }
    });
    return a;
  },

  pause(name) {
    const a = this.audios[name];
    if (a) a.pause();
  },

  stop(name) {
    const a = this.audios[name];
    if (a) {
      a.pause();
      try { a.currentTime = 0; } catch (e) {}
    }
  },

  setVolume(name, volume) {
    const a = this.audios[name];
    if (a) a.volume = volume;
  },

  stopAll() {
    Object.keys(this.audios).forEach(name => {
      this.stop(name);
    });

    if (this._bufferNodes) {
      Object.values(this._bufferNodes).forEach(node => {
        try {
          if (node && node.srcNode) node.srcNode.stop();
        } catch (e) { }
      });
      this._bufferNodes = {};
    }
  }
};
