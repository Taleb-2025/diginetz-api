// diginetz-api/src/policy/TSL_StructuralDecision.js

export function TSL_StructuralDecision({
  structural_state,
  relation_type,
  structural_break,
  continuity,
  stability,
  aeReport
}) {

  /* ========= ABSOLUTE IDENTITY ========= */

  if (relation_type === "STRUCTURAL_IDENTITY") {
    return allow("STRUCTURAL_IDENTITY");
  }

  /* ========= HARD DENY ========= */

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

  /* ========= STRUCTURAL LOGIC ========= */

  if (
    relation_type === "STRUCTURAL_CONTAINMENT" &&
    stability !== "LOW_STABILITY"
  ) {
    return allow("STRUCTURAL_CONTAINMENT");
  }

  /* ========= DEFAULT ========= */

  return deny("STRUCTURAL_BREAK");
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
