// MCP example — a minimal avatar scene wired to the MCP WebSocket bridge.
//
// The server (server.js) exposes an MCP endpoint and relays each tool call here
// over a WebSocket; this page runs the call against the avatar(s) and replies.
// Look-at / blink / speech use the avatar's own per-instance capabilities
// (avatar.setLookAt / .blinker / .speak), so no editor or panel UI is needed.

import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

import {
  Avatar,
  loadBVH, retargetToRuth, initGltfAnim, getGltfClip,
} from '../../index.js';
import { findAnimation } from '../common/registry.js';
import { AvatarManager } from '../../avatarManager.js';
import { McpClient } from './mcpClient.js';
import { createAvatarApi } from './avatarApi.js';

// ---- scene ------------------------------------------------------------
const renderer = new THREE.WebGPURenderer({ antialias: true });
await renderer.init();
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1d24);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.05, 100);
camera.position.set(1.6, 1.5, 2.6);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.9, 0);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xc8d4ff, 0x3a3530, 1.2));
const sun = new THREE.DirectionalLight(0xfff2e0, 2.2);
sun.position.set(3, 5, 2); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
scene.add(sun);
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(6, 48),
  new THREE.MeshStandardMaterial({ color: 0x23262f, roughness: 0.95 }),
);
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
scene.add(new THREE.GridHelper(12, 24, 0x3a3f4e, 0x2a2e3a));

// ---- avatar(s) --------------------------------------------------------
// A manager backs the list_avatars / add_avatar / select_avatar tools.
const ASSETS = '../../'; // repo root, relative to this page (/examples/mcp/) — models/ + anims/ live there
const manager = new AvatarManager({ scene, basePath: ASSETS + 'models/', makeUiState: () => ({}) });
const first = await new Avatar().load(ASSETS + 'models/');
first.group.rotation.y = -Math.PI / 2; // face the camera (+Z)
manager.adopt(first);
first.setBlinking(true);

// ---- play a registered animation on a specific avatar -----------------
async function resolveClip(id, av) {
  const entry = findAnimation(id);
  if (!entry) throw new Error(`unknown animation: ${id}`);
  if (entry.source === 'bvh') return retargetToRuth(await loadBVH(ASSETS + entry.file), av.pelvisRestZ);
  await initGltfAnim(ASSETS + entry.glbFile, av);
  const clip = getGltfClip(ASSETS + entry.glbFile, entry.glbAnimName);
  if (!clip) throw new Error(`GLB animation not found: ${entry.glbAnimName}`);
  return clip;
}
async function playAnimationOn(target, id) {
  target.setLayerStack([{ id, clip: await resolveClip(id, target), loop: true }]);
}
function selectAvatar(index) { manager.setActive(index); }
async function addAvatar(opts) {
  const entry = await manager.add(opts);
  manager.setActive(manager.indexOf(entry));
  return manager.activeIndex;
}

// ---- MCP tool handlers ------------------------------------------------
const mcpApi = createAvatarApi({ manager, scene, camera, renderer, playAnimationOn, selectAvatar, addAvatar });

mcpApi.play_speech = ({ url, visemeUrl, avatar: sel } = {}) => {
  if (!url) throw new Error('play_speech requires a url');
  const { entry, index } = manager.resolve(sel);
  return entry.avatar.speak(url, visemeUrl).then((r) => ({ ...r, avatar: index }));
};

mcpApi.set_look_at = ({ enabled, x, y, z, avatar: sel } = {}) => {
  const { entry, index } = manager.resolve(sel);
  return { avatar: index, ...entry.avatar.setLookAt({ enabled, x, y, z }) };
};

mcpApi.set_blink = ({ enabled, interval, variation, speed, blink_now, avatar: sel } = {}) => {
  const { entry, index } = manager.resolve(sel);
  const b = entry.avatar.blinker;
  const clamp = THREE.MathUtils.clamp;
  if (typeof interval === 'number') b.interval = clamp(interval, 0.2, 30);
  if (typeof variation === 'number') b.variation = clamp(variation, 0, 1);
  if (typeof speed === 'number') b.speed = clamp(speed, 0.04, 2);
  if (typeof enabled === 'boolean') { b.setEnabled(enabled); if (enabled) b.blinkNow(); }
  if (blink_now) b.blinkNow();
  return { avatar: index, enabled: b.enabled, interval: b.interval, variation: b.variation, speed: b.speed };
};

// ---- bridge connection + status ---------------------------------------
const statusEl = document.getElementById('status');
const poseEl = document.getElementById('pose');
document.getElementById('endpoint').textContent = `${location.origin}/mcp`;

const client = new McpClient({
  api: mcpApi,
  onStatus: ({ connected, reason }) => {
    statusEl.textContent = connected
      ? 'connected — tool calls reach this scene'
      : `disconnected${reason ? ` (${reason})` : ''} — is the server running?`;
    statusEl.className = `status ${connected ? 'ok' : 'bad'}`;
  },
});
client.start();

setInterval(() => {
  try { poseEl.textContent = JSON.stringify(mcpApi.get_avatar_transform(), null, 2); }
  catch { poseEl.textContent = 'avatar not ready'; }
}, 500);

// ---- loop -------------------------------------------------------------
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  manager.update(clock.getDelta());
  controls.update();
  renderer.render(scene, camera);
});

// expose for debugging
window.__manager = manager;
window.__mcpApi = mcpApi;
