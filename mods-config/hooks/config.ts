/**
 * Las partes puras de los MCP y de la franja: aparte del módulo de hooks para poder
 * probarlas sin montar nada. La configuración y la disposición están en
 * `disposicion.ts`.
 */

import type { Config, EstadoMcp, ServidorMcp } from '../types'

export type { Config, EstadoMcp, ServidorMcp }

/** La clave del almacén del mod donde se guarda la configuración. */
export const CLAVE_CONFIG = 'config'

/** Alterna un servidor en la lista de elegidos. */
export const alternarMcp = (config: Config, servidor: string): Config => ({
  ...config,
  mcps: config.mcps.includes(servidor) ? config.mcps.filter(m => m !== servidor) : [...config.mcps, servidor],
})

// ─── los servidores MCP ─────────────────────────────────────────────────────

/*
 * El motor no lista los servidores MCP ni su estado. Hay dos fuentes:
 *
 * - `claude mcp list`, la fiel: todos los configurados, con su estado (conectado,
 *   requiere autenticación, deshabilitado, falló). Revisa la salud de cada uno: tarda
 *   unos 6 s y 1,2 s de CPU (medido el 2026-10-29), así que se consulta poco.
 * - `$.tool.list()`, la instantánea pero incompleta: las herramientas de un servidor
 *   conectado empiezan con `mcp__<servidor>__`, pero los que el motor carga bajo
 *   demanda no aparecen (medido: 2 servidores de 6 conectados). Sirve para confirmar
 *   que uno está conectado, nunca para decir que no lo está.
 */

/**
 * La clave de un servidor: su nombre como aparece en el de sus herramientas, donde
 * todo lo que no es letra, número, `_` o `-` es `_` (`claude.ai Gmail` →
 * `claude_ai_Gmail`).
 */
export const claveMcp = (nombre: string): string => nombre.replace(/[^A-Za-z0-9_-]/g, '_')

/** El servidor de una herramienta MCP, por su nombre: `mcp__<servidor>__<herramienta>`. */
export const servidorDeHerramienta = (nombre: string): string | null => /^mcp__(.+?)__/.exec(nombre)?.[1] ?? null

/** Los servidores con herramientas disponibles ahora: conectados seguro. */
export const conectados = (herramientas: readonly { name: string; mcp: boolean }[]): Set<string> => {
  const servidores = new Set<string>()
  for (const h of herramientas) {
    if (!h.mcp) continue
    const s = servidorDeHerramienta(h.name)
    if (s !== null) servidores.add(s)
  }

  return servidores
}

/** El estado de una línea de `claude mcp list`, por lo que dice al final. */
export const estadoDeLinea = (texto: string): EstadoMcp => {
  const t = texto.toLowerCase()
  if (t.includes('connected') && !t.includes('fail')) return 'conectado'
  if (t.includes('auth')) return 'autenticacion'
  if (t.includes('disabled')) return 'deshabilitado'
  if (t.includes('fail') || t.includes('error')) return 'fallo'

  return 'desconocido'
}

/**
 * Los servidores de la salida de `claude mcp list`. Cada uno es una línea
 * `<nombre>: <url o comando> - <estado>`; el nombre puede tener espacios
 * (`claude.ai Claude Docs`), y el estado va después del último ` - `.
 */
export const leerMcpList = (salida: string): ServidorMcp[] => {
  const servidores: ServidorMcp[] = []
  for (const linea of salida.split(/\r?\n/)) {
    const dosPuntos = linea.indexOf(': ')
    const guion = linea.lastIndexOf(' - ')
    if (dosPuntos <= 0 || guion <= dosPuntos) continue
    const etiqueta = linea.slice(0, dosPuntos).trim()
    servidores.push({ nombre: claveMcp(etiqueta), etiqueta, estado: estadoDeLinea(linea.slice(guion + 3)) })
  }

  return servidores
}

/** Un nombre legible a partir de la clave, cuando no hay otro: `claude_ai_Gmail` → `claude.ai Gmail`. */
export const nombreLegible = (clave: string): string => clave.replace(/^claude_ai_/, 'claude.ai ').replace(/_/g, ' ')

/**
 * Los servidores que el panel ofrece y su estado, juntando todo lo que se sabe:
 *
 * - `listado`, el último `claude mcp list` (o null si todavía no hubo uno);
 * - `ahora`, los que `$.tool.list()` ve conectados: eso manda sobre un listado viejo;
 * - `vistos` y `elegidos`, para que un servidor que se cayó o uno elegido que hoy no
 *   está configurado sigan a la vista.
 *
 * Ordenados por etiqueta.
 */
export const servidoresConocidos = (
  listado: readonly ServidorMcp[] | null,
  ahora: ReadonlySet<string>,
  vistos: readonly string[],
  elegidos: readonly string[],
): ServidorMcp[] => {
  const porClave = new Map<string, ServidorMcp>()
  for (const s of listado ?? []) porClave.set(s.nombre, s)
  for (const clave of [...ahora, ...vistos, ...elegidos]) {
    if (!porClave.has(clave)) porClave.set(clave, { nombre: clave, etiqueta: nombreLegible(clave), estado: 'desconocido' })
  }
  for (const clave of ahora) {
    const s = porClave.get(clave)
    if (s !== undefined) porClave.set(clave, { ...s, estado: 'conectado' })
  }

  return [...porClave.values()].sort((a, b) => a.etiqueta.localeCompare(b.etiqueta))
}

/** Cómo se dibuja cada estado: glifo, color (claves del tema) y texto. */
export const MARCA_MCP: Record<EstadoMcp, { glifo: string; tono: string; texto: string }> = {
  conectado: { glifo: '●', tono: 'success', texto: 'conectado' },
  autenticacion: { glifo: '!', tono: 'warning', texto: 'requiere autenticación' },
  deshabilitado: { glifo: '⊘', tono: 'inactive', texto: 'deshabilitado' },
  fallo: { glifo: '✘', tono: 'error', texto: 'falló' },
  desconocido: { glifo: '○', tono: 'inactive', texto: 'sin datos' },
}

// ─── la franja ──────────────────────────────────────────────────────────────

/**
 * Si un árbol de la franja dibuja algo: un texto con contenido en algún lugar. Una
 * caja vacía, o solo cajas vacías, no cuenta.
 */
export const tieneContenido = (nodo: unknown): boolean => {
  if (typeof nodo === 'string') return nodo.trim() !== ''
  if (nodo === null || typeof nodo !== 'object') return false
  if (Array.isArray(nodo)) return nodo.some(tieneContenido)
  const n = nodo as { type?: unknown; children?: unknown }
  // Un botón u otro elemento que no es caja ni texto dibuja algo por sí mismo.
  if (n.type !== 'Box' && n.type !== 'Text') return true

  return Array.isArray(n.children) && n.children.some(tieneContenido)
}
