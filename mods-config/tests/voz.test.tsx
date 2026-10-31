import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import {
  duracionMp3,
  etiqueta,
  fraseFinal,
  INTRO,
  limpiarMarkdown,
  MAX_ENTRADA_IA,
  PAUSA_ENTRE,
  PAUSA_MS,
  pedidoDeResumen,
  pistasDePreguntas,
  psLiteral,
  recortar,
  scriptReproduccion,
} from '../hooks/voz'

// Las pruebas del mod voz, ya como parte de mods-config.

// ------------------------------- puras -------------------------------------

test('el markdown se limpia para leerse en voz alta', async () => {
  expect(limpiarMarkdown('## Hecho\n\nArreglé `foo()` y [la nota](x.md).')).toBe(
    'Hecho Arreglé y la nota.',
  )
  expect(limpiarMarkdown('Antes\n```ts\nconst x = 1\n```\ndespués')).toBe('Antes después')
  expect(limpiarMarkdown('')).toBe('')
})

test('el recorte termina en oración, coma o palabra, nunca a mitad', async () => {
  // Corta en el fin de la primera oración que entra.
  expect(recortar('Arreglé la barra. Después probé todo.', 200)).toBe('Arreglé la barra.')
  // Corto y sin punto: se le agrega.
  expect(recortar('Listo', 200)).toBe('Listo.')
  // Largo y sin oraciones: corta en la última palabra que entra.
  const largo = 'palabra '.repeat(40).trim()
  const cortado = recortar(largo, 50)
  expect(cortado.length <= 51).toBe(true)
  expect(cortado.endsWith('palabra.')).toBe(true)
})

test('se anuncia la sesión con nombre propio, si no el proyecto', async () => {
  // El nombre por defecto no aporta nada sobre el del proyecto.
  expect(etiqueta('ASDD-k3', 'ASDD')).toBe('ASDD')
  expect(etiqueta('asdd-ad', 'ASDD')).toBe('ASDD')
  // Un nombre propio se anuncia, con los guiones leídos como espacios.
  expect(etiqueta('auth-refactor', 'ASDD')).toBe('auth refactor')
  expect(etiqueta(null, 'mi_proyecto')).toBe('mi proyecto')
  expect(etiqueta(null, null)).toBeNull()
})

test('la frase final cubre que falte el lugar, el resumen o los dos', async () => {
  expect(fraseFinal('ASDD', 'Ajusté la barra.')).toBe('Terminé en ASDD. Ajusté la barra.')
  expect(fraseFinal('ASDD', null)).toBe('Terminé en ASDD.')
  expect(fraseFinal(null, 'Ajusté la barra.')).toBe('Ajusté la barra.')
  expect(fraseFinal(null, null)).toBe('Terminé.')
})

test('al resumir, un texto largo se acota por los dos extremos', async () => {
  const pedido = pedidoDeResumen(`INICIO${'x'.repeat(5000)}FINAL`)
  expect(pedido.includes('INICIO')).toBe(true)
  expect(pedido.includes('FINAL')).toBe(true)
  expect(pedido.includes('[...]')).toBe(true)
  expect(pedido.length < MAX_ENTRADA_IA + 1000).toBe(true)
})

test('una pregunta se lee con su intro y sus pausas, sin las opciones', async () => {
  const pistas = pistasDePreguntas([
    { question: '¿Cuál preferís?', header: 'Diseño' },
    { question: '¿Lo instalo?', header: '¿Lo instalo?' },
  ])
  expect(pistas).toEqual([
    { texto: INTRO, pausaMs: PAUSA_MS },
    { texto: 'Sobre Diseño. ¿Cuál preferís?', pausaMs: PAUSA_ENTRE },
    // Un header igual a la pregunta no se repite; la última no lleva pausa.
    { texto: '¿Lo instalo?', pausaMs: 0 },
  ])
  expect(pistasDePreguntas([{ question: '' }])).toEqual([])
})

