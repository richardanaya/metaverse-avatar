import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
// Avatar library (two levels up). The Studio is just an app built on top of it.
import { Avatar } from '../../Avatar.js';
import { AvatarManager } from '../../avatarManager.js';
import { loadBVH, parseBVH, retargetToRuth } from '../../bvh.js';
import { SLIDERS, SEX_PRESETS } from '../../sliders.js';
import { PBR_CHANNELS } from '../../pbr.js';
import { ANIMATION_REGISTRY } from '../common/registry.js';
import { initGltfAnim, getGltfClip } from '../../gltfAnim.js';
import { ATTACHMENT_POINTS, BUILTIN_PRESETS } from '../../attachments.js';
// Studio-local app modules.
import { AnimEditor } from './animEditor.js';
import { PlayMode } from './play.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

// Repo root, relative to this page (/examples/studio/) — models/ + anims/ live
// there. The registry's file/glbFile paths (e.g. 'anims/UAL1_Standard.glb') are
// resolved against this base.
const ASSETS = '../../';

const status = document.getElementById('status');

// ---- renderer / scene ------------------------------------------------

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1d24);
const fog = new THREE.Fog(0x1a1d24, 8, 30);
scene.fog = fog;

// A neutral studio environment so PBR metalness/roughness have something to
// reflect (metals are near-black without an env map).
const pmrem = new THREE.PMREMGenerator(renderer);
const studioEnv = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environment = studioEnv;
scene.environmentIntensity = 1.0;

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.05, 100);
camera.position.set(1.6, 1.5, 2.6);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.9, 0);
controls.enableDamping = true;

const hemiLight = new THREE.HemisphereLight(0xc8d4ff, 0x3a3530, 1.2);
scene.add(hemiLight);
const sun = new THREE.DirectionalLight(0xfff2e0, 2.2);
sun.position.set(3, 5, 2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0002;
sun.shadow.normalBias = 0.02;
sun.shadow.camera.left = sun.shadow.camera.bottom = -2.5;
sun.shadow.camera.right = sun.shadow.camera.top = 2.5;
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(6, 48),
  new THREE.MeshStandardMaterial({ color: 0x23262f, roughness: 0.95 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.GridHelper(12, 24, 0x3a3f4e, 0x2a2e3a);
scene.add(grid);

// ---- avatar ----------------------------------------------------------

// Multiple avatars live in one scene; `avatar` always points at the ACTIVE one
// (the one the panel + editor/play tools drive). It and the per-avatar driver
// aliases below (voice/speech/blinker/attachments) are reassigned by
// selectAvatar() when the active avatar changes.
const manager = new AvatarManager({
  scene,
  basePath: ASSETS + 'models/',
  // UI-only state not stored on the avatar itself.
  makeUiState: () => ({ sliders: {}, sex: null, layers: [''] }),
});
let avatar;        // active avatar
let activeEntry;   // its manager entry (carries ui state)

try {
  const first = new Avatar();
  await first.load(ASSETS + 'models/');
  // Ruth avatars face +X; turn her toward the default camera (+Z).
  first.group.rotation.y = -Math.PI / 2;
  manager.adopt(first); // adds group + skeleton helpers to the scene
  avatar = manager.active;
  activeEntry = manager.activeEntry;
  status.textContent = '';
} catch (err) {
  status.textContent = 'failed to load model: ' + err.message;
  throw err;
}

// ---- UI: parts -------------------------------------------------------

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    if (!file?.type?.startsWith('image/')) {
      reject(new Error('Drop an image file (PNG, JPG, etc.)'));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image: ' + file.name));
    };
    img.src = url;
  });
}

const previewCanvas = document.createElement('canvas');
previewCanvas.width = previewCanvas.height = 128;

function previewDataUrl(img) {
  const ctx = previewCanvas.getContext('2d');
  ctx.fillStyle = '#1a1d26';
  ctx.fillRect(0, 0, 128, 128);
  ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, 0, 0, 128, 128);
  return previewCanvas.toDataURL('image/png');
}

// A compact PBR map slot: drag/drop or click to set, ✕ to clear. Reads its
// current image from `get()` so it stays correct across layer rebuilds.
const REGION_LABELS = { face: 'Face', upper: 'Upper body', lower: 'Lower body', eyes: 'Eyes' };

function makePbrSlot(channel, get, set) {
  const slot = document.createElement('div');
  slot.className = 'pbr-slot';
  slot.title = channel.label;
  const img = document.createElement('img');
  img.className = 'pbr-slot-img';
  img.alt = '';
  const tag = document.createElement('span');
  tag.className = 'pbr-slot-tag';
  tag.textContent = channel.short;
  const clear = document.createElement('button');
  clear.className = 'pbr-slot-clear';
  clear.type = 'button';
  clear.textContent = '×';
  clear.title = `Clear ${channel.label}`;
  slot.append(img, tag, clear);

  const refresh = () => {
    const cur = get();
    if (cur) {
      img.src = previewDataUrl(cur);
      slot.classList.add('filled');
    } else {
      img.removeAttribute('src');
      slot.classList.remove('filled');
    }
  };
  const apply = async (file) => {
    if (!file) return;
    try {
      set(await loadImageFromFile(file));
      refresh();
      status.textContent = `${channel.label}: ${file.name}`;
    } catch (err) {
      status.textContent = err.message;
    }
  };
  const prevent = (e) => { e.preventDefault(); e.stopPropagation(); };
  slot.addEventListener('dragenter', prevent);
  slot.addEventListener('dragover', (e) => { prevent(e); slot.classList.add('drag-over'); });
  slot.addEventListener('dragleave', () => slot.classList.remove('drag-over'));
  slot.addEventListener('drop', (e) => { prevent(e); slot.classList.remove('drag-over'); apply(e.dataTransfer.files[0]); });
  slot.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.addEventListener('change', () => { apply(input.files[0]); input.remove(); });
    input.click();
  });
  clear.addEventListener('click', (e) => {
    e.stopPropagation();
    set(null);
    refresh();
  });
  refresh();
  return slot;
}

function makeSlotRow(makeSlot) {
  const row = document.createElement('div');
  row.className = 'pbr-slots';
  for (const ch of PBR_CHANNELS) row.appendChild(makeSlot(ch));
  return row;
}

// ---- skin region cards (one per region, five maps each) ----
const skinRegionsEl = document.getElementById('skin-regions');
// Re-rendered on avatar switch so the slot previews reflect the active avatar's
// maps. The slot get/set closures read the live `avatar` binding.
function renderSkinRegions() {
  skinRegionsEl.innerHTML = '';
  for (const region of avatar.getRegions()) {
    const card = document.createElement('div');
    card.className = 'mat-card';
    const head = document.createElement('div');
    head.className = 'mat-card-head';
    const name = document.createElement('span');
    name.textContent = REGION_LABELS[region] ?? region;
    head.appendChild(name);
    card.appendChild(head);
    card.appendChild(makeSlotRow((ch) =>
      makePbrSlot(ch, () => avatar.getSkinMap(region, ch.key), (img) => avatar.setSkinMap(region, ch.key, img))
    ));
    skinRegionsEl.appendChild(card);
  }
}
renderSkinRegions();

