// diginetz-api/src/adapters/tsl-input-adapter.js
// ----------------------------------------------------
// DefaultTSLAdapter (STRICT + DECIMAL WRAPPING)
// Role:
// - Accept RAW input from Flow
// - Convert EVERYTHING into number[]
// - Decimal representation is mandatory
// - Each decimal number is wrapped into its digits
// - No semantics, no structure, no decisions
// ----------------------------------------------------

export class DefaultTSLAdapter {

  adapt(input) {
    if (input == null) {
      throw new Error("TSL_ADAPTER_NULL_INPUT");
    }

    /* ===============================
       Case 1: Uint8Array / Buffer
       =============================== */
    if (ArrayBuffer.isView(input)) {
      return this.#wrapArray(Array.from(input));
    }

    /* ===============================
       Case 2: number[]
       =============================== */
    if (Array.isArray(input)) {
      return this.#wrapArray(input);
    }

    /* ===============================
       Case 3: string → UTF-8 bytes
       =============================== */
    if (typeof input === "string") {
      if (input.length === 0) {
        throw new Error("TSL_ADAPTER_EMPTY_STRING");
      }

      const encoder = new TextEncoder();
      const bytes = encoder.encode(input); // UTF-8 bytes (0–255)
      return this.#wrapArray(Array.from(bytes));
    }

    /* ===============================
       Case 4: single number
       =============================== */
    if (typeof input === "number") {
      return this.#wrapNumber(input);
    }

    /* ===============================
       Anything else is forbidden
       =============================== */
    throw new Error("TSL_ADAPTER_UNSUPPORTED_INPUT");
  }

  /* ===============================
     CORE: DECIMAL WRAPPING
     =============================== */

  #wrapArray(arr) {
    const out = [];
    for (const v of arr) {
      this.#assertNumber(v);
      out.push(...this.#wrapNumber(v));
    }
    return out;
  }

  #wrapNumber(n) {
    this.#assertNumber(n);

    // force decimal representation
    const str = Math.abs(Math.trunc(n)).toString(10);

    // each digit becomes one element
    return Array.from(str, ch => Number(ch));
  }

  /* ===============================
     INTERNAL
     =============================== */

  #assertNumber(v) {
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new Error("TSL_ADAPTER_NON_NUMERIC_VALUE");
    }
  }
}
