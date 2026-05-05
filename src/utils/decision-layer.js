// utils/decision-layer.js

import { buildCelfContext } from './celf-context.js'

// ─────────────────────────────────────────────
// TAF — Temporal Anomaly Filter
// ─────────────────────────────────────────────
class TemporalAnomalyFilter {
  constructor(windowSize = 10) {
    this.window     = []
    this.windowSize = windowSize
  }

  update(result, confidence) {
    // confidence يؤثر على قوة الـ flag (لا نعامل كل impossible بالتساوي)
    const flag = result.impossible ? Math.max(0.3, confidence) : 0

    this.window.push(flag)
    if (this.window.length > this.windowSize) this.window.shift()

    const score =
      this.window.reduce((a, b) => a + b, 0) / this.window.length

    return {
      score:         Math.round(score * 100) / 100,
      isSpike:       result.impossible && score < 0.3,
      isRealAnomaly: result.impossible && score >= 0.4
    }
  }
}

// ─────────────────────────────────────────────
// LLM — فقط عند الحاجة
// ─────────────────────────────────────────────
async function analyzeWithLLM(event, celfResult, context) {
  const controller = new AbortController()
  const timeout    = setTimeout(() => controller.abort(), 3000)

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method:  'POST',
      signal:  controller.signal,
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type':  'application/json'
      },
      body: JSON.stringify({
        model:       'gpt-4o-mini',
        temperature: 0.2,
        messages: [
          {
            role:    'system',
            content: `You are a fraud detection assistant.
Respond in JSON only with:
- severity (low|medium|high|extreme)
- reason (one sentence)
- action (allow|review|block)`
          },
          {
            role:    'user',
            content: JSON.stringify({
              event,
              celf: {
                ...context.raw,
                ...context.interpretation
              }
            })
          }
        ]
      })
    })

    const data = await response.json()
    return JSON.parse(data.choices[0].message.content)

  } catch {
    // timeout أو parse error → قرار محافظ
    return { severity: 'high', reason: 'llm_unavailable', action: 'review' }
  } finally {
    clearTimeout(timeout)
  }
}

// ─────────────────────────────────────────────
// Decision Layer — الطبقة الرئيسية
// ─────────────────────────────────────────────
export class DecisionLayer {
  constructor(options = {}) {
    this.taf         = new TemporalAnomalyFilter(options.windowSize ?? 10)
    this.useLLM      = options.useLLM ?? true
    this.llmMinSeverity = options.llmMinSeverity ?? 'high'
  }

  async evaluate(celfResult, event = null) {
    const context = buildCelfContext(celfResult)
    const taf     = this.taf.update(celfResult, celfResult.confidence ?? 0)

    const severityRank = { low: 0, moderate: 1, high: 2, extreme: 3 }
    const minRank      = severityRank[this.llmMinSeverity] ?? 2

    // LLM فقط إذا: شذوذ متكرر + severity عالٍ + event متاح
    const needsLLM =
      this.useLLM            &&
      event !== null         &&
      taf.isRealAnomaly      &&
      severityRank[context.interpretation.severity] >= minRank

    const llm = needsLLM
      ? await analyzeWithLLM(event, celfResult, context)
      : null

    // القرار النهائي
    const action = (() => {
      if (!celfResult.impossible)  return 'allow'
      if (taf.isSpike)             return 'allow'   // حادثة عابرة
      if (!taf.isRealAnomaly)      return 'allow'   // لم يتكرر بعد
      if (llm)                     return llm.action // LLM يحكم
      // بدون LLM — نحكم من severity
      const s = context.interpretation.severity
      if (s === 'extreme')         return 'block'
      if (s === 'high')            return 'block'
      return 'review'
    })()

    return {
      action,
      taf: {
        score:         taf.score,
        isSpike:       taf.isSpike,
        isRealAnomaly: taf.isRealAnomaly
      },
      context,
      llm,
      celf: {
        impossible:    celfResult.impossible,
        phase:         celfResult.phase,
        confidence:    celfResult.confidence,
        maturityScore: celfResult.maturityScore
      }
    }
  }
}
