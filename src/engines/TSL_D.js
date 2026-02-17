export class TSL_D {

  derive(previous, current) {
    if (!previous || !current) {
      throw new Error("TSL_D_MISSING_STATE");
    }

    this.#assertPhaseIntegrity(previous);
    this.#assertPhaseIntegrity(current);

    const result = this.#evaluate(previous, current);

    return {
      from: previous.phase,
      to: current.phase,
      retro_status: result.status,
      retro_reason: result.reason
    };
  }

  #assertPhaseIntegrity(state) {
    const { symbol, extension, phase } = state;
    const expected = this.#resolvePhase(symbol, extension);

    if (expected !== phase) {
      throw new Error(
        `TSL_D_PHASE_INTEGRITY_VIOLATION: expected ${expected}, got ${phase}`
      );
    }
  }

  #resolvePhase(symbol, extension) {
    if (extension < symbol) return "BUILDING";
    if (extension === symbol) return "PEAK";
    return "DISINTEGRATION";
  }

  #evaluate(prev, curr) {

    if (prev.symbol === curr.symbol) {

      const allowed = this.#allowedWithinSymbol(curr.phase);

      if (!allowed.has(prev.phase)) {
        return {
          status: "IMPOSSIBLE",
          reason: "PREVIOUS_NOT_ALLOWED_FOR_CURRENT_STATE"
        };
      }

      return {
        status: "COMPATIBLE",
        reason: "STRUCTURAL_CONTAINMENT_CONFIRMED"
      };
    }

    if (curr.symbol === prev.symbol + 1) {

      if (
        (prev.phase === "PEAK" || prev.phase === "DISINTEGRATION") &&
        curr.phase === "BUILDING"
      ) {
        return {
          status: "COMPATIBLE",
          reason: "VALID_STRUCTURAL_TRANSFORMATION"
        };
      }

      return {
        status: "IMPOSSIBLE",
        reason: "INVALID_STRUCTURAL_TRANSFORMATION"
      };
    }

    return {
      status: "IMPOSSIBLE",
      reason: "NON_ADJACENT_SYMBOL_TRANSITION"
    };
  }

  #allowedWithinSymbol(phase) {
    const map = {
      BUILDING: new Set(["BUILDING"]),
      PEAK: new Set(["BUILDING"]),
      DISINTEGRATION: new Set(["PEAK", "DISINTEGRATION"])
    };

    return map[phase] || new Set();
  }
}
