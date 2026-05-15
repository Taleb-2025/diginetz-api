/**
 * CELF Structural Code Index — AST Edition
 * ─────────────────────────────────────────
 * يستخدم acorn parser — لا regex
 * ينتج Typed Capsules بدلاً من raw summaries
 * يبني call graph حقيقي من AST
 *
 * يُبنى مرة واحدة → incremental عند تغيير → on-demand query
 *
 * Typed Capsule Schema:
 * {
 *   type:            'function' | 'class' | 'method' | 'arrow'
 *   symbol:          'processUser'
 *   file:            'auth.js'
 *   startLine:       42
 *   endLine:         67
 *   calls:           ['validateToken', 'hashPassword']
 *   usedBy:          ['router.js::handleLogin']
 *   imports:         ['./utils', 'bcrypt']
 *   exports:         true
 *   params:          ['req', 'res']
 *   complexity:      0.42
 *   astHash:         'a3f9...'
 *   semanticLabel:   'function processUser calls:validateToken'
 *   semanticVector:  Float32Array (من CELF engine)
 *   vaultCapsuleId:  null
 *   dependencyDepth: 2
 * }
 */

import { parse as acornParse } from 'acorn'
import { simple as walkSimple } from 'acorn-walk'

export class StructuralIndex {
  constructor(options = {}) {
    this.nodes        = new Map()   // nodeId → TypedCapsule
    this.edges        = new Map()   // edgeId → EdgeRecord
    this.files        = new Map()   // filePath → FileRecord
    this.symbolIndex  = new Map()   // symbolName → [nodeId]
    this.capsuleLinks = new Map()   // nodeId → vaultCapsuleId

    this.options = {
      maxNodes:    options.maxNodes    ?? 4096,
      maxEdges:    options.maxEdges    ?? 16384,
      ecmaVersion: options.ecmaVersion ?? 2022,
      sourceType:  options.sourceType  ?? 'module'
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  BUILD — بناء أولي كامل
  // ═══════════════════════════════════════════════════════════════

  buildFromSource(files = []) {
    this.nodes.clear()
    this.edges.clear()
    this.files.clear()
    this.symbolIndex.clear()
    this.capsuleLinks.clear()

    for (const file of files) {
      this._parseFile(file.path, file.content)
    }

    this._resolveUsedBy()
    this._resolveEdges()
    this._computeDependencyDepth()

    return this.getSummary()
  }

  // ═══════════════════════════════════════════════════════════════
  //  INCREMENTAL UPDATE
  // ═══════════════════════════════════════════════════════════════

  updateFile(path, newContent) {
    const existing = this.files.get(path)
    const newHash  = this._hash(newContent)
    if (existing?.hash === newHash) return { changed: false }

    const oldNodeIds = [...this.nodes.keys()].filter(id => id.startsWith(path + '::'))
    for (const nid of oldNodeIds) {
      const node = this.nodes.get(nid)
      if (node?.symbol) {
        const arr = this.symbolIndex.get(node.symbol) ?? []
        const idx = arr.indexOf(nid)
        if (idx !== -1) arr.splice(idx, 1)
      }
      this.nodes.delete(nid)
      this.capsuleLinks.delete(nid)
    }

    for (const [eid, e] of this.edges) {
      if (oldNodeIds.includes(e.from) || oldNodeIds.includes(e.to))
        this.edges.delete(eid)
    }

    this._parseFile(path, newContent)
    this._resolveUsedBy()
    this._resolveEdges()
    this._computeDependencyDepth()

    return { changed: true, path, hash: newHash }
  }

  // ═══════════════════════════════════════════════════════════════
  //  AST PARSING — acorn
  // ═══════════════════════════════════════════════════════════════

  _parseFile(path, content) {
    const hash = this._hash(content)
    let ast

    const parseOpts = (sourceType) => ({
      ecmaVersion: this.options.ecmaVersion,
      sourceType,
      locations: true,
      allowHashBang: true,
      allowAwaitOutsideFunction: true
    })

    try {
      ast = acornParse(content, parseOpts('module'))
    } catch {
      try {
        ast = acornParse(content, parseOpts('script'))
      } catch (e2) {
        this.files.set(path, { path, hash, parseError: e2.message, imports: [], exports: [] })
        return
      }
    }

    const imports = this._extractImports(ast)
    const exports = this._extractExports(ast)

    this.files.set(path, {
      path, hash,
      lineCount:   content.split('\n').length,
      lastIndexed: Date.now(),
      imports,
      exports
    })

    this._extractNodes(ast, path, content, imports, exports)
  }

  _extractNodes(ast, file, content, imports, fileExports) {
    const lines = content.split('\n')
    const self  = this

    const addNode = (capsule) => {
      if (self.nodes.size >= self.options.maxNodes) return
      const id = `${file}::${capsule.symbol}::${capsule.startLine}`
      if (self.nodes.has(id)) return
      capsule.id = id
      self.nodes.set(id, capsule)
      if (!self.symbolIndex.has(capsule.symbol))
        self.symbolIndex.set(capsule.symbol, [])
      self.symbolIndex.get(capsule.symbol).push(id)
    }

    walkSimple(ast, {

      // function foo() {}
      FunctionDeclaration(n) {
        if (!n.id?.name) return
        addNode(self._capsule(n, 'function', file, lines, imports, fileExports))
      },

      // const foo = () => {} | const foo = function() {}
      VariableDeclaration(n) {
        for (const decl of n.declarations) {
          if (!decl.id?.name) continue
          const init = decl.init
          if (!init) continue
          const isArrow = init.type === 'ArrowFunctionExpression'
          const isFn    = init.type === 'FunctionExpression'
          if (!isArrow && !isFn) continue
          const fakeNode = { ...init, id: decl.id, loc: n.loc }
          addNode(self._capsule(fakeNode, isArrow ? 'arrow' : 'function', file, lines, imports, fileExports))
        }
      },

      // class Foo {}
      ClassDeclaration(n) {
        if (!n.id?.name) return
        addNode(self._capsule(n, 'class', file, lines, imports, fileExports))

        for (const member of (n.body?.body ?? [])) {
          if (member.type !== 'MethodDefinition') continue
          if (!member.key?.name) continue
          const fakeNode = {
            ...member.value,
            id:  { name: `${n.id.name}.${member.key.name}` },
            loc: member.loc
          }
          const m = self._capsule(fakeNode, 'method', file, lines, imports, fileExports, n.id.name)
          addNode(m)
        }
      },

      // export default function() {}
      ExportDefaultDeclaration(n) {
        const d = n.declaration
        if (d?.type === 'FunctionDeclaration' && d.id?.name) {
          const c = self._capsule(d, 'function', file, lines, imports, fileExports)
          c.exports = true
          addNode(c)
        }
      }
    })
  }

  // ── Typed Capsule builder ──────────────────────────────────────
  _capsule(astNode, type, file, lines, imports, fileExports, parentClass = null) {
    const symbol    = astNode.id?.name ?? 'anonymous'
    const startLine = astNode.loc?.start?.line ?? 0
    const endLine   = astNode.loc?.end?.line   ?? startLine
    const bodyText  = lines.slice(startLine - 1, endLine).join('\n')

    const calls      = this._calls(astNode, symbol)
    const params     = this._params(astNode)
    const complexity = this._complexity(astNode)
    const isExported = (fileExports ?? []).includes(symbol)
    const astHash    = this._hash(bodyText.replace(/\/\/.*/g, '').replace(/\/\*[\s\S]*?\*\//g, ''))

    const semanticLabel = [
      type,
      symbol,
      parentClass ? `in:${parentClass}` : null,
      calls.length   ? `calls:${calls.slice(0, 4).join(',')}` : null,
      params.length  ? `params:${params.slice(0, 3).join(',')}` : null
    ].filter(Boolean).join(' ')

    return {
      id:              null,
      type,
      symbol,
      file,
      startLine,
      endLine,
      calls,
      usedBy:          [],
      imports:         imports ?? [],
      exports:         isExported,
      params,
      complexity,
      astHash,
      parentClass,
      semanticLabel,
      semanticVector:  null,
      vaultCapsuleId:  null,
      dependencyDepth: 0,
      sourceCode:      bodyText   // ← الكود الأصلي — لا يُرسل للـ LLM إلا عند deep analysis
    }
  }

  // ── Extract calls from AST node ────────────────────────────────
  _calls(astNode, selfName) {
    const calls   = new Set()
    const builtin = new Set([
      'console','Math','Object','Array','String','Number','Boolean',
      'JSON','Promise','Error','Map','Set','Date','parseInt','parseFloat',
      'isNaN','isFinite','setTimeout','clearTimeout','setInterval','Symbol',
      'WeakMap','WeakSet','Proxy','Reflect','super','this'
    ])

    try {
      walkSimple(astNode, {
        CallExpression(n) {
          let name = null
          if (n.callee.type === 'Identifier')
            name = n.callee.name
          else if (n.callee.type === 'MemberExpression' && n.callee.property?.name)
            name = n.callee.property.name
          if (name && name !== selfName && !builtin.has(name) && name.length >= 3)
            calls.add(name)
        }
      })
    } catch { /* skip */ }

    return [...calls]
  }

  // ── Extract params ─────────────────────────────────────────────
  _params(astNode) {
    return (astNode.params ?? []).map(p => {
      if (p.type === 'Identifier')     return p.name
      if (p.type === 'AssignmentPattern') return p.left?.name ?? '?'
      if (p.type === 'RestElement')    return `...${p.argument?.name ?? ''}`
      if (p.type === 'ObjectPattern')  return '{}'
      if (p.type === 'ArrayPattern')   return '[]'
      return '?'
    }).filter(Boolean)
  }

  // ── Cyclomatic complexity approximation ───────────────────────
  _complexity(astNode) {
    let count = 1
    const branches = [
      'IfStatement','ConditionalExpression','SwitchCase',
      'ForStatement','WhileStatement','DoWhileStatement',
      'ForInStatement','ForOfStatement','CatchClause'
    ]
    try {
      walkSimple(astNode, Object.fromEntries(branches.map(t => [t, () => { count++ }])))
    } catch { /* skip */ }
    return Math.round(Math.min(count / 20, 1) * 1000) / 1000
  }

  // ── Extract imports from AST ───────────────────────────────────
  _extractImports(ast) {
    const imports = []
    walkSimple(ast, {
      ImportDeclaration(n) { if (n.source?.value) imports.push(n.source.value) },
      ImportExpression(n)  { if (n.source?.value) imports.push(n.source.value) }
    })
    return imports
  }

  // ── Extract exports from AST ───────────────────────────────────
  _extractExports(ast) {
    const exports = []
    walkSimple(ast, {
      ExportNamedDeclaration(n) {
        if (n.declaration?.id?.name) exports.push(n.declaration.id.name)
        if (n.declaration?.declarations)
          for (const d of n.declaration.declarations)
            if (d.id?.name) exports.push(d.id.name)
        for (const s of (n.specifiers ?? []))
          if (s.exported?.name) exports.push(s.exported.name)
      },
      ExportDefaultDeclaration(n) {
        if (n.declaration?.id?.name) exports.push(n.declaration.id.name)
        else exports.push('default')
      }
    })
    return exports
  }

  // ═══════════════════════════════════════════════════════════════
  //  GRAPH RESOLUTION
  // ═══════════════════════════════════════════════════════════════

  _resolveUsedBy() {
    for (const [, fromNode] of this.nodes) {
      for (const callee of (fromNode.calls ?? [])) {
        const targets = this.symbolIndex.get(callee) ?? []
        for (const toId of targets) {
          const toNode = this.nodes.get(toId)
          if (toNode && !toNode.usedBy.includes(fromNode.symbol))
            toNode.usedBy.push(fromNode.symbol)
        }
      }
    }
  }

  _resolveEdges() {
    for (const [fromId, fromNode] of this.nodes) {
      // call edges
      for (const callee of (fromNode.calls ?? [])) {
        const targets = this.symbolIndex.get(callee) ?? []
        for (const toId of targets) {
          if (fromId === toId) continue
          if (this.edges.size >= this.options.maxEdges) return
          const eid = `${fromId}→${toId}`
          if (!this.edges.has(eid))
            this.edges.set(eid, { id: eid, from: fromId, to: toId, type: 'calls', weight: 1 })
          else
            this.edges.get(eid).weight++
        }
      }

      // import edges
      for (const imp of (fromNode.imports ?? [])) {
        const impBase = imp.replace(/^.*\//, '').replace(/\.[jt]sx?$/, '')
        for (const [toId, toNode] of this.nodes) {
          if (toNode.file.includes(impBase) && fromId !== toId) {
            if (this.edges.size >= this.options.maxEdges) return
            const eid = `${fromId}→${toId}:import`
            if (!this.edges.has(eid))
              this.edges.set(eid, { id: eid, from: fromId, to: toId, type: 'imports', weight: 1 })
          }
        }
      }
    }
  }

  _computeDependencyDepth() {
    const cache = new Map()

    const getDepth = (nodeId, visited = new Set()) => {
      if (cache.has(nodeId)) return cache.get(nodeId)
      if (visited.has(nodeId)) return 0
      visited.add(nodeId)

      const out = [...this.edges.values()]
        .filter(e => e.from === nodeId && e.type === 'calls')

      if (!out.length) { cache.set(nodeId, 0); return 0 }

      const maxChild = Math.max(...out.map(e => getDepth(e.to, new Set(visited))))
      const depth    = maxChild + 1
      cache.set(nodeId, depth)
      return depth
    }

    for (const [id, node] of this.nodes) {
      node.dependencyDepth = getDepth(id)
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  QUERY — on-demand
  // ═══════════════════════════════════════════════════════════════

  query(focus = {}, depth = 2) {
    const { names = [], files = [], types = [] } = focus

    const seeds = []
    for (const [id, node] of this.nodes) {
      const matchName = names.length === 0 ||
        names.some(n =>
          node.symbol.toLowerCase().includes(n.toLowerCase()) ||
          (node.semanticLabel ?? '').toLowerCase().includes(n.toLowerCase())
        )
      const matchFile = files.length === 0 || files.some(f => node.file.includes(f))
      const matchType = types.length === 0 || types.includes(node.type)
      if (matchName && matchFile && matchType) seeds.push(id)
    }

    if (!seeds.length) return { nodes: [], edges: [], totalNodes: 0, totalEdges: 0, depth }

    const visited = new Set(seeds)
    let frontier  = [...seeds]

    for (let d = 0; d < depth; d++) {
      const next = []
      for (const [, e] of this.edges) {
        if (frontier.includes(e.from) && !visited.has(e.to)) { visited.add(e.to); next.push(e.to) }
        if (frontier.includes(e.to) && !visited.has(e.from)) { visited.add(e.from); next.push(e.from) }
      }
      frontier = next
      if (!frontier.length) break
    }

    const resultNodes = [...visited].map(id => this.nodes.get(id)).filter(Boolean)
    const resultEdges = [...this.edges.values()].filter(e => visited.has(e.from) && visited.has(e.to))

    return { nodes: resultNodes, edges: resultEdges, totalNodes: resultNodes.length, totalEdges: resultEdges.length, depth }
  }

  /**
   * hybridQuery — يدمج semantic + symbol + call graph distance
   * للاستخدام في buildCognitiveTarget
   */
  hybridQuery(semanticVector, symbols = [], depth = 2, topK = 8) {
    const scored = []

    for (const [id, node] of this.nodes) {
      let score = 0

      // 1. semantic similarity (35%)
      if (semanticVector && node.semanticVector)
        score += this._cosineSim(semanticVector, node.semanticVector) * 0.35

      // 2. symbol overlap (30%)
      const symMatch = symbols.some(s =>
        node.symbol.toLowerCase().includes(s.toLowerCase()) ||
        (node.calls ?? []).some(c => c.toLowerCase().includes(s.toLowerCase()))
      )
      if (symMatch) score += 0.30

      // 3. dependency proximity (15%) — أقل عمق = أكثر مركزية
      score += Math.max(0, 1 - (node.dependencyDepth ?? 0) / 10) * 0.15

      // 4. usedBy weight (10%) — كلما استُخدم أكثر = أهم
      score += Math.min(1, (node.usedBy?.length ?? 0) / 5) * 0.10

      // 5. export bonus (10%)
      if (node.exports) score += 0.10

      if (score > 0.15)
        scored.push({ id, node, score: Math.round(score * 1000) / 1000 })
    }

    const top = scored.sort((a, b) => b.score - a.score).slice(0, topK)
    if (!top.length) return { nodes: [], edges: [], totalNodes: 0, totalEdges: 0 }

    const visited = new Set(top.map(n => n.id))
    let frontier  = top.map(n => n.id)

    for (let d = 0; d < depth; d++) {
      const next = []
      for (const [, e] of this.edges) {
        if (e.type !== 'calls') continue
        if (frontier.includes(e.from) && !visited.has(e.to)) { visited.add(e.to); next.push(e.to) }
      }
      frontier = next
      if (!frontier.length) break
    }

    const resultNodes = [...visited].map(id => this.nodes.get(id)).filter(Boolean)
    const resultEdges = [...this.edges.values()]
      .filter(e => visited.has(e.from) && visited.has(e.to) && e.type === 'calls')

    return {
      nodes:      resultNodes,
      edges:      resultEdges,
      topScored:  top.map(n => ({ symbol: n.node.symbol, score: n.score, file: n.node.file })),
      totalNodes: resultNodes.length,
      totalEdges: resultEdges.length
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  VAULT INTEGRATION
  // ═══════════════════════════════════════════════════════════════

  linkCapsule(nodeId, capsuleId) {
    this.capsuleLinks.set(nodeId, capsuleId)
    const node = this.nodes.get(nodeId)
    if (node) node.vaultCapsuleId = capsuleId
  }

  getNodeCapsule(nodeId) {
    return this.capsuleLinks.get(nodeId) ?? null
  }

  /**
   * injectIntoVault(engine)
   * كل node مهم يُخزن كـ typed capsule في الـ Vault
   * يُستدعى مرة واحدة بعد buildFromSource
   */
  injectIntoVault(engine) {
    let stored = 0
    for (const [id, node] of this.nodes) {
      if (node.vaultCapsuleId) continue  // مخزون مسبقاً

      // بناء semantic label للـ capsule
      const label = node.semanticLabel ?? `${node.type} ${node.symbol}`

      // inject semantic vector
      if (!node.semanticVector)
        node.semanticVector = engine.semanticVector(label)

      // بناء perturbation مصطنع للـ engine
      const fakePerturbation = {
        semantic: {
          vector:       node.semanticVector,
          code:         node.type !== 'class' ? 1 : 0,
          data:         0,
          reasoning:    0,
          command:      0,
          question:     0,
          error:        0,
          lexicalDensity: Math.min(1, label.split(' ').length / 10),
          lengthScore:    Math.min(1, (node.endLine - node.startLine) / 50)
        },
        h1: engine._hash ? engine._hash(label) : 12345
      }

      // استخدم shouldStoreCapsule للتحقق من الأهمية
      const importanceScore = Math.min(1,
        (node.calls?.length    ?? 0) * 0.08 +
        (node.usedBy?.length   ?? 0) * 0.10 +
        (node.exports ? 0.20 : 0)   +
        (node.complexity       ?? 0) * 0.15 +
        0.20  // base score لكل node في الـ index
      )

      if (importanceScore >= 0.30) {
        // بناء text للـ capsule
        const capsuleText = [
          `${node.type} ${node.symbol}`,
          node.calls?.length   ? `calls:${node.calls.slice(0, 4).join(',')}` : '',
          node.usedBy?.length  ? `usedBy:${node.usedBy.slice(0, 3).join(',')}` : '',
          node.params?.length  ? `params:${node.params.slice(0, 3).join(',')}` : '',
          `file:${node.file.split('/').pop()}`,
          node.exports ? 'exported' : ''
        ].filter(Boolean).join(' ')

        const capsuleId = engine.storeOrUpdateCapsule(capsuleText, fakePerturbation)
        if (capsuleId) {
          this.linkCapsule(id, capsuleId)
          stored++
        }
      }
    }
    return { stored, total: this.nodes.size }
  }

  // ── inject semantic vectors from engine ───────────────────────
  injectSemanticVectors(engine) {
    for (const [, node] of this.nodes) {
      if (!node.semanticVector)
        node.semanticVector = engine.semanticVector(node.semanticLabel ?? node.symbol)
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  CODE RESTORE LAYER — استعادة الكود عند الحاجة
  // ═══════════════════════════════════════════════════════════════

  /**
   * getNodeSource(nodeId)
   * يُعيد الكود الأصلي لـ node محددة
   */
  getNodeSource(nodeId) {
    return this.nodes.get(nodeId)?.sourceCode ?? null
  }

  /**
   * getNodeSourceBySymbol(symbol)
   * يُعيد الكود الأصلي بالاسم — يُعيد أول تطابق
   */
  getNodeSourceBySymbol(symbol) {
    const ids = this.symbolIndex.get(symbol) ?? []
    if (!ids.length) return null
    return this.nodes.get(ids[0])?.sourceCode ?? null
  }

  /**
   * getDeepContext(symbols, options)
   * يُعيد كود حقيقي لمجموعة symbols — للـ deep analysis
   *
   * options:
   *   maxChars:   حد أقصى للأحرف (default: 8000)
   *   withGraph:  هل تُضاف علاقات الـ call graph؟
   *
   * يُستخدم في buildCognitiveTarget عند mode: 'deep'
   */
  getDeepContext(symbols = [], options = {}) {
    const maxChars  = options.maxChars  ?? 8000
    const withGraph = options.withGraph ?? true

    const results  = []
    let totalChars = 0

    for (const symbol of symbols) {
      if (totalChars >= maxChars) break

      const ids = this.symbolIndex.get(symbol) ?? []
      for (const id of ids) {
        const node = this.nodes.get(id)
        if (!node?.sourceCode) continue
        if (totalChars + node.sourceCode.length > maxChars) continue

        const block = {
          symbol:    node.symbol,
          type:      node.type,
          file:      node.file,
          startLine: node.startLine,
          endLine:   node.endLine,
          source:    node.sourceCode,
          calls:     node.calls,
          usedBy:    node.usedBy,
          complexity: node.complexity
        }

        if (withGraph) {
          // أضف الـ callee sources إذا صغيرة
          block.calleesSources = {}
          for (const callee of (node.calls ?? []).slice(0, 3)) {
            const src = this.getNodeSourceBySymbol(callee)
            if (src && src.length < 400) {
              block.calleesSources[callee] = src
              totalChars += src.length
            }
          }
        }

        results.push(block)
        totalChars += node.sourceCode.length
      }
    }

    return {
      blocks:     results,
      totalChars,
      truncated:  symbols.length > results.length,
      symbolsFound: results.map(r => r.symbol)
    }
  }

  /**
   * needsDeepAnalysis(userIntent)
   * يقرر هل السؤال يحتاج كود أصلي
   * يُستخدم في buildCognitiveTarget
   */
  needsDeepAnalysis(userIntent) {
    const { mode, depth } = userIntent
    return (
      depth === 'deep' ||
      mode === 'debug'    ||
      mode === 'review'   ||
      mode === 'optimize' ||
      (mode === 'explain' && depth !== 'surface')
    )
  }



  _hash(str) {
    let h = 2166136261
    for (let i = 0; i < Math.min(str.length, 8192); i++) {
      h ^= str.charCodeAt(i)
      h  = Math.imul(h, 16777619)
    }
    return Math.abs(h >>> 0).toString(16)
  }

  _cosineSim(a, b) {
    const n = Math.min(a.length, b.length)
    let dot = 0, na = 0, nb = 0
    for (let i = 0; i < n; i++) { dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i] }
    return (na && nb) ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0
  }

  getSummary() {
    const byType = {}
    for (const [, n] of this.nodes) byType[n.type] = (byType[n.type] ?? 0) + 1
    return {
      nodeCount:    this.nodes.size,
      edgeCount:    this.edges.size,
      fileCount:    this.files.size,
      capsuleLinks: this.capsuleLinks.size,
      byType
    }
  }
}
