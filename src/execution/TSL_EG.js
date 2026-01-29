// diginetz-api/src/execution/TSL_EG.js
// ----------------------------------------------
// TSL_EG (STREAMING EFFECT GRAPH – NEW)
// ----------------------------------------------
// Principles:
// - No reference storage
// - No history
// - No decision
// - No policy
// - One-step memory (last effect only)
// - Forget immediately after interpretation
// ----------------------------------------------

export class TSL_EG {
  constructor({ adapter, ndr, d, interpreter }) {
    if (!adapter || !ndr || !d || !interpreter) {
      throw new Error("TSL_EG_MISSING_CORE");
    }

    this.adapter = adapter;
    this.ndr = ndr;
    this.d = d;
    this.interpreter = interpreter;

    // الأثر الوحيد
    this._lastStructure = null;
  }

  /**
   * Observe one event in the stream
   * @param {*} input raw input (any supported type)
   * @returns {Object} structural signal
   */
  observe(input) {
    let adapted;
    let structure;

    try {
      adapted = this.adapter.adapt(input);
      structure = this.ndr.extract(adapted);
    } catch (err) {
      return {
        ok: false,
        phase: "ADAPT_OR_EXTRACT",
        error: err.message
      };
    }

    // أول حدث — لا مقارنة
    if (!this._lastStructure) {
      this._lastStructure = structure;
      return {
        ok: true,
        type: "FIRST_EVENT",
        structure
      };
    }

    // دلتا بنيوية فقط
    const delta = this.d.derive(this._lastStructure, structure);

    // تفسير بنيوي (إشارة فقط)
    const signal = this.interpreter.interpret({ delta });

    // النسيان — هذا هو القانون
    this._lastStructure = structure;

    return {
      ok: true,
      type: "STRUCTURAL_SIGNAL",
      signal
    };
  }

  /**
   * Explicit forget
   */
  reset() {
    this._lastStructure = null;
    return { ok: true, state: "RESET" };
  }

  /**
   * Introspection
   */
  meta() {
    return {
      engine: "TSL_EG",
      mode: "STREAMING",
      memory: "LAST_EFFECT_ONLY",
      reference: false,
      decision: false,
      policy: false
    };
  }
}
