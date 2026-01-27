// diginetz-api/src/adapters/tsl-input-adapter.js
// ----------------------------------------------------
// DefaultTSLAdapter (STRICT)
// Role:
// - Accept RAW input from Flow
// - Convert EVERYTHING into number[]
// - No parsing semantics
// - No comma logic
// - No structure
// - No cycle awareness
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
      return Array.from(input, v => this.#assertNumber(v));
    }

    /* ===============================
       Case 2: number[]
       =============================== */
    if (Array.isArray(input)) {
      return input.map(v => this.#assertNumber(v));
    }

    /* ===============================
       Case 3: string → UTF-8 bytes
       =============================== */
    if (typeof input === "string") {
      if (input.length === 0) {
        throw new Error("TSL_ADAPTER_EMPTY_STRING");
      }

      const encoder = new TextEncoder();
      const bytes = encoder.encode(input); // UTF-8
      return Array.from(bytes);
    }

    /* ===============================
       Case 4: single number
       =============================== */
    if (typeof input === "number") {
      return [this.#assertNumber(input)];
    }

    /* ===============================
       Anything else is forbidden
       =============================== */
    throw new Error("TSL_ADAPTER_UNSUPPORTED_INPUT");
  }

  /* ===============================
     INTERNAL
     =============================== */

  #assertNumber(v) {
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new Error("TSL_ADAPTER_NON_NUMERIC_VALUE");
    }
    return v;
  }
}
