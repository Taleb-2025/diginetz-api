/**
 * CELF AI — Lightweight Parser v2
 * Converts raw text into compact semantic signals for CELF.
 * Goal: detect not only intent/topic, but also thought trajectory.
 */

// ─── Intent Patterns ───────────────────────────────────────────
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

// ─── Topic Signals ─────────────────────────────────────────────
const TOPIC_SIGNALS = {
  technical: /\b(api|code|كود|server|سيرفر|error|خطأ|function|دالة|database|قاعدة بيانات|deploy|javascript|python|github|railway|redis|route|endpoint)\b/i,
  financial: /\b(price|سعر|money|مال|cost|تكلفة|pay|دفع|bitcoin|gold|ذهب|dollar|دولار|investment|مستثمر)\b/i,
  ai: /\b(ai|ذكاء|llm|model|نموذج|prompt|token|embedding|context|hallucination|استدلال|استبعاد)\b/i,
  philosophical: /\b(فلسفة|النسق|الممكن|المستحيل|الحاضر|الماضي|الأثر|المعنى|استبعاد|اتساق|وجود|حقيقة)\b/i,
  general: /\b(help|مساعدة|info|معلومات|explain|شرح|what|ما|how|كيف)\b/i
}

// ─── Reasoning Mode Signals ────────────────────────────────────
const REASONING_SIGNALS = {
  technical: /\b(كود|api|server|route|endpoint|function|deploy|github|redis|database|خطأ|error)\b/i,
  philosophical: /\b(فلسفة|النسق|الممكن|المستحيل|الحاضر|الماضي|الأثر|المعنى|الحقيقة|استبعاد|اتساق)\b/i,
  analytical: /\b(حلل|تحليل|قارن|نسبة|احسب|دليل|تقييم|نتيجة|سبب|لماذا)\b/i,
  creative: /\b(صمم|شعار|اكتب|اسم|فكرة|تصميم|واجهة|منتج)\b/i,
  operational: /\b(عدل|احذف|أضف|انزل|ارفع|اختبر|شغل|افتح|اضغط)\b/i
}

// ─── Language Detection ─────────────────────────────────────────
function detectLanguage(text) {
  const arabicChars = (text.match(/[\u0600-\u06FF]/g) || []).length
  const latinChars  = (text.match(/[a-zA-Z]/g) || []).length
  const totalChars  = text.replace(/\s/g, '').length

  if (totalChars === 0) return 'unknown'

  const arRatio = arabicChars / totalChars
  const enRatio = latinChars / totalChars

  if (arRatio > 0.4 && enRatio > 0.1) return 'mixed'
  if (arRatio > 0.4) return 'ar'
  if (arRatio > 0.1) return 'mixed'
  return 'en'
}

// ─── Complexity Score ───────────────────────────────────────────
function computeComplexity(text, tokens) {
  const wordCount      = tokens.length
  const avgWordLen     = tokens.reduce((s, t) => s + t.length, 0) / (wordCount || 1)
  const hasPunctuation = /[؟?!،,;:]/.test(text)
  const hasNumbers     = /\d/.test(text)
  const hasSubClause   = /\b(because|لأن|حيث|الذي|التي|which|that|who|while|بينما|لكن|رغم)\b/i.test(text)

  let score = 0
  if (wordCount > 3)    score += 0.2
  if (wordCount > 8)    score += 0.2
  if (wordCount > 20)   score += 0.15
  if (avgWordLen > 5)   score += 0.1
  if (hasPunctuation)   score += 0.1
  if (hasNumbers)       score += 0.1
  if (hasSubClause)     score += 0.3

  return Math.min(1, Math.round(score * 100) / 100)
}

// ─── Intent Detection ───────────────────────────────────────────
function detectIntent(text, lang) {
  const trimmed = text.trim()
  const langKey = lang === 'ar' ? 'ar' : 'en'

  for (const [intent, patterns] of Object.entries(INTENT_PATTERNS)) {
    const pattern = patterns[langKey] || patterns.en
    if (pattern.test(trimmed)) return intent
  }

  return 'statement'
}

// ─── Topic Detection ────────────────────────────────────────────
function detectTopic(text) {
  for (const [topic, pattern] of Object.entries(TOPIC_SIGNALS)) {
    if (pattern.test(text)) return topic
  }
  return 'general'
}

// ─── Reasoning Mode Detection ───────────────────────────────────
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

