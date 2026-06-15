import * as THREE from 'three';

// PBR material stack for one avatar texture region.
//
// A region's final material is composited from a stack of "map sets":
//
//   [ skin , clothingLayer0 , clothingLayer1 , ... ]
//
// where each map set carries up to five channel images:
//
//   albedo (base color) · normal · roughness · metallic · ambient occlusion
//
// Each channel is composited onto its own 1024² canvas backing a
// CanvasTexture, and those textures are wired into a single
// MeshStandardMaterial (map / normalMap / roughnessMap / metalnessMap /
// aoMap). The skin set covers the whole region; every clothing layer is
// masked by its own albedo alpha so a garment only paints where it exists.
//
// Roughness and metalness also have a global scalar (the material's
// `roughness` / `metalness`): when a region has no map for that channel the
// scalar is the constant value, and when a map is present the map drives it.
// That is the "set a value instead of a texture" path.
//
// Channels are allocated lazily — a region with only an albedo skin costs
// one canvas, not five.

export const PBR_CHANNELS = [
  { key: 'albedo', label: 'Base Color', short: 'Alb', slot: 'map', srgb: true },
  { key: 'normal', label: 'Normal', short: 'Nrm', slot: 'normalMap', srgb: false },
  { key: 'roughness', label: 'Roughness', short: 'Rgh', slot: 'roughnessMap', srgb: false, scalar: 'roughness' },
  { key: 'metallic', label: 'Metallic', short: 'Met', slot: 'metalnessMap', srgb: false, scalar: 'metalness' },
  { key: 'ao', label: 'Ambient Occ.', short: 'AO', slot: 'aoMap', srgb: false },
];
const CH = Object.fromEntries(PBR_CHANNELS.map((c) => [c.key, c]));

// Per-channel default fill when no image covers a pixel. Albedo falls back
// to the region base color (set per stack); normals to flat; roughness/AO to
// white (so the scalar dominates); metallic to black (non-metal).
const DEFAULT_FILL = {
  normal: '#8080ff',
  roughness: '#ffffff',
  metallic: '#000000',
  ao: '#ffffff',
};

export function emptyMapSet() {
  return { albedo: null, normal: null, roughness: null, metallic: null, ao: null };
}

const hex = (n) => '#' + n.toString(16).padStart(6, '0');

