export class TSL_STS {
  scan(retroDelta) {
    if (!retroDelta) {
      return this.#state("STABLE", "NO_DELTA");
    }

    const { retro_status, retro_reason } = retroDelta;

    if (retro_status === "IMPOSSIBLE") {
      return this.#state("CRITICAL", retro_reason);
    }

    if (retro_status === "ANOMALY") {
      return this.#state("TENSION", retro_reason);
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
