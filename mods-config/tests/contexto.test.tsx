import type { On, UsageUnit } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { bar, contextoDeAgente, enVentana, fmt, limits, modelTone, tone, until } from '../hooks/contexto'

/*
 * Las pruebas de lo que era context-bar, ya como elementos de mods-config. Las sesiones
 * son no interactivas: así no se mide la RAM ni se consulta `claude mcp list`, que acá
 * no importan.
 */

/** El $ que recibe el cuerpo de una prueba. */
type Dolar = Parameters<Extract<Parameters<typeof test>[1], (...a: never[]) => unknown>>[0]

const AHORA = Date.parse('2026-10-29T12:00:00.000Z')
const EN_2H = '2026-10-29T14:14:00.000Z'
const EN_3D = '2026-11-01T16:00:00.000Z'

/** Lo que el motor empuja tras un turno. */
const medido = (percent: number, tokens: number, window: number, rateLimits = LIMITES) => ({
  context: { percent, tokens, window },
  rateLimits,
  changed: ['context'] as UsageUnit[],
})

const LIMITES = [
  { kind: 'seven_day', percentUsed: 27.4, resetsAt: EN_3D },
  { kind: 'five_hour', percentUsed: 58, resetsAt: EN_2H },
]

const BAND = {
  plugin: 'mods-config',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

/** El fondo: el modelo que diga la prueba, y lo mínimo para que el mod arranque. */
const fondo = (on: On, actual = { model: 'claude-opus-5-5' as string | null }) => {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('session.compact', ($, e) => ({ messages: e.messages }))
  on('session.model', () => ({ value: actual.model as never }))
  on('store.get', () => ({ value: undefined as never }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>VECINO</Text>
  })

  return actual
}

const arrancar = async ($: Dolar) =>
  $.session.start({ cwd: '/proyecto', surface: 'terminal', isInteractive: false })

// ─── la lógica, copiada de context-bar ──────────────────────────────────────

test('la lógica de context-bar viaja intacta', async () => {
  expect(bar(50, 10)).toBe('█████░░░░░')
  expect(fmt(84_000)).toBe('84k')
  expect(modelTone('claude-opus-5-5')).toBe('yellow')
  expect(modelTone('claude-haiku-5-5')).toBe('green')
  expect(tone(90)).toBe('error')
  expect(until(EN_2H, AHORA)).toBe('2h 14m')
  expect(limits(LIMITES).map(l => l.label)).toEqual(['5h', '7d'])
  expect(enVentana({ input_tokens: 1, cache_read_input_tokens: 2, cache_creation_input_tokens: 3 })).toBe(6)
  expect(contextoDeAgente(undefined, undefined, null)).toEqual({ kind: 'measuring' })
})

// ─── los elementos en la franja ─────────────────────────────────────────────

test('tras un turno: modelo, contexto y los dos límites, cada uno en su lugar', async ($, on) => {
  mock.clock(on, { now: AHORA })
  fondo(on)
  await arrancar($)
  await $.session.measure(medido(42, 84_000, 200_000))

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    // Línea 1: el modelo a la izquierda y el límite de 5 h a la derecha.
    const l1 = JSON.stringify(await ui.find({ key: 'mods-config-linea-1' }))
    expect(l1).toContain('claude-opus-5-5')
    expect(l1).toContain('"5h"')
    expect(l1).toContain('58%')
    expect(l1).toContain(' · 2h 14m')
    // Línea 2: el contexto y el límite de 7 d.
    const l2 = JSON.stringify(await ui.find({ key: 'mods-config-linea-2' }))
    expect(l2).toContain('42%')
    expect(l2).toContain('84k/200k')
    expect(l2).toContain('"7d"')
    expect(l2).toContain('27%')
    expect(l2).toContain(' · 3d 4h')
    await ui.unmount()
  }
})

