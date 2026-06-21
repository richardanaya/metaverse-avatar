import * as THREE from 'three/webgpu';
import { initGltfAnim, getGltfClip } from '../../gltfAnim.js';

const LOCO_ANIMS = {
  walk: 'Walk_Loop',
  run: 'Jog_Fwd_Loop',
  stand: 'Idle_Loop',
  jump: 'Jump_Start',
  hover: 'Swim_Idle_Loop',
  crouchIdle: 'Crouch_Idle_Loop',
  crouchWalk: 'Crouch_Fwd_Loop',
};

// Locomotion: walk / run / turn / jump / flight, plus the locomotion animation
// state machine (walk⇄stand⇄jump⇄hover with cross-fades).
//
// This is an APP-LEVEL helper, deliberately NOT part of the Avatar class — how a
// figure moves through the world is the game's concern, and a game may drive
// motion its own way (physics engine, navmesh, networked input, …). This is one
// ready-made option: it translates/rotates `avatar.group` and drives retargeted
// UAL1 glTF locomotion clips, input-driven and camera-agnostic. The Studio's
// viewer (examples/studio/play.js) wraps it with a keyboard + chase camera. Bind it to any avatar;
// the retargeted clips are rig-constant, so the same controller can be re-aimed
// at a different avatar (`loco.avatar = other`).
//
// Drive it by setting the boolean `input` flags (or via setInput()) each frame,
// calling toggleFly()/jump()/toggleSit() on edges, then update(dt).

const WALK_SPEED = 1.5, RUN_SPEED = 4.0, CROUCH_SPEED = 1.1, BACK_FACTOR = 0.6;
const TURN_RATE = 2.6, FLY_SPEED = 2.2, BOUND_R = 5.2, HOP = 0.65;
const FADE_NORMAL = 0.25;
const FADE_SNAP = 0.15; // jump + crouch transitions

export class Locomotion {
  constructor(avatar, { glbFile, bounds = BOUND_R } = {}) {
    if (typeof glbFile !== 'string' || !glbFile) {
      throw new Error(
        'new Locomotion(avatar, { glbFile }): glbFile is required — pass the ' +
        'URL/path to the UAL1 locomotion GLB (it is not bundled with the library).'
      );
    }
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
    if (this.crouching) {
      this.crouching = false;
      this._setState(this._locomotionKey());
      return true;
    }
    this.crouching = true;
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
    // popping. Never clear _stateKey before calling this — fade is 0 when
    // prev is null, which hard-cuts instead of blending.
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

    // ---- animation state ----
    const key = this._locomotionKey();
    this._setState(key);
    if (this.crouching) {
      if (key === 'crouchWalk') {
        let ts = 1.0;
        if (back && !fwd) ts = -1.0;
        this.avatar.setSpeed(ts);
      } else {
        this.avatar.setSpeed(1);
      }
      return;
    }
    if (key === 'walk' || key === 'run') {
      let ts = key === 'run' ? 1.0 : 1.05;
      if (back && !fwd) ts = key === 'run' ? -1.2 : -1.0;
      this.avatar.setSpeed(ts);
    } else {
      this.avatar.setSpeed(1);
    }
  }
}
