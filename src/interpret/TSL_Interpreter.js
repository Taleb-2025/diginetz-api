// diginetz-api/src/interpret/TSL_Interpreter.js
// ----------------------------------------------
// TSL_Interpreter (STRICT LAW-BASED)
// ----------------------------------------------
// قواعد صارمة:
// - لا وصف
// - لا عدّ
// - لا فحص شكل داخلي
// - يعتمد فقط على:
//   • قوانين تغيّرت (delta.changes[].law)
//   • علاقات delta (identical / contained / overlap / diverged)
// ----------------------------------------------

export class TSL_Interpreter {

  interpret({ delta }) {
    if (!delta || typeof delta !== "object") {
      return this.#undefined();
    }

    const relation_type     = this.#relation(delta);
    const structural_break  = this.#break(delta);
    const stability         = this.#stability(delta);
    const continuity        = this.#continuity(delta);
    const structural_state  =
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
    if (delta.identical) {
      return "HIGH_STABILITY";
    }

    if (delta.contained) {
      return "MEDIUM_STABILITY";
    }

    return "LOW_STABILITY";
  }

  /* ================= CONTINUITY ================= */

  #continuity(delta) {
    const laws = delta.changes.map(c => c.law);

    if (delta.identical) {
      return "SUSTAINABLE";
    }

    if (!laws.includes("ORDER") && !laws.includes("BOUNDARIES")) {
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
