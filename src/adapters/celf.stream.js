import { CELF_Engine_V6 } from '../engines/CELF_Engine_V6.js'
 
export class CELFStream {
 
  #engine
  #onImpossible
  #onNormal
 
  constructor(options = {}) {
    this.#engine       = new CELF_Engine_V6(options.engineOptions ?? {})
    this.#onImpossible = typeof options.onImpossible === 'function' ? options.onImpossible : null
    this.#onNormal     = typeof options.onNormal     === 'function' ? options.onNormal     : null
  }
 
  push(value) {
    if (!Number.isFinite(value)) return { ok: false, error: 'non-finite value' }
 
    const result = this.#engine.observe(value)
 
    if (result.impossible && this.#onImpossible) {
      this.#onImpossible(value, result)
    }
 
    if (!result.impossible && this.#onNormal) {
      this.#onNormal(value, result)
    }
 
    return result
  }
 
  pushBatch(values) {
    if (!Array.isArray(values)) return []
    return values.map(v => this.push(v))
  }
 
  test(value)    { return this.#engine.test(value) }
  filter(values) { return this.#engine.filter(values) }
  getSummary()   { return this.#engine.getSummary() }
  serialize()    { return this.#engine.serialize() }
 
  static restore(json, options = {}) {
    const stream = new CELFStream(options)
    stream.#engine = CELF_Engine_V6.restore(json)
    return stream
  }
 
  reset() {
    this.#engine.reset()
  }
}
 
