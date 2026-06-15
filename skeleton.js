// Canonical bone ownership across Ruth's split parts (body / hands / feet).
// These helpers resolve which part owns a bone and read/reset its rest transform,
// used by the BVH editor and the MCP example's tools (examples/mcp/avatarApi.js).

export function partForBone(name) {
  if (
    name.startsWith('mHand') || name === 'mWristLeft' || name === 'mWristRight'
    || name === 'mCollarLeft' || name === 'mCollarRight'
    || name === 'mShoulderLeft' || name === 'mShoulderRight'
    || name === 'mElbowLeft' || name === 'mElbowRight'
  ) return 'hands';
  if (
    name.startsWith('mFoot') || name === 'mAnkleLeft' || name === 'mAnkleRight'
    || name === 'mHipLeft' || name === 'mHipRight'
    || name === 'mKneeLeft' || name === 'mKneeRight'
  ) return 'feet';
  return 'body';
}

export function getCanonicalBone(avatar, boneName) {
  const preferred = partForBone(boneName);
  const fromPreferred = avatar.parts[preferred]?.bones.get(boneName);
  if (fromPreferred) return fromPreferred;
  for (const part of Object.values(avatar.parts)) {
    const bone = part.bones.get(boneName);
    if (bone) return bone;
  }
  return null;
}

export function listBones(avatar) {
  const names = new Set();
  for (const part of Object.values(avatar.parts)) {
    for (const name of part.bones.keys()) names.add(name);
  }
  return [...names].sort();
}

export function getBoneRest(avatar, boneName) {
  return avatar.parts[partForBone(boneName)]?.rest.get(boneName) ?? null;
}

// Reset a bone's POSE only (local rotation). Scale and non-pelvis position are
// owned by the shape sliders (RuthAvatar.applyShape), so we leave them alone.
export function resetBone(avatar, boneName) {
  const bone = getCanonicalBone(avatar, boneName);
  const rest = getBoneRest(avatar, boneName);
  if (!bone || !rest) return false;
  bone.quaternion.copy(rest.q);
  if (boneName === 'mPelvis') bone.position.copy(rest.p);
  return syncBoneToAllParts(avatar, boneName);
}

// Fan a bone's rotation out to every (non-grafted) part's copy of it.
// Rotation only — scale/position stay slider-owned (pelvis position excepted,
// since it is pose, not shape).
export function syncBoneToAllParts(avatar, boneName) {
  const src = getCanonicalBone(avatar, boneName);
  if (!src) return false;
  for (const part of Object.values(avatar.parts)) {
    if (part.grafted) continue;
    const dst = part.bones.get(boneName);
    if (dst && dst !== src) {
      dst.quaternion.copy(src.quaternion);
      if (boneName === 'mPelvis') dst.position.copy(src.position);
    }
  }
  avatar.group.updateMatrixWorld(true);
  return true;
}