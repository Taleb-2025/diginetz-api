// diginetz-api/src/engines/TSL_D.js

export class TSL_D {
  derive(previous, current) {
    if (!previous || !current) {
      throw new Error("TSL_D_MISSING_STATE");
    }

    if (!previous.containment || !current.containment) {
      throw new Error("TSL_D_INVALID_STATE");
    }

    return {
      from: previous.containment,
      to: current.containment,
      effect: this.#effect(previous, current)
    };
  }

  #effect(prev, curr) {
    if (prev.containment === "CONTAINED" && curr.containment === "CONTAINED") {
      return "STABLE";
    }

    if (prev.containment === "CONTAINED" && curr.containment === "SATURATED") {
      return "PRESSURE";
    }

    if (curr.containment === "BROKEN") {
      return "RUPTURE";
    }

    if (prev.containment === "SATURATED" && curr.containment === "CONTAINED") {
      return "RELEASE";
    }

    return "TRANSITION";
  }
}
