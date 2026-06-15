// metaverse-avatar — public library entry point.
//
// The whole avatar is a single class: `new Avatar()` builds a self-contained,
// independently-controllable figure (skeleton, materials, animation, physics,
// blinking, lip-sync, attachments, eye look-at). Construct as many as you like
// and drive them separately. `three` is a peer dependency — the host app
// provides it (via an import map in the browser, or node_modules under a
// bundler), so multiple avatars share one THREE instance.
//
//   import { Avatar } from 'metaverse-avatar';
//   const avatar = await new Avatar().load('models/'); // basePath is required
//   scene.add(avatar.group);
//   // each frame: avatar.update(dt)

export { Avatar, RuthAvatar } from './Avatar.js';

// Composed capability classes — exported for advanced use / custom wiring.
// Each `Avatar` already owns one of each (avatar.blinker, .voice, .speech,
// .attachments); these exports are for building your own.
export { Blinker } from './blink.js';
export { VoiceMouth } from './voice.js';
export { SpeechMouth } from './speech.js';
// NOTE: locomotion is intentionally NOT a library export — moving a figure
// through the world is the host app's concern. A ready-made controller lives in
// examples/common/locomotion.js (used by the studio + simple demos); copy it
// into your app, or drive avatar.group + the animation methods yourself.
export {
  Attachments,
  ATTACHMENT_POINTS,
  BUILTIN_PRESETS,
  createSword,
} from './attachments.js';

// Clip loading / retargeting (BVH + glTF → the Ruth rig).
export { parseBVH, loadBVH, retargetToRuth } from './bvh.js';
export { initGltfAnim, getGltfClip } from './gltfAnim.js';

// Shape sliders + sex presets, and the bone-adjustment solver they feed.
export { SLIDERS, SEX_PRESETS, computeBoneAdjustments } from './sliders.js';

// Nipple protrusion vertex morph (the 'nipple' special slider; Avatar owns one).
export { buildNippleMorph, applyNippleMorph } from './nipple.js';

// PBR material plumbing (per-region map channels, clothing-layer stacks).
export { PBR_CHANNELS, emptyMapSet, PBRMaterialStack } from './pbr.js';

// Lip-sync viseme model (shared by SpeechMouth).
export { VISEMES, charToViseme, buildVisemeTimeline, sampleViseme } from './visemes.js';

// Skeleton helpers — bone lookup / reset across the split avatar parts.
export {
  partForBone,
  getCanonicalBone,
  listBones,
  getBoneRest,
  resetBone,
  syncBoneToAllParts,
} from './skeleton.js';

// Physics (jiggle/sag soft-body driver; avatars own two instances each).
export { SoftBodyPhysics } from './physics.js';
