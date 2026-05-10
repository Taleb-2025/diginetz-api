import { CyclicProcessorEngine } from '../engines/CyclicProcessorEngine.js'

const engine = new CyclicProcessorEngine({
  maxHistory: 1000,
  maxArchive: 1000,
})

engine.addProcessor(({ input }) => ({
  step:   input ?? 1,
  output: null
}))

function mb() {
  return Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
}

function snapshot(label) {
  global.gc()
  const field = engine.getFieldState()
  console.log({
    label,
    heapMB:       mb(),
    history:      engine.getHistory().length,
    archive:      engine.getArchive().length,
    checkpoints:  engine.getCheckpoints().length,
    attractors:   field.attractors.length,
    cycleCount:   engine.getCycleCount(),
    state:        Math.round(engine.getState() * 100) / 100,
    pressure:     field.pressure,
    resistance:   field.resistance,
  })
}

console.log('\n=== CyclicProcessorEngine Memory Test ===\n')
snapshot('start')

const TOTAL = 1_000_000

for (let i = 1; i <= TOTAL; i++) {
  engine.process(i % 50)

  if (i % 100_000 === 0) {
    snapshot('events_' + i.toLocaleString())
  }
}

snapshot('final')

console.log('\n=== Done ===')
console.log('Expected: heapMB stable after events_100000')
console.log('If heapMB keeps growing → memory leak detected\n')
