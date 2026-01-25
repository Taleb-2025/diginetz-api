// diginetz-api/src/execution/TSL_EG.js
// ----------------------------------------------------
// TSL_EG — Execution Graph (PURE)
// Role: Execute structural pipeline ONLY
// - NO reference storage
// - NO decisions
// - NO interpretation
// ----------------------------------------------------

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
    this.d   = d;
    this.sts = sts;
    this.ae  = ae;
    this.eventDropper = eventDropper;
  }

  /* ===================================================
     EXECUTE WITH EXTERNAL REFERENCE (S0)
     =================================================== */

  executeWithReference(S0, input, context = {}) {
    if (!S0 || typeof S0 !== "object") {
      return {
        ok: false,
        phase: "ACCESS",
        reason: "INVALID_REFERENCE"
      };
    }

    if (typeof input !== "string" || !input.length) {
      return {
        ok: false,
        phase: "ACCESS",
        reason: "INVALID_INPUT"
      };
    }

    const run = () => {
      /* ---------- STRUCTURE S1 ---------- */
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

      /* ---------- RAW OUTPUT (NO DECISION) ---------- */
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
