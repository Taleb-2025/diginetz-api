export class TSL_Interpreter {
  interpret({ effect, sts, ae }) {
    const results = {};

    // Show each layer's result
    results.ndrResult = effect;
    results.stsResult = {
      level: sts.level,
      reason: sts.reason
    };
    results.aeResult = ae ? {
      type: ae.type,
      reason: ae.reason
    } : { type: "NONE" };

    // Show final combined result
    results.finalResult = ae && ae.type === "ABSENT_EXECUTION" ? {
      status: "IMPOSSIBLE",
      message: "Containment not possible: " + (ae.reason || "Structural impossibility.")
    } : {
      status: "POSSIBLE",
      message: "Containment is structurally valid and stable."
    };

    return results;
  }
}
