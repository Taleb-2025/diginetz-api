export class TSL_AE {
  constructor(tslNDR, options = {}) {
    if (!tslNDR || typeof tslNDR.levelOf !== "function") {
      throw new Error("TSL_AE_REQUIRES_VALID_TSL_NDR");
    }

    this.tslNDR = tslNDR;

    this.maxAbsences = Number.isFinite(options.maxAbsences)
      ? Number(options.maxAbsences)
      : 50;

    this.absenceLog = [];
  }

  reset() {
    this.absenceLog = [];
  }

  getAbsences() {
    return [...this.absenceLog];
  }

  #storeAbsence(event) {
    this.absenceLog.push(event);

    if (this.absenceLog.length > this.maxAbsences) {
      this.absenceLog.shift();
    }
  }

  analyze(sequence) {
    if (!Array.isArray(sequence) || sequence.length < 2) {
      throw new Error("TSL_AE_REQUIRES_SEQUENCE_MIN_LENGTH_2");
    }

    const missing = [];

    const levels = sequence.map(H => {
      const lvl = this.tslNDR.levelOf(H);
      return lvl === null ? null : Number(lvl);
    });

    for (let i = 1; i < levels.length; i++) {
      const prev = levels[i - 1];
      const curr = levels[i];

      if (prev === null || curr === null) continue;

      const diff = curr - prev;

      if (Math.abs(diff) > 1) {
        const step = diff > 0 ? 1 : -1;
        let expected = prev + step;

        while (expected !== curr) {
          const event = {
            type: "ABSENCE_EVENT",
            expectedLevel: expected,
            between: [prev, curr],
            index: i,
            timestamp: Date.now()
          };

          missing.push(event);

          this.#storeAbsence(event);

          expected += step;
        }
      }
    }

    return {
      missing,
      hasAbsence: missing.length > 0,
      totalStoredAbsences: this.absenceLog.length
    };
  }
}
