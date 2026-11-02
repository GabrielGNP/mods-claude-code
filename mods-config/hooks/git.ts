/*
 * El elemento Git, lo que era el mod git-rama. Lee la salida de
 * `git status --porcelain=v2 --branch`, sin nada del motor: así se prueba sola. Un solo proceso trae rama, remota, adelante/atrás y
 * cambios, en un formato que git promete no cambiar.
 *
 *   # branch.oid 1a2b3c4d…
 *   # branch.head main
 *   # branch.upstream origin/main
 *   # branch.ab +1 -2
 *   1 .M N... 100644 100644 100644 … archivo.ts
 *   ? nuevo.md
 */
import type { Repo } from '../types'

export const COMANDO_GIT =['git', 'status', '--porcelain=v2', '--branch'] as const

export const leerEstado = (salida: string): Repo | null => {
  let oid = ''
  let head = ''
  let conUpstream = false
  let adelante = 0
  let atras = 0
  let cambios = 0

  for (const linea of salida.split(/\r?\n/)) {
    if (linea === '') continue

    if (linea.startsWith('# branch.oid ')) oid = linea.slice('# branch.oid '.length)
    else if (linea.startsWith('# branch.head ')) head = linea.slice('# branch.head '.length)
    else if (linea.startsWith('# branch.upstream ')) conUpstream = true
    else if (linea.startsWith('# branch.ab ')) {
      const ab = /\+(\d+) -(\d+)/.exec(linea)
      if (ab !== null) {
        adelante = Number(ab[1])
        atras = Number(ab[2])
      }
    }
    // Cambiado (1), renombrado (2), en conflicto (u) o sin seguir (?).
    else if (/^[12u?] /.test(linea)) cambios += 1
  }

  if (head === '') return null

  const desacoplada = head === '(detached)'
  return {
    rama: desacoplada ? oid.slice(0, 7) : head,
    desacoplada,
    conUpstream,
    adelante,
    atras,
    cambios,
  }
}

/** `↑1 ↓2`, solo lo que no sea cero; vacío si está al día o sin remota. */
export const distancia = (repo: Repo): string =>
  [repo.adelante > 0 ? `↑${repo.adelante}` : '', repo.atras > 0 ? `↓${repo.atras}` : '']
    .filter(Boolean)
    .join(' ')

export const textoCambios = (cambios: number): string =>
  cambios === 0 ? 'limpio' : cambios === 1 ? '1 cambio' : `${cambios} cambios`
