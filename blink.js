// Procedural eye blinking.
//
// Schedules blinks at a randomized interval and plays each as a quick
// close→open envelope driving RuthAvatar.setBlink. Defaults follow the
// cadence games use for an idle character: a blink every few seconds, ~120 ms
// long, with enough interval jitter that it never reads as metronomic.

export class Blinker {
  constructor(avatar) {
    this.avatar = avatar;
    this.enabled = false;

    this.interval = 3.5;   // mean seconds between blinks
    this.variation = 0.5;  // 0..1 — fraction the interval is randomly jittered
    this.speed = 0.12;     // seconds for one full close→open

    this._timer = 0;       // counts down to the next blink
    this._phase = -1;      // -1 = idle between blinks; 0..1 = mid-blink
    this._schedule();
  }

  setEnabled(on) {
    this.enabled = on;
    this._phase = -1;
    this._schedule();
    if (!on) this.avatar.setBlink(0); // leave the eyes open when turned off
  }

  // Force a blink right now (used by the UI "Blink now" button / on enable).
  blinkNow() {
    if (this._phase < 0) this._phase = 0;
  }

  _schedule() {
    const jitter = 1 + (Math.random() * 2 - 1) * this.variation;
    this._timer = Math.max(0.2, this.interval * jitter);
  }

  update(dt) {
    if (!this.enabled) return;

    if (this._phase >= 0) {
      this._phase += dt / Math.max(0.04, this.speed);
      if (this._phase >= 1) {
        this._phase = -1;
        this.avatar.setBlink(0);
        this._schedule();
      } else {
        // sin(pi·phase) sweeps 0→1→0 — a smooth, eyelid-like close and open.
        this.avatar.setBlink(Math.sin(Math.PI * this._phase));
      }
      return;
    }

    this._timer -= dt;
    if (this._timer <= 0) this._phase = 0;
  }
}
