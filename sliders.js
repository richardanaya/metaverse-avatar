// Shape sliders for the Ruth2 fitted-mesh body.
//
// How fitted-mesh shape sliders work: collision-volume bones are scaled and
// offset to deform the skin. In upstream viewers that mechanism reads
// avatar_lad.xml, where
// each visual parameter drives some combination of (a) morph targets baked
// into the system avatar mesh and (b) scale/offset transforms on skeleton
// bones — in particular the invisible "collision volume" bones (BELLY, BUTT,
// CHEST, LEFT_PEC, ...). Mesh bodies like Ruth2 can't use the system morphs,
// so fitted-mesh bodies are weighted to the collision volumes and respond to
// the bone-driven subset of sliders. We reproduce that idea here: every
// slider multiplies the rest scale (and optionally offsets the rest
// position) of a set of bones.
//
// Each effect: { bones: [...], scale: [x,y,z amounts], offset: [x,y,z meters],
// rot: [x,y,z radians] }. Applied as: boneScale = rest * (1 + amount * t),
// bonePos = rest + offset * t, boneRot = rest * euler(rot * t), with t in
// [-1, 1]. NOTE: the rig is Z-up inside the armature (Blender convention)
// and the avatar faces +X, so Z is "up", Y is left/right, X is front/back.

// Bento finger bone name helpers: mHand<Finger><Joint><Side>
const FINGERS = ['Index', 'Middle', 'Ring', 'Pinky'];
const fingerBones = (side, fingers = FINGERS, joints = [1, 2, 3]) =>
  fingers.flatMap((f) => joints.map((j) => `mHand${f}${j}${side}`));

// Lip bone trios (left / centre / right), upper and lower — independently
// addressable, so the top and bottom lips can be shaped separately. Plus the
// two mouth corners. In the armature frame: X = front/back (protrusion),
// Y = left/right, Z = up/down.
const UPPER_LIP = ['mFaceLipUpperLeft', 'mFaceLipUpperCenter', 'mFaceLipUpperRight'];
const LOWER_LIP = ['mFaceLipLowerLeft', 'mFaceLipLowerCenter', 'mFaceLipLowerRight'];
const LIP_CORNERS = ['mFaceLipCornerLeft', 'mFaceLipCornerRight'];
const ALL_LIP = [...UPPER_LIP, ...LOWER_LIP];
const MOUTH_ALL = [...ALL_LIP, ...LIP_CORNERS]; // every lip bone, for whole-mouth moves

