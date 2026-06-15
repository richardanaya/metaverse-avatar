import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Bone name mapping: UAL1 glTF node name → Ruth avatar bone name.
// Both skeletons use hierarchy-compatible names but the UAL1 rig uses
// glTF convention (lowercase, _l/_r suffix) while Ruth uses Second Life
// bone names (m-prefix, CamelCase).  Leaf bones without a Ruth
// counterpart (finger tips, ball joint, root) are left unmapped and
// their tracks are silently dropped.
const UAL1_TO_RUTH = {
  root: null,
  pelvis: 'mPelvis',
  spine_01: 'mSpine1',
  spine_02: 'mSpine2',
  spine_03: 'mSpine3',
  neck_01: 'mNeck',
  Head: 'mHead',
  clavicle_l: 'mCollarLeft',
  upperarm_l: 'mShoulderLeft',
  lowerarm_l: 'mElbowLeft',
  hand_l: 'mWristLeft',
  thumb_01_l: 'mHandThumb1Left',
  thumb_02_l: 'mHandThumb2Left',
  thumb_03_l: 'mHandThumb3Left',
  thumb_04_leaf_l: null, // fingertip — no Ruth bone
  index_01_l: 'mHandIndex1Left',
  index_02_l: 'mHandIndex2Left',
  index_03_l: 'mHandIndex3Left',
  index_04_leaf_l: null,
  middle_01_l: 'mHandMiddle1Left',
  middle_02_l: 'mHandMiddle2Left',
  middle_03_l: 'mHandMiddle3Left',
  middle_04_leaf_l: null,
  ring_01_l: 'mHandRing1Left',
  ring_02_l: 'mHandRing2Left',
  ring_03_l: 'mHandRing3Left',
  ring_04_leaf_l: null,
  pinky_01_l: 'mHandPinky1Left',
  pinky_02_l: 'mHandPinky2Left',
  pinky_03_l: 'mHandPinky3Left',
  pinky_04_leaf_l: null,
  clavicle_r: 'mCollarRight',
  upperarm_r: 'mShoulderRight',
  lowerarm_r: 'mElbowRight',
  hand_r: 'mWristRight',
  thumb_01_r: 'mHandThumb1Right',
  thumb_02_r: 'mHandThumb2Right',
  thumb_03_r: 'mHandThumb3Right',
  thumb_04_leaf_r: null,
  index_01_r: 'mHandIndex1Right',
  index_02_r: 'mHandIndex2Right',
  index_03_r: 'mHandIndex3Right',
  index_04_leaf_r: null,
  middle_01_r: 'mHandMiddle1Right',
  middle_02_r: 'mHandMiddle2Right',
  middle_03_r: 'mHandMiddle3Right',
  middle_04_leaf_r: null,
  ring_01_r: 'mHandRing1Right',
  ring_02_r: 'mHandRing2Right',
  ring_03_r: 'mHandRing3Right',
  ring_04_leaf_r: null,
  pinky_01_r: 'mHandPinky1Right',
  pinky_02_r: 'mHandPinky2Right',
  pinky_03_r: 'mHandPinky3Right',
  pinky_04_leaf_r: null,
  thigh_l: 'mHipLeft',
  calf_l: 'mKneeLeft',
  foot_l: 'mAnkleLeft',
  ball_l: 'mFootLeft',
  ball_leaf_l: null, // toe tip
  thigh_r: 'mHipRight',
  calf_r: 'mKneeRight',
  foot_r: 'mAnkleRight',
  ball_r: 'mFootRight',
  ball_leaf_r: null,
};

// ---- module state (lazy-initialised, per GLB file) ------------------

// Each UAL GLB (UAL1, UAL2, …) shares the identical 67-bone skeleton but
// carries its own animation set, so clips are cached per file path.
const _cache = new Map();    // glbFile -> Map<glbAnimName, AnimationClip>
const _loading = new Map();  // glbFile -> Promise (dedupes concurrent loads)

const _qTmp = new THREE.Quaternion();

// ---- public API ------------------------------------------------------

