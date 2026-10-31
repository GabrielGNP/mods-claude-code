/**
 * Las partes puras de la barra de RAM: leer lo que escriben `reg` y `typeperf`, y
 * decidir qué dibujar. Aparte del módulo de hooks para poder probarlas sin montar nada.
 */

/** Cada cuántos segundos informa `typeperf`. */
export const INTERVALO_S = 5

/** El ancho de la barra, en celdas. */
export const ANCHO = 20

/** Dónde guarda Windows los nombres de los contadores en el idioma del sistema. */
export const CLAVE_CONTADORES = 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Perflib\\CurrentLanguage'

/**
 * Los índices de los contadores no cambian con el idioma; los nombres, sí. En un
 * Windows en español `\Memory\Available MBytes` no existe: se llama
 * `\Memoria\Mbytes disponibles`. `4` es el objeto Memoria y `1382` su contador de MB
 * disponibles.
 */
export const INDICE_MEMORIA = '4'
export const INDICE_MB_DISPONIBLES = '1382'

/** El nombre en inglés, por si el traducido no se pudo leer o no funciona. */
export const CONTADOR_EN_INGLES = '\\Memory\\Available MBytes'

/**
 * Los nombres de los contadores, por índice, de la salida de
 * `reg query <CLAVE_CONTADORES> /v Counter`. El valor es un REG_MULTI_SZ que `reg`
 * escribe en una línea, con `\0` literal entre cada índice y su nombre.
 */
export const nombresContadores = (salida: string): Map<string, string> => {
  const nombres = new Map<string, string>()
  const linea = salida.split(/\r?\n/).find(l => l.includes('REG_MULTI_SZ'))
  if (linea === undefined) return nombres

  const valor = linea.slice(linea.indexOf('REG_MULTI_SZ') + 'REG_MULTI_SZ'.length).trim()
  const partes = valor.split('\\0')
  for (let i = 0; i + 1 < partes.length; i += 2) {
    const indice = (partes[i] ?? '').trim()
    const nombre = partes[i + 1] ?? ''
    if (indice !== '' && nombre !== '' && !nombres.has(indice)) nombres.set(indice, nombre)
  }

  return nombres
}

/** Las rutas de contador a probar, en orden: la traducida primero, la inglesa después. */
export const rutasCandidatas = (nombres: Map<string, string>): string[] => {
  const objeto = nombres.get(INDICE_MEMORIA)
  const contador = nombres.get(INDICE_MB_DISPONIBLES)
  const traducida = objeto !== undefined && contador !== undefined ? `\\${objeto}\\${contador}` : null

  return traducida === null || traducida === CONTADOR_EN_INGLES ? [CONTADOR_EN_INGLES] : [traducida, CONTADOR_EN_INGLES]
}

/**
 * Los MB libres de una línea de `typeperf`, o null si la línea no es una lectura.
 * Las lecturas son CSV: `"10/28/2026 10:47:13.799","2908.000000"`. El encabezado
 * (`"(PDH-CSV 4.0)","\\EQUIPO\Memoria\…"`) y los mensajes no tienen un número ahí.
 */
export const lecturaTypeperf = (linea: string): number | null => {
  const m = /^"[^"]*","(-?\d+(?:[.,]\d+)?)"\s*$/.exec(linea.trim())
  if (m === null) return null
  const valor = Number((m[1] ?? '').replace(',', '.'))

  return Number.isFinite(valor) && valor >= 0 ? valor : null
}

/**
 * La salida de un proceso llega en pedazos, no en líneas: un pedazo puede cortar una
 * línea al medio. Esto junta lo que quedó pendiente con el pedazo nuevo y devuelve
 * las líneas completas y lo que sigue pendiente.
 */
export const partirLineas = (pendiente: string, texto: string): { lineas: string[]; pendiente: string } => {
  const todo = pendiente + texto
  const partes = todo.split(/\r?\n/)
  const resto = partes.pop() ?? ''

  return { lineas: partes.filter(l => l.trim() !== ''), pendiente: resto }
}

