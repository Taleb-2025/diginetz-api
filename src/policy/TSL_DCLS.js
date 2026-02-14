export class TSL_DCLS {
  observe({ ae }) {
    if (ae && ae.type === "ABSENT_EXECUTION") {
      return {
        excluded: true,
        reason: ae.reason || "STRUCTURAL_IMPOSSIBILITY",
        message: "Detected an impossible event: " + (ae.reason || "Structural impossibility.")
      };
    }

    return {
      excluded: false,
      reason: null,
      message: "No impossibilities detected, structure is stable."
    };
  }

  reset() {}
}