test('el modelo va con el color de su familia', async ($, on) => {
  mock.clock(on, { now: AHORA })
  fondo(on)
  await arrancar($)
  await $.session.measure(medido(42, 84_000, 200_000))

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const modelo = await ui.find({ type: 'Text', text: /claude-opus-5-5/ })
  expect(JSON.stringify(modelo)).toContain('"color":"yellow"')
  await ui.unmount()
})

test('el tic recoge un /model y mueve la cuenta regresiva, sin esperar un turno', async ($, on) => {
  const reloj = mock.clock(on, { now: AHORA })
  const actual = fondo(on)
  await arrancar($)
  await $.session.measure(medido(42, 84_000, 200_000))

  actual.model = 'claude-sonnet-5-5'
  await reloj.advance(14 * 60_000)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /claude-sonnet-5-5/ })).toBeDefined()
  expect(JSON.stringify(await ui.find({ key: 'mods-config-linea-1' }))).toContain(' · 2h 0m')
  await ui.unmount()
})

/** Una compactación como la raiza el motor: deja al menos un mensaje. */
const compactacion = (trigger: 'manual' | 'precompute') => ({
  trigger,
  messages: [{ role: 'user' as const, text: 'el resumen', toolUses: [] }],
})

test('al compactar, la cifra de antes deja de mostrarse; una especulativa no la toca', async ($, on) => {
  mock.clock(on, { now: AHORA })
  fondo(on)
  await arrancar($)
  await $.session.measure(medido(42, 84_000, 200_000))

  await $.session.compact(compactacion('precompute'))
  let ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /42%/ })).toBeDefined()
  await ui.unmount()

  await $.session.compact(compactacion('manual'))
  ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /42%/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Contexto/ })).toBeDefined()
  await ui.unmount()
})

test('sin ninguna medición todavía, ni contexto ni límites; el resto sigue', async ($, on) => {
  mock.clock(on, { now: AHORA })
  fondo(on, { model: null })
  await arrancar($)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Contexto/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^5h$/ })).toBeUndefined()
  expect(await ui.find({ key: 'abrir-config' })).toBeDefined()
  await ui.unmount()
})

// ─── la vista de un subagente ───────────────────────────────────────────────

/** Un pedido al modelo terminado, como lo cierra el motor. */
const pedido = async ($: Dolar, agentId: string | undefined, model: string) => {
  const stream = $.turn.step({ turnId: 't', index: 0, model, messageCount: 1, agentId })
  for await (const _ of stream) {
    // se consume para que el paso termine
  }
  await stream.result
}

/** El motor contesta cada pedido con el uso que se le indique, por agente. */
const respuestas = (on: On, usoPorAgente: Record<string, number>) => {
  on('turn.step', async function* ($, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn' as const,
      usage: {
        model: e.model,
        input_tokens: usoPorAgente[e.agentId ?? ''] ?? 0,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    }
  })
}

test('al abrir un subagente se ven su modelo y su contexto; al volver, los de la sesión', async ($, on) => {
  mock.clock(on, { now: AHORA })
  fondo(on)
  respuestas(on, { '': 84_000, sub1: 38_000 })
  await arrancar($)
  await $.session.measure(medido(42, 84_000, 200_000))
  await pedido($, undefined, 'claude-opus-5-5')
  await pedido($, 'sub1', 'claude-haiku-5-5')

  const sub = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, view: { agentId: 'sub1' } } })
  expect(await sub.find({ type: 'Text', text: /claude-haiku-5-5/ })).toBeDefined()
  expect(await sub.find({ type: 'Text', text: /^Contexto 38k$/ })).toBeDefined()
  expect(await sub.find({ type: 'Text', text: /42%/ })).toBeUndefined()
  await sub.unmount()

  const principal = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await principal.find({ type: 'Text', text: /42%/ })).toBeDefined()
  expect(await principal.find({ type: 'Text', text: /claude-haiku-5-5/ })).toBeUndefined()
  await principal.unmount()
})
