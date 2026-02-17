export class TSL_NDR {

  extract(event) {

    if (event == null) {
      throw new Error("TSL_NDR_NULL_INPUT");
    }

    const value = Number(event);

    if (!Number.isInteger(value)) {
      throw new Error("TSL_NDR_NON_INTEGER");
    }

    if (value < 0) {
      throw new Error("TSL_NDR_NEGATIVE_NOT_ALLOWED");
    }

    const symbol = Math.floor(value / 10);
    const extension = value % 10;

    if (symbol === 0) {
      throw new Error("TSL_NDR_INVALID_SYMBOL");
    }

    const phase = this.#resolvePhase(symbol, extension);

    return {
      value,
      symbol,
      extension,
      phase,
      isBoundary: extension === symbol,
      isContained: extension <= symbol
    };
  }

  #resolvePhase(symbol, extension) {
    if (extension < symbol) return "BUILDING";
    if (extension === symbol) return "PEAK";
    return "DISINTEGRATION";
  }
}
