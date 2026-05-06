/**
 * CELF AI — Lightweight Parser
 * Detects language + extracts semantic signals from raw text
 * No external dependencies, runs locally on server
 */

// ─── Intent Patterns ───────────────────────────────────────────
const INTENT_PATTERNS = {
  question: {
    ar: /^(ما|من|كيف|متى|أين|لماذا|هل|ماذا|كم|أي)\b/,
    en: /^(what|who|how|when|where|why|is|are|can|could|would|should|do|does|did)\b/i
  },
  command: {
    ar: /^(اعطني|أعطني|اكتب|اشرح|وضح|ساعدني|قم|افعل|ابحث|ترجم|حلل|لخص)\b/,
    en: /^(give|write|explain|help|do|find|search|translate|analyze|summarize|create|make|list)\b/i
  },
  greeting: {
    ar: /^(مرحبا|السلام|أهلا|هلا|صباح|مساء|كيف حالك)/,
    en: /^(hi|hello|hey|good morning|good evening|how are you)/i
  },
  complaint: {
    ar: /^(لماذا لا|لا يعمل|مشكلة|خطأ|فشل|لم يعمل)/,
    en: /^(why (isn't|doesn't|won't)|not working|problem|error|failed|broken)/i
  }
}

// ─── Topic Signals ──────────────────────────────────────────────
const TOPIC_SIGNALS = {
  technical: /\b(api|code|كود|server|سيرفر|error|خطأ|function|دالة|database|قاعدة بيانات|deploy|javascript|python)\b/i,
  financial: /\b(price|سعر|money|مال|cost|تكلفة|pay|دفع|bitcoin|gold|ذهب|dollar|دولار)\b/i,
  general:   /\b(help|مساعدة|info|معلومات|explain|شرح|what|ما|how|كيف)\b/i
}

// ─── Language Detection ─────────────────────────────────────────
function detectLanguage(text) {
  const arabicChars = (text.match(/[\u0600-\u06FF]/g) || []).length
  const totalChars  = text.replace(/\s/g, '').length
  if (totalChars === 0) return 'unknown'
  const ratio = arabicChars / totalChars
  if (ratio > 0.4) return 'ar'
  if (ratio > 0.1) return 'mixed'
  return 'en'
}

// ─── Complexity Score ───────────────────────────────────────────
function computeComplexity(text, tokens) {
  const wordCount    = tokens.length
  const avgWordLen   = tokens.reduce((s, t) => s + t.length, 0) / (wordCount || 1)
  const hasPunctuation = /[؟?!،,;:]/.test(text)
  const hasNumbers   = /\d/.test(text)
  const hasSubClause = /\b(because|because|لأن|حيث|الذي|التي|which|that|who)\b/i.test(text)

  let score = 0
  if (wordCount > 3)    score += 0.2
  if (wordCount > 8)    score += 0.2
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
    const pattern = patterns[langKey] || patterns['en']
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

// ─── Noise Detection ────────────────────────────────────────────
function isNoise(text, tokens) {
  if (tokens.length === 0)  return true
  if (tokens.length === 1 && tokens[0].length < 2) return true
  if (/^[^a-zA-Z\u0600-\u06FF]+$/.test(text)) return true
  return false
}

// ─── Numeric Signal ─────────────────────────────────────────────
// Converts text features into a numeric value CELF can process
function toNumericSignal(signals) {
  const intentMap = { greeting: 10, question: 30, command: 50, complaint: 70, statement: 40 }
  const topicMap  = { general: 1, technical: 2, financial: 3 }
  const langMap   = { ar: 0, en: 100, mixed: 50, unknown: 200 }

  const base =
    (intentMap[signals.intent]  || 40) +
    (topicMap[signals.topic]    || 1) * 10 +
    (signals.complexity         * 50) +
    (langMap[signals.lang]      || 0) * 0.1 +
    (signals.wordCount          * 0.5)

  return Math.min(999, Math.round(base * 10) / 10)
}

// ─── Main Parser ────────────────────────────────────────────────
export function parse(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return { valid: false, reason: 'empty_input', numeric: 0 }
  }

  const trimmed  = text.trim()
  const tokens   = trimmed.split(/\s+/).filter(Boolean)
  const lang     = detectLanguage(trimmed)
  const intent   = detectIntent(trimmed, lang)
  const topic    = detectTopic(trimmed)
  const complexity = computeComplexity(trimmed, tokens)
  const noise    = isNoise(trimmed, tokens)

  const signals = {
    valid:      !noise,
    lang,
    intent,
    topic,
    complexity,
    wordCount:  tokens.length,
    charCount:  trimmed.length,
    isNoise:    noise
  }

  signals.numeric = toNumericSignal(signals)

  return signals
}
