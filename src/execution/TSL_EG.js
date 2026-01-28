// diginetz-api/src/execution/TSL_EG.js

export class TSL_EG {
  constructor({ ndr, d }) {
    if (!ndr || !d) {
      throw new Error("TSL_EG_MISSING_CORE");
    }

    this.ndr = ndr;
    this.d   = d;
  }

  executeWithReference(referenceStructure, numericInput) {
    /* ===== BASIC VALIDATION ===== */

    if (!referenceStructure || typeof referenceStructure !== "object") {
      return {
        ok: false,
        phase: "ACCESS",
        reason: "INVALID_REFERENCE_STRUCTURE"
      };
    }

    if (!Array.isArray(numericInput)) {
      return {
        ok: false,
        phase: "ACCESS",
        reason: "INVALID_INPUT_TYPE"
      };
    }

    for (const v of numericInput) {
      if (typeof v !== "number" || Number.isNaN(v)) {
        return {
          ok: false,
          phase: "ACCESS",
          reason: "NON_NUMERIC_INPUT"
        };
      }
    }

    /* ===== STRUCTURE EXTRACTION (S1) ===== */

    let structure;
    try {
      structure = this.ndr.extract(numericInput);
    } catch (err) {
      return {
        ok: false,
        phase: "STRUCTURE",
        reason: err.message
      };
    }

    /* ===== STRUCTURAL COMPARISON ===== */

    const delta = this.d.derive(referenceStructure, structure);

    /* ===== RESULT ===== */

    return {
      ok: true,
      phase: "STRUCTURE",
      reference: referenceStructure, // S0
      structure,                     // S1
      delta
    };
  }
}