// ---- global roughness / metalness (used where a region has no such map) ----
const pbrGlobalsEl = document.getElementById('pbr-globals');
function makeGlobalSlider(label, initial, onChange) {
  const row = document.createElement('div');
  row.className = 'row';
  const lab = document.createElement('label');
  lab.textContent = label;
  const input = document.createElement('input');
  input.type = 'range';
  input.min = 0;
  input.max = 100;
  input.value = initial;
  const val = document.createElement('span');
  val.className = 'val';
  val.textContent = initial;
  input.addEventListener('input', () => {
    val.textContent = input.value;
    paintRange(input);
    onChange(input.value / 100);
  });
  row.append(lab, input, val);
  pbrGlobalsEl.appendChild(row);
}
makeGlobalSlider('Roughness', 55, (v) => avatar.setGlobalRoughness(v));
makeGlobalSlider('Metalness', 0, (v) => avatar.setGlobalMetalness(v));

// ---- stacked clothing layers (upper / lower) ----
function renderClothing(region, container) {
  container.innerHTML = '';
  const layers = avatar.getClothingLayers(region);
  layers.forEach((layer, i) => {
    const card = document.createElement('div');
    card.className = 'mat-card layer-card';

    const head = document.createElement('div');
    head.className = 'mat-card-head';
    const vis = document.createElement('input');
    vis.type = 'checkbox';
    vis.checked = layer.visible;
    vis.title = 'Toggle layer visibility';
    vis.addEventListener('change', () => avatar.setLayerVisible(region, i, vis.checked));
    const name = document.createElement('span');
    name.className = 'layer-name';
    name.textContent = `${REGION_LABELS[region]} · ${i + 1}`;
    const actions = document.createElement('div');
    actions.className = 'layer-actions';
    const mkBtn = (txt, title, fn, disabled) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = txt;
      b.title = title;
      b.disabled = !!disabled;
      b.addEventListener('click', fn);
      return b;
    };
    actions.append(
      mkBtn('↑', 'Move up', () => { avatar.moveClothingLayer(region, i, -1); renderClothing(region, container); }, i === 0),
      mkBtn('↓', 'Move down', () => { avatar.moveClothingLayer(region, i, 1); renderClothing(region, container); }, i === layers.length - 1),
      mkBtn('✕', 'Remove layer', () => { avatar.removeClothingLayer(region, i); renderClothing(region, container); })
    );
    head.append(vis, name, actions);
    card.appendChild(head);
    card.appendChild(makeSlotRow((ch) =>
      makePbrSlot(ch, () => avatar.getLayerMap(region, i, ch.key), (img) => avatar.setLayerMap(region, i, ch.key, img))
    ));
    container.appendChild(card);
  });

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'add-layer-btn';
  add.textContent = `+ Add ${REGION_LABELS[region].toLowerCase()} layer`;
  add.addEventListener('click', () => {
    avatar.addClothingLayer(region);
    renderClothing(region, container);
  });
  container.appendChild(add);
}
renderClothing('upper', document.getElementById('clothing-upper'));
renderClothing('lower', document.getElementById('clothing-lower'));

const partsEl = document.getElementById('parts');
for (const name of Object.keys(avatar.parts)) {
  const row = document.createElement('div');
  row.className = 'row';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = true;
  cb.id = `part-${name}`;
  cb.addEventListener('change', () => avatar.setPartVisible(name, cb.checked));
  const label = document.createElement('label');
  label.htmlFor = cb.id;
  label.textContent = name;
  row.append(cb, label);
  partsEl.appendChild(row);
}
{
  const row = document.createElement('div');
  row.className = 'row';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = true;
  cb.id = 'opt-textured';
  cb.addEventListener('change', () => avatar.setTextured(cb.checked));
  const label = document.createElement('label');
  label.htmlFor = cb.id;
  label.textContent = 'skin texture';
  row.append(cb, label);
  partsEl.appendChild(row);
}

// ---- UI: shape sliders -----------------------------------------------

// Slider positions are per-avatar UI state — `sliderState` is repointed at the
// active avatar's bag on switch, so handlers writing into it persist per avatar.
let sliderState = activeEntry.ui.sliders;
const slidersEl = document.getElementById('sliders');
const groups = new Map();

// ---- sex toggle ---------------------------------------------------------
let currentSex = activeEntry.ui.sex; // 'female' | 'male' | null (custom)

function applyPreset(sex) {
  const preset = SEX_PRESETS[sex];
  if (!preset) return;
  for (const [id, t] of Object.entries(preset)) {
    const def = SLIDERS.find((d) => d.id === id);
    if (!def || !def._input) continue;
    sliderState[id] = t;
    def._input.value = Math.round(t * 100);
    def._val.textContent = Math.round(t * 100);
    paintRange(def._input);
  }
  currentSex = sex;
  avatar.applyShape(sliderState);
  updateSexButtons();
}

function updateSexButtons() {
  for (const btn of sexButtons) {
    btn.classList.toggle('active', btn.dataset.sex === currentSex);
  }
}

const sexButtons = [];
{
  const sexRow = document.createElement('div');
  sexRow.className = 'btnrow';
  sexRow.style.cssText = 'margin-bottom:8px; gap:6px';
  for (const [sex, label] of [['female', '\u2640 Female'], ['male', '\u2642 Male']]) {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.dataset.sex = sex;
    btn.style.cssText = 'flex:1; padding:6px 12px; font-size:13px';
    btn.addEventListener('click', () => applyPreset(sex));
    sexRow.appendChild(btn);
    sexButtons.push(btn);
  }
  slidersEl.parentNode.insertBefore(sexRow, slidersEl);
}

// Wire the reset button to also clear the sex selection.
document.getElementById('btn-reset-shape').addEventListener('click', () => {
  for (const def of SLIDERS) {
    sliderState[def.id] = 0;
    def._input.value = 0;
    def._val.textContent = '0';
    paintRange(def._input);
  }
  currentSex = null;
  updateSexButtons();
  avatar.applyShape(sliderState);
});

for (const def of SLIDERS) {
  if (!groups.has(def.group)) {
    const details = document.createElement('details');
    details.open = def.group === 'Body';
    const summary = document.createElement('summary');
    summary.textContent = def.group;
    details.appendChild(summary);
    slidersEl.appendChild(details);
    groups.set(def.group, details);
  }
  const row = document.createElement('div');
  row.className = 'row';
  const label = document.createElement('label');
  label.textContent = def.label;
  const input = document.createElement('input');
  input.type = 'range';
  input.min = -150;
  input.max = 150;
  input.value = 0;
  const val = document.createElement('span');
  val.className = 'val';
  val.textContent = '0';
  input.addEventListener('input', () => {
    sliderState[def.id] = input.value / 100;
    val.textContent = input.value;
    currentSex = null;
    updateSexButtons();
    avatar.applyShape(sliderState);
  });
  row.append(label, input, val);
  groups.get(def.group).appendChild(row);
  def._input = input;
  def._val = val;
}

// Start on the female preset (the Ruth2 default figure) so the avatar loads with
// its baseline shape — incl. the default nipple — rather than all-zero sliders.
applyPreset('female');

// ---- UI: animation ---------------------------------------------------

const btnPlay = document.getElementById('btn-play');
const btnStop = document.getElementById('btn-stop');
const btnSkel = document.getElementById('btn-skel');
const speedInput = document.getElementById('anim-speed');
const speedVal = document.getElementById('anim-speed-val');
const layersEl = document.getElementById('anim-layers');

// ---- clip layers -----------------------------------------------------
// The Animate tab stacks one or more clip rows; the top row is the highest
// priority. rebuildLayers() resolves the non-empty rows to clips and hands
// the avatar the ordered stack (see RuthAvatar.setLayerStack).

function fillClipOptions(select) {
  const none = document.createElement('option');
  none.value = '';
  none.textContent = '— none —';
  select.appendChild(none);
  // Registry is the single source of truth (shared with MCP list_animations).
  for (const { id, label } of ANIMATION_REGISTRY) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = label;
    select.appendChild(opt);
  }
}

