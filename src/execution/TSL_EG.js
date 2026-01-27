// diginetz-api/src/execution/TSL_EG.js
// ----------------------------------------------
// TSL_EG (PURE STRUCTURAL PIPELINE)
// - لا AE
// - لا STS
// - لا EventDropper
// - لا Guards
// - لا قرارات
// ----------------------------------------------
// الوظيفة الوحيدة:
// S0 + numericInput → S1 → Δ → return
// ----------------------------------------------

export class TSL_EG {
  constructor({ ndr, d }) {
    if (!ndr || !d) {
      throw new Error("TSL_EG_MISSING_CORE");
    }

    this.ndr = ndr;
    this.d = d;
  }

  executeWithReference(referenceStructure, numericInput) {
    if (!referenceStructure || typeof referenceStructure !== "object") {
      return {
        ok: false,
        reason: "INVALID_REFERENCE"
      };
    }

    if (!Array.isArray(numericInput)) {
      return {
        ok: false,
        reason: "INVALID_INPUT_TYPE"
      };
    }

    for (const v of numericInput) {
      if (typeof v !== "number" || Number.isNaN(v)) {
        return {
          ok: false,
          reason: "NON_NUMERIC_INPUT"
        };
      }
    }

    const structure = this.ndr.extract(numericInput);   // S1
    const delta     = this.d.derive(referenceStructure, structure); // Δ

    return {
      ok: true,
      reference: referenceStructure, // S0
      structure,                     // S1
      delta
    };
  }
}
