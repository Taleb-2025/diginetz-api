// diginetz-api/src/execution/TSL_EG.js
// ----------------------------------------------------
// TSL_EG — Execution Graph
// Role: Execute structural pipeline ONLY
// No decisions, no policies, no interpretation
// ----------------------------------------------------

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

    this.ndr = ndr;
    this.d   = d;
    this.rv  = rv;
    this.sts = sts;
    this.ae  = ae;
    this.eventDropper = eventDropper;
  }

  /* ===================================================
     INIT — Reference Initialization (S0)
     =================================================== */

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

  /* ===================================================
     EXECUTE — Structural Execution (NO DECISION)
     =================================================== */

  execute(input, context = {}) {
    if (!this.rv.isInitialized()) {
      return {
        ok: false,
        phase: "ACCESS",
        reason: "REFERENCE_NOT_INITIALIZED"
      };
    }

    const run = () => {
      /* ---------- STRUCTURES ---------- */
      const S0 = this.rv.get();
      const S1 = this.ndr.extract(input);

      /* ---------- DELTA (STRUCTURAL DIFFERENCE) ---------- */
      const delta = this.d.derive(S0, S1);

      /* ---------- EVENT DROPPING (OPTIONAL) ---------- */
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

      /* ---------- STRUCTURAL TRACE (STS) ---------- */
      const trace = this.sts
        ? this.sts.observe(S1)
        : null;

      /* ---------- ABSENCE EXECUTION (AE) ---------- */
      const aeReport = this.ae
        ? this.ae.guard(
            () => true,
            {
              name: "TSL_EG_EXECUTION",
              expectEffect: () => true
            },
            context
          ).report
        : null;

      /* ---------- OUTPUT (RAW, NO DECISION) ---------- */
      return {
        ok: true,
        phase: "ACCESS",
        structure: S1,
        delta,
        trace,
        ae: aeReport
      };
    };

    /* ---------- AE PIPELINE GUARD ---------- */
    if (this.ae) {
      const guarded = this.ae.guard(
        run,
        {
          name: "TSL_EG_PIPELINE",
          expectEffect: () => true
        },
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
