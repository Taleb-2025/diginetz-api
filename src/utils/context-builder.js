// ═══════════════════════════════════════════════════════════════
//  context-builder.js — CELF Frame Builder
//  المبدأ: LLM يرى السؤال الصافي فقط
//  لا تعليمات — لا توجيه أسلوب — لغة + ذاكرة خام فقط
// ═══════════════════════════════════════════════════════════════

const FILLERS = new Set([
  'the','and','or','but','is','are','was','were','a','an','in','on','at','to','for',
  'ich','bin','ein','eine','der','die','das','und','wie','mit','von','auf','bei','für',
  'هل','في','من','على','مع','هو','هي','كان','لا','أو','و','ما','هذا','ذلك'
])

// ── أدوات مساعدة ────────────────────────────────────────────────

function semanticCompress(text, maxWords = 10) {
  const cleaned = String(text ?? '').replace(/```[\s\S]*?```/g, '').trim()
  const words   = cleaned.split(/\s+/).filter(w => w.length > 2 && !FILLERS.has(w.toLowerCase()))
  return words.slice(0, maxWords).join(' ')
}

function validateRouteItem(item) {
  return (
    typeof item.score  === 'number' && item.score >= 0.25 &&
    typeof item.text   === 'string' && item.text.trim().length > 5
  )
}

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

// ── تنظيف السؤال ────────────────────────────────────────────────
// يحذف Noise والتكرار فقط — لا يمس المحتوى

export function cleanInput(text) {
  let cleaned = String(text ?? '').trim()

  // حذف تكرار الكلمات المتتالية
  cleaned = cleaned.replace(/\b(\w+)\s+\1\b/gi, '$1')

  // حذف تكرار علامات الترقيم
  cleaned = cleaned.replace(/([!?.]){3,}/g, '$1')

  // حذف whitespace زائد
  cleaned = cleaned.replace(/\s{2,}/g, ' ').trim()

  return cleaned
}

// ── بناء الذاكرة الخام ──────────────────────────────────────────
// حقائق فقط — لا استنتاجات

function buildMemoryCard(routedContext = []) {
  const valid = routedContext
    .filter(validateRouteItem)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)

  if (!valid.length) return null

  const topics = valid
    .map(item => semanticCompress(item.text, 10))
    .filter(Boolean)

  return topics.length ? { topics } : null
}

function buildMemoryLayer(memoryCard, vaultHit) {
  const lines = []

  if (vaultHit?.compressed)
    lines.push(`[سبق] ${vaultHit.compressed}`)

  if (memoryCard?.topics?.length)
    lines.push(`[سياق] ${memoryCard.topics.join(' — ')}`)

  return lines.join('\n')
}

// ── Main Export ─────────────────────────────────────────────────

export function build(adapterOutput) {
  const {
    ok, signals, celfResult, passToLLM,
    routedContext
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

  const routeItems = Array.isArray(routedContext)
    ? routedContext
    : (routedContext?.items ?? [])

  const vaultHit = Array.isArray(routedContext)
    ? null
    : (routedContext?.vaultHit ?? null)

  const intent = mapIntent(celfResult)
  const lang   = detectLang(signals)
  const phase  = celfResult?.phase ?? 'warmup'

  const context = {
    lang, phase, intent,
    coherence:  Number(celfResult?.field?.coherence        ?? 0),
    confidence: Number(celfResult?.field?.semanticGrounding?? 0),
    novelty:    Number(celfResult?.field?.noveltyPressure  ?? 0),
    continuity: Number(celfResult?.field?.continuity       ?? 0)
  }

  // ── اللغة فقط — أدنى تدخل ────────────────────────────────
  const langLine = {
    ar:    'أجب باللغة العربية.',
    en:    'Reply in English.',
    de:    'Antworte auf Deutsch.',
    mixed: 'أجب بنفس لغة المستخدم.'
  }[lang] ?? 'Reply in the user\'s language.'

  // ── ذاكرة خام — حقائق لا تعليمات ────────────────────────
  const memoryCard = buildMemoryCard(routeItems)
  const memoryLayer = buildMemoryLayer(memoryCard, vaultHit)

  // ── systemHint: لغة + ذاكرة فقط ─────────────────────────
  const systemHint = [langLine, memoryLayer]
    .filter(Boolean).join('\n')

  return {
    passToLLM,
    context,
    systemHint,
    memoryCard,
    vaultHit
  }
}
