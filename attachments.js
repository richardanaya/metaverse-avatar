import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getCanonicalBone } from './skeleton.js';

// ---------------------------------------------------------------------------
// Attachment points — the Second Life model: every wearable / held object
// picks a bone on the avatar rig as its parent.  The object follows that
// bone's world transform (plus a tunable local offset), so a sword tracks the
// right hand, a hat stays on the head, a backpack rides the spine, etc.
// ---------------------------------------------------------------------------

export const ATTACHMENT_POINTS = [
  { bone: 'mHead',          label: 'Head / Skull' },
  { bone: 'mNeck',          label: 'Neck' },
  { bone: 'mChest',         label: 'Chest' },
  { bone: 'mSpine1',        label: 'Spine' },
  { bone: 'mPelvis',        label: 'Pelvis' },
  { bone: 'mShoulderLeft',  label: 'L Shoulder' },
  { bone: 'mShoulderRight', label: 'R Shoulder' },
  { bone: 'mElbowLeft',     label: 'L Forearm' },
  { bone: 'mElbowRight',    label: 'R Forearm' },
  { bone: 'mWristLeft',     label: 'L Hand' },
  { bone: 'mWristRight',    label: 'R Hand' },
  { bone: 'mHipLeft',       label: 'L Hip' },
  { bone: 'mHipRight',      label: 'R Hip' },
  { bone: 'mKneeLeft',      label: 'L Lower Leg' },
  { bone: 'mKneeRight',     label: 'R Lower Leg' },
  { bone: 'mAnkleLeft',     label: 'L Foot' },
  { bone: 'mAnkleRight',    label: 'R Foot' },
];

// ---------------------------------------------------------------------------
// Built-in sword — a simple low-poly weapon so there's something to try
// right away without hunting for a GLB.  Oriented so the blade points
// forward (+Z in local space) and the handle sits near the origin.
// ---------------------------------------------------------------------------

function buildSwordMesh() {
  const group = new THREE.Group();
  group.name = 'Sword';

  const metal = new THREE.MeshStandardMaterial({ color: 0xc0c8d4, roughness: 0.22, metalness: 0.92 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x3a3030, roughness: 0.45, metalness: 0.70 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x5c3a1e, roughness: 0.70, metalness: 0.02 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd4b060, roughness: 0.18, metalness: 0.95 });

  // Blade (flat box, Z-forward)
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.015, 0.55), metal);
  blade.position.set(0, 0.04, 0.28);
  group.add(blade);

  // Guard (crosspiece, X-wide)
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.03, 0.04), gold);
  guard.position.set(0, 0.0, 0.02);
  group.add(guard);

  // Grip
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.024, 0.1, 8), wood);
  grip.position.set(0, -0.01, -0.06);
  group.add(grip);

  // Pommel
  const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), darkMetal);
  pommel.position.set(0, -0.01, -0.115);
  group.add(pommel);

  // Cross-detail rings on guard
  const ringGeo = new THREE.TorusGeometry(0.025, 0.008, 6, 8);
  const ringL = new THREE.Mesh(ringGeo, gold);
  ringL.position.set(-0.09, 0.015, 0.02);
  group.add(ringL);
  const ringR = new THREE.Mesh(ringGeo, gold);
  ringR.position.set(0.09, 0.015, 0.02);
  group.add(ringR);

  for (const child of group.children) {
    child.castShadow = true;
    child.receiveShadow = true;
  }

    return group;
}

// ---------------------------------------------------------------------------
// Hair — a simple bowl/helmet shape that sits on the head
// ---------------------------------------------------------------------------

function buildHairMesh() {
  const group = new THREE.Group();
  group.name = 'Hair';

  const hairMat = new THREE.MeshStandardMaterial({ color: 0x2a1f14, roughness: 0.55, metalness: 0.05 });
  const highlightMat = new THREE.MeshStandardMaterial({ color: 0x3d2b1a, roughness: 0.45, metalness: 0.08 });

  // Main dome (scalp)
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.14, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMat);
  dome.position.set(0, 0.09, 0);
  dome.scale.set(1, 0.85, 0.95);
  group.add(dome);

  // Back hair (extends down the neck)
  const back = new THREE.Mesh(new THREE.SphereGeometry(0.14, 24, 12, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.35), hairMat);
  back.position.set(0, 0.02, -0.06);
  back.scale.set(1, 1.05, 0.78);
  group.add(back);

  // Side tufts (left, right)
  for (const sign of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.16, 6, 4), hairMat);
    side.position.set(sign * 0.12, 0.04, -0.02);
    side.rotation.z = sign * 0.25;
    side.rotation.x = 0.3;
    group.add(side);
  }

  // Front bangs
  const bangs = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.06, 4, 1, 1), highlightMat);
  bangs.position.set(0, 0.145, 0.08);
  bangs.rotation.x = 0.15;
  group.add(bangs);

  for (const child of group.children) {
    child.castShadow = true;
    child.receiveShadow = true;
  }

  return group;
}

