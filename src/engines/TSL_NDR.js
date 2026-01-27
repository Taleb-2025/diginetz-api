// diginetz-api/src/engines/TSL_NDR.js

export class TSL_NDR {
  constructor(options = {}) {
    this.minLength = options.minLength ?? 2;
  }

  extract(input) {
    if (!Array.isArray(input)) {
      throw new Error("TSL_NDR: input must be number[]");
    }

    if (input.length < this.minLength) {
      throw new Error("TSL_NDR: insufficient data length");
    }

    for (const v of input) {
      if (typeof v !== "number" || Number.isNaN(v)) {
        throw new Error("TSL_NDR: invalid numeric input");
      }
    }

    const length = input.length;
    const order = this.#deriveOrder(input);
    const continuity = this.#deriveContinuity(order);
    const boundaries = this.#deriveBoundaries(order);

    const fingerprint = this.#fingerprint({
      length,
      order,
      continuity,
      boundaries
    });

    return {
      engine: "TSL_NDR",
      length,
      order,
      continuity,
      boundaries,
      fingerprint
    };
  }

  #deriveOrder(arr) {
    const rel = [];
    for (let i = 1; i < arr.length; i++) {
      if (arr[i] > arr[i - 1]) rel.push("+");
      else if (arr[i] < arr[i - 1]) rel.push("-");
      else rel.push("=");
    }
    return rel;
  }

  #deriveContinuity(order) {
    if (order.length === 0) return [];

    const runs = [];
    let current = order[0];
    let count = 1;

    for (let i = 1; i < order.length; i++) {
      if (order[i] === current) {
        count++;
      } else {
        runs.push({ dir: current, len: count });
        current = order[i];
        count = 1;
      }
    }

    runs.push({ dir: current, len: count });
    return runs;
  }

  #deriveBoundaries(order) {
    if (order.length === 0) {
      return { start: null, end: null };
    }

    return {
      start: order[0],
      end: order[order.length - 1]
    };
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
      keys.map(k => `${k}:${this.#stableStringify(obj[k])}`).join(",") +
      "}"
    );
  }
}
