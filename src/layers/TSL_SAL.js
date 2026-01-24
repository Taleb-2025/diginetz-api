// TSL_SAL
// Structural Allowance Layer
// Reads TSL results ONLY — no values, no thresholds, no counters

export class TSL_SAL {

  decide({ tsl_result }) {
    if (!tsl_result) {
      return {
        decision: "DENY",
        reason: "NO_STRUCTURAL_RESULT"
      };
    }

    const {
      structural_state,
      structural_break,
      continuity
    } = tsl_result;

    /* ---------- Hard Structural Violations ---------- */

    if (structural_state === "COLLAPSING") {
      return this.deny("STRUCTURAL_COLLAPSE");
    }

    if (structural_break === "GLOBAL_BREAK") {
      return this.deny("GLOBAL_STRUCTURAL_BREAK");
    }

    if (continuity === "UNSUSTAINABLE") {
      return this.deny("UNSUSTAINABLE_STRUCTURE");
    }

    /* ---------- Soft Structural Risk ---------- */

    if (
      structural_state === "FRACTURED" ||
      continuity === "AT_RISK"
    ) {
      return this.allowWithWarning("STRUCTURAL_RISK");
    }

    /* ---------- Stable / Contained ---------- */

    return this.allow("STRUCTURAL_OK");
  }

  /* ---------- Helpers ---------- */

  allow(reason) {
    return {
      decision: "ALLOW",
      reason
    };
  }

  allowWithWarning(reason) {
    return {
      decision: "ALLOW",
      reason,
      warning: true
    };
  }

  deny(reason) {
    return {
      decision: "DENY",
      reason
    };
  }
}
