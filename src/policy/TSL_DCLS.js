export class TSL_DCLS {
  constructor() {
    this.reset();
  }

  observe({ sts, ae }) {
    if (sts) {
      this.#eliminateBySTS(sts);
    }

    if (ae) {
      this.#eliminateByAE(ae);
    }

    return this.constraints();
  }

  #eliminateBySTS(sts) {
    if (sts.level === "DEVIATION") {
      this._constraints.allowContainment = false;
    }
  }

  #eliminateByAE(ae) {
    if (ae.reason === "PATH_INTERRUPTED") {
      this._constraints.allowContainment = false;
    }
  }

  constraints() {
    return { ...this._constraints };
  }

  reset() {
    this._constraints = {
      allowContainment: true,
      allowPressure: true,
      allowRupture: true
    };
  }
}
