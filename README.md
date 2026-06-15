> **Dedication.** This project exists because of the immense work of the
> [RuthAndRoth/Ruth](https://github.com/RuthAndRoth/Ruth) contributors — an
> open-source mesh avatar built over years of rigging, fitting, testing, and
> community iteration. *metaverse-avatar* is a small effort on top of that foundation
> made possible by a certain place and time with AI; the credit belongs mostly to them.

# metaverse-avatar

A reusable three.js avatar library for the [RuthAndRoth](https://github.com/RuthAndRoth/Ruth)
**Ruth2 RC3** open-source mesh avatar — one `Avatar` class with shape sliders,
BVH/glTF animation, PBR materials, physics, lip-sync, blinking, and attachments.
The library source sits at the repo root (the `*.js` files, plus the `models/`
mesh assets and the `anims/` animation clips); the apps live under `examples/`.
The published npm package bundles `models/` and `anims/`, so a consumer gets the
avatar and the sample clips out of the box (point loaders at the package path,
or copy them into your own served assets).

No build step — three.js r184 is loaded from the jsDelivr CDN via an import map.

## Run

Serve the repo root with any static file server, then open one of the examples:

```sh
python3 -m http.server 8413
# Studio (the full lab UI):  http://localhost:8413/examples/studio/
# Minimal usage:             http://localhost:8413/examples/simple/
```

(ES modules need `http://`, not `file://`.)

## Examples

- **`examples/studio/`** — the full lab UI: shape sliders, PBR textures, the BVH
  pose editor, physics, multiple avatars, play mode, and more. Pure static; this
  is what used to be the repo's root `index.html`.
- **`examples/simple/`** — the smallest way to use the avatar: three.js from a
  CDN import map + the avatar loaded from this repo's local files, wired up like
  the Play tab (keyboard driving + chase camera). Serve the repo and open
  `/examples/simple/`.
- **`examples/mcp/`** — control an avatar over [MCP](https://modelcontextprotocol.io).
  It's **self-contained** with its own `package.json` (express, ws, zod,
  `@modelcontextprotocol/sdk`): a server exposes an MCP endpoint + WebSocket
  bridge that relays tool calls into the avatar page.

  ```sh
  cd examples/mcp
  npm install
  npm run dev   # http://localhost:4173/examples/mcp/  (page) + /mcp (MCP endpoint)
  ```

  Point your MCP client at `http://localhost:4173/mcp` and keep the page open.
  Tools: `list_animations`, `trigger_animation`, `get_avatar_transform`,
  `capture_screenshot`, `set_avatar_blink`, `set_avatar_look_at`,
  `avatar_text_to_speech` (needs `XAI_API_KEY` in a `.env`), plus
  `list_avatars` / `add_avatar` / `select_avatar`.

## Use as a library — the `Avatar` class

The whole avatar is a **single class**: `new Avatar()` builds a self-contained,
independently-controllable figure — its own skeleton, materials, animation
state, pec/glute physics, blinking, mic/TTS lip-sync, prop attachments, and eye
look-at. Nothing is shared between instances, so you can load several into
one scene and drive each separately.

`three` is a **peer dependency** — the host app provides it (an import map in
the browser, or `node_modules` under a bundler), so every avatar shares the
app's single THREE instance. `index.js` is the package entry
(`main` / `module` / `exports`).

```js
import { Avatar } from 'metaverse-avatar'; // or './index.js' without a bundler
```

### What an `Avatar` can do — at a glance

| area | API |
|---|---|
| **lifecycle** | `await load(basePath)` · `update(dt)` (advances everything) · `dispose()` · `group` (add to scene) |
| **shape** | `applyShape({ height, breasts, … })` — see `SLIDERS` / `SEX_PRESETS` |
| **appearance** | `setPartVisible(part, on)` · `setTextured(on)` · `setSkinMap(region, channel, img)` · clothing layers (`addClothingLayer` / `setLayerMap` / …) · `setGlobalRoughness` / `setGlobalMetalness` |
| **animation** | `playClip(clip)` · `crossFadeTo(clip, dur, loop)` · `setLayerStack([…])` · `setSpeed(s)` · `setPaused(on)` · `stop()` · `playing` |
| **blinking** | `setBlinking(on)` · `blinkNow()` · `blinker` |
| **lip-sync** | `startMic()` / `stopMic()` (mic) · `speak(url, visemeUrl)` / `stopSpeaking()` (TTS) · `voice`, `speech` |
| **eye look-at** | `setLookAt({ enabled, x, y, z })` · `getLookAt()` · `lookAt` |
| **attachments** | `attachBuiltin(name, bone, factory, offset)` · `attachFile(file, bone, offset)` · `attachments` |
| **physics** | `pecPhysics`, `glutePhysics` — `.enabled` / `.bounciness` / `.damping` / `.sag` |
| **low-level face** | `setMouthOpen(t)` · `setMouth({ open, round, wide })` · `setBlink(t)` |

Everything is per-instance — call any of these on each `new Avatar()` independently.
Locomotion (walk/run/jump/fly) is **not** on the avatar; it's an app-level concern
(see [§4](#4-moving-the-avatar-around-locomotion)).

### 1. Construct and load

The constructor is cheap and synchronous; `load()` does the async work (fetches
the mesh parts + default textures, grafts the head, captures the rest pose) and
resolves to the same instance. **Add `avatar.group` to your scene** — it's the
avatar's single root `THREE.Group`.

```js
const avatar = await new Avatar().load('models/'); // models/ = where the meshes + textures live
scene.add(avatar.group);
```

It loads the `.glb` parts (`body.glb`, `hands.glb`, …) — glTF/GLB only. Override
the filenames per call to swap in your own meshes (same Z-up Ruth rig):

```js
await new Avatar().load('models/', {
  parts: { body: 'body.glb', hands: 'hands.glb', feet: 'feet.glb', head: 'head.glb', eyes: 'eyes.glb' },
});
```

Each `parts` value may be a plain filename (joined with `basePath`) **or an
absolute URL** (`https:`, `/…`, `blob:`, `data:`) used as-is — so under a bundler
you can hand the avatar the exact, fingerprinted asset URLs it emits:

```js
import bodyUrl from './models/body.glb';   // Vite/webpack → a hashed URL
import handsUrl from './models/hands.glb';
// …feet, head, eyes
await new Avatar().load('models/', { parts: { body: bodyUrl, hands: handsUrl, /* … */ } });
// NOTE: skin textures still resolve under basePath (not yet per-file URLs).

// optional: face the avatar toward +Z (the rig faces +X by default)
avatar.group.rotation.y = -Math.PI / 2;
```

| call | what it does |
|---|---|
| `new Avatar()` | build (no I/O) |
| `await avatar.load(basePath)` | load the meshes/textures from `basePath` (default `'models/'`); returns `this` |
| `avatar.group` | the root `THREE.Group` — add this to your scene |
| `avatar.dispose()` | free all GPU resources and detach from the scene |

### 2. Drive it each frame

One call advances everything the avatar does on its own — animation mixers,
physics (jiggle/sag), blinking, mic/TTS lip-sync, and eye look-at:

```js
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  avatar.update(clock.getDelta());
  renderer.render(scene, camera);
});
```

Locomotion is the one capability that's **input-driven**, so you tick it
yourself after setting its intent (see below).

### 3. Capabilities

Each avatar owns one of each capability as a public member, plus thin verb
facades for the common actions:

| member | facade(s) | what it does |
|---|---|---|
| `avatar.blinker` | `setBlinking(on)`, `blinkNow()` | procedural eye blinking |
| `avatar.voice` | `startMic()`, `stopMic()` | microphone-driven jaw (lip-sync to live audio) |
| `avatar.speech` | `speak(url, visemeUrl)`, `stopSpeaking()` | play a TTS clip and lip-sync to it (per-viseme if a timing file is given) |
| `avatar.attachments` | `attachBuiltin(name, bone, factory, offset)`, `attachFile(file, bone, offset)` | parent props (sword, hat, …) to bones |
| `avatar.lookAt` | `setLookAt({ enabled, x, y, z })`, `getLookAt()` | aim the eyes at a world-space point |
| `avatar.pecPhysics`, `avatar.glutePhysics` | — | soft-body jiggle/sag (`.enabled`, `.bounciness`, `.damping`, `.sag`) |

```js
avatar.setBlinking(true);                       // start idle blinking
await avatar.speak('/clip.mp3', '/clip.json');  // speak + lip-sync
avatar.setLookAt({ enabled: true, x: 1, y: 1.5, z: 2 }); // gaze at a point
avatar.attachBuiltin('Sword', 'mWristRight', createSword); // createSword is a metaverse-avatar export
```

### 4. Moving the avatar around (locomotion)

**Locomotion is intentionally not part of `Avatar`** — how a figure moves through
the world is the game's concern (a physics engine, a navmesh, networked input,
…). Move an avatar however you like by driving `avatar.group` (position /
rotation) and the animation methods directly.

Locomotion is **not** a library export — it's app-level, so the library doesn't
prescribe it. A ready-made controller (walk / run / turn / jump / fly + a
cross-faded state machine) lives in the examples at
[`examples/common/locomotion.js`](examples/common/locomotion.js); copy it into
your app and bind it to an avatar:

```js
import { Locomotion } from './locomotion.js'; // copied from examples/common/

// glbFile is required — point it at your own locomotion clip GLB.
const loco = new Locomotion(avatar, { glbFile: 'anims/UAL1_Standard.glb' });
await loco.start();                   // loads the clips, enters control
loco.setInput({ forward: true, left: true });
loco.setInput({ forward: true, run: true }); // hold Shift in Play mode
                                              // also toggleFly(), jump(), toggleSit()
// per frame, after avatar.update(dt):
loco.update(dt);
// …later:
loco.stop();
```

The `PlayMode` in `examples/studio/play.js` is one example viewer that wraps
`Locomotion` with a keyboard and a third-person chase camera.

### 5. Appearance

```js
// Shape — a map of slider id → value (roughly -1.5..1.5). See SLIDERS / SEX_PRESETS.
avatar.applyShape({ height: 0.8, breasts: 0.4 });

// Materials — per-region PBR maps (region: face|upper|lower|eyes, channel:
// albedo|normal|roughness|metallic|ao) and stacked clothing layers.
avatar.setSkinMap('upper', 'albedo', someImage);
const i = avatar.addClothingLayer('upper');
avatar.setLayerMap('upper', i, 'albedo', shirtImage);

avatar.setPartVisible('head', false); // toggle a body part
avatar.setTextured(false);            // drop to flat material
```

### 6. Animation

```js
import { loadBVH, retargetToRuth } from 'metaverse-avatar';

// loadBVH takes any URL/path your app serves the clip from; the package bundles
// a few sample clips under anims/ (serve them, or point at your own).
const clip = retargetToRuth(await loadBVH('anims/pirouette.bvh'), avatar.pelvisRestZ);
avatar.playClip(clip);                 // play one clip as the whole body
avatar.crossFadeTo(otherClip, 0.25);   // blend to another over 0.25 s
avatar.setLayerStack([                 // layered playback (index 0 = highest priority)
  { id: 'rgrip', clip: gripClip, loop: true },  // hand-only layer on top…
  { id: 'walk',  clip: walkClip, loop: true },  // …full-body underneath
]);
avatar.setSpeed(1.5);  avatar.setPaused(true);  avatar.stop();
```

### 7. Multiple avatars

Because instances share nothing, several can live in one scene and be driven
completely separately:

```js
const a = await new Avatar().load('models/');
const b = await new Avatar().load('models/');
a.group.position.x = -1;
b.group.position.x = 1;
scene.add(a.group, b.group);

a.applyShape({ height: 0.8 });
b.setLookAt({ enabled: true, x: 0, y: 1.4, z: 3 });

const aLoco = new Locomotion(a, { glbFile: 'anims/UAL1_Standard.glb' }); // app-level, one per avatar
await aLoco.start();
aLoco.setInput({ forward: true });

renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  a.update(dt); b.update(dt);  // both animate, blink, gaze independently
  aLoco.update(dt);            // only a is walking
  renderer.render(scene, camera);
});
```

> The Studio app (`examples/studio/main.js`) layers a UI, a chase camera (`PlayMode`), the BVH
> `AnimEditor`, and the MCP bridge on top — all *scene-level* concerns that live
> in the host app, **not** in `Avatar`. `avatarManager.js` shows one way to
> track several avatars and switch which is "active".

## Features

- **Model** — the Ruth2 RC3 release meshes (`Release3_BothLowerUpper_15.dae`,
  `Release3_Hands_15.dae` bento hands, `Release3_FlatFeet_15.dae`), plus the
  Ruth2 v4 bento head and eyeballs (`Ruth2v4Head.dae`, `Ruth2v4Eyeballs.dae`
  from the RuthAndRoth/Ruth2 repo — the RC3 release has no head). The v4
  head/eye exports have flat skeletons, so their bones are grafted into the
  body's skeleton at load under a synthesized `mHead` bone, which makes them
  follow BVH animation and sliders like native parts. Parts can be toggled.
- **PBR textures** — every region (face / upper / lower / eyes) is a full
  metallic-roughness material with five map channels: Base Color, Normal,
  Roughness, Metallic, and Ambient Occlusion. Maps are composited per channel
  on 1024² canvases (`pbr.js`). Roughness/Metallic also have global
  constant sliders used wherever no map is loaded (the "value instead of a
  texture" path). Upper and lower regions additionally accept **stacked
  clothing layers** — each layer is its own five-map set, masked by its
  albedo alpha and composited over the skin; layers can be reordered, hidden,
  and removed. A neutral studio environment (`RoomEnvironment`) lights the
  metals. `aoMap` reuses the primary UVs (copied into `uv1` at load).
- **Play mode** — the Play tab drives the avatar with the keyboard,
  keyboard controls (WASD/arrows to walk and turn, Shift run, Space jump,
  F/Home toggle flight, E/C ascend/descend) with a third-person chase camera.
  It blends UAL1 walk / jog / idle / jump / swim-idle / crouch idle / crouch
  walk clips by state (`examples/studio/play.js`, `examples/common/locomotion.js`). Hold Shift to run;
  tap X or the Crouch button to toggle crouch when grounded (WASD moves while
  crouched).
- **Voice lip sync** — the Voice tab taps the microphone (Web Audio
  `AnalyserNode`), measures audio RMS per frame, and drives the `mFaceJaw`
  bone open/closed with an attack/release envelope (`voice.js`), with
  Sensitivity and Max-open controls and a live level meter.
- **Shape sliders** — the RC3 body is fitted mesh: it is weighted to the
  collision-volume bones (`BELLY`, `BUTT`, `CHEST`, `LEFT_PEC`, ...) that the
  appearance sliders drive. Each slider scales/offsets a set of bones (see
  `sliders.js`), the same mechanism used for fitted mesh bodies. Sliders
  work live during animation.
- **BVH animation** — pick a bundled clip or load any `.bvh` file. Joint names
  in both Poser style (`hip`, `abdomen`, `lShldr`, ... incl. bento fingers)
  and CMU/MotionBuilder style (`Hips`, `LeftArm`, ...) are retargeted onto the
  avatar skeleton (`bvh.js`).
- **BVH editor** — "Create BVH" (Animation tab) enters an authoring mode:
  joint markers on the skeleton (blue = FK rotate gizmo, green = two-bone IK
  drag for wrists/ankles, toggleable), a keyframe timeline at the bottom with
  scrubbing, retimable keys and looped preview, and Save BVH exports an
  Ruth-style `.bvh` (hip `Xpos Ypos Zpos Zrot Xrot Yrot`, joints `ZXY`, inches)
  that round-trips through the loader (`examples/studio/animEditor.js`).
- **MCP control** — controlling the avatar over [MCP](https://modelcontextprotocol.io)
  now lives in its own self-contained example, **`examples/mcp/`** (own
  `package.json` + server). An unauthenticated MCP server at `/mcp` forwards each
  tool call over a WebSocket to the open avatar page, which runs it and replies.
  Tools include `trigger_animation`, `get_avatar_transform`, `capture_screenshot`,
  `set_avatar_blink`, `set_avatar_look_at`, and `avatar_text_to_speech`. Every
  avatar-touching tool takes an optional **`avatar`** selector (0-based index or
  id); `list_avatars`, `select_avatar`, and `add_avatar` manage the set. See the
  Examples section above.
- **Multiple avatars** — the panel's top bar (`Avatars  1 2 … ＋ ✕`) spawns and
  removes avatars and switches which one is *active*. The whole panel (shape,
  materials, physics, blink, attachments, animation, play/editor) drives the
  active avatar; each avatar keeps its own state, and all of them animate at
  once. Backed by `avatarManager.js` over independent `Avatar` instances.

## Files

**Library (repo root)**

| file | role |
|---|---|
| `index.js` | **library entry point** — exports `Avatar` + supporting pieces |
| `Avatar.js` | the `Avatar` class: loads the rigged parts and composes every per-avatar capability |
| `avatarManager.js` | tracks the live avatars in a scene + which one is active |
| `sliders.js` | slider definitions → bone scale/offset adjustments |
| `bvh.js` | BVH loading + retargeting to the avatar skeleton |
| `gltfAnim.js` | glTF/GLB animation loading + retargeting (cached per file) |
| `physics.js` | pec/glute soft-body: jiggle spring + kinematic gravity sag |
| `pbr.js` | per-region PBR map stack: channel compositing + layers |
| `voice.js` | mic-driven lip sync (jaw open from audio RMS) |
| `speech.js` | TTS-clip lip sync (per-viseme mouth shaping) |
| `blink.js` | procedural eye blinking |
| `attachments.js` | props parented to bones (built-in + GLB) |
| `examples/common/locomotion.js` | app-level `Locomotion` helper: walk/run/turn/jump/flight + state machine (example content, not a library export) |
| `skeleton.js` | maps each bone to the part that owns it; rest read/reset helpers |

**Apps (`examples/`)**

| file | role |
|---|---|
| `examples/studio/` | the full lab UI — `index.html` + `main.js` (scene/UI wiring) + `animEditor.js` (BVH pose editor) + `play.js` (keyboard play mode) |
| `examples/simple/` | minimal standalone usage (CDN three + local avatar; bundles its own `playMode.js`) |
| `examples/mcp/` | self-contained MCP example: its own `package.json` + server, bridge, browser glue (`avatarApi.js`, `mcpClient.js`) |

**Assets**

| file | role |
|---|---|
| `models/*.glb` | avatar meshes — glTF conversions of the RuthAndRoth/Ruth Collada originals, still **AGPL-3.0** (derivative works); bundled with the library |
| `examples/common/registry.js` | demo animation manifest (`ANIMATION_REGISTRY`) shared by the examples — **not** part of the published library |
| `anims/pirouette.bvh` | test clip from the [three.js examples](https://github.com/mrdoob/three.js/blob/master/examples/models/bvh/pirouette.bvh) (Poser-style joint names) |
| `anims/UAL1_Standard.glb` | [Quaternius UAL1](https://quaternius.com/packs/ultimateanimatedcharacter.html) locomotion + action clips (CC0) |
| `anims/UAL2_Standard.glb` | [Quaternius UAL2](https://quaternius.com/packs/universalanimationlibrary2.html) extended action set (CC0) |

## Implementation notes

- The glTF part exports (converted from Ruth's Collada) keep the rig's Z-up,
  **pure-translation joints** (no bone roll). Their node transforms do *not*
  match the skin bind pose, so each skeleton's rest is recovered from the
  inverse-bind matrices after loading; the parts are exported Z-up, so the load
  also rotates each part −90°X to stand it up in three.js's Y-up world.
- Each part carries its own copy of (a subset of) the avatar skeleton. Rather
  than re-binding everything to one skeleton, all part skeletons are driven in
  sync by bone name (animation tracks are filtered per part).
- BVH rigs are Y-up facing +Z, arms on ±X (Poser convention); the avatar rig is
  Z-up facing +X, arms on ±Y. Retargeting conjugates every joint quaternion by
  that axis change (`Rz(90°)·Rx(90°)`) and rescales the hip translation from
  BVH units to meters using the pelvis rest height.
- The MCP server holds no scene state — the browser tab is the source of truth,
  and only one tab connects at a time. Bone rotations set via the MCP tools are
  written in bone-local space and synced by name across each part's copy
  of the skeleton (`syncBoneToAllParts` in `skeleton.js`), the same
  drive-by-name mechanism the animation playback uses.

## Licenses

This project's code and bundled `models/textures/` maps are **MIT** — see
[LICENSE.md](LICENSE.md). The bundled `models/*.glb` meshes are **AGPL-3.0**
(RuthAndRoth contributors) — they're glTF conversions of Ruth's original Collada
meshes and remain AGPL as derivative works. Bundled animations are **CC0**
(Quaternius UAL1/UAL2) or from
the **three.js** examples / **CMU mocap** (`pirouette.bvh`). See
[ASSET_LICENSES.md](ASSET_LICENSES.md) and [`licenses/`](licenses/) for
provenance and upstream license texts.

**Note on the npm `license` field.** `package.json` declares **`MIT`** — that
covers this project's own authored code and textures. The package *also* bundles
third-party assets under their own licenses (the AGPL Ruth meshes, plus
CC0 / three.js / CMU animation clips); those are documented per-file in
[ASSET_LICENSES.md](ASSET_LICENSES.md), with the full texts in
[`licenses/`](licenses/). In particular the **AGPL obligations attach only to the
bundled mesh files**, and only when you redistribute them — if you supply your
own avatar mesh, nothing in your use is AGPL-encumbered.
