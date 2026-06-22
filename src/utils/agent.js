const AGENT_SYSTEM_BASE =
  'You are CELF Agent — a code and text coordination system. ' +
  'You analyze, compare, and fix files with precision. ' +
  'No preamble. No filler. Output only what was requested.'

const TIMELINE_SYSTEM =
  AGENT_SYSTEM_BASE + '\n\n' +
  'MODE: Timeline — comparing versions of the same file.\n' +
  'RULES:\n' +
  '- Compare versions chronologically\n' +
  '- Identify what improved and what was lost in each step\n' +
  '- Produce the best merged version — take the best parts from all versions\n' +
  '- Return complete code without truncation\n' +
  'FORMAT:\n' +
  '## Analysis\n' +
  '[brief comparison of versions]\n\n' +
  '## What Improved\n' +
  '[list]\n\n' +
  '## What Was Lost\n' +
  '[list or "Nothing"]\n\n' +
  '## Best Merged Version\n' +
  '```[lang]\n' +
  '[complete code]\n' +
  '```'

const PROJECT_SYSTEM =
  AGENT_SYSTEM_BASE + '\n\n' +
  'MODE: Project — coordinating multiple files in the same project.\n' +
  'RULES:\n' +
  '- Trace all cross-file dependencies\n' +
  '- Find ALL conflicts: undefined refs, wrong imports, naming issues, breaking changes\n' +
  '- Fix each file to work correctly with all others\n' +
  '- Return each fixed file completely — no truncation\n' +
  'FORMAT:\n' +
  '## Conflicts Found\n' +
  '[list each conflict with file name and line if known]\n\n' +
  '## Fixed Files\n\n' +
  '### [filename] v[N+1]\n' +
  '```[lang]\n' +
  '[complete fixed code]\n' +
  '```\n' +
  '[repeat for each fixed file]'

// ── Autonomous system prompts (4 variants) ──────────────────────────────────

const AUTONOMOUS_CODE_TIMELINE_SYSTEM =
  AGENT_SYSTEM_BASE + '\n\n' +
  'MODE: Autonomous Timeline — multiple versions of the same code file.\n' +
  'TASK: Produce one optimal final version by merging the best from all versions.\n' +
  'RULES:\n' +
  '- Read all versions chronologically\n' +
  '- Keep every improvement, discard every regression\n' +
  '- The result must be complete, functional, and production-ready\n' +
  '- Return the full merged code — no truncation, no placeholders\n' +
  '@execute.strict @accuracy.strict @output.full_return @output.validate\n' +
  'FORMAT:\n' +
  '## Version Analysis\n' +
  '[what changed across versions — 3-5 lines max]\n\n' +
  '## Best Merged Version\n' +
  '```[lang]\n' +
  '[complete merged code]\n' +
  '```'

const AUTONOMOUS_CODE_PROJECT_SYSTEM =
  AGENT_SYSTEM_BASE + '\n\n' +
  'MODE: Autonomous Project — multiple different code files in the same project.\n' +
  'TASK: Coordinate all files so they work together correctly.\n' +
  'RULES:\n' +
  '- Trace every cross-file dependency (imports, exports, shared state, API contracts)\n' +
  '- Find ALL conflicts: undefined refs, wrong imports, naming mismatches, breaking changes\n' +
  '- Fix every file to be fully compatible with all others\n' +
  '- Return each fixed file completely — no truncation, no placeholders\n' +
  '@execute.strict @accuracy.strict @output.full_return @output.validate\n' +
  'FORMAT:\n' +
  '## Conflicts Found\n' +
  '[list each conflict with file name]\n\n' +
  '## Coordinated Files\n\n' +
  '### [filename]\n' +
  '```[lang]\n' +
  '[complete fixed code]\n' +
  '```\n' +
  '[repeat for every file]'

const AUTONOMOUS_TEXT_TIMELINE_SYSTEM =
  AGENT_SYSTEM_BASE + '\n\n' +
  'MODE: Autonomous Timeline — multiple versions of the same text document.\n' +
  'TASK: Produce one optimal final version by merging the best from all versions.\n' +
  'RULES:\n' +
  '- Read all versions chronologically\n' +
  '- Keep the best phrasing, structure, and content from each version\n' +
  '- The result must be complete, coherent, and polished\n' +
  '- Return the full merged text — no truncation\n' +
  '@execute.strict @accuracy.strict @output.full_return\n' +
  'FORMAT:\n' +
  '## Version Analysis\n' +
  '[what changed across versions — 2-4 lines max]\n\n' +
  '## Best Merged Version\n' +
  '[complete merged text]'

const AUTONOMOUS_TEXT_PROJECT_SYSTEM =
  AGENT_SYSTEM_BASE + '\n\n' +
  'MODE: Autonomous Project — multiple different text documents in the same project.\n' +
  'TASK: Coordinate all documents for consistency, tone, and coherence.\n' +
  'RULES:\n' +
  '- Identify tone, style, and terminology conflicts across documents\n' +
  '- Align all documents to a unified voice and consistent terminology\n' +
  '- Return each coordinated document completely — no truncation\n' +
  '@execute.strict @accuracy.strict @output.full_return\n' +
  'FORMAT:\n' +
  '## Inconsistencies Found\n' +
  '[list tone/style/terminology conflicts]\n\n' +
  '## Coordinated Documents\n\n' +
  '### [document name]\n' +
  '[complete coordinated text]\n' +
  '[repeat for every document]'

// ── Autonomous builder ───────────────────────────────────────────────────────

