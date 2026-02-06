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
      containment = "DRAINING";       // المسار يتلاشى
    } else if (extension === container) {
      containment = "LAST_TRACE";     // الأثر الأخير
    } else {
      containment = "ILLEGAL_TRACE";  // وصول بلا طريق
    }

    return {
      container,
      extension,
      containment
    };
  }
}
