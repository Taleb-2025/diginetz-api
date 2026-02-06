export class TSL_Interpreter {
  interpret({ effect, sts, ae }) {
    // غياب وجودي → استحالة
    if (ae && ae.type === "ABSENT_EXECUTION") {
      return this.#state(
        "IMPOSSIBLE",
        "STRUCTURAL_GAP_DETECTED"
      );
    }

    // انحراف بنيوي بدون غياب
    if (sts && sts.level === "DEVIATION") {
      return this.#state(
        "DRIFTING",
        sts.reason
      );
    }

    // مسار سليم
    return this.#state(
      "STABLE",
      "PATH_VALID"
    );
  }

  #state(structural_state, reason) {
    return {
      structural_state,
      reason
    };
  }
}
