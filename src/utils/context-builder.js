const FILLERS = new Set([
  'the','and','or','but','is','are','was','were','a','an','in','on','at','to','for',
  'ich','bin','ein','eine','der','die','das','und','wie','mit','von','auf','bei','für',
  'هل','في','من','على','مع','هو','هي','كان','لا','أو','و','ما','هذا','ذلك'
])

const MIN_ROUTE_SCORE = 0.25
const MIN_VAULT_SCORE = 0.55
const MAX_MEMORY_TOPICS = 3
const MAX_TOPIC_WORDS = 10

function semanticCompress(text, maxWords = MAX_TOPIC_WORDS) {
  const cleaned = String(text ?? '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[\s\S]*?`/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  const words = cleaned
    .split(/\s+/)
    .map(w => w.trim())
    .filter(w => w.length > 2 && !FILLERS.has(w.toLowerCase()))

  return words.slice(0, maxWords).join(' ')
}

function validateRouteItem(item) {
  return (
    item &&
    typeof item.score === 'number' &&
    item.score >= MIN_ROUTE_SCORE &&
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

function clamp01(v) {
  const n = Number(v)
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0
}

function pickPrimaryMode({ er, continuity, novelty, drift, comp, phase }) {
  const scores = {
    code: er * 0.65 + continuity * 0.25 + (1 - drift) * 0.10,
    fresh: novelty * 0.65 + (1 - continuity) * 0.25 + drift * 0.10,
    direct: comp * 0.45 + continuity * 0.40 + (1 - novelty) * 0.15,
    continue: continuity * 0.55 + (1 - novelty) * 0.25 + (phase === 'locked' ? 0.20 : 0),
    reset: drift * 0.70 + novelty * 0.20 + (1 - continuity) * 0.10,
    clarify: phase === 'turbulent' ? 1 : drift * 0.35 + (1 - continuity) * 0.20
  }

  return Object.entries(scores).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'balanced'
}

function buildSystemInstruction(celfResult, fieldPrompt, lang) {
  const phase = celfResult?.phase ?? 'warmup'
  const continuity = clamp01(fieldPrompt?.continuity ?? 0)
  const novelty = clamp01(celfResult?.field?.noveltyPressure ?? 0)
  const er = clamp01(celfResult?.field?.executionReadiness ?? 0)
  const drift = clamp01(fieldPrompt?.drift ?? celfResult?.field?.drift ?? 0)
  const comp = clamp01(celfResult?.field?.compressionPressure ?? 0)

  const langLine = {
    ar: 'أجب باللغة العربية.',
    en: 'Reply in English.',
    de: 'Antworte auf Deutsch.',
    mixed: 'أجب بنفس لغة المستخدم.'
  }[lang] ?? 'Reply in the user\'s language.'

  const mode = pickPrimaryMode({ er, continuity, novelty, drift, comp, phase })

  const modeLine = {
    code: 'اكتب حلاً عملياً كاملاً عند الحاجة، ولا تختصر الكود المهم.',
    fresh: 'موضوع جديد. اشرح من الأساس بدون افتراض سياق سابق.',
    direct: 'اذهب مباشرة للإجابة بدون إعادة شرح ما سبق.',
    continue: 'تابع من السياق السابق وحافظ على نفس خط النقاش.',
    reset: 'الموضوع تغيّر. لا تعتمد على السياق السابق إلا إذا كان ضرورياً.',
    clarify: 'إذا كان المقصود غير واضح، اسأل سؤالاً قصيراً قبل التفصيل.',
    balanced: null
  }[mode] ?? null

  const styleLines = []

  if (continuity > 0.7 && novelty < 0.45 && mode !== 'fresh' && mode !== 'reset') {
    styleLines.push('لا تكرر المقدمة.')
  }

  if (er > 0.55) {
    styleLines.push('كن تقنياً ودقيقاً.')
  }

  if (drift > 0.45 && mode !== 'reset') {
    styleLines.push('تحقق من محور السؤال قبل استعمال الذاكرة.')
  }

  return [langLine, modeLine, ...styleLines].filter(Boolean).join('\n')
}

function buildMemoryLayer(memoryCard, vaultHit) {
  const lines = []

  if (vaultHit?.compressed && Number(vaultHit.score ?? 0) >= MIN_VAULT_SCORE) {
    lines.push(`[سياق سابق محتمل] ${semanticCompress(vaultHit.compressed, 16)}`)
  }

  if (memoryCard?.topics?.length && memoryCard.confidence >= 0.35) {
    lines.push(`[السياق الحالي] ${memoryCard.topics.join(' — ')}`)
  }

  return lines.join('\n')
}

function buildMemoryCard(routedContext = [], fieldPrompt = {}) {
  const valid = routedContext
    .filter(validateRouteItem)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_MEMORY_TOPICS)

  if (!valid.length) return null

  const seen = new Set()
  const topics = []

  for (const item of valid) {
    const topic = semanticCompress(item.text, MAX_TOPIC_WORDS)
    const key = topic.toLowerCase()
    if (!topic || seen.has(key)) continue
    seen.add(key)
    topics.push(topic)
  }

  if (!topics.length) return null

  const avgScore = valid.reduce((s, i) => s + i.score, 0) / valid.length

  return {
    topics,
    continuity: clamp01(fieldPrompt?.continuity ?? 0),
    semanticPressure: fieldPrompt?.pressure ?? 'neutral',
    zone: fieldPrompt?.zone ?? 'general',
    confidence: Math.round(avgScore * 1000) / 1000
  }
}

export function build(adapterOutput) {
  const {
    ok,
    signals,
    celfResult,
    passToLLM,
    fieldPrompt,
    routedContext
  } = adapterOutput

  if (!ok) {
    return {
      passToLLM: false,
      reason: 'invalid_input',
      context: null,
      systemHint: null,
      memoryCard: null,
      vaultHit: null
    }
  }

  const routeItems = Array.isArray(routedContext)
    ? routedContext
    : (routedContext?.items ?? [])

  const vaultHit = Array.isArray(routedContext)
    ? null
    : (routedContext?.vaultHit ?? null)

  const intent = mapIntent(celfResult)
  const lang = detectLang(signals)
  const phase = celfResult?.phase ?? 'warmup'
  const drift = clamp01(celfResult?.field?.drift ?? fieldPrompt?.drift ?? 0)

  const context = {
    lang,
    phase,
    intent,
    drift,
    coherence: clamp01(celfResult?.field?.coherence ?? 0),
    confidence: clamp01(celfResult?.field?.semanticGrounding ?? 0),
    novelty: clamp01(celfResult?.field?.noveltyPressure ?? 0),
    continuity: clamp01(fieldPrompt?.continuity ?? 0)
  }

  const memoryCard = buildMemoryCard(routeItems, fieldPrompt)

  const systemHint = [
    buildSystemInstruction(celfResult, fieldPrompt, lang),
    buildMemoryLayer(memoryCard, vaultHit)
  ].filter(Boolean).join('\n')

  return {
    passToLLM,
    context,
    systemHint,
    memoryCard,
    vaultHit
  }
}
