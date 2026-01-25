// diginetz-api/src/store/TSL_ReferenceStore.js
// ----------------------------------------------------
// TSL Reference Store
// Role: External immutable storage for structural references (S0)
// - Stateless engine compatibility
// - Reference-ID based access
// - No mutation after creation
// - In-memory (replaceable with Redis / DB)
// ----------------------------------------------------

import crypto from "crypto";

export class TSL_ReferenceStore {
  constructor(options = {}) {
    this._store = new Map();

    this.config = {
      ttlMs: options.ttlMs ?? 1000 * 60 * 60, // 1 hour default
      maxEntries: options.maxEntries ?? 10_000
    };
  }

  /* ===================================================
     CREATE — Save new reference (immutable)
     =================================================== */

  save(structure) {
    if (!structure || typeof structure !== "object") {
      throw new Error("INVALID_STRUCTURE");
    }

    this.#cleanupIfNeeded();

    const id = this.#generateId(structure);

    if (this._store.has(id)) {
      // Reference already exists → reuse
      return {
        referenceId: id,
        reused: true
      };
    }

    this._store.set(id, {
      structure: this.#clone(structure),
      createdAt: Date.now()
    });

    return {
      referenceId: id,
      reused: false
    };
  }

  /* ===================================================
     READ — Load reference by ID
     =================================================== */

  load(referenceId) {
    if (!referenceId || typeof referenceId !== "string") {
      throw new Error("INVALID_REFERENCE_ID");
    }

    const entry = this._store.get(referenceId);

    if (!entry) {
      throw new Error("REFERENCE_NOT_FOUND");
    }

    if (this.#isExpired(entry)) {
      this._store.delete(referenceId);
      throw new Error("REFERENCE_EXPIRED");
    }

    return this.#clone(entry.structure);
  }

  /* ===================================================
     CHECK — Existence
     =================================================== */

  exists(referenceId) {
    return this._store.has(referenceId);
  }

  /* ===================================================
     DELETE — Explicit cleanup (optional)
     =================================================== */

  delete(referenceId) {
    return this._store.delete(referenceId);
  }

  /* ===================================================
     INTERNALS
     =================================================== */

  #generateId(structure) {
    const hash = crypto
      .createHash("sha256")
      .update(JSON.stringify(structure))
      .digest("hex");

    return `tsl_ref_${hash.slice(0, 24)}`;
  }

  #clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  #isExpired(entry) {
    return Date.now() - entry.createdAt > this.config.ttlMs;
  }

  #cleanupIfNeeded() {
    if (this._store.size < this.config.maxEntries) return;

    const now = Date.now();

    for (const [id, entry] of this._store) {
      if (now - entry.createdAt > this.config.ttlMs) {
        this._store.delete(id);
      }
    }
  }
}
