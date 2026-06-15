import * as THREE from 'three';

// Soft-body physics for jiggle/sag on a group of bones (pecs, glutes, …).
// Each instance drives one configurable bone group with its own parameters;
// see the constructor opts.
//
// Two decoupled channels per pec bone:
//
// 1. Jiggle — a "dynamic bone" spring model (cf. Unity DynamicBone, Unreal
//    AnimDynamics): a particle springs toward the rigid attachment point, and
//    its velocity is damped RELATIVE to that (moving) attachment — so a steady
//    glide adds no drag and produces no offset (no walk-forward "compression").
//    The inertia kick is driven by the parent's *acceleration* (the change in
//    its per-frame displacement), so constant-velocity motion injects nothing
//    while footfalls / starts / stops / turns spike it and make the tissue
//    lurch. Damping is anisotropic: vertical bounce stays lively while the
//    fore/aft + lateral sway settles faster (the horizontalDamping control).
//
// 2. Gravity sag — applied kinematically, not as a force. The sag offset
//    tracks the *change* in the gravity direction relative to the chest's
//    rest orientation (zero when standing: the rest-pose sag is already
//    modeled into the mesh), smoothed at its own rate. Leaning re-aims the
//    sag in ~0.1-0.2 s no matter how soft the jiggle spring is, the
//    standing shape is never distorted, and the full jiggle clamp budget
//    stays available for motion.
//
// We track a "dynamic world position" for each pec bone, apply forces in
// world space, then convert the resulting offset back to bone-local for
// application.

const PEC_BONES = ['LEFT_PEC', 'RIGHT_PEC'];
const DEFAULT_TRACK = ['mChest', 'mPelvis']; // first present bone drives sag re-aim
const DOWN = new THREE.Vector3(0, -1, 0);
const SAG_RESPONSE = 10;  // 1/s — smoothing rate for sag re-aiming on lean
const MAX_SAG = 0.08;     // m at sag slider 100 (scaled by pec size)
const MAX_JIGGLE = 0.07;  // m — jiggle offset clamp (scaled by pec size)
const MAX_TOTAL = 0.11;   // m — hard cap on the combined offset from base (anti-invert)
const MAX_PARENT_STEP = 0.05; // m — cap inertia source so fast body motion can't explode the spring
const MAX_VEL = 4.0;      // m/s — hard cap on jiggle velocity

// Reusable temps (never alias two different meanings in the same scope).
const _tv0 = new THREE.Vector3();
const _tv1 = new THREE.Vector3();
const _tv2 = new THREE.Vector3();
const _tv3 = new THREE.Vector3();
const _tv4 = new THREE.Vector3();
const _tv5 = new THREE.Vector3();
const _tq0 = new THREE.Quaternion();
const _tq1 = new THREE.Quaternion();

export class SoftBodyPhysics {
  // opts.bones        — bone names this instance drives (default: the pecs)
  // opts.trackBones   — candidate bones whose orientation aims the gravity sag;
  //                     the first one present is used (default: chest → pelvis)
  constructor(avatar, opts = {}) {
    this.avatar = avatar;
    this.enabled = true;

    this.bones = opts.bones ?? PEC_BONES;
    this._trackNames = opts.trackBones ?? DEFAULT_TRACK;

    this._bounciness = 0.3;        // 0–1
    this._damping = 0.65;          // 0–1 — VERTICAL settle (the up/down bounce)
    this._horizontalDamping = 0.85; // 0–1 — fore/aft + lateral sway settle (firmer)
    this._sag = 0.4;               // 0–1

    // Per-bone state
    this._dynPos = {};         // dynamic world position
    this._dynVel = {};         // dynamic world velocity
    this._prevRigidPos = {};   // rigid world position from previous frame
    this._prevParentDelta = {}; // last frame's rigid displacement (for acceleration)
    this._basePos = {};        // bone-local rest reference
    this._sagOffset = {};      // bone-local smoothed sag offset

    // World "down" expressed in the chest's rest-pose local frame; the sag
    // target is the deviation of the current local down from this.
    this._restDownLocal = new THREE.Vector3(0, -1, 0);

    this._initialized = false;

    for (const name of this.bones) {
      this._dynPos[name] = new THREE.Vector3();
      this._dynVel[name] = new THREE.Vector3();
      this._prevRigidPos[name] = new THREE.Vector3();
      this._prevParentDelta[name] = new THREE.Vector3();
      this._basePos[name] = new THREE.Vector3();
      this._sagOffset[name] = new THREE.Vector3();
    }
  }

  // ---- public API ----

  get bounciness() { return this._bounciness; }
  set bounciness(v) { this._bounciness = THREE.MathUtils.clamp(v, 0, 1); }

  get damping() { return this._damping; }
  set damping(v) { this._damping = THREE.MathUtils.clamp(v, 0, 1); }

