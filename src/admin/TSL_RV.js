export class TSL_RV {
  constructor() {
    this._reference = null;
    this._locked = false;
    this._createdAt = null;
  }

  init(structure) {
    if (this._locked) {
      throw new Error("REFERENCE_ALREADY_INITIALIZED");
    }

    if (!structure || typeof structure !== "object") {
      throw new Error("INVALID_STRUCTURE");
    }

    this._reference = this._clone(structure);
    this._createdAt = Date.now();
    this._locked = true;

    return {
      ok: true,
      createdAt: this._createdAt
    };
  }

  get() {
    if (!this._locked) return null;
    return this._clone(this._reference);
  }

  isInitialized() {
    return this._locked;
  }

  meta() {
    return {
      initialized: this._locked,
      createdAt: this._createdAt
    };
  }

  reset(force = false) {
    if (!force) {
      throw new Error("RESET_REQUIRES_FORCE");
    }

    this._reference = null;
    this._locked = false;
    this._createdAt = null;
  }

  _clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }
}
