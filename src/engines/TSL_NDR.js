export class TSL_NDR {
  extract(event) {
    const value = Number(event);
    if (!Number.isFinite(value)) {
      throw new Error("TSL_NDR_NON_NUMERIC_EVENT");
    }

    const container = Math.floor(value / 10);
    const extension = value % 10;

    let containment;

    if (extension < container) {
      containment = "DRAINING";
    } else if (extension === container) {
      containment = "LAST_TRACE";
    } else {
      containment = "ILLEGAL_TRACE";
    }

    return {
      container,
      extension,
      containment
    };
  }
}
