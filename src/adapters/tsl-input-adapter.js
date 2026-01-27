// diginetz-api/src/adapters/tsl-input-adapter.js
// ----------------------------------------------------
// DefaultTSLAdapter (STRUCTURAL ATOM = DECIMAL DIGIT)
// ----------------------------------------------------
// Rule (FINAL):
// - The ONLY structural atom allowed into TSL is a single decimal digit [0–9]
// - Any incoming data MUST be deterministically reduced to digit sequence
// - No semantics, no meaning, no structure, no cycles
// - This layer defines the atom. Everything after assumes it.
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
      return this.#explodeToDigits(Array.from(input));
    }

    /* =====================================
       Case 2: number[]
       ===================================== */
    if (Array.isArray(input)) {
      return this.#explodeToDigits(input);
    }

    /* =====================================
       Case 3: string
       ===================================== */
    if (typeof input === "string") {
      if (input.length === 0) {
        throw new Error("TSL_ADAPTER_EMPTY_STRING");
      }

      const digits = [];
      for (const ch of input) {
        if (ch >= "0" && ch <= "9") {
          digits.push(Number(ch));
        }
      }

      if (digits.length === 0) {
        throw new Error("TSL_ADAPTER_NO_DIGITS");
      }

      return digits;
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

  #explodeToDigits(values) {
    const out = [];

    for (const v of values) {
      if (typeof v !== "number" || !Number.isFinite(v)) {
        throw new Error("TSL_ADAPTER_NON_NUMERIC_VALUE");
      }

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
