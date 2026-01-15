// diginetz-api/src/execution/TSL_EG.js

export class TSL_EG {
  constructor({
    ndr,
    d,
    rv,
    sts,
    ae,
    decision,
    eventDropper
  }) {
    if (!ndr || !d || !rv || !decision) {
      throw new Error("TSL_EG_MISSING_CORE");
    }

    this.ndr = ndr;
    this.d = d;
    this.rv = rv;
    this.sts = sts;
    this.ae = ae;
    this.decision = decision;
    this.eventDropper = eventDropper;
  }

  init(input, context = {}) {
    if (this.rv.isInitialized()) {
      return {
        ok: false,
        phase: "INIT",
        reason: "ALREADY_INITIALIZED"
      };
    }

    const structure = this.ndr.extract(input);
    this.rv.init(structure);

    return {
      ok: true,
      phase: "INIT",
      reference: this.rv.meta()
    };
  }

  execute(input, context = {}) {
    if (!this.rv.isInitialized()) {
      return {
        ok: false,
        phase: "ACCESS",
        reason: "REFERENCE_NOT_INITIALIZED"
      };
    }

    const run = () => {
      const S0 = this.rv.get();
      const S1 = this.ndr.extract(input);

      const containment = this.d.contain(S0, S1);

      /* ================= Event Dropping ================= */
      if (this.eventDropper) {
        const drop = this.eventDropper.evaluate(containment.delta);
        if (drop.dropped) {
          return {
            ok: true,
            phase: "ACCESS",
            decision: "NO_EVENT",
            dropped: true,
            reason: drop.reason
          };
        }
      }
      /* ================================================== */

      let stsReport = null;
      if (this.sts) {
        stsReport = this.sts.observe(
          typeof input === "string"
            ? this.ndr.encode(input)
            : input
        );
      }

      let aeReport = null;
      if (this.ae) {
        aeReport = this.ae.guard(
          () => true,
          { name: "TSL_EG_EXECUTION", expectEffect: () => true },
          context
        ).report;
      }

      const decisionResult = this.decision({
        deltaContainment: containment.contained,
        deltaProfile: containment.delta,
        stsReport,
        aeReport
      });

      return {
        ok: decisionResult.decision === "ALLOW",
        phase: "ACCESS",
        decision: decisionResult.decision,
        report: decisionResult
      };
    };

    if (this.ae) {
      const guarded = this.ae.guard(
        run,
        { name: "TSL_EG_PIPELINE", expectEffect: () => true },
        context
      );

      if (guarded.report.securityFlag !== "OK") {
        return {
          ok: false,
          phase: "ACCESS",
          decision: "DENY",
          report: guarded.report
        };
      }

      return guarded.result;
    }

    return run();
  }
}
