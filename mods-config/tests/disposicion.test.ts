import { expect, test } from 'claude-code/testing'

import {
  CONFIG_INICIAL,
  ELEMENTO_CONFIG,
  alinear,
  alternarFranja,
  alternarTablero,
  describir,
  leerConfig,
  moverLinea,
  moverOrden,
  organizar,
} from '../hooks/disposicion'

const ubic = (c: ReturnType<typeof leerConfig>, id: string) => c.elementos[id]

/** La disposición inicial, línea por línea. */
const INICIAL = [
  { linea: 0, izquierda: ['modelo'], centro: [], derecha: ['limite-5h'] },
  { linea: 1, izquierda: ['contexto'], centro: [], derecha: ['limite-7d'] },
  { linea: 2, izquierda: ['config'], centro: [], derecha: ['ram', 'sesion'] },
  { linea: 3, izquierda: ['mcp'], centro: [], derecha: [] },
  { linea: 4, izquierda: ['voz'], centro: [], derecha: [] },
]

test('sin nada guardado, la disposición inicial: context-bar arriba, el ⚙ y la RAM abajo', async () => {
  expect(leerConfig(undefined)).toEqual(CONFIG_INICIAL)
  expect(organizar(CONFIG_INICIAL)).toEqual(INICIAL)
})

test('la configuración de la versión 1 se migra sin perder lo elegido', async () => {
  const c = leerConfig({ ram: false, mcps: ['mycelium', 'mycelium', 3, ''] })
  expect(c.version).toBe(2)
  expect(ubic(c, 'ram')?.franja).toBe(false)
  expect(c.mcps).toEqual(['mycelium'])
  expect(ubic(c, 'mcp')).toEqual(CONFIG_INICIAL.elementos.mcp)
})

test('una configuración de antes de integrar context-bar baja dos líneas para hacerle lugar', async () => {
  // Como quedó guardada en la etapa 1: el ⚙ y la RAM en la línea 1, la RAM al centro.
  const c = leerConfig({
    version: 2,
    elementos: {
      config: { franja: true, linea: 0, alineacion: 'izquierda', orden: 0, tablero: false },
      ram: { franja: true, linea: 0, alineacion: 'centro', orden: 0, tablero: false },
      mcp: { franja: true, linea: 1, alineacion: 'izquierda', orden: 0, tablero: false },
    },
    mcps: [],
  })
  expect(organizar(c)).toEqual([
    { linea: 0, izquierda: ['modelo'], centro: [], derecha: ['limite-5h'] },
    { linea: 1, izquierda: ['contexto'], centro: [], derecha: ['limite-7d'] },
    // Lo elegido se respeta: la RAM sigue al centro.
    { linea: 2, izquierda: ['config'], centro: ['ram'], derecha: ['sesion'] },
    { linea: 3, izquierda: ['mcp'], centro: [], derecha: [] },
    // La voz, que no estaba en la configuración guardada, en su lugar inicial.
    { linea: 4, izquierda: ['voz'], centro: [], derecha: [] },
  ])
  // Una vez guardada con los elementos nuevos, ya no se vuelve a bajar.
  expect(organizar(leerConfig(c))).toEqual(organizar(c))
})

test('una configuración tocada a mano conserva lo que sirve', async () => {
  const c = leerConfig({
    version: 2,
    elementos: { ram: { franja: true, linea: 'x', alineacion: 'arriba', orden: 0, tablero: 1 }, desconocido: {} },
    mcps: 'mycelium',
  })
  // La línea y la alineación inválidas caen en las iniciales (y la línea baja dos: es
  // una configuración sin los elementos de context-bar).
  expect(ubic(c, 'ram')).toMatchObject({ franja: true, alineacion: 'derecha', tablero: false })
  expect(c.mcps).toEqual([])
  expect(leerConfig('basura')).toEqual(CONFIG_INICIAL)
})

test('el ⚙ siempre queda a la vista', async () => {
  const c = leerConfig({ version: 2, elementos: { config: { franja: false, linea: 0, alineacion: 'izquierda', orden: 0, tablero: false } } })
  expect(ubic(c, ELEMENTO_CONFIG)?.franja).toBe(true)
  expect(alternarFranja(c, ELEMENTO_CONFIG)).toBe(c)
})

test('bajar de línea: desde la última abre una nueva; subir desde la primera no hace nada', async () => {
  // La RAM, de la línea 3 a la 4: queda al final de la derecha de la 4.
  const c1 = moverLinea(CONFIG_INICIAL, 'ram', 1)
  expect(ubic(c1, 'ram')).toMatchObject({ linea: 3, alineacion: 'derecha' })
  // De la 4 (la última) a una nueva, la 5.
  expect(ubic(moverLinea(c1, 'ram', 1), 'ram')?.linea).toBe(4)
  // Subir desde la primera no cambia nada.
  expect(moverLinea(CONFIG_INICIAL, 'modelo', -1)).toBe(CONFIG_INICIAL)
})

test('las líneas que quedan vacías se cierran: no quedan huecos', async () => {
  // El MCP, solo en la última línea, sube: esa línea desaparece.
  const c = moverLinea(CONFIG_INICIAL, 'mcp', -1)
  expect(organizar(c)[2]).toEqual({ linea: 2, izquierda: ['config', 'mcp'], centro: [], derecha: ['ram', 'sesion'] })
  // La línea de la voz sube a ocupar el lugar: no queda hueco.
  expect(organizar(c)[3]).toEqual({ linea: 3, izquierda: ['voz'], centro: [], derecha: [] })
  expect(organizar(c).length).toBe(4)
})

