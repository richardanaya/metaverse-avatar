// Keyboard driving + third-person chase camera — a self-contained copy bundled
// with this example so it depends only on `Avatar` (imported in index.html), not
// on the repo's internal app files. Drop this file into your own project and
// adapt it; it's just one way to move an avatar around.
//
//   W A S D / arrows   move + turn        Shift   run (hold)
//   F / Home           toggle flight      E / C   fly up / down
//   Space              jump               X       crouch
//
// How it's split:
//   • Locomotion — translates/rotates `avatar.group` and cross-fades the bundled
//     walk/run/idle/jump/hover clips. Input-driven and camera-agnostic.
//   • PlayMode   — maps the keyboard onto Locomotion's inputs and runs the chase
//     camera.
//
// The only thing it borrows from the library besides the avatar itself is the
// glTF clip loader (initGltfAnim/getGltfClip) used to fetch + retarget the
// bundled locomotion animations.

import * as THREE from 'three';
import { initGltfAnim, getGltfClip } from '../../index.js';

// ---------------------------------------------------------------------------
// Locomotion
// ---------------------------------------------------------------------------

const LOCO_GLB = '../../anims/UAL1_Standard.glb'; // bundled clips at repo root (relative to the page)
const LOCO_ANIMS = {
  walk: 'Walk_Loop',
  run: 'Jog_Fwd_Loop',
  stand: 'Idle_Loop',
  jump: 'Jump_Start',
  hover: 'Swim_Idle_Loop',
  crouchIdle: 'Crouch_Idle_Loop',
  crouchWalk: 'Crouch_Fwd_Loop',
};

const WALK_SPEED = 1.5, RUN_SPEED = 4.0, CROUCH_SPEED = 1.1, BACK_FACTOR = 0.6;
const TURN_RATE = 2.6, FLY_SPEED = 2.2, BOUND_R = 5.2, HOP = 0.65;
const FADE_NORMAL = 0.25;
const FADE_SNAP = 0.15; // jump + crouch transitions

export class Locomotion {
  constructor(avatar, { glbFile = LOCO_GLB, bounds = BOUND_R } = {}) {
    this.avatar = avatar;
    this.glbFile = glbFile;
    this.bounds = bounds;

    this.active = false;
    this.flying = false;
    this.yaw = 0;
    this.jumpTimer = 0;
    this.jumpDur = 1;
    this.crouching = false;
    this._vy = 0;            // vertical velocity for gravity fall
    this._gravity = 9.8;     // m/s²

    // Per-frame movement intent — set these (or call setInput) before update().
    this.input = {
      forward: false, back: false, left: false, right: false,
      up: false, down: false, run: false,
    };

    this._clips = null;
    this._stateKey = null;
    this._facing = new THREE.Vector3();
  }

  // Load (and retarget) the bundled locomotion clips. Safe to call repeatedly.
  async load() {
    if (this._clips) return;
    await initGltfAnim(this.glbFile, this.avatar);
    this._clips = {};
    for (const [key, name] of Object.entries(LOCO_ANIMS)) {
      const clip = getGltfClip(this.glbFile, name);
      if (!clip) throw new Error(`locomotion clip not found: ${name}`);
      this._clips[key] = clip;
    }
    this.jumpDur = this._clips.jump.duration;
  }

  // Begin locomotion control. Loads clips on first use; resets transient state.
  async start() {
    if (this.active) return;
    await this.load();
    this.active = true;
    this.flying = false;
    this.jumpTimer = 0;
    this.crouching = false;
    this._vy = 0;
    this.setInput({
      forward: false, back: false, left: false, right: false,
      up: false, down: false, run: false,
    });
    this.yaw = this.avatar.group.rotation.y;
    this._stateKey = null;
    this._setState('stand');
  }

  // Release control: stop the clips and drop the figure back to the ground.
  stop() {
    if (!this.active) return;
    this.active = false;
    this.avatar.stop();
    this.avatar.group.position.y = 0;
  }

  setInput(partial) { Object.assign(this.input, partial); }
  toggleFly() { this.flying = !this.flying; if (this.flying) this._vy = 0; }
  setFlying(on) { if (on !== this.flying) this.toggleFly(); }
  // Begin a jump hop (ignored while already jumping, flying, or crouching).
  jump() {
    if (!this.flying && !this.crouching && this.jumpTimer <= 0) this.jumpTimer = this.jumpDur;
  }
  // Toggle crouch on the ground. Returns true when a transition starts.
  toggleSit() {
    const g = this.avatar.group;
    if (this.flying || this.jumpTimer > 0 || g.position.y > 0.001) return false;
    this.crouching = !this.crouching;
    this._setState(this._locomotionKey());
    return true;
  }

  _locomotionKey() {
    const inp = this.input;
    const moving = inp.forward || inp.back;
    if (this.jumpTimer > 0) return 'jump';
    if (this.flying) return 'hover';
    if (this.crouching) return moving ? 'crouchWalk' : 'crouchIdle';
    return moving ? (inp.run ? 'run' : 'walk') : 'stand';
  }

