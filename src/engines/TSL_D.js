export class TSL_D {
  derive(previous, current) {
    if (!previous || !current) {
      throw new Error("TSL_D_MISSING_STATE");
    }

    const prev = previous.containment;
    const curr = current.containment;

    if (!prev || !curr) {
      throw new Error("TSL_D_INVALID_STATE");
    }

    return {
      from: prev,
      to: curr,
      effect: this.#effect(prev, curr)
    };
  }

  #effect(prev, curr) {
    if (prev === "DRAINING" && curr === "DRAINING") {
      return "CONTINUITY";
    }

    if (prev === "DRAINING" && curr === "LAST_TRACE") {
      return "COMPLETION";
    }

    if (prev === "LAST_TRACE" && curr === "ILLEGAL_TRACE") {
      return "ILLEGAL_TRANSITION";
    }

    if (curr === "ILLEGAL_TRACE") {
      return "RUPTURE";
    }

    if (prev === "LAST_TRACE" && curr === "DRAINING") {
      return "RESET_FLOW";
    }

    return "TRANSITION";
  }
}
