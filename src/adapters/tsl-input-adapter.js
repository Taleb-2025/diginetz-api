// diginetz-api/src/adapters/tsl-input-adapter.js
// ----------------------------------------------------
// DefaultTSLAdapter
// Role:
// - Accept RAW input from Flow
// - Enforce STRICT decimal numeric normalization
// - No structure, no logic, no cycles, no decisions
// - Guarantees: same raw input → same number[]
// ----------------------------------------------------

export class DefaultTSLAdapter {

  adapt(input) {
    if (input == null) {
      throw new Error("TSL_ADAPTER_NULL_INPUT");
    }

    // Case 1: already numeric array (Uint8Array, number[])
    if (Array.isArray(input) || ArrayBuffer.isView(input)) {
      return this.#normalizeArray(input);
    }

    // Case 2: single number
    if (typeof input === "number") {
      if (Number.isNaN(input)) {
        throw new Error("TSL_ADAPTER_NAN");
      }
      return [this.#normalizeNumber(input)];
    }

    // Case 3: string (e.g. "1,2,3" or "36")
    if (typeof input === "string") {
      const trimmed = input.trim();
      if (trimmed.length === 0) {
        throw new Error("TSL_ADAPTER_EMPTY_STRING");
      }

      // comma-separated numbers
      if (trimmed.includes(",")) {
        const parts = trimmed.split(",");
        return parts.map(p => {
          const n = Number(p.trim());
          if (Number.isNaN(n)) {
            throw new Error("TSL_ADAPTER_INVALID_STRING_NUMBER");
          }
          return this.#normalizeNumber(n);
        });
      }

      // single numeric string
      const n = Number(trimmed);
      if (Number.isNaN(n)) {
        throw new Error("TSL_ADAPTER_INVALID_STRING");
      }
      return [this.#normalizeNumber(n)];
    }

    // Case 4: Buffer (Node.js raw bytes)
    if (typeof Buffer !== "undefined" && Buffer.isBuffer(input)) {
      return Array.from(input.values());
    }

    // Case 5: object with numeric values (explicit rejection)
    if (typeof input === "object") {
      throw new Error("TSL_ADAPTER_OBJECT_NOT_ALLOWED");
    }

    throw new Error("TSL_ADAPTER_UNSUPPORTED_INPUT");
  }

  /* ================= INTERNAL ================= */

  #normalizeArray(arr) {
    const out = [];
    for (const v of arr) {
      if (typeof v !== "number" || Number.isNaN(v)) {
        throw new Error("TSL_ADAPTER_NON_NUMERIC_ARRAY");
      }
      out.push(this.#normalizeNumber(v));
    }
    return out;
  }

  #normalizeNumber(n) {
    // enforce deterministic decimal domain
    // no rounding heuristics, no scaling, no meaning
    if (!Number.isFinite(n)) {
      throw new Error("TSL_ADAPTER_NON_FINITE");
    }

    return n;
  }
}
