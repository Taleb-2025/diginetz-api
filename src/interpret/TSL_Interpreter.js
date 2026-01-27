// diginetz-api/src/interpret/TSL_Interpreter.js
// ----------------------------------------------
// TSL_Interpreter (Law-Based, Non-Temporal)
// Interprets ONLY structural laws + delta result
// Compatible with:
// - TSL_NDR (length, order, continuity, boundaries)
// - TSL_D   (identical, contained, overlap, diverged, changes)
// ----------------------------------------------

export class TSL_Interpreter {

  interpret({ structure, delta }) {
    if (!structure || !delta) {
      return this.#undefined();
    }

    const relation_type = this.#relation(delta);
    const structural_break = this.#break(delta);
    const stability = this.#stability(delta);
    const continuity = this.#continuity(structure, delta);
    const structural_state =
      this.#state(relation_type, stability, structural_break);

    return {
      structural_state,
      relation_type,
      stability,
      structural_break,
      continuity
    };
  }

  /* ================= RELATION ================= */

  #relation(delta) {
    if (delta.identical) return "STRUCTURAL_IDENTITY";
    if (delta.contained) return "STRUCTURAL_CONTAINMENT";
    if (delta.overlap)   return "STRUCTURAL_OVERLAP";
    if (delta.diverged)  return "STRUCTURAL_DIVERGENCE";
    return "UNKNOWN";
  }

  /* ================= BREAK ================= */

  #break(delta) {
    const laws = delta.changes.map(c => c.law);

    if (laws.includes("ORDER") || laws.includes("BOUNDARIES")) {
      return "GLOBAL_BREAK";
    }

    if (laws.includes("CONTINUITY")) {
      return "LOCAL_BREAK";
    }

    return "NO_BREAK";
  }

  /* ================= STABILITY ================= */

  #stability(delta) {
    if (delta.identical) return "HIGH_STABILITY";

    if (delta.contained && delta.deltaCount <= 1) {
      return "MEDIUM_STABILITY";
    }

    return "LOW_STABILITY";
  }

  /* ================= CONTINUITY ================= */

  #continuity(structure, delta) {
    if (!structure?.continuity) return "UNKNOWN";

    if (structure.continuity.length === 1 && delta.identical) {
      return "SUSTAINABLE";
    }

    if (delta.contained) {
      return "AT_RISK";
    }

    return "UNSUSTAINABLE";
  }

  /* ================= STATE ================= */

  #state(relation, stability, breakType) {
    if (breakType === "GLOBAL_BREAK") return "COLLAPSING";
    if (breakType === "LOCAL_BREAK")  return "FRACTURED";

    if (relation === "STRUCTURAL_IDENTITY" && stability === "HIGH_STABILITY") {
      return "STABLE";
    }

    if (relation === "STRUCTURAL_CONTAINMENT" && stability !== "LOW_STABILITY") {
      return "CONTAINED";
    }

    if (stability === "LOW_STABILITY") {
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
