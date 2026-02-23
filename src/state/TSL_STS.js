export class TSL_STS {

  scan(delta, ae) {

    if (!delta) {
      return this.#state("STABLE", "NO_DELTA");
    }

    if (delta.retro_status === "IMPOSSIBLE") {
      return this.#state("CRITICAL", delta.retro_reason);
    }

    if (ae && ae.type === "ABSENT_EXECUTION") {
      return this.#state("TENSION", ae.reason);
    }

    if (delta.retro_status === "ANOMALY") {
      return this.#state("TENSION", delta.retro_reason);
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
