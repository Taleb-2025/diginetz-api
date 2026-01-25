export class TSL_D {
  derive(S0, S1) {
    if (!S0 || !S1) {
      throw new Error("TSL_D: invalid structures");
    }

    const changes = [];

    this.#diffArray("relations", S0.relations, S1.relations, changes);
    this.#diffRuns(S0.runs, S1.runs, changes);
    this.#diffValue("pattern", S0.pattern, S1.pattern, changes);
    this.#diffValue("symmetry", S0.symmetry, S1.symmetry, changes);

    const identical = changes.length === 0;

    const identity = identical;

    const contained =
      identical ||
      (
        !identical &&
        changes.every(c =>
          c.type === "RUN_MUTATION" ||
          c.type === "FIELD_CHANGE"
        )
      );

    const diverged =
      !contained &&
      changes.some(c =>
        c.type === "RELATION_CHANGE" ||
        c.type === "RUN_STRUCTURE_CHANGE"
      );

    const overlap = !identity && !contained && !diverged;

    const pressure    = this.#derivePressure(S0, S1);
    const volatility  = this.#deriveVolatility(S0, S1);
    const deformation = this.#deriveDeformation(S0, S1);

    return {
      engine: "TSL_D",
      identical,
      deltaCount: changes.length,
      changes,
      identity,
      contained,
      overlap,
      diverged,
      pressure,
      volatility,
      deformation
    };
  }

  #diffArray(name, a = [], b = [], out) {
    const max = Math.max(a.length, b.length);
    for (let i = 0; i < max; i++) {
      if (a[i] !== b[i]) {
        out.push({
          type: "RELATION_CHANGE",
          field: name,
          index: i
        });
      }
    }
  }

  #diffRuns(a = [], b = [], out) {
    const max = Math.max(a.length, b.length);
    for (let i = 0; i < max; i++) {
      const ra = a[i];
      const rb = b[i];

      if (!ra || !rb) {
        out.push({
          type: "RUN_STRUCTURE_CHANGE",
          index: i
        });
        continue;
      }

      if (ra.dir !== rb.dir || ra.run !== rb.run) {
        out.push({
          type: "RUN_MUTATION",
          index: i
        });
      }
    }
  }

  #diffValue(name, a, b, out) {
    if (a !== b) {
      out.push({
        type: "FIELD_CHANGE",
        field: name
      });
    }
  }

  #derivePressure(S0, S1) {
    if (!Array.isArray(S0.runs) || !Array.isArray(S1.runs)) {
      return "UNKNOWN";
    }

    if (S0.runs.length !== S1.runs.length) {
      return "HIGH";
    }

    let changed = 0;
    for (let i = 0; i < S0.runs.length; i++) {
      if (S0.runs[i].run !== S1.runs[i].run) {
        changed++;
      }
    }

    if (changed === 0) return "LOW";
    if (changed <= 2) return "MEDIUM";
    return "HIGH";
  }

  #deriveVolatility(S0, S1) {
    if (!Array.isArray(S1.relations)) return "UNKNOWN";

    let switches = 0;
    for (let i = 1; i < S1.relations.length; i++) {
      if (S1.relations[i] !== S1.relations[i - 1]) {
        switches++;
      }
    }

    if (switches === 0) return "STABLE";
    if (switches <= 2) return "MODERATE";
    return "TURBULENT";
  }

  #deriveDeformation(S0, S1) {
    if (!Array.isArray(S0.runs) || !Array.isArray(S1.runs)) {
      return "UNKNOWN";
    }

    if (S0.runs.length !== S1.runs.length) {
      return "GLOBAL";
    }

    let local = false;
    for (let i = 0; i < S0.runs.length; i++) {
      if (S0.runs[i].dir !== S1.runs[i].dir) {
        return "GLOBAL";
      }
      if (S0.runs[i].run !== S1.runs[i].run) {
        local = true;
      }
    }

    return local ? "LOCAL" : "NONE";
  }
}
