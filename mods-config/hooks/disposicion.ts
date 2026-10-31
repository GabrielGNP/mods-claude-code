/**
 * La disposición de los elementos: dónde va cada uno y cómo se mueve. Lógica pura,
 * aparte del módulo de hooks para poder probarla sin montar nada.
 *
 * Un elemento es una pieza que el mod sabe dibujar (la RAM, los MCP, el ⚙…). Cada uno
 * tiene una ubicación en la franja sobre el chat —línea, alineación y orden dentro de
 * esa alineación— y puede mostrarse o no en el tablero lateral. Agregar un elemento es
 * darle una ubicación inicial en `UBICACIONES_INICIALES` y su dibujo en el módulo.
 */

import type { Alineacion, Config, Ubicacion } from '../types'

export type { Alineacion, Config, Ubicacion }

/** El elemento que abre la configuración: siempre a la vista, o no habría cómo volver. */
export const ELEMENTO_CONFIG = 'config'

/**
 * Dónde va cada elemento la primera vez, o si su ubicación guardada no sirve. Arriba,
 * lo que era context-bar (modelo y contexto a la izquierda, los límites de uso a la
 * derecha); abajo, el ⚙, la RAM y los MCP; y al final, mientras habla, la voz.
 */
export const UBICACIONES_INICIALES: Readonly<Record<string, Ubicacion>> = {
  modelo: { franja: true, linea: 0, alineacion: 'izquierda', orden: 0, tablero: false },
  'limite-5h': { franja: true, linea: 0, alineacion: 'derecha', orden: 0, tablero: false },
  contexto: { franja: true, linea: 1, alineacion: 'izquierda', orden: 0, tablero: false },
  'limite-7d': { franja: true, linea: 1, alineacion: 'derecha', orden: 0, tablero: false },
  [ELEMENTO_CONFIG]: { franja: true, linea: 2, alineacion: 'izquierda', orden: 0, tablero: false },
  ram: { franja: true, linea: 2, alineacion: 'derecha', orden: 0, tablero: false },
  sesion: { franja: true, linea: 2, alineacion: 'derecha', orden: 1, tablero: false },
  mcp: { franja: true, linea: 3, alineacion: 'izquierda', orden: 0, tablero: false },
  // Solo aparece mientras habla: su línea no ocupa lugar en silencio.
  voz: { franja: true, linea: 4, alineacion: 'izquierda', orden: 0, tablero: false },
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

/** Una ubicación guardada, campo por campo: lo que no sirva cae en el valor inicial. */
const leerUbicacion = (guardada: unknown, inicial: Ubicacion): Ubicacion => {
  const g = objeto(guardada) ?? {}
  const entero = (v: unknown, def: number) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : def)

  return {
    franja: typeof g.franja === 'boolean' ? g.franja : inicial.franja,
    linea: entero(g.linea, inicial.linea),
    alineacion: ALINEACIONES.includes(g.alineacion as Alineacion) ? (g.alineacion as Alineacion) : inicial.alineacion,
    orden: entero(g.orden, inicial.orden),
    tablero: typeof g.tablero === 'boolean' ? g.tablero : inicial.tablero,
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

/** Una línea de la franja: los elementos de cada alineación, en orden. */
export type Linea = { linea: number } & Record<Alineacion, string[]>

/**
 * Las líneas de la franja con los elementos a la vista, en orden. Las líneas sin
 * ningún elemento no aparecen: no quedan huecos.
 */
export const organizar = (config: Config): Linea[] => {
  const porLinea = new Map<number, Linea>()
  const visibles = ELEMENTOS.filter(id => config.elementos[id]?.franja)
    .map(id => ({ id, u: config.elementos[id] as Ubicacion }))
    .sort((a, b) => a.u.linea - b.u.linea || a.u.orden - b.u.orden || a.id.localeCompare(b.id))

  for (const { id, u } of visibles) {
    let linea = porLinea.get(u.linea)
    if (linea === undefined) {
      linea = { linea: u.linea, izquierda: [], centro: [], derecha: [] }
      porLinea.set(u.linea, linea)
    }
    linea[u.alineacion].push(id)
  }

  return [...porLinea.values()].sort((a, b) => a.linea - b.linea)
}

/**
 * Deja los números prolijos: las líneas, seguidas desde 0 (sin huecos); y el orden,
 * seguido desde 0 dentro de cada línea y alineación. No cambia cómo se ve nada.
 */
export const normalizar = (config: Config): Config => {
  const elementos: Record<string, Ubicacion> = { ...config.elementos }
  const lineas = [...new Set(ELEMENTOS.map(id => elementos[id]?.linea ?? 0))].sort((a, b) => a - b)
  const nuevaLinea = new Map(lineas.map((l, i) => [l, i]))

  const grupos = new Map<string, string[]>()
  for (const id of ELEMENTOS) {
    const u = elementos[id]
    if (u === undefined) continue
    const clave = `${u.linea}|${u.alineacion}`
    grupos.set(clave, [...(grupos.get(clave) ?? []), id])
  }
  for (const ids of grupos.values()) {
    ids.sort((a, b) => (elementos[a]?.orden ?? 0) - (elementos[b]?.orden ?? 0) || a.localeCompare(b))
    ids.forEach((id, orden) => {
      const u = elementos[id] as Ubicacion
      elementos[id] = { ...u, orden, linea: nuevaLinea.get(u.linea) ?? 0 }
    })
  }

  return { ...config, elementos }
}

const conUbicacion = (config: Config, id: string, cambio: (u: Ubicacion) => Ubicacion): Config => {
  const u = config.elementos[id]
  if (u === undefined) return config

  return normalizar({ ...config, elementos: { ...config.elementos, [id]: cambio(u) } })
}

/** El orden que deja a un elemento último en una línea y alineación. */
const ultimoEn = (config: Config, id: string, linea: number, alineacion: Alineacion): number =>
  Math.max(
    -1,
    ...ELEMENTOS.filter(otro => otro !== id)
      .map(otro => config.elementos[otro])
      .filter((u): u is Ubicacion => u !== undefined && u.linea === linea && u.alineacion === alineacion)
      .map(u => u.orden),
  ) + 1

/**
 * Sube o baja un elemento de línea. Bajar desde la última abre una línea nueva; subir
 * desde la primera no hace nada. Llega al final de su alineación en la línea nueva.
 */
export const moverLinea = (config: Config, id: string, delta: -1 | 1): Config => {
  const u = config.elementos[id]
  if (u === undefined) return config
  const ultima = Math.max(...ELEMENTOS.map(otro => config.elementos[otro]?.linea ?? 0))
  const destino = Math.min(Math.max(0, u.linea + delta), ultima + 1)
  if (destino === u.linea) return config

  return conUbicacion(config, id, v => ({ ...v, linea: destino, orden: ultimoEn(config, id, destino, v.alineacion) }))
}

/** Cambia la alineación de un elemento: llega al final de la nueva. */
export const alinear = (config: Config, id: string, alineacion: Alineacion): Config => {
  const u = config.elementos[id]
  if (u === undefined || u.alineacion === alineacion) return config

  return conUbicacion(config, id, v => ({ ...v, alineacion, orden: ultimoEn(config, id, v.linea, alineacion) }))
}

/** Adelanta o atrasa un elemento entre los de su misma línea y alineación. */
export const moverOrden = (config: Config, id: string, delta: -1 | 1): Config => {
  const u = config.elementos[id]
  if (u === undefined) return config
  const grupo = ELEMENTOS.filter(otro => {
    const o = config.elementos[otro]
    return o !== undefined && o.linea === u.linea && o.alineacion === u.alineacion
  }).sort((a, b) => (config.elementos[a]?.orden ?? 0) - (config.elementos[b]?.orden ?? 0))
  const i = grupo.indexOf(id)
  const vecino = grupo[i + delta]
  if (vecino === undefined) return config

  const v = config.elementos[vecino] as Ubicacion
  return normalizar({
    ...config,
    elementos: { ...config.elementos, [id]: { ...u, orden: v.orden }, [vecino]: { ...v, orden: u.orden } },
  })
}

/** Muestra u oculta un elemento en la franja. El ⚙ no se oculta. */
export const alternarFranja = (config: Config, id: string): Config =>
  id === ELEMENTO_CONFIG ? config : conUbicacion(config, id, u => ({ ...u, franja: !u.franja }))

/** Muestra u oculta un elemento en el tablero lateral. */
export const alternarTablero = (config: Config, id: string): Config =>
  conUbicacion(config, id, u => ({ ...u, tablero: !u.tablero }))

/** Cómo se describe una ubicación en el panel: «línea 1 · derecha · 1º». */
export const describir = (u: Ubicacion): string => `línea ${u.linea + 1} · ${u.alineacion} · ${u.orden + 1}º`
