import * as THREE from 'three/webgpu';

// Nipple protrusion morph — a localized vertex displacement on the body mesh.
//
// There is no nipple bone in the Ruth2 rig (the breast is skinned to the
// LEFT_PEC/RIGHT_PEC collision volumes), so the bone-driven shape sliders can't
// isolate the nipple — scaling a pec moves the whole breast. This drives the
// nipple directly in the rest geometry instead: it finds each nipple apex, then
// pushes a soft falloff region around it along the surface normal. The
// displacement lives in the mesh's REST positions, so skinning — body
// animation, breast_size, pec jiggle — all ride on top of it unchanged.
//
// Apex finding is self-calibrating (no baked coordinates): among the vertices
// skinned to each pec, the nipple tip is the most-forward one (the body faces
// -Y in mesh-local space), and the push direction is that tip's surface normal.

const PEC_BONES = { LEFT_PEC: 'L', RIGHT_PEC: 'R' };
const WEIGHT_MIN = 0.3;     // min pec skin-weight for a vertex to count as breast
const NEIGHBORHOOD = 0.025; // m — radius the local-bump test smooths over
const CAP_RADIUS = 0.018;   // m — extent of the nipple "cap" used to centre the morph
const TIP_RADIUS = 0.004;   // m — TIGHT radius the push direction is averaged over
const FALLOFF_RADIUS = 0.024; // m — region displaced around the nipple centre
const MAX_DISPLACE = 0.012; // m — tip displacement at |amount| = 1

const smoothstep = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

// Precompute the morph for one body SkinnedMesh. Returns null if the mesh has no
// pec-weighted geometry (e.g. a different rig). Snapshots the rest positions and
// normals of the affected vertices so the morph is idempotent and amount 0
// restores the mesh exactly.
export function buildNippleMorph(skinnedMesh) {
  const geo = skinnedMesh.geometry;
  const pos = geo.getAttribute('position');
  const si = geo.getAttribute('skinIndex');
  const sw = geo.getAttribute('skinWeight');
  const nrm = geo.getAttribute('normal');
  if (!pos || !si || !sw || !nrm) return null;

  const bones = skinnedMesh.skeleton.bones;
  const pecIndex = {}; // bone array index -> 'L' | 'R'
  bones.forEach((b, i) => { if (PEC_BONES[b.name]) pecIndex[i] = PEC_BONES[b.name]; });
  if (!Object.values(pecIndex).includes('L') || !Object.values(pecIndex).includes('R')) return null;

  // Combined pec weight per vertex, split by dominant side.
  const sideVerts = { L: [], R: [] };
  for (let v = 0; v < pos.count; v++) {
    let wL = 0, wR = 0;
    for (let k = 0; k < 4; k++) {
      const side = pecIndex[si.getComponent(v, k)];
      if (side === 'L') wL += sw.getComponent(v, k);
      else if (side === 'R') wR += sw.getComponent(v, k);
    }
    if (wL > WEIGHT_MIN && wL >= wR) sideVerts.L.push(v);
    else if (wR > WEIGHT_MIN) sideVerts.R.push(v);
  }

  const affected = []; // { i, ox,oy,oz, ux,uy,uz }  unit displacement at amount=1
  const tmp = new THREE.Vector3();
  for (const side of ['L', 'R']) {
    const list = sideVerts[side];
    if (!list.length) continue;

    // Local protrusion per vertex: how far it sticks out past its own
    // neighborhood along its normal. The nipple is the local bump (not the
    // breast's overall front-most point); `seed` is its single strongest point.
    const prot = new Map();
    let seed = -1, maxProt = -Infinity;
    for (const v of list) {
      const x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v);
      let cx = 0, cy = 0, cz = 0, c = 0;
      for (const u of list) {
        const dx = pos.getX(u) - x, dy = pos.getY(u) - y, dz = pos.getZ(u) - z;
        if (dx * dx + dy * dy + dz * dz < NEIGHBORHOOD * NEIGHBORHOOD) {
          cx += pos.getX(u); cy += pos.getY(u); cz += pos.getZ(u); c++;
        }
      }
      if (c < 6) continue;
      const p = (x - cx / c) * nrm.getX(v) + (y - cy / c) * nrm.getY(v) + (z - cz / c) * nrm.getZ(v);
      prot.set(v, p);
      if (p > maxProt) { maxProt = p; seed = v; }
    }
    if (seed < 0) continue;
    const sx = pos.getX(seed), sy = pos.getY(seed), sz = pos.getZ(seed);

    // Centre the morph on the protrusion-weighted centroid of the bump cap, not
    // on `seed`. The single steepest vertex sits off-centre (low on the nipple),
    // which made the morph push from the lower edge.
    let cx = 0, cy = 0, cz = 0, cw = 0;
    for (const [v, p] of prot) {
      if (p < 0.5 * maxProt) continue;
      const dx = pos.getX(v) - sx, dy = pos.getY(v) - sy, dz = pos.getZ(v) - sz;
      if (dx * dx + dy * dy + dz * dz > CAP_RADIUS * CAP_RADIUS) continue;
      cx += pos.getX(v) * p; cy += pos.getY(v) * p; cz += pos.getZ(v) * p; cw += p;
    }
    const ax = cw ? cx / cw : sx, ay = cw ? cy / cw : sy, az = cw ? cz / cw : sz;

    // Push direction = surface normal at the bump's most-forward point (`seed`),
    // averaged over a TIGHT radius. A wide average picks up the surrounding
    // breast curvature and tilts the push up/sideways instead of straight out.
    const dir = new THREE.Vector3();
    for (const v of list) {
      const dx = pos.getX(v) - sx, dy = pos.getY(v) - sy, dz = pos.getZ(v) - sz;
      if (dx * dx + dy * dy + dz * dz < TIP_RADIUS * TIP_RADIUS) {
        dir.add(tmp.set(nrm.getX(v), nrm.getY(v), nrm.getZ(v)));
      }
    }
    if (dir.lengthSq() < 1e-6) dir.set(nrm.getX(seed), nrm.getY(seed), nrm.getZ(seed));
    dir.normalize();

    // Soft falloff region around the nipple centre.
    for (const v of list) {
      const dx = pos.getX(v) - ax, dy = pos.getY(v) - ay, dz = pos.getZ(v) - az;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d >= FALLOFF_RADIUS) continue;
      const w = smoothstep(1 - d / FALLOFF_RADIUS) * MAX_DISPLACE;
      affected.push({
        i: v,
        ox: pos.getX(v), oy: pos.getY(v), oz: pos.getZ(v),
        ux: dir.x * w, uy: dir.y * w, uz: dir.z * w,
      });
    }
  }
  if (!affected.length || !nrm) return null;

  // Localized smooth-normal recompute support. A global computeVertexNormals()
  // would flatten the whole surface (per-face normals → faceting on a non-indexed
  // mesh). Instead we re-light ONLY the displaced region: weld vertices by
  // position so duplicate verts at a UV/normal seam still average to a smooth
  // normal, and gather just the triangles touching the region so the rest of the
  // body keeps its imported normals untouched. Triangles come from the index
  // buffer when the geometry is indexed (the .glb parts), else consecutive triples.
  const weldId = buildWeldMap(pos);             // vertex -> canonical (first) vertex at its position
  const affectedKeys = new Set(affected.map((a) => weldId[a.i]));
  const index = geo.getIndex();
  const triCount = (index ? index.count : pos.count) / 3;
  const corner = index ? (k) => index.getX(k) : (k) => k;
  const localTris = [];                          // flat [a,b,c, a,b,c, ...] vertex indices
  for (let t = 0; t < triCount; t++) {
    const a = corner(3 * t), b = corner(3 * t + 1), c = corner(3 * t + 2);
    if (affectedKeys.has(weldId[a]) || affectedKeys.has(weldId[b]) || affectedKeys.has(weldId[c])) {
      localTris.push(a, b, c);
    }
  }

  return {
    geometry: geo,
    affected,
    baseNormals: nrm.array.slice(), // restore on amount 0
    weldId,
    localTris: Int32Array.from(localTris),
    _amount: 0,
  };
}