function relabelLayers() {
  const rows = [...layersEl.children];
  rows.forEach((row, i) => {
    const label = row.querySelector('label');
    if (label) label.textContent = rows.length === 1 ? 'Clip' : (i === 0 ? 'Layer 1 (top)' : `Layer ${i + 1}`);
  });
}

function addLayerRow(value = '') {
  const row = document.createElement('div');
  row.className = 'row';
  const label = document.createElement('label');
  const select = document.createElement('select');
  select.style.flex = '1';
  fillClipOptions(select);
  select.value = value;
  select.addEventListener('change', rebuildLayers);
  const remove = document.createElement('button');
  remove.textContent = '×';
  remove.title = 'Remove layer';
  remove.style.cssText = 'flex:0 0 auto;min-width:28px';
  remove.addEventListener('click', () => {
    if (layersEl.children.length <= 1) { select.value = ''; } else { row.remove(); }
    relabelLayers();
    rebuildLayers();
  });
  row.append(label, select, remove);
  layersEl.appendChild(row);
  relabelLayers();
  return select;
}

const layerSelects = () => [...layersEl.querySelectorAll('select')];

// Reset to a single empty row (used by Stop / entering editor or play mode).
function clearLayersUI() {
  while (layersEl.children.length > 1) layersEl.lastElementChild.remove();
  const first = layerSelects()[0];
  if (first) first.value = '';
  relabelLayers();
}

// Resolve a registry id to a retargeted AnimationClip (BVH or glTF) for `av`.
// Retarget params (pelvisRestZ) are rig constants and the glTF clip cache is
// keyed by file, so any avatar resolves the same clip — `av` defaults to active.
async function resolveClip(id, av = avatar) {
  const entry = ANIMATION_REGISTRY.find((a) => a.id === id);
  if (!entry) throw new Error(`unknown animation: ${id}`);
  if (entry.source === 'bvh') {
    const bvh = await loadBVH(ASSETS + entry.file);
    return retargetToRuth(bvh, av.pelvisRestZ);
  }
  await initGltfAnim(ASSETS + entry.glbFile, av); // cached after first load
  const clip = getGltfClip(ASSETS + entry.glbFile, entry.glbAnimName);
  if (!clip) throw new Error(`GLB animation not found: ${entry.glbAnimName}`);
  return clip;
}

let _rebuildSeq = 0;
async function rebuildLayers() {
  if (editor.active || play.active) {
    status.textContent = 'exit play mode / the BVH editor before playing clips';
    return;
  }
  const ids = layerSelects().map((s) => s.value).filter(Boolean);
  if (ids.length === 0) {
    avatar.stop();
    avatar.applyShape(sliderState);
    status.textContent = 'stopped';
    return;
  }
  const seq = ++_rebuildSeq; // guard against out-of-order async resolves
  status.textContent = 'loading layers…';
  try {
    const layers = [];
    for (const id of ids) layers.push({ id, clip: await resolveClip(id), loop: true });
    if (seq !== _rebuildSeq) return; // a newer rebuild superseded this one
    avatar.setLayerStack(layers);
    btnPlay.textContent = 'Pause';
    status.textContent = layers.length === 1
      ? `playing ${ids[0]} (${layers[0].clip.duration.toFixed(1)}s)`
      : `playing ${layers.length} layers: ${ids.join(' › ')}`;
  } catch (err) {
    status.textContent = 'layer load failed: ' + err.message;
  }
}

addLayerRow(); // start with one empty clip row
document.getElementById('btn-add-layer').addEventListener('click', () => addLayerRow());

// Play a registered animation by id, as the TOP layer. Used by the MCP
// server's trigger_animation tool — sets the primary (top) layer row and
// rebuilds, so the Animate tab stays in sync and any lower layers persist.
async function playById(id) {
  if (!ANIMATION_REGISTRY.find((a) => a.id === id)) {
    status.textContent = `unknown animation: ${id}`;
    return;
  }
  if (editor.active || play.active) {
    status.textContent = 'exit play mode / the BVH editor before playing clips';
    return;
  }
  const first = layerSelects()[0] ?? addLayerRow();
  first.value = id;
  await rebuildLayers();
}

// Play a parsed (custom-file) BVH directly as a single-clip stack.
function playParsed(bvh, name) {
  if (editor.active || play.active) {
    status.textContent = 'exit play mode / the BVH editor before playing clips';
    return;
  }
  const clip = retargetToRuth(bvh, avatar.pelvisRestZ);
  clearLayersUI(); // a custom clip replaces the layer stack
  avatar.playClip(clip);
  btnPlay.textContent = 'Pause';
  status.textContent = `playing ${name} (${clip.duration.toFixed(1)}s, ${clip.tracks.length} tracks)`;
}

btnPlay.addEventListener('click', () => {
  if (!avatar.playing) return;
  avatar.setPaused(!avatar.paused);
  btnPlay.textContent = avatar.paused ? 'Play' : 'Pause';
});

btnStop.addEventListener('click', () => {
  avatar.stop();
  avatar.applyShape(sliderState);
  clearLayersUI();
  status.textContent = 'stopped';
});

let skeletonsVisible = false;
btnSkel.addEventListener('click', () => {
  skeletonsVisible = !skeletonsVisible;
  manager.setSkeletonsVisible(skeletonsVisible); // all avatars
  btnSkel.classList.toggle('active', skeletonsVisible);
});

speedInput.addEventListener('input', () => {
  const s = speedInput.value / 100;
  speedVal.textContent = s.toFixed(1);
  avatar.setSpeed(s);
});

document.getElementById('bvh-file').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      playParsed(parseBVH(reader.result), file.name); // clears the layer UI itself
    } catch (err) {
      status.textContent = 'BVH parse failed: ' + err.message;
    }
  };
  reader.readAsText(file);
});

// ---- UI: BVH editor ----------------------------------------------------

const editor = new AnimEditor({ avatar, scene, camera, renderer, orbit: controls, status });

// Per-avatar TTS lip-sync, reassigned on avatar switch (used by the Voice tab's
// speech test). MCP control of the avatar lives in examples/mcp/, not here.
let speech = avatar.speech;

document.getElementById('btn-create-bvh').addEventListener('click', () => {
  avatar.stop();
  clearLayersUI();
  btnPlay.textContent = 'Pause';
  editor.enter();
});

// ---- UI: physics -----------------------------------------------------

const physEnabled = document.getElementById('physics-enabled');
const physBounce = document.getElementById('physics-bounce');
const physBounceVal = document.getElementById('physics-bounce-val');
const physDamping = document.getElementById('physics-damping');
const physDampingVal = document.getElementById('physics-damping-val');
const physHDamping = document.getElementById('physics-hdamping');
const physHDampingVal = document.getElementById('physics-hdamping-val');
const physSag = document.getElementById('physics-sag');
const physSagVal = document.getElementById('physics-sag-val');
const btnPhysReset = document.getElementById('btn-physics-reset');

physEnabled.addEventListener('change', () => {
  avatar.pecPhysics.enabled = physEnabled.checked;
});

physBounce.addEventListener('input', () => {
  avatar.pecPhysics.bounciness = physBounce.value / 100;
  physBounceVal.textContent = physBounce.value;
});

physDamping.addEventListener('input', () => {
  avatar.pecPhysics.damping = physDamping.value / 100;
  physDampingVal.textContent = physDamping.value;
});

physHDamping.addEventListener('input', () => {
  avatar.pecPhysics.horizontalDamping = physHDamping.value / 100;
  physHDampingVal.textContent = physHDamping.value;
});

