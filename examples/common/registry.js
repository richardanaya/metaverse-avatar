// Shared animation manifest (BVH + glTF/GLB) for the demos in this repo.
//
// The clip files themselves (anims/*.glb, anims/*.bvh) live at the repo root and
// ARE bundled in the published npm package, so a consumer can load them by path.
// This manifest is example glue, not a library export — copy it (or build your
// own catalog) if you want it in your app. The file/glbFile paths below are
// relative to the repo root; each example prepends its own path-to-root.
//
// Consumed by:
//   - the Studio's Animate-tab clip dropdown (examples/studio/main.js) at startup
//   - the MCP example's list_animations / trigger_animation tools (examples/mcp/server.js)
//
// Each entry:
//   id         — stable identifier used by MCP trigger_animation
//   label      — human-readable name shown in the dropdown
//   source     — "bvh" (BVH file via loadBVH/retargetToRuth) or
//                "glb" (glTF animation inside a GLB via GLTFLoader)
//   file       — [bvh]   path to .bvh file (relative to the repo root)
//   glbFile    — [glb]   path to .glb file (relative to the repo root)
//   glbAnimName— [glb]   name of the glTF animation inside the GLB

export const ANIMATION_REGISTRY = [
  // ---- BVH clips (1) --------------------------------------------------
  { id: 'pirouette', label: 'Pirouette', source: 'bvh', file: 'anims/pirouette.bvh' },

  // ---- UAL1 glTF animations (45) --------------------------------------
  // glbFile is loaded once and cached; glbAnimName selects the clip inside.
  { id: 'glb:tpose',                  label: 'UL T-Pose',                 source: 'glb', glbFile: 'anims/UAL1_Standard.glb', glbAnimName: 'A_TPose' },
  { id: 'glb:crouch-fwd',             label: 'UL Crouch Forward',        source: 'glb', glbFile: 'anims/UAL1_Standard.glb', glbAnimName: 'Crouch_Fwd_Loop' },
  { id: 'glb:crouch-idle',            label: 'UL Crouch Idle',           source: 'glb', glbFile: 'anims/UAL1_Standard.glb', glbAnimName: 'Crouch_Idle_Loop' },
  { id: 'glb:dance',                  label: 'UL Dance',                 source: 'glb', glbFile: 'anims/UAL1_Standard.glb', glbAnimName: 'Dance_Loop' },
  { id: 'glb:death',                  label: 'UL Death',                 source: 'glb', glbFile: 'anims/UAL1_Standard.glb', glbAnimName: 'Death01' },
  { id: 'glb:driving',                label: 'UL Driving',               source: 'glb', glbFile: 'anims/UAL1_Standard.glb', glbAnimName: 'Driving_Loop' },
  { id: 'glb:fixing-kneeling',        label: 'UL Fixing Kneeling',       source: 'glb', glbFile: 'anims/UAL1_Standard.glb', glbAnimName: 'Fixing_Kneeling' },
  { id: 'glb:hit-chest',              label: 'UL Hit Chest',             source: 'glb', glbFile: 'anims/UAL1_Standard.glb', glbAnimName: 'Hit_Chest' },
  { id: 'glb:hit-head',               label: 'UL Hit Head',              source: 'glb', glbFile: 'anims/UAL1_Standard.glb', glbAnimName: 'Hit_Head' },
  { id: 'glb:idle',                   label: 'UL Idle',                  source: 'glb', glbFile: 'anims/UAL1_Standard.glb', glbAnimName: 'Idle_Loop' },
  { id: 'glb:idle-talking',           label: 'UL Idle Talking',          source: 'glb', glbFile: 'anims/UAL1_Standard.glb', glbAnimName: 'Idle_Talking_Loop' },
  { id: 'glb:idle-torch',             label: 'UL Idle Torch',            source: 'glb', glbFile: 'anims/UAL1_Standard.glb', glbAnimName: 'Idle_Torch_Loop' },
  { id: 'glb:interact',               label: 'UL Interact',              source: 'glb', glbFile: 'anims/UAL1_Standard.glb', glbAnimName: 'Interact' },
  { id: 'glb:jog',                    label: 'UL Jog',                   source: 'glb', glbFile: 'anims/UAL1_Standard.glb', glbAnimName: 'Jog_Fwd_Loop' },
  { id: 'glb:jump-land',              label: 'UL Jump Land',             source: 'glb', glbFile: 'anims/UAL1_Standard.glb', glbAnimName: 'Jump_Land' },
  { id: 'glb:jump-loop',              label: 'UL Jump Loop',             source: 'glb', glbFile: 'anims/UAL1_Standard.glb', glbAnimName: 'Jump_Loop' },
  { id: 'glb:jump-start',             label: 'UL Jump Start',            source: 'glb', glbFile: 'anims/UAL1_Standard.glb', glbAnimName: 'Jump_Start' },
  { id: 'glb:pickup-table',           label: 'UL Pick Up Table',         source: 'glb', glbFile: 'anims/UAL1_Standard.glb', glbAnimName: 'PickUp_Table' },
  { id: 'glb:pistol-aim-down',        label: 'UL Pistol Aim Down',       source: 'glb', glbFile: 'anims/UAL1_Standard.glb', glbAnimName: 'Pistol_Aim_Down' },
  { id: 'glb:pistol-aim-neutral',     label: 'UL Pistol Aim Neutral',    source: 'glb', glbFile: 'anims/UAL1_Standard.glb', glbAnimName: 'Pistol_Aim_Neutral' },
  { id: 'glb:pistol-aim-up',          label: 'UL Pistol Aim Up',         source: 'glb', glbFile: 'anims/UAL1_Standard.glb', glbAnimName: 'Pistol_Aim_Up' },
  { id: 'glb:pistol-idle',            label: 'UL Pistol Idle',           source: 'glb', glbFile: 'anims/UAL1_Standard.glb', glbAnimName: 'Pistol_Idle_Loop' },
  { id: 'glb:pistol-reload',          label: 'UL Pistol Reload',         source: 'glb', glbFile: 'anims/UAL1_Standard.glb', glbAnimName: 'Pistol_Reload' },
  { id: 'glb:pistol-shoot',           label: 'UL Pistol Shoot',          source: 'glb', glbFile: 'anims/UAL1_Standard.glb', glbAnimName: 'Pistol_Shoot' },
  { id: 'glb:punch-cross',            label: 'UL Punch Cross',           source: 'glb', glbFile: 'anims/UAL1_Standard.glb', glbAnimName: 'Punch_Cross' },
  { id: 'glb:punch-jab',              label: 'UL Punch Jab',             source: 'glb', glbFile: 'anims/UAL1_Standard.glb', glbAnimName: 'Punch_Jab' },
  { id: 'glb:push-loop',              label: 'UL Push Loop',             source: 'glb', glbFile: 'anims/UAL1_Standard.glb', glbAnimName: 'Push_Loop' },
  { id: 'glb:roll',                   label: 'UL Roll',                  source: 'glb', glbFile: 'anims/UAL1_Standard.glb', glbAnimName: 'Roll' },
  { id: 'glb:roll-rm',                label: 'UL Roll RM',               source: 'glb', glbFile: 'anims/UAL1_Standard.glb', glbAnimName: 'Roll_RM' },
  { id: 'glb:sitting-enter',          label: 'UL Sitting Enter',         source: 'glb', glbFile: 'anims/UAL1_Standard.glb', glbAnimName: 'Sitting_Enter' },
  { id: 'glb:sitting-exit',           label: 'UL Sitting Exit',          source: 'glb', glbFile: 'anims/UAL1_Standard.glb', glbAnimName: 'Sitting_Exit' },
  { id: 'glb:sitting-idle',           label: 'UL Sitting Idle',          source: 'glb', glbFile: 'anims/UAL1_Standard.glb', glbAnimName: 'Sitting_Idle_Loop' },
  { id: 'glb:sitting-talking',        label: 'UL Sitting Talking',       source: 'glb', glbFile: 'anims/UAL1_Standard.glb', glbAnimName: 'Sitting_Talking_Loop' },
  { id: 'glb:spell-simple-enter',     label: 'UL Spell Simple Enter',    source: 'glb', glbFile: 'anims/UAL1_Standard.glb', glbAnimName: 'Spell_Simple_Enter' },
  { id: 'glb:spell-simple-exit',      label: 'UL Spell Simple Exit',     source: 'glb', glbFile: 'anims/UAL1_Standard.glb', glbAnimName: 'Spell_Simple_Exit' },
  { id: 'glb:spell-simple-idle',      label: 'UL Spell Simple Idle',     source: 'glb', glbFile: 'anims/UAL1_Standard.glb', glbAnimName: 'Spell_Simple_Idle_Loop' },
  { id: 'glb:spell-simple-shoot',     label: 'UL Spell Simple Shoot',    source: 'glb', glbFile: 'anims/UAL1_Standard.glb', glbAnimName: 'Spell_Simple_Shoot' },
  { id: 'glb:sprint',                 label: 'UL Sprint',                source: 'glb', glbFile: 'anims/UAL1_Standard.glb', glbAnimName: 'Sprint_Loop' },
  { id: 'glb:swim-fwd',               label: 'UL Swim Forward',          source: 'glb', glbFile: 'anims/UAL1_Standard.glb', glbAnimName: 'Swim_Fwd_Loop' },
  { id: 'glb:swim-idle',              label: 'UL Swim Idle',             source: 'glb', glbFile: 'anims/UAL1_Standard.glb', glbAnimName: 'Swim_Idle_Loop' },
  { id: 'glb:sword-attack',           label: 'UL Sword Attack',          source: 'glb', glbFile: 'anims/UAL1_Standard.glb', glbAnimName: 'Sword_Attack' },
  { id: 'glb:sword-attack-rm',        label: 'UL Sword Attack RM',       source: 'glb', glbFile: 'anims/UAL1_Standard.glb', glbAnimName: 'Sword_Attack_RM' },
  { id: 'glb:sword-idle',             label: 'UL Sword Idle',            source: 'glb', glbFile: 'anims/UAL1_Standard.glb', glbAnimName: 'Sword_Idle' },
  { id: 'glb:walk-formal',            label: 'UL Walk Formal',           source: 'glb', glbFile: 'anims/UAL1_Standard.glb', glbAnimName: 'Walk_Formal_Loop' },
  { id: 'glb:walk-loop',              label: 'UL Walk Loop',             source: 'glb', glbFile: 'anims/UAL1_Standard.glb', glbAnimName: 'Walk_Loop' },

  // ---- UAL2 glTF animations (43) --------------------------------------
  // Identical 67-bone skeleton to UAL1; separate GLB, loaded/cached on demand.
  { id: 'glb2:tpose',                  label: 'U2 T-Pose',                  source: 'glb', glbFile: 'anims/UAL2_Standard.glb', glbAnimName: 'A_TPose' },
  { id: 'glb2:chest-open',             label: 'U2 Chest Open',              source: 'glb', glbFile: 'anims/UAL2_Standard.glb', glbAnimName: 'Chest_Open' },
  { id: 'glb2:climb-up-1m-rm',         label: 'U2 Climb Up 1m RM',          source: 'glb', glbFile: 'anims/UAL2_Standard.glb', glbAnimName: 'ClimbUp_1m_RM' },
  { id: 'glb2:consume',                label: 'U2 Consume',                 source: 'glb', glbFile: 'anims/UAL2_Standard.glb', glbAnimName: 'Consume' },
  { id: 'glb2:farm-harvest',           label: 'U2 Farm Harvest',            source: 'glb', glbFile: 'anims/UAL2_Standard.glb', glbAnimName: 'Farm_Harvest' },
  { id: 'glb2:farm-plant-seed',        label: 'U2 Farm Plant Seed',         source: 'glb', glbFile: 'anims/UAL2_Standard.glb', glbAnimName: 'Farm_PlantSeed' },
  { id: 'glb2:farm-watering',          label: 'U2 Farm Watering',           source: 'glb', glbFile: 'anims/UAL2_Standard.glb', glbAnimName: 'Farm_Watering' },
  { id: 'glb2:hit-knockback',          label: 'U2 Hit Knockback',           source: 'glb', glbFile: 'anims/UAL2_Standard.glb', glbAnimName: 'Hit_Knockback' },
  { id: 'glb2:hit-knockback-rm',       label: 'U2 Hit Knockback RM',        source: 'glb', glbFile: 'anims/UAL2_Standard.glb', glbAnimName: 'Hit_Knockback_RM' },
  { id: 'glb2:idle-fold-arms-loop',    label: 'U2 Idle Fold Arms Loop',     source: 'glb', glbFile: 'anims/UAL2_Standard.glb', glbAnimName: 'Idle_FoldArms_Loop' },
  { id: 'glb2:idle-lantern-loop',      label: 'U2 Idle Lantern Loop',       source: 'glb', glbFile: 'anims/UAL2_Standard.glb', glbAnimName: 'Idle_Lantern_Loop' },
  { id: 'glb2:idle-no-loop',           label: 'U2 Idle No Loop',            source: 'glb', glbFile: 'anims/UAL2_Standard.glb', glbAnimName: 'Idle_No_Loop' },
  { id: 'glb2:idle-rail-call',         label: 'U2 Idle Rail Call',          source: 'glb', glbFile: 'anims/UAL2_Standard.glb', glbAnimName: 'Idle_Rail_Call' },
  { id: 'glb2:idle-rail-loop',         label: 'U2 Idle Rail Loop',          source: 'glb', glbFile: 'anims/UAL2_Standard.glb', glbAnimName: 'Idle_Rail_Loop' },
  { id: 'glb2:idle-shield-break',      label: 'U2 Idle Shield Break',       source: 'glb', glbFile: 'anims/UAL2_Standard.glb', glbAnimName: 'Idle_Shield_Break' },
  { id: 'glb2:idle-shield-loop',       label: 'U2 Idle Shield Loop',        source: 'glb', glbFile: 'anims/UAL2_Standard.glb', glbAnimName: 'Idle_Shield_Loop' },
  { id: 'glb2:idle-talking-phone-loop',label: 'U2 Idle Talking Phone Loop', source: 'glb', glbFile: 'anims/UAL2_Standard.glb', glbAnimName: 'Idle_TalkingPhone_Loop' },
  { id: 'glb2:lay-to-idle',            label: 'U2 Lay To Idle',             source: 'glb', glbFile: 'anims/UAL2_Standard.glb', glbAnimName: 'LayToIdle' },
  { id: 'glb2:melee-hook',             label: 'U2 Melee Hook',              source: 'glb', glbFile: 'anims/UAL2_Standard.glb', glbAnimName: 'Melee_Hook' },
  { id: 'glb2:melee-hook-rec',         label: 'U2 Melee Hook Rec',          source: 'glb', glbFile: 'anims/UAL2_Standard.glb', glbAnimName: 'Melee_Hook_Rec' },
  { id: 'glb2:ninja-jump-idle-loop',   label: 'U2 Ninja Jump Idle Loop',    source: 'glb', glbFile: 'anims/UAL2_Standard.glb', glbAnimName: 'NinjaJump_Idle_Loop' },
  { id: 'glb2:ninja-jump-land',        label: 'U2 Ninja Jump Land',         source: 'glb', glbFile: 'anims/UAL2_Standard.glb', glbAnimName: 'NinjaJump_Land' },
  { id: 'glb2:ninja-jump-start',       label: 'U2 Ninja Jump Start',        source: 'glb', glbFile: 'anims/UAL2_Standard.glb', glbAnimName: 'NinjaJump_Start' },
  { id: 'glb2:overhand-throw',         label: 'U2 Overhand Throw',          source: 'glb', glbFile: 'anims/UAL2_Standard.glb', glbAnimName: 'OverhandThrow' },
  { id: 'glb2:shield-dash-rm',         label: 'U2 Shield Dash RM',          source: 'glb', glbFile: 'anims/UAL2_Standard.glb', glbAnimName: 'Shield_Dash_RM' },
  { id: 'glb2:shield-one-shot',        label: 'U2 Shield One Shot',         source: 'glb', glbFile: 'anims/UAL2_Standard.glb', glbAnimName: 'Shield_OneShot' },
  { id: 'glb2:slide-exit',             label: 'U2 Slide Exit',              source: 'glb', glbFile: 'anims/UAL2_Standard.glb', glbAnimName: 'Slide_Exit' },
  { id: 'glb2:slide-loop',             label: 'U2 Slide Loop',              source: 'glb', glbFile: 'anims/UAL2_Standard.glb', glbAnimName: 'Slide_Loop' },
  { id: 'glb2:slide-start',            label: 'U2 Slide Start',             source: 'glb', glbFile: 'anims/UAL2_Standard.glb', glbAnimName: 'Slide_Start' },
  { id: 'glb2:sword-block',            label: 'U2 Sword Block',             source: 'glb', glbFile: 'anims/UAL2_Standard.glb', glbAnimName: 'Sword_Block' },
  { id: 'glb2:sword-dash-rm',          label: 'U2 Sword Dash RM',           source: 'glb', glbFile: 'anims/UAL2_Standard.glb', glbAnimName: 'Sword_Dash_RM' },
  { id: 'glb2:sword-regular-a',        label: 'U2 Sword Regular A',         source: 'glb', glbFile: 'anims/UAL2_Standard.glb', glbAnimName: 'Sword_Regular_A' },
  { id: 'glb2:sword-regular-a-rec',    label: 'U2 Sword Regular A Rec',     source: 'glb', glbFile: 'anims/UAL2_Standard.glb', glbAnimName: 'Sword_Regular_A_Rec' },
  { id: 'glb2:sword-regular-b',        label: 'U2 Sword Regular B',         source: 'glb', glbFile: 'anims/UAL2_Standard.glb', glbAnimName: 'Sword_Regular_B' },
  { id: 'glb2:sword-regular-b-rec',    label: 'U2 Sword Regular B Rec',     source: 'glb', glbFile: 'anims/UAL2_Standard.glb', glbAnimName: 'Sword_Regular_B_Rec' },
  { id: 'glb2:sword-regular-c',        label: 'U2 Sword Regular C',         source: 'glb', glbFile: 'anims/UAL2_Standard.glb', glbAnimName: 'Sword_Regular_C' },
  { id: 'glb2:sword-regular-combo',    label: 'U2 Sword Regular Combo',     source: 'glb', glbFile: 'anims/UAL2_Standard.glb', glbAnimName: 'Sword_Regular_Combo' },
  { id: 'glb2:tree-chopping-loop',     label: 'U2 Tree Chopping Loop',      source: 'glb', glbFile: 'anims/UAL2_Standard.glb', glbAnimName: 'TreeChopping_Loop' },
  { id: 'glb2:walk-carry-loop',        label: 'U2 Walk Carry Loop',         source: 'glb', glbFile: 'anims/UAL2_Standard.glb', glbAnimName: 'Walk_Carry_Loop' },
  { id: 'glb2:yes',                    label: 'U2 Yes (nod)',               source: 'glb', glbFile: 'anims/UAL2_Standard.glb', glbAnimName: 'Yes' },
  { id: 'glb2:zombie-idle-loop',       label: 'U2 Zombie Idle Loop',        source: 'glb', glbFile: 'anims/UAL2_Standard.glb', glbAnimName: 'Zombie_Idle_Loop' },
  { id: 'glb2:zombie-scratch',         label: 'U2 Zombie Scratch',          source: 'glb', glbFile: 'anims/UAL2_Standard.glb', glbAnimName: 'Zombie_Scratch' },
  { id: 'glb2:zombie-walk-fwd-loop',   label: 'U2 Zombie Walk Fwd Loop',    source: 'glb', glbFile: 'anims/UAL2_Standard.glb', glbAnimName: 'Zombie_Walk_Fwd_Loop' },
];

export function findAnimation(id) {
  return ANIMATION_REGISTRY.find((a) => a.id === id) ?? null;
}
