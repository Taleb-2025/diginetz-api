export class TSL_STS {
  scan(previousEffect, currentEffect) {
    if (!currentEffect) return null;
    if (!previousEffect) return null;

    const prev = previousEffect;
    const curr = currentEffect;

    if (prev.container === curr.container) {
      if (curr.extension < curr.container) {
        return this.#state("STABLE", "CONTAINMENT_OK");
      }

      if (curr.extension === curr.container) {
        return this.#state("PRESSURE", "CONTAINER_FULL");
      }

      return this.#state("DEVIATION", "OVERFLOW");
    }

    if (
      curr.container > prev.container &&
      prev.extension !== prev.container
    ) {
      return this.#state("DEVIATION", "JUMP_WITHOUT_COMPLETION");
    }

    if (curr.container < prev.container) {
      return this.#state("DEVIATION", "REGRESSION");
    }

    return this.#state("DEVIATION", "UNEXPLAINED_SHIFT");
  }

  #state(level, reason) {
    return {
      layer: "STS",
      level,
      reason
    };
  }
}