// Load a UAL GLB, retarget every animation in it, and cache the clips.
// `avatar` supplies the pelvis rest pose/height needed to retarget root
// motion. Safe to call repeatedly / concurrently for the same file — it
// loads once.
export async function initGltfAnim(glbFile, avatar, signal) {
  if (_cache.has(glbFile)) return;
  if (_loading.has(glbFile)) return _loading.get(glbFile);
  const p = _loadAndRetarget(glbFile, avatar, signal).then((clips) => {
    _cache.set(glbFile, clips);
    _loading.delete(glbFile);
  }, (err) => {
    _loading.delete(glbFile);
    throw err;
  });
  _loading.set(glbFile, p);
  return p;
}

// Return a retargeted AnimationClip for the named animation in a loaded GLB,
// or null if not found. Throws if the file hasn't been initialised yet.
export function getGltfClip(glbFile, glbAnimName) {
  const clips = _cache.get(glbFile);
  if (!clips) throw new Error(`glTF animations for ${glbFile} not initialised — call initGltfAnim(glbFile) first`);
  return clips.get(glbAnimName) ?? null;
}

async function _loadAndRetarget(glbFile, avatar, signal) {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(glbFile, undefined, signal ? { signal } : undefined);
  const ctx = _buildXform(gltf.parser.json.nodes, avatar);

  const clips = new Map();
  for (const glbAnim of gltf.animations) {
    const clip = _retargetGltfClip(glbAnim, ctx);
    if (clip) clips.set(glbAnim.name, clip);
  }
  return clips;
}

// Build the retarget context from a GLB's node list + the target avatar.
// Returns { xform: Map<glbNodeName, { P, Pinv, restInv }>, pelvisPos } where
// pelvisPos carries everything needed to retarget root (pelvis) translation.
function _buildXform(nodes, avatar) {
  // Per-node LOCAL rest rotation (node[].rotation), and child→parent index map.
  const localRest = nodes.map((node) =>
    (node.rotation && node.rotation.length === 4)
      ? new THREE.Quaternion(node.rotation[0], node.rotation[1], node.rotation[2], node.rotation[3])
      : new THREE.Quaternion());
  const parentOf = new Array(nodes.length).fill(-1);
  nodes.forEach((node, i) => {
    for (const c of node.children ?? []) parentOf[c] = i;
  });

  // WORLD rest orientation per node = product of LOCAL rests from the root
  // down (parent-first). This is the bone's bind orientation in the glTF
  // scene frame — exactly what the BVH rig lacks (it is world-aligned).
  // Resolved per-node up the full chain, so node ordering doesn't matter.
  const worldRest = new Array(nodes.length);
  const resolveWorld = (i) => {
    if (worldRest[i]) return worldRest[i];
    const p = parentOf[i];
    const q = p === -1
      ? localRest[i].clone()
      : resolveWorld(p).clone().multiply(localRest[i]);
    worldRest[i] = q;
    return q;
  };
  nodes.forEach((_, i) => resolveWorld(i));

  // Precompute the per-bone conjugation operator P = C · Wrest[parent] and the
  // source bind inverse, so the per-frame loop is just two quaternion products.
  const xform = new Map();
  nodes.forEach((node, i) => {
    if (!node.name || !UAL1_TO_RUTH[node.name]) return;
    const p = parentOf[i];
    const wrestParent = p === -1 ? _IDENT : worldRest[p];
    const P = _C.clone().multiply(wrestParent);
    xform.set(node.name, {
      P,
      Pinv: P.clone().invert(),
      restInv: localRest[i].clone().invert(),
    });
  });

  // Root-motion descriptor for the pelvis translation track. The pelvis node's
  // translation lives in its parent (root) authored Z-up frame, so the same P
  // operator that re-frames its rotation also re-frames the translation delta.
  // We scale source units → Ruth units by the pelvis-height ratio and add the
  // result to Ruth's own rest pelvis position (delta-from-bind, so the figure
  // stays planted at rest and only the motion carries over).
  let pelvisPos = null;
  const pelvisX = xform.get('pelvis');
  const pelvisNode = nodes.find((n) => n.name === 'pelvis');
  const ruthRest = avatar?.parts?.body?.rest?.get('mPelvis');
  const t0 = pelvisNode?.translation;
  if (pelvisX && ruthRest && t0 && t0[2] > 1e-4) {
    pelvisPos = {
      P: pelvisX.P,                                  // root-local → Ruth frame
      t0: new THREE.Vector3(t0[0], t0[1], t0[2]),    // source bind translation
      scale: avatar.pelvisRestZ / t0[2],             // source → Ruth body scale
      restP: ruthRest.p.clone(),                     // Ruth rest pelvis position
    };
  }
  return { xform, pelvisPos };
}

