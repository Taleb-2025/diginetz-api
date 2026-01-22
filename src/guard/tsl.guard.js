import { TSL_NDR } from "../engines/TSL_NDR.js";
import { TSL_D } from "../engines/TSL_D.js";
import { TSL_RV } from "../engines/TSL_RV.js";
import { TSL_EventDropper } from "../execution/TSL_EventDropper.js";
import { TSL_EG } from "../execution/TSL_EG.js";

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
    throw new Error("TSL_GUARD: decision function is required");
  }

  const ndr = new TSL_NDR(ndrOptions);
  const d = new TSL_D();
  const rv = new TSL_RV();

  const eventDropper = new TSL_EventDropper({
    minDeltaWeight: eventDropperConfig.minDeltaWeight ?? 0.05,
    minStructuralDistance:
      eventDropperConfig.minStructuralDistance ?? 0.01,
    allowEmptyDelta: eventDropperConfig.allowEmptyDelta ?? false
  });

  const eg = new TSL_EG({
    ndr,
    d,
    rv,
    sts: enableSTS ? sts : null,
    ae: enableAE ? ae : null,
    decision,
    eventDropper
  });

  return {
    init(input, context = {}) {
      return eg.init(input, {
        ...context,
        source: "TSL_GUARD_INIT"
      });
    },

    execute(input, context = {}) {
      return eg.execute(input, {
        ...context,
        source: "TSL_GUARD_EXECUTE"
      });
    },

    meta() {
      return {
        guard: "TSL",
        version: "1.0.0",
        engines: {
          ndr: true,
          d: true,
          rv: true,
          eventDropper: true,
          eg: true
        },
        runtime: {
          sts: !!enableSTS,
          ae: !!enableAE
        }
      };
    }
  };
}