  // Damping of the horizontal (fore/aft + side-to-side) jiggle, independent of
  // the vertical bounce. Higher = the sway from walking/turning settles faster.
  get horizontalDamping() { return this._horizontalDamping; }
  set horizontalDamping(v) { this._horizontalDamping = THREE.MathUtils.clamp(v, 0, 1); }

  get sag() { return this._sag; }
  set sag(v) { this._sag = THREE.MathUtils.clamp(v, 0, 1); }

  captureBasePositions() {
    const body = this.avatar.parts?.body;
    if (!body) return;
    for (const name of this.bones) {
      const bone = body.bones.get(name);
      if (bone) this._basePos[name].copy(bone.position);
    }
    this._captureRestDown(body);
  }

  // Compose the chest's rest-pose world quaternion from the captured rest
  // rotations (the live quaternions may be mid-animation when this runs)
  // and record where world-down points in that frame.
  _captureRestDown(body) {
    const trackBone = this._resolveTrackBone(body);
    if (!trackBone) return;
    const chain = [];
    for (let obj = trackBone; obj; obj = obj.parent) chain.push(obj);
    const q = _tq0.identity();
    for (let i = chain.length - 1; i >= 0; i--) {
      const obj = chain[i];
      q.multiply(obj.isBone ? (body.rest.get(obj.name)?.q ?? obj.quaternion) : obj.quaternion);
    }
    this._restDownLocal.copy(DOWN).applyQuaternion(q.invert());
  }

  _resolveTrackBone(body) {
    for (const name of this._trackNames) {
      const bone = body.bones.get(name);
      if (bone) return bone;
    }
    return null;
  }

  // ---- per-frame update ----

