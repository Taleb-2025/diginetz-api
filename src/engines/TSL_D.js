// diginetz-api/src/engines/TSL_D.js
// ----------------------------------------------
// TSL_D (PURE STRUCTURAL – FINAL)
// ----------------------------------------------
// Structural Laws (STRICT):
// 1. LENGTH
// 2. ORDER
// 3. CONTINUITY
// 4. BOUNDARIES
// 5. STEP_PATTERN   ← شكل القفزات (العلاقة فقط)
// ----------------------------------------------
// Principles:
// - No numeric comparison
// - No magnitude
// - No thresholds
// - STEP_PATTERN is structural, decisive for identity
// - Identity = all laws identical
// - Containment = same structure, longer length only
// ----------------------------------------------

export class TSL_D {

  derive(S0, S1) {
    if (!S0 || !S1) {
      throw new Error("TSL_D: invalid structures");
    }

    const changes = [];

    /* ===== LAW 1: LENGTH ===== */
    const lengthSame = S0.length === S1.length;
    if (!lengthSame) {
      changes.push({ law: "LENGTH" });
    }

    /* ===== LAW 2: ORDER ===== */
    const orderSame = this.#equal(S0.order, S1.order);
    if (!orderSame) {
      changes.push({ law: "ORDER" });
    }

    /* ===== LAW 3: CONTINUITY ===== */
    const continuitySame = this.#equal(S0.continuity, S1.continuity);
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

    /* ===== LAW 5: STEP_PATTERN ===== */
    const stepPatternSame =
      this.#equal(S0.stepPattern, S1.stepPattern);

    if (!stepPatternSame) {
      changes.push({ law: "STEP_PATTERN" });
    }

    /* ===== FINAL RELATIONS ===== */

    const identical =
      lengthSame &&
      orderSame &&
      continuitySame &&
      boundariesSame &&
      stepPatternSame;

    const contained =
      !identical &&
      orderSame &&
      continuitySame &&
      boundariesSame &&
      stepPatternSame &&
      S1.length > S0.length;

    const diverged =
      !contained &&
      (
        !orderSame ||
        !boundariesSame ||
        !stepPatternSame
      );

    const overlap =
      !identical &&
      !contained &&
      !diverged;

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

  /* ================= INTERNAL ================= */

  #equal(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
}
