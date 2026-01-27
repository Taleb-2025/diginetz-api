// diginetz-api/src/execution/TSL_EG.js
// ----------------------------------------------
// TSL_EG (STRICT STRUCTURAL GATE)
// - No interpretation
// - No policy
// - No AE / STS / Dropper
// - Enforces S0 as structural anchor
// ----------------------------------------------

export class TSL_EG {
  constructor({ ndr, d }) {
    if (!ndr || !d) {
      throw new Error("TSL_EG_MISSING_CORE");
    }

    this.ndr = ndr;
    this.d   = d;
  }

  executeWithReference(referenceStructure, numericInput) {
    /* ===== VALIDATION ===== */

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

    /* ===== STRUCTURAL EXTRACTION (S1) ===== */

    const structure = this.ndr.extract(numericInput);

    /* ===== STRUCTURAL ANCHOR ENFORCEMENT ===== */

    // enforce same atom domain implicitly via adapter
    // enforce same minimum length
    if (structure.length < referenceStructure.length) {
      return {
        ok: false,
        phase: "STRUCTURE",
        reason: "STRUCTURE_SHORTER_THAN_REFERENCE",
        reference: referenceStructure,
        structure
      };
    }

    /* ===== DELTA ===== */

    const delta = this.d.derive(referenceStructure, structure);

    /* ===== RESULT ===== */

    return {
      ok: true,
      phase: "STRUCTURE",
      reference: referenceStructure, // S0 (ANCHOR)
      structure,                     // S1
      delta
    };
  }
}
