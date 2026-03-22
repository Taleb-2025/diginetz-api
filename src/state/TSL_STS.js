export class TSL_STS {
  constructor(tslNDR, options = {}) {
    if (!tslNDR || typeof tslNDR.levelOf !== "function") {
      throw new Error("TSL_STS_REQUIRES_VALID_TSL_NDR");
    }

    this.tslNDR = tslNDR;

    this.maxDeviations = Number.isFinite(options.maxDeviations)
      ? Number(options.maxDeviations)
      : 50;

    this.deviationLog = [];
  }

  reset() {
    this.deviationLog = [];
  }

  getDeviations() {
    return [...this.deviationLog];
  }

  #storeDeviation(event) {
    this.deviationLog.push(event);

    if (this.deviationLog.length > this.maxDeviations) {
      this.deviationLog.shift();
    }
  }

  analyze(sequence) {
    if (!Array.isArray(sequence) || sequence.length < 2) {
      throw new Error("TSL_STS_REQUIRES_SEQUENCE_MIN_LENGTH_2");
    }

    const levels = sequence.map(H => {
      const lvl = this.tslNDR.levelOf(H);
      return lvl === null ? null : Number(lvl);
    });

    const transitions = [];
    const deviations = [];

    let prevDiff = null;

    for (let i = 1; i < levels.length; i++) {
      const prev = levels[i - 1];
      const curr = levels[i];

      if (prev === null || curr === null) continue;

      const diff = curr - prev;

      transitions.push({
        from: prev,
        to: curr,
        diff
      });

      // كشف الانحراف السلوكي داخل النسق
      if (prevDiff !== null) {
        const prevSign = Math.sign(prevDiff);
        const currSign = Math.sign(diff);

        if (prevSign !== 0 && currSign !== 0 && prevSign !== currSign) {
          const deviation = {
            type: "INTERNAL_BEHAVIOR_DEVIATION",
            at: i,
            from: prev,
            to: curr,
            previousStep: prevDiff,
            currentStep: diff,
            timestamp: Date.now()
          };

          deviations.push(deviation);
          this.#storeDeviation(deviation);
        }
      }

      prevDiff = diff;
    }

    return {
      transitions,
      deviations,
      deviationCount: deviations.length,
      storedDeviations: this.deviationLog.length
    };
  }
}
