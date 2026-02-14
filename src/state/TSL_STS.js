export class TSL_STS {
  scan(retroDelta) {
    if (!retroDelta) {
      return this.#state("STABLE", "NO_DELTA");
    }

    if (retroDelta.retro_valid === false) {
      return this.#state("DEVIATION", retroDelta.retro_reason);
    }

    return this.#state("STABLE", "STRUCTURALLY_COMPATIBLE");
  }

  #state(level, reason) {
    return {
      layer: "STS",
      level,
      reason
    };
  }

  reset() {}
}
