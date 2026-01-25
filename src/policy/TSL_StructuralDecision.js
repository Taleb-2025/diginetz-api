// diginetz-api/src/policy/TSL_StructuralDecision.js

export function TSL_StructuralDecision({
  structural_state,
  relation_type,
  structural_break,
  continuity,
  stability,
  aeReport
}) {

  /* ========= HARD DENY FIRST ========= */

  if (aeReport?.securityFlag === "ALERT") {
    return deny("ABSENCE_EXECUTION_ALERT");
  }

  if (structural_state === "COLLAPSING") {
    return deny("STRUCTURAL_COLLAPSE");
  }

  if (structural_break === "GLOBAL_BREAK") {
    return deny("GLOBAL_STRUCTURAL_BREAK");
  }

  if (continuity === "UNSUSTAINABLE") {
    return deny("UNSUSTAINABLE_STRUCTURE");
  }

  /* ========= STRICT STRUCTURAL LOGIC ========= */

  // الهوية: مسموحة فقط
  if (relation_type === "STRUCTURAL_IDENTITY") {
    return allow("STRUCTURAL_IDENTITY");
  }

  // الاحتواء: مسموح فقط إذا كان مستقرًا
  if (
    relation_type === "STRUCTURAL_CONTAINMENT" &&
    stability !== "LOW_STABILITY"
  ) {
    return allow("STRUCTURAL_CONTAINMENT_OK");
  }

  /* ========= EVERYTHING ELSE = DENY ========= */

  return deny("NOT_CONTAINED");
}

/* ========= HELPERS ========= */

function allow(reason) {
  return {
    decision: "ALLOW",
    state: "STABLE",
    reason,
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
