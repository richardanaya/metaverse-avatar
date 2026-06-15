// Microphone-driven lip sync.
//
// Taps the mic through a Web Audio AnalyserNode, measures the time-domain
// RMS each frame, gates out background noise, and maps the result to a jaw
// open amount with a fast attack / slower release envelope so the mouth
// tracks speech without chattering. The smoothed level is pushed to
// RuthAvatar.setMouthOpen every frame.

export class VoiceMouth {
  constructor(avatar) {
    this.avatar = avatar;
    this.active = false;
    this.level = 0; // smoothed jaw amount 0..1 (also the meter value)

    this.gain = 17;     // rms → open scale (Sensitivity slider)
    this.maxOpen = 1;   // jaw cap 0..1 (Max open slider)
    this.gate = 0.015;  // noise floor below which the mouth stays shut
    this.attack = 35;   // 1/s — open quickly
    this.release = 12;  // 1/s — close more slowly

    this._stream = null;
    this._ctx = null;
    this._analyser = null;
    this._data = null;
  }

  async start() {
    if (this.active) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('microphone not available in this browser');
    }
    this._stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
    });
    this._ctx = new (window.AudioContext || window.webkitAudioContext)();
    await this._ctx.resume();
    const src = this._ctx.createMediaStreamSource(this._stream);
    this._analyser = this._ctx.createAnalyser();
    this._analyser.fftSize = 1024;
    this._analyser.smoothingTimeConstant = 0.4;
    src.connect(this._analyser);
    this._data = new Uint8Array(this._analyser.fftSize);
    this.active = true;
  }

  stop() {
    if (this._stream) for (const t of this._stream.getTracks()) t.stop();
    if (this._ctx) this._ctx.close();
    this._stream = null;
    this._ctx = null;
    this._analyser = null;
    this._data = null;
    this.active = false;
    this.level = 0;
    this.avatar.setMouthOpen(0);
  }

  update(dt) {
    if (!this.active || !this._analyser) return;
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
