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

function buildSystemHint(lang, fieldPrompt) {
  const parts = []

  const langMap = { ar: 'ar', de: 'de', mixed: 'ar+en', en: 'en' }
  parts.push(langMap[lang] ?? lang)

  if (fieldPrompt?.zone) parts.push(fieldPrompt.zone)
  if (fieldPrompt?.pressure) parts.push(fieldPrompt.pressure)
  if (fieldPrompt?.phase && fieldPrompt.phase !== 'warmup') parts.push(fieldPrompt.phase)

  return parts.join(' ').slice(0, 200)
}

export function build(adapterOutput) {
  const { ok, signals, celfResult, passToLLM, fieldPrompt } = adapterOutput

  if (!ok) {
    return {
      passToLLM: false,
      reason:    'invalid_input',
      context:   null,
      systemHint: null,
      maxTokens: 4096
    }
  }

  const intent = mapIntent(celfResult)
  const lang   = detectLang(signals)
  const phase  = celfResult?.phase ?? 'warmup'
  const drift  = Number(celfResult?.field?.drift ?? 0)

  const context = {
    lang, phase, intent, drift,
    coherence:   Number(celfResult?.field?.coherence         ?? 0),
    confidence:  Number(celfResult?.field?.semanticGrounding ?? 0),
    novelty:     Number(celfResult?.field?.noveltyPressure   ?? 0),
    continuity:  Number(fieldPrompt?.continuity              ?? 0)
  }

  const systemHint = buildSystemHint(lang, fieldPrompt)

  return {
    passToLLM,
    context,
    systemHint,
    maxTokens: 4096,
    blocked: false
  }
}
