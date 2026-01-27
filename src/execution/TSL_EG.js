// diginetz-api/src/execution/TSL_EG.js

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

      if (this.eventDropper) {
        const drop = this.eventDropper.evaluate(delta);
        if (drop?.dropped) {
          return {
            ok: true,
            phase: "ACCESS",
            dropped: true,
            reason: drop.reason,
            reference: referenceStructure,
            structure,
            delta
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
        reference: referenceStructure, // S0
        structure,                     // S1
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
