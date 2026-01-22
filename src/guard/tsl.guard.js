import { TSL_NDR } from "../engines/TSL_NDR.js";
import { TSL_D } from "../engines/TSL_D.js";
import { TSL_EventDropper } from "../execution/TSL_EventDropper.js";
import { TSL_EG } from "../execution/TSL_EG.js";

export function createTSLGuard({
  decision,
  rv,
  eventDropperConfig = {},
  ndrOptions = {},
  enableSTS = false,
  enableAE = false,
  sts = null,
  ae = null
}) {
  if (typeof decision !== "function") {
    throw new Error("TSL_GUARD: decision function is required");
  }

  if (!rv) {
    throw new Error("TSL_GUARD: runtime state (rv) is required");
  }

  /* ===== Core Engines ===== */
  const ndr = new TSL_NDR(ndrOptions);
  const d = new TSL_D();

  /* ===== Event Dropper ===== */
  const eventDropper = new TSL_EventDropper({
    minDeltaWeight: eventDropperConfig.minDeltaWeight ?? 0.05,
    minStructuralDistance:
      eventDropperConfig.minStructuralDistance ?? 0.01,
    allowEmptyDelta: eventDropperConfig.allowEmptyDelta ?? false
  });

  /* ===== Execution Graph ===== */
  const eg = new TSL_EG({
    ndr,
    d,
    rv,
    sts: enableSTS ? sts : null,
    ae: enableAE ? ae : null,
    decision,
    eventDropper
  });

  /* ===== Guarded Interface ===== */
  return {
    init(input, context = {}) {
      return eg.init(input, {
        ...context,
        guard: "TSL_INTERNAL_GUARD",
        phase: "INIT"
      });
    },

    execute(input, context = {}) {
      return eg.execute(input, {
        ...context,
        guard: "TSL_INTERNAL_GUARD",
        phase: "EXECUTE"
      });
    },

    meta() {
      return {
        layer: "TSL_GUARD",
        scope: "INTERNAL",
        protects: [
          "structure",
          "execution",
          "state",
          "runtime-delta"
        ],
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
