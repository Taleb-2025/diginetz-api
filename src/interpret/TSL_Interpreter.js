// diginetz-api/src/interpret/TSL_Interpreter.js
// ----------------------------------------------
// TSL_Interpreter
// Interprets STRUCTURE ONLY (from TSL_NDR)
// Identity / Containment / Divergence
// ----------------------------------------------

export class TSL_Interpreter {

  interpret({ structure, reference }) {
    if (!structure || typeof structure !== "object") {
      return this.#undefined();
    }

    const relation_type = this.#deriveRelation(structure, reference);
    const stability = this.#deriveStability(structure);
    const structural_break = this.#deriveBreak(structure, reference);
    const continuity = this.#deriveContinuity(structure);
    const structural_state =
      this.#deriveState(relation_type, stability, structural_break);

    return {
      structural_state,
      relation_type,
      stability,
      structural_break,
      continuity
    };
  }

  /* ================= RELATION ================= */

  #deriveRelation(S1, S0) {
    if (!S0) return "UNKNOWN";

    // 1) IDENTITY — same structure fingerprint
    if (S1.fingerprint === S0.fingerprint) {
      return "STRUCTURAL_IDENTITY";
    }

    // 2) CONTAINMENT — S1 topology is fully inside S0 topology
    if (this.#isContained(S1.topology, S0.topology)) {
      return "STRUCTURAL_CONTAINMENT";
    }

    // 3) DIVERGENCE — anything else
    return "STRUCTURAL_DIVERGENCE";
  }

  #isContained(inner, outer) {
    if (!Array.isArray(inner) || !Array.isArray(outer)) return false;
    if (inner.length > outer.length) return false;

    let j = 0;
    for (let i = 0; i < outer.length && j < inner.length; i++) {
      if (outer[i] === inner[j]) j++;
    }
    return j === inner.length;
  }

  /* ================= STABILITY ================= */

  #deriveStability(structure) {
    if (structure.runs.length <= 2) return "HIGH_STABILITY";
    if (structure.runs.length <= 4) return "MEDIUM_STABILITY";
    return "LOW_STABILITY";
  }

  /* ================= BREAK ================= */

  #deriveBreak(S1, S0) {
    if (!S0) return "NO_BREAK";

    if (
      S1.topology.length !== S0.topology.length &&
      !this.#isContained(S1.topology, S0.topology)
    ) {
      return "GLOBAL_BREAK";
    }

    if (S1.topology.length !== S0.topology.length) {
      return "LOCAL_BREAK";
    }

    return "NO_BREAK";
  }

  /* ================= CONTINUITY ================= */

  #deriveContinuity(structure) {
    if (structure.pattern === "STATIC") return "SUSTAINABLE";
    if (structure.pattern === "MIXED") return "AT_RISK";
    return "UNSUSTAINABLE";
  }

  /* ================= STATE ================= */

  #deriveState(relation, stability, breakType) {
    if (breakType === "GLOBAL_BREAK") return "COLLAPSING";
    if (breakType === "LOCAL_BREAK") return "FRACTURED";
    if (relation === "STRUCTURAL_IDENTITY") return "STABLE";
    if (relation === "STRUCTURAL_CONTAINMENT") return "CONTAINED";
    if (stability === "LOW_STABILITY") return "DRIFTING";
    return "EMERGING";
  }

  #undefined() {
    return {
      structural_state: "UNDEFINED",
      relation_type: "UNKNOWN",
      stability: "UNKNOWN",
      structural_break: "UNKNOWN",
      continuity: "UNKNOWN"
    };
  }
}
