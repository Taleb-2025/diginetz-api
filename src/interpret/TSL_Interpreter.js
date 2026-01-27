// diginetz-api/src/interpret/TSL_Interpreter.js
// ----------------------------------------------
// TSL_Interpreter (Enhanced)
// Interprets STRUCTURE + DELTA (from TSL_NDR + TSL_D)
// Structure defines relation
// Delta defines intensity / drift / break severity
// ----------------------------------------------

export class TSL_Interpreter {

  interpret({ structure, reference, delta }) {
    if (!structure || typeof structure !== "object") {
      return this.#undefined();
    }

    const relation_type = this.#deriveRelation(structure, reference);
    const stability = this.#deriveStability(structure, delta);
    const structural_break = this.#deriveBreak(structure, reference, delta);
    const continuity = this.#deriveContinuity(structure, delta);
    const structural_state =
      this.#deriveState(relation_type, stability, structural_break, delta);

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

    if (S1.fingerprint === S0.fingerprint) {
      return "STRUCTURAL_IDENTITY";
    }

    if (this.#isContained(S1.topology, S0.topology)) {
      return "STRUCTURAL_CONTAINMENT";
    }

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

  #deriveStability(structure, delta) {
    if (!delta) return "UNKNOWN";

    if (delta.volatility === "STABLE" && delta.pressure === "LOW") {
      return "HIGH_STABILITY";
    }

    if (delta.volatility === "MODERATE" || delta.pressure === "MEDIUM") {
      return "MEDIUM_STABILITY";
    }

    return "LOW_STABILITY";
  }

  /* ================= BREAK ================= */

  #deriveBreak(S1, S0, delta) {
    if (!S0 || !delta) return "NO_BREAK";

    if (delta.deformation === "GLOBAL") {
      return "GLOBAL_BREAK";
    }

    if (delta.deformation === "LOCAL") {
      return "LOCAL_BREAK";
    }

    return "NO_BREAK";
  }

  /* ================= CONTINUITY ================= */

  #deriveContinuity(structure, delta) {
    if (!delta) return "UNKNOWN";

    if (delta.structuralTrend === "STABILIZING") {
      return "SUSTAINABLE";
    }

    if (delta.structuralTrend === "DRIFTING") {
      return "AT_RISK";
    }

    return "UNSUSTAINABLE";
  }

  /* ================= STATE ================= */

  #deriveState(relation, stability, breakType, delta) {
    if (breakType === "GLOBAL_BREAK") return "COLLAPSING";
    if (breakType === "LOCAL_BREAK") return "FRACTURED";

    if (relation === "STRUCTURAL_IDENTITY" && stability === "HIGH_STABILITY") {
      return "STABLE";
    }

    if (relation === "STRUCTURAL_CONTAINMENT" && stability !== "LOW_STABILITY") {
      return "CONTAINED";
    }

    if (delta?.structuralTrend === "CHAOTIC") {
      return "DRIFTING";
    }

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
