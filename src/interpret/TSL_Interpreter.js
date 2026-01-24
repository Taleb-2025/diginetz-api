// TSL_Interpreter
// Interprets STRUCTURE ONLY
// No values, no thresholds, no memory, no execution
// Pure semantic interpretation layer

export class TSL_Interpreter {

  interpret({ structure }) {
    if (!structure || typeof structure !== "object") {
      return {
        structural_state: "UNDEFINED",
        relation_type: "UNKNOWN",
        direction_of_change: "UNKNOWN",
        stability: "UNKNOWN",
        structural_break: "UNKNOWN",
        continuity: "UNKNOWN"
      };
    }

    const relation_type = this.deriveRelation(structure);
    const direction_of_change = this.deriveDirection(structure);
    const stability = this.deriveStability(structure);
    const structural_break = this.deriveBreak(structure);
    const continuity = this.deriveContinuity(structure);

    const structural_state =
      this.deriveState(relation_type, stability, structural_break);

    return {
      structural_state,
      relation_type,
      direction_of_change,
      stability,
      structural_break,
      continuity
    };
  }

  /* ================= RELATION ================= */

  deriveRelation(structure) {
    if (structure.identity === true)
      return "STRUCTURAL_IDENTITY";

    if (structure.contained === true)
      return "STRUCTURAL_CONTAINMENT";

    if (structure.overlap === true)
      return "STRUCTURAL_OVERLAP";

    if (structure.diverged === true)
      return "STRUCTURAL_DIVERGENCE";

    return "UNKNOWN";
  }

  /* ================= DIRECTION ================= */

  deriveDirection(structure) {
    if (structure.pattern === "EXPANDING")
      return "EXPANDING";

    if (structure.pattern === "CONTRACTING")
      return "CONTRACTING";

    if (structure.pattern === "OSCILLATING")
      return "OSCILLATING";

    if (structure.pattern === "STATIC")
      return "STATIC";

    return "UNKNOWN";
  }

  /* ================= STABILITY ================= */

  deriveStability(structure) {
    if (structure.cohesion === "HIGH")
      return "HIGH_STABILITY";

    if (structure.cohesion === "MEDIUM")
      return "MEDIUM_STABILITY";

    if (structure.cohesion === "LOW")
      return "LOW_STABILITY";

    return "UNKNOWN";
  }

  /* ================= BREAK ================= */

  deriveBreak(structure) {
    if (structure.globalBreak === true)
      return "GLOBAL_BREAK";

    if (structure.localBreak === true)
      return "LOCAL_BREAK";

    return "NO_BREAK";
  }

  /* ================= CONTINUITY ================= */

  deriveContinuity(structure) {
    if (structure.closed === true)
      return "SUSTAINABLE";

    if (structure.open === true)
      return "AT_RISK";

    if (structure.fragmented === true)
      return "UNSUSTAINABLE";

    return "UNKNOWN";
  }

  /* ================= STATE ================= */

  deriveState(relation, stability, breakType) {
    if (breakType === "GLOBAL_BREAK")
      return "COLLAPSING";

    if (breakType === "LOCAL_BREAK")
      return "FRACTURED";

    if (stability === "LOW_STABILITY")
      return "DRIFTING";

    if (relation === "STRUCTURAL_IDENTITY")
      return "STABLE";

    if (relation === "STRUCTURAL_CONTAINMENT")
      return "CONTAINED";

    return "EMERGING";
  }
}