// Canonical-vertex map for welding: weldId[v] is the index of the first vertex
// sharing v's position, so verts split at a UV/normal seam still share a normal.
function buildWeldMap(pos) {
  const weldId = new Int32Array(pos.count);
  const seen = new Map();
  const Q = 1e5; // quantize to 1e-5 m
  for (let v = 0; v < pos.count; v++) {
    const key = `${Math.round(pos.getX(v) * Q)},${Math.round(pos.getY(v) * Q)},${Math.round(pos.getZ(v) * Q)}`;
    let id = seen.get(key);
    if (id === undefined) { id = v; seen.set(key, v); }
    weldId[v] = id;
  }
  return weldId;
}

// Displace the nipple region by `amount` (the slider value, typically [-1.5, 1.5];
// + extends the nipple forward, - pulls it in/flattens). Idempotent.
export function applyNippleMorph(morph, amount) {
  if (!morph) return;
  amount = amount || 0;
  if (amount === morph._amount) return;
  morph._amount = amount;

  const pos = morph.geometry.getAttribute('position');
  const nrm = morph.geometry.getAttribute('normal');
  for (const a of morph.affected) {
    pos.setXYZ(a.i, a.ox + a.ux * amount, a.oy + a.uy * amount, a.oz + a.uz * amount);
  }
  pos.needsUpdate = true;

  if (amount === 0) {
    nrm.array.set(morph.baseNormals); // exact restore at rest
  } else {
    recomputeRegionNormals(morph, pos, nrm);
  }
  nrm.needsUpdate = true;
  morph.geometry.computeBoundingSphere();
}

// Recompute area-weighted smooth normals for the morph region only, welding by
// position, then write them back to the affected verts (and their duplicates).
function recomputeRegionNormals(morph, pos, nrm) {
  const { weldId, localTris } = morph;
  const acc = new Map(); // weldId -> [nx, ny, nz]
  const add = (id, x, y, z) => {
    const s = acc.get(id);
    if (s) { s[0] += x; s[1] += y; s[2] += z; } else { acc.set(id, [x, y, z]); }
  };
  for (let i = 0; i < localTris.length; i += 3) {
    const a = localTris[i], b = localTris[i + 1], c = localTris[i + 2];
    const ax = pos.getX(a), ay = pos.getY(a), az = pos.getZ(a);
    const e1x = pos.getX(b) - ax, e1y = pos.getY(b) - ay, e1z = pos.getZ(b) - az;
    const e2x = pos.getX(c) - ax, e2y = pos.getY(c) - ay, e2z = pos.getZ(c) - az;
    // cross(e1, e2) — area-weighted face normal (not normalized).
    const fx = e1y * e2z - e1z * e2y, fy = e1z * e2x - e1x * e2z, fz = e1x * e2y - e1y * e2x;
    add(weldId[a], fx, fy, fz); add(weldId[b], fx, fy, fz); add(weldId[c], fx, fy, fz);
  }
  for (const a of morph.affected) {
    const s = acc.get(weldId[a.i]);
    if (!s) continue;
    const len = Math.hypot(s[0], s[1], s[2]) || 1;
    nrm.setXYZ(a.i, s[0] / len, s[1] / len, s[2] / len);
  }
}
