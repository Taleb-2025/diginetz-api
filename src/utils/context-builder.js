// ═══════════════════════════════════════════════════════════════
//  context-builder.js — v7.2
//
//  systemHint يُبنى من ثلاث طبقات:
//  1. context injection  (similarity-based)
//  2. vault hit          (memory)
//  3. style hint         (TTL-based)
// ═══════════════════════════════════════════════════════════════

const FILLERS = new Set([
  'the','and','or','but','is','are','was','were','a','an','in','on','at','to','for',
  'ich','bin','ein','eine','der','die','das','und','wie','mit','von','auf','bei','für',
  'هل','في','من','على','مع','هو','هي','كان','لا','أو','و','ما','هذا','ذلك'
])

// ── Style TTL Store (per session) ───────────────────────────────
// يُدار من الـ Route — يُمرَّر هنا للبناء فقط

const STYLE_HINTS = {
  concise:  'أجب بإيجاز.',
  detailed: 'أجب بتفصيل كامل.',
  arabic:   'أجب باللغة العربية.',
  english:  'Reply in English.',
  german:   'Antworte auf Deutsch.'
}

// ── أدوات مساعدة ────────────────────────────────────────────────

function semanticCompress(text, maxWords = 10) {
  const cleaned = String(text ?? '').replace(/```[\s\S]*?```/g, '').trim()
  const words   = cleaned.split(/\s+/).filter(w => w.length > 2 && !FILLERS.has(w.toLowerCase()))
  return words.slice(0, maxWords).join(' ')
}

function validateRouteItem(item) {
  return (
    typeof item.score === 'number' && item.score >= 0.25 &&
    typeof item.text  === 'string' && item.text.trim().length > 5
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

export function cleanInput(text) {
  let cleaned = String(text ?? '').trim()
  cleaned = cleaned.replace(/\b(\w+)\s+\1\b/gi, '$1')
  cleaned = cleaned.replace(/([!?.،]){3,}/g, '$1')
  cleaned = cleaned.replace(/\s{2,}/g, ' ').trim()
  return cleaned
}

// ── Style Instruction Detection ──────────────────────────────────
// يُحدد إذا الرسالة تعليمة أسلوب — ويُرجع style + ttl

export function detectStyleInstruction(text) {
  const t     = String(text ?? '').trim()
  const words = t.split(/\s+/).length

  // رسالة قصيرة أسلوبية فقط (أقل من 10 كلمات)
  if (words > 10) return null

  if (/أجب\s*مختصر|موجز|باختصار|كن\s*وجيز/i.test(t))
    return { style: 'concise', ttl: 3 }

  if (/بالتفصيل|مفصل|اشرح\s*كامل|comprehensive|detailed/i.test(t))
    return { style: 'detailed', ttl: 3 }

  if (/brief(ly)?|concise|short\s*answer/i.test(t))
    return { style: 'concise', ttl: 3 }

  if (/kurz|knapp/i.test(t))
    return { style: 'concise', ttl: 3 }

  return null
}

// ── تصفية تعليمات الأسلوب من History ────────────────────────────

export function filterStyleInstructions(history) {
  return history.filter(h => {
    if (h.role !== 'user') return true
    return !detectStyleInstruction(h.content)
  })
}

// ── بناء Memory Card ─────────────────────────────────────────────

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

// ── systemHint Builder ───────────────────────────────────────────

function buildSystemHint({ similarity, lastTopicText, vaultHit, activeStyle }) {
  const parts = []

  // ── Layer 1: Context Injection ───────────────────────────────
  if (similarity !== null && similarity > 0.80 && lastTopicText) {
    parts.push(`[متابعة عن: ${lastTopicText}]`)
  }

  // ── Layer 2: Vault Hit ───────────────────────────────────────
  if (vaultHit?.compressed) {
    parts.push(`[سبق] ${vaultHit.compressed}`)
  }

  // ── Layer 3: Style TTL ───────────────────────────────────────
  if (activeStyle && STYLE_HINTS[activeStyle]) {
    parts.push(STYLE_HINTS[activeStyle])
  }

  // بعيد جداً — امسح الـ context لكن احتفظ بالـ style
  if (similarity !== null && similarity < 0.30) {
    const styleOnly = activeStyle && STYLE_HINTS[activeStyle]
      ? [STYLE_HINTS[activeStyle]]
      : []
    return styleOnly.length ? styleOnly.join('\n') : null
  }

  return parts.length ? parts.join('\n') : null
}

// ── Main Export ─────────────────────────────────────────────────

export function build(adapterOutput) {
  const {
    ok, signals, celfResult, passToLLM,
    routedContext,
    questionSimilarity = null,
    lastTopicText      = null,
    activeStyle        = null
  } = adapterOutput

  if (!ok) {
    return { passToLLM: false, systemHint: null, memoryCard: null, context: null }
  }

  const routeItems = Array.isArray(routedContext)
    ? routedContext
    : (routedContext?.items ?? [])

  const vaultHit = Array.isArray(routedContext)
    ? null
    : (routedContext?.vaultHit ?? null)

  const intent = mapIntent(celfResult)
  const lang   = detectLang(signals)

  const context = {
    lang, intent,
    continuity:  Number(celfResult?.field?.continuity ?? 0),
    similarity:  questionSimilarity,
    activeStyle
  }

  const memoryCard = buildMemoryCard(routeItems)

  const systemHint = buildSystemHint({
    similarity:    questionSimilarity,
    lastTopicText,
    vaultHit,
    activeStyle
  })

  return {
    passToLLM,
    context,
    systemHint,
    memoryCard,
    vaultHit
  }
}
