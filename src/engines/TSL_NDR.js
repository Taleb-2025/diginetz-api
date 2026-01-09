// TSL_NDR.js
// Noise-Driven Structural Representation Engine
// Core / Stateless / Deterministic

export class TSL_NDR {
  constructor(options = {}) {
    this.depthLimit = options.depthLimit ?? 32;
    this.normalizeNumbers = options.normalizeNumbers ?? true;
    this.ignoreKeys = new Set(options.ignoreKeys ?? []);
  }

  extract(input) {
    const structure = this.#walk(input, 0);

    return {
      engine: "TSL_NDR",
      version: "1.0.0",
      fingerprint: this.#fingerprint(structure),
      structure
    };
  }

  /* ================= INTERNAL ================= */

  #walk(value, depth) {
    if (depth > this.depthLimit) return "[DEPTH_LIMIT]";

    if (value === null) return "null";
    if (value === undefined) return "undefined";

    const t = typeof value;

    if (t === "number") {
      return this.normalizeNumbers ? "number" : value;
    }

    if (t === "string") return "string";
    if (t === "boolean") return "boolean";
    if (t === "function") return "function";

    if (Array.isArray(value)) {
      return value.map(v => this.#walk(v, depth + 1));
    }

    if (t === "object") {
      const out = {};
      const keys = Object.keys(value)
        .filter(k => !this.ignoreKeys.has(k))
        .sort();

      for (const k of keys) {
        out[k] = this.#walk(value[k], depth + 1);
      }
      return out;
    }

    return "unknown";
  }

  #fingerprint(structure) {
    const str = JSON.stringify(structure);
    let h = 2166136261;

    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
    }

    return (h >>> 0).toString(16);
  }
}
