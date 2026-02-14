export class TSL_D {
  derive(previous, current) {
    if (!previous || !current) {
      throw new Error("TSL_D_MISSING_STATE");
    }

    const retro = this.#retroValidate(previous, current);

    return {
      from: previous.placement,
      to: current.placement,
      retro_valid: retro.valid,
      retro_reason: retro.reason
    };
  }

  #retroValidate(prev, curr) {
    if (curr.placement === "INSIDE") {
      if (
        prev.placement === "EDGE" ||
        prev.placement === "OUTSIDE"
      ) {
        return {
          valid: false,
          reason: "CURRENT_INSIDE_INVALIDATES_PREVIOUS_BOUNDARY"
        };
      }
    }

    if (curr.placement === "EDGE") {
      if (prev.placement !== "INSIDE") {
        return {
          valid: false,
          reason: "EDGE_REQUIRES_PREVIOUS_INSIDE"
        };
      }
    }

    if (curr.placement === "OUTSIDE") {
      if (prev.placement !== "EDGE") {
        return {
          valid: false,
          reason: "OUTSIDE_REQUIRES_PREVIOUS_EDGE"
        };
      }
    }

    return { valid: true, reason: "RETRO_COMPATIBLE" };
  }
}
