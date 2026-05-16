// ═══════════════════════════════════════════════════════════════
//  context-builder.js — CELF Frame Builder
//  المبدأ: CELF لا يلمس السؤال — يتحكم فقط في ما حوله
// ═══════════════════════════════════════════════════════════════

const FILLERS = new Set([
  'the','and','or','but','is','are','was','were','a','an','in','on','at','to','for',
  'ich','bin','ein','eine','der','die','das','und','wie','mit','von','auf','bei','für',
  'هل','في','من','على','مع','هو','هي','كان','لا','أو','و','ما','هذا','ذلك'
])

// ── أدوات مساعدة ────────────────────────────────────────────────

function semanticCompress(text, maxWords = 10) {
  const cleaned = String(text ?? '').replace(/`[\s\S]*?`/g, '').trim()
  const words   = cleaned.split(/\s+/).filter(w => w.length > 2 && !FILLERS.has(w.toLowerCase()))
  return words.slice(0, maxWords).join(' ')
}

function validateRouteItem(item) {
  return (
    typeof item.score === 'number' &&
    item.score >= 0.25 &&
    typeof item.text  === 'string' &&
    item.text.trim().length > 5
  )
}

function mapIntent(celfResult) {
  const s = celfResult?.perturbation?.semantic
  if (!s) return 'statement'
  if (s.question)       return 'question'
  if (s.intent?.execute)return 'command'
  if (s.error)          return 'complaint'
  if (s.emotional)      return 'emotional'
  return 'statement'
}

function detectLang(signals) {
  const lang = signals?.lang ?? 'en'
  if (lang === 'ar')    return 'ar'
  if (lang === 'de')    return 'de'
  if (lang === 'mixed') return 'mixed'
  return lang ?? 'en'
}

// ── Layer 1: System Instruction ─────────────────────────────────
// تُحوّل حالة CELF الرقمية إلى تعليمات مباشرة يفهمها الـ LLM

function buildSystemInstruction(celfResult, fieldPrompt, lang) {
  const phase      = celfResult?.phase                           ?? 'warmup'
  const continuity = Number(fieldPrompt?.continuity              ?? 0)
  const novelty    = Number(celfResult?.field?.noveltyPressure   ?? 0)
  const er         = Number(celfResult?.field?.executionReadiness?? 0)
  const drift      = Number(fieldPrompt?.drift                   ?? 0)
  const comp       = Number(celfResult?.field?.compressionPressure?? 0)

  // ── اللغة ──────────────────────────────────────────────────
  const langLine = {
    ar:    'أجب باللغة العربية.',
    en:    'Reply in English.',
    de:    'Antworte auf Deutsch.',
    mixed: 'أجب بنفس لغة المستخدم.'
  }[lang] ?? 'Reply in the user\'s language.'

  // ── أسلوب الرد — من حالة الحقل ────────────────────────────
  const style =
    er > 0.6 && continuity > 0.5   ? 'اكتب كوداً كاملاً قابلاً للتشغيل. لا تختصر.'  :
    novelty > 0.7 && continuity < 0.4 ? 'موضوع جديد كلياً. اشرح من الأساس.'          :
    comp > 0.7 && continuity > 0.7  ? 'لا تعد الشرح. اذهب مباشرة للإجابة.'           :
    continuity > 0.8 && novelty < 0.3 ? 'المستخدم يعرف ما سبق. كن مختصراً وتقنياً.' :
    drift > 0.5                     ? 'الموضوع تغيّر. تجاهل السياق السابق وابدأ طازجاً.' :
    phase === 'locked' && drift < 0.2 ? 'نحن في عمق الموضوع. ابقَ مركزاً بدون حيود.' :
    phase === 'turbulent'           ? 'الموضوع غير واضح. اسأل عن المقصود إن لزم.'     :
    null

  return [langLine, style].filter(Boolean).join('\n')
}

// ── Layer 2: Memory Layer ───────────────────────────────────────
// يُحوّل ما استرجعه CELF من الذاكرة إلى سياق مقروء للـ LLM

function buildMemoryLayer(memoryCard, vaultHit) {
  const lines = []

  // من الـ Vault — أقوى ذاكرة طويلة الأمد
  if (vaultHit?.compressed) {
    lines.push(`[تحدثنا سابقاً] ${vaultHit.compressed}`)
  }

  // من الذاكرة قصيرة الأمد
  if (memoryCard?.topics?.length) {
    lines.push(`[السياق الحالي] ${memoryCard.topics.join(' — ')}`)
  }

  return lines.join('\n')
}

// ── Memory Card Builder ─────────────────────────────────────────
// يبني بطاقة الذاكرة من routeContext

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
    continuity:       fieldPrompt?.continuity  ?? 0,
    semanticPressure: fieldPrompt?.pressure    ?? 'neutral',
    zone:             fieldPrompt?.zone        ?? 'general',
    confidence:       Math.round(avgScore * 1000) / 1000
  }
}

// ── Main Export ─────────────────────────────────────────────────

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

  // ── routeContext يُعيد array أو {items, vaultHit} ─────────
  const routeItems = Array.isArray(routedContext)
    ? routedContext
    : (routedContext?.items ?? [])

  const vaultHit = Array.isArray(routedContext)
    ? null
    : (routedContext?.vaultHit ?? null)

  const intent = mapIntent(celfResult)
  const lang   = detectLang(signals)
  const phase  = celfResult?.phase ?? 'warmup'
  const drift  = Number(celfResult?.field?.drift ?? 0)

  const context = {
    lang, phase, intent, drift,
    coherence:   Number(celfResult?.field?.coherence          ?? 0),
    confidence:  Number(celfResult?.field?.semanticGrounding  ?? 0),
    novelty:     Number(celfResult?.field?.noveltyPressure    ?? 0),
    continuity:  Number(fieldPrompt?.continuity               ?? 0)
  }

  // ── بناء طبقات الإطار ────────────────────────────────────
  const memoryCard = buildMemoryCard(routeItems, fieldPrompt)

  const systemHint = [
    buildSystemInstruction(celfResult, fieldPrompt, lang),  // Layer 1
    buildMemoryLayer(memoryCard, vaultHit)                  // Layer 2
  ].filter(Boolean).join('\n')

  return {
    passToLLM,
    context,
    systemHint,
    memoryCard,
    vaultHit
  }
}
