export class TSL_EG {
  constructor({
    ndr,
    d,
    sts,
    ae,
    eventDropper
  }) {
    if (!ndr || !d) {
      throw new Error("TSL_EG_MISSING_CORE");
    }

    this.ndr = ndr;
    this.d = d;
    this.sts = sts;
    this.ae = ae;
    this.eventDropper = eventDropper;
  }

  executeWithReference(referenceStructure, numericInput, context = {}) {
    if (!referenceStructure || typeof referenceStructure !== "object") {
      return {
        ok: false,
        phase: "ACCESS",
        reason: "INVALID_REFERENCE"
      };
    }

    if (!Array.isArray(numericInput)) {
      return {
        ok: false,
        phase: "ACCESS",
        reason: "INVALID_INPUT_TYPE"
      };
    }

    for (const v of numericInput) {
      if (typeof v !== "number" || Number.isNaN(v)) {
        return {
          ok: false,
          phase: "ACCESS",
          reason: "NON_NUMERIC_INPUT"
        };
      }
    }

    const run = () => {
      const structure = this.ndr.extract(numericInput);
      const delta = this.d.derive(referenceStructure, structure);

      /* ================= STRUCTURAL RELATION DERIVATION ================= */

      // identity: نفس البصمة ونفس الطول
      structure.identity =
        structure.fingerprint === referenceStructure.fingerprint &&
        structure.length === referenceStructure.length;

      // containment: نفس البصمة لكن بطول أصغر أو مساوي
      structure.contained =
        structure.fingerprint === referenceStructure.fingerprint &&
        structure.length <= referenceStructure.length &&
        !structure.identity;

      // overlap: تشابه جزئي بدون احتواء
      structure.overlap =
        structure.fingerprint === referenceStructure.fingerprint &&
        structure.length !== referenceStructure.length;

      // divergence: بصمة مختلفة
      structure.diverged =
        structure.fingerprint !== referenceStructure.fingerprint;

      /* ================= EVENT DROPPER ================= */

      if (this.eventDropper) {
        const drop = this.eventDropper.evaluate(delta);
        if (drop?.dropped) {
          return {
            ok: true,
            phase: "ACCESS",
            dropped: true,
            reason: drop.reason
          };
        }
      }

      const trace = this.sts ? this.sts.observe(structure) : null;

      const aeReport = this.ae
        ? this.ae.guard(
            () => true,
            { name: "TSL_EG_EXECUTION", expectEffect: () => true },
            context
          ).report
        : null;

      return {
        ok: true,
        phase: "ACCESS",
        structure,
        delta,
        trace,
        ae: aeReport
      };
    };

    if (this.ae) {
      const guarded = this.ae.guard(
        run,
        { name: "TSL_EG_PIPELINE", expectEffect: () => true },
        context
      );

      if (guarded.report?.securityFlag !== "OK") {
        return {
          ok: false,
          phase: "ACCESS",
          reason: "AE_PIPELINE_BLOCKED",
          ae: guarded.report
        };
      }

      return guarded.result;
    }

    return run();
  }
}
