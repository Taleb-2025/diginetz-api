export class TSL_AE {

  constructor(opts = {}) {
    this.onAlert = opts.onAlert;
  }

  guard(operation, contract, context = {}) {
    let executed = false;

    try {
      const result = operation();
      executed = true;

      const hasEffect = safeBool(contract.expectEffect);

      if (!hasEffect) {
        const report = this._alert("NO_EFFECT", contract, context);
        return { report };
      }

      return {
        result,
        report: this._ok(contract, context)
      };

    } catch (e) {
      const report = this._alert("EXCEPTION", contract, {
        ...context,
        error: String(e)
      });
      return { report };
    } finally {
      void executed;
    }
  }

  _ok(contract, context) {
    return {
      executionState: "EXECUTED",
      securityFlag: "OK",
      reason: "UNKNOWN",
      timestamp: Date.now(),
      context: {
        contract: contract?.name,
        ...context
      }
    };
  }

  _alert(reason, contract, context) {
    const report = {
      executionState: "ABSENT",
      securityFlag: "ALERT",
      reason,
      timestamp: Date.now(),
      context: {
        contract: contract?.name,
        ...context
      }
    };

    if (this.onAlert) {
      this.onAlert(report);
    }

    return report;
  }
}

function safeBool(fn) {
  try {
    return Boolean(fn());
  } catch {
    return false;
  }
}
