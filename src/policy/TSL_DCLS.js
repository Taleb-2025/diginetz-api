export class TSL_DCLS {
  observe({ delta, ae }) {

    if (ae && ae.type === "ABSENT_EXECUTION") {
      return {
        excluded: true,
        severity: "CRITICAL",
        reason: ae.reason || "STRUCTURAL_IMPOSSIBILITY"
      };
    }

    if (delta && delta.retro_status === "ANOMALY") {
      return {
        excluded: false,
        severity: "WARNING",
        reason: delta.retro_reason
      };
    }

    return {
      excluded: false,
      severity: "NONE",
      reason: null
    };
  }

  reset() {}
}
