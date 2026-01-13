// TSL_NDR.js
// Noise-Driven Structural Representation Engine
// Core / Stateless / Deterministic / Cache-Safe

export class TSL_NDR {
  constructor(options = {}) {
    this.depthLimit = options.depthLimit ?? 32;
    this.normalizeNumbers = options.normalizeNumbers ?? true;
    this.ignoreKeys = new Set(options.ignoreKeys ?? []);
    this.enableCache = options.enableCache ?? true;
    this.cache = new Map();
    this.cacheLimit = options.cacheLimit ?? 1000;
  }

  extract(input) {
    const seen = new WeakSet();
    const structure = this.#walk(input, 0, seen);

    const fingerprint = this.#fingerprint(structure);

    if (this.enableCache && this.cache.has(fingerprint)) {
      return this.cache.get(fingerprint);
    }

    const result = {
      engine: "TSL_NDR",
      version: "1.2.0",
      fingerprint,
      structure
    };

    if (this.enableCache) {
      this.#cacheSet(fingerprint, result);
    }

    return result;
  }

  /* ================= INTERNAL ================= */

  #walk(value, depth, seen) {
    if (depth > this.depthLimit) return "[DEPTH_LIMIT]";

    if (value === null) return "null";
    if (value === undefined) return "undefined";

    if (typeof value === "object") {
      if (seen.has(value)) return "[CIRCULAR]";
      seen.add(value);
    }

    if (Number.isNaN(value)) return "nan";
    if (value === Infinity) return "infinity";

    const t = typeof value;

    if (t === "number") {
      return this.normalizeNumbers ? "number" : value;
    }

    if (t === "string") return "string";
    if (t === "boolean") return "boolean";
    if (t === "bigint") return "bigint";
    if (t === "symbol") return "symbol";
    if (t === "function") return "function";

    if (value instanceof Date) return "date";

    if (ArrayBuffer.isView(value)) {
      return { type: "buffer", length: value.length };
    }

    if (Array.isArray(value)) {
      return value.map(v => this.#walk(v, depth + 1, seen));
    }

    if (t === "object") {
      const out = {};
      const keys = Object.keys(value)
        .filter(k => !this.ignoreKeys.has(k))
        .sort();

      for (const k of keys) {
        out[k] = this.#walk(value[k], depth + 1, seen);
      }
      return out;
    }

    return "unknown";
  }

  #fingerprint(structure) {
    const stable = this.#stableStringify(structure);
    let h = 2166136261;

    for (let i = 0; i < stable.length; i++) {
      h ^= stable.charCodeAt(i);
      h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
    }

    return (h >>> 0).toString(16);
  }

  #stableStringify(obj) {
    if (obj === null || typeof obj !== "object") {
      return String(obj);
    }

    if (Array.isArray(obj)) {
      return "[" + obj.map(v => this.#stableStringify(v)).join(",") + "]";
    }

    const keys = Object.keys(obj).sort();
    return (
      "{" +
      keys.map(k => k + ":" + this.#stableStringify(obj[k])).join(",") +
      "}"
    );
  }

  #cacheSet(key, value) {
    if (this.cache.size >= this.cacheLimit) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }
}
