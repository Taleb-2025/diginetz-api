export class TSL_D {
  derive(A, B) {
    if (!A || !B || !A.structure || !B.structure) {
      throw new Error("TSL_D: invalid inputs");
    }

    const changes = [];
    this.#diff(A.structure, B.structure, "", 0, changes);
    const metrics = this.#metrics(changes, A.structure);

    return {
      engine: "TSL_D",
      version: "1.2.0",
      identical: changes.length === 0,
      deltaCount: changes.length,
      metrics,
      changes
    };
  }

  #diff(a, b, path, depth, out) {
    if (a === b) return;

    const ta = typeof a;
    const tb = typeof b;

    if (ta !== tb) {
      out.push(this.#change("TYPE_CHANGE", path, depth));
      return;
    }

    if (ta !== "object" || a === null || b === null) {
      out.push(this.#change("VALUE_CHANGE", path, depth));
      return;
    }

    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b)) {
        out.push(this.#change("TYPE_CHANGE", path, depth));
        return;
      }

      const max = Math.max(a.length, b.length);
      for (let i = 0; i < max; i++) {
        const p = `${path}[${i}]`;
        if (i >= a.length) {
          out.push(this.#change("ADDED", p, depth + 1));
        } else if (i >= b.length) {
          out.push(this.#change("REMOVED", p, depth + 1));
        } else {
          this.#diff(a[i], b[i], p, depth + 1, out);
        }
      }
      return;
    }

    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      const p = path ? `${path}.${k}` : k;
      if (!(k in a)) {
        out.push(this.#change("ADDED", p, depth + 1));
      } else if (!(k in b)) {
        out.push(this.#change("REMOVED", p, depth + 1));
      } else {
        this.#diff(a[k], b[k], p, depth + 1, out);
      }
    }
  }

  #change(type, path, depth) {
    const baseWeight = {
      TYPE_CHANGE: 4,
      VALUE_CHANGE: 1,
      ADDED: 2,
      REMOVED: 2
    }[type] ?? 1;

    const depthWeight = 1 + Math.log2(depth + 1);

    return {
      path,
      type,
      depth,
      weight: baseWeight * depthWeight
    };
  }

  #metrics(changes, structure) {
    let additions = 0;
    let removals = 0;
    let mutations = 0;
    let totalWeight = 0;
    let maxDepthTouched = 0;

    for (const c of changes) {
      totalWeight += c.weight;
      if (c.depth > maxDepthTouched) maxDepthTouched = c.depth;
      if (c.type === "ADDED") additions++;
      else if (c.type === "REMOVED") removals++;
      else mutations++;
    }

    const structureSize = this.#sizeOf(structure);

    return {
      additions,
      removals,
      mutations,
      maxDepthTouched,
      changeRatio: structureSize === 0 ? 0 : changes.length / structureSize,
      structuralDistance: Number(totalWeight.toFixed(3))
    };
  }

  #sizeOf(obj) {
    if (obj === null || typeof obj !== "object") return 1;

    if (Array.isArray(obj)) {
      return obj.reduce((s, v) => s + this.#sizeOf(v), 0);
    }

    let count = 0;
    for (const k of Object.keys(obj)) {
      count += this.#sizeOf(obj[k]);
    }
    return count;
  }
}