/** El total de RAM en MB, de la salida de la consulta única a Windows (bytes). */
export const totalDesdeBytes = (salida: string): number | null => {
  const bytes = Number(salida.trim())

  return Number.isFinite(bytes) && bytes > 0 ? bytes / 1_048_576 : null
}

/** El porcentaje en uso, de 0 a 100. */
export const enUso = (libreMB: number, totalMB: number): number =>
  Math.min(100, Math.max(0, Math.round(((totalMB - libreMB) / totalMB) * 100)))

/** La barra: celdas llenas por el porcentaje en uso. */
export const barra = (porcentaje: number, ancho = ANCHO): string => {
  const llenas = Math.round((porcentaje / 100) * ancho)

  return '█'.repeat(llenas) + '░'.repeat(ancho - llenas)
}

/** El color por porcentaje: claves del tema, que siguen al de cada persona. */
export const tono = (porcentaje: number): string | undefined =>
  porcentaje >= 90 ? 'error' : porcentaje >= 75 ? 'warning' : undefined

/** MB como GB con un decimal y coma: `12,7`. */
export const gb = (mb: number): string => (mb / 1024).toFixed(1).replace('.', ',')

// ─── la memoria de la sesión ────────────────────────────────────────────────

/*
 * La memoria que ocupa la sesión se lee en el mismo `typeperf` que la del equipo,
 * agregando dos contadores del objeto Proceso para los procesos de la sesión: su id y
 * su espacio de trabajo privado (lo que el Administrador de tareas muestra como
 * «Memoria»). Con varias sesiones abiertas hay varios procesos `claude`: se toma la
 * columna cuyo id es el de esta sesión. Medido el 2026-10-30.
 */

/** Índices del objeto Proceso y sus contadores, que no cambian con el idioma. */
export const INDICE_PROCESO = '230'
export const INDICE_ID_PROCESO = '784'
export const INDICE_PRIVADO = '1478'

/** Un juego de contadores en un idioma: la memoria libre y, si se sabe el proceso, los suyos. */
export type Juego = {
  /** La ruta de la memoria libre del equipo. */
  memoria: string
  /** El objeto, el id y la memoria del proceso, o null si no se sabe cuál es. */
  proceso: { objeto: string; id: string; privado: string; nombre: string } | null
}

/** Los juegos a probar, en orden: el traducido primero, el inglés después. */
export const juegosCandidatos = (nombres: Map<string, string>, proceso: string | null): Juego[] => {
  const conProceso = (objeto: string | undefined, id: string | undefined, privado: string | undefined) =>
    proceso === null || objeto === undefined || id === undefined || privado === undefined
      ? null
      : { objeto, id, privado, nombre: proceso }

  const ingles: Juego = { memoria: CONTADOR_EN_INGLES, proceso: conProceso('Process', 'ID Process', 'Working Set - Private') }
  const [traducida] = rutasCandidatas(nombres)
  if (traducida === undefined || traducida === CONTADOR_EN_INGLES) return [ingles]

  return [
    {
      memoria: traducida,
      proceso: conProceso(nombres.get(INDICE_PROCESO), nombres.get(INDICE_ID_PROCESO), nombres.get(INDICE_PRIVADO)),
    },
    ingles,
  ]
}

/** El archivo de contadores de un juego: una ruta por línea. */
export const archivoDeJuego = (j: Juego): string =>
  [
    j.memoria,
    ...(j.proceso === null
      ? []
      : [`\\${j.proceso.objeto}(${j.proceso.nombre}*)\\${j.proceso.id}`, `\\${j.proceso.objeto}(${j.proceso.nombre}*)\\${j.proceso.privado}`]),
  ].join('\r\n') + '\r\n'