physSag.addEventListener('input', () => {
  avatar.pecPhysics.sag = physSag.value / 100;
  physSagVal.textContent = physSag.value;
});

btnPhysReset.addEventListener('click', () => {
  physBounce.value = 30;
  physBounceVal.textContent = '30';
  physDamping.value = 65;
  physDampingVal.textContent = '65';
  physHDamping.value = 85;
  physHDampingVal.textContent = '85';
  physSag.value = 40;
  physSagVal.textContent = '40';
  avatar.pecPhysics.bounciness = 0.3;
  avatar.pecPhysics.damping = 0.65;
  avatar.pecPhysics.horizontalDamping = 0.85;
  avatar.pecPhysics.sag = 0.4;
  for (const el of [physBounce, physDamping, physHDamping, physSag]) paintRange(el);
  avatar.pecPhysics.reset();
});

// ---- glute physics (same controls, driving avatar.glutePhysics) ----

const physGluteEnabled = document.getElementById('physics-glute-enabled');
const physGluteBounce = document.getElementById('physics-glute-bounce');
const physGluteBounceVal = document.getElementById('physics-glute-bounce-val');
const physGluteDamping = document.getElementById('physics-glute-damping');
const physGluteDampingVal = document.getElementById('physics-glute-damping-val');
const physGluteHDamping = document.getElementById('physics-glute-hdamping');
const physGluteHDampingVal = document.getElementById('physics-glute-hdamping-val');
const physGluteSag = document.getElementById('physics-glute-sag');
const physGluteSagVal = document.getElementById('physics-glute-sag-val');
const btnPhysGluteReset = document.getElementById('btn-physics-glute-reset');

physGluteEnabled.addEventListener('change', () => {
  avatar.glutePhysics.enabled = physGluteEnabled.checked;
});

physGluteBounce.addEventListener('input', () => {
  avatar.glutePhysics.bounciness = physGluteBounce.value / 100;
  physGluteBounceVal.textContent = physGluteBounce.value;
});

physGluteDamping.addEventListener('input', () => {
  avatar.glutePhysics.damping = physGluteDamping.value / 100;
  physGluteDampingVal.textContent = physGluteDamping.value;
});

physGluteHDamping.addEventListener('input', () => {
  avatar.glutePhysics.horizontalDamping = physGluteHDamping.value / 100;
  physGluteHDampingVal.textContent = physGluteHDamping.value;
});

physGluteSag.addEventListener('input', () => {
  avatar.glutePhysics.sag = physGluteSag.value / 100;
  physGluteSagVal.textContent = physGluteSag.value;
});

btnPhysGluteReset.addEventListener('click', () => {
  physGluteBounce.value = 30;
  physGluteBounceVal.textContent = '30';
  physGluteDamping.value = 65;
  physGluteDampingVal.textContent = '65';
  physGluteHDamping.value = 85;
  physGluteHDampingVal.textContent = '85';
  physGluteSag.value = 40;
  physGluteSagVal.textContent = '40';
  avatar.glutePhysics.bounciness = 0.3;
  avatar.glutePhysics.damping = 0.65;
  avatar.glutePhysics.horizontalDamping = 0.85;
  avatar.glutePhysics.sag = 0.4;
  for (const el of [physGluteBounce, physGluteDamping, physGluteHDamping, physGluteSag]) paintRange(el);
  avatar.glutePhysics.reset();
});

// ---- UI: environment -------------------------------------------------

const envAmbient = document.getElementById('env-ambient');
const envAmbientVal = document.getElementById('env-ambient-val');
const envSun = document.getElementById('env-sun');
const envSunVal = document.getElementById('env-sun-val');
const envSunAz = document.getElementById('env-sun-az');
const envSunAzVal = document.getElementById('env-sun-az-val');
const envSunEl = document.getElementById('env-sun-el');
const envSunElVal = document.getElementById('env-sun-el-val');
const envRefl = document.getElementById('env-refl');
const envReflVal = document.getElementById('env-refl-val');
const envBg = document.getElementById('env-bg');

const SUN_RADIUS = 6;
function placeSun() {
  const az = THREE.MathUtils.degToRad(Number(envSunAz.value));
  const el = THREE.MathUtils.degToRad(Number(envSunEl.value));
  sun.position.set(
    SUN_RADIUS * Math.cos(el) * Math.sin(az),
    SUN_RADIUS * Math.sin(el),
    SUN_RADIUS * Math.cos(el) * Math.cos(az)
  );
}
placeSun();

envAmbient.addEventListener('input', () => {
  hemiLight.intensity = envAmbient.value / 100;
  envAmbientVal.textContent = hemiLight.intensity.toFixed(1);
});
envSun.addEventListener('input', () => {
  sun.intensity = envSun.value / 100;
  envSunVal.textContent = sun.intensity.toFixed(1);
});
envSunAz.addEventListener('input', () => {
  envSunAzVal.textContent = `${envSunAz.value}°`;
  placeSun();
});
envSunEl.addEventListener('input', () => {
  envSunElVal.textContent = `${envSunEl.value}°`;
  placeSun();
});
envRefl.addEventListener('input', () => {
  scene.environmentIntensity = envRefl.value / 100;
  envReflVal.textContent = scene.environmentIntensity.toFixed(1);
});
// Background is either the solid color or, when an HDRI is loaded and the
// toggle is on, the equirectangular HDRI itself. The HDRI's PMREM cubemap
// always drives reflections (scene.environment) independently.
const bgColor = new THREE.Color(envBg.value);
let hdriEquirect = null; // raw equirect texture, shown as background
let hdriAsBackground = true;

function applyBackground() {
  scene.background = hdriAsBackground && hdriEquirect ? hdriEquirect : bgColor;
}
applyBackground();

envBg.addEventListener('input', () => {
  bgColor.set(envBg.value);
  fog.color.copy(bgColor);
  applyBackground();
});

const envHdriPreset = document.getElementById('env-hdri-preset');
const envHdri = document.getElementById('env-hdri');
const envHdriBg = document.getElementById('env-hdri-bg');
const rgbeLoader = new RGBELoader();
// Bundled HDRIs stream from the three.js GitHub mirror, pinned to our version.
const HDRI_BASE = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r184/examples/textures/equirectangular/';

let hdriEnvRT = null; // PMREM render target backing scene.environment

function disposeHdri() {
  if (hdriEnvRT) hdriEnvRT.dispose();
  if (hdriEquirect) hdriEquirect.dispose();
  hdriEnvRT = null;
  hdriEquirect = null;
}

function setHdriFromTexture(tex, label) {
  disposeHdri();
  tex.mapping = THREE.EquirectangularReflectionMapping;
  hdriEquirect = tex;
  hdriEnvRT = pmrem.fromEquirectangular(tex);
  scene.environment = hdriEnvRT.texture;
  applyBackground();
  status.textContent = `HDRI applied: ${label}`;
}

function resetToStudio() {
  disposeHdri();
  scene.environment = studioEnv;
  applyBackground();
}

envHdriPreset.addEventListener('change', () => {
  envHdri.value = '';
  if (!envHdriPreset.value) {
    resetToStudio();
    status.textContent = 'environment reset to studio';
    return;
  }
  const label = envHdriPreset.selectedOptions[0].textContent;
  status.textContent = `loading HDRI: ${label}…`;
  rgbeLoader.load(
    HDRI_BASE + envHdriPreset.value,
    (tex) => setHdriFromTexture(tex, label),
    undefined,
    () => { status.textContent = `failed to load HDRI: ${label}`; }
  );
});

