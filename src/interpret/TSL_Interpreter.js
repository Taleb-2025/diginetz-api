export class TSL_Interpreter {

  interpret(effect) {
    if (!effect || typeof effect !== "object") {
      return this.#undefined();
    }

    const { container, extension, status } = effect;

    return {
      structural_state: this.#state(status),
      containment: status,
      container,
      extension
    };
  }

  #state(status) {
    if (status === "CONTAINED") return "STABLE";
    if (status === "FULL")      return "PRESSURE";
    if (status === "BROKEN")    return "RUPTURE";
    return "UNKNOWN";
  }

  #undefined() {
    return {
      structural_state: "UNDEFINED",
      containment: "UNKNOWN",
      container: null,
      extension: null
    };
  }
}
