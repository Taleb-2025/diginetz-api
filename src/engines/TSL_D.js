// diginetz-api/src/engines/TSL_D.js
// ----------------------------------------------
// TSL_D (LAW-BASED WITH STRUCTURAL CONTAINMENT)
// ----------------------------------------------
// Structural Laws:
// - LENGTH
// - ORDER
// - CONTINUITY
// - BOUNDARIES
// - EXTENT (classification only)
// ----------------------------------------------

export class TSL_D {

  derive(S0, S1) {
    if (!S0 || !S1) {
      throw new Error("TSL_D: invalid structures");
    }

    const changes = [];

    /* ===== LAW 1: LENGTH ===== */
    const lengthChanged = S0.length !== S1.length;
    if (lengthChanged) {
      changes.push({ law: "LENGTH" });
    }

    /* ===== LAW 2: ORDER ===== */
    const orderSame = this.#equal(S0.order, S1.order);
    if (!orderSame) {
      changes.push({ law: "ORDER" });
    }

    /* ===== LAW 3: CONTINUITY ===== */
    const continuitySame =
      this.#equal(S0.continuity, S1.continuity);
    if (!continuitySame) {
      changes.push({ law: "CONTINUITY" });
    }

    /* ===== LAW 4: BOUNDARIES ===== */
    const boundariesSame =
      S0.boundaries?.start === S1.boundaries?.start &&
      S0.boundaries?.end   === S1.boundaries?.end;

    if (!boundariesSame) {
      changes.push({ law: "BOUNDARIES" });
    }

    /* ===== LAW 5: EXTENT (STRUCTURAL EXTENSION) ===== */
    const isExtent =
      lengthChanged &&
      orderSame &&
      continuitySame &&
      boundariesSame &&
      S1.length > S0.length;

    /* ===== FINAL RELATIONS ===== */

    const identical = changes.length === 0;

    const contained =
      !identical &&
      isExtent;

    const diverged =
      !contained &&
      changes.some(c =>
        c.law === "ORDER" || c.law === "BOUNDARIES"
      );

    const overlap =
      !identical && !contained && !diverged;

    return {
      engine: "TSL_D",

      identical,
      contained,
      overlap,
      diverged,

      deltaCount: changes.length,
      changes: isExtent
        ? [...changes, { law: "EXTENT" }]
        : changes
    };
  }

  /* ================= INTERNAL ================= */

  #equal(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
}
