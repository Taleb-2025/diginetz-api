// diginetz-api/src/engines/TSL_DCLS.js
// ----------------------------------------------
// TSL_DCLS (PURE STRUCTURAL)
// Deterministic Constraint Learning by Exclusion
// ----------------------------------------------
// - No numbers
// - No thresholds
// - No magnitude
// - Learns ONLY by forbidding transitions
// ----------------------------------------------

export class TSL_DCLS {

  constructor() {
    this.forbiddenTransitions = new Set();
  }

  /**
   * @param {object} delta - structural delta from TSL_D
   * @returns {object|null} updated constraints or null
   */
  adapt(delta) {
    let mutated = false;

    /* ===== RULE 1: DANGER BREAK FORBIDS CONTAINMENT ===== */
    if (delta.STRUCTURAL_DANGER_BREAK) {
      mutated ||= this.#forbid("ALLOW_CONTAINMENT_AFTER_DANGER");
    }

    /* ===== RULE 2: REPEATED ATTENTION FORBIDS EXTENSION ===== */
    if (delta.STRUCTURAL_ATTENTION_BREAK) {
      mutated ||= this.#forbid("ALLOW_EXTENSION");
    }

    /* ===== RULE 3: IDENTITY RESTORES NOTHING ===== */
    // Identity does NOT unlock anything
    // TSL never goes backward

    /* ===== RESULT ===== */
    return mutated
      ? this.#snapshot()
      : null;
  }

  /* ================= INTERNAL ================= */

  #forbid(rule) {
    if (this.forbiddenTransitions.has(rule)) {
      return false;
    }
    this.forbiddenTransitions.add(rule);
    return true;
  }

  #snapshot() {
    return {
      forbiddenTransitions: Array.from(this.forbiddenTransitions)
    };
  }
}
