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

export function detectAgentType(text) {
  if (/^\[celf:timeline\]/.test(text)) return 'timeline'
  if (/^\[celf:project\]/.test(text))  return 'project'
  return null
}

export function stripAgentSignal(text) {
  return text.replace(/^\[celf:(timeline|project)\]\s*/, '')
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

  if (agentType === 'timeline') {
    const analysisMatch = reply.match(/##\s*Analysis\n([\s\S]*?)(?=##|$)/i)
    if (analysisMatch) result.analysis = analysisMatch[1].trim()

    const codeBlocks = [...reply.matchAll(/```[\w]*\n?([\s\S]*?)```/g)]
    if (codeBlocks.length) {
      const longest = codeBlocks.reduce((a, b) =>
        a[1].length >= b[1].length ? a : b
      )
      result.fixedFiles.push({
        name: 'merged',
        code: longest[1].trim(),
      })
      result.hasCode = true
    }
  }

  if (agentType === 'project') {
    const conflictsMatch = reply.match(/##\s*Conflicts Found\n([\s\S]*?)(?=##\s*Fixed|$)/i)
    if (conflictsMatch) result.analysis = conflictsMatch[1].trim()

    const fileBlocks = [...reply.matchAll(/###\s*([^\n]+)\n```[\w]*\n?([\s\S]*?)```/g)]
    for (const match of fileBlocks) {
      result.fixedFiles.push({
        name: match[1].trim(),
        code: match[2].trim(),
      })
    }
    result.hasCode = result.fixedFiles.length > 0
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