// ─── Noise Detection ────────────────────────────────────────────
function isNoise(text, tokens) {
  if (tokens.length === 0) return true
  if (tokens.length === 1 && tokens[0].length < 2) return true
  if (/^[^a-zA-Z\u0600-\u06FF]+$/.test(text)) return true
  return false
}

// ─── Text Shape Signals ─────────────────────────────────────────
function computeTextShape(text, tokens) {
  const unique = new Set(tokens.map(t => t.toLowerCase()))
  const repetitionRatio = tokens.length
    ? 1 - unique.size / tokens.length
    : 0

  const questionMarks = (text.match(/[؟?]/g) || []).length
  const commas        = (text.match(/[،,]/g) || []).length
  const codeSignals   = (text.match(/```|const |function |=>|import |export |{|}/g) || []).length

  return {
    repetitionRatio: Math.round(repetitionRatio * 100) / 100,
    questionMarks,
    commas,
    codeSignals
  }
}

// ─── Continuity Score ───────────────────────────────────────────
// Higher = text looks like continuation of an existing thought.
// Lower = abrupt isolated request.
function computeContinuity(text, tokens) {
  const continuationMarkers =
    /\b(أيضًا|كذلك|إذن|لذلك|لكن|رغم|ثم|وبالتالي|يعني|نفس|هذا|هذه|هنا|therefore|also|but|so|then|same|this|that)\b/gi

  const markers = (text.match(continuationMarkers) || []).length
  const pronouns = (text.match(/\b(هو|هي|هذا|هذه|ذلك|تلك|it|this|that|they)\b/gi) || []).length

  let score = 0
  if (tokens.length > 8) score += 0.25
  if (markers > 0) score += 0.35
  if (pronouns > 0) score += 0.2
  if (/[،,;:]/.test(text)) score += 0.1
  if (/\b(لكن|بينما|رغم|because|while|however)\b/i.test(text)) score += 0.1

  return Math.min(1, Math.round(score * 100) / 100)
}

// ─── Abstraction Score ──────────────────────────────────────────
// Higher = philosophical / structural / conceptual language.
function computeAbstraction(text) {
  const abstractTerms =
    /(نسق|بنية|أثر|فلسفة|ممكن|مستحيل|حاضر|ماضي|معنى|استدلال|استبعاد|اتساق|احتمال|فضاء|خلايا|تعلم|وعي|pattern|structure|meaning|context|possibility|constraint|inference)/gi

  const count = (text.match(abstractTerms) || []).length
  return Math.min(1, Math.round((count / 6) * 100) / 100)
}

// ─── Drift Score ────────────────────────────────────────────────
// Higher = text contains switches, mixed language, or topic instability.
function computeDrift(text, lang, topic, reasoningMode) {
  let score = 0

  if (lang === 'mixed') score += 0.25
  if (text.includes('لكن') || /\bbut\b/i.test(text)) score += 0.15
  if (text.includes('فجأة') || /\bsuddenly\b/i.test(text)) score += 0.15
  if (topic === 'general' && reasoningMode !== 'general') score += 0.1

  const separators = (text.match(/[،,;:]/g) || []).length
  if (separators > 3) score += 0.15

  return Math.min(1, Math.round(score * 100) / 100)
}

// ─── Numeric Signal ─────────────────────────────────────────────
// Converts semantic state into one stable CELF value.
// Still one number, but now includes thought trajectory.
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
    (signals.complexity * 45) +
    (signals.continuity * 55) +
    (signals.abstraction * 65) +
    (signals.drift * 35) +
    (signals.repetitionRatio * 20) +
    (reasoningMap[signals.reasoningMode] || 0) +
    (langMap[signals.lang] || 0) * 0.1 +
    (signals.wordCount * 0.35)

  return Math.min(999, Math.round(base * 10) / 10)
}

// ─── Main Parser ────────────────────────────────────────────────
export function parse(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return { valid: false, reason: 'empty_input', numeric: 0 }
  }

  const trimmed = text.trim()
  const tokens  = trimmed.split(/\s+/).filter(Boolean)

  const lang          = detectLanguage(trimmed)
  const intent        = detectIntent(trimmed, lang)
  const topic         = detectTopic(trimmed)
  const reasoningMode = detectReasoningMode(trimmed)
  const complexity    = computeComplexity(trimmed, tokens)
  const shape         = computeTextShape(trimmed, tokens)
  const continuity    = computeContinuity(trimmed, tokens)
  const abstraction   = computeAbstraction(trimmed)
  const drift         = computeDrift(trimmed, lang, topic, reasoningMode)
  const noise         = isNoise(trimmed, tokens)

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
