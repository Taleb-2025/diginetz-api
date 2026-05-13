function isNoise(text, tokens) {
  if (tokens.length === 0) return true
  if (tokens.length === 1 && tokens[0].length < 2) return true
  if (/^[^a-zA-Z\u0600-\u06FF\d]+$/.test(text)) return true
  return false
}

function detectLanguage(text) {
  const arabicChars = (text.match(/[\u0600-\u06FF]/g) || []).length
  const latinChars  = (text.match(/[a-zA-Z]/g)        || []).length
  const germanChars = (text.match(/[äöüßÄÖÜ]/g)       || []).length
  const totalChars  = text.replace(/\s/g, '').length

  if (totalChars === 0) return 'unknown'

  const arRatio = arabicChars / totalChars
  const enRatio = latinChars  / totalChars

  if (arRatio > 0.4 && enRatio > 0.1) return 'mixed'
  if (arRatio > 0.4) return 'ar'
  if (arRatio > 0.1) return 'mixed'

  if (germanChars > 0) return 'de'

  const germanPattern = /\b(wie|was|der|die|das|und|ist|ich|sie|wir|zur|zum|für|mit|von|auf|bei|aber|oder|wenn|dann|auch|noch|schon|jetzt|hier|nicht|kein|mehr|sehr|wird|kann|haben|sein|werden|machen|nutze|nutzung|reduzierung|verwendung|beispiel|erstellen|warum|welche|welches|welcher|durch|nach|über|unter|zwischen|gegen|ohne|damit|wobei|jedoch|bereits|immer|einfach|schnell|direkt|möchte|müssen|sollen|dürfen|brauche|brauchen|zeige|erkläre|schreibe|erstelle|baue|implementiere)\b/i
  const words = text.toLowerCase().split(/\s+/).filter(Boolean)
  const germanWordCount = words.filter(w => germanPattern.test(w)).length

  if (germanWordCount >= 2) return 'de'

  return 'en'
}

function computeNumericSeed(tokens, lang) {
  const langScore = { ar: 0, en: 100, de: 80, mixed: 50, unknown: 200 }[lang] ?? 50
  const wordScore = Math.min(30, tokens.length * 0.18)
  return Math.round((langScore * 0.3 + wordScore * 0.7) * 10) / 10
}

function detectRupture(text) {
  return (
    text.match(/[!?@#]{2,}|ERROR|timeout|retry|fail|panic|فشل|خطأ/gi) ?? []
  ).length
}

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
  const rupture     = detectRupture(trimmed)

  return {
    valid: true,
    lang,
    wordCount:  tokens.length,
    charCount:  trimmed.length,
    numericSeed,
    rupture
  }
}
