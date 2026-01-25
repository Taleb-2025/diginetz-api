/* ============================================================
 * TSL Input Adapter
 * Role: Raw Input → Numeric Representation
 * - NO Δ extraction
 * - NO direction
 * - NO structure
 * - NO interpretation
 * ============================================================
 */

export class DefaultTSLAdapter {

  /**
   * Adapt raw input into numeric sequence
   * This is the ONLY responsibility of this adapter
   */
  adapt(input) {
    // Accept string: "1,2,3,2,1"
    if (typeof input === "string") {
      return this.#fromString(input);
    }

    // Accept array of numbers
    if (Array.isArray(input)) {
      return this.#fromArray(input);
    }

    throw new Error("TSL Adapter: unsupported input type");
  }

  /* ================= INTERNAL ================= */

  #fromString(text) {
    const values = text
      .split(",")
      .map(v => Number(v.trim()))
      .filter(v => !Number.isNaN(v));

    if (values.length < 2) {
      throw new Error("TSL Adapter: insufficient numeric data");
    }

    return values;
  }

  #fromArray(arr) {
    if (arr.length < 2) {
      throw new Error("TSL Adapter: insufficient numeric data");
    }

    for (const v of arr) {
      if (typeof v !== "number" || Number.isNaN(v)) {
        throw new Error("TSL Adapter: array must contain only numbers");
      }
    }

    return arr;
  }
}
