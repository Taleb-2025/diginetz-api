const FILLERS = new Set([
  'the','and','or','but','is','are','was','were','a','an','in','on','at','to','for',
  'ich','bin','ein','eine','der','die','das','und','wie','mit','von','auf','bei','für',
  'هل','في','من','على','مع','هو','هي','كان','لا','أو','و','ما','هذا','ذلك'
])

function semanticCompress(text, maxWords = 10) {
  const cleaned = String(text ?? '').replace(/```[\s\S]*?```/g, '').trim()
  const words   = cleaned.split(/\s+/).filter(w => w.length > 2 && !FILLERS.has(w.toLowerCase()))
  return words.slice(0, maxWords).join(' ')
}

function validateRouteItem(item) {
  return (
    typeof item.score === 'number' &&
    item.score >= 0.25 &&
    typeof item.text === 'string' &&
    item.text.trim().length > 5
  )
}

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

function inferCognitiveMode(fieldPrompt) {
  const zone     = fieldPrompt?.zone     ?? 'general'
  const pressure = fieldPrompt?.pressure ?? 'neutral'
  const drift    = fieldPrompt?.drift    ?? 0

  if (zone === 'execution')                  return 'technical'
  if (zone === 'inquiry')                    return 'analytical'
  if (zone === 'conceptual')                 return 'reasoning'
  if (pressure === 'stable' && drift < 0.2) return 'focused'
  if (pressure === 'exploring')              return 'exploratory'
  return 'general'
}

function buildGenerationMode(fieldPrompt, celfResult) {
  const continuity = Number(fieldPrompt?.continuity                  ?? 0)
  const drift      = Number(fieldPrompt?.drift                       ?? 0)
  const er         = Number(celfResult?.field?.executionReadiness    ?? 0)
  const np         = Number(celfResult?.field?.noveltyPressure       ?? 0)
  const comp       = Number(celfResult?.field?.compressionPressure   ?? 0)
  const phase      = celfResult?.phase ?? 'warmup'

  if (er > 0.6 && continuity < 0.6)           return 'complete implementation'
  if (np > 0.7 && continuity < 0.4)           return 'full explanation, new topic'
  if (comp > 0.7 && continuity > 0.7)         return 'direct, skip recap'
  if (continuity > 0.8 && np < 0.3)           return 'concise, user knows basics'
  if (phase === 'drift' || drift > 0.5)       return 'fresh start, topic changed'
  if (phase === 'locked' && drift < 0.2)      return 'focused, no tangents'
  return null
}

function buildMemoryCard(routedContext = [], fieldPrompt = {}) {
  const valid = routedContext
    .filter(validateRouteItem)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)

  if (!valid.length) return null

  const topics = valid
    .map(item => semanticCompress(item.text, 10))
    .filter(Boolean)

  if (!topics.length) return null

  const avgScore = valid.reduce((s, i) => s + i.score, 0) / valid.length

  return {
    topics,
    cognitiveMode:    inferCognitiveMode(fieldPrompt),
    continuity:       fieldPrompt?.continuity     ?? 0,
    semanticPressure: fieldPrompt?.pressure       ?? 'neutral',
    zone:             fieldPrompt?.zone           ?? 'general',
    confidence:       Math.round(avgScore * 1000) / 1000
  }
}

function cardToString(card) {
  if (!card) return ''

  const parts = []

  if (card.cognitiveMode && card.cognitiveMode !== 'general') {
    parts.push(`mode: ${card.cognitiveMode}`)
  }

  if (card.topics?.length) {
    parts.push(`context: ${card.topics.join(', ')}`)
  }

  return parts.length ? 'Session state: ' + parts.join(' — ') : ''
}

function buildCognitiveHint(lang, fieldPrompt, celfResult) {
  const parts = []

  const langMap = { ar: 'ar', de: 'de', mixed: 'ar+en', en: 'en' }
  parts.push(langMap[lang] ?? lang)

  if (fieldPrompt?.zone) parts.push(fieldPrompt.zone)
  if (fieldPrompt?.pressure) parts.push(fieldPrompt.pressure)
  if (fieldPrompt?.phase && fieldPrompt.phase !== 'warmup') parts.push(fieldPrompt.phase)

  const mode = buildGenerationMode(fieldPrompt, celfResult)
  if (mode) parts.push(mode)

  return parts.join(' — ').slice(0, 280)
}

export function build(adapterOutput) {
  const {
    ok, signals, celfResult, passToLLM,
    fieldPrompt, routedContext
  } = adapterOutput

  if (!ok) {
    return {
      passToLLM:  false,
      reason:     'invalid_input',
      context:    null,
      systemHint: null,
      memoryCard: null
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

  const memoryCard    = buildMemoryCard(routedContext ?? [], fieldPrompt)
  const cognitiveHint = buildCognitiveHint(lang, fieldPrompt, celfResult)
  const cardStr       = cardToString(memoryCard)

  const systemHint = cardStr
    ? cognitiveHint + '\n' + cardStr
    : cognitiveHint

  return {
    passToLLM,
    context,
    systemHint,
    memoryCard,
    cognitiveHint
  }
}
