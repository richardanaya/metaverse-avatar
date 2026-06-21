import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { computeBoneAdjustments } from './sliders.js';
import { buildNippleMorph, applyNippleMorph } from './nipple.js';
import { SoftBodyPhysics } from './physics.js';
import { PBRMaterialStack } from './pbr.js';
import { Blinker } from './blink.js';
import { VoiceMouth } from './voice.js';
import { SpeechMouth } from './speech.js';
import { Attachments } from './attachments.js';

const SKIN = new THREE.MeshStandardMaterial({
  color: 0xd9a78b,
  roughness: 0.6,
  metalness: 0.0,
  side: THREE.DoubleSide, // hides the neck-seam backfaces where head and body overlap
});

const EYE = new THREE.MeshStandardMaterial({
  color: 0xf2f2f5,
  roughness: 0.25,
  metalness: 0.0,
});

// Ruth avatars are textured per region (head / upper incl. hands / lower incl.
// feet / eyes); the dae material slot names tell us which region each face
// group belongs to. Default MIT-licensed maps in models/textures/; replace via drop slots.
// Each region seeds the matching PBR channels (albedo + normal/roughness/
// metallic/ao where shipped); the eyes only have an albedo map.
const DEFAULT_SKIN = {
  face: {
    albedo: 'textures/android_face.png',
    normal: 'textures/android_face_normal.jpg',
    roughness: 'textures/android_face_roughness.jpg',
    metallic: 'textures/android_face_metallic.jpg',
    ao: 'textures/android_face_ao.jpg',
  },
  upper: {
    albedo: 'textures/android_upper.png',
    normal: 'textures/android_upper_normal.jpg',
    roughness: 'textures/android_upper_roughness.jpg',
    metallic: 'textures/android_upper_metallic.jpg',
    ao: 'textures/android_upper_ao.jpg',
  },
  lower: {
    albedo: 'textures/android_lower.png',
    normal: 'textures/android_lower_normal.jpg',
    roughness: 'textures/android_lower_roughness.jpg',
    metallic: 'textures/android_lower_metallic.jpg',
    ao: 'textures/android_lower_ao.jpg',
  },
  eyes: {
    albedo: 'textures/blue_eyes.png',
  },
};

const TEXTURE_SIZE = 1024;

// Eye look-at: clamp how far the eyeballs can swing from rest so they never
// roll back into the skull when the target is behind / extreme.
const EYE_LOOK_MAX_YAW = 0.55;
const EYE_LOOK_MAX_PITCH = 0.4;
const _lookM4 = new THREE.Matrix4();
const _lookV1 = new THREE.Vector3();
const _lookV2 = new THREE.Vector3();
const _lookQ0 = new THREE.Quaternion();
const _lookQ1 = new THREE.Quaternion();
const _lookE = new THREE.Euler();
const _EYE_FWD = new THREE.Vector3(1, 0, 0);

// Regions that accept stacked clothing layers (face/eyes are skin-only).
export const LAYERED_REGIONS = ['upper', 'lower'];

// Per-region PBR stack defaults. Skin tone base color shows through when an
// albedo map is cleared; eyes start glossier than skin.
const REGION_DEFAULTS = {
  face: { layered: false, baseColor: 0xd9a78b, roughness: 0.55, metalness: 0.0 },
  upper: { layered: true, baseColor: 0xd9a78b, roughness: 0.55, metalness: 0.0 },
  lower: { layered: true, baseColor: 0xd9a78b, roughness: 0.55, metalness: 0.0 },
  eyes: { layered: false, baseColor: 0xf2f2f5, roughness: 0.25, metalness: 0.0 },
};
// Global roughness/metalness sliders drive the skin regions (not the eyes).
const SKIN_REGIONS = ['face', 'upper', 'lower'];

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('failed to load image: ' + url));
    img.src = url;
  });
}

function regionForMaterial(materialName) {
  const n = materialName.toLowerCase();
  if (n.includes('eye')) return 'eyes';
  if (n.includes('head')) return 'face';
  if (n.includes('upper') || n.includes('hand')) return 'upper';
  return 'lower'; // mat_body_lower, mat_feet_*
}

