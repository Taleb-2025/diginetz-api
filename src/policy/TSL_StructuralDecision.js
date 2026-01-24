// diginetz-api/src/policy/TSL_StructuralDecision.js
// ----------------------------------------------------
// TSL Structural Decision Layer
// Principle: Numbers observe → Structure decides
// ----------------------------------------------------
// - Reads STRUCTURAL INTERPRETATION only
// - No numeric thresholds
// - No statistics
// - No history
// - No aggregation
// - Deterministic structural judgment only
// ----------------------------------------------------

export function TSL_StructuralDecision({
  structural_state,
  relation_type,
  structural_break,
  continuity,
  stability,
  aeReport
}) {

  /* ================= HARD DENIAL ================= */

  if (structural_state === "COLLAPSING") {
    return deny("STRUCTURAL_COLLAPSE");
  }

  if (structural_break === "GLOBAL_BREAK") {
    return deny("GLOBAL_STRUCTURAL_BREAK");
  }

  if (continuity === "UNSUSTAINABLE") {
    return deny("UNSUSTAINABLE_STRUCTURE");
  }

  if (aeReport?.securityFlag === "ALERT") {
    return deny("ABSENCE_EXECUTION_ALERT");
  }

  /* ================= CONDITIONAL ALLOW ================= */

  if (
    structural_state === "FRACTURED" ||
    continuity === "AT_RISK"
  ) {
    return allowWithWarning("STRUCTURAL_RISK");
  }

  if (
    relation_type === "STRUCTURAL_CONTAINMENT" &&
    stability !== "LOW_STABILITY"
  ) {
    return allow("STRUCTURAL_CONTAINMENT_OK");
  }

  if (relation_type === "STRUCTURAL_IDENTITY") {
    return allow("STRUCTURAL_IDENTITY");
  }

  /* ================= DEFAULT ================= */

  return deny("STRUCTURAL_UNCERTAINTY");
}

/* ================= RESULT HELPERS ================= */

function allow(reason) {
  return {
    decision: "ALLOW",
    state: "STABLE",
    reason,
    layer: "TSL_StructuralDecision"
  };
}

function allowWithWarning(reason) {
  return {
    decision: "ALLOW",
    state: "RISK",
    reason,
    warning: true,
    layer: "TSL_StructuralDecision"
  };
}

function deny(reason) {
  return {
    decision: "DENY",
    state: "UNSAFE",
    reason,
    layer: "TSL_StructuralDecision"
  };
}
