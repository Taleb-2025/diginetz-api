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

function detectComplexity(
  signals = {},
  celfResult = {},
  intent = 'statement',
  fieldPrompt = {},
  structuralHint = ''
) {
  const text =
    (
      signals?.raw ??
      signals?.text ??
      ''
    ).toLowerCase()

  let score = 0

  if (text.length > 120) score += 1
  if (text.length > 400) score += 1
  if (text.length > 900) score += 1

  if (
    text.includes('fastapi') ||
    text.includes('docker') ||
    text.includes('postgres') ||
    text.includes('postgresql') ||
    text.includes('redis') ||
    text.includes('websocket') ||
    text.includes('railway') ||
    text.includes('nginx') ||
    text.includes('authentication') ||
    text.includes('scaling')
  ) {
    score += 2
  }

  if (
    text.includes('full') ||
    text.includes('complete') ||
    text.includes('production') ||
    text.includes('architecture') ||
    text.includes('implement') ||
    text.includes('microservice')
  ) {
    score += 2
  }

  if (
    text.includes('code') ||
    text.includes('example') ||
    text.includes('api') ||
    text.includes('backend')
  ) {
    score += 1
  }

  if (intent === 'command')
    score += 2

  if (fieldPrompt?.zone === 'execution')
    score += 2

  if (
    structuralHint?.includes('full_code') ||
    structuralHint?.includes('complete_file')
  ) {
    score += 2
  }

  if (
    celfResult?.perturbation?.semantic?.code
  ) {
    score += 2
  }

  if (score >= 9) return 'very_high'
  if (score >= 6) return 'high'
  if (score >= 3) return 'medium'

  return 'low'
}

function resolveMaxTokens(
  intent,
  fieldPrompt,
  prevAnalysis = null,
  signals = {},
  celfResult = {},
  structuralHint = ''
) {
  const pressure = fieldPrompt?.pressure ?? 'neutral'
  const zone = fieldPrompt?.zone ?? 'general'
  const style = fieldPrompt?.style ?? 'clear_direct'
  const continuity = fieldPrompt?.continuity ?? 0

  const complexity = detectComplexity(
    signals,
    celfResult,
    intent,
    fieldPrompt,
    structuralHint
  )

  let tokens = 220

  if (complexity === 'low')
    tokens = 180

  if (complexity === 'medium')
    tokens = 420

  if (complexity === 'high')
    tokens = 1200

  if (complexity === 'very_high')
    tokens = 2400

  if (intent === 'greeting')
    tokens = 60

  if (intent === 'emotional')
    tokens = Math.max(tokens, 120)

  if (intent === 'complaint')
    tokens = Math.max(tokens, 260)

  if (
    intent === 'command' &&
    complexity !== 'high' &&
    complexity !== 'very_high'
  ) {
    tokens = Math.max(tokens, 900)
  }

  if (zone === 'execution')
    tokens = Math.max(tokens, 1200)

  if (
    zone === 'conceptual' &&
    complexity === 'low'
  ) {
    tokens = Math.max(tokens, 300)
  }

  if (
    zone === 'focused' &&
    complexity === 'low'
  ) {
    tokens = Math.min(tokens, 220)
  }

  if (
    zone === 'multi_focus' &&
    complexity !== 'low'
  ) {
    tokens = Math.max(tokens, 700)
  }

  if (
    pressure === 'high_pressure' &&
    complexity === 'low'
  ) {
    tokens = Math.min(tokens, 180)
  }

  if (
    pressure === 'exploring' &&
    complexity !== 'low'
  ) {
    tokens = Math.max(tokens, 700)
  }

  if (
    style === 'direct_minimal' &&
    complexity === 'low'
  ) {
    tokens = Math.min(tokens, 160)
  }

  if (
    style === 'technical_concise' &&
    complexity !== 'high' &&
    complexity !== 'very_high'
  ) {
    tokens = Math.min(tokens, 650)
  }

  if (
    continuity > 0.7 &&
    complexity === 'low'
  ) {
    tokens = Math.round(tokens * 0.85)
  }

  if (
    continuity < 0.3 &&
    complexity !== 'high' &&
    complexity !== 'very_high'
  ) {
    tokens += 60
  }

  if (prevAnalysis) {
    if (
      prevAnalysis.flags?.verbosity &&
      complexity === 'low'
    ) {
      tokens = Math.round(tokens * 0.8)
    }

    if (prevAnalysis.nextMaxTokens) {
      tokens = Math.round(
        (tokens + prevAnalysis.nextMaxTokens) / 2
      )
    }
  }

  return Math.max(60, Math.min(4000, tokens))
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

  const complexity = detectComplexity(
    signals,
    celfResult,
    intent,
    fieldPrompt,
    structuralHint
  )

  const context = {
    lang,
    phase,
    intent,
    complexity,
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
    complexity,
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
  complexity,
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

  parts.push(`Complexity: ${complexity}.`)

  if (intent === 'command')
    parts.push('Output: complete working code.')

  if (intent === 'question')
    parts.push('Output: direct answer.')

  if (intent === 'complaint')
    parts.push('Output: solution first.')

  if (intent === 'emotional')
    parts.push('Output: brief support.')

  if (intent === 'greeting')
    parts.push('Output: one sentence.')

  if (
    complexity === 'high' ||
    complexity === 'very_high'
  ) {
    parts.push('Do not truncate code.')
  }

  if (phase === 'drift' || drift > 0.4) {
    parts.push('Topic changed.')
  } else if (
    phase === 'turbulent' &&
    complexity === 'low'
  ) {
    parts.push('Be brief.')
  }

  parts.push(`Max: ${maxTokens} tokens.`)

  if (structuralHint)
    parts.push(structuralHint)

  return parts.join(' ')
}
