# Simple example

The smallest way to put a **metaverse-avatar** into a three.js scene and walk it
around. One HTML file, no build step.

## Run

Serve the repo root with any static file server and open the example:

```sh
# from the repo root
python3 -m http.server 8413
# then open http://localhost:8413/examples/simple/
```

(ES modules need `http://`, not `file://`.)

## Files

- **`index.html`** — the scene + the avatar. The only library import is `Avatar`.
- **`playMode.js`** — a self-contained keyboard + chase-camera controller, copied
  into the example so it has no dependency on the repo's internal app code. Copy
  it into your own project and adapt it.

## How it works

`index.html` is mostly ordinary three.js scene boilerplate (renderer, camera,
lights, ground). The avatar-specific part is tiny:

```js
import { Avatar } from '../../index.js';

// 1. Build + load. load(basePath) fetches the meshes/textures; returns `this`.
const avatar = await new Avatar().load('../../models/');
avatar.group.rotation.y = -Math.PI / 2; // the rig faces +X; turn it toward +Z

// 2. Add its single root group to your scene.
scene.add(avatar.group);

// 3. (optional) turn on idle behaviours.
avatar.setBlinking(true);

// 4. Advance it once per frame — this drives pose, physics, blinking,
//    lip-sync, and eye look-at all at once.
renderer.setAnimationLoop(() => {
  avatar.update(clock.getDelta());
  renderer.render(scene, camera);
});
```

That's the entire contract: **`new Avatar()` → `await load()` → add `.group` to
the scene → call `.update(dt)` every frame.**

## Driving it around (keyboard + chase camera)

Moving an avatar through the world isn't part of `Avatar` — that's a game's job.
This example includes a small controller, **`playMode.js`**, that maps the
keyboard to movement and follows the body with a third-person camera. It lives in
the example (not the library), so you can read it, copy it, and change it:

```js
import { PlayMode } from './playMode.js';

const play = new PlayMode({ avatar, camera, controls });
await play.enter();

// in the loop, after avatar.update(dt):
play.update(dt);
```

`playMode.js` translates/rotates `avatar.group` and cross-fades the bundled
locomotion clips via the avatar's animation methods (`crossFadeTo`, `setSpeed`).
The only thing it borrows from the library besides the avatar is the glTF clip
loader used to fetch those animations.

| key | action |
|---|---|
| `W A S D` | move / turn |
| `Shift` | run (hold) |
| `F` | toggle flight (`E`/`C` up/down) |
| `Space` | jump |
| `X` | sit / stand |
| mouse drag | orbit the camera |

If you don't want this, skip `PlayMode` entirely and move the avatar yourself by
setting `avatar.group.position` / `.rotation` and playing clips with
`avatar.playClip()` / `avatar.crossFadeTo()`.

## three.js is a peer dependency

The page loads three.js from a CDN through an **import map**:

```html
<script type="importmap">
{ "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.184.0/build/three.module.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.184.0/examples/jsm/"
} }
</script>
```

The avatar library imports `three` by that bare name, so it shares the one three
instance your app already provides (CDN here, or your bundler's copy). It does
**not** ship its own three.

## Where to go next

- Full API at a glance: the repo [`README.md`](../../README.md) → *Use as a
  library — the `Avatar` class*.
- Controlling an avatar over MCP from an AI agent: [`../mcp/`](../mcp/).