export const SLIDERS = [
  // ---- Body ----
  { id: 'height', group: 'Body', label: 'Height', special: 'height' },
  {
    // Lateral (side-to-side) body width. The rig is Z-up / faces +X, so the
    // lateral axis is Y (see comment above); scaling X here would bulge the
    // belly/butt front-to-back, which is the `belly_size` slider's job. The
    // neck is deliberately excluded — it's owned by neck_length / neck_thickness
    // and scaling it would propagate through the grafted head (graftHeadParts)
    // and deform the head/face. Clavicle collision volumes widen the shoulder
    // mesh, AND we offset the collar joints laterally so the shoulder joints
    // (and thus the arms in the hands part) track the widening torso — otherwise
    // the torso widens but the arms stay put and float off the shoulders. The
    // dedicated `shoulders` slider does this same joint offset for fine control.
    id: 'thickness', group: 'Body', label: 'Body Thickness',
    effects: [{ bones: ['PELVIS', 'BELLY', 'CHEST', 'UPPER_BACK', 'LOWER_BACK', 'BUTT'], scale: [0, 0.22, 0] },
              { bones: ['L_CLAVICLE', 'R_CLAVICLE'], scale: [0, 0.22, 0] },
              { bones: ['mCollarLeft'], offset: [0, 0.03, 0] },
              { bones: ['mCollarRight'], offset: [0, -0.03, 0] }],
  },

  // ---- Head ----
  // (the grafted Ruth2 v4 head: face bones under the synthesized mHead)
  {
    id: 'head_size', group: 'Head', label: 'Head Size',
    effects: [{ bones: ['mHead'], scale: [0.25, 0.25, 0.25] }],
  },
  {
    // Overall face elongation (mHead Z = vertical).  Long faces (oval/diamond)
    // vs short faces (round/square) — combine with the width controls below.
    id: 'face_length', group: 'Head', label: 'Face Length',
    effects: [{ bones: ['mHead'], scale: [0, 0, 0.2] }],
  },
  {
    // Overall face width (mHead Y = lateral).  Broad vs narrow whole head.
    id: 'face_width', group: 'Head', label: 'Face Width',
    effects: [{ bones: ['mHead'], scale: [0, 0.18, 0] }],
  },
  {
    // Width at the forehead/temple level — the top of the face-shape triangle.
    // Wide forehead + narrow jaw = heart shape.
    id: 'forehead_width', group: 'Head', label: 'Forehead Width',
    effects: [
      { bones: ['mFaceForeheadLeft'], offset: [0, 0.007, 0] },
      { bones: ['mFaceForeheadRight'], offset: [0, -0.007, 0] },
    ],
  },
  {
    // Width at the cheekbone level — the middle of the face-shape triangle.
    // Wide here with narrow forehead + jaw = diamond shape.
    id: 'cheek_width', group: 'Head', label: 'Cheekbone Width',
    effects: [
      { bones: ['mFaceCheekUpperLeft'], offset: [0, 0.007, 0] },
      { bones: ['mFaceCheekUpperRight'], offset: [0, -0.007, 0] },
    ],
  },
  {
    id: 'ear_size', group: 'Head', label: 'Ear Size',
    effects: [{ bones: ['mFaceEar1Left', 'mFaceEar1Right'], scale: [0.6, 0.6, 0.6] }],
  },
  {
    // Ear protrusion: push the whole ear laterally outward (Y) so it stands off
    // the head; negative tucks it flat against the skull.
    id: 'ear_angle', group: 'Head', label: 'Ear Protrusion',
    effects: [
      { bones: ['mFaceEar1Left', 'mFaceEar2Left'], offset: [0, 0.006, 0] },
      { bones: ['mFaceEar1Right', 'mFaceEar2Right'], offset: [0, -0.006, 0] },
    ],
  },
  {
    // Ear length/height (Z).  Scales the base bone; the tip bone inherits it, so
    // the whole ear stretches vertically.
    id: 'ear_length', group: 'Head', label: 'Ear Length',
    effects: [{ bones: ['mFaceEar1Left', 'mFaceEar1Right'], scale: [0, 0, 0.5] }],
  },
  {
    // Pointed / elf ears: extend the tip bone upward (Z) while narrowing its
    // cross-section (X depth + Y width) so it tapers to a point, plus raise and
    // flare it outward.  Negative gives a rounder, blunter tip.
    id: 'ear_point', group: 'Head', label: 'Ear Point',
    effects: [
      { bones: ['mFaceEar2Left', 'mFaceEar2Right'], scale: [-0.35, -0.35, 0.7] },
      { bones: ['mFaceEar2Left'], offset: [0, 0.004, 0.009] },
      { bones: ['mFaceEar2Right'], offset: [0, -0.004, 0.009] },
    ],
  },
  {
    id: 'nose_size', group: 'Head', label: 'Nose Size',
    effects: [{ bones: ['mFaceNoseLeft', 'mFaceNoseRight', 'mFaceNoseCenter', 'mFaceNoseBase', 'mFaceNoseBridge'], scale: [0.5, 0.5, 0.5] }],
  },
  {
    id: 'nose_width', group: 'Head', label: 'Nose Width',
    effects: [
      { bones: ['mFaceNoseLeft'], offset: [0, 0.006, 0] },
      { bones: ['mFaceNoseRight'], offset: [0, -0.006, 0] },
    ],
  },
  {
    // Bridge prominence: push the bridge forward (+X) for a higher/Roman nose,
    // pull it back (-X) for a flatter profile.
    id: 'nose_bridge', group: 'Head', label: 'Nose Bridge',
    effects: [{ bones: ['mFaceNoseBridge'], offset: [0.006, 0, 0] }],
  },
  {
    // Tip projection: how far the nose tip sticks out from the face (+X).
    id: 'nose_tip', group: 'Head', label: 'Nose Tip',
    effects: [{ bones: ['mFaceNoseCenter'], offset: [0.008, 0, 0] }],
  },
  {
    // Tip tilt: raise (+Z, upturned) or lower (-Z, drooping) the tip.
    id: 'nose_tilt', group: 'Head', label: 'Nose Tilt',
    effects: [{ bones: ['mFaceNoseCenter'], offset: [0, 0, 0.006] }],
  },
  {
    id: 'jaw_width', group: 'Head', label: 'Jaw Width',
    effects: [{ bones: ['mFaceJaw'], scale: [0, 0.35, 0] }],
  },
  {
    id: 'chin_depth', group: 'Head', label: 'Chin Depth',
    effects: [{ bones: ['mFaceChin'], offset: [0.012, 0, 0] }],
  },
  {
    id: 'cheek_fullness', group: 'Head', label: 'Cheek Fullness',
    effects: [{ bones: ['mFaceCheekLowerLeft', 'mFaceCheekLowerRight', 'mFaceCheekUpperLeft', 'mFaceCheekUpperRight'], scale: [0.5, 0.5, 0.5] }],
  },
  {
    // High cheekbones: push the upper cheeks forward (+X) and up (+Z) for a more
    // defined, sculpted look.
    id: 'cheekbones', group: 'Head', label: 'Cheekbones',
    effects: [{ bones: ['mFaceCheekUpperLeft', 'mFaceCheekUpperRight'], offset: [0.006, 0, 0.004] }],
  },
  {
    // Gaunt/hollow lower cheeks: positive shrinks them in for a sunken look,
    // negative fills them out (chubby).
    id: 'cheek_hollow', group: 'Head', label: 'Cheek Hollows',
    effects: [{ bones: ['mFaceCheekLowerLeft', 'mFaceCheekLowerRight'], scale: [-0.4, -0.4, -0.4] }],
  },
  {
    id: 'eye_size', group: 'Head', label: 'Eye Size',
    effects: [{ bones: ['mEyeLeft', 'mEyeRight'], scale: [0.3, 0.3, 0.3] }],
  },
  {
    id: 'eye_spacing', group: 'Head', label: 'Eye Spacing',
    effects: [
      { bones: ['mEyeLeft'], offset: [0, 0.005, 0] },
      { bones: ['mEyeRight'], offset: [0, -0.005, 0] },
    ],
  },
  {
    // Brow ridge projection: push the brows forward (+X) and down (-Z) for a
    // heavy, low "hunter" brow; negative recedes them for a smoother forehead.
    id: 'brow_ridge', group: 'Head', label: 'Brow Ridge',
    effects: [{
      bones: ['mFaceEyebrowInnerLeft', 'mFaceEyebrowCenterLeft', 'mFaceEyebrowOuterLeft',
              'mFaceEyebrowInnerRight', 'mFaceEyebrowCenterRight', 'mFaceEyebrowOuterRight'],
      offset: [0.007, 0, -0.003],
    }],
  },
  {
    // Raise/lower the whole brow line (Z).  Positive = higher brows.
    id: 'brow_height', group: 'Head', label: 'Brow Height',
    effects: [{
      bones: ['mFaceEyebrowInnerLeft', 'mFaceEyebrowCenterLeft', 'mFaceEyebrowOuterLeft',
              'mFaceEyebrowInnerRight', 'mFaceEyebrowCenterRight', 'mFaceEyebrowOuterRight'],
      offset: [0, 0, 0.006],
    }],
  },
  {
    // Brow angle: positive lifts the outer brow and drops the inner for an
    // arched/upswept look; negative gives a flat or sloping brow.
    id: 'brow_tilt', group: 'Head', label: 'Brow Angle',
    effects: [
      { bones: ['mFaceEyebrowInnerLeft', 'mFaceEyebrowInnerRight'], offset: [0, 0, -0.004] },
      { bones: ['mFaceEyebrowOuterLeft', 'mFaceEyebrowOuterRight'], offset: [0, 0, 0.004] },
    ],
  },
  {
    // Eye slant / canthal tilt: drop the inner eye corners (-Z) for an upward
    // almond slant; positive = upslant, negative = downturned.
    id: 'eye_slant', group: 'Head', label: 'Eye Slant',
    effects: [{ bones: ['mFaceEyecornerInnerLeft', 'mFaceEyecornerInnerRight'], offset: [0, 0, -0.004] }],
  },
  {
    // Palpebral aperture — resting eye openness, both eyes.  eye_closed shows
    // +Y rotation shuts the upper lid, so negative here narrows to a slit/squint
    // and positive widens the eyes (upper lid up, lower lid down).
    id: 'eye_opening', group: 'Head', label: 'Eye Opening',
    effects: [
      { bones: ['mFaceEyeLidUpperLeft', 'mFaceEyeLidUpperRight'], rot: [0, -0.4, 0] },
      { bones: ['mFaceEyeLidLowerLeft', 'mFaceEyeLidLowerRight'], rot: [0, 0.15, 0] },
    ],
  },
  {
    // Upper-lid fullness — approximates monolid vs double-lid.  A true
    // supratarsal crease needs a morph/normal map (bones can't carve a fold);
    // this puffs the upper lid forward (+X) and down (-Z) for a full, smooth
    // monolid look, or recedes it (negative) for a deeper-set, creased eye.
    id: 'lid_fullness', group: 'Head', label: 'Upper Lid Fullness',
    effects: [{ bones: ['mFaceEyeLidUpperLeft', 'mFaceEyeLidUpperRight'], offset: [0.003, 0, -0.002] }],
  },
  {
    id: 'eye_closed_l', group: 'Head', label: 'Left Eye Closed',
    effects: [
      { bones: ['mFaceEyeLidUpperLeft'], rot: [0, 0.55, 0] },
      { bones: ['mFaceEyeLidLowerLeft'], rot: [0, -0.15, 0] },
    ],
  },
  {
    id: 'eye_closed_r', group: 'Head', label: 'Right Eye Closed',
    effects: [
      { bones: ['mFaceEyeLidUpperRight'], rot: [0, 0.55, 0] },
      { bones: ['mFaceEyeLidLowerRight'], rot: [0, -0.15, 0] },
    ],
  },

  // ---- Mouth (jaw + tongue) ----
  {
    id: 'mouth_open', group: 'Mouth', label: 'Mouth Open',
    effects: [{ bones: ['mFaceJaw'], rot: [0, 0.45, 0] }],
  },
  {
    id: 'tongue_out', group: 'Mouth', label: 'Tongue Out',
    effects: [
      { bones: ['mFaceTongueBase'], offset: [0.02, 0, 0] },
      { bones: ['mFaceTongueTip'], offset: [0.015, 0, 0] },
    ],
  },

  // ---- Lips ----
  // A character-creator-style lip rig: overall size + position, independent
  // upper/lower fullness and protrusion, pucker, cupid's bow, smile, and corner
  // shaping. Each maps to a distinct DOF on the lip / corner bones.
  {
    id: 'lip_size', group: 'Lips', label: 'Lip Size (overall)',
    effects: [{ bones: MOUTH_ALL, scale: [0.45, 0.45, 0.45] }],
  },
  {
    id: 'mouth_width', group: 'Lips', label: 'Mouth Width',
    effects: [
      { bones: ['mFaceLipCornerLeft'], offset: [0, 0.008, 0] },
      { bones: ['mFaceLipCornerRight'], offset: [0, -0.008, 0] },
    ],
  },
  {
    // Slide the whole mouth up or down the face.
    id: 'mouth_raise', group: 'Lips', label: 'Mouth Up / Down',
    effects: [{ bones: MOUTH_ALL, offset: [0, 0, 0.006] }],
  },
  {
    // Slide the whole mouth forward or back (set into / off the face).
    id: 'mouth_depth', group: 'Lips', label: 'Mouth Forward / Back',
    effects: [{ bones: MOUTH_ALL, offset: [0.006, 0, 0] }],
  },
  {
    // Vertical fullness (height) of the TOP lip only.
    id: 'upper_lip_fullness', group: 'Lips', label: 'Upper Lip Fullness',
    effects: [{ bones: UPPER_LIP, scale: [0, 0, 0.6] }],
  },
  {
    // Vertical fullness (height) of the BOTTOM lip only — thin-top/full-bottom etc.
    id: 'lower_lip_fullness', group: 'Lips', label: 'Lower Lip Fullness',
    effects: [{ bones: LOWER_LIP, scale: [0, 0, 0.6] }],
  },
  {
    // Roll the top lip out (forward) or in.
    id: 'upper_lip_protrude', group: 'Lips', label: 'Upper Lip Protrusion',
    effects: [{ bones: UPPER_LIP, offset: [0.005, 0, 0] }],
  },
  {
    // Roll the bottom lip out (forward) or in.
    id: 'lower_lip_protrude', group: 'Lips', label: 'Lower Lip Protrusion',
    effects: [{ bones: LOWER_LIP, offset: [0.005, 0, 0] }],
  },
  {
    // Kiss/pucker: push both lips forward and draw the corners inward.
    id: 'lip_pucker', group: 'Lips', label: 'Lip Pucker',
    effects: [
      { bones: ALL_LIP, offset: [0.006, 0, 0] },
      { bones: ['mFaceLipCornerLeft'], offset: [0.004, -0.006, 0] },
      { bones: ['mFaceLipCornerRight'], offset: [0.004, 0.006, 0] },
    ],
  },
  {
    // Shape the upper-lip centre peak (height + protrusion) on its own.
    id: 'cupids_bow', group: 'Lips', label: "Cupid's Bow",
    effects: [{ bones: ['mFaceLipUpperCenter'], offset: [0.004, 0, 0.004] }],
  },
  {
    // Smile / frown: lift the corners UP and pull them OUT (not forward).
    id: 'smile', group: 'Lips', label: 'Smile / Frown',
    effects: [
      { bones: ['mFaceLipCornerLeft'], offset: [0, 0.004, 0.006] },
      { bones: ['mFaceLipCornerRight'], offset: [0, -0.004, 0.006] },
    ],
  },
  {
    // Push the corners forward/out or tuck them back into the cheeks (dimple).
    id: 'lip_corner_depth', group: 'Lips', label: 'Lip Corner Depth',
    effects: [{ bones: LIP_CORNERS, offset: [0.005, 0, 0] }],
  },

  // ---- Torso ----
  {
    id: 'torso_length', group: 'Torso', label: 'Torso Length',
    effects: [{ bones: ['mTorso'], scale: [0, 0, 0.25] }],
  },
  {
    // Shoulder width = distance between the shoulder joints. The clavicle
    // joints (mCollarLeft/Right) sit at local Y = ±0.072 under mChest, with the
    // shoulder joints (mShoulderLeft/Right) a further ±0.079 below them — so
    // offsetting the collar joints laterally (Y, opposite signs per side) moves
    // both shoulders apart/together. We offset the joints rather than scaling
    // mChest in Y because mChest's scale would propagate to its mNeck child
    // (and on through the grafted mHead) and widen the head too. The clavicle
    // collision volumes are scaled for shoulder/upper-chest bulk.
    id: 'shoulders', group: 'Torso', label: 'Shoulders',
    effects: [
      { bones: ['mCollarLeft'], offset: [0, 0.05, 0] },
      { bones: ['mCollarRight'], offset: [0, -0.05, 0] },
      { bones: ['L_CLAVICLE', 'R_CLAVICLE'], scale: [0.2, 0.25, 0.15] },
    ],
  },
  {
    id: 'breast_size', group: 'Torso', label: 'Breast Size',
    effects: [{ bones: ['LEFT_PEC', 'RIGHT_PEC'], scale: [0.55, 0.55, 0.55] }],
  },
  {
    // Spacing along the lateral axis (Y).  Pec locals share orientation, so the
    // two sides need opposite signs to move apart/together.  Positive = apart.
    id: 'breast_spacing', group: 'Torso', label: 'Breast Spacing',
    effects: [
      { bones: ['LEFT_PEC'], offset: [0, 0.025, 0] },
      { bones: ['RIGHT_PEC'], offset: [0, -0.025, 0] },
    ],
  },
  {
    // Lift: raise the pec volume (+Z is up for these bones) without resizing it.
    id: 'breast_lift', group: 'Torso', label: 'Breast Lift',
    effects: [{ bones: ['LEFT_PEC', 'RIGHT_PEC'], offset: [0, 0, 0.02] }],
  },
  {
    // Nipple protrusion — a vertex morph, not a bone (there is no nipple bone;
    // the breast is skinned to the PEC volumes). + extends the tip forward,
    // - pulls it in / flattens. See nipple.js.
    id: 'nipple', group: 'Torso', label: 'Nipple', special: 'nipple',
  },
  {
    // Mirrors SL's "Chest Male No Pecs" (param 685): translates pecs inward
    // toward the spine to flatten the chest.  Positive = flatter (masculine).
    id: 'pec_flatten', group: 'Torso', label: 'Chest Flatten',
    effects: [{ bones: ['LEFT_PEC', 'RIGHT_PEC'], scale: [-0.85, -0.85, -0.85], offset: [-0.05, 0, 0] }],
  },
  {
    id: 'belly_size', group: 'Torso', label: 'Belly Size',
    effects: [{ bones: ['BELLY'], scale: [0.55, 0.8, 0.45] }],
  },
  {
    // Forward-biased belly bulge: depth-dominant scale plus a +X (anterior)
    // offset so the volume grows forward instead of symmetrically into the spine.
    id: 'belly_distend', group: 'Torso', label: 'Belly Distension',
    effects: [{ bones: ['BELLY'], scale: [0.9, 0.25, 0.2], offset: [0.04, 0, 0] }],
  },
  {
    // Raise/lower the belly volume vertically (-Z is up, matching the pec bones)
    // without resizing it.  Positive = higher.
    id: 'belly_lift', group: 'Torso', label: 'Belly Lift',
    effects: [{ bones: ['BELLY'], offset: [0, 0, -0.03] }],
  },
  {
    // Cinch/widen the midsection on both cross-section axes (X depth + Y width),
    // leaving bone length (Z) alone.  Negative = cinched waist (hourglass).
    id: 'waist', group: 'Torso', label: 'Waist',
    effects: [{ bones: ['LOWER_BACK', 'BELLY'], scale: [0.3, 0.3, 0] }],
  },
  {
    id: 'torso_muscles', group: 'Torso', label: 'Torso Muscles',
    effects: [{ bones: ['UPPER_BACK', 'LOWER_BACK'], scale: [0.35, 0.35, 0.35] }],
  },
  {
    id: 'neck_length', group: 'Torso', label: 'Neck Length',
    effects: [{ bones: ['mNeck'], scale: [0, 0, 0.45] }],
  },
  {
    id: 'neck_thickness', group: 'Torso', label: 'Neck Thickness',
    // Target mNeck (the body's Ruth neck bone), not the head part's flat 'NECK'
    // bone. The body/upper-torso mesh is skinned to mNeck, and the head's NECK
    // is grafted under mNeck (Avatar.graftHeadParts), so scaling mNeck thickens
    // both sides of the neck seam together — matching neck_length below.
    effects: [{ bones: ['mNeck'], scale: [0.35, 0.35, 0] }]
  },

  // ---- Arms ----
  {
    id: 'arm_length', group: 'Arms', label: 'Arm Length',
    effects: [{ bones: ['mShoulderLeft', 'mShoulderRight', 'mElbowLeft', 'mElbowRight'], scale: [0.16, 0, 0] }],
  },
  {
    id: 'bicep_size', group: 'Arms', label: 'Bicep Size',
    effects: [{ bones: ['L_UPPER_ARM', 'R_UPPER_ARM'], scale: [0, 0.45, 0.45] }],
  },
  {
    id: 'forearm_size', group: 'Arms', label: 'Forearm Size',
    effects: [{ bones: ['L_LOWER_ARM', 'R_LOWER_ARM'], scale: [0, 0.45, 0.45] }],
  },
  {
    id: 'hand_size', group: 'Arms', label: 'Hand Size',
    effects: [{ bones: ['mWristLeft', 'mWristRight'], scale: [0.25, 0.25, 0.25] }],
  },
  {
    // Broaden + thicken the palm on its cross-section axes (Y/Z) without
    // lengthening (X = wrist→fingers).  Square, chunky palm = masculine hands.
    id: 'palm_width', group: 'Arms', label: 'Palm Width',
    effects: [{ bones: ['mWristLeft', 'mWristRight'], scale: [0, 0.4, 0.4] }],
  },

  // ---- Fingers (Bento — upstream rigs only expose Hand Size; finger posing is
  // normally done with Bento animations, but the bones are all here) ----
  {
    id: 'finger_length', group: 'Fingers', label: 'Finger Length',
    effects: [{ bones: [...fingerBones('Left', [...FINGERS, 'Thumb'], [1]), ...fingerBones('Right', [...FINGERS, 'Thumb'], [1])], scale: [0, 0.3, 0] }],
  },
  {
    id: 'finger_thickness', group: 'Fingers', label: 'Finger Thickness',
    effects: [{ bones: [...fingerBones('Left', [...FINGERS, 'Thumb'], [1]), ...fingerBones('Right', [...FINGERS, 'Thumb'], [1])], scale: [0.4, 0, 0.4] }],
  },
  {
    id: 'fist_l', group: 'Left Hand', label: 'Fist Curl',
    effects: [{ bones: fingerBones('Left'), rot: [-0.5, 0, 0] }],
  },
  {
    id: 'spread_l', group: 'Left Hand', label: 'Finger Spread',
    effects: [
      { bones: fingerBones('Left', ['Index'], [1]), rot: [0, 0, -0.18] },
      { bones: fingerBones('Left', ['Ring'], [1]), rot: [0, 0, 0.12] },
      { bones: fingerBones('Left', ['Pinky'], [1]), rot: [0, 0, 0.25] },
    ],
  },
  {
    id: 'thumb_l', group: 'Left Hand', label: 'Thumb Curl',
    effects: [{ bones: fingerBones('Left', ['Thumb']), rot: [0, 0, -0.35] }],
  },
  {
    id: 'fist_r', group: 'Right Hand', label: 'Fist Curl',
    effects: [{ bones: fingerBones('Right'), rot: [0.5, 0, 0] }],
  },
  {
    id: 'spread_r', group: 'Right Hand', label: 'Finger Spread',
    effects: [
      { bones: fingerBones('Right', ['Index'], [1]), rot: [0, 0, 0.18] },
      { bones: fingerBones('Right', ['Ring'], [1]), rot: [0, 0, -0.12] },
      { bones: fingerBones('Right', ['Pinky'], [1]), rot: [0, 0, -0.25] },
    ],
  },
  {
    id: 'thumb_r', group: 'Right Hand', label: 'Thumb Curl',
    effects: [{ bones: fingerBones('Right', ['Thumb']), rot: [0, 0, 0.35] }],
  },

  // ---- Legs ----
  {
    id: 'leg_length', group: 'Legs', label: 'Leg Length',
    effects: [
      { bones: ['mHipLeft', 'mHipRight'], scale: [0, 0, 0.16] },
      // Lift the pelvis so feet stay near the ground (upper+lower leg ~0.85 m).
      { bones: ['mPelvis'], offset: [0, 0, 0.85 * 0.16] },
    ],
  },
  {
    id: 'thigh_muscles', group: 'Legs', label: 'Thigh Muscles',
    effects: [{ bones: ['L_UPPER_LEG', 'R_UPPER_LEG'], scale: [0.45, 0.45, 0] }],
  },
  {
    id: 'calf_muscles', group: 'Legs', label: 'Calf Muscles',
    effects: [{ bones: ['L_LOWER_LEG', 'R_LOWER_LEG'], scale: [0.45, 0.45, 0] }],
  },
  {
    // Posterior-biased: depth-dominant scale plus a -X (back) offset so the
    // volume projects rearward instead of growing symmetrically into the pelvis.
    id: 'butt_size', group: 'Legs', label: 'Butt Size',
    effects: [{ bones: ['BUTT'], scale: [0.8, 0.45, 0.5], offset: [-0.03, 0, 0] }],
  },
  {
    // Lift/perk rather than enlarge: raise the volume (+Z) without scaling it.
    id: 'butt_lift', group: 'Legs', label: 'Butt Lift',
    effects: [{ bones: ['BUTT'], offset: [0, 0, 0.025] }],
  },
  {
    id: 'hip_width', group: 'Legs', label: 'Hip Width',
    effects: [
      { bones: ['PELVIS'], scale: [0.3, 0, 0] },
      { bones: ['mHipLeft'], offset: [0.018, 0, 0] },
      { bones: ['mHipRight'], offset: [-0.018, 0, 0] },
    ],
  },
  {
    id: 'foot_size', group: 'Legs', label: 'Foot Size',
    effects: [{ bones: ['mAnkleLeft', 'mAnkleRight'], scale: [0.3, 0.3, 0.3] }],
  },
];

