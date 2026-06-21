import * as THREE from 'three/webgpu';
import { getCanonicalBone } from '../../skeleton.js';
import { ANIMATION_REGISTRY, findAnimation } from '../common/registry.js';

const _euler = new THREE.Euler();
const _headPos = new THREE.Vector3();
const _pelvisPos = new THREE.Vector3();
const _headFwd = new THREE.Vector3(1, 0, 0);
const _headQ = new THREE.Quaternion();

function avatarPose(avatar) {
  avatar.group.updateMatrixWorld(true);
  const head = getCanonicalBone(avatar, 'mHead');
  const pelvis = getCanonicalBone(avatar, 'mPelvis');
  const out = {
    avatar: {
      position: avatar.group.position.toArray(),
      quaternion: avatar.group.quaternion.toArray(),
      euler: _euler.setFromQuaternion(avatar.group.quaternion, 'XYZ').toArray(),
      scale: avatar.group.scale.toArray(),
    },
  };
  if (head) {
    head.getWorldPosition(_headPos);
    head.getWorldQuaternion(_headQ);
    _headFwd.set(1, 0, 0).applyQuaternion(_headQ);
    out.head = { worldPosition: _headPos.toArray(), worldForward: _headFwd.toArray() };
  }
  if (pelvis) {
    pelvis.getWorldPosition(_pelvisPos);
    out.pelvis = { worldPosition: _pelvisPos.toArray() };
  }
  return out;
}

// API surface exposed to the MCP server over the WebSocket bridge.
//
// Tools:
//   - capture_screenshot    : render the current camera view to a PNG data URL
//   - get_avatar_transform  : live avatar / head / pelvis world transforms
//   - list_animations       : enumerate the BVH animation registry
//   - trigger_animation     : play a registered animation by id
//   - list_avatars          : enumerate the live avatars + which is active
//   - select_avatar         : make a given avatar the active one
//   - add_avatar            : spawn a new avatar into the scene
//
// Every avatar-touching tool accepts an optional `avatar` selector (index or
// id); omitted means the active avatar. `manager` is the AvatarManager;
// `playAnimationOn(avatar, id)` / `selectAvatar(index)` / `addAvatar(opts)` are
// provided by main.js so playback + switching share the app's own code paths.
export function createAvatarApi({ manager, scene, camera, renderer, playAnimationOn, selectAvatar, addAvatar }) {
  const resolve = (sel) => manager.resolve(sel); // → { entry, index }

  return {
    capture_screenshot() {
      if (!renderer || !scene || !camera) throw new Error('Renderer not available for capture');
      // Render synchronously and read the buffer in the same tick — the
      // default renderer has no preserveDrawingBuffer, so the canvas is only
      // valid for toDataURL immediately after a render.
      renderer.render(scene, camera);
      const dataUrl = renderer.domElement.toDataURL('image/png');
      return {
        dataUrl,
        width: renderer.domElement.width,
        height: renderer.domElement.height,
      };
    },

    get_avatar_transform({ avatar } = {}) {
      const { entry, index } = resolve(avatar);
      // avatarPose() already has a top-level `avatar` key (the group transform),
      // so the selector index goes under `avatarIndex` to avoid clobbering it.
      return { avatarIndex: index, ...avatarPose(entry.avatar) };
    },

    list_animations() {
      return {
        count: ANIMATION_REGISTRY.length,
        animations: ANIMATION_REGISTRY.map(({ id, label, file }) => ({ id, label, file })),
      };
    },

    async trigger_animation({ id, avatar } = {}) {
      if (typeof id !== 'string' || !id) {
        throw new Error('id is required (string) — call list_animations to see valid ids');
      }
      const entry = findAnimation(id);
      if (!entry) {
        const known = ANIMATION_REGISTRY.map((a) => a.id).join(', ');
        throw new Error(`Unknown animation: ${id}. Known ids: ${known}`);
      }
      if (typeof playAnimationOn !== 'function') {
        throw new Error('playAnimationOn is not wired — cannot trigger animations from MCP');
      }
      const { entry: target, index } = resolve(avatar);
      await playAnimationOn(target.avatar, id);
      return { id, file: entry.file, avatar: index, started: true };
    },

    // ---- multi-avatar management --------------------------------------

    list_avatars() {
      return {
        count: manager.count,
        active: manager.activeIndex,
        avatars: manager.entries.map((e, i) => ({
          index: i,
          id: e.id,
          active: i === manager.activeIndex,
          position: e.avatar.group.position.toArray().map((n) => +n.toFixed(3)),
        })),
      };
    },

    select_avatar({ avatar } = {}) {
      const { index } = resolve(avatar);
      if (typeof selectAvatar !== 'function') throw new Error('selectAvatar is not wired');
      selectAvatar(index);
      return { active: manager.activeIndex };
    },

    async add_avatar({ x, z } = {}) {
      if (typeof addAvatar !== 'function') throw new Error('addAvatar is not wired');
      const hasPos = typeof x === 'number' || typeof z === 'number';
      const index = await addAvatar(hasPos ? { position: { x, z } } : undefined);
      return { index, count: manager.count };
    },
  };
}
