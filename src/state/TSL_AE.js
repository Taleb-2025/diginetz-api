export class TSL_AE {

  constructor(structureDefinition) {
    if (!structureDefinition || typeof structureDefinition !== "object") {
      throw new Error("TSL_AE_INVALID_STRUCTURE");
    }

    this.structure = structureDefinition;
  }

  observe(previous, current) {
    if (!previous || !current) return null;

    const absence = this.#detectInvalidTransformation(previous, current);
    if (!absence) return null;

    return {
      layer: "AE",
      type: "ABSENT_EXECUTION",
      reason: absence.reason,
      from: {
        level: previous.level,
        position: previous.position,
        phase: previous.phase
      },
      to: {
        level: current.level,
        position: current.position,
        phase: current.phase
      }
    };
  }

  #detectInvalidTransformation(prev, curr) {

    if (prev.level !== curr.level) return null;

    const levelStructure = this.structure[prev.level];
    if (!levelStructure || !levelStructure.transitions) {
      return {
        reason: "UNDEFINED_LEVEL_STRUCTURE"
      };
    }

    const transitions = levelStructure.transitions;
    const allowedNext = transitions[prev.position];

    if (!allowedNext) {
      return {
        reason: "UNDEFINED_SOURCE_POSITION"
      };
    }

    const isAllowed =
      Array.isArray(allowedNext)
        ? allowedNext.includes(curr.position)
        : allowedNext instanceof Set
          ? allowedNext.has(curr.position)
          : false;

    if (!isAllowed) {
      return {
        reason: "INVALID_STRUCTURAL_TRANSFORMATION"
      };
    }

    return null;
  }

  reset() {}
}