export class PBRMaterialStack {
  constructor({ size = 1024, layered = false, baseColor = 0xffffff, roughness = 0.6, metalness = 0.0 } = {}) {
    this.size = size;
    this.layered = layered;
    this.baseColor = baseColor;
    this.globalRoughness = roughness;
    this.globalMetalness = metalness;

    this.skin = emptyMapSet();
    this.layers = []; // { maps, visible, name }
    this._channels = {}; // key -> { canvas, ctx, texture }
    this._scratch = null;

    this.material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness,
      metalness,
      side: THREE.DoubleSide,
    });

    this.recompositeAll();
  }

  // ---- map set editing ----

  setSkinMap(channel, img) {
    this.skin[channel] = img ?? null;
    this.recompositeChannel(channel);
    if (channel === 'albedo') this.recompositeChannel('albedo');
  }

  addLayer(name) {
    const i = this.layers.length;
    this.layers.push({ maps: emptyMapSet(), visible: true, name: name ?? `Layer ${i + 1}` });
    return i;
  }

  removeLayer(i) {
    if (i < 0 || i >= this.layers.length) return;
    this.layers.splice(i, 1);
    this.recompositeAll();
  }

  moveLayer(i, dir) {
    const j = i + dir;
    if (i < 0 || i >= this.layers.length || j < 0 || j >= this.layers.length) return;
    [this.layers[i], this.layers[j]] = [this.layers[j], this.layers[i]];
    this.recompositeAll();
  }

  setLayerMap(i, channel, img) {
    const layer = this.layers[i];
    if (!layer) return;
    layer.maps[channel] = img ?? null;
    // The albedo alpha is every channel's coverage mask, so changing it
    // re-masks the whole layer.
    if (channel === 'albedo') this.recompositeAll();
    else this.recompositeChannel(channel);
  }

  setLayerVisible(i, visible) {
    const layer = this.layers[i];
    if (!layer) return;
    layer.visible = visible;
    this.recompositeAll();
  }

  setGlobalRoughness(v) {
    this.globalRoughness = v;
    if (!this.material.roughnessMap) this.material.roughness = v;
  }

  setGlobalMetalness(v) {
    this.globalMetalness = v;
    if (!this.material.metalnessMap) this.material.metalness = v;
  }

  // ---- compositing ----

  recompositeAll() {
    for (const c of PBR_CHANNELS) this.recompositeChannel(c.key);
  }

  recompositeChannel(key) {
    const ch = CH[key];
    const sets = [this.skin, ...this.layers.filter((l) => l.visible).map((l) => l.maps)];
    const anyImage = sets.some((s) => s[key]);

    // Albedo always exists (region base color); other channels drop their map
    // and fall back to the scalar when nothing provides them.
    if (key !== 'albedo' && !anyImage) {
      this._setChannelTexture(ch, null);
      return;
    }

    const { ctx, texture } = this._ensureChannel(key);
    ctx.globalCompositeOperation = 'source-over';
    if (key === 'albedo') {
      ctx.clearRect(0, 0, this.size, this.size);
      ctx.fillStyle = hex(this.baseColor);
      ctx.fillRect(0, 0, this.size, this.size);
    } else {
      ctx.fillStyle = DEFAULT_FILL[key];
      ctx.fillRect(0, 0, this.size, this.size);
    }

    // Skin covers the entire region.
    if (this.skin[key]) this._cover(ctx, this.skin[key]);

    // Each clothing layer is masked to its own albedo footprint.
    for (const layer of this.layers) {
      if (!layer.visible) continue;
      const img = layer.maps[key];
      if (!img) continue;
      const mask = layer.maps.albedo;
      if (mask && mask !== img) this._maskedDraw(ctx, img, mask);
      else this._cover(ctx, img);
    }

    texture.needsUpdate = true;
    this._setChannelTexture(ch, texture);
  }

  // ---- internals ----

  _ensureChannel(key) {
    if (this._channels[key]) return this._channels[key];
    const ch = CH[key];
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = this.size;
    const ctx = canvas.getContext('2d');
    const texture = new THREE.CanvasTexture(canvas);
    // glTF UV convention: texture origin is top-left, so don't flip vertically
    // (the avatar loads glTF meshes, whose UVs already use that convention).
    texture.flipY = false;
    texture.colorSpace = ch.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.anisotropy = 4;
    this._channels[key] = { canvas, ctx, texture };
    return this._channels[key];
  }

  _setChannelTexture(ch, texture) {
    const had = this.material[ch.slot];
    this.material[ch.slot] = texture || null;
    if (ch.scalar) {
      // Map present → map is authoritative (scalar 1); absent → scalar value.
      const fallback = ch.scalar === 'roughness' ? this.globalRoughness : this.globalMetalness;
      this.material[ch.scalar] = texture ? 1.0 : fallback;
    }
    if (!!had !== !!texture) this.material.needsUpdate = true; // toggling a map recompiles
  }

  _cover(ctx, img) {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    ctx.drawImage(img, 0, 0, w, h, 0, 0, this.size, this.size);
  }

  _maskedDraw(ctx, img, mask) {
    if (!this._scratch) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = this.size;
      this._scratch = { canvas, ctx: canvas.getContext('2d') };
    }
    const s = this._scratch.ctx;
    s.globalCompositeOperation = 'source-over';
    s.clearRect(0, 0, this.size, this.size);
    this._cover(s, img);
    s.globalCompositeOperation = 'destination-in'; // keep img only where mask is opaque
    this._cover(s, mask);
    s.globalCompositeOperation = 'source-over';
    ctx.drawImage(this._scratch.canvas, 0, 0);
  }
}
