/**
 * La disposición de los elementos: dónde va cada uno y cómo se mueve. Lógica pura,
 * aparte del módulo de hooks para poder probarla sin montar nada.
 *
 * Un elemento es una pieza que el mod sabe dibujar (la RAM, los MCP, el ⚙…). Se dibuja
 * en dos lugares, la franja sobre el chat y el tablero lateral, y en cada uno tiene su
 * propia posición —línea, alineación y orden dentro de esa alineación— y se ve o no.
 * Agregar un elemento es darle una ubicación inicial en `UBICACIONES_INICIALES` y su
 * dibujo en el módulo.
 */

import type { Alineacion, Config, Lugar, Posicion, Ubicacion } from '../types'

export type { Alineacion, Config, Lugar, Posicion, Ubicacion }

/** El elemento que abre la configuración: siempre a la vista, o no habría cómo volver. */
export const ELEMENTO_CONFIG = 'config'

/** En el tablero, cada elemento empieza en su propia línea, en el orden de la lista. */
const apilado = (linea: number): Posicion => ({ linea, alineacion: 'izquierda', orden: 0 })

/**
 * Dónde va cada elemento la primera vez, o si su ubicación guardada no sirve. Arriba,
 * lo que era context-bar (modelo y contexto a la izquierda, los límites de uso a la
 * derecha); abajo, el ⚙, la RAM y los MCP; y al final, mientras habla, la voz.
 */
export const UBICACIONES_INICIALES: Readonly<Record<string, Ubicacion>> = {
  modelo: { franja: true, linea: 0, alineacion: 'izquierda', orden: 0, tablero: false, enTablero: apilado(0) },
  'limite-5h': { franja: true, linea: 0, alineacion: 'derecha', orden: 0, tablero: false, enTablero: apilado(1) },
  contexto: { franja: true, linea: 1, alineacion: 'izquierda', orden: 0, tablero: false, enTablero: apilado(2) },
  'limite-7d': { franja: true, linea: 1, alineacion: 'derecha', orden: 0, tablero: false, enTablero: apilado(3) },
  [ELEMENTO_CONFIG]: { franja: true, linea: 2, alineacion: 'izquierda', orden: 0, tablero: false, enTablero: apilado(4) },
  ram: { franja: true, linea: 2, alineacion: 'derecha', orden: 0, tablero: false, enTablero: apilado(5) },
  sesion: { franja: true, linea: 2, alineacion: 'derecha', orden: 1, tablero: false, enTablero: apilado(6) },
  mcp: { franja: true, linea: 3, alineacion: 'izquierda', orden: 0, tablero: false, enTablero: apilado(7) },
  // Solo aparece mientras habla: su línea no ocupa lugar en silencio.
  voz: { franja: true, linea: 4, alineacion: 'izquierda', orden: 0, tablero: false, enTablero: apilado(8) },
}

/**
 * Los elementos que llegaron con la integración de context-bar. Una configuración
 * guardada antes no los conoce: lo que ya tenía baja `LINEAS_DE_CONTEXT_BAR` líneas
 * para dejarles su lugar arriba, como estaban en context-bar.
 */
const DE_CONTEXT_BAR: readonly string[] = ['modelo', 'limite-5h', 'contexto', 'limite-7d']
const LINEAS_DE_CONTEXT_BAR = 2

/** Los elementos en el orden en que el panel los lista. */
export const ELEMENTOS: readonly string[] = Object.keys(UBICACIONES_INICIALES)

/** La configuración de quien todavía no tocó nada. */
export const CONFIG_INICIAL: Config = {
  version: 2,
  elementos: { ...UBICACIONES_INICIALES },
  mcps: [],
}

const ALINEACIONES: readonly Alineacion[] = ['izquierda', 'centro', 'derecha']

const objeto = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null

const entero = (v: unknown, def: number) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : def)