// The Ruth2 RC3 avatar is split into separate rigged glTF part files (converted
// from the original Collada). Each file carries its own copy of the (relevant
// subset of the) avatar skeleton, so we keep one skeleton per part and drive them
// all in sync by bone name.
// Default part files (override per-call via load(basePath, { parts })). The .glb
// exports carry the Z-up Ruth armature; pass your own .glb/.gltf URLs to swap
// meshes (same rig → same sliders/physics/anim).
const DEFAULT_PARTS = {
  body: 'body.glb',   // Release3_BothLowerUpper_15
  hands: 'hands.glb', // Release3_Hands_15 (Bento fingers)
  feet: 'feet.glb',   // Release3_FlatFeet_15
  head: 'head.glb',   // Ruth2v4Head (RC3 has no head; the v4 head fits the RC3 body)
  eyes: 'eyes.glb',   // Ruth2v4Eyeballs
};

const _gltfLoader = new GLTFLoader();

// Load one part file (glTF/GLB). The exports ship the armature collapsed (bind
// pose only in the inverse-bind matrices), so the caller recovers it with
// poseFromBind.
async function loadPartScene(url) {
  return (await _gltfLoader.loadAsync(url)).scene;
}

// Resolve a part/texture entry against basePath. An absolute URL — a scheme
// (https:, data:, blob:…), protocol-relative (//…), or root-relative (/…) — is
// used as-is, so a bundler/CDN can hand back fingerprinted per-file URLs (e.g.
// `import bodyUrl from './body.glb'`). A plain relative name joins basePath.
const isAbsoluteUrl = (s) => /^([a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(s);
const resolveUrl = (basePath, file) => (isAbsoluteUrl(file) ? file : basePath + file);

// Like THREE.Skeleton.pose(), but across all of a part's skins at once and
// ignoring placeholder bind matrices. The exports ship the armature collapsed
// (the real rest pose lives only in the inverse-bind matrices), and a part with
// multiple skins (the v4 eyeballs) puts every bone in every skeleton while only
// the mesh's own joints get real inverse binds — the rest are identity, so
// calling skeleton.pose() per mesh would snap those bones to the origin.
function poseFromBind(root) {
  const identity = new THREE.Matrix4();
  const bindWorld = new Map(); // Bone -> bind-pose world matrix
  root.updateMatrixWorld(true);
  root.traverse((obj) => {
    if (!obj.isSkinnedMesh) return;
    obj.skeleton.bones.forEach((bone, i) => {
      const inv = obj.skeleton.boneInverses[i];
      if (bindWorld.has(bone) || inv.equals(identity)) return;
      bindWorld.set(bone, inv.clone().invert());
    });
  });
  const local = new THREE.Matrix4();
  const parentInv = new THREE.Matrix4();
  for (const [bone, world] of bindWorld) {
    local.copy(world);
    if (bone.parent && bone.parent.isBone) {
      parentInv.copy(bindWorld.get(bone.parent) ?? bone.parent.matrixWorld).invert();
      local.premultiply(parentInv);
    }
    local.decompose(bone.position, bone.quaternion, bone.scale);
  }
  root.updateMatrixWorld(true);
}

// A fully self-contained, independently-controllable avatar. Each `new Avatar()`
// owns its own scene graph (`group`), skeleton, materials, animation state, and
// the per-avatar capabilities — pec/glute physics, procedural blinking,
// microphone + TTS lip-sync, prop attachments, and eye look-at. Nothing is
// shared between instances, so two avatars can be loaded into the same scene and
// driven completely separately:
//
//   const a = await new Avatar().load('models/');
//   const b = await new Avatar().load('models/');
//   scene.add(a.group, b.group);
//   // ...each frame:
//   a.update(dt); b.update(dt);
//
// `update(dt)` advances everything the avatar does on its own (animation,
// physics, blinking, lip-sync, look-at). Locomotion is intentionally NOT part
// of the avatar — how a figure moves around is the game's concern. Move it by
// driving `avatar.group` + the animation methods (playClip/crossFadeTo/…)
// directly, or copy the standalone `Locomotion` helper (examples/common/locomotion.js).
export class Avatar {
  constructor() {
    this.group = new THREE.Group();
    this.parts = {}; // name -> { root, bones: Map<name, Bone>, rest: Map<name, {p,q,s}>, mixer, action }
    this.pelvisRestZ = 1.067; // overwritten from the loaded rig
    this.clip = null;
    this.paused = false;
    this.timeScale = 1;
    this._partClips = new Map(); // clip -> Map(part -> per-part AnimationClip|null), cached
    this._fades = []; // actions ramping out; { action, mixer, clip, t } — stopped at t<=0
    this._regions = {}; // region -> PBRMaterialStack
    this._textured = true;
    this.pecPhysics = new SoftBodyPhysics(this);
    // Glute jiggle/sag — single BUTT collision volume, sag aimed by the pelvis.
    this.glutePhysics = new SoftBodyPhysics(this, { bones: ['BUTT'], trackBones: ['mPelvis'] });

    // ---- composed per-avatar capabilities ----
    // Each takes this avatar and holds its own state, so they're independent
    // per instance. update() ticks them every frame.
    this.blinker = new Blinker(this);        // procedural eye blinks
    this.voice = new VoiceMouth(this);       // microphone-driven jaw
    this.speech = new SpeechMouth(this);     // TTS-clip lip-sync (visemes)
    this.attachments = new Attachments(this); // props parented to bones

    // Eye look-at — each avatar tracks its own world-space target, so several
    // avatars can each gaze somewhere different. update() aims the eyeballs.
    this.lookAt = { enabled: false, target: new THREE.Vector3(), _was: false };
  }

  async load(basePath, { parts = DEFAULT_PARTS, skin = DEFAULT_SKIN } = {}) {
    if (typeof basePath !== 'string' || !basePath) {
      throw new Error(
        'Avatar.load(basePath): basePath is required — pass the URL/path to the ' +
        "directory holding the model files (e.g. 'models/', '../../models/', or " +
        "new URL('models/', import.meta.url).href). It must end with a slash."
      );
    }
    this._basePath = basePath;

    // One PBR material stack per region; seed each with its default albedo.
    for (const [region, cfg] of Object.entries(REGION_DEFAULTS)) {
      this._regions[region] = new PBRMaterialStack({ size: TEXTURE_SIZE, ...cfg });
    }
    await Promise.all(
      Object.entries(skin).flatMap(([region, channels]) =>
        Object.entries(channels).map(async ([channel, file]) => {
          if (!file) {
            this._regions[region]?.setSkinMap(channel, null);
            return;
          }
          this._regions[region]?.setSkinMap(channel, await loadImage(resolveUrl(basePath, file)));
        })
      )
    );

    const loads = Object.entries(parts).map(async ([name, file]) => {
      const url = resolveUrl(basePath, file);
      const root = await loadPartScene(url);
      root.updateMatrixWorld(true);
      root.traverse((obj) => {
        if (obj.isSkinnedMesh) {
          // aoMap samples the second UV set; reuse the primary UVs so AO
          // works without a dedicated lightmap channel.
          const uv = obj.geometry.getAttribute('uv');
          if (uv && !obj.geometry.getAttribute('uv1')) obj.geometry.setAttribute('uv1', uv);
          const orig = Array.isArray(obj.material) ? obj.material : [obj.material];
          const textured = orig.map((m) => this._materialForRegion(regionForMaterial(m.name || '')));
          const plain = orig.map(() => (name === 'eyes' ? EYE : SKIN));
          obj.userData.materialSets = {
            textured: Array.isArray(obj.material) ? textured : textured[0],
            plain: Array.isArray(obj.material) ? plain : plain[0],
          };
          obj.material = obj.userData.materialSets.textured;
          obj.castShadow = true;
          obj.receiveShadow = true;
          // Bone-scale sliders and BVH clips move verts well outside the
          // static bounding box; never let three.js cull the avatar away.
          obj.frustumCulled = false;
        }
      });
      // The exports' visual-scene node transforms don't match the skin bind
      // pose; recover the true rest pose from the inverse bind matrices
      // before we capture it below.
      poseFromBind(root);
      // Stand the rig up. The Ruth armature is Z-up in bone-local space, and our
      // glTF parts are exported Z-up (Blender export_yup=false) to keep those
      // bone-local rests — so they arrive lying down. Detect that (the rig's up,
      // local +Z, still pointing at world +Z) and rotate the root -90°X. Bone-local
      // rests — and therefore the sliders/physics/retarget — are unaffected.
      const rigUp = new THREE.Vector3(0, 0, 1).transformDirection(root.matrixWorld);
      if (rigUp.z > 0.7) { root.rotateX(-Math.PI / 2); root.updateMatrixWorld(true); }
      const bones = new Map();
      const rest = new Map();
      root.traverse((obj) => {
        if (obj.isBone) {
          if (bones.has(obj.name)) return;
          bones.set(obj.name, obj);
          rest.set(obj.name, {
            p: obj.position.clone(),
            q: obj.quaternion.clone(),
            s: obj.scale.clone(),
          });
        }
      });
      this.parts[name] = { root, bones, rest, mixer: null, action: null };
      this.group.add(root);
    });
    await Promise.all(loads);

    const pelvis = this.parts.body.rest.get('mPelvis');
    if (pelvis) this.pelvisRestZ = pelvis.p.z;

    // Nipple morph: locate the body skinned mesh and precompute the apex/falloff
    // (no-op on rigs without pec-weighted geometry). Driven by the 'nipple' slider.
    this.parts.body.root.traverse((obj) => {
      if (obj.isSkinnedMesh && !this._nippleMorph) this._nippleMorph = buildNippleMorph(obj);
    });

    this.graftHeadParts();
    this.pecPhysics.captureBasePositions();
    this.glutePhysics.captureBasePositions();
    return this;
  }

  // The Ruth2 v4 head and eyeball exports have flat skeletons: their bones
  // (NECK, HEAD, mFaceRoot / mEyeLeft, mEyeRight) hang directly off the
  // armature root with no spine chain, so on their own they can't follow
  // the body. Graft them into the body's skeleton instead: synthesize the
  // missing mHead bone under the body's mNeck (Ruth skeleton offset), then
  // re-parent each head/eye root bone into the chain. attach() preserves
  // world transforms, and the SkinnedMeshes keep referencing the same Bone
  // objects, so the skins are unaffected — they just inherit body motion.
  graftHeadParts() {
    const body = this.parts.body;
    const bodyNeck = body?.bones.get('mNeck');
    if (!bodyNeck) return;

    const mHead = new THREE.Bone();
    mHead.name = 'mHead';
    bodyNeck.add(mHead);
    mHead.position.set(0, 0, 0.076); // avatar_skeleton.xml: mHead offset from mNeck
    body.bones.set('mHead', mHead);
    body.rest.set('mHead', {
      p: mHead.position.clone(),
      q: mHead.quaternion.clone(),
      s: mHead.scale.clone(),
    });

    this.group.updateMatrixWorld(true);
    for (const name of ['head', 'eyes']) {
      const part = this.parts[name];
      if (!part) continue;
      part.grafted = true;
      for (const bone of part.bones.values()) {
        if (bone.parent && bone.parent.isBone) continue; // only armature-root bones
        (bone.name === 'NECK' ? bodyNeck : mHead).attach(bone);
      }
      // re-capture rest transforms: attach() rewrote the root bones' locals
      for (const [boneName, bone] of part.bones) {
        part.rest.set(boneName, {
          p: bone.position.clone(),
          q: bone.quaternion.clone(),
          s: bone.scale.clone(),
        });
      }
    }
  }

  setPartVisible(name, visible) {
    const part = this.parts[name];
    if (part) part.root.visible = visible;
  }

  setTextured(textured) {
    this._textured = textured;
    this._applySurfaceMaterials();
  }

  // ---- PBR textures --------------------------------------------------
  // region is one of 'face' | 'upper' | 'lower' | 'eyes'; channel is one of
  // 'albedo' | 'normal' | 'roughness' | 'metallic' | 'ao'. Clothing layers
  // (upper/lower only) stack on top of the skin, masked by their albedo.

  getRegions() {
    return Object.keys(this._regions);
  }

  getDefaultSkinLabel(region) {
    const file = DEFAULT_SKIN[region]?.albedo;
    return file ? file.split('/').pop() : '';
  }

  setSkinMap(region, channel, img) {
    this._regions[region]?.setSkinMap(channel, img ?? null);
  }

  getSkinMap(region, channel) {
    return this._regions[region]?.skin[channel] ?? null;
  }

  getClothingLayers(region) {
    return this._regions[region]?.layers ?? [];
  }

  addClothingLayer(region) {
    return this._regions[region]?.addLayer() ?? -1;
  }

  removeClothingLayer(region, i) {
    this._regions[region]?.removeLayer(i);
  }

  moveClothingLayer(region, i, dir) {
    this._regions[region]?.moveLayer(i, dir);
  }

  setLayerMap(region, i, channel, img) {
    this._regions[region]?.setLayerMap(i, channel, img ?? null);
  }

  getLayerMap(region, i, channel) {
    return this._regions[region]?.layers[i]?.maps[channel] ?? null;
  }

  setLayerVisible(region, i, visible) {
    this._regions[region]?.setLayerVisible(i, visible);
  }

  // Roughness/metalness as a constant value where a region has no such map.
  setGlobalRoughness(v) {
    for (const r of SKIN_REGIONS) this._regions[r]?.setGlobalRoughness(v);
  }

  setGlobalMetalness(v) {
    for (const r of SKIN_REGIONS) this._regions[r]?.setGlobalMetalness(v);
  }

  _materialForRegion(region) {
    return this._regions[region]?.material;
  }

  // ---- lip sync ------------------------------------------------------

  // Open the jaw, t in [0, 1]. Rotates mFaceJaw about the same axis the
  // "Mouth Open" shape slider uses, relative to its captured rest pose.
  setMouthOpen(t) {
    t = THREE.MathUtils.clamp(t, 0, 1);
    if (!this._jaw) {
      for (const part of Object.values(this.parts)) {
        const bone = part.bones.get('mFaceJaw');
        if (bone) { this._jaw = { bone, rest: part.rest.get('mFaceJaw') }; break; }
      }
      this._jawEuler = new THREE.Euler();
      this._jawQuat = new THREE.Quaternion();
    }
    if (!this._jaw?.bone || !this._jaw.rest) return;
    this._jawEuler.set(0, 0.6 * t, 0);
    this._jaw.bone.quaternion.copy(this._jaw.rest.q).multiply(this._jawQuat.setFromEuler(this._jawEuler));
  }

  // Blink, t in [0, 1]: 0 = eyes open (rest), 1 = fully closed. Rotates the
  // Bento eyelid bones with the same Y-axis amounts the "Eye Closed" shape
  // sliders use (upper lids 0.55, lower lids -0.15), relative to each lid's
  // captured rest pose — same approach as setMouthOpen.
  setBlink(t) {
    t = THREE.MathUtils.clamp(t, 0, 1);
    if (!this._lids) {
      this._lids = [];
      this._blinkEuler = new THREE.Euler();
      this._blinkQuat = new THREE.Quaternion();
      const spec = [
        ['mFaceEyeLidUpperLeft', 0.55], ['mFaceEyeLidLowerLeft', -0.15],
        ['mFaceEyeLidUpperRight', 0.55], ['mFaceEyeLidLowerRight', -0.15],
      ];
      for (const [name, ry] of spec) {
        for (const part of Object.values(this.parts)) {
          const bone = part.bones.get(name);
          if (bone) { this._lids.push({ bone, rest: part.rest.get(name), ry }); break; }
        }
      }
    }
    for (const lid of this._lids) {
      if (!lid.bone || !lid.rest) continue;
      this._blinkEuler.set(0, lid.ry * t, 0);
      lid.bone.quaternion.copy(lid.rest.q).multiply(this._blinkQuat.setFromEuler(this._blinkEuler));
    }
  }

  // Viseme mouth shaping for speech lip-sync. Controls are each 0..1:
  //   open  — jaw drop (vowels)
  //   round — lip pucker / protrude (o, u, w)
  //   wide  — lip spread (e, i)
  // Magnitudes reuse the matching shape sliders (mouth_open jaw rot 0.45,
  // mouth_width corner ±0.008, lip protrusion lips +0.005), applied relative to
  // each bone's rest — so all-zero restores the resting (closed) mouth.
  setMouth({ open = 0, round = 0, wide = 0 } = {}) {
    open = THREE.MathUtils.clamp(open, 0, 1);
    round = THREE.MathUtils.clamp(round, 0, 1);
    wide = THREE.MathUtils.clamp(wide, 0, 1);
    if (!this._mouth) {
      this._mouthEuler = new THREE.Euler();
      this._mouthQuat = new THREE.Quaternion();
      const find = (name) => {
        for (const part of Object.values(this.parts)) {
          const bone = part.bones.get(name);
          if (bone) return { bone, rest: part.rest.get(name) };
        }
        return null;
      };
      this._mouth = { jaw: find('mFaceJaw'), corners: [], lips: [] };
      // corner sign: +1 = left lip corner (moves +Y to widen), -1 = right
      for (const [name, sign] of [['mFaceLipCornerLeft', 1], ['mFaceLipCornerRight', -1]]) {
        const f = find(name);
        if (f) this._mouth.corners.push({ ...f, sign });
      }
      for (const name of ['mFaceLipUpperLeft', 'mFaceLipUpperRight', 'mFaceLipUpperCenter',
        'mFaceLipLowerLeft', 'mFaceLipLowerRight', 'mFaceLipLowerCenter']) {
        const f = find(name);
        if (f) this._mouth.lips.push(f);
      }
    }
    const m = this._mouth;
    if (m.jaw?.bone && m.jaw.rest) {
      this._mouthEuler.set(0, 0.5 * open, 0);
      m.jaw.bone.quaternion.copy(m.jaw.rest.q).multiply(this._mouthQuat.setFromEuler(this._mouthEuler));
    }
    for (const c of m.corners) {
      if (!c.rest) continue;
      // widen on `wide`, pull in + forward on `round`
      const y = c.sign * (0.008 * wide - 0.006 * round);
      c.bone.position.set(c.rest.p.x + 0.004 * round, c.rest.p.y + y, c.rest.p.z);
    }
    for (const l of m.lips) {
      if (!l.rest) continue;
      l.bone.position.set(l.rest.p.x + 0.005 * round, l.rest.p.y, l.rest.p.z); // protrude
    }
  }

  _applySurfaceMaterials() {
    for (const part of Object.values(this.parts)) {
      part.root.traverse((obj) => {
        if (!obj.isSkinnedMesh || !obj.userData.materialSets) return;
        obj.material = this._textured
          ? obj.userData.materialSets.textured
          : obj.userData.materialSets.plain;
      });
    }
  }

  // ---- shape sliders -------------------------------------------------

  applyShape(state) {
    const adj = computeBoneAdjustments(state);
    const height = state.height ?? 0;
    this.group.scale.setScalar(1 + 0.15 * height);

    const euler = new THREE.Euler();
    const q = new THREE.Quaternion();
    for (const part of Object.values(this.parts)) {
      for (const [name, bone] of part.bones) {
        const rest = part.rest.get(name);
        if (!rest) continue;
        const a = adj.get(name);
        if (a) {
          bone.scale.set(rest.s.x * a.scale[0], rest.s.y * a.scale[1], rest.s.z * a.scale[2]);
          bone.position.set(rest.p.x + a.offset[0], rest.p.y + a.offset[1], rest.p.z + a.offset[2]);
          // rotation sliders (jaw etc.) — pose-like sliders on un-animated face bones
          if (a.rot[0] || a.rot[1] || a.rot[2] || this._rotBones?.has(name)) {
            euler.set(a.rot[0], a.rot[1], a.rot[2]);
            bone.quaternion.copy(rest.q).multiply(q.setFromEuler(euler));
            (this._rotBones ??= new Set()).add(name);
          }
        } else {
          bone.scale.copy(rest.s);
          bone.position.copy(rest.p);
        }
      }
    }
    applyNippleMorph(this._nippleMorph, state.nipple ?? 0);

    this.pecPhysics.captureBasePositions();
    this.glutePhysics.captureBasePositions();
  }

  // ---- animation -----------------------------------------------------

  // Play a single clip as the whole stack (replaces any layers). Retained as
  // the simple entry point used by the BVH/glTF play paths and MCP.
  playClip(clip) {
    this.setLayerStack([{ id: 'base', clip, loop: true }]);
  }

  // Set the animation layer stack. `layers` is ordered HIGHEST priority first
  // (index 0 = topmost); each is { id, clip, loop }. Priority is resolved
  // per track: the highest layer that animates a given bone owns it, and
  // lower layers only fill bones the ones above them leave untouched. So a
  // hand-only clip on top overrides just the hand while a full-body clip
  // below drives everything else.
  setLayerStack(layers) {
    this._teardownLayers();
    this.layers = (layers ?? []).filter((l) => l && l.clip);

    // Per-track ownership: first (highest-priority) layer to claim a track
    // name wins; lower layers' copies of that track are dropped so no two
    // actions ever target the same bone (avoids three.js weight-blending).
    const owner = new Map(); // track.name -> layer index
    this.layers.forEach((layer, i) => {
      for (const track of layer.clip.tracks) {
        if (!owner.has(track.name)) owner.set(track.name, i);
      }
    });

    this.layers.forEach((layer, i) => {
      for (const part of Object.values(this.parts)) {
        if (part.grafted) continue; // bones live in the body's tree
        const tracks = layer.clip.tracks.filter(
          (t) => owner.get(t.name) === i && part.bones.has(t.name.split('.')[0]),
        );
        if (tracks.length === 0) continue;
        part.mixer ??= new THREE.AnimationMixer(part.root);
        const partClip = new THREE.AnimationClip(`${layer.clip.name}#${layer.id}`, layer.clip.duration, tracks);
        const action = part.mixer.clipAction(partClip);
        action.setLoop(layer.loop === false ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
        action.clampWhenFinished = layer.loop === false;
        action.reset();
        action.setEffectiveWeight(1);
        action.play();
        (part.actions ??= []).push(action);
      }
    });

    this.clip = this.layers.length ? this.layers[0].clip : null;
    this.setPaused(false);
    this.setSpeed(this.timeScale);
  }

  // Per-part sub-clip for `clip` (only the tracks whose bones live on `part`),
  // cached so repeated transitions reuse the same AnimationClip — and therefore
  // the same cached action — instead of leaking a new action into the mixer.
  _subClip(part, clip) {
    let perClip = this._partClips.get(clip);
    if (!perClip) { perClip = new Map(); this._partClips.set(clip, perClip); }
    if (!perClip.has(part)) {
      const tracks = clip.tracks.filter((t) => part.bones.has(t.name.split('.')[0]));
      perClip.set(part, tracks.length
        ? new THREE.AnimationClip(`${clip.name}#${part.root?.name || 'p'}`, clip.duration, tracks)
        : null);
    }
    return perClip.get(part);
  }

  // Smoothly blend from whatever is playing to `clip` over `duration` seconds,
  // instead of the hard cut setLayerStack does. Each part fades its current
  // action(s) out while the new one fades in; the mixer slerp-blends the
  // overlap. Falls back to a hard play when nothing is playing yet.
  crossFadeTo(clip, duration = 0.25, loop = true) {
    if (!clip) return;
    if (!this.clip || duration <= 0) { this.playClip(clip); return; }
    if (clip === this.clip) return;
    for (const part of Object.values(this.parts)) {
      if (part.grafted) continue;
      const partClip = this._subClip(part, clip);
      if (!partClip) continue;
      part.mixer ??= new THREE.AnimationMixer(part.root);
      const action = part.mixer.clipAction(partClip);
      // if we're fading back to a clip that's still fading out, reclaim its
      // action instead of letting the queued stop kill it.
      this._fades = this._fades.filter((f) => f.action !== action);
      action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      action.clampWhenFinished = !loop;
      action.reset();
      action.play();
      action.fadeIn(duration);
      for (const old of part.actions ?? []) {
        if (old === action) continue;
        old.fadeOut(duration);
        this._fades.push({ action: old, mixer: part.mixer, clip: old.getClip(), t: duration });
      }
      part.actions = [action];
    }
    this.clip = clip;
    this.layers = [{ id: 'base', clip, loop }];
    this.setPaused(false);
    this.setSpeed(this.timeScale);
  }

  stop() {
    this._teardownLayers();
    this.clip = null;
  }

  _teardownLayers() {
    this._fades.length = 0;
    this._partClips.clear(); // cached sub-clips reference the about-to-die mixers
    for (const part of Object.values(this.parts)) {
      if (part.mixer) {
        part.mixer.stopAllAction();
        part.mixer.uncacheRoot(part.root); // drop cached clips so rebuilds don't leak
      }
      part.mixer = null;
      part.action = null;
      part.actions = [];
    }
    this.layers = [];
    this.pecPhysics.reset();
    this.glutePhysics.reset();
    // restore rest rotations (positions/scales are owned by the sliders);
    // the pelvis position is pose, not shape, so a clip's root motion must be
    // undone here too or the figure stays where the animation last left it.
    for (const part of Object.values(this.parts)) {
      for (const [name, bone] of part.bones) {
        const rest = part.rest.get(name);
        if (!rest) continue;
        bone.quaternion.copy(rest.q);
        if (name === 'mPelvis') bone.position.copy(rest.p);
      }
    }
  }

  setPaused(paused) {
    this.paused = paused;
  }

  setSpeed(s) {
    this.timeScale = s;
    for (const part of Object.values(this.parts)) {
      if (part.mixer) part.mixer.timeScale = s;
    }
  }

  get playing() {
    return this.clip !== null;
  }

  update(dt) {
    if (this.paused) return;
    for (const part of Object.values(this.parts)) {
      if (part.mixer) part.mixer.update(dt);
    }
    // retire actions that have finished fading out so they stop consuming the
    // mixer (and free their cached clip) once their weight has reached zero.
    if (this._fades.length) {
      for (const f of this._fades) f.t -= dt;
      this._fades = this._fades.filter((f) => {
        if (f.t > 0) return true;
        f.action.stop();
        f.mixer.uncacheAction(f.clip);
        return false;
      });
    }
    this.pecPhysics.update(dt);
    this.glutePhysics.update(dt);

    // Expressive systems run on top of the resolved pose each frame. They are
    // no-ops while inactive/disabled.
    this.blinker.update(dt);
    this.voice.update(dt);   // microphone jaw
    this.speech.update(dt);  // TTS playback jaw / visemes
    this._applyLookAt();     // aim the eyeballs at the look-at target
  }

  // ---- eye look-at ---------------------------------------------------

  // Aim/track a world-space point with the eyes, and/or toggle tracking. All
  // fields optional. Enabling with no target yet seeds one in front of the head.
  setLookAt({ enabled, x, y, z } = {}) {
    const la = this.lookAt;
    if (typeof x === 'number') la.target.x = x;
    if (typeof y === 'number') la.target.y = y;
    if (typeof z === 'number') la.target.z = z;
    if (typeof enabled === 'boolean') {
      if (enabled && la.target.lengthSq() === 0) this._seedLookTarget();
      la.enabled = enabled;
    }
    return this.getLookAt();
  }

  getLookAt() {
    return { enabled: this.lookAt.enabled, position: this.lookAt.target.toArray() };
  }

  // Default look-at point: ~1 m in front of the head (matches the editor handle).
  _seedLookTarget() {
    const head = this._findBone('mHead');
    if (!head) return;
    this.group.updateMatrixWorld(true);
    head.getWorldPosition(this.lookAt.target);
    this.lookAt.target.x += 1.0;
    this.lookAt.target.z += 0.08;
  }

  _findBone(name) {
    for (const part of Object.values(this.parts)) {
      const b = part.bones.get(name);
      if (b) return b;
    }
    return null;
  }

  _applyLookAt() {
    const la = this.lookAt;
    const part = this.parts.eyes;
    if (!part) return;
    if (la.enabled) {
      this.group.updateMatrixWorld(true);
      for (const name of ['mEyeLeft', 'mEyeRight']) {
        const bone = part.bones.get(name);
        const rest = part.rest.get(name);
        if (bone && rest) this._aimEyeAt(bone, rest, la.target);
      }
      la._was = true;
    } else if (la._was) {
      // tracking just turned off — return the eyes to rest once
      for (const name of ['mEyeLeft', 'mEyeRight']) {
        const bone = part.bones.get(name);
        const rest = part.rest.get(name);
        if (bone && rest) bone.quaternion.copy(rest.q);
      }
      la._was = false;
    }
  }

  // Rotate an eye bone from rest so its local +X (forward) points at the target.
  _aimEyeAt(bone, rest, targetWorld) {
    if (!bone.parent) return;
    bone.parent.updateMatrixWorld(true);
    _lookM4.copy(bone.parent.matrixWorld).invert();
    _lookV1.copy(targetWorld).applyMatrix4(_lookM4); // target in the bone's parent frame
    _lookV2.copy(_lookV1).sub(rest.p);
    const len = _lookV2.length();
    if (len < 1e-6) return;
    _lookV2.divideScalar(len);
    _lookQ0.setFromUnitVectors(_EYE_FWD, _lookV2);
    _lookE.setFromQuaternion(_lookQ0, 'YXZ');
    _lookE.x = 0;
    _lookE.y = THREE.MathUtils.clamp(_lookE.y, -EYE_LOOK_MAX_YAW, EYE_LOOK_MAX_YAW);
    _lookE.z = THREE.MathUtils.clamp(_lookE.z, -EYE_LOOK_MAX_PITCH, EYE_LOOK_MAX_PITCH);
    bone.quaternion.copy(rest.q).multiply(_lookQ1.setFromEuler(_lookE));
  }

  // ---- capability facades -------------------------------------------
  // Thin convenience wrappers over the composed members, so common actions
  // read as avatar verbs. The members themselves stay public for full control.

  // Microphone lip-sync.
  startMic() { return this.voice.start(); }
  stopMic() { this.voice.stop(); }

  // Play a TTS audio clip and lip-sync to it (per-viseme if visemeUrl given).
  speak(url, visemeUrl) { return this.speech.play(url, visemeUrl); }
  stopSpeaking() { this.speech.stop(); }

  // Procedural blinking.
  setBlinking(on) { this.blinker.setEnabled(on); }
  blinkNow() { this.blinker.blinkNow(); }

  // Attach a prop to a bone (built-in factory or loaded GLB file).
  attachBuiltin(name, boneName, factory, offset) {
    return this.attachments.attachBuiltin(name, boneName, factory, offset);
  }
  attachFile(file, boneName, offset) {
    return this.attachments.attachFile(file, boneName, offset);
  }

  // Free every GPU resource this avatar owns. After dispose() the instance is
  // dead; remove its group from the scene first.
  dispose() {
    this.stop();
    this.voice.stop();
    this.speech.stop();
    this.attachments.clear();
    for (const region of Object.values(this._regions)) region.dispose?.();
    this.group.traverse((obj) => {
      if (obj.isSkinnedMesh || obj.isMesh) obj.geometry?.dispose?.();
    });
    this.group.removeFromParent();
  }
}

// Deprecated alias — the class was renamed RuthAvatar → Avatar when the
// per-avatar capabilities were folded in. Kept so existing imports keep working.
export { Avatar as RuthAvatar };