test('el reproductor espera lo que dura cada MP3, con sus pausas', async () => {
  // 48 kbps: 6000 bytes por segundo.
  expect(duracionMp3(45_504)).toBe(7584)
  const script = scriptReproduccion([
    { ruta: 'C:\a.mp3', duracionMs: 1000, pausaMs: 750 },
    { ruta: 'C:\b.mp3', duracionMs: 2000, pausaMs: 0 },
  ])
  expect(script.includes("Tocar 'C:\a.mp3' 1000\nStart-Sleep -Milliseconds 750\nTocar 'C:\b.mp3' 2000")).toBe(true)
  // Sin duración conocida, espera el techo de una frase.
  expect(scriptReproduccion([{ ruta: 'C:\c.mp3', pausaMs: 0 }]).includes("Tocar 'C:\c.mp3' 8000")).toBe(true)
})

test('una comilla en la ruta no rompe el script de PowerShell', async () => {
  expect(psLiteral("C:\Users\O'Brien\voz.mp3")).toBe("'C:\Users\O''Brien\voz.mp3'")
})

// ------------------------------ con motor ----------------------------------

const BAND = {
  plugin: 'mods-config',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const ARRANQUE = { cwd: 'C:\\proyectos\\ASDD', surface: 'terminal', isInteractive: true } as const

const TURNO = {
  answer: '## Listo\n\nAjusté la barra de contexto y corrí las pruebas.',
  durationMs: 1000,
  isAborted: false,
  turnId: 't1',
  reason: 'answer',
} as const

/** Si una llamada a un proceso es de la voz: edge-tts o el nombre de la sesión. */
const esDeVoz = (argv: readonly string[]) =>
  argv.includes('--version') || argv.some(x => x.startsWith('--voice')) || (argv[0] === 'claude' && argv[1] === 'agents')

/**
 * El mundo debajo del mod: lo que el motor contesta a sus ops. `edgeTts` decide
 * si la síntesis anda; cada reproducción dura lo que diga el reloj simulado.
 */
const mundo = (on: On, opciones: { edgeTts: boolean }) => {
  const llamadas: string[][] = []
  const pendientes: (() => void)[] = []

  // mods-config: la RAM oculta, para que estas pruebas no midan memoria.
  on('store.get', () => ({
    value: {
      version: 2,
      elementos: {
        ram: { franja: false, linea: 2, alineacion: 'derecha', orden: 0, tablero: false },
        sesion: { franja: false, linea: 2, alineacion: 'derecha', orden: 1, tablero: false },
      },
      mcps: [],
    } as never,
  }))
  on('tool.list', () => ({ value: [] as never }))

  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('tool.call', () => ({ result: { answers: {} } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('env.get', () => ({ value: 'C:\\Temp' }))
  on('session.cwd', () => ({ value: 'C:\\proyectos\\ASDD' }))
  on('session.id', () => ({ value: 'sesion-1' }))
  on('fs.write', () => ({ value: undefined }))
  on('fs.read', () => ({ value: { base64: 'A'.repeat(4000) } }))
  on('model.complete', () => ({
    value: {
      isAnswered: true,
      text: 'Ajusté la barra de contexto.',
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    },
  }))
  on('process.run', ($, e) => {
    const argv = [...(e as { argv: readonly string[] }).argv]
    llamadas.push(argv)
    if (argv[0] === 'claude') return { value: { exitCode: 0, stdout: '[]', stderr: '' } as never }

    return { value: { exitCode: opciones.edgeTts ? 0 : 1, stdout: '', stderr: '' } as never }
  })
  /*
   * El reproductor es un proceso de PowerShell que no termina hasta que la prueba
   * lo suelta: mientras tanto, se está hablando. (Un hook del test no puede
   * llamar ops de `$`, ni siquiera el reloj: el escáner del módulo de prueba no
   * lista ninguna.)
   */
  const procesos: string[][] = []
  on('process.spawn', async function* ($, e) {
    procesos.push([...e.argv])
    await new Promise<void>(resolve => {
      pendientes.push(resolve)
    })

    return { value: { code: 0, signal: null } }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>el motor dibuja</Text>
  })

  /** Termina todo lo que se esté reproduciendo. */
  const soltar = () => pendientes.splice(0).forEach(fin => fin())

  return { llamadas, procesos, soltar }
}

test('al terminar un turno habla, y el ícono lo detiene', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const { llamadas, procesos, soltar } = mundo(on, { edgeTts: true })
  await $.session.start(ARRANQUE)
  await $.turn.complete(TURNO)
  await clock.advance(1)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ key: 'callar' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Terminé en ASDD\. Ajusté la barra de contexto\./ })).toBeDefined()
  // Sintetizó con edge-tts y la voz configurada…
  expect(llamadas.some(argv => argv.includes('--voice=es-AR-ElenaNeural'))).toBe(true)
  // …y suena por un proceso de PowerShell, con la duración que da el tamaño del
  // MP3 (3000 bytes a 6000 por segundo: 500 ms), no con el respaldo de 8 s.
  const script = procesos[0]?.at(-1) ?? ''
  expect(script.includes("Tocar 'C:\\Temp\\cc-voz\\voz-0.mp3' 500")).toBe(true)

  await ui.press({ key: 'callar' })
  expect(await ui.find({ key: 'callar' })).toBeUndefined()
  await ui.unmount()
  soltar()
})