/** Una posición guardada, campo por campo: lo que no sirva cae en el valor inicial. */
const leerPosicion = (guardada: unknown, inicial: Posicion): Posicion => {
  const g = objeto(guardada) ?? {}

  return {
    linea: entero(g.linea, inicial.linea),
    alineacion: ALINEACIONES.includes(g.alineacion as Alineacion) ? (g.alineacion as Alineacion) : inicial.alineacion,
    orden: entero(g.orden, inicial.orden),
  }
}

/** Una ubicación guardada, campo por campo. Antes de 0.9.0 no tenía `enTablero`: va apilada. */
const leerUbicacion = (guardada: unknown, inicial: Ubicacion): Ubicacion => {
  const g = objeto(guardada) ?? {}

  return {
    ...leerPosicion(g, inicial),
    franja: typeof g.franja === 'boolean' ? g.franja : inicial.franja,
    tablero: typeof g.tablero === 'boolean' ? g.tablero : inicial.tablero,
    enTablero: leerPosicion(g.enTablero, inicial.enTablero),
  }
}

/**
 * La configuración guardada, tolerante y con migración: la versión 1 (`{ ram, mcps }`)
 * pasa a la 2 conservando lo elegido. Un elemento nuevo, que la configuración guardada
 * no conoce, toma su ubicación inicial. El ⚙ siempre queda a la vista.
 */
export const leerConfig = (guardado: unknown): Config => {
  const g = objeto(guardado) ?? {}
  const guardados = objeto(g.elementos) ?? {}

  // Una configuración de antes de integrar context-bar: lo suyo baja para hacerles lugar.
  const sinContextBar = Object.keys(guardados).length > 0 && DE_CONTEXT_BAR.every(id => guardados[id] === undefined)

  const elementos: Record<string, Ubicacion> = {}
  for (const id of ELEMENTOS) {
    const inicial = UBICACIONES_INICIALES[id] as Ubicacion
    const leida = leerUbicacion(guardados[id], inicial)
    elementos[id] =
      sinContextBar && guardados[id] !== undefined ? { ...leida, linea: leida.linea + LINEAS_DE_CONTEXT_BAR } : leida
  }
  // Versión 1: solo decía si la RAM se mostraba.
  if (g.version === undefined && typeof g.ram === 'boolean' && elementos.ram !== undefined) {
    elementos.ram = { ...elementos.ram, franja: g.ram }
  }
  if (elementos[ELEMENTO_CONFIG] !== undefined) elementos[ELEMENTO_CONFIG] = { ...elementos[ELEMENTO_CONFIG], franja: true }

  const mcps = Array.isArray(g.mcps)
    ? [...new Set(g.mcps.filter((m): m is string => typeof m === 'string' && m !== ''))]
    : []

  return normalizar({ version: 2, elementos, mcps })
}

// ─── un lugar: leer y escribir la posición de un elemento en él ─────────────

/**
 * La posición de un elemento en un lugar. Una configuración en memoria de antes de
 * 0.8.0 no tiene `enTablero` (la memoria de la sesión sobrevive a una recarga del mod):
 * cae arriba a la izquierda hasta que se vuelva a leer.
 */
export const posicion = (u: Ubicacion, lugar: Lugar): Posicion =>
  lugar === 'franja'
    ? { linea: u.linea, alineacion: u.alineacion, orden: u.orden }
    : ((u.enTablero as Posicion | undefined) ?? apilado(0))

/** Si un elemento se ve en un lugar. */
export const visibleEn = (u: Ubicacion, lugar: Lugar): boolean => (lugar === 'franja' ? u.franja : u.tablero)

const conPosicion = (u: Ubicacion, lugar: Lugar, p: Posicion): Ubicacion =>
  lugar === 'franja' ? { ...u, ...p } : { ...u, enTablero: p }

/** Una línea de un lugar: los elementos de cada alineación, en orden. */
export type Linea = { linea: number } & Record<Alineacion, string[]>

/**
 * Las líneas de un lugar con los elementos a la vista, en orden. Las líneas sin
 * ningún elemento a la vista no aparecen: no quedan huecos.
 */
