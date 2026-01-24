// diginetz-api/src/state/TSL_RV.js
// ----------------------------------------------------
// TSL_RV — Reference Vault
// Role: Store & serve structural reference (S0)
// No policy, no decisions
// ----------------------------------------------------

export class TSL_RV {
  constructor() {
    this._reference = null;
    this._createdAt = null;
  }

  /* ===============================
     INIT
     =============================== */

  init(structure) {
    if (!structure || typeof structure !== "object") {
      return {
        ok: false,
        reason: "INVALID_STRUCTURE"
      };
    }

    this._reference = this._clone(structure);
    this._createdAt = Date.now();

    return {
      ok: true,
      createdAt: this._createdAt
    };
  }

  /* ===============================
     GET
     =============================== */

  get() {
    if (!this._reference) return null;
    return this._clone(this._reference);
  }

  /* ===============================
     STATE
     =============================== */

  isInitialized() {
    return !!this._reference;
  }

  meta() {
    return {
      initialized: this.isInitialized(),
      createdAt: this._createdAt
    };
  }

  /* ===============================
     RESET (SAFE & IDENTITY)
     =============================== */

  reset() {
    this._reference = null;
    this._createdAt = null;

    return {
      ok: true,
      state: "CLEARED"
    };
  }

  /* ===============================
     INTERNAL
     =============================== */

  _clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }
}
