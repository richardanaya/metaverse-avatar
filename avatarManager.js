import * as THREE from 'three/webgpu';
import { Avatar } from './Avatar.js';

// Owns the set of live avatars in a scene and which one is "active" (the one
// the UI panel and the editor/play tools currently drive). Each entry pairs an
// Avatar with its scene-graph extras (skeleton helpers) and a bag of UI-only
// state that isn't stored on the avatar itself (slider positions, sex preset,
// the Animate-tab layer selection). Everything else — physics, blink, voice,
// materials, attachments — already lives on the avatar, so switching avatars
// just repoints the UI at a different instance.
export class AvatarManager {
  constructor({ scene, basePath, makeUiState }) {
    if (typeof basePath !== 'string' || !basePath) {
      throw new Error('AvatarManager({ basePath }): basePath is required (passed through to Avatar.load).');
    }
    this.scene = scene;
    this.basePath = basePath;
    this._makeUiState = makeUiState ?? (() => ({}));
    this.entries = []; // { id, avatar, helpers, ui }
    this.activeIndex = -1;
    this._nextId = 1;
    this._skeletonsVisible = false;
  }

  get active() { return this.entries[this.activeIndex]?.avatar ?? null; }
  get activeEntry() { return this.entries[this.activeIndex] ?? null; }
  get count() { return this.entries.length; }

  // Take ownership of an already-loaded avatar (the first one the app builds).
  adopt(avatar, { select = true } = {}) {
    const entry = this._mkEntry(avatar);
    this.entries.push(entry);
    if (select || this.activeIndex < 0) this.activeIndex = this.entries.length - 1;
    return entry;
  }

  // Build, load, place, and register a new avatar. Avatars fan out along X so
  // they don't overlap unless an explicit position is given.
  async add({ position } = {}) {
    const avatar = new Avatar();
    await avatar.load(this.basePath);
    avatar.group.rotation.y = -Math.PI / 2; // face +Z like the first one
    const i = this.entries.length;
    const fanX = (i % 2 === 1 ? 1 : -1) * Math.ceil(i / 2) * 1.2;
    avatar.group.position.set(position?.x ?? fanX, 0, position?.z ?? 0);
    const entry = this._mkEntry(avatar);
    this.entries.push(entry);
    return entry;
  }

  _mkEntry(avatar) {
    const helpers = [];
    for (const part of Object.values(avatar.parts)) {
      const h = new THREE.SkeletonHelper(part.root);
      h.visible = this._skeletonsVisible;
      this.scene.add(h);
      helpers.push(h);
    }
    this.scene.add(avatar.group);
    return { id: this._nextId++, avatar, helpers, ui: this._makeUiState() };
  }

  indexOf(entryOrAvatar) {
    return this.entries.findIndex((e) => e === entryOrAvatar || e.avatar === entryOrAvatar);
  }

  // Resolve a selector (undefined → active, number → index, string → index or
  // matching id) to { entry, index }. Throws on an out-of-range selector.
  resolve(selector) {
    if (selector === undefined || selector === null) {
      return { entry: this.activeEntry, index: this.activeIndex };
    }
    let index = -1;
    if (typeof selector === 'number') index = selector;
    else if (typeof selector === 'string') {
      const byId = this.entries.findIndex((e) => String(e.id) === selector);
      index = byId >= 0 ? byId : Number.parseInt(selector, 10);
    }
    if (!Number.isInteger(index) || index < 0 || index >= this.entries.length) {
      throw new Error(`no such avatar: ${selector} (have ${this.entries.length})`);
    }
    return { entry: this.entries[index], index };
  }

  remove(index) {
    if (this.entries.length <= 1) return false; // never drop the last one
    const entry = this.entries[index];
    if (!entry) return false;
    for (const h of entry.helpers) { this.scene.remove(h); h.dispose?.(); }
    entry.avatar.dispose();
    this.entries.splice(index, 1);
    if (this.activeIndex >= this.entries.length) this.activeIndex = this.entries.length - 1;
    else if (this.activeIndex > index) this.activeIndex -= 1;
    return true;
  }

  setActive(index) {
    if (index < 0 || index >= this.entries.length) return false;
    this.activeIndex = index;
    return true;
  }

  setSkeletonsVisible(on) {
    this._skeletonsVisible = on;
    for (const e of this.entries) for (const h of e.helpers) h.visible = on;
  }

  // Advance every avatar (active or not) so background avatars keep animating.
  update(dt) { for (const e of this.entries) e.avatar.update(dt); }
}
