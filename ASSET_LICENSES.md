# Model licenses

This project bundles the Ruth2 avatar meshes from the
[RuthAndRoth](https://github.com/RuthAndRoth) open-source avatar project. The
bundled `models/*.glb` files are **format conversions** of Ruth's original
Collada (`.dae`) meshes — converting the file format does **not** change the
license: they remain **AGPL-3.0**, the same license as the original Ruth
project, and are derivative works of it. Upstream license texts are in
[`licenses/`](licenses/).

The library code (`*.js`) and all bundled textures in `models/textures/` are
licensed under [LICENSE.md](LICENSE.md) (MIT). The AGPL mesh obligations apply
to the bundled `.glb` mesh files (and anything you derive from them) when you
distribute them.

The Textures tab still accepts user-supplied maps via drop zones; anything
you add at runtime is your own responsibility.

## Bundled textures

All files under `models/textures/` are original to this project (not from the
Ruth `.dae` exports) and are covered by the project's [MIT license](LICENSE.md).

| Region / use | Files |
|---|---|
| Face (albedo + PBR) | `android_face.png`, `android_face_normal.jpg`, `android_face_roughness.jpg`, `android_face_metallic.jpg`, `android_face_ao.jpg` |
| Upper body (albedo + PBR) | `android_upper.png`, `android_upper_normal.jpg`, `android_upper_roughness.jpg`, `android_upper_metallic.jpg`, `android_upper_ao.jpg` |
| Lower body (albedo + PBR) | `android_lower.png`, `android_lower_normal.jpg`, `android_lower_roughness.jpg`, `android_lower_metallic.jpg`, `android_lower_ao.jpg` |
| Eyes (albedo) | `blue_eyes.png` |
| Optional clothing layers | `layers/cute_shirt.png`, `layers/cute_pants.png` |

## Bundled meshes

Each `.glb` below is a format conversion (via Blender) of the corresponding
original Ruth Collada `.dae`. They are derivative works of the AGPL-3.0 Ruth
meshes and stay under **AGPL-3.0** — converting the format changes nothing about
the license.

| File in this repo | Upstream source | License |
|---|---|---|
| `models/body.glb` | Ruth RC3 `Release3_BothLowerUpper_15.dae` (converted) | AGPL-3.0 |
| `models/hands.glb` | Ruth RC3 `Release3_Hands_15.dae` (converted) | AGPL-3.0 |
| `models/feet.glb` | Ruth RC3 `Release3_FlatFeet_15.dae` (converted) | AGPL-3.0 |
| `models/head.glb` | [Ruth2](https://github.com/RuthAndRoth/Ruth2) `Mesh/Ruth2_v4/DAE/Ruth2v4Head.dae` (converted) | AGPL-3.0 |
| `models/eyes.glb` | Ruth2 `Mesh/Ruth2_v4/DAE/Ruth2v4Eyeballs.dae` (converted) | AGPL-3.0 |

RC3 meshes are from the Ruth 2.0 RC#3 release
(`archive-ruth-rc3` branch of [RuthAndRoth/Ruth](https://github.com/RuthAndRoth/Ruth),
also packaged in Ruth2 `Mesh/Ruth2_v3/`). The v4 head and eyeballs are from
Ada Radius's Ruth2 v4 work in the Ruth2 repo; RC3 did not ship a head.

## Bundled animations

| File in this repo | Source | License |
|---|---|---|
| `anims/pirouette.bvh` | [three.js examples](https://github.com/mrdoob/three.js/blob/master/examples/models/bvh/pirouette.bvh) (CMU mocap conversion) | MIT (three.js) + [CMU mocap terms](https://mocap.cs.cmu.edu/) |
| `anims/UAL1_Standard.glb` | [Quaternius Ultimate Animated Character](https://quaternius.com/packs/ultimateanimatedcharacter.html) | [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/) |
| `anims/UAL2_Standard.glb` | [Quaternius Universal Animation Library 2](https://quaternius.com/packs/universalanimationlibrary2.html) | [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/) |

`pirouette.bvh` is copied from the three.js example assets (MIT-licensed
distribution of a BVH converted from the CMU Graphics Lab Motion Capture
Database). Play-mode locomotion and most bundled clips are retargeted from the
Quaternius UAL1 and UAL2 GLB libraries (CC0).

### pirouette.bvh

Bundled copy:
[`examples/models/bvh/pirouette.bvh`](https://github.com/mrdoob/three.js/blob/master/examples/models/bvh/pirouette.bvh)
in the [three.js](https://github.com/mrdoob/three.js) repo (MIT). The underlying
motion data is from the
[CMU Graphics Lab Motion Capture Database](https://mocap.cs.cmu.edu/) (research /
commercial use permitted; cite the database when publishing results).

### UAL1 animation bundle

The [Quaternius Ultimate Animated Character](https://quaternius.com/animviewer.html)
(UAC, file `UAL1_Standard.glb`) contains 45 glTF skeleton animations — idle,
walk, crouch, combat, swimming, sitting, and more — created by [@Quaternius](https://twitter.com/quaternius).
It is dedicated to the public domain under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).

### UAL2 animation bundle

The [Quaternius Universal Animation Library 2](https://quaternius.com/packs/universalanimationlibrary2.html)
(UAL2, file `UAL2_Standard.glb`) contains 130+ glTF skeleton animations —
melee combos, parkour, farming, zombie locomotion, and more — created by
[@Quaternius](https://twitter.com/quaternius). Also [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).

Consider supporting Quaternius on [Patreon](https://www.patreon.com/quaternius) or
joining the [Discord](https://discord.gg/vJqnRUYRfT).

## Mesh — AGPL-3.0

Ruth2 mesh body parts are licensed under the
[GNU Affero General Public License v3](licenses/AGPL-3.0.txt).

- **Ruth 2.0** — copyright 2018, Shin Ingen
- **Ruth2** — copyright 2018 Shin Ingen and 2020 Ada Radius

AGPL-covered parts in this project: upper/lower body, bento hands, flat feet,
v4 bento head, and v4 eyeball meshes — bundled here as `.glb` conversions of the
original Ruth `.dae`, still AGPL-3.0 as derivative works.

**AGPL summary:** you may use and modify these meshes freely. If you distribute
modified mesh data, or run a network service that exposes them, you must make
the corresponding source available under the same license.

Contributors to the upstream mesh work include (alphabetically): Ada Radius,
Ai Austin, Chimera Firecaster, Duck Girl, Elenia Boucher, Fred Beckhusen,
Fritigern Gothly, Joe Builder, Kayaker Magic, Lelani Carver, Leona Morro,
Linden Lab, Mike Dickson, Noxluna Nightfire, Sean Heavy, Serie Sumei,
Shin Ingen, Sundance Haiku, Taarna Welles, and other OpenSimulator community
members. See upstream `LICENSE.md` for the canonical list.

## Upstream references

- Ruth (archived RC3): https://github.com/RuthAndRoth/Ruth/tree/archive-ruth-rc3
- Ruth2: https://github.com/RuthAndRoth/Ruth2
- Ruth2 LICENSE: https://github.com/RuthAndRoth/Ruth2/blob/master/LICENSE.md
- three.js pirouette BVH: https://github.com/mrdoob/three.js/blob/master/examples/models/bvh/pirouette.bvh
- CMU Motion Capture Database: https://mocap.cs.cmu.edu/
- Quaternius UAL1: https://quaternius.com/packs/ultimateanimatedcharacter.html
- Quaternius UAL2: https://quaternius.com/packs/universalanimationlibrary2.html