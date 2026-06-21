import * as THREE from 'three/webgpu';
import { BVHLoader } from 'three/addons/loaders/BVHLoader.js';

// BVH joint name -> avatar skeleton bone name.
//
// The classic Poser/Avimator/QAvimator BVH rig uses these names. The
// CMU/MotionBuilder-style aliases are
// included as well so common free mocap files retarget too.
const NAME_MAP = {
  // Poser-standard names
  hip: 'mPelvis', abdomen: 'mTorso', chest: 'mChest', neck: 'mNeck', head: 'mHead',
  lCollar: 'mCollarLeft', lShldr: 'mShoulderLeft', lForeArm: 'mElbowLeft', lHand: 'mWristLeft',
  rCollar: 'mCollarRight', rShldr: 'mShoulderRight', rForeArm: 'mElbowRight', rHand: 'mWristRight',
  lThigh: 'mHipLeft', lShin: 'mKneeLeft', lFoot: 'mAnkleLeft', lToe: 'mFootLeft',
  rThigh: 'mHipRight', rShin: 'mKneeRight', rFoot: 'mAnkleRight', rToe: 'mFootRight',
  // Bento fingers (Poser-style naming as used in pirouette.bvh)
  lThumb1: 'mHandThumb1Left', lThumb2: 'mHandThumb2Left',
  lIndex1: 'mHandIndex1Left', lIndex2: 'mHandIndex2Left',
  lMid1: 'mHandMiddle1Left', lMid2: 'mHandMiddle2Left',
  lRing1: 'mHandRing1Left', lRing2: 'mHandRing2Left',
  lPinky1: 'mHandPinky1Left', lPinky2: 'mHandPinky2Left',
  rThumb1: 'mHandThumb1Right', rThumb2: 'mHandThumb2Right',
  rIndex1: 'mHandIndex1Right', rIndex2: 'mHandIndex2Right',
  rMid1: 'mHandMiddle1Right', rMid2: 'mHandMiddle2Right',
  rRing1: 'mHandRing1Right', rRing2: 'mHandRing2Right',
  rPinky1: 'mHandPinky1Right', rPinky2: 'mHandPinky2Right',
  // CMU / MotionBuilder-style aliases
  Hips: 'mPelvis', LowerBack: 'mTorso', Spine: 'mTorso', Spine1: 'mChest',
  Neck: 'mNeck', Neck1: 'mNeck', Head: 'mHead',
  LeftShoulder: 'mCollarLeft', LeftArm: 'mShoulderLeft', LeftForeArm: 'mElbowLeft', LeftHand: 'mWristLeft',
  RightShoulder: 'mCollarRight', RightArm: 'mShoulderRight', RightForeArm: 'mElbowRight', RightHand: 'mWristRight',
  LeftUpLeg: 'mHipLeft', LeftLeg: 'mKneeLeft', LeftFoot: 'mAnkleLeft', LeftToeBase: 'mFootLeft',
  RightUpLeg: 'mHipRight', RightLeg: 'mKneeRight', RightFoot: 'mAnkleRight', RightToeBase: 'mFootRight',
};

const loader = new BVHLoader();

export function parseBVH(text) {
  return loader.parse(text);
}

export async function loadBVH(url) {
  // Bypass the HTTP cache so freshly edited/regenerated clips always load
  // (the bundled .bvh files change during authoring).
  const text = await (await fetch(url, { cache: 'reload' })).text();
  return parseBVH(text);
}

// Retarget a BVHLoader result onto the avatar skeleton.
//
// Both rigs are "world-aligned": BVH joints carry no rest orientation,
// and the Avastar-exported Ruth rig stores its bones as pure translations.
// The frame difference between them: the BVH rig is Y-up facing +Z with
// arms along ±X (Poser convention), the Ruth armature is Z-up facing +X
// with arms along ±Y (Ruth convention). That axis change is M = Rz(90°) ∘
// Rx(90°); every joint rotation is conjugated by it and the hip translation
// is rotated by it and rescaled from BVH units to meters.
//
// Returns a THREE.AnimationClip with tracks named "<bone>.quaternion" and
// "mPelvis.position" that RuthAvatar.playClip binds by node name.
export function retargetToRuth(bvh, pelvisRestZ) {
  const C = new THREE.Quaternion()
    .setFromEuler(new THREE.Euler(0, 0, Math.PI / 2))
    .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)));
  const Cinv = C.clone().invert();

  // Hip rest height (first position keyframe, Y-up) gives us the unit scale.
  let posScale = 1;
  const hipPosTrack = bvh.clip.tracks.find(
    (t) => t.name.endsWith('.position') && NAME_MAP[trackBone(t.name)] === 'mPelvis'
  );
  if (hipPosTrack) {
    const y0 = hipPosTrack.values[1];
    if (y0 > 0.001) posScale = pelvisRestZ / y0;
  }

  const tracks = [];
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();

  for (const track of bvh.clip.tracks) {
    const bone = NAME_MAP[trackBone(track.name)];
    if (!bone) continue;

    if (track.name.endsWith('.quaternion')) {
      const values = new Float32Array(track.values.length);
      for (let i = 0; i < track.values.length; i += 4) {
        q.fromArray(track.values, i);
        q.premultiply(C).multiply(Cinv); // q' = C * q * C^-1
        q.toArray(values, i);
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, track.times, values));
    } else if (track.name.endsWith('.position') && bone === 'mPelvis') {
      const values = new Float32Array(track.values.length);
      for (let i = 0; i < track.values.length; i += 3) {
        v.fromArray(track.values, i).multiplyScalar(posScale).applyQuaternion(C);
        v.toArray(values, i);
      }
      tracks.push(new THREE.VectorKeyframeTrack('mPelvis.position', track.times, values));
    }
  }

  return new THREE.AnimationClip(bvh.clip.name || 'bvh', bvh.clip.duration, tracks);
}

function trackBone(trackName) {
  // BVHLoader names tracks ".bones[name].quaternion"
  const m = trackName.match(/\.bones\[(.+?)\]\./);
  return m ? m[1] : trackName.split('.')[0];
}
