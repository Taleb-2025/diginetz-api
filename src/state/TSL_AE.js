export class TSL_AE {
  observe(retroDelta) {
    if (!retroDelta) return null;

    if (retroDelta.retro_valid === false) {
      return {
        layer: "AE",
        type: "ABSENT_EXECUTION",
        reason: retroDelta.retro_reason,
        effect: "STRUCTURAL_IMPOSSIBILITY"
      };
    }

    return null;
  }

  reset() {}
}