// ---------------------------------------------------------------------------
// Shield — a round knight's shield for the forearm
// ---------------------------------------------------------------------------

function buildShieldMesh() {
  const group = new THREE.Group();
  group.name = 'Shield';

  const faceMat = new THREE.MeshStandardMaterial({ color: 0x4a6080, roughness: 0.35, metalness: 0.6 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x8a7a60, roughness: 0.2, metalness: 0.85 });
  const bossMat = new THREE.MeshStandardMaterial({ color: 0xc0b090, roughness: 0.15, metalness: 0.9 });

  // Shield face (disc)
  const face = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.02, 32), faceMat);
  group.add(face);

  // Rim ring
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.015, 8, 32), rimMat);
  group.add(rim);

  // Center boss
  const boss = new THREE.Mesh(new THREE.SphereGeometry(0.04, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.45), bossMat);
  boss.position.set(0, 0, 0.012);
  group.add(boss);

  // Cross rivets
  for (const [x, y] of [[0, 0.09], [0, -0.09], [0.09, 0], [-0.09, 0]]) {
    const rivet = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 4), bossMat);
    rivet.position.set(x, y, 0.012);
    group.add(rivet);
  }

  for (const child of group.children) {
    child.castShadow = true;
    child.receiveShadow = true;
  }

  // By default the shield faces forward — parent to forearm and rotate to taste
  return group;
}

// ---------------------------------------------------------------------------
// Wings — angel/demon wings that sit on the upper back
// ---------------------------------------------------------------------------

function buildWingsMesh() {
  const group = new THREE.Group();
  group.name = 'Wings';

  const featherMat = new THREE.MeshStandardMaterial({ color: 0xe8e4dc, roughness: 0.6, metalness: 0.02, side: THREE.DoubleSide });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xc8c0b4, roughness: 0.4, metalness: 0.1 });

  function buildWing(side) {
    const wing = new THREE.Group();
    // Main frame (curved upper edge)
    const frame = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.55, 6), frameMat);
    frame.position.set(0.18, 0.5, 0);
    frame.rotation.z = -side * 0.7;
    frame.rotation.x = 0.3;
    wing.add(frame);

    // Feather rows (layered triangles)
    for (let row = 0; row < 4; row++) {
      const y = 0.5 - row * 0.14;
      const width = 0.14 + row * 0.07;
      const height = 0.1 + row * 0.02;
      const xOff = 0.22 + row * 0.07;
      for (let f = 0; f < 3; f++) {
        const feather = new THREE.Mesh(
          new THREE.ConeGeometry(width * 0.4, height, 4, 1),
          featherMat,
        );
        feather.position.set(xOff + f * 0.04, y - f * 0.03, (f - 1) * 0.06);
        feather.rotation.z = -side * (0.5 + row * 0.1);
        feather.rotation.x = 0.15 + row * 0.1;
        feather.scale.set(1, 1, 0.35);
        wing.add(feather);
      }
    }
    // Tip feathers
    for (let i = 0; i < 2; i++) {
      const tip = new THREE.Mesh(
        new THREE.ConeGeometry(0.06, 0.18, 4, 1),
        featherMat,
      );
      tip.position.set(0.35, 0.58 - i * 0.1, (i - 0.5) * 0.08);
      tip.rotation.z = -side * 0.9;
      tip.rotation.x = 0.2;
      tip.scale.set(1, 1, 0.3);
      wing.add(tip);
    }
    wing.position.x = side * 0.08;
    return wing;
  }

  group.add(buildWing(1));   // right wing
  group.add(buildWing(-1));  // left wing

  for (const child of group.children) {
    child.traverse((c) => {
      if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; }
    });
  }

  return group;
}

// ---------------------------------------------------------------------------
// Built-in presets — ready-to-attach items with suggested bone + offset
// ---------------------------------------------------------------------------