/** Una línea CSV de `typeperf`, con todos sus campos entre comillas; null si no lo es. */
export const leerCsv = (linea: string): string[] | null => {
  const t = linea.trim()
  if (!t.startsWith('"') || !t.endsWith('"')) return null

  return t.slice(1, -1).split('","')
}

/** Qué columna es cada cosa, según el encabezado de una tanda. */
export type Columnas = { memoria: number; ids: Map<string, number>; privados: Map<string, number> }

/**
 * Las columnas, del encabezado (`"(PDH-CSV 4.0)","\\EQUIPO\Memoria\…","\\EQUIPO\Proceso(claude#4)\Id. de proceso",…`).
 * Cada instancia de proceso (`claude#4`) tiene una columna de id y una de memoria. Si la
 * de memoria libre no se reconoce por su nombre, es la primera.
 */
export const columnasDe = (encabezado: readonly string[], j: Juego): Columnas => {
  const ids = new Map<string, number>()
  const privados = new Map<string, number>()
  let memoria = 1
  encabezado.forEach((nombre, i) => {
    if (i === 0) return
    if (nombre.toLowerCase().endsWith(j.memoria.toLowerCase())) memoria = i
    if (j.proceso === null) return
    const m = new RegExp(`\\\\${escapar(j.proceso.objeto)}\\(([^)]*)\\)\\\\(.+)$`, 'i').exec(nombre)
    if (m === null) return
    const instancia = m[1] ?? ''
    if ((m[2] ?? '').toLowerCase() === j.proceso.id.toLowerCase()) ids.set(instancia, i)
    else if ((m[2] ?? '').toLowerCase() === j.proceso.privado.toLowerCase()) privados.set(instancia, i)
  })

  return { memoria, ids, privados }
}

const escapar = (t: string): string => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const numero = (campo: string | undefined): number | null => {
  const v = Number((campo ?? '').replace(',', '.'))

  return campo !== undefined && campo.trim() !== '' && Number.isFinite(v) && v >= 0 ? v : null
}

/**
 * Una fila de datos: los MB libres del equipo y los bytes de la sesión (la instancia
 * cuyo id es `pid`). Null si la fila no es una lectura.
 */
export const lecturaDeFila = (
  fila: readonly string[],
  cols: Columnas,
  pid: number | null,
): { libreMB: number; sesionBytes: number | null } | null => {
  const libreMB = numero(fila[cols.memoria])
  if (libreMB === null) return null
  let sesionBytes: number | null = null
  if (pid !== null) {
    for (const [instancia, col] of cols.ids) {
      if (numero(fila[col]) !== pid) continue
      const colPrivado = cols.privados.get(instancia)
      sesionBytes = colPrivado === undefined ? null : numero(fila[colPrivado])
      break
    }
  }

  return { libreMB, sesionBytes }
}

/** Un tamaño en la unidad más grande que alcance: `1,2 GB`, `349 MB` o `512 KB`. */
export const tamano = (bytes: number): string => {
  const KB = 1024
  const MB = KB * 1024
  const GB = MB * 1024
  if (bytes >= GB) return `${(bytes / GB).toFixed(1).replace('.', ',')} GB`
  if (bytes >= MB) return `${Math.round(bytes / MB)} MB`

  return `${Math.round(bytes / KB)} KB`
}

/**
 * Lo que informa la consulta del arranque: el total de RAM en bytes, el id del
 * proceso padre (la sesión) y su nombre. `16597598208 30664 claude`.
 */
export const leerArranque = (salida: string): { totalMB: number | null; pid: number | null; proceso: string | null } => {
  const [total, pid, proceso] = salida.trim().split(/\s+/)
  const pidNum = Number(pid)

  return {
    totalMB: totalDesdeBytes(total ?? ''),
    pid: Number.isInteger(pidNum) && pidNum > 0 ? pidNum : null,
    proceso: proceso !== undefined && /^[\w.-]+$/.test(proceso) ? proceso : null,
  }
}
