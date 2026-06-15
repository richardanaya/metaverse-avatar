// Audio-clip-driven lip sync (the playback counterpart to VoiceMouth).
//
// Plays a speech clip (xAI TTS audio relayed by the MCP server) out loud
// through Web Audio. When a viseme timing file accompanies the clip, the
// mouth is shaped per-viseme from the precise playback time; otherwise it
// falls back to the microphone-style AnalyserNode RMS → jaw mapping. One
// clip plays at a time; starting a new one cancels the previous.

import { buildVisemeTimeline, sampleViseme } from './visemes.js';

export class SpeechMouth {
  constructor(avatar) {
    this.avatar = avatar;
    this.active = false;
    this.level = 0; // smoothed jaw amount 0..1 (RMS fallback)

    // RMS-fallback envelope (matches VoiceMouth).
    this.gain = 17;
    this.maxOpen = 1;
    this.gate = 0.015;
    this.attack = 35;
    this.release = 12;

    this._ctx = null;      // reused across clips (browsers cap AudioContexts)
    this._audio = null;
    this._src = null;
    this._analyser = null;
    this._data = null;

    this._timeline = null;                       // viseme segments, or null
    this._m = { open: 0, round: 0, wide: 0 };    // smoothed viseme controls
    this._out = { open: 0, round: 0, wide: 0 };  // scratch passed to setMouth
  }

  // Play the clip at `url` and lip-sync to it. If `visemeUrl` is given, fetch
  // the viseme timing file and drive per-viseme mouth shapes; otherwise use
  // the amplitude fallback. Resolves once playback begins, returning
  // { duration } (seconds, or null if unknown).
  async play(url, visemeUrl) {
    this.stop();
    if (!this._ctx) this._ctx = new (window.AudioContext || window.webkitAudioContext)();
    await this._ctx.resume(); // may stay suspended without a prior user gesture

    // Viseme timing is fetched in parallel with audio setup; same-origin.
    const timelinePromise = visemeUrl
      ? fetch(visemeUrl).then((r) => r.json()).then(buildVisemeTimeline).catch(() => null)
      : Promise.resolve(null);

    const audio = new Audio();
    audio.crossOrigin = 'anonymous';
    audio.src = url;

    const src = this._ctx.createMediaElementSource(audio);
    const analyser = this._ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.4;
    src.connect(analyser);
    analyser.connect(this._ctx.destination); // route to speakers + the meter
    this._audio = audio;
    this._src = src;
    this._analyser = analyser;
    this._data = new Uint8Array(analyser.fftSize);

    await new Promise((resolve, reject) => {
      audio.addEventListener('loadedmetadata', resolve, { once: true });
      audio.addEventListener('error', () => reject(new Error(`failed to load audio: ${url}`)), { once: true });
    });
    audio.addEventListener('ended', () => this.stop(), { once: true });

    this._timeline = await timelinePromise;
    this._m.open = this._m.round = this._m.wide = 0;
    this.active = true;
    await audio.play();
    return { duration: Number.isFinite(audio.duration) ? audio.duration : null, visemes: !!this._timeline };
  }

  stop() {
    if (this._audio) {
      this._audio.pause();
      this._audio.removeAttribute('src');
    }
    this._src?.disconnect();
    this._analyser?.disconnect();
    this._audio = null;
    this._src = null;
    this._analyser = null;
    this._data = null;
    this._timeline = null;
    this._m.open = this._m.round = this._m.wide = 0;
    this.active = false;
    this.level = 0;
    this.avatar.setMouth?.({ open: 0, round: 0, wide: 0 });
    this.avatar.setMouthOpen(0);
  }

  update(dt) {
    if (!this.active) return;

    // Viseme mode: shape the mouth from the precise playback time.
    if (this._timeline) {
      const t = this._audio ? this._audio.currentTime : 0;
      const target = sampleViseme(this._timeline, t);
      const k = 1 - Math.exp(-22 * Math.min(dt, 0.1)); // smooth coarticulation
      this._m.open += (target.open - this._m.open) * k;
      this._m.round += (target.round - this._m.round) * k;
      this._m.wide += (target.wide - this._m.wide) * k;
      // "Max open" caps the jaw; lip round/spread shapes stay full so visemes
      // remain legible even at a low cap.
      this._out.open = this._m.open * this.maxOpen;
      this._out.round = this._m.round;
      this._out.wide = this._m.wide;
      this.avatar.setMouth(this._out);
      return;
    }

    // Fallback: amplitude-driven jaw.
    if (!this._analyser) return;
    this._analyser.getByteTimeDomainData(this._data);
    let sum = 0;
    for (let i = 0; i < this._data.length; i++) {
      const v = (this._data[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / this._data.length);
    const target = Math.min(1, Math.max(0, (rms - this.gate) * this.gain));
    const k = target > this.level ? this.attack : this.release;
    this.level += (target - this.level) * (1 - Math.exp(-k * Math.min(dt, 0.1)));
    this.avatar.setMouthOpen(this.level * this.maxOpen);
  }
}
