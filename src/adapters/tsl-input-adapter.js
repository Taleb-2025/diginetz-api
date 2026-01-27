// diginetz-api/src/adapters/tsl-input-adapter.js
// ----------------------------------------------------
// DefaultTSLAdapter (STRUCTURAL ATOM = DECIMAL DIGIT)
// ----------------------------------------------------
// Rule (FINAL):
// - The ONLY structural atom allowed into TSL is a single decimal digit [0–9]
// - Any incoming data MUST be deterministically reduced to digit sequence
// - Numbers are CLOSED atoms (e.g. 116 → [1,1,6])
// - Strings are reduced via UTF-8 bytes (not semantic digits)
// - No semantics, no meaning, no structure, no cycles
// ----------------------------------------------------

export class DefaultTSLAdapter {

  adapt(input) {
    if (input == null) {
      throw new Error("TSL_ADAPTER_NULL_INPUT");
    }

    /* =====================================
       Case 1: Uint8Array / Buffer
       ===================================== */
    if (ArrayBuffer.isView(input)) {
      return this.#explodeValues(Array.from(input));
    }

    /* =====================================
       Case 2: number[]
       ===================================== */
    if (Array.isArray(input)) {
      return this.#explodeValues(input);
    }

    /* =====================================
       Case 3: string → UTF-8 bytes
       ===================================== */
    if (typeof input === "string") {
      if (input.length === 0) {
        throw new Error("TSL_ADAPTER_EMPTY_STRING");
      }

      const encoder = new TextEncoder();
      const bytes = encoder.encode(input); // UTF-8 bytes
      return this.#explodeValues(Array.from(bytes));
    }

    /* =====================================
       Case 4: single number
       ===================================== */
    if (typeof input === "number") {
      if (!Number.isFinite(input)) {
        throw new Error("TSL_ADAPTER_NON_FINITE_NUMBER");
      }

      return this.#explodeNumber(input);
    }

    /* =====================================
       Everything else is forbidden
       ===================================== */
    throw new Error("TSL_ADAPTER_UNSUPPORTED_INPUT");
  }

  /* =====================================
     INTERNAL — ATOM ENFORCEMENT
     ===================================== */

  #explodeValues(values) {
    const out = [];

    for (const v of values) {
      if (typeof v !== "number" || !Number.isFinite(v)) {
        throw new Error("TSL_ADAPTER_NON_NUMERIC_VALUE");
      }

      // كل عدد يُغلق داخل نفسه
      out.push(...this.#explodeNumber(v));
    }

    if (out.length < 2) {
      throw new Error("TSL_ADAPTER_INSUFFICIENT_ATOMS");
    }

    return out;
  }

  #explodeNumber(n) {
    const s = Math.abs(Math.trunc(n)).toString();
    return Array.from(s, d => Number(d));
  }
}