// ---- retargeting internals -------------------------------------------

// glTF → Ruth coordinate-frame change, same as BVH retargeting.
// glTF uses Y-up; Ruth uses Z-up +X forward (Second Life). The source rig's
// own Z-up→Y-up tilt lives in its `root` node and is already folded into each
// bone's Wrest, so C only does the final scene-frame swap.
const _C = new THREE.Quaternion()
  .setFromEuler(new THREE.Euler(0, 0, Math.PI / 2))
  .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)));
const _IDENT = new THREE.Quaternion();

function _retargetGltfClip(glbAnim, { xform, pelvisPos }) {
  // glTF clip tracks: name = "nodeName.quaternion" (property)
  // We need to re-key them as "ruthBoneName.quaternion" and remap quaternions.
  const tracks = [];
  const v = new THREE.Vector3();

  for (const track of glbAnim.tracks) {
    // Track name format: "boneName.quaternion" (glTF convention)
    const dotIdx = track.name.lastIndexOf('.');
    const glbNodeName = dotIdx > 0 ? track.name.slice(0, dotIdx) : track.name;
    const prop = dotIdx > 0 ? track.name.slice(dotIdx + 1) : '';
    const ruthName = UAL1_TO_RUTH[glbNodeName];
    if (!ruthName) continue; // unmapped (leaf node, root, etc.)

    // Pelvis root motion: re-frame the source translation delta and add it to
    // Ruth's rest pelvis position. Only the pelvis carries real translation;
    // every other bone's translation track is just its constant bone offset.
    // (GLTFLoader maps the glTF "translation" path to a ".position" track.)
    if (prop === 'position' && glbNodeName === 'pelvis') {
      if (!pelvisPos) continue; // no avatar pelvis data → keep pelvis at rest
      const values = new Float32Array(track.values.length);
      for (let i = 0; i < track.values.length; i += 3) {
        v.fromArray(track.values, i)                 // t (root-local)
          .sub(pelvisPos.t0)                         // Δ = t − bind
          .multiplyScalar(pelvisPos.scale)           // source → Ruth units
          .applyQuaternion(pelvisPos.P)              // root-local → Ruth frame
          .add(pelvisPos.restP);                     // + Ruth rest position
        v.toArray(values, i);
      }
      tracks.push(new THREE.VectorKeyframeTrack(
        'mPelvis.position',
        Array.isArray(track.times) ? new Float32Array(track.times) : track.times,
        values,
      ));
      continue;
    }

    const x = xform.get(glbNodeName);
    if (!x) continue; // unmapped or missing rest data

    if (prop === 'quaternion') {
      // Delta-from-bind retarget. The source track holds the FULL local
      // rotation f (which equals the bind rotation at rest), so:
      //   Δ = f · restSrc⁻¹          — motion relative to bind, in parent frame
      //   local_ruth = P · Δ · P⁻¹   — re-express in Ruth's (world-aligned) frame
      // where P = C · Wrest[parent]. At the source bind pose Δ = identity, so
      // Ruth falls back to its own natural rest. For a world-aligned source
      // (Wrest = restSrc = identity) this collapses to the BVH formula C·f·C⁻¹.
      const values = new Float32Array(track.values.length);
      for (let i = 0; i < track.values.length; i += 4) {
        _qTmp.fromArray(track.values, i);  // f
        _qTmp.multiply(x.restInv);         // Δ = f · restSrc⁻¹
        _qTmp.premultiply(x.P).multiply(x.Pinv); // P · Δ · P⁻¹
        _qTmp.toArray(values, i);
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(
        `${ruthName}.quaternion`,
        Array.isArray(track.times) ? new Float32Array(track.times) : track.times,
        values,
      ));
    }
  }

  if (tracks.length === 0) return null;
  return new THREE.AnimationClip(glbAnim.name, glbAnim.duration, tracks);
}
