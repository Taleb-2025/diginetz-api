const INTENT_PATTERNS = {
  question: {
    ar: /^(ما|من|كيف|متى|أين|لماذا|هل|ماذا|كم|أي)\b/,
    en: /^(what|who|how|when|where|why|is|are|can|could|would|should|do|does|did)\b/i
  },
  command: {
    ar: /^(اعطني|أعطني|اكتب|اشرح|وضح|ساعدني|قم|افعل|ابحث|ترجم|حلل|لخص|صمم|عدّل|عدل)\b/,
    en: /^(give|write|explain|help|do|find|search|translate|analyze|summarize|create|make|list|design|modify|edit)\b/i
  },
  greeting: {
    ar: /^(مرحبا|السلام|أهلا|هلا|صباح|مساء|كيف حالك)/,
    en: /^(hi|hello|hey|good morning|good evening|how are you)/i
  },
  complaint: {
    ar: /^(لماذا لا|لا يعمل|مشكلة|خطأ|فشل|لم يعمل|لماذا هذا)/,
    en: /^(why (isn't|doesn't|won't)|not working|problem|error|failed|broken)/i
  }
}

const TOPIC_SIGNALS = {
  technical: /\b(api|code|كود|server|سيرفر|error|خطأ|function|دالة|database|قاعدة بيانات|deploy|javascript|python|github|railway|redis|route|endpoint)\b/i,
  financial: /\b(price|سعر|money|مال|cost|تكلفة|pay|دفع|bitcoin|gold|ذهب|dollar|دولار|investment|مستثمر)\b/i,
  ai: /\b(ai|ذكاء|llm|model|نموذج|prompt|token|embedding|context|hallucination|استدلال|استبعاد)\b/i,
  philosophical: /\b(فلسفة|النسق|الممكن|المستحيل|الحاضر|الماضي|الأثر|المعنى|استبعاد|اتساق|وجود|حقيقة)\b/i,
  general: /\b(help|مساعدة|info|معلومات|explain|شرح|what|ما|how|كيف)\b/i
}

const REASONING_SIGNALS = {
  technical: /\b(كود|api|server|route|endpoint|function|deploy|github|redis|database|خطأ|error)\b/i,
  philosophical: /\b(فلسفة|النسق|الممكن|المستحيل|الحاضر|الماضي|الأثر|المعنى|الحقيقة|استبعاد|اتساق)\b/i,
  analytical: /\b(حلل|تحليل|قارن|نسبة|احسب|دليل|تقييم|نتيجة|سبب|لماذا)\b/i,
  creative: /\b(صمم|شعار|اكتب|اسم|فكرة|تصميم|واجهة|منتج)\b/i,
  operational: /\b(عدل|احذف|أضف|انزل|ارفع|اختبر|شغل|افتح|اضغط)\b/i
}

function clamp(value, min = 0, max = 1) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.max(min, Math.min(max, n))
}

function round2(value) {
  return Math.round(value * 100) / 100
}

function detectLanguage(text) {
  const arabicChars = (text.match(/[\u0600-\u06FF]/g) || []).length
  const latinChars = (text.match(/[a-zA-Z]/g) || []).length
  const totalChars = text.replace(/\s/g, '').length

  if (totalChars === 0) return 'unknown'

  const arRatio = arabicChars / totalChars
  const enRatio = latinChars / totalChars

  if (arRatio > 0.4 && enRatio > 0.1) return 'mixed'
  if (arRatio > 0.4) return 'ar'
  if (arRatio > 0.1) return 'mixed'
  return 'en'
}

function computeComplexity(text, tokens) {
  const wordCount = tokens.length
  const avgWordLen =
    tokens.reduce((s, t) => s + t.length, 0) / (wordCount || 1)

  const hasPunctuation = /[؟?!،,;:]/.test(text)
  const hasNumbers = /\d/.test(text)
  const hasSubClause =
    /\b(because|لأن|حيث|الذي|التي|which|that|who|while|بينما|لكن|رغم)\b/i.test(text)

  let score = 0

  if (wordCount > 6) score += 0.12
  if (wordCount > 18) score += 0.12
  if (wordCount > 40) score += 0.08
  if (avgWordLen > 6) score += 0.1
  if (hasPunctuation) score += 0.08
  if (hasNumbers) score += 0.08
  if (hasSubClause) score += 0.25

  return round2(clamp(score))
}

function detectIntent(text, lang) {
  const trimmed = text.trim()
  const langKey = lang === 'ar' ? 'ar' : 'en'

  for (const [intent, patterns] of Object.entries(INTENT_PATTERNS)) {
    const pattern = patterns[langKey] || patterns.en
    if (pattern.test(trimmed)) return intent
  }

  return 'statement'
}

function detectTopic(text) {
  for (const [topic, pattern] of Object.entries(TOPIC_SIGNALS)) {
    if (pattern.test(text)) return topic
  }

  return 'general'
}

function detectReasoningMode(text) {
  let best = 'general'
  let bestScore = 0

  for (const [mode, pattern] of Object.entries(REASONING_SIGNALS)) {
    const matches = text.match(pattern)
    const score = matches ? matches.length : 0

    if (score > bestScore) {
      bestScore = score
      best = mode
    }
  }

  return best
}

function isNoise(text, tokens) {
  if (tokens.length === 0) return true
  if (tokens.length === 1 && tokens[0].length < 2) return true
  if (/^[^a-zA-Z\u0600-\u06FF]+$/.test(text)) return true
  return false
}

function computeTextShape(text, tokens) {
  const unique = new Set(tokens.map(t => t.toLowerCase()))

  const repetitionRatio =
    tokens.length
      ? 1 - unique.size / tokens.length
      : 0

  const questionMarks = (text.match(/[؟?]/g) || []).length
  const commas = (text.match(/[،,]/g) || []).length
  const codeSignals =
    (text.match(/```|const |function |=>|import |export |{|}/g) || []).length

  return {
    repetitionRatio: round2(repetitionRatio),
    questionMarks,
    commas,
    codeSignals
  }
}

function computeContinuity(text, tokens, context = {}) {
  const continuationMarkers =
    /\b(أيضًا|كذلك|إذن|لذلك|لكن|رغم|ثم|وبالتالي|يعني|نفس|هذا|هذه|هنا|therefore|also|but|so|then|same|this|that)\b/gi

  const pronouns =
    /\b(هو|هي|هذا|هذه|ذلك|تلك|it|this|that|they)\b/gi

  const markers = (text.match(continuationMarkers) || []).length
  const pronounCount = (text.match(pronouns) || []).length

  let score = 0

  if (markers > 0) score += 0.35
  if (pronounCount > 0) score += 0.18
  if (/[،,;:]/.test(text)) score += 0.06
  if (/\b(لكن|بينما|رغم|because|while|however)\b/i.test(text)) score += 0.08

  if (tokens.length > 12 && markers > 0) score += 0.08
  if (tokens.length > 30 && markers > 1) score += 0.06

  const previousTopic = context.previousTopic
  const currentTopic = context.currentTopic

  if (
    previousTopic &&
    currentTopic &&
    previousTopic !== currentTopic
  ) {
    score -= 0.25
  }

  const previousReasoningMode = context.previousReasoningMode
  const currentReasoningMode = context.currentReasoningMode

  if (
    previousReasoningMode &&
    currentReasoningMode &&
    previousReasoningMode !== currentReasoningMode
  ) {
    score -= 0.15
  }

  return round2(clamp(score))
}

function computeAbstraction(text) {
  const abstractTerms =
    /(نسق|بنية|أثر|فلسفة|ممكن|مستحيل|حاضر|ماضي|معنى|استدلال|استبعاد|اتساق|احتمال|فضاء|خلايا|تعلم|وعي|pattern|structure|meaning|context|possibility|constraint|inference)/gi

  const count = (text.match(abstractTerms) || []).length

  return round2(clamp(count / 8))
}

function computeDrift(text, lang, topic, reasoningMode, context = {}) {
  let score = 0

  if (lang === 'mixed') score += 0.2
  if (text.includes('لكن') || /\bbut\b/i.test(text)) score += 0.12
  if (text.includes('فجأة') || /\bsuddenly\b/i.test(text)) score += 0.18
  if (topic === 'general' && reasoningMode !== 'general') score += 0.08

  const separators = (text.match(/[،,;:]/g) || []).length
  if (separators > 4) score += 0.1

  if (
    context.previousTopic &&
    context.previousTopic !== topic
  ) {
    score += 0.28
  }

  if (
    context.previousReasoningMode &&
    context.previousReasoningMode !== reasoningMode
  ) {
    score += 0.18
  }

  if (
    context.previousLang &&
    context.previousLang !== lang
  ) {
    score += 0.12
  }

  return round2(clamp(score))
}

function computeNovelty(signals, context = {}) {
  let score = 0

  if (
    context.previousTopic &&
    context.previousTopic !== signals.topic
  ) {
    score += 0.35
  }

  if (
    context.previousReasoningMode &&
    context.previousReasoningMode !== signals.reasoningMode
  ) {
    score += 0.25
  }

  if (
    context.previousIntent &&
    context.previousIntent !== signals.intent
  ) {
    score += 0.15
  }

  if (
    context.previousLang &&
    context.previousLang !== signals.lang
  ) {
    score += 0.1
  }

  if (
    typeof context.previousNumeric === 'number' &&
    Number.isFinite(context.previousNumeric)
  ) {
    const diff = Math.abs(signals.numericSeed - context.previousNumeric)
    score += clamp(diff / 300) * 0.15
  }

  return round2(clamp(score))
}

function toNumericSignal(signals) {
  const intentMap = {
    greeting: 10,
    question: 30,
    command: 50,
    complaint: 70,
    statement: 40
  }

  const topicMap = {
    general: 1,
    technical: 2,
    financial: 3,
    ai: 4,
    philosophical: 5
  }

  const langMap = {
    ar: 0,
    en: 100,
    mixed: 50,
    unknown: 200
  }

  const reasoningMap = {
    general: 0,
    technical: 15,
    analytical: 25,
    philosophical: 35,
    creative: 45,
    operational: 55
  }

  const base =
    (intentMap[signals.intent] || 40) +
    (topicMap[signals.topic] || 1) * 10 +
    (signals.complexity * 35) +
    (signals.continuity * 32) +
    (signals.abstraction * 38) +
    (signals.drift * 48) +
    (signals.novelty * 42) +
    (signals.repetitionRatio * 18) +
    (reasoningMap[signals.reasoningMode] || 0) +
    (langMap[signals.lang] || 0) * 0.1 +
    Math.min(30, signals.wordCount * 0.18)

  return Math.min(999, Math.round(base * 10) / 10)
}

export function parse(text, context = {}) {
  if (typeof text !== 'string' || !text.trim()) {
    return {
      valid: false,
      reason: 'empty_input',
      numeric: 0
    }
  }

  const trimmed = text.trim()
  const tokens = trimmed.split(/\s+/).filter(Boolean)

  const lang = detectLanguage(trimmed)
  const intent = detectIntent(trimmed, lang)
  const topic = detectTopic(trimmed)
  const reasoningMode = detectReasoningMode(trimmed)
  const complexity = computeComplexity(trimmed, tokens)
  const shape = computeTextShape(trimmed, tokens)
  const abstraction = computeAbstraction(trimmed)
  const noise = isNoise(trimmed, tokens)

  const continuity = computeContinuity(
    trimmed,
    tokens,
    {
      ...context,
      currentTopic: topic,
      currentReasoningMode: reasoningMode
    }
  )

  const drift = computeDrift(
    trimmed,
    lang,
    topic,
    reasoningMode,
    context
  )

  const numericSeed = toNumericSignal({
    lang,
    intent,
    topic,
    reasoningMode,
    complexity,
    continuity,
    abstraction,
    drift,
    novelty: 0,
    repetitionRatio: shape.repetitionRatio,
    wordCount: tokens.length
  })

  const novelty = computeNovelty(
    {
      lang,
      intent,
      topic,
      reasoningMode,
      numericSeed
    },
    context
  )

  const signals = {
    valid: !noise,
    lang,
    intent,
    topic,
    reasoningMode,
    complexity,
    continuity,
    abstraction,
    drift,
    novelty,
    repetitionRatio: shape.repetitionRatio,
    questionMarks: shape.questionMarks,
    commas: shape.commas,
    codeSignals: shape.codeSignals,
    wordCount: tokens.length,
    charCount: trimmed.length,
    isNoise: noise
  }

  signals.numeric = toNumericSignal(signals)

  return signals
}
