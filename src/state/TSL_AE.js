export class TSL_AE {
  observe(delta) {
    if (!delta) return null;

    if (delta.retro_status === "IMPOSSIBLE") {
      return {
        layer: "AE",
        type: "ABSENT_EXECUTION",
        reason: delta.retro_reason,
        effect: "STRUCTURAL_IMPOSSIBILITY"
      };
    }

    return null;
  }

  reset() {}
}
