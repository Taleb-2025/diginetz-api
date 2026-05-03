import { CELF_Engine_V6 } from '../engines/CELF_Engine_V6.js'

const instances = new Map()

function getInstance(id, options = {}) {
  if (!instances.has(id)) {
    instances.set(id, new CELF_Engine_V6(options))
  }
  return instances.get(id)
}

async function loadInstance(id, store, options = {}) {
  if (store) {
    const saved = await store.get(id)
    if (saved) return CELF_Engine_V6.restore(saved)
  }
  return getInstance(id, options)
}

async function saveInstance(id, engine, store) {
  if (!store) return
  if (engine.getStep() % 50 === 0) {
    await store.set(id, engine.serialize())
  }
}

export function celfMiddleware(options = {}) {
  const field         = options.field         ?? 'value'
  const getId         = options.getId         ?? (req => req.user?.id ?? 'default')
  const store         = options.store         ?? null
  const engineOptions = options.engineOptions ?? {}
  const onImpossible  = typeof options.onImpossible === 'function' ? options.onImpossible : null
  const onBlock       = options.onBlock       ?? true

  return async (req, res, next) => {
    const value = req.body?.[field]

    if (!Number.isFinite(value)) return next()

    const id     = getId(req)
    const engine = await loadInstance(id, store, engineOptions)
    const result = engine.test(value)

    if (!result.allowed) {
      engine.observe(value)
      await saveInstance(id, engine, store)

      if (onImpossible) onImpossible(value, result, req)

      if (onBlock) {
        return res.status(422).json({
          blocked:  true,
          reason:   result.reason,
          jump:     result.jump,
          threshold: result.threshold
        })
      }
    }

    engine.observe(value)
    await saveInstance(id, engine, store)

    req.celf = {
      allowed:   result.allowed,
      reason:    result.reason,
      summary:   engine.getSummary()
    }

    next()
  }
}

export function celfFilter(options = {}) {
  const field         = options.field         ?? 'values'
  const getId         = options.getId         ?? (req => req.user?.id ?? 'default')
  const store         = options.store         ?? null
  const engineOptions = options.engineOptions ?? {}

  return async (req, res, next) => {
    const values = req.body?.[field]

    if (!Array.isArray(values)) return next()

    const id     = getId(req)
    const engine = await loadInstance(id, store, engineOptions)

    const filtered = engine.filter(values)
    const blocked  = values.filter(v => !filtered.includes(v))

    for (const v of filtered) engine.observe(v)
    await saveInstance(id, engine, store)

    req.celf = {
      original: values,
      filtered,
      blocked,
      summary:  engine.getSummary()
    }

    next()
  }
}
