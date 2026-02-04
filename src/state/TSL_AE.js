export class TSL_AE {
  constructor() {
    this._lastEffect = null;
  }

  observe(currentEffect) {
    if (!currentEffect) {
      return null;
    }

    if (!this._lastEffect) {
      this._lastEffect = currentEffect;
      return null;
    }

    const ae = this.#detectAbsence(this._lastEffect, currentEffect);

    this._lastEffect = currentEffect;

    return ae;
  }

  #detectAbsence(previous, current) {
    if (
      previous.status === "CONTAINED" &&
      current.status === "BROKEN"
    ) {
      return this.#absence("CONTAINMENT_ABSENT");
    }

    if (
      previous.status === "FULL" &&
      current.status === "BROKEN"
    ) {
      return this.#absence("SATURATION_RESOLUTION_ABSENT");
    }

    return null;
  }

  #absence(reason) {
    return {
      layer: "AE",
      type: "ABSENT_EXECUTION",
      reason
    };
  }

  reset() {
    this._lastEffect = null;
  }
}
