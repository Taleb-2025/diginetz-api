export class TSL_D {
  derive(previous, current) {
    if (!previous || !current) {
      throw new Error("TSL_D_MISSING_STATE");
    }

    const retro = this.#retroEvaluate(previous, current);

    return {
      from: previous.containment,
      to: current.containment,
      retro_status: retro.status,   // COMPATIBLE | ANOMALY | IMPOSSIBLE
      retro_reason: retro.reason
    };
  }

  #retroEvaluate(prev, curr) {

    // 1) Non-monotonic flow inside same container → ANOMALY (not impossible)
    if (prev.container === curr.container) {
      if (
        prev.containment === "DRAINING" &&
        curr.containment === "DRAINING"
      ) {
        if (curr.extension > prev.extension) {
          return {
            status: "ANOMALY",
            reason: "NON_MONOTONIC_FLOW_WITHIN_CONTAINER"
          };
        }
      }
    }

    // 2) Container change without completion → ANOMALY (reported but not blocked)
    if (prev.container !== curr.container) {
      if (prev.containment !== "LAST_TRACE") {
        return {
          status: "ANOMALY",
          reason: "CONTAINER_CHANGE_WITHOUT_COMPLETION"
        };
      }
    }

    // 3) Logical boundary violations → IMPOSSIBLE (true structural break)

    if (curr.containment === "DRAINING") {
      if (
        prev.containment === "LAST_TRACE" ||
        prev.containment === "ILLEGAL_TRACE"
      ) {
        return {
          status: "IMPOSSIBLE",
          reason: "DRAINING_NOT_ALLOWED_AFTER_BOUNDARY"
        };
      }
    }

    if (curr.containment === "LAST_TRACE") {
      if (prev.containment !== "DRAINING") {
        return {
          status: "IMPOSSIBLE",
          reason: "LAST_TRACE_REQUIRES_PREVIOUS_DRAINING"
        };
      }
    }

    if (curr.containment === "ILLEGAL_TRACE") {
      if (prev.containment !== "LAST_TRACE") {
        return {
          status: "IMPOSSIBLE",
          reason: "ILLEGAL_TRACE_REQUIRES_PREVIOUS_LAST_TRACE"
        };
      }
    }

    return {
      status: "COMPATIBLE",
      reason: "RETRO_COMPATIBLE"
    };
  }
}