export const organizar = (config: Config, lugar: Lugar = 'franja'): Linea[] => {
  const porLinea = new Map<number, Linea>()
  const visibles = ELEMENTOS.filter(id => {
    const u = config.elementos[id]
    return u !== undefined && visibleEn(u, lugar)
  })
    .map(id => ({ id, p: posicion(config.elementos[id] as Ubicacion, lugar) }))
    .sort((a, b) => a.p.linea - b.p.linea || a.p.orden - b.p.orden || a.id.localeCompare(b.id))

  for (const { id, p } of visibles) {
    let linea = porLinea.get(p.linea)
    if (linea === undefined) {
      linea = { linea: p.linea, izquierda: [], centro: [], derecha: [] }
      porLinea.set(p.linea, linea)
    }
    linea[p.alineacion].push(id)
  }

  return [...porLinea.values()].sort((a, b) => a.linea - b.linea)
}

/** Deja prolijos los números de un lugar: líneas seguidas desde 0 y orden seguido desde 0. */
const normalizarLugar = (elementos: Record<string, Ubicacion>, lugar: Lugar): Record<string, Ubicacion> => {
  const salida = { ...elementos }
  const pos = (id: string) => posicion(salida[id] as Ubicacion, lugar)
  const ids = ELEMENTOS.filter(id => salida[id] !== undefined)
  const lineas = [...new Set(ids.map(id => pos(id).linea))].sort((a, b) => a - b)
  const nuevaLinea = new Map(lineas.map((l, i) => [l, i]))

  const grupos = new Map<string, string[]>()
  for (const id of ids) {
    const clave = `${pos(id).linea}|${pos(id).alineacion}`
    grupos.set(clave, [...(grupos.get(clave) ?? []), id])
  }
  for (const grupo of grupos.values()) {
    grupo.sort((a, b) => pos(a).orden - pos(b).orden || a.localeCompare(b))
    const fijas = grupo.map(pos)
    grupo.forEach((id, orden) => {
      const p = fijas[orden] as Posicion
      salida[id] = conPosicion(salida[id] as Ubicacion, lugar, { ...p, orden, linea: nuevaLinea.get(p.linea) ?? 0 })
    })
  }

  return salida
}

/**
 * Deja los números prolijos en los dos lugares: las líneas, seguidas desde 0 (sin
 * huecos); y el orden, seguido desde 0 dentro de cada línea y alineación. No cambia
 * cómo se ve nada.
 */
export const normalizar = (config: Config): Config => ({
  ...config,
  elementos: normalizarLugar(normalizarLugar(config.elementos, 'franja'), 'tablero'),
})

const conUbicacion = (config: Config, id: string, cambio: (u: Ubicacion) => Ubicacion): Config => {
  const u = config.elementos[id]
  if (u === undefined) return config

  return normalizar({ ...config, elementos: { ...config.elementos, [id]: cambio(u) } })
}

/** Las posiciones de los otros elementos en un lugar. */
const otras = (config: Config, id: string, lugar: Lugar, soloVisibles: boolean): Posicion[] =>
  ELEMENTOS.filter(otro => otro !== id)
    .map(otro => config.elementos[otro])
    .filter((u): u is Ubicacion => u !== undefined && (!soloVisibles || visibleEn(u, lugar)))
    .map(u => posicion(u, lugar))

/** El orden que deja a un elemento último en una línea y alineación. */
const ultimoEn = (config: Config, id: string, lugar: Lugar, linea: number, alineacion: Alineacion): number =>
  Math.max(-1, ...otras(config, id, lugar, false).filter(p => p.linea === linea && p.alineacion === alineacion).map(p => p.orden)) + 1

/** Una línea nueva, debajo de todas las del lugar. */
const lineaNueva = (config: Config, lugar: Lugar): number =>
  Math.max(-1, ...ELEMENTOS.map(id => config.elementos[id]).filter((u): u is Ubicacion => u !== undefined).map(u => posicion(u, lugar).linea)) + 1

