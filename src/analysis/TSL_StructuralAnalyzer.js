export class TSL_StructuralAnalyzer {
  analyze(result) {
    if (!result?.effect) {
      return this.#unknownStructure();
    }

    const effect = result.effect;
    const delta = result.delta;

    const structure = this.#analyzeStructure(effect);
    const transition = this.#analyzeTransition(delta);
    const boundaries = this.#analyzeBoundaries(effect);
    const properties = this.#analyzeProperties(effect, delta);
    const classification = this.#classify(result);

    return {
      structure,
      transition,
      boundaries,
      properties,
      classification,
      narrative: this.#buildNarrative({
        structure,
        transition,
        boundaries,
        properties,
        classification
      }),
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

  #buildNarrative({ structure, transition, boundaries, properties, classification }) {
    if (classification.state === "STRUCTURAL_BREAK") {
      return `The structure was previously outside or beyond its valid boundary and suddenly returned inside the container. 
This transition violates structural continuity. 
A closed or exceeded structure cannot re-enter without a new structural cycle. 
This indicates a structural break in causality.`;
    }

    if (classification.state === "STRUCTURAL_TENSION") {
      return `The structure remains within its container but shows a non-monotonic transition. 
The flow does not strictly follow the expected forward containment logic. 
This represents structural tension without full collapse.`;
    }

    if (classification.state === "OUTSIDE_CONTAINER") {
      return `The extension has exceeded the container capacity. 
The structure is now beyond its defined boundary and cannot be considered structurally contained.`;
    }

    if (classification.state === "STRUCTURAL_COMPLETION") {
      return `The extension has reached the upper boundary of the container. 
The structural cycle is complete and no further forward progression is structurally valid.`;
    }

    if (classification.state === "STRUCTURE_STABLE") {
      return `The extension remains within the container. 
The transition preserves structural continuity and containment integrity.`;
    }

    return `The structural condition cannot be determined due to insufficient or undefined state information.`;
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
      narrative: "No structural data available.",
      raw: null
    };
  }
}