export function buildAutonomousPrompt(agentType, contentType, files) {
  const intro = agentType === 'timeline'
    ? 'The following are versions of the same ' + contentType + '. Produce the best merged version.\n\n'
    : 'The following are different ' + contentType + ' files in the same project. Coordinate them.\n\n'
  const body = files.map(f => {
    const label = f.name ? `// ${f.name}` : '// file'
    return contentType === 'code'
      ? `${label}\n\`\`\`\n${f.raw}\n\`\`\``
      : `${label}\n${f.raw}`
  }).join('\n\n')
  return intro + body
}

// ── Legacy signal-based detection (kept as fallback) ─────────────────────────

export function detectAgentType(text) {
  if (/^\[celf:autonomous_timeline\]/.test(text)) return 'autonomous_timeline'
  if (/^\[celf:autonomous_project\]/.test(text))  return 'autonomous_project'
  if (/^\[celf:timeline\]/.test(text)) return 'timeline'
  if (/^\[celf:project\]/.test(text))  return 'project'
  return null
}

export function stripAgentSignal(text) {
  return text.replace(/^\[celf:(autonomous_timeline|autonomous_project|timeline|project)\]\s*/, '')
}

export function buildAutonomousSystem(agentType, contentType) {
  // Normalize: accept both 'timeline' and 'autonomous_timeline'
  const _type    = String(agentType   || '').replace('autonomous_', '')
  const _content = String(contentType || 'code')
  if (_type === 'timeline' && _content === 'code') return AUTONOMOUS_CODE_TIMELINE_SYSTEM
  if (_type === 'project'  && _content === 'code') return AUTONOMOUS_CODE_PROJECT_SYSTEM
  if (_type === 'timeline' && _content === 'text') return AUTONOMOUS_TEXT_TIMELINE_SYSTEM
  if (_type === 'project'  && _content === 'text') return AUTONOMOUS_TEXT_PROJECT_SYSTEM
  return AUTONOMOUS_CODE_PROJECT_SYSTEM
}

export function buildAgentSystem(agentType) {
  if (agentType === 'timeline') return TIMELINE_SYSTEM
  if (agentType === 'project')  return PROJECT_SYSTEM
  return AGENT_SYSTEM_BASE
}

export function buildAgentPrompt(agentType, text) {
  const cleanText = stripAgentSignal(text)
  if (agentType === 'timeline') {
    return (
      'Compare the following versions and produce the best merged version.\n' +
      'Follow the format exactly.\n\n' +
      cleanText
    )
  }
  if (agentType === 'project') {
    return (
      'Find all conflicts between the following files and return fixed versions.\n' +
      'Follow the format exactly.\n\n' +
      cleanText
    )
  }
  return cleanText
}

export function parseAgentResponse(reply, agentType) {
  const result = {
    analysis:   null,
    fixedFiles: [],
    hasCode:    false,
  }

  // Normalize agentType — strip 'autonomous_' prefix for routing
  const _type = String(agentType || '').replace('autonomous_', '')

  if (_type === 'timeline') {
    // Supports both: ## Analysis (legacy) and ## Version Analysis (autonomous)
    const analysisMatch = reply.match(/##\s*(?:Version\s+)?Analysis\n([\s\S]*?)(?=##|$)/i)
    if (analysisMatch) result.analysis = analysisMatch[1].trim()

    // Code fence blocks (code timeline)
    const codeBlocks = [...reply.matchAll(/```[\w]*\n?([\s\S]*?)```/g)]
    if (codeBlocks.length) {
      const longest = codeBlocks.reduce((a, b) => a[1].length >= b[1].length ? a : b)
      result.fixedFiles.push({ name: 'merged', code: longest[1].trim() })
      result.hasCode = true
    } else {
      // Text timeline: extract content after ## Best Merged Version
      const textMatch = reply.match(/##\s*Best Merged Version\n([\s\S]+?)(?=##|$)/i)
      if (textMatch) {
        result.fixedFiles.push({ name: 'merged_text', code: textMatch[1].trim() })
        result.hasCode = false
      }
    }
  }

  if (_type === 'project') {
    // Supports both: ## Conflicts Found (code) and ## Inconsistencies Found (text)
    const conflictsMatch = reply.match(/##\s*(?:Conflicts|Inconsistencies) Found\n([\s\S]*?)(?=##\s*(?:Fixed|Coordinated)|$)/i)
    if (conflictsMatch) result.analysis = conflictsMatch[1].trim()

    // Code fence blocks per file (code project)
    const fileBlocks = [...reply.matchAll(/###\s*([^\n]+)\n```[\w]*\n?([\s\S]*?)```/g)]
    if (fileBlocks.length) {
      for (const match of fileBlocks) {
        result.fixedFiles.push({ name: match[1].trim(), code: match[2].trim() })
      }
      result.hasCode = true
    } else {
      // Text project: extract ### sections without code fences
      const textFileBlocks = [...reply.matchAll(/###\s*([^\n]+)\n([\s\S]*?)(?=###|$)/g)]
      for (const match of textFileBlocks) {
        const content = match[2].trim()
        if (content) result.fixedFiles.push({ name: match[1].trim(), code: content })
      }
      result.hasCode = false
    }
  }

  return result
}

export function buildAgentMetrics(agentType, inputTokens, outputTokens) {
  return {
    agentType,
    model:         'claude-sonnet-4-6',
    inputTokens,
    outputTokens,
    costUSD:       parseFloat(
      ((inputTokens / 1_000_000) * 3.0 +
       (outputTokens / 1_000_000) * 15.0).toFixed(6)
    ),
  }
}
