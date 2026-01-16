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

  /* ================= INIT ================= */

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

  /* ================= EXECUTE ================= */

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

      /* ---------- DERIVE DELTA ---------- */
      const delta = this.d.derive(S0, S1);

      /* ---------- EVENT DROPPING ---------- */
      if (this.eventDropper) {
        const drop = this.eventDropper.evaluate(delta);
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

      /* ---------- STS ---------- */
      let stsReport = null;
      if (this.sts) {
        // نمرر الإشارة الخام كما هي (لا encode)
        stsReport = this.sts.observe(input);
      }

      /* ---------- AE ---------- */
      let aeReport = null;
      if (this.ae) {
        aeReport = this.ae.guard(
          () => true,
          { name: "TSL_EG_EXECUTION", expectEffect: () => true },
          context
        ).report;
      }

      /* ---------- DECISION ---------- */
      const decisionResult = this.decision({
        deltaContainment: !delta.identical,
        deltaProfile: delta,
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

    /* ---------- AE PIPELINE GUARD ---------- */
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
