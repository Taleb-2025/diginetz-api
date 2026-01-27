// diginetz-api/src/engines/TSL_D.js

export class TSL_D {
  derive(S0, S1) {
    if (!S0 || !S1) {
      throw new Error("TSL_D: invalid structures");
    }

    const changes = [];

    /* ===== LAW 1: LENGTH ===== */
    if (S0.length !== S1.length) {
      changes.push({
        law: "LENGTH",
        from: S0.length,
        to: S1.length
      });
    }

    /* ===== LAW 2: ORDER ===== */
    if (!this.#equal(S0.order, S1.order)) {
      changes.push({
        law: "ORDER",
        from: S0.order,
        to: S1.order
      });
    }

    /* ===== LAW 3: CONTINUITY ===== */
    if (!this.#equal(S0.continuity, S1.continuity)) {
      changes.push({
        law: "CONTINUITY",
        from: S0.continuity,
        to: S1.continuity
      });
    }

    /* ===== LAW 4: BOUNDARIES ===== */
    if (!this.#equal(S0.boundaries, S1.boundaries)) {
      changes.push({
        law: "BOUNDARIES",
        from: S0.boundaries,
        to: S1.boundaries
      });
    }

    const identical = changes.length === 0;

    const contained =
      !identical &&
      changes.every(c =>
        c.law === "LENGTH" ||
        c.law === "CONTINUITY"
      );

    const diverged =
      changes.some(c =>
        c.law === "ORDER" ||
        c.law === "BOUNDARIES"
      );

    const overlap = !identical && !contained && !diverged;

    return {
      engine: "TSL_D",

      identical,
      contained,
      overlap,
      diverged,

      deltaCount: changes.length,
      changes
    };
  }

  /* ===== INTERNAL ===== */

  #equal(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
}
