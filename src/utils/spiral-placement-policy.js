export function resolveTheta({ questionType, domain, fieldSignals, artifactType, type } = {}) {
  const fs = String(fieldSignals || '')

  if (type === 'session_summary') return 0

  if (questionType === 'checkpoint' || fs.includes('@summary.checkpoint')) return 135
  if (questionType === 'followup'   || fs.includes('@followup.strict'))    return 180
  if (questionType === 'project_integration')                              return 315
  if (questionType === 'comparison' || questionType === 'conceptual')      return 270
  if (questionType === 'creative_write' || artifactType === 'creative_story' || domain === 'creative') return 90

  if (artifactType === 'code' || domain === 'backend' || domain === 'frontend' || domain === 'database' || domain === 'devops' || domain === 'security' || domain === 'algorithms' || domain === 'testing' || domain === 'debugging') return 45
  if (domain === 'science' || domain === 'math' || domain === 'humanities') return 225

  return 0
}

const FIB_RINGS = [1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89]

export function resolveRing({ isActive = false, archived = false, ageDays = 0 } = {}) {
  if (isActive) return 1
  if (archived) return FIB_RINGS.length

  for (let i = 1; i < FIB_RINGS.length; i++) {
    if (ageDays <= FIB_RINGS[i]) return i + 1
  }

  return FIB_RINGS.length
}

export function resolvePlacement(context = {}) {
  return {
    theta: context.theta ?? resolveTheta(context),
    ring:  context.ring  ?? resolveRing(context),
  }
}