// Turn a { sliderId: t } state object into per-bone adjustments:
// Map<boneName, { scale: [sx,sy,sz] multipliers, offset: [x,y,z] }>
export function computeBoneAdjustments(state) {
  const adj = new Map();
  const get = (bone) => {
    if (!adj.has(bone)) adj.set(bone, { scale: [1, 1, 1], offset: [0, 0, 0], rot: [0, 0, 0] });
    return adj.get(bone);
  };
  for (const slider of SLIDERS) {
    if (!slider.effects) continue;
    const t = state[slider.id] ?? 0;
    // No t === 0 skip: every slider-referenced bone always gets an entry so
    // returning a slider to zero restores the bone's rest transform.
    for (const fx of slider.effects) {
      for (const bone of fx.bones) {
        const a = get(bone);
        if (fx.scale) for (let i = 0; i < 3; i++) a.scale[i] *= 1 + fx.scale[i] * t;
        if (fx.offset) for (let i = 0; i < 3; i++) a.offset[i] += fx.offset[i] * t;
        if (fx.rot) for (let i = 0; i < 3; i++) a.rot[i] += fx.rot[i] * t;
      }
    }
  }
  return adj;
}

// ---- sex-based body presets -------------------------------------------------
// t values (slider range [-1, 1]) for body-group sliders.  Head and mouth
// sliders are left at zero (sex-neutral); the male preset broadens the hands
// (palm width + finger thickness) for a more masculine silhouette.
// Derived from the SL Ruth2 binding shape and canonical SL male param defaults.
export const SEX_PRESETS = {
  female: {
    height: 0,
    thickness: 0,
    shoulders: 0,
    breast_size: 0,
    pec_flatten: 0,
    nipple: -0.5,            // default woman: nipple pulled in (slider -50)
    belly_size: 0,
    torso_muscles: 0,
    neck_length: 0,
    neck_thickness: 0,
    arm_length: 0,
    bicep_size: 0,
    forearm_size: 0,
    hand_size: 0,
    palm_width: 0,
    finger_thickness: 0,
    leg_length: 0,
    thigh_muscles: 0,
    calf_muscles: 0,
    butt_size: 0,
    hip_width: 0,
    foot_size: 0,
  },
  male: {
    height: 0,
    thickness: 0.3,         // broader torso
    shoulders: 0.5,          // wider shoulders
    breast_size: -1,         // shrink pecs fully (→ 45%)
    pec_flatten: 1,          // push pecs inward + shrink further (→ ~7% total)
    nipple: 0,               // neutral nipple protrusion
    belly_size: 0.1,         // slightly more belly
    torso_muscles: 0.8,      // broader back (V-taper)
    neck_length: 0,
    neck_thickness: 0.5,     // thicker neck
    arm_length: 0,
    bicep_size: 0.5,         // thicker upper arms
    forearm_size: 0.5,       // thicker forearms
    hand_size: 0.3,          // slightly larger hands
    palm_width: 0.5,         // broad, square palms
    finger_thickness: 0.4,   // thicker fingers
    leg_length: 0,
    thigh_muscles: 0.4,      // thicker thighs
    calf_muscles: 0.4,       // thicker calves
    butt_size: -0.3,         // less pronounced butt
    hip_width: -0.5,         // narrower hips
    foot_size: 0.1,          // slightly larger feet
  },
};
