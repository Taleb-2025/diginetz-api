function mapIntent(celfResult) {
  const s = celfResult?.perturbation?.semantic

  if (!s) return 'statement'
  if (s.question) return 'question'
  if (s.intent?.execute) return 'command'
  if (s.error) return 'complaint'
  if (s.emotional) return 'emotional'

  return 'statement'
}

function detectLang(signals) {
  const lang = signals?.lang ?? 'en'

  if (lang === 'ar') return 'ar'
  if (lang === 'de') return 'de'
  if (lang === 'mixed') return 'mixed'

  return lang ?? 'en'
}

function resolveMaxTokens(
  intent,
  fieldPrompt,
  prevAnalysis = null,
  signals = {},
  celfResult = {},
  structuralHint = ''
) {
  const base = {
    command: 450,
    question: 220,
    greeting: 40,
    emotional: 80,
    complaint: 180,
    statement: 220,
  }[intent] ?? 220

  const pressure = fieldPrompt?.pressure ?? 'neutral'
  const zone = fieldPrompt?.zone ?? 'general'
  const style = fieldPrompt?.style ?? 'clear_direct'
  const continuity = fieldPrompt?.continuity ?? 0

  let tokens = base

  if (zone === 'execution')
    tokens = Math.max(tokens, 550)

  if (zone === 'conceptual')
    tokens = Math.max(tokens, 300)

  if (zone === 'focused')
    tokens = Math.min(tokens, 180)

  if (zone === 'multi_focus')
    tokens = Math.max(tokens, 280)

  if (pressure === 'high_pressure')
    tokens = Math.min(tokens, 180)

  if (pressure === 'stable')
    tokens = Math.max(tokens, base)

  if (pressure === 'exploring')
    tokens = Math.max(tokens, 280)

  if (style === 'direct_minimal')
    tokens = Math.min(tokens, 160)

  if (style === 'technical_concise')
    tokens = Math.min(tokens, 450)

  if (continuity > 0.7)
    tokens = Math.round(tokens * 0.85)

  if (continuity < 0.3)
    tokens += 40

  const requiresLargeOutput =
    intent === 'command' &&
    (
      (signals?.length ?? 0) > 1200 ||
      celfResult?.perturbation?.semantic?.code ||
      zone === 'execution'
    )

  const codeHeavy =
    zone === 'execution' &&
    (
      prevAnalysis?.needsLongCode ||
      structuralHint?.includes('full_code') ||
      structuralHint?.includes('complete_file')
    )

  if (requiresLargeOutput)
    tokens = Math.max(tokens, 900)

  if (codeHeavy)
    tokens = Math.max(tokens, 1200)

  if (prevAnalysis) {
    if (prevAnalysis.flags?.verbosity) {
      tokens = Math.round(tokens * 0.75)
    }

    if (prevAnalysis.nextMaxTokens) {
      tokens = Math.round(
        (tokens + prevAnalysis.nextMaxTokens) / 2
      )
    }
  }

  return Math.max(40, Math.min(1400, tokens))
}

export function build(adapterOutput) {
  const {
    ok,
    signals,
    celfResult,
    passToLLM,
    structuralHint,
    prevMaxTokens,
    fieldPrompt,
  } = adapterOutput

  if (!ok) {
    return {
      passToLLM: false,
      reason: 'invalid_input',
      context: null,
      systemHint: null,
      maxTokens: 220
    }
  }

  const intent = mapIntent(celfResult)
  const lang = detectLang(signals)
  const phase = celfResult?.phase ?? 'warmup'
  const drift = Number(celfResult?.field?.drift ?? 0)

  const context = {
    lang,
    phase,
    intent,
    drift,
    coherence: Number(celfResult?.field?.coherence ?? 0),
    confidence: Number(celfResult?.field?.semanticGrounding ?? 0),
    novelty: Number(celfResult?.field?.noveltyPressure ?? 0),
    fieldPrompt: fieldPrompt ?? null,
  }

  const prevAnalysis =
    adapterOutput.prevAnalysis ?? null

  const maxTokens =
    prevMaxTokens ??
    resolveMaxTokens(
      intent,
      fieldPrompt,
      prevAnalysis,
      signals,
      celfResult,
      structuralHint
    )

  const systemHint = buildSystemHint(
    lang,
    intent,
    phase,
    drift,
    fieldPrompt,
    maxTokens,
    structuralHint
  )

  return {
    passToLLM,
    context,
    systemHint,
    maxTokens,
    blocked: false
  }
}

function buildSystemHint(
  lang,
  intent,
  phase,
  drift,
  fieldPrompt,
  maxTokens,
  structuralHint
) {
  const parts = []

  const langMap = {
    ar: 'ar',
    de: 'de',
    mixed: 'ar+en-terms',
    en: 'en'
  }

  parts.push(`Language: ${langMap[lang] ?? lang}.`)

  if (fieldPrompt) {
    const fp = fieldPrompt

    if (fp.zone)
      parts.push(`Zone: ${fp.zone}.`)

    if (fp.style)
      parts.push(`Style: ${fp.style}.`)

    if (
      fp.pressure &&
      fp.pressure !== 'neutral'
    ) {
      parts.push(`Field: ${fp.pressure}.`)
    }
  }

  if (intent === 'command')
    parts.push('Output: working code.')

  if (intent === 'question')
    parts.push('Output: direct answer.')

  if (intent === 'complaint')
    parts.push('Output: solution first.')

  if (intent === 'emotional')
    parts.push('Output: brief support.')

  if (intent === 'greeting')
    parts.push('Output: one sentence.')

  if (phase === 'drift' || drift > 0.4) {
    parts.push('Topic changed.')
  } else if (phase === 'turbulent') {
    parts.push('Be brief.')
  }

  parts.push(`Max: ${maxTokens} tokens.`)

  if (structuralHint)
    parts.push(structuralHint)

  return parts.join(' ')
}
