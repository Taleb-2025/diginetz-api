
// diginetz-api/src/api/tsl-guard-sdk.js
// TSL Guard SDK – Runtime Structural Protection Layer
// Version: 1.0.0
// Purpose: Enforce structural consistency, drop noise, and guard execution

import { TSL_NDR } from "../engines/TSL_NDR.js";
import { TSL_D } from "../engines/TSL_D.js";
import { TSL_EventDropper } from "../execution/TSL_EventDropper.js";
import { TSL_EG } from "../execution/TSL_EG.js";

/**
 * Create a guarded TSL execution engine
 * This SDK is meant to be embedded inside any API or service
 */
export function createTSLGuardSDK(options = {}) {
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
    throw new Error("TSL_GUARD_SDK: decision function is required");
  }

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
    rv: options.rv, // must be injected (stateful)
    sts: enableSTS ? sts : null,
    ae: enableAE ? ae : null,
    decision,
    eventDropper
  });

  /* ---------- Public SDK Interface ---------- */
  return {
    /**
     * Initialize reference structure (S0)
     */
    init(input, context = {}) {
      return eg.init(input, {
        ...context,
        source: "TSL_GUARD_SDK_INIT"
      });
    },

    /**
     * Execute guarded comparison (S1)
     */
    execute(input, context = {}) {
      return eg.execute(input, {
        ...context,
        source: "TSL_GUARD_SDK_EXECUTE"
      });
    },

    /**
     * Introspection / Debug
     */
    meta() {
      return {
        sdk: "TSL_GUARD_SDK",
        version: "1.0.0",
        features: {
          eventDropping: true,
          structuralDelta: true,
          runtimeGuard: !!enableAE,
          stateTracking: true
        }
      };
    }
  };
}
