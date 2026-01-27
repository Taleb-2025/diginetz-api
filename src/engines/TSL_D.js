// diginetz-api/src/engines/TSL_D.js
// ----------------------------------------------
// TSL_D (LAW-BASED WITH STRUCTURAL CONTAINMENT)
// ----------------------------------------------
// قوانين معتمدة فقط:
// - LENGTH
// - ORDER
// - CONTINUITY
// - BOUNDARIES
// - EXTENT
// ----------------------------------------------
// الاحتواء = S0 ⊆ S1 بنيويًا
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
    const orderContained = this.#isContained(S0.order, S1.order);
    if (!orderContained) {
      changes.push({ law: "ORDER" });
    }

    /* ===== LAW 3: CONTINUITY ===== */
    const continuityContained =
      this.#isContained(S0.continuity, S1.continuity);
    if (!continuityContained) {
      changes.push({ law: "CONTINUITY" });
    }

    /* ===== LAW 4: BOUNDARIES ===== */
    const boundariesSame =
      S0.boundaries?.start === S1.boundaries?.start &&
      S0.boundaries?.end   === S1.boundaries?.end;

    if (!boundariesSame) {
      changes.push({ law: "BOUNDARIES" });
    }

    /* ===== LAW 5: EXTENT ===== */
    const isExtent =
      lengthChanged &&
      orderContained &&
      continuityContained &&
      boundariesSame &&
      this.#isPrefix(S0.order, S1.order);

    if (isExtent) {
      changes.push({ law: "EXTENT" });
    }

    /* ===== FINAL RELATIONS ===== */

    const identical = changes.length === 0;

    const contained =
      !identical &&
      orderContained &&
      continuityContained &&
      boundariesSame;

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
      changes
    };
  }

  /* =====================================
     INTERNAL — STRUCTURAL CONTAINMENT
     ===================================== */

  #isContained(inner = [], outer = []) {
    if (!Array.isArray(inner) || !Array.isArray(outer)) return false;
    if (inner.length === 0) return true;
    if (inner.length > outer.length) return false;

    let j = 0;
    for (let i = 0; i < outer.length; i++) {
      if (this.#equal(inner[j], outer[i])) {
        j++;
        if (j === inner.length) return true;
      }
    }
    return false;
  }

  #isPrefix(a = [], b = []) {
    if (a.length > b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!this.#equal(a[i], b[i])) return false;
    }
    return true;
  }

  #equal(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
}