envHdri.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  envHdriPreset.value = '';
  status.textContent = 'loading HDRI…';
  const url = URL.createObjectURL(file);
  rgbeLoader.load(
    url,
    (tex) => { URL.revokeObjectURL(url); setHdriFromTexture(tex, file.name); },
    undefined,
    () => {
      URL.revokeObjectURL(url);
      status.textContent = 'failed to load HDRI (expects an equirectangular .hdr)';
    }
  );
});

envHdriBg.addEventListener('change', () => {
  hdriAsBackground = envHdriBg.checked;
  applyBackground();
});

// Load the default preset (Quarry, shown as background) on startup.
hdriAsBackground = envHdriBg.checked;
envHdriPreset.dispatchEvent(new Event('change'));

document.getElementById('env-fog').addEventListener('change', (e) => {
  scene.fog = e.target.checked ? fog : null;
});
document.getElementById('env-shadows').addEventListener('change', (e) => {
  sun.castShadow = e.target.checked;
});
document.getElementById('env-ground').addEventListener('change', (e) => {
  ground.visible = e.target.checked;
});
document.getElementById('env-grid').addEventListener('change', (e) => {
  grid.visible = e.target.checked;
});

// ---- UI: play mode (keyboard driving) --------------------------------

const playSit = document.getElementById('play-sit');
function syncPlaySitButton() {
  if (!play.active) {
    playSit.disabled = true;
    playSit.textContent = 'Crouch';
    return;
  }
  playSit.disabled = false;
  playSit.textContent = play.loco.crouching ? 'Stand' : 'Crouch';
}

const play = new PlayMode({ avatar, camera, controls, status, onSitChange: syncPlaySitButton, glbFile: ASSETS + 'anims/UAL1_Standard.glb' });
const playToggle = document.getElementById('play-toggle');

playSit.addEventListener('click', () => play.tapSit());

playToggle.addEventListener('click', async () => {
  if (play.active) {
    play.exit();
    playToggle.textContent = '▶ Enter play mode';
    playToggle.classList.remove('active');
    syncPlaySitButton();
    status.textContent = 'left play mode';
    return;
  }
  if (editor.active) editor.exit();
  avatar.stop();
  clearLayersUI();
  btnPlay.textContent = 'Pause';
  playToggle.disabled = true;
  try {
    await play.enter();
    playToggle.textContent = '■ Exit play mode';
    playToggle.classList.add('active');
    syncPlaySitButton();
    play.statusText();
  } catch (err) {
    status.textContent = 'play mode failed: ' + err.message;
  } finally {
    playToggle.disabled = false;
  }
});

// ---- UI: attachments -------------------------------------------------

let attachments = avatar.attachments; // composed per-avatar prop manager

// Populate the bone dropdown
const attBone = document.getElementById('att-bone');
const attList = document.getElementById('att-list');
const attFile = document.getElementById('att-file');
const attOffsetEditor = document.getElementById('att-offset-editor');

for (const pt of ATTACHMENT_POINTS) {
  const opt = document.createElement('option');
  opt.value = pt.bone;
  opt.textContent = pt.label;
  attBone.appendChild(opt);
}
// Default to right hand (where you'd want a sword)
attBone.value = 'mWristRight';

// Simple offset-slider row builder
function makeOffsetRow(container, label, axis, axisLabel, min, max, step, initial, onChange) {
  const row = document.createElement('div');
  row.className = 'row';
  const lab = document.createElement('label');
  lab.textContent = `${label} ${axisLabel}`;
  const input = document.createElement('input');
  input.type = 'range';
  input.min = min;
  input.max = max;
  input.step = step;
  input.value = initial;
  const val = document.createElement('span');
  val.className = 'val';
  val.textContent = initial;
  input.addEventListener('input', () => {
    val.textContent = input.value;
    paintRange(input);
    onChange(Number(input.value));
  });
  row.append(lab, input, val);
  container.appendChild(row);
  paintRange(input);
  return { set: (v) => { input.value = v; val.textContent = v; paintRange(input); } };
}

let selectedAttachmentId = null;
const _offsetControls = {}; // { posX, posY, posZ, rotX, rotY, rotZ, scaleX, scaleY, scaleZ }

// Offset slider state (lives here so sliders + sync both see it).
const _offsetVals = { pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1] };

let _suppressOffsetCommit = false; // guard against gizmo→slider→gizmo feedback

function commitOffset() {
  if (_suppressOffsetCommit || selectedAttachmentId == null) return;
  attachments.setOffset(selectedAttachmentId, {
    pos: [..._offsetVals.pos], rot: [..._offsetVals.rot], scale: [..._offsetVals.scale],
  });
}

function buildOffsetEditor() {
  const posContainer = document.getElementById('att-offset-pos');
  const rotContainer = document.getElementById('att-offset-rot');
  const scaleContainer = document.getElementById('att-offset-scale');
  posContainer.innerHTML = '';
  rotContainer.innerHTML = '';
  scaleContainer.innerHTML = '';

  const posSection = document.createElement('div');
  posSection.className = 'section-label';
  posSection.textContent = 'Position';
  posContainer.appendChild(posSection);

  _offsetControls.posX = makeOffsetRow(posContainer, 'Pos', 'X', 'X', -1.0, 1.0, 0.005, 0, (v) => { _offsetVals.pos[0] = v; commitOffset(); });
  _offsetControls.posY = makeOffsetRow(posContainer, 'Pos', 'Y', 'Y', -1.0, 1.0, 0.005, 0, (v) => { _offsetVals.pos[1] = v; commitOffset(); });
  _offsetControls.posZ = makeOffsetRow(posContainer, 'Pos', 'Z', 'Z', -1.0, 1.0, 0.005, 0, (v) => { _offsetVals.pos[2] = v; commitOffset(); });

  const rotSection = document.createElement('div');
  rotSection.className = 'section-label';
  rotSection.textContent = 'Rotation (rad)';
  rotContainer.appendChild(rotSection);

  _offsetControls.rotX = makeOffsetRow(rotContainer, 'Rot', 'X', 'X', -Math.PI, Math.PI, 0.01, 0, (v) => { _offsetVals.rot[0] = v; commitOffset(); });
  _offsetControls.rotY = makeOffsetRow(rotContainer, 'Rot', 'Y', 'Y', -Math.PI, Math.PI, 0.01, 0, (v) => { _offsetVals.rot[1] = v; commitOffset(); });
  _offsetControls.rotZ = makeOffsetRow(rotContainer, 'Rot', 'Z', 'Z', -Math.PI, Math.PI, 0.01, 0, (v) => { _offsetVals.rot[2] = v; commitOffset(); });

  const scaleSection = document.createElement('div');
  scaleSection.className = 'section-label';
  scaleSection.textContent = 'Scale';
  scaleContainer.appendChild(scaleSection);

  _offsetControls.scaleX = makeOffsetRow(scaleContainer, 'Scl', 'X', 'X', 0.1, 3.0, 0.05, 1, (v) => { _offsetVals.scale[0] = v; commitOffset(); });
  _offsetControls.scaleY = makeOffsetRow(scaleContainer, 'Scl', 'Y', 'Y', 0.1, 3.0, 0.05, 1, (v) => { _offsetVals.scale[1] = v; commitOffset(); });
  _offsetControls.scaleZ = makeOffsetRow(scaleContainer, 'Scl', 'Z', 'Z', 0.1, 3.0, 0.05, 1, (v) => { _offsetVals.scale[2] = v; commitOffset(); });
}
buildOffsetEditor();

function round3(n) { return Math.round(n * 1000) / 1000; }

