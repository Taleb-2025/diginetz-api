// src/guard/tsl.guard.js
// TSL Guard – Internal Runtime Protection Layer
// Injected inside API (NOT SDK for frontend)

import { TSL_NDR } from "../engines/TSL_NDR.js";
import { TSL_D } from "../engines/TSL_D.js";
import { TSL_EventDropper } from "../execution/TSL_EventDropper.js";
import { TSL_EG } from "../execution/TSL_EG.js";
import { TSL_RV } from "../state/TSL_RV.js";

/**
 * Create guarded TSL execution instance
 * This is INTERNAL – used by API routes only
 */
export function createTSLGuard(options = {}) {
  const {
    decision,
    eventDropperConfig = {},
    ndrOptions = {},
    enableSTS = false,
    enableAE = false,
    sts = null,
    ae = null
  } = options;

  if (typeof decision !== "function") {
    throw new Error("TSL_GUARD: decision function is required");
  }

  /* ---------- Runtime State ---------- */
  const rv = new TSL_RV();

  /* ---------- Core Engines ---------- */
  const ndr = new TSL_NDR(ndrOptions);
  const d = new TSL_D();

  /* ---------- Event Dropper ---------- */
  const eventDropper = new TSL_EventDropper({
    minDeltaWeight: eventDropperConfig.minDeltaWeight ?? 0.05,
    minStructuralDistance:
      eventDropperConfig.minStructuralDistance ?? 0.01,
    allowEmptyDelta: eventDropperConfig.allowEmptyDelta ?? false
  });

  /* ---------- Execution Graph ---------- */
  const eg = new TSL_EG({
    ndr,
    d,
    rv,
    sts: enableSTS ? sts : null,
    ae: enableAE ? ae : null,
    decision,
    eventDropper
  });

  /* ---------- Guarded Interface ---------- */
  return {
    /**
     * Initialize reference structure (S0)
     */
    init(input, context = {}) {
      return eg.init(input, {
        ...context,
        source: "TSL_GUARD_INIT"
      });
    },

    /**
     * Execute guarded comparison (S1)
     */
    execute(input, context = {}) {
      return eg.execute(input, {
        ...context,
        source: "TSL_GUARD_EXECUTE"
      });
    },

    /**
     * Reset runtime state (optional)
     */
    reset() {
      if (typeof rv.reset === "function") {
        rv.reset();
      }
    },

    /**
     * Introspection
     */
    meta() {
      return {
        layer: "TSL_GUARD",
        stateful: true,
        engines: {
          ndr: true,
          d: true,
          eg: true
        },
        protections: {
          eventDropping: true,
          runtimeState: true,
          sts: !!enableSTS,
          ae: !!enableAE
        }
      };
    }
  };
}
