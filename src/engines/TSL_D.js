export class TSL_D {
  derive(previous, current) {
    if (!previous || typeof previous !== "object") {
      throw new Error("TSL_D_INVALID_PREVIOUS_STATE");
    }

    if (!current || typeof current !== "object") {
      throw new Error("TSL_D_INVALID_CURRENT_STATE");
    }

    if (!previous.phase || !current.phase) {
      throw new Error("TSL_D_MISSING_PHASE");
    }

    if (!previous.level || !current.level) {
      throw new Error("TSL_D_MISSING_LEVEL");
    }

    const result = this.#evaluate(previous, current);

    return {
      from: {
        level: previous.level,
        position: previous.position,
        phase: previous.phase,
        zone: previous.zone
      },
      to: {
        level: current.level,
        position: current.position,
        phase: current.phase,
        zone: current.zone
      },
      retro_status: result.status,
      retro_reason: result.reason,
      meaning: result.meaning
    };
  }

  #evaluate(prev, curr) {
    if (curr.phase === "UNDEFINED") {
      return {
        status: "IMPOSSIBLE",
        reason: "UNDEFINED_POSITION",
        meaning: "Current position is outside defined structure"
      };
    }

    if (prev.phase === "UNDEFINED") {
      return {
        status: "IMPOSSIBLE",
        reason: "PREVIOUS_UNDEFINED",
        meaning: "Previous position was outside defined structure"
      };
    }

    if (prev.level === curr.level && curr.zone !== "TRANSITION") {
      return this.#evaluateWithinLevel(prev, curr);
    }

    if (prev.level === curr.level && curr.zone === "TRANSITION") {
      return this.#evaluateEnteringStair(prev, curr);
    }

    if (prev.level !== curr.level) {
      return this.#evaluateLevelTransition(prev, curr);
    }

    return {
      status: "IMPOSSIBLE",
      reason: "UNHANDLED_CASE",
      meaning: "Unhandled transition case"
    };
  }

  #evaluateWithinLevel(prev, curr) {
    const allowed = this.#allowedWithinLevel(prev.phase);

    if (!allowed.has(curr.phase)) {
      return {
        status: "IMPOSSIBLE",
        reason: "INVALID_PHASE_SEQUENCE",
        meaning: `Cannot transition from ${prev.phase} to ${curr.phase} within same level`
      };
    }

    return {
      status: "COMPATIBLE",
      reason: "VALID_WITHIN_LEVEL",
      meaning: `Valid transition from ${prev.phase} to ${curr.phase} within Level ${curr.level}`
    };
  }

  #evaluateEnteringStair(prev, curr) {
    if (prev.phase !== "PEAK") {
      return {
        status: "IMPOSSIBLE",
        reason: "STAIR_REQUIRES_PEAK",
        meaning: "Can only enter STAIR from PEAK"
      };
    }

    if (curr.phase !== "STAIR") {
      return {
        status: "IMPOSSIBLE",
        reason: "INVALID_STAIR_ENTRY",
        meaning: "STAIR zone must have STAIR phase"
      };
    }

    return {
      status: "COMPATIBLE",
      reason: "VALID_STAIR_ENTRY",
      meaning: `Entered transition stair from Level ${prev.level} PEAK`
    };
  }

  #evaluateLevelTransition(prev, curr) {
    const prevLevelNum = Number(prev.level);
    const currLevelNum = Number(curr.level);

    if (isNaN(prevLevelNum) || isNaN(currLevelNum)) {
      return {
        status: "IMPOSSIBLE",
        reason: "INVALID_LEVEL_NUMBER",
        meaning: "Level must be numeric"
      };
    }

    if (currLevelNum < prevLevelNum) {
      return {
        status: "IMPOSSIBLE",
        reason: "LEVEL_REGRESSION",
        meaning: `Cannot go back from Level ${prev.level} to Level ${curr.level}`
      };
    }

    if (currLevelNum > prevLevelNum + 1) {
      return {
        status: "IMPOSSIBLE",
        reason: "NON_ADJACENT_LEVEL",
        meaning: `Cannot skip from Level ${prev.level} to Level ${curr.level} without passing through intermediate levels`
      };
    }

    if (prev.phase !== "STAIR") {
      return {
        status: "IMPOSSIBLE",
        reason: "LEVEL_CHANGE_REQUIRES_STAIR",
        meaning: "Must pass through STAIR before changing level"
      };
    }

    if (curr.phase !== "BUILDING") {
      return {
        status: "IMPOSSIBLE",
        reason: "NEW_LEVEL_MUST_START_BUILDING",
        meaning: "New level must start with BUILDING phase"
      };
    }

    return {
      status: "COMPATIBLE",
      reason: "VALID_LEVEL_TRANSITION",
      meaning: `Valid transition from Level ${prev.level} to Level ${curr.level}`
    };
  }

  #allowedWithinLevel(phase) {
    const transitions = {
      BUILDING: new Set(["BUILDING", "PEAK"]),
      PEAK: new Set(["PEAK"]),
      STAIR: new Set(["STAIR"]),
      UNDEFINED: new Set([])
    };

    return transitions[phase] || new Set();
  }

  reset() {}
}