function syncOffsetSliders(entry) {
  if (!entry) { attOffsetEditor.style.display = 'none'; return; }
  attOffsetEditor.style.display = 'block';
  _offsetVals.pos = [...entry.offset.pos];
  _offsetVals.rot = [...entry.offset.rot];
  _offsetVals.scale = [...entry.offset.scale];
  _offsetControls.posX.set(round3(_offsetVals.pos[0]));
  _offsetControls.posY.set(round3(_offsetVals.pos[1]));
  _offsetControls.posZ.set(round3(_offsetVals.pos[2]));
  _offsetControls.rotX.set(round3(_offsetVals.rot[0]));
  _offsetControls.rotY.set(round3(_offsetVals.rot[1]));
  _offsetControls.rotZ.set(round3(_offsetVals.rot[2]));
  _offsetControls.scaleX.set(round3(_offsetVals.scale[0]));
  _offsetControls.scaleY.set(round3(_offsetVals.scale[1]));
  _offsetControls.scaleZ.set(round3(_offsetVals.scale[2]));
}

// Re-render the attachment list
function renderAttList() {
  attList.innerHTML = '';
  if (attachments.entries.length === 0) {
    attList.textContent = 'No objects attached.';
    attList.style.color = 'var(--muted)';
    selectedAttachmentId = null;
    attOffsetEditor.style.display = 'none';
    return;
  }
  attList.style.color = '';
  for (const entry of attachments.entries) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:6px;margin:4px 0;padding:6px 8px;background:var(--surface);border:1px solid var(--border);border-radius:7px';
    row.style.cursor = 'pointer';

    // Info
    const info = document.createElement('div');
    info.style.cssText = 'flex:1;min-width:0';
    const nameEl = document.createElement('div');
    nameEl.style.cssText = 'font-size:12px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
    nameEl.textContent = entry.name;
    const boneEl = document.createElement('div');
    boneEl.style.cssText = 'font-size:10px;color:var(--muted)';
    const pt = ATTACHMENT_POINTS.find(p => p.bone === entry.boneName);
    boneEl.textContent = pt ? pt.label : entry.boneName;
    info.append(nameEl, boneEl);
    row.appendChild(info);

    // Select highlight
    if (entry.id === selectedAttachmentId) {
      row.style.borderColor = 'var(--accent)';
      row.style.boxShadow = '0 0 0 1px var(--accent)';
    }

    row.addEventListener('click', () => {
      selectedAttachmentId = entry.id;
      syncOffsetSliders(entry);
      renderAttList();
    });

    // Adjust button — toggle the visual TransformControls gizmo on this attachment
    const adjustBtn = document.createElement('button');
    adjustBtn.textContent = '⟐';
    adjustBtn.title = 'Adjust with gizmo (drag to reposition)';
    adjustBtn.style.cssText = 'flex:0 0 auto;padding:2px 7px;font-size:13px;line-height:1';
    const isAdjusting = gizmoTarget && gizmoTarget.id === entry.id;
    if (isAdjusting) adjustBtn.classList.add('active');
    adjustBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (gizmoTarget && gizmoTarget.id === entry.id) {
        // Detach gizmo
        detachGizmo();
      } else {
        // Attach gizmo to this object
        attachGizmo(entry);
      }
      renderAttList();
    });
    row.appendChild(adjustBtn);

    // Remove button
    const removeBtn = document.createElement('button');
    removeBtn.textContent = '×';
    removeBtn.title = 'Remove attachment';
    removeBtn.style.cssText = 'flex:0 0 auto;padding:2px 7px;font-size:13px;line-height:1';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (gizmoTarget && gizmoTarget.id === entry.id) {
        detachGizmo();
      }
      if (selectedAttachmentId === entry.id) {
        selectedAttachmentId = null;
        attOffsetEditor.style.display = 'none';
      }
      attachments.remove(entry.id);
      renderAttList();
    });
    row.appendChild(removeBtn);
    attList.appendChild(row);

    // Gizmo mode toggles — rendered after the row is in the DOM
    if (isAdjusting) {
      const modeRow = document.createElement('div');
      modeRow.style.cssText = 'display:flex;gap:3px;margin-top:4px;padding:0 2px';
      for (const mode of ['translate', 'rotate', 'scale']) {
        const modeBtn = document.createElement('button');
        const labels = { translate: 'Move', rotate: 'Rotate', scale: 'Scale' };
        modeBtn.textContent = labels[mode];
        modeBtn.style.cssText = 'flex:1;padding:2px 4px;font-size:10px';
        if (gizmo.mode === mode) modeBtn.classList.add('active');
        modeBtn.addEventListener('click', (ee) => {
          ee.stopPropagation();
          gizmo.mode = mode;
          gizmo.getHelper().updateMatrixWorld(true); // force handle refresh
          status.textContent = `gizmo mode: ${mode}`;
          renderAttList();
        });
        modeRow.appendChild(modeBtn);
      }
      row.after(modeRow);
    }
  }

  // Re-sync offset editor if the selected entry still exists
  if (selectedAttachmentId != null) {
    const entry = attachments.entries.find(e => e.id === selectedAttachmentId);
    syncOffsetSliders(entry || null);
  }
}

renderAttList();

// Attach GLB file
attFile.addEventListener('change', async () => {
  const file = attFile.files[0];
  if (!file) return;
  attFile.disabled = true;
  status.textContent = 'loading attachment…';
  try {
    const entry = await attachments.attachFile(file, attBone.value);
    selectedAttachmentId = entry.id;
    syncOffsetSliders(entry);
    renderAttList();
    status.textContent = `attached ${entry.name} to ${ATTACHMENT_POINTS.find(p => p.bone === entry.boneName)?.label}`;
  } catch (err) {
    status.textContent = 'attach failed: ' + err.message;
  } finally {
    attFile.disabled = false;
    attFile.value = '';
  }
});

// Helper: detect if a bone name belongs to the left or right side, and
// mirror the X offset + Y rotation when crossing the midline.
function isRightBone(name) { return /right$/i.test(name); }
function isLeftBone(name) { return /left$/i.test(name); }
function mirroredOffset(offset, fromRight, toRight) {
  if (fromRight === toRight) return offset; // same side, no mirror needed
  const o = { pos: [...offset.pos], rot: [...offset.rot], scale: [...offset.scale] };
  o.pos[0] = -o.pos[0];   // mirror X
  o.rot[1] = -o.rot[1];   // mirror Y rotation
  return o;
}

// Built-in preset buttons — one per built-in model.
// Uses the currently-selected bone (the dropdown) so you can put a sword
// AND a shield on the same hand.  Offsets auto-mirror when crossing sides.
const builtinContainer = document.getElementById('att-add-builtin').parentElement;
builtinContainer.innerHTML = '';
for (const preset of BUILTIN_PRESETS) {
  const btn = document.createElement('button');
  btn.textContent = `+ ${preset.label}`;
  btn.title = `Attach ${preset.label} to the selected bone`;
  btn.addEventListener('click', () => {
    const bone = attBone.value;
    const fromRight = isRightBone(preset.bone) || !isLeftBone(preset.bone); // default side
    const toRight = isRightBone(bone) || !isLeftBone(bone);
    const offset = mirroredOffset(preset.offset, fromRight, toRight);
    const entry = attachments.attachBuiltin(preset.label, bone, preset.factory, offset);
    selectedAttachmentId = entry.id;
    syncOffsetSliders(entry);
    renderAttList();
    status.textContent = `${preset.label} attached to ${ATTACHMENT_POINTS.find(p => p.bone === bone)?.label}`;
  });
  builtinContainer.appendChild(btn);
}