/**
 * Sube o baja un elemento a la línea a la vista siguiente: salta las que solo tienen
 * elementos ocultos, que no se ven. Bajar desde la última, si comparte la línea, abre
 * una nueva; subir desde la primera no hace nada. Llega al final de su alineación.
 */
export const moverLinea = (config: Config, id: string, delta: -1 | 1, lugar: Lugar = 'franja'): Config => {
  const u = config.elementos[id]
  if (u === undefined) return config
  const p = posicion(u, lugar)
  const conVecinos = otras(config, id, lugar, true)
  const lineas = [...new Set(conVecinos.map(o => o.linea))].sort((a, b) => a - b)
  const vecina = delta === 1 ? lineas.find(l => l > p.linea) : [...lineas].reverse().find(l => l < p.linea)

  let destino: number
  if (vecina !== undefined) destino = vecina
  else if (delta === 1 && conVecinos.some(o => o.linea === p.linea)) destino = lineaNueva(config, lugar)
  else return config

  return conUbicacion(config, id, v =>
    conPosicion(v, lugar, { linea: destino, alineacion: p.alineacion, orden: ultimoEn(config, id, lugar, destino, p.alineacion) }),
  )
}

/** Cambia la alineación de un elemento: llega al final de la nueva. */
export const alinear = (config: Config, id: string, alineacion: Alineacion, lugar: Lugar = 'franja'): Config => {
  const u = config.elementos[id]
  if (u === undefined) return config
  const p = posicion(u, lugar)
  if (p.alineacion === alineacion) return config

  return conUbicacion(config, id, v =>
    conPosicion(v, lugar, { ...p, alineacion, orden: ultimoEn(config, id, lugar, p.linea, alineacion) }),
  )
}

/** Adelanta o atrasa un elemento entre los de su misma línea y alineación. */
export const moverOrden = (config: Config, id: string, delta: -1 | 1, lugar: Lugar = 'franja'): Config => {
  const u = config.elementos[id]
  if (u === undefined) return config
  const p = posicion(u, lugar)
  const grupo = ELEMENTOS.filter(otro => {
    const o = config.elementos[otro]
    if (o === undefined) return false
    const q = posicion(o, lugar)
    return q.linea === p.linea && q.alineacion === p.alineacion
  }).sort((a, b) => posicion(config.elementos[a] as Ubicacion, lugar).orden - posicion(config.elementos[b] as Ubicacion, lugar).orden)
  const i = grupo.indexOf(id)
  const vecino = grupo[i + delta]
  if (vecino === undefined) return config

  const v = config.elementos[vecino] as Ubicacion
  const q = posicion(v, lugar)
  return normalizar({
    ...config,
    elementos: {
      ...config.elementos,
      [id]: conPosicion(u, lugar, { ...p, orden: q.orden }),
      [vecino]: conPosicion(v, lugar, { ...q, orden: p.orden }),
    },
  })
}

/** Muestra u oculta un elemento en la franja. El ⚙ no se oculta. */
export const alternarFranja = (config: Config, id: string): Config =>
  id === ELEMENTO_CONFIG ? config : conUbicacion(config, id, u => ({ ...u, franja: !u.franja }))

/**
 * Muestra u oculta un elemento en el tablero lateral. Al entrar llega en una línea
 * nueva, debajo de lo que ya está, y desde ahí se acomoda.
 */
export const alternarTablero = (config: Config, id: string): Config =>
  conUbicacion(config, id, u =>
    u.tablero ? { ...u, tablero: false } : { ...u, tablero: true, enTablero: apilado(lineaNueva(config, 'tablero')) },
  )

/** Cómo se describe una posición en el panel: «línea 1 · derecha · 1º». */
export const describir = (u: Posicion): string => `línea ${u.linea + 1} · ${u.alineacion} · ${u.orden + 1}º`