export const BUILTIN_PRESETS = [
  {
    id: 'sword',
    label: 'Sword',
    bone: 'mWristRight',
    factory: buildSwordMesh,
    offset: { pos: [-0.04, -0.05, 0.06], rot: [0, 0, -Math.PI / 2], scale: [1, 1, 1] },
  },
  {
    id: 'hair',
    label: 'Hair',
    bone: 'mHead',
    factory: buildHairMesh,
    offset: { pos: [0, 0.04, -0.01], rot: [0, 0, 0], scale: [1, 1, 1] },
  },
  {
    id: 'shield',
    label: 'Shield',
    bone: 'mWristLeft',
    factory: buildShieldMesh,
    offset: { pos: [0.04, 0.0, 0.0], rot: [0, Math.PI / 2, 0], scale: [1, 1, 1] },
  },
  {
    id: 'wings',
    label: 'Wings',
    bone: 'mChest',
    factory: buildWingsMesh,
    offset: { pos: [0, 0.05, -0.18], rot: [0, 0, 0], scale: [0.5, 0.5, 0.5] },
  },
];

// ---------------------------------------------------------------------------
// Attachments manager
// ---------------------------------------------------------------------------

export class Attachments {
  constructor(avatar) {
    this.avatar = avatar;
    /** @type {{ id:number, name:string, boneName:string, object:THREE.Group,
     *              offset:{pos:[number,number,number],rot:[number,number,number],scale:[number,number,number]},
     *              _url?:string }[]} */
    this.entries = [];
    this._loader = new GLTFLoader();
    this._nextId = 1;
  }

  /**
   * Attach a built-in procedural mesh.  `factory()` must return a THREE.Object3D.
   */
  attachBuiltin(name, boneName, factory, offset = {}) {
    const bone = getCanonicalBone(this.avatar, boneName);
    if (!bone) throw new Error(`Bone not found: ${boneName}`);

    const obj = factory();
    const entry = this._createEntry(name, boneName, obj, offset);
    bone.add(obj);
    this.entries.push(entry);
    return entry;
  }

  /**
   * Attach a GLB/glTF file.
   */
  async attachFile(file, boneName, offset = {}) {
    const bone = getCanonicalBone(this.avatar, boneName);
    if (!bone) throw new Error(`Bone not found: ${boneName}`);

    const url = URL.createObjectURL(file);
    let gltf;
    try {
      gltf = await this._loader.loadAsync(url);
    } catch (err) {
      URL.revokeObjectURL(url);
      throw err;
    }
    URL.revokeObjectURL(url);

    const obj = gltf.scene;
    obj.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    const entry = this._createEntry(file.name.replace(/\.[^.]+$/, ''), boneName, obj, offset);
    entry._url = url;
    bone.add(obj);
    this.entries.push(entry);
    return entry;
  }

  _createEntry(name, boneName, object, offset = {}) {
    const id = this._nextId++;
    const entry = {
      id,
      name,
      boneName,
      object,
      offset: {
        pos: offset.pos ? [...offset.pos] : [0, 0, 0],
        rot: offset.rot ? [...offset.rot] : [0, 0, 0],
        scale: offset.scale ? [...offset.scale] : [1, 1, 1],
      },
    };
    this._applyOffset(entry);
    return entry;
  }

  /** Remove one attachment by id. */
  remove(id) {
    const idx = this.entries.findIndex((e) => e.id === id);
    if (idx === -1) return false;
    const entry = this.entries[idx];
    entry.object.removeFromParent();
    this.entries.splice(idx, 1);
    return true;
  }

  /** Update local offset (pos / rot / scale) relative to the parent bone. */
  setOffset(id, offset) {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return;
    if (offset.pos) entry.offset.pos = [...offset.pos];
    if (offset.rot) entry.offset.rot = [...offset.rot];
    if (offset.scale) entry.offset.scale = [...offset.scale];
    this._applyOffset(entry);
  }

  _applyOffset(entry) {
    const [px, py, pz] = entry.offset.pos;
    const [rx, ry, rz] = entry.offset.rot;
    const [sx, sy, sz] = entry.offset.scale;
    entry.object.position.set(px, py, pz);
    entry.object.rotation.set(rx, ry, rz);
    entry.object.scale.set(sx, sy, sz);
  }

  /** Remove all attachments. */
  clear() {
    for (const entry of [...this.entries]) this.remove(entry.id);
  }
}

/** Convenience: create the built-in sword. */
export function createSword() {
  return buildSwordMesh();
}