document.getElementById('att-clear-all').addEventListener('click', () => {
  attachments.clear();
  selectedAttachmentId = null;
  attOffsetEditor.style.display = 'none';
  detachGizmo();
  renderAttList();
  status.textContent = 'all attachments cleared';
});

// ---- visual gizmo (TransformControls) for adjusting attachments --------

const gizmo = new TransformControls(camera, renderer.domElement);
gizmo.size = 0.7;          // bigger handles (default 0.5)
gizmo.space = 'local';     // move/rotate in the object's local space
scene.add(gizmo.getHelper()); // the helper is the Object3D; the controls itself is not

let gizmoTarget = null; // { entry, id } — which attachment the gizmo is currently on

function attachGizmo(entry) {
  // Ensure the avatar skeleton's world matrices are fresh so the gizmo
  // appears at the correct world position.
  avatar.group.updateMatrixWorld(true);
  gizmo.attach(entry.object);
  gizmoTarget = { entry, id: entry.id };
  if (gizmo.mode !== 'translate') gizmo.mode = 'translate';
  status.textContent = `gizmo: adjust ${entry.name} — drag the colored arrows`;
}

function detachGizmo() {
  gizmo.detach();
  gizmoTarget = null;
  status.textContent = 'gizmo detached';
}

gizmo.addEventListener('dragging-changed', (e) => {
  controls.enabled = !e.value; // disable orbit while dragging the gizmo
});

gizmo.addEventListener('objectChange', () => {
  if (!gizmoTarget) return;
  const obj = gizmoTarget.entry.object;
  // Read the gizmo's transform back into the offset
  const o = gizmoTarget.entry.offset;
  o.pos[0] = round3(obj.position.x);
  o.pos[1] = round3(obj.position.y);
  o.pos[2] = round3(obj.position.z);
  o.rot[0] = round3(obj.rotation.x);
  o.rot[1] = round3(obj.rotation.y);
  o.rot[2] = round3(obj.rotation.z);
  // Sync the sliders without triggering a commit back to the object
  _suppressOffsetCommit = true;
  syncOffsetSliders(gizmoTarget.entry);
  _suppressOffsetCommit = false;
});

// Expose gizmo for debugging
window.__gizmo = gizmo;
window.__gizmoTarget = () => gizmoTarget;

// Expose attachments for debugging
window.__attachments = attachments;

// ---- UI: voice / lip sync --------------------------------------------

let voice = avatar.voice; // composed per-avatar mic lip-sync
const voiceToggle = document.getElementById('voice-toggle');
const voiceSens = document.getElementById('voice-sens');
const voiceSensVal = document.getElementById('voice-sens-val');
const voiceOpen = document.getElementById('voice-open');
const voiceOpenVal = document.getElementById('voice-open-val');
const voiceMeterFill = document.getElementById('voice-meter-fill');

function applyVoiceSens() {
  voice.gain = 4 + (voiceSens.value / 100) * 116; // 4 → 120
  voiceSensVal.textContent = voiceSens.value;
}
function applyVoiceMaxOpen() {
  // "Max open" caps jaw openness for both the mic (VoiceMouth) and TTS speech.
  voice.maxOpen = voiceOpen.value / 100;
  speech.maxOpen = voiceOpen.value / 100;
  voiceOpenVal.textContent = voiceOpen.value;
}
applyVoiceSens();
applyVoiceMaxOpen();
voiceSens.addEventListener('input', applyVoiceSens);
voiceOpen.addEventListener('input', applyVoiceMaxOpen);

const voiceTest = document.getElementById('voice-test');
voiceTest.addEventListener('click', async () => {
  voiceTest.disabled = true;
  status.textContent = 'generating test speech…';
  try {
    const res = await fetch('/api/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}', // server picks a default test phrase + voice
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `HTTP ${res.status}`);
    const { url, visemeUrl } = await res.json();
    await speech.play(url, visemeUrl);
    status.textContent = 'playing test speech';
  } catch (err) {
    status.textContent = 'test speech failed: ' + err.message;
  } finally {
    voiceTest.disabled = false;
  }
});

voiceToggle.addEventListener('click', async () => {
  if (voice.active) {
    voice.stop();
    voiceToggle.textContent = '● Start mic';
    voiceToggle.classList.remove('active');
    status.textContent = 'mic stopped';
    return;
  }
  voiceToggle.disabled = true;
  status.textContent = 'requesting microphone…';
  try {
    await voice.start();
    voiceToggle.textContent = '■ Stop mic';
    voiceToggle.classList.add('active');
    status.textContent = 'mic live — talk to move the mouth';
  } catch (err) {
    status.textContent = 'mic error: ' + err.message;
  } finally {
    voiceToggle.disabled = false;
  }
});

// ---- UI: auto blink (Look at tab) ------------------------------------

let blinker = avatar.blinker; // composed per-avatar procedural blinking
const blinkEnabled = document.getElementById('blink-enabled');
const blinkInterval = document.getElementById('blink-interval');
const blinkIntervalVal = document.getElementById('blink-interval-val');
const blinkVariation = document.getElementById('blink-variation');
const blinkVariationVal = document.getElementById('blink-variation-val');
const blinkSpeed = document.getElementById('blink-speed');
const blinkSpeedVal = document.getElementById('blink-speed-val');

// Push the Blinker's current state onto the Look-at tab controls. Used by the
// MCP set_blink handler so panel + tool stay in sync (like trigger_animation
// updating the Animate dropdown).
function syncBlinkControls() {
  blinkEnabled.checked = blinker.enabled;
  blinkInterval.value = blinker.interval;
  blinkIntervalVal.textContent = `${blinker.interval.toFixed(1)}s`;
  blinkVariation.value = Math.round(blinker.variation * 100);
  blinkVariationVal.textContent = `${Math.round(blinker.variation * 100)}%`;
  blinkSpeed.value = Math.round(blinker.speed * 1000);
  blinkSpeedVal.textContent = `${Math.round(blinker.speed * 1000)}ms`;
  for (const el of [blinkInterval, blinkVariation, blinkSpeed]) paintRange(el);
}

blinkEnabled.addEventListener('change', () => {
  blinker.setEnabled(blinkEnabled.checked);
  if (blinkEnabled.checked) blinker.blinkNow(); // immediate feedback
});
blinkInterval.addEventListener('input', () => {
  blinker.interval = Number(blinkInterval.value);
  blinkIntervalVal.textContent = `${blinker.interval.toFixed(1)}s`;
});
blinkVariation.addEventListener('input', () => {
  blinker.variation = Number(blinkVariation.value) / 100;
  blinkVariationVal.textContent = `${blinkVariation.value}%`;
});
blinkSpeed.addEventListener('input', () => {
  blinker.speed = Number(blinkSpeed.value) / 1000; // ms → s
  blinkSpeedVal.textContent = `${blinkSpeed.value}ms`;
});
document.getElementById('blink-now').addEventListener('click', () => blinker.blinkNow());

window.__blink = blinker;

// ---- UI: range fill ---------------------------------------------------

// The slider track is a two-stop gradient driven by --p (percent filled).
function paintRange(el) {
  const min = Number(el.min) || 0;
  const max = Number(el.max) || 100;
  el.style.setProperty('--p', `${((el.value - min) / (max - min)) * 100}%`);
}

for (const el of document.querySelectorAll('#panel input[type=range]')) {
  paintRange(el);
  el.addEventListener('input', () => paintRange(el));
}

