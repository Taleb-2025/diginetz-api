/**
 * context-builder.js — v4.0
 * systemHint مضغوط ~50-80 token بدل 500
 */

function mapIntent(celfResult) {
  const s = celfResult?.perturbation?.semantic
  if (!s) return 'statement'
  if (s.question)        return 'question'
  if (s.intent?.execute) return 'command'
  if (s.error)           return 'complaint'
  if (s.emotional)       return 'emotional'
  return 'statement'
}

function detectLang(signals) {
  const lang = signals?.lang ?? 'en'
  if (lang === 'ar')    return 'ar'
  if (lang === 'de')    return 'de'
  if (lang === 'mixed') return 'mixed'
  return lang ?? 'en'
}

export function build(adapterOutput) {
  const { ok, signals, celfResult, passToLLM } = adapterOutput

  if (!ok) {
    return { passToLLM: false, reason: 'invalid_input', context: null, systemHint: null }
  }

  const phase   = celfResult?.phase                         ?? 'warmup'
  const drift   = Number(celfResult?.field?.drift           ?? 0)
  const intent  = mapIntent(celfResult)
  const lang    = detectLang(signals)
  const rupture = signals?.rupture ?? 0

  const context = {
    lang,
    phase,
    intent,
    drift,
    rupture,
    coherence:  Number(celfResult?.field?.coherence          ?? 0),
    confidence: Number(celfResult?.field?.semanticGrounding  ?? 0),
    novelty:    Number(celfResult?.field?.noveltyPressure    ?? 0),
  }

  const systemHint = buildSystemHint(context)
  const blocked    = false

  return { passToLLM, context, systemHint, blocked }
}

function buildSystemHint(ctx) {
  const parts = []

  // ── اللغة — جملة واحدة فقط ──────────────
  if (ctx.lang === 'ar') {
    parts.push('Respond in Arabic only (العربية فقط).')
  } else if (ctx.lang === 'de') {
    parts.push('Respond in German only (nur Deutsch).')
  } else if (ctx.lang === 'mixed') {
    parts.push('Respond in Arabic, use English only for technical terms.')
  } else {
    parts.push(`Respond in the user's language (${ctx.lang}).`)
  }

  // ── النية — جملة واحدة ───────────────────
  if (ctx.intent === 'command')   parts.push('Give actionable output.')
  if (ctx.intent === 'question')  parts.push('Answer directly.')
  if (ctx.intent === 'complaint') parts.push('Resolve the issue empathetically.')
  if (ctx.intent === 'emotional') parts.push('Be supportive.')

  // ── الطور — جملة واحدة ───────────────────
  if (ctx.phase === 'drift' || ctx.drift > 0.55) {
    parts.push('Topic shifted — follow the new subject.')
  } else if (ctx.phase === 'turbulent') {
    parts.push('Ground the conversation first.')
  } else if (ctx.phase === 'locked') {
    parts.push('Be precise — context is established.')
  } else if (ctx.phase === 'compressed') {
    parts.push('Prioritize continuity.')
  }

  // ── إشارات إضافية ────────────────────────
  if (ctx.rupture > 2)        parts.push('User may be stressed — be clear and calm.')
  if (ctx.confidence < 0.3)   parts.push('Ask for clarification if needed.')

  // ── قاعدة ثابتة ──────────────────────────
  parts.push('Be natural and concise.')

  return parts.join(' ')
}
