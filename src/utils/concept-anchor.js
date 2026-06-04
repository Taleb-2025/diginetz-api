const CONCEPT_GROUPS = [
  {
    anchor:  '@repair_intent',
    pattern: /fix|debug|repair|refactor|patch|hotfix|أصلح|اصلح|إصلاح|صحح|تصحيح|reparier|beheb|korrigier/i
  },
  {
    anchor:  '@failure',
    pattern: /error|bug|crash|exception|fault|failure|خطأ|أخطاء|عطل|فشل|مشكلة[\s\S]{0,20}(كود|برنامج|نظام)|fehler|absturz|ausnahme/i
  },
  {
    anchor:  '@identity_layer',
    pattern: /login|auth|jwt|token|oauth|session|signin|logout|password|تسجيل[\s\S]{0,20}(دخول|مستخدم|حساب)|مصادقة|كلمة[\s\S]{0,10}مرور|anmeld|einlog|passwort|authentif/i
  },
  {
    anchor:  '@data_store',
    pattern: /database|postgres|mysql|mongodb|sqlite|\bsql\b|\bdb\b|query|schema|قاعدة[\s\S]{0,10}بيانات|استعلام|datenbank|abfrage/i
  },
  {
    anchor:  '@memory_layer',
    pattern: /cache|redis|buffer|queue|memo|تخزين[\s\S]{0,15}(مؤقت|سريع)|ذاكرة[\s\S]{0,10}مؤقتة|zwischenspeicher|puffer/i
  },
  {
    anchor:  '@interface_layer',
    pattern: /\bapi\b|route|endpoint|router|middleware|handler|واجهة[\s\S]{0,10}(برمجية|تطبيق)|مسار[\s\S]{0,10}طلب|schnittstelle|endpunkt/i
  },
  {
    anchor:  '@infra_layer',
    pattern: /docker|deploy|nginx|kubernetes|railway|vercel|نشر[\s\S]{0,10}(تطبيق|خادم)|bereitstell|deployment/i
  },
  {
    anchor:  '@build_intent',
    pattern: /\bbuild\b|create|generate|implement|\bwrite\b|أنشئ|اكتب|ابنِ|erstell|generier|implementier/i
  },
  {
    anchor:  '@analysis_intent',
    pattern: /analyze|review|audit|inspect|حلل|تحليل|راجع|افحص|analysier|überprüf/i
  },
  {
    anchor:  '@realtime_transport',
    pattern: /websocket|socket\.io|\bws\b|realtime|stream|بث[\s\S]{0,10}(مباشر|حي)|echtzeit/i
  },
  {
    anchor:  '@verify_intent',
    pattern: /\btest\b|jest|spec|mock|assert|coverage|اختبار|اختبر|testen|prüfen/i
  }
]

function resolveConceptAnchors(text) {
  if (!text || typeof text !== 'string') return { anchors: [], matched: false }
  const t = text.trim()
  if (t.length < 3) return { anchors: [], matched: false }
  const anchors = []
  for (const group of CONCEPT_GROUPS) {
    group.pattern.lastIndex = 0
    if (group.pattern.test(t) && !anchors.includes(group.anchor)) {
      anchors.push(group.anchor)
    }
  }
  return { anchors, matched: anchors.length > 0 }
}

function cosine(a, b) {
  if (!a?.length || !b?.length) return 0
  const D = Math.min(a.length, b.length)
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < D; i++) {
    dot += a[i] * b[i]
    na  += a[i] * a[i]
    nb  += b[i] * b[i]
  }
  return na > 0 && nb > 0 ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0
}

function anchorCoherence(anchorVecs) {
  if (!anchorVecs || anchorVecs.length <= 1) return 1
  let sum = 0, count = 0
  for (let i = 0; i < anchorVecs.length; i++) {
    for (let j = i + 1; j < anchorVecs.length; j++) {
      sum += cosine(anchorVecs[i], anchorVecs[j])
      count++
    }
  }
  return count > 0 ? sum / count : 1
}

function computeRatio(anchors, anchorVecs = null) {
  const n = anchors?.length ?? 0
  if (n === 0) return 0

  let ratio = 0.55
  if (n === 1)      ratio = 0.60
  else if (n === 2) ratio = 0.62
  else if (n === 3) ratio = 0.65
  else              ratio = 0.55

  if (anchorVecs?.length > 1) {
    const coherence = anchorCoherence(anchorVecs)
    if (coherence >= 0.70)      ratio += 0.05
    else if (coherence < 0.35)  ratio -= 0.15
    else if (coherence < 0.50)  ratio -= 0.08
  }

  if (n > 4) ratio -= 0.08

  return Math.max(0.40, Math.min(0.70, ratio))
}

function blendWithAnchors(textVec, anchorVecs, ratio) {
  if (!textVec?.length || !anchorVecs?.length || ratio <= 0) return textVec

  const D = Math.min(
    textVec.length,
    ...anchorVecs.map(v => v?.length ?? 0).filter(Boolean)
  )

  if (!D) return textVec

  const anchorAvg = new Float32Array(D)
  for (const vec of anchorVecs) {
    for (let i = 0; i < D; i++) anchorAvg[i] += vec[i] / anchorVecs.length
  }

  let anchorNorm = 0
  for (let i = 0; i < D; i++) anchorNorm += anchorAvg[i] * anchorAvg[i]
  anchorNorm = Math.sqrt(anchorNorm) || 1
  for (let i = 0; i < D; i++) anchorAvg[i] = Math.fround(anchorAvg[i] / anchorNorm)

  const out = new Float32Array(D)
  for (let i = 0; i < D; i++) {
    out[i] = anchorAvg[i] * ratio + textVec[i] * (1 - ratio)
  }

  let norm = 0
  for (let i = 0; i < D; i++) norm += out[i] * out[i]
  norm = Math.sqrt(norm) || 1
  for (let i = 0; i < D; i++) out[i] = Math.fround(out[i] / norm)

  return out
}

export { resolveConceptAnchors, blendWithAnchors, computeRatio, CONCEPT_GROUPS }
