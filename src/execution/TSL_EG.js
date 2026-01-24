// diginetz-api/src/execution/TSL_EG.js
// TSL Execution Graph
// Orchestrates structural engines ONLY
// No interpretation, no decision, no policy

export class TSL_EG {
  constructor({
    ndr,
    d,
    rv,
    sts,
    ae,
    eventDropper
  }) {
    if (!ndr || !d || !rv) {
      throw new Error("TSL_EG_MISSING_CORE");
    }

    this.ndr = ndr;               // Structural extraction
    this.d = d;                   // Delta derivation
    this.rv = rv;                 // Reference vault
    this.sts = sts || null;       // Structural trace (optional)
    this.ae = ae || null;         // Absence execution guard (optional)
    this.eventDropper = eventDropper || null; // Structural noise filter
  }

  /* ================= INIT ================= */
  // Establish reference structure (S0)

  init(input, context = {}) {
    if (this.rv.isInitialized()) {
      return {
        ok: false,
        phase: "INIT",
        reason: "REFERENCE_ALREADY_INITIALIZED"
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
  // Run full structural pipeline and return execution report

  execute(input, context = {}) {
    if (!this.rv.isInitialized()) {
      return {
        ok: false,
        phase: "EXECUTE",
        reason: "REFERENCE_NOT_INITIALIZED"
      };
    }

    const pipeline = () => {
      const S0 = this.rv.get();
      const S1 = this.ndr.extract(input);

      /* ---------- DELTA ---------- */
      const delta = this.d.derive(S0, S1);

      /* ---------- EVENT DROPPING ---------- */
      if (this.eventDropper) {
        const drop = this.eventDropper.evaluate(delta);
        if (drop?.dropped) {
          return {
            ok: true,
            phase: "EXECUTE",
            dropped: true,
            reason: drop.reason,
            delta
          };
        }
      }

      /* ---------- STS ---------- */
      let stsReport = null;
      if (this.sts) {
        stsReport = this.sts.observe(input);
      }

      /* ---------- AE (EXECUTION GUARD) ---------- */
      let aeReport = null;
      if (this.ae) {
        const guarded = this.ae.guard(
          () => true,
          { name: "TSL_EG_EXECUTION", expectEffect: () => true },
          context
        );
        aeReport = guarded.report;
      }

      /* ---------- EXECUTION REPORT ---------- */
      return {
        ok: true,
        phase: "EXECUTE",
        dropped: false,
        structure: {
          reference: S0,
          current: S1,
          delta
        },
        trace: stsReport,
        ae: aeReport
      };
    };

    /* ---------- AE PIPELINE GUARD ---------- */
    if (this.ae) {
      const guardedPipeline = this.ae.guard(
        pipeline,
        { name: "TSL_EG_PIPELINE", expectEffect: () => true },
        context
      );

      if (guardedPipeline.report?.securityFlag !== "OK") {
        return {
          ok: false,
          phase: "EXECUTE",
          reason: "AE_PIPELINE_BLOCKED",
          ae: guardedPipeline.report
        };
      }

      return guardedPipeline.result;
    }

    return pipeline();
  }
}
