export class TSL_StructuralAnalyzer {
  analyze(result) {
    if (!result?.effect) {
      return this.#unknownStructure();
    }

    const effect = result.effect;
    const delta = result.delta;

    return {
      structure: this.#analyzeStructure(effect),
      transition: this.#analyzeTransition(delta),
      boundaries: this.#analyzeBoundaries(effect),
      properties: this.#analyzeProperties(effect, delta),
      classification: this.#classify(result),
      raw: result
    };
  }

  #analyzeStructure(effect) {
    const { container, extension } = effect;

    return {
      container,
      extension,
      relation:
        extension < container
          ? "WITHIN"
          : extension === container
          ? "AT_BOUNDARY"
          : "BEYOND"
    };
  }

  #analyzeTransition(delta) {
    if (!delta?.from || !delta?.to) {
      return { type: "INITIAL" };
    }

    const { from, to, retro_status } = delta;

    let direction = "UNDEFINED";

    if (retro_status === "IMPOSSIBLE") {
      direction = "STRUCTURAL_BREAK";
    } else if (from === "DRAINING" && to === "DRAINING") {
      direction = "CONTINUING";
    } else if (from === "DRAINING" && to === "LAST_TRACE") {
      direction = "APPROACHING_BOUNDARY";
    } else if (from === "LAST_TRACE" && to === "ILLEGAL_TRACE") {
      direction = "EXCEEDING_BOUNDARY";
    }

    return {
      from,
      to,
      direction,
      retro_status
    };
  }

  #analyzeBoundaries(effect) {
    const { container, extension, containment } = effect;

    return {
      container,
      extension,
      containment,
      atBoundary: containment === "LAST_TRACE",
      outside: containment === "ILLEGAL_TRACE"
    };
  }

  #analyzeProperties(effect, delta) {
    const { containment } = effect;
    const retro_status = delta?.retro_status;

    return {
      isInside: containment === "DRAINING",
      isAtEdge: containment === "LAST_TRACE",
      isOutside: containment === "ILLEGAL_TRACE",
      isImpossible: retro_status === "IMPOSSIBLE",
      hasAnomaly: retro_status === "ANOMALY"
    };
  }

  #classify(result) {
    const retroStatus = result.delta?.retro_status;
    const containment = result.effect?.containment;

    if (retroStatus === "IMPOSSIBLE") {
      return {
        state: "STRUCTURAL_BREAK",
        severity: "CRITICAL"
      };
    }

    if (retroStatus === "ANOMALY") {
      return {
        state: "STRUCTURAL_TENSION",
        severity: "WARNING"
      };
    }

    if (containment === "ILLEGAL_TRACE") {
      return {
        state: "OUTSIDE_CONTAINER",
        severity: "ERROR"
      };
    }

    if (containment === "LAST_TRACE") {
      return {
        state: "STRUCTURAL_COMPLETION",
        severity: "INFO"
      };
    }

    if (containment === "DRAINING") {
      return {
        state: "STRUCTURE_STABLE",
        severity: "NORMAL"
      };
    }

    return {
      state: "UNDEFINED_STATE",
      severity: "UNKNOWN"
    };
  }

  #unknownStructure() {
    return {
      structure: null,
      transition: null,
      boundaries: null,
      properties: null,
      classification: {
        state: "UNKNOWN_STRUCTURE",
        severity: "UNKNOWN"
      },
      raw: null
    };
  }
}