test('alinear lleva al final de la nueva alineación', async () => {
  const c = alinear(CONFIG_INICIAL, 'ram', 'izquierda')
  expect(organizar(c)[2]).toEqual({ linea: 2, izquierda: ['config', 'ram'], centro: [], derecha: ['sesion'] })
  expect(organizar(alinear(CONFIG_INICIAL, 'ram', 'centro'))[2]?.centro).toEqual(['ram'])
  expect(alinear(CONFIG_INICIAL, 'ram', 'derecha')).toBe(CONFIG_INICIAL)
})

test('antes y después cambian el orden dentro de la misma línea y alineación', async () => {
  const juntos = alinear(CONFIG_INICIAL, 'ram', 'izquierda')
  const ramPrimero = moverOrden(juntos, 'ram', -1)
  expect(organizar(ramPrimero)[2]?.izquierda).toEqual(['ram', 'config'])
  expect(organizar(moverOrden(ramPrimero, 'ram', 1))[2]?.izquierda).toEqual(['config', 'ram'])
  // Sin vecino del lado pedido, nada cambia.
  expect(moverOrden(ramPrimero, 'ram', -1)).toBe(ramPrimero)
})

test('ocultar saca un elemento de la franja; el tablero se alterna aparte', async () => {
  expect(organizar(alternarFranja(CONFIG_INICIAL, 'ram'))[2]?.derecha).toEqual(['sesion'])
  expect(ubic(alternarTablero(CONFIG_INICIAL, 'ram'), 'ram')?.tablero).toBe(true)
  expect(describir({ linea: 1, alineacion: 'centro', orden: 0 })).toBe('línea 2 · centro · 1º')
})

// ─── 0.8.0: el tablero tiene su propia disposición ─────────────────────────

/** El tablero con la RAM, la sesión y el contexto, en ese orden: cada uno en su línea. */
const conTablero = () => alternarTablero(alternarTablero(alternarTablero(CONFIG_INICIAL, 'ram'), 'sesion'), 'contexto')

/**
 * Cómo se ve el tablero, línea por línea, sin el número interno de cada línea: los
 * elementos que no están en el tablero también ocupan números, aunque no se dibujen.
 */
const tablero = (c: ReturnType<typeof leerConfig>) => organizar(c, 'tablero').map(({ linea: _, ...zonas }) => zonas)

test('entrar al tablero deja al elemento en una línea nueva, al final', async () => {
  expect(tablero(conTablero())).toEqual([
    { izquierda: ['ram'], centro: [], derecha: [] },
    { izquierda: ['sesion'], centro: [], derecha: [] },
    { izquierda: ['contexto'], centro: [], derecha: [] },
  ])
  // La franja no cambia.
  expect(organizar(conTablero(), 'franja')).toEqual(INICIAL)
})

test('mover en el tablero no toca la franja, y al revés', async () => {
  const c = alinear(moverLinea(conTablero(), 'sesion', -1, 'tablero'), 'sesion', 'derecha', 'tablero')
  expect(tablero(c)).toEqual([
    { izquierda: ['ram'], centro: [], derecha: ['sesion'] },
    { izquierda: ['contexto'], centro: [], derecha: [] },
  ])
  expect(organizar(c, 'franja')).toEqual(INICIAL)

  const f = moverLinea(conTablero(), 'ram', 1, 'franja')
  expect(organizar(f, 'tablero')).toEqual(organizar(conTablero(), 'tablero'))
})

test('el orden dentro del tablero se cambia con antes y después', async () => {
  const juntos = moverLinea(conTablero(), 'sesion', -1, 'tablero')
  expect(organizar(juntos, 'tablero')[0]?.izquierda).toEqual(['ram', 'sesion'])
  expect(organizar(moverOrden(juntos, 'sesion', -1, 'tablero'), 'tablero')[0]?.izquierda).toEqual(['sesion', 'ram'])
})

test('subir y bajar saltan las líneas que solo tienen elementos ocultos', async () => {
  // La RAM y el contexto en el tablero, con la sesión (fuera del tablero) entre los dos.
  const c = alternarTablero(conTablero(), 'sesion')
  expect(organizar(c, 'tablero').map(l => l.izquierda)).toEqual([['ram'], ['contexto']])
  // Bajar la RAM la lleva directo a la línea del contexto, no a la de la sesión oculta.
  expect(organizar(moverLinea(c, 'ram', 1, 'tablero'), 'tablero').map(l => l.izquierda)).toEqual([['contexto', 'ram']])
})

test('una configuración en memoria sin posiciones de tablero no rompe el dibujo', async () => {
  // Así queda la memoria de la sesión cuando el mod se recarga desde una versión anterior.
  const vieja = { ...CONFIG_INICIAL, elementos: { ram: { franja: true, linea: 2, alineacion: 'derecha', orden: 0, tablero: true } } }
  expect(tablero(vieja as never)).toEqual([{ izquierda: ['ram'], centro: [], derecha: [] }])
})

test('una configuración guardada antes de 0.8.0 tiene el tablero apilado', async () => {
  const c = leerConfig({
    version: 2,
    elementos: {
      ram: { franja: true, linea: 2, alineacion: 'derecha', orden: 0, tablero: true },
      voz: { franja: true, linea: 4, alineacion: 'izquierda', orden: 0, tablero: true },
    },
    mcps: [],
  })
  expect(organizar(c, 'tablero').map(l => l.izquierda)).toEqual([['ram'], ['voz']])
})
