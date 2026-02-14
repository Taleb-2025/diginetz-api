export class TSL_Interpreter {
  interpret({ delta, sts, ae }) {
    if (ae && ae.type === "ABSENT_EXECUTION") {
      return {
        status: "IMPOSSIBLE",
        reason: ae.reason
      };
    }

    if (delta && delta.retro_status === "ANOMALY") {
      return {
        status: "ANOMALOUS",
        reason: delta.retro_reason
      };
    }

    return {
      status: "STABLE",
      reason: "STRUCTURALLY_COMPATIBLE"
    };
  }
}
