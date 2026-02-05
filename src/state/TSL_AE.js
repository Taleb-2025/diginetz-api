export class TSL_AE {
  observe(previousEffect, currentEffect) {
    if (!previousEffect || !currentEffect) return null;

    const prev = previousEffect;
    const curr = currentEffect;

    if (
      curr.container > prev.container &&
      prev.containment !== "LAST_TRACE"
    ) {
      return {
        layer: "AE",
        type: "ABSENT_EXECUTION",
        reason: "IMPOSSIBLE_ARRIVAL",
        effect: "STRUCTURAL_GAP"
      };
    }

    if (curr.containment === "ILLEGAL_TRACE") {
      return {
        layer: "AE",
        type: "ABSENT_EXECUTION",
        reason: "PATH_IMPOSSIBLE",
        effect: "STRUCTURAL_GAP"
      };
    }

    return null;
  }

  reset() {}
}