  _setState(key) {
    if (this._stateKey === key) return;
    const prev = this._stateKey;
    this._stateKey = key;
    const clip = this._clips[key] ?? this._clips.stand;
    const oneShot = key === 'jump';
    // Cross-fade between locomotion states so transitions blend instead of
    // popping. Never clear _stateKey before calling this — fade is 0 when prev
    // is null, which hard-cuts instead of blending.
    const crouch = key === 'crouchIdle' || key === 'crouchWalk';
    const wasCrouch = prev === 'crouchIdle' || prev === 'crouchWalk';
    const fade = !prev ? 0 : oneShot || prev === 'jump' || crouch || wasCrouch
      ? FADE_SNAP : FADE_NORMAL;
    this.avatar.crossFadeTo(clip, fade, !oneShot);
    // first state (fade 0) hard-plays after a rest snap; evaluate frame 0 now so
    // this render shows the new pose, not a one-frame flash of the bind pose.
    if (!fade) this.avatar.update(0);
  }

  update(dt) {
    if (!this.active) return;
    const g = this.avatar.group;
    const s = g.scale.x || 1;
    const inp = this.input;

    // ---- turn ----
    if (inp.left) this.yaw += TURN_RATE * dt;
    if (inp.right) this.yaw -= TURN_RATE * dt;
    g.rotation.y = this.yaw;

    // ---- translate along facing ----
    const fwd = inp.forward;
    const back = inp.back;
    const facing = this._facing.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const speed = (this.crouching ? CROUCH_SPEED : inp.run ? RUN_SPEED : WALK_SPEED) * s;
    if (fwd) g.position.addScaledVector(facing, speed * dt);
    if (back) g.position.addScaledVector(facing, -speed * BACK_FACTOR * dt);

    const r = Math.hypot(g.position.x, g.position.z);
    if (r > this.bounds * s) { g.position.x *= (this.bounds * s) / r; g.position.z *= (this.bounds * s) / r; }

    // ---- vertical: flight, gravity fall, then jump hop ----
    if (this.flying) {
      const dy = (inp.up ? 1 : 0) - (inp.down ? 1 : 0);
      g.position.y = Math.max(0, g.position.y + dy * FLY_SPEED * dt);
      this._vy = 0; // reset fall velocity while flying
    } else if (g.position.y > 0) {
      // gravity — fall from the sky when flight is toggled off
      this._vy -= this._gravity * dt;
      g.position.y = Math.max(0, g.position.y + this._vy * dt);
    } else {
      g.position.y = 0;
      this._vy = 0;
    }
    if (this.jumpTimer > 0) {
      this.jumpTimer = Math.max(0, this.jumpTimer - dt);
      const u = 1 - this.jumpTimer / this.jumpDur; // 0..1 through the jump
      if (!this.flying) g.position.y = HOP * s * Math.sin(Math.PI * u);
    }

    // ---- animation state + clip playback speed ----
    const key = this._locomotionKey();
    this._setState(key);
    if (key === 'walk' || key === 'run' || key === 'crouchWalk') {
      const fast = key === 'run';
      let ts = fast ? 1.0 : key === 'crouchWalk' ? 1.0 : 1.05;
      if (back && !fwd) ts = -(fast ? 1.2 : 1.0);
      this.avatar.setSpeed(ts);
    } else {
      this.avatar.setSpeed(1);
    }
  }
}

// ---------------------------------------------------------------------------
// PlayMode — keyboard input + chase camera around a Locomotion controller
// ---------------------------------------------------------------------------

const E_HOLD = 0.28; // s — hold E this long (grounded) to take off, else it's a jump tap
const MOVE_KEYS = [
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'KeyE', 'KeyC', 'ShiftLeft', 'ShiftRight',
];

export class PlayMode {
  constructor({ avatar, camera, controls }) {
    this.avatar = avatar;
    this.camera = camera;
    this.controls = controls;

    this.loco = new Locomotion(avatar);

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

  async enter() {
    if (this.active) return;
    await this.loco.start();
    this.active = true;
    this._ePressedAt = null;
    this._eConsumed = false;
    this.keys.clear();

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
    this.loco.stop();
    const g = this.avatar.group;
    this.controls.enablePan = this._prevPanEnabled ?? true;
    this.controls.target.set(g.position.x, 0.9 * (g.scale.x || 1), g.position.z);
    this.controls.update();
  }

  _key(e, down) {
    if (!this.active || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    const c = e.code;
    if (down) {
      if (c === 'KeyX') { e.preventDefault(); this.loco.toggleSit(); return; }
      if (c === 'KeyF' || c === 'Home') { e.preventDefault(); this.loco.toggleFly(); return; }
      if (c === 'Space') { e.preventDefault(); this.loco.jump(); return; }
      // E (grounded): tap = jump, hold = take off (update() promotes a sustained
      // hold to flight). `== null` ignores OS key-repeat so the timer isn't reset.
      if (c === 'KeyE' && !this.loco.flying && this._ePressedAt == null) {
        this._ePressedAt = performance.now() / 1000;
        this._eConsumed = false;
      }
    } else if (c === 'KeyE') {
      if (!this.loco.flying && !this._eConsumed) this.loco.jump(); // short press = jump
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

    // ---- orbit-follow camera ----
    // The user orbits/zooms with the mouse (OrbitControls); we keep the look
    // target on the character's head and shift the camera by the character's
    // per-frame movement, so the chosen angle/distance is preserved while it
    // tracks the body. controls.update() applies the mouse input.
    const g = this.avatar.group;
    const s = g.scale.x || 1;
    const target = this._target.set(g.position.x, g.position.y + 1.25 * s, g.position.z);
    const delta = this._camDelta.subVectors(target, this._prevTarget);
    this.camera.position.add(delta);
    this.controls.target.copy(target);
    this._prevTarget.copy(target);
    this.controls.update();
  }
}