// ---- multiple avatars: selector bar + active-avatar switching ---------
//
// `avatar` (and the voice/speech/blinker/attachments aliases) point at the
// ACTIVE avatar. Switching repoints them, repopulates every panel control from
// the newly-active avatar, and re-targets the editor/play tools. Each avatar
// keeps its own UI-only state (slider positions, sex preset, Animate layers) in
// its manager entry; everything else is read straight off the avatar instance.

// Repopulate panel control VALUES from the active avatar. The control *handlers*
// already act on the live `avatar` binding, so only the displayed values need
// refreshing here.
function syncPartsUI() {
  for (const name of Object.keys(avatar.parts)) {
    const cb = document.getElementById(`part-${name}`);
    if (cb) cb.checked = avatar.parts[name].root.visible;
  }
  const tex = document.getElementById('opt-textured');
  if (tex) tex.checked = avatar._textured;
}

function syncPhysicsUI() {
  const set = (input, valEl, v) => { input.value = Math.round(v * 100); valEl.textContent = input.value; paintRange(input); };
  const p = avatar.pecPhysics, g = avatar.glutePhysics;
  physEnabled.checked = p.enabled;
  set(physBounce, physBounceVal, p.bounciness);
  set(physDamping, physDampingVal, p.damping);
  set(physHDamping, physHDampingVal, p.horizontalDamping);
  set(physSag, physSagVal, p.sag);
  physGluteEnabled.checked = g.enabled;
  set(physGluteBounce, physGluteBounceVal, g.bounciness);
  set(physGluteDamping, physGluteDampingVal, g.damping);
  set(physGluteHDamping, physGluteHDampingVal, g.horizontalDamping);
  set(physGluteSag, physGluteSagVal, g.sag);
}

// Rebuild the Animate-tab layer rows to a saved selection without triggering a
// reload (programmatic select.value doesn't fire 'change').
function restoreLayersUI(values) {
  while (layersEl.firstChild) layersEl.removeChild(layersEl.firstChild);
  const vals = values && values.length ? values : [''];
  for (const v of vals) addLayerRow(v);
  relabelLayers();
}

function syncPanelToAvatar() {
  for (const def of SLIDERS) {
    const v = sliderState[def.id] ?? 0;
    def._input.value = Math.round(v * 100);
    def._val.textContent = Math.round(v * 100);
    paintRange(def._input);
  }
  updateSexButtons();
  renderSkinRegions();
  renderClothing('upper', document.getElementById('clothing-upper'));
  renderClothing('lower', document.getElementById('clothing-lower'));
  syncPartsUI();
  syncPhysicsUI();
  syncBlinkControls();
  selectedAttachmentId = null;
  attOffsetEditor.style.display = 'none';
  renderAttList();
  restoreLayersUI(activeEntry.ui.layers);
  btnPlay.textContent = avatar.paused || !avatar.playing ? 'Play' : 'Pause';
}

// Tear down tools/audio bound to the avatar we're leaving.
function teardownActiveTools() {
  if (play.active) {
    play.exit();
    playToggle.textContent = '▶ Enter play mode';
    playToggle.classList.remove('active');
  }
  if (editor.active) editor.exit();
  voice.stop();
  voiceToggle.textContent = '● Start mic';
  voiceToggle.classList.remove('active');
  speech.stop();
  detachGizmo();
}

function saveActiveUiState() {
  if (!activeEntry) return;
  activeEntry.ui.sex = currentSex;
  activeEntry.ui.layers = layerSelects().map((s) => s.value);
  // slider positions already live in activeEntry.ui.sliders (=== sliderState)
}

// Repoint every active-avatar alias + tools at manager.active and refresh UI.
function bindActiveAvatar() {
  activeEntry = manager.activeEntry;
  avatar = manager.active;
  voice = avatar.voice;
  speech = avatar.speech;
  blinker = avatar.blinker;
  attachments = avatar.attachments;
  sliderState = activeEntry.ui.sliders;
  currentSex = activeEntry.ui.sex;
  play.setAvatar(avatar);
  editor.setAvatar(avatar);
  applyVoiceSens();    // mic sensitivity / max-open are global prefs — push
  applyVoiceMaxOpen(); // the slider values onto the newly-active voice/speech
  syncPanelToAvatar();
  buildAvatarBar();
}

function selectAvatar(index) {
  if (index < 0 || index >= manager.count || index === manager.activeIndex) return;
  saveActiveUiState();
  teardownActiveTools();
  manager.setActive(index);
  bindActiveAvatar();
  status.textContent = `avatar ${index + 1} active`;
}

async function addAvatar(opts) {
  status.textContent = 'loading avatar…';
  try {
    saveActiveUiState();
    teardownActiveTools();
    const entry = await manager.add(opts);
    manager.setActive(manager.indexOf(entry));
    bindActiveAvatar();
    status.textContent = `avatar ${manager.activeIndex + 1} added`;
    return manager.activeIndex;
  } catch (err) {
    status.textContent = 'add avatar failed: ' + err.message;
    throw err;
  }
}

function removeActiveAvatar() {
  if (manager.count <= 1) return;
  teardownActiveTools();
  manager.remove(manager.activeIndex);
  bindActiveAvatar();
  status.textContent = 'avatar removed';
}

function buildAvatarBar() {
  let bar = document.getElementById('avatar-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'avatar-bar';
    bar.style.cssText = 'display:flex;gap:5px;align-items:center;flex-wrap:wrap;padding:7px 10px;border-bottom:1px solid var(--border)';
    const panel = document.getElementById('panel');
    panel.insertBefore(bar, panel.firstChild);
  }
  bar.innerHTML = '';
  const lab = document.createElement('span');
  lab.textContent = 'Avatars';
  lab.style.cssText = 'font-size:11px;color:var(--muted);margin-right:2px';
  bar.appendChild(lab);
  manager.entries.forEach((e, i) => {
    const btn = document.createElement('button');
    btn.textContent = `${i + 1}`;
    btn.title = `Select avatar ${i + 1}`;
    btn.style.cssText = 'min-width:26px;padding:3px 8px;font-size:12px';
    if (i === manager.activeIndex) btn.classList.add('active');
    btn.addEventListener('click', () => selectAvatar(i));
    bar.appendChild(btn);
  });
  const add = document.createElement('button');
  add.textContent = '＋';
  add.title = 'Add a new avatar';
  add.style.cssText = 'padding:3px 9px;font-size:13px';
  add.addEventListener('click', () => addAvatar());
  bar.appendChild(add);
  const del = document.createElement('button');
  del.textContent = '✕';
  del.title = 'Remove the active avatar';
  del.style.cssText = 'padding:3px 9px;font-size:12px';
  del.disabled = manager.count <= 1;
  del.addEventListener('click', () => removeActiveAvatar());
  bar.appendChild(del);
}
buildAvatarBar();

// Expose avatar management to the MCP API (avatar-specific tool targeting).
window.__manager = manager;

// ---- loop ------------------------------------------------------------

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// debugging hooks (agent-browser / devtools)
window.__scene = scene;
window.__avatar = avatar;
window.__THREE = THREE;
window.__camera = camera;
window.__controls = controls;
window.__pecPhysics = avatar.pecPhysics;
window.__glutePhysics = avatar.glutePhysics;

window.__editor = editor;
window.__play = play;
window.__voice = voice;
window.__speech = speech;

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  manager.update(dt); // advance EVERY avatar (pose, physics, blink, lip-sync)
  editor.update(dt); // editor/play act on the active avatar only
  if (voice.active) voiceMeterFill.style.width = `${Math.min(100, voice.level * 100)}%`;
  if (play.active) play.update(dt); // drives movement + chase camera
  else controls.update();
  renderer.render(scene, camera);
});
