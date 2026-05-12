/**
 * context-builder.js — v5.0
 * Response Compression Layer
 * - systemHint directive لا descriptive
 * - max_tokens ديناميكي حسب intent
 * - منع conversational preamble
 * - phase-driven output control
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

// max_tokens ديناميكي حسب intent و phase
function resolveMaxTokens(intent, phase) {
  if (intent === 'command')  return 600   // كود + شرح
  if (intent === 'question') return 200   // إجابة مباشرة
  if (intent === 'greeting') return 60    // رد قصير
  if (intent === 'emotional') return 100  // دعم مختصر
  if (intent === 'complaint') return 200  // حل مباشر

  if (phase === 'compressed') return 150
  if (phase === 'locked')     return 150
  if (phase === 'turbulent')  return 100

  return 250  // default
}

export function build(adapterOutput) {
  const { ok, signals, celfResult, passToLLM,
          structuralHint, prevMaxTokens } = adapterOutput

  if (!ok) {
    return {
      passToLLM: false,
      reason: 'invalid_input',
      context: null,
      systemHint: null,
      maxTokens: 250
    }
  }

  const phase  = celfResult?.phase                        ?? 'warmup'
  const drift  = Number(celfResult?.field?.drift          ?? 0)
  const intent = mapIntent(celfResult)
  const lang   = detectLang(signals)
  const rupture = signals?.rupture ?? 0

  const context = {
    lang,
    phase,
    intent,
    drift,
    rupture,
    coherence:  Number(celfResult?.field?.coherence         ?? 0),
    confidence: Number(celfResult?.field?.semanticGrounding ?? 0),
    novelty:    Number(celfResult?.field?.noveltyPressure   ?? 0),
  }

  // استخدم maxTokens من التحليل السابق إذا وُجد
  const maxTokens  = prevMaxTokens ?? resolveMaxTokens(intent, phase)
  const systemHint = buildSystemHint(context, maxTokens, structuralHint)

  return {
    passToLLM,
    context,
    systemHint,
    maxTokens,
    blocked: false
  }
}

function buildSystemHint(ctx, maxTokens, structuralHint = null) {
  const parts = []

  // ── اللغة — directive فقط ────────────────
  if (ctx.lang === 'ar') {
    parts.push('Language: ar.')
  } else if (ctx.lang === 'de') {
    parts.push('Language: de.')
  } else if (ctx.lang === 'mixed') {
    parts.push('Language: ar. Technical terms in en only.')
  } else {
    parts.push(`Language: ${ctx.lang}.`)
  }

  // ── قواعد صارمة — دائماً ─────────────────
  parts.push('No introductions. No meta commentary. No language discussion. Reply directly.')
  parts.push(`Under ${maxTokens} tokens.`)

  // ── النية — directive مباشر ───────────────
  if (ctx.intent === 'command')   parts.push('Output: code + minimal explanation.')
  if (ctx.intent === 'question')  parts.push('Output: direct answer only.')
  if (ctx.intent === 'complaint') parts.push('Output: solution first, cause second.')
  if (ctx.intent === 'emotional') parts.push('Output: brief supportive response.')
  if (ctx.intent === 'greeting')  parts.push('Output: one sentence greeting.')

  // ── الطور — directive ─────────────────────
  if (ctx.phase === 'drift' || ctx.drift > 0.55) {
    parts.push('Topic changed. Follow new subject only.')
  } else if (ctx.phase === 'compressed') {
    parts.push('Continue existing context directly.')
  } else if (ctx.phase === 'turbulent') {
    parts.push('Clarify first. Be brief.')
  } else if (ctx.phase === 'locked') {
    parts.push('Be precise. Context established.')
  }

  // ── حالات خاصة ───────────────────────────
  if (ctx.rupture > 2)      parts.push('User stressed. Be clear.')
  if (ctx.confidence < 0.3) parts.push('Ask one clarifying question if needed.')

  // ── Structural hint من التحليل السابق ────
  if (structuralHint) parts.push(structuralHint)

  return parts.join(' ')
}
