import * as THREE from 'three/webgpu';
import { Locomotion } from '../common/locomotion.js';

// Keyboard driving with a third-person chase camera.
//
//   W / ↑   walk forward          A / ←   turn left
//   S / ↓   walk backward         D / →   turn right
//   Shift   run (hold)            Space   jump
//   F/Home  toggle flight         E / C   fly up / down
//   X / Crouch button             crouch / stand (grounded)
//
// This is the *viewer* layer for driving an avatar: it maps the keyboard to a
// `Locomotion` controller's input flags and owns the third-person chase camera.
// Locomotion is app-level (not part of the avatar) — a game would drive motion
// its own way; this class is just one example (keyboard + chase camera).

const E_HOLD = 0.28; // s — hold E this long (grounded) to take off, else it's a jump tap
const MOVE_KEYS = [
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'KeyE', 'KeyC', 'ShiftLeft', 'ShiftRight',
];

export class PlayMode {
  constructor({ avatar, camera, controls, status, onSitChange, glbFile }) {
    this.avatar = avatar;
    this.camera = camera;
    this.controls = controls;
    this.status = status ?? { textContent: '' };
    this.onSitChange = onSitChange ?? (() => {});

    // This viewer owns the locomotion controller bound to the avatar it drives.
    // `glbFile` lets a host point at a different locomotion-clip path (e.g. when
    // the page lives in a subfolder, as in examples/).
    this.loco = new Locomotion(avatar, glbFile ? { glbFile } : undefined);

    this.active = false;
    this.keys = new Set();
    this._ePressedAt = null; // when E went down while grounded (tap vs hold)
    this._eConsumed = false; // true once a hold has triggered takeoff

    this._facing = new THREE.Vector3();
    this._target = new THREE.Vector3();
    this._prevTarget = new THREE.Vector3(); // last frame's look target (for follow delta)
    this._camDelta = new THREE.Vector3();
    this._onDown = (e) => this._key(e, true);
    this._onUp = (e) => this._key(e, false);
  }

  // Re-point at a different avatar (when the app switches the active one). The
  // retargeted clips are rig-constant, so the controller's cache is reusable.
  setAvatar(avatar) {
    if (this.active) this.exit();
    this.avatar = avatar;
    this.loco.avatar = avatar;
  }

  async enter() {
    if (this.active) return;
    await this.loco.start();
    this.active = true;
    this._ePressedAt = null;
    this._eConsumed = false;
    this._prevCrouching = false;
    this.keys.clear();
    document.body.classList.add('play-mode');

    // Third-person orbit camera: keep OrbitControls live so the mouse can orbit
    // and zoom around the character, but lock panning (the target stays on the
    // body) and start behind the facing direction for a sensible first view.
    this.controls.enabled = true;
    this._prevPanEnabled = this.controls.enablePan;
    this.controls.enablePan = false;
    {
      const g = this.avatar.group;
      const s = g.scale.x || 1;
      const yaw = this.loco.yaw;
      const facing = this._facing.set(Math.cos(yaw), 0, -Math.sin(yaw));
      const target = this._target.set(g.position.x, g.position.y + 1.25 * s, g.position.z);
      this.camera.position.copy(target).addScaledVector(facing, -3.0 * s);
      this.camera.position.y += 0.5 * s;
      this.controls.target.copy(target);
      this._prevTarget.copy(target);
      this.controls.update();
    }

    window.addEventListener('keydown', this._onDown);
    window.addEventListener('keyup', this._onUp);
  }

  exit() {
    if (!this.active) return;
    this.active = false;
    window.removeEventListener('keydown', this._onDown);
    window.removeEventListener('keyup', this._onUp);
    document.body.classList.remove('play-mode');
    this.loco.stop();
    const g = this.avatar.group;
    this.controls.enabled = true;
    this.controls.enablePan = this._prevPanEnabled ?? true;
    this.controls.target.set(g.position.x, 0.9 * (g.scale.x || 1), g.position.z);
    this.controls.update();
  }

  statusText() {
    const loco = this.loco;
    const inp = loco.input;
    const mode = loco.flying ? 'flying' : loco.crouching ? 'crouching'
      : inp.run && (inp.forward || inp.back) ? 'running' : 'walking';
    this.status.textContent = `play — ${mode}  ·  WASD move · Shift run · F fly · Space jump · X crouch`;
  }

  tapSit() {
    if (!this.active) return false;
    const ok = this.loco.toggleSit();
    if (ok) {
      this.statusText();
      this.onSitChange();
    }
    return ok;
  }

  _key(e, down) {
    if (!this.active || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    const c = e.code;
    if (down) {
      if (c === 'KeyX') { e.preventDefault(); this.tapSit(); return; }
      if (c === 'KeyF' || c === 'Home') { e.preventDefault(); this.loco.toggleFly(); this.statusText(); return; }
      if (c === 'Space') { e.preventDefault(); this.loco.jump(); return; }
      // E (grounded): start tap/hold timing — tap jumps, hold takes off
      // (update() promotes a sustained hold to flight). `== null` ignores the
      // OS key-repeat keydowns so the timer isn't reset while held.
      if (c === 'KeyE' && !this.loco.flying && this._ePressedAt == null) {
        this._ePressedAt = performance.now() / 1000;
        this._eConsumed = false;
      }
    } else if (c === 'KeyE') {
      // released: a short press that never became a hold is a jump
      if (!this.loco.flying && !this._eConsumed) this.loco.jump();
      this._ePressedAt = null;
      this._eConsumed = false;
    }
    if (MOVE_KEYS.includes(c)) {
      e.preventDefault();
      if (down) this.keys.add(c); else this.keys.delete(c);
    }
  }

  _has(...codes) { return codes.some((c) => this.keys.has(c)); }

  update(dt) {
    if (!this.active) return;
    const loco = this.loco;

    // ---- E held past the threshold (grounded) -> take off ----
    if (this._ePressedAt != null && !loco.flying && !this._eConsumed &&
        performance.now() / 1000 - this._ePressedAt > E_HOLD) {
      loco.setFlying(true);
      this._eConsumed = true; // so the eventual key-up doesn't also jump
      this.statusText();
    }

    // ---- map the keyboard onto the avatar's movement intent ----
    loco.setInput({
      forward: this._has('KeyW', 'ArrowUp'),
      back: this._has('KeyS', 'ArrowDown'),
      left: this._has('KeyA', 'ArrowLeft'),
      right: this._has('KeyD', 'ArrowRight'),
      up: this._has('KeyE'),
      down: this._has('KeyC'),
      run: this._has('ShiftLeft', 'ShiftRight'),
    });
    loco.update(dt);
    if (this._prevCrouching !== loco.crouching) {
      this._prevCrouching = loco.crouching;
      this.onSitChange();
    }

    // ---- orbit-follow camera ----
    // The user orbits/zooms with the mouse (OrbitControls). We keep the look
    // target on the character's head and shift the camera by the character's
    // per-frame movement, so the chosen orbit angle/distance is preserved while
    // the camera tracks the body. controls.update() applies the mouse input.
    const g = this.avatar.group;
    const s = g.scale.x || 1;
    const headH = 1.25 * s;
    const target = this._target.set(g.position.x, g.position.y + headH, g.position.z);
    const delta = this._camDelta.subVectors(target, this._prevTarget);
    this.camera.position.add(delta);
    this.controls.target.copy(target);
    this._prevTarget.copy(target);
    this.controls.update();
  }
}
