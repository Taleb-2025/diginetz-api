// diginetz-api/src/engines/TSL_NDR.js

export class TSL_NDR {
  extract(event) {
    if (event == null) {
      throw new Error("TSL_NDR_NULL_EVENT");
    }

    if (typeof event !== "number" || !Number.isFinite(event)) {
      throw new Error("TSL_NDR_NON_NUMERIC_EVENT");
    }

    const container = Math.floor(event / 10);
    const extension = event % 10;

    return {
      container,
      extension,
      containment: this.#containment(container, extension)
    };
  }

  #containment(container, extension) {
    if (extension < container) {
      return "CONTAINED";
    }

    if (extension === container) {
      return "SATURATED";
    }

    return "BROKEN";
  }
}