test('/callar corta, y dice si había algo que cortar', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const { soltar } = mundo(on, { edgeTts: true })
  await $.session.start(ARRANQUE)

  const ocioso = await $.command.run({ command: 'callar', args: '', origin: 'user' } as never)
  expect(ocioso.text).toBe('No estaba hablando.')

  await $.turn.complete(TURNO)
  await clock.advance(1)
  const hablando = await $.command.run({ command: 'callar', args: '', origin: 'user' } as never)
  expect(hablando.text).toBe('Listo, me callo.')

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ key: 'callar' })).toBeUndefined()
  await ui.unmount()
  soltar()
})

test('sin edge-tts habla con la voz de Windows, y también se corta', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const { procesos, soltar } = mundo(on, { edgeTts: false })
  await $.session.start(ARRANQUE)
  await $.turn.complete(TURNO)
  await clock.advance(1)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Terminé en ASDD/ })).toBeDefined()
  // La voz de Windows corre en el mismo proceso que se mata, así que se ofrece cortar.
  expect((procesos[0]?.at(-1) ?? '').includes('SpeechSynthesizer')).toBe(true)
  expect(await ui.find({ key: 'callar' })).toBeDefined()
  await ui.press({ key: 'callar' })
  expect(await ui.find({ key: 'callar' })).toBeUndefined()
  await ui.unmount()
  soltar()
})

test('cuando Claude pregunta, se lee la pregunta con su intro', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const { llamadas, soltar } = mundo(on, { edgeTts: true })
  await $.session.start(ARRANQUE)
  await $.tool.call({
    tool: 'AskUserQuestion',
    questions: [
      {
        question: '¿Lo instalo?',
        header: 'Instalar',
        multiSelect: false,
        options: [
          { label: 'Sí', description: 'ahora' },
          { label: 'No', description: 'después' },
        ],
      },
    ],
  } as never)
  await clock.advance(1)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Tengo una pregunta.*Sobre Instalar\. ¿Lo instalo\?/ })).toBeDefined()
  // Las opciones no se leen.
  expect(llamadas.some(argv => argv.join(' ').includes('después'))).toBe(false)
  await ui.unmount()
  soltar()
})

test('el turno de un subagente no habla', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const { llamadas, soltar } = mundo(on, { edgeTts: true })
  await $.session.start(ARRANQUE)
  await $.turn.complete({ ...TURNO, agentId: 'sub-1' })
  await clock.advance(1)

  expect(llamadas.filter(esDeVoz).length).toBe(0)
})

test('un turno interrumpido no habla', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const { llamadas, soltar } = mundo(on, { edgeTts: true })
  await $.session.start(ARRANQUE)
  await $.turn.complete({ ...TURNO, reason: 'aborted', isAborted: true })
  await clock.advance(1)

  expect(llamadas.filter(esDeVoz).length).toBe(0)
})

test('una sesión sin persona delante (claude -p) no habla', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const { llamadas, soltar } = mundo(on, { edgeTts: true })
  await $.session.start({ ...ARRANQUE, isInteractive: false })
  await $.turn.complete(TURNO)
  await clock.advance(1)

  expect(llamadas.filter(esDeVoz).length).toBe(0)
})

test('sin nada que decir, la franja cede el paso', async ($, on) => {
  mundo(on, { edgeTts: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ key: 'callar' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /el motor dibuja/ })).toBeDefined()
  await ui.unmount()
})
