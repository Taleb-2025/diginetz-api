// TSL_D.js
// Structural Delta Engine
// Core / Stateless / Quantitative

export class TSL_D {
  derive(A, B) {
    if (!A || !B || !A.structure || !B.structure) {
      throw new Error("TSL_D: invalid inputs");
    }

    const changes = [];
    this.#diff(A.structure, B.structure, "", changes);

    return {
      engine: "TSL_D",
      version: "1.0.0",
      identical: changes.length === 0,
      deltaCount: changes.length,
      changes
    };
  }

  /* ================= INTERNAL ================= */

  #diff(a, b, path, out) {
    if (a === b) return;

    const ta = typeof a;
    const tb = typeof b;

    if (ta !== tb) {
      out.push({ path, type: "TYPE_CHANGE", from: ta, to: tb });
      return;
    }

    if (ta !== "object" || a === null || b === null) {
      out.push({ path, type: "VALUE_CHANGE" });
      return;
    }

    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);

    for (const k of keys) {
      const p = path ? `${path}.${k}` : k;

      if (!(k in a)) {
        out.push({ path: p, type: "ADDED" });
      } else if (!(k in b)) {
        out.push({ path: p, type: "REMOVED" });
      } else {
        this.#diff(a[k], b[k], p, out);
      }
    }
  }
}
