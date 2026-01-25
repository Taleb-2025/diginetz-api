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
        throw new Error("TSL_NDR: all values must be valid numbers");
      }
    }

    const relations = this.#deriveRelations(input);
    const runs      = this.#deriveRuns(relations);
    const topology  = this.#deriveTopology(relations);
    const pattern   = this.#derivePattern(relations);
    const symmetry  = this.#deriveSymmetry(relations);
    const identity  = this.#deriveIdentity(relations, runs);

    const fingerprint = this.#fingerprint({
      runs,
      topology,
      pattern,
      symmetry,
      identity
    });

    return {
      engine: "TSL_NDR",
      length: input.length,
      relations,
      runs,
      topology,
      pattern,
      symmetry,
      identity,
      fingerprint
    };
  }

  #deriveRelations(arr) {
    const rel = [];
    for (let i = 1; i < arr.length; i++) {
      if (arr[i] > arr[i - 1]) rel.push("UP");
      else if (arr[i] < arr[i - 1]) rel.push("DOWN");
      else rel.push("SAME");
    }
    return rel;
  }

  #deriveRuns(relations) {
    if (relations.length === 0) return [];

    const runs = [];
    let current = relations[0];
    let count = 1;

    for (let i = 1; i < relations.length; i++) {
      if (relations[i] === current) {
        count++;
      } else {
        runs.push({ dir: current, run: count });
        current = relations[i];
        count = 1;
      }
    }

    runs.push({ dir: current, run: count });
    return runs;
  }

  #deriveTopology(relations) {
    const topo = [];
    let last = null;

    for (const r of relations) {
      if (r !== last) {
        topo.push(r);
        last = r;
      }
    }
    return topo;
  }

  #derivePattern(relations) {
    if (relations.every(r => r === "UP")) return "MONOTONIC_UP";
    if (relations.every(r => r === "DOWN")) return "MONOTONIC_DOWN";
    if (relations.every(r => r === "SAME")) return "STATIC";

    let switches = 0;
    for (let i = 1; i < relations.length; i++) {
      if (relations[i] !== relations[i - 1]) switches++;
    }

    if (switches >= relations.length - 1) return "OSCILLATING";
    return "MIXED";
  }

  #deriveSymmetry(relations) {
    const mid = Math.floor(relations.length / 2);
    for (let i = 0; i < mid; i++) {
      if (relations[i] !== relations[relations.length - 1 - i]) {
        return "ASYMMETRIC";
      }
    }
    return "MIRRORED";
  }

  #deriveIdentity(relations, runs) {
    const alphabet = Array.from(new Set(relations));
    const hasPlateau = alphabet.includes("SAME");

    return {
      alphabet,
      runCount: runs.length,
      hasPlateau
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
