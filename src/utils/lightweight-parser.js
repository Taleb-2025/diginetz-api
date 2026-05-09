/**
 * lightweight-parser.js — v2.1
 *
 * دور محدود ومقصود:
 * 1. noise guard        — رفض الإدخال الفارغ أو غير القابل للمعالجة
 * 2. language detection — ar / en / mixed
 * 3. numericSeed        — للـ logging فقط
 * 4. rupture detection  — جديد V2.1 — يوحّد مصدر الكشف مع V5
 *
 * كل التحليل العميق (intent, drift, continuity, abstraction...)
 * يحدث داخل CELF_Engine_AI_V5 — لا تكرار هنا.
 */

// ─────────────────────────────────────────────
//  Noise detection
// ─────────────────────────────────────────────

function isNoise(text, tokens) {
  if (tokens.length === 0) return true
  if (tokens.length === 1 && tokens[0].length < 2) return true
  if (/^[^a-zA-Z\u0600-\u06FF\d]+$/.test(text)) return true
  return false
}

// ─────────────────────────────────────────────
//  Language detection
// ─────────────────────────────────────────────

function detectLanguage(text) {
  const arabicChars = (text.match(/[\u0600-\u06FF]/g) || []).length
  const latinChars  = (text.match(/[a-zA-Z]/g)        || []).length
  const totalChars  = text.replace(/\s/g, '').length

  if (totalChars === 0) return 'unknown'

  const arRatio = arabicChars / totalChars
  const enRatio = latinChars  / totalChars

  if (arRatio > 0.4 && enRatio > 0.1) return 'mixed'
  if (arRatio > 0.4)                   return 'ar'
  if (arRatio > 0.1)                   return 'mixed'
  return 'en'
}

// ─────────────────────────────────────────────
//  Minimal numeric seed (for logging only)
// ─────────────────────────────────────────────

function computeNumericSeed(tokens, lang) {
  const langScore = { ar: 0, en: 100, mixed: 50, unknown: 200 }[lang] ?? 50
  const wordScore = Math.min(30, tokens.length * 0.18)
  return Math.round((langScore * 0.3 + wordScore * 0.7) * 10) / 10
}

// ─────────────────────────────────────────────
//  Rupture detection — v2.1
//  يُوحِّد الكشف مع ما يحسبه CELF_Engine_AI_V5
//  داخل perturb() لتجنب التضارب
// ─────────────────────────────────────────────

function detectRupture(text) {
  return (
    text.match(/[!?@#]{2,}|ERROR|timeout|retry|fail|panic|فشل|خطأ/gi) ?? []
  ).length
}

// ─────────────────────────────────────────────
//  Main export
// ─────────────────────────────────────────────

export function parse(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return { valid: false, reason: 'empty_input' }
  }

  const trimmed = text.trim()
  const tokens  = trimmed.split(/\s+/).filter(Boolean)
  const noise   = isNoise(trimmed, tokens)

  if (noise) {
    return { valid: false, reason: 'noise' }
  }

  const lang        = detectLanguage(trimmed)
  const numericSeed = computeNumericSeed(tokens, lang)
  const rupture     = detectRupture(trimmed)   // v2.1

  return {
    valid:      true,
    lang,
    wordCount:  tokens.length,
    charCount:  trimmed.length,
    numericSeed,
    rupture                                    // v2.1 — للـ logging والـ severity
    // intent / topic / drift / continuity / abstraction
    // → computed by CELF_Engine_AI_V5 internally
  }
}