  update(dt) {
    if (!this.enabled) return;

    const body = this.avatar.parts?.body;
    if (!body) return;

    const trackBone = this._resolveTrackBone(body);
    if (!trackBone) return;

    // No time elapsed → nothing to integrate. Bail before any per-frame math so
    // a dt=0 tick (e.g. avatar.update(0), which locomotion calls to evaluate
    // frame 0 of a new clip) can't divide by zero and inject NaN into the rig.
    dt = Math.min(dt, 0.1);
    if (dt <= 0) return;

    this.avatar.group.updateMatrixWorld();

    // Tracking bone world orientation/scale (for converting offsets to local).
    const trackQuat = trackBone.getWorldQuaternion(_tq0);
    const trackQuatInv = _tq1.copy(trackQuat).invert();
    const trackScale = trackBone.getWorldScale(_tv4);

    // ---- parameters ----

    // Fixed spring character; bounciness scales the visible jiggle OUTPUT below
    // (so a slider at 0 = no jiggle at all, regardless of the damping settings).
    const inert = 0.5;     // inertia kick from parent acceleration
    const stiffness = 12;  // spring toward the rigid attachment
    // Anisotropic damping rates (1/s). Vertical is the lively bounce; horizontal
    // (fore/aft + lateral) is firmer so translating the body — e.g. walking
    // forward — doesn't read as the tissue compressing back into the torso.
    // The floor (4) keeps even a slider at 0 from resonating with the gait.
    const dampVf = Math.exp(-(4 + this._damping * 8) * dt);             // 4 → 12
    const dampHf = Math.exp(-(4 + this._horizontalDamping * 16) * dt);  // 4 → 20
    const sagBlend = 1 - Math.exp(-SAG_RESPONSE * dt);

    // Current chest-local down; how far it has swung from the rest pose
    // determines the sag direction and magnitude.
    const downLocal = _tv5.copy(DOWN).applyQuaternion(trackQuatInv);

    for (const name of this.bones) {
      const bone = body.bones.get(name);
      if (!bone) continue;

      const base = this._basePos[name];
      const rest = body.rest.get(name);
      // The breast-size slider scales the pec bones; bigger pecs swing and
      // sag proportionally further.
      const sizeScale = rest
        ? (bone.scale.x / (rest.s.x || 1) +
           bone.scale.y / (rest.s.y || 1) +
           bone.scale.z / (rest.s.z || 1)) / 3
        : 1;

      // ---- rigid world position (where the pec WOULD be, no physics) ----

      bone.position.copy(base);
      const rigidWorld = bone.getWorldPosition(_tv0); // refreshes the matrix chain

      // ---- initialise on first frame ----

      if (!this._initialized) {
        this._dynPos[name].copy(rigidWorld);
        this._dynVel[name].set(0, 0, 0);
        this._prevRigidPos[name].copy(rigidWorld);
        this._prevParentDelta[name].set(0, 0, 0);
        this._sagOffset[name].set(0, 0, 0);
        continue; // bone stays at base this frame
      }

      const dynPos = this._dynPos[name];
      const dynVel = this._dynVel[name];
      const prevRigid = this._prevRigidPos[name];

      // ---- jiggle: forces on the dynamic particle ----

      // Rigid attachment velocity this frame, and how much that velocity
      // CHANGED since last frame (parent acceleration).
      const parentDelta = _tv2.subVectors(rigidWorld, prevRigid);
      const pvx = parentDelta.x / dt, pvy = parentDelta.y / dt, pvz = parentDelta.z / dt;
      const accelDelta = _tv3.subVectors(parentDelta, this._prevParentDelta[name]);
      if (accelDelta.length() > MAX_PARENT_STEP) accelDelta.setLength(MAX_PARENT_STEP);
      this._prevParentDelta[name].copy(parentDelta); // (before _tv2 is reused below)

      // 1. Spring toward current rigid position.
      const springForce = _tv1.subVectors(rigidWorld, dynPos).multiplyScalar(stiffness);

      // ---- integrate (with a hard velocity cap for stability) ----

      dynVel.addScaledVector(springForce, dt);
      // 2. Inertia from parent ACCELERATION (the change in motion): a steady
      //    glide — walking forward at constant speed — adds nothing, so it can't
      //    pump a standing offset (the old "compression"). Footfalls / starts /
      //    stops / turns spike it and make the tissue lurch.
      dynVel.addScaledVector(accelDelta, inert);
      // Damp the velocity RELATIVE to the moving attachment (parent velocity),
      // not the absolute world velocity — so constant translation contributes no
      // drag/lag, and only true oscillations settle. Vertical (world Y) and
      // horizontal (world XZ) relax at independent rates (dampVf / dampHf).
      dynVel.x = pvx + (dynVel.x - pvx) * dampHf;
      dynVel.z = pvz + (dynVel.z - pvz) * dampHf;
      dynVel.y = pvy + (dynVel.y - pvy) * dampVf;
      if (dynVel.length() > MAX_VEL) dynVel.setLength(MAX_VEL);
      dynPos.addScaledVector(dynVel, dt);

      // ---- compute offset & clamp ----

      const worldOffset = _tv2.subVectors(dynPos, rigidWorld);
      const maxOff = MAX_JIGGLE * sizeScale;
      if (worldOffset.length() > maxOff) {
        worldOffset.normalize().multiplyScalar(maxOff);
        dynPos.copy(rigidWorld).add(worldOffset);
      }

      // ---- convert to bone-local ----

      // Undo the world scale (height slider scales the group, shape sliders
      // can scale the chest) so the local offset is metrically correct.
      const localJiggle = worldOffset.applyQuaternion(trackQuatInv);
      localJiggle.x /= Math.max(trackScale.x, 1e-6);
      localJiggle.y /= Math.max(trackScale.y, 1e-6);
      localJiggle.z /= Math.max(trackScale.z, 1e-6);
      // Bounciness is the master "amount" of jiggle: 0 = the tissue rigidly
      // tracks the body (no secondary motion at all), 1 = the full spring swing.
      localJiggle.multiplyScalar(this._bounciness);

      // ---- sag: re-aim toward current gravity, smoothed ----

      // (downLocal - restDownLocal) grows with lean angle (up to ~2 when
      // upside down), so cap it or a big recline/flight pose sags the pec
      // far enough to invert the mesh.
      const sagCap = this._sag * MAX_SAG * sizeScale;
      const sagTarget = _tv3.subVectors(downLocal, this._restDownLocal).multiplyScalar(sagCap);
      if (sagTarget.length() > sagCap) sagTarget.setLength(sagCap);
      this._sagOffset[name].lerp(sagTarget, sagBlend);

      // ---- apply (cap the combined offset as a final anti-invert guard) ----

      const total = _tv1.copy(localJiggle).add(this._sagOffset[name]);
      const maxTotal = MAX_TOTAL * sizeScale;
      if (total.length() > maxTotal) total.setLength(maxTotal);
      bone.position.copy(base).add(total);

      // Save rigid position for next frame's parent-delta.
      this._prevRigidPos[name].copy(rigidWorld);
    }

    if (!this._initialized) this._initialized = true;
  }

  reset() {
    for (const name of this.bones) {
      this._dynVel[name].set(0, 0, 0);
      this._sagOffset[name].set(0, 0, 0);
    }
    // Restore pecs to the clean base captured by applyShape/load. Do NOT
    // recapture here: bone.position still holds this frame's physics offset,
    // so re-reading it would bake that offset into the base — and since
    // reset() runs on every clip switch (stop → playClip), the base would
    // drift further out of place each time, permanently. The shape sliders
    // own the base; physics only ever borrows and restores it.
    const body = this.avatar.parts?.body;
    if (body) {
      for (const name of this.bones) {
        const bone = body.bones.get(name);
        if (bone) bone.position.copy(this._basePos[name]);
      }
    }
    this._initialized = false;
  }
}
