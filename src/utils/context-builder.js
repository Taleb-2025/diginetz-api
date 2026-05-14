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

  if (zone === 'execution')               return 'technical'
  if (zone === 'inquiry')                 return 'analytical'
  if (zone === 'conceptual')              return 'reasoning'
  if (pressure === 'stable' && drift < 0.2) return 'focused'
  if (pressure === 'exploring')           return 'exploratory'
  return 'general'
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
    parts.push('context:')
    card.topics.forEach(t => parts.push(`- ${t}`))
  }

  return parts.length ? 'Session state:\n' + parts.join('\n') : ''
}

function buildCognitiveHint(lang, fieldPrompt) {
  const parts = []

  const langMap = { ar: 'ar', de: 'de', mixed: 'ar+en', en: 'en' }
  parts.push(langMap[lang] ?? lang)

  if (fieldPrompt?.zone) parts.push(fieldPrompt.zone)
  if (fieldPrompt?.pressure) parts.push(fieldPrompt.pressure)
  if (fieldPrompt?.phase && fieldPrompt.phase !== 'warmup') parts.push(fieldPrompt.phase)

  return parts.join(' ').slice(0, 200)
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
  const cognitiveHint = buildCognitiveHint(lang, fieldPrompt)
  const cardStr       = cardToString(memoryCard)

  const systemHint = cardStr
    ? cognitiveHint + '\n\n' + cardStr
    : cognitiveHint

  return {
    passToLLM,
    context,
    systemHint,
    memoryCard,
    cognitiveHint
  }
}
