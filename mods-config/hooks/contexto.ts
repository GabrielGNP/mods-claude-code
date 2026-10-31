/** Las partes puras de la barra, aparte para poder probarlas. */

/** Celdas que mide la barra. */
export const WIDTH = 20

/** Celdas de las barras de límite de uso: más cortas, para que entren las dos. */
export const SESION = 10

/*
 * Anchos fijos, en celdas, de lo que rodea a cada barra de límite. Lo que va a
 * la derecha de una barra cambia de largo (`5%` / `100%`, `47m` / `23h 59m`), y
 * la columna está alineada a la derecha: sin un ancho fijo, cada fila corre su
 * barra a un lugar distinto. Reservando el máximo, las barras quedan en columna.
 */

/** La etiqueta: `5h`, `7d`, `$`. */
export const ANCHO_ETIQUETA = 2

/** El porcentaje, hasta `100%` (y `999%`: un `spend_limit` excedido pasa de 100). */
export const ANCHO_PCT = 4

/** El tiempo hasta el reinicio con su separador, hasta ` · 23h 59m`. */
export const ANCHO_TIEMPO = 10

/**
 * Lo que mide una fila de límite, siempre igual gracias a los anchos fijos:
 * espacio, etiqueta, ` [barra] `, porcentaje y tiempo.
 */
export const ANCHO_VENTANA = 1 + ANCHO_ETIQUETA + (SESION + 4) + ANCHO_PCT + ANCHO_TIEMPO

/** Separación mínima entre las dos columnas para que se lean como dos y no como una. */
export const SEPARACION = 2

/**
 * Si las dos columnas entran lado a lado en `columnas` celdas. La derecha mide
 * siempre `ANCHO_VENTANA`; la izquierda, lo que mida su fila más larga.
 */
export const caben = (columnas: number, izquierda: readonly string[]): boolean =>
  Math.max(0, ...izquierda.map(texto => texto.length)) + SEPARACION + ANCHO_VENTANA <=
  columnas

/**
 * Lo que la fila de contexto tiene para mostrar. `tokens` es el caso de un
 * subagente cuya ventana no se conoce: se sabe cuánto ocupa, no contra qué.
 */
export type Contexto =
  | { kind: 'measuring' }
  | { kind: 'ready'; percent: number; tokens: number; window: number; estimated: boolean }
  | { kind: 'tokens'; tokens: number }

/**
 * La fila de contexto como texto plano, para medirla: lo mismo que el render
 * dibuja en piezas de colores.
 */
export const textoContexto = (c: Contexto): string => {
  if (c.kind === 'measuring') return `Contexto [${bar(0)}] midiendo…`
  if (c.kind === 'tokens') return `Contexto ${fmt(c.tokens)}`

  return (
    `Contexto [${bar(c.percent)}] ${c.estimated ? '~' : ''}${c.percent}%` +
    tail(c.tokens, c.window, null)
  )
}

/** Lo que un pedido al modelo ocupa de la ventana: la entrada y la caché, leída y escrita. */
export const enVentana = (u: {
  input_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}): number => u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens

/** El último pedido de un loop: qué modelo respondió y cuánto ocupaba. */
export type Paso = { model: string; tokens: number }

/**
 * El contexto de un subagente. Ninguna API dice el tamaño de ventana de un
 * modelo: solo se conoce la de la sesión principal. Si el subagente corre el
 * mismo modelo, se mide contra esa; si no, se muestran sus tokens sin inventar
 * un porcentaje.
 */
export const contextoDeAgente = (
  paso: Paso | undefined,
  principal: Paso | undefined,
  ventanaPrincipal: number | null,
): Contexto => {
  if (paso === undefined) return { kind: 'measuring' }

  if (ventanaPrincipal !== null && principal !== undefined && paso.model === principal.model) {
    return {
      kind: 'ready',
      percent: Math.round((paso.tokens / ventanaPrincipal) * 100),
      tokens: paso.tokens,
      window: ventanaPrincipal,
      estimated: false,
    }
  }

  return { kind: 'tokens', tokens: paso.tokens }
}

/** `[████░░░░…]` con el llenado redondeado a una celda, acotado a 0–WIDTH. */
export const bar = (percent: number, width: number = WIDTH): string => {
  const filled = Math.max(0, Math.min(width, Math.round((percent / 100) * width)))

  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

/** Tokens legibles: `840`, `84k`, `1.0M`. */
export const fmt = (tokens: number): string => {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`

  return String(tokens)
}

/** La cola de la barra: los tokens y, si se pudo leer, el modelo en uso. */
export const tail = (tokens: number, window: number, model: string | null): string =>
  ` · ${fmt(tokens)}/${fmt(window)}${model === null ? '' : ` · ${model}`}`

/**
 * El color de cada familia de modelo, sin mirar la versión. Son colores crudos
 * y no claves del tema: no siguen el tema del usuario, que es lo que se quiere
 * acá — un modelo se reconoce siempre del mismo color.
 */
const COLOR_MODELO: readonly (readonly [RegExp, string])[] = [
  [/haiku/i, 'green'],
  [/sonnet/i, 'blue'],
  [/opus/i, 'yellow'],
  [/fable/i, 'red'],
]

/** El color de un modelo, o undefined si no es una familia conocida. */
export const modelTone = (model: string | null): string | undefined =>
  model === null ? undefined : COLOR_MODELO.find(([patron]) => patron.test(model))?.[1]

/** Un límite de uso listo para dibujar: etiqueta corta, porcentaje y cuándo se reinicia. */
export type Limit = { label: string; percent: number; resetsAt?: string }

const ETIQUETAS: Record<string, string> = {
  five_hour: '5h',
  seven_day: '7d',
  spend_limit: '$',
}

/**
 * Los límites en el orden en que conviene leerlos —la ventana corta primero—,
 * con el porcentaje redondeado: un decimal en una barra no se lee, estorba.
 */
export const limits = (
  windows: readonly { kind: string; percentUsed: number; resetsAt?: string }[],
): Limit[] => {
  const orden = ['five_hour', 'seven_day', 'spend_limit']

  return [...windows]
    .sort((a, b) => {
      const ia = orden.indexOf(a.kind)
      const ib = orden.indexOf(b.kind)

      return (ia === -1 ? orden.length : ia) - (ib === -1 ? orden.length : ib)
    })
    .map(w => ({
      label: ETIQUETAS[w.kind] ?? w.kind,
      percent: Math.round(w.percentUsed),
      ...(w.resetsAt === undefined ? {} : { resetsAt: w.resetsAt }),
    }))
}

/**
 * Cuánto falta hasta `resetsAt`: `47m`, `2h 14m`, `3d 4h`. Null cuando el motor no
 * lo informó o no se puede leer: mejor no mostrar nada que mostrar algo falso.
 */
export const until = (resetsAt: string | undefined, now: number): string | null => {
  if (resetsAt === undefined) return null

  const due = Date.parse(resetsAt)
  if (Number.isNaN(due)) return null

  // Hacia arriba: con 30 s por delante todavía falta «1m», no «0m».
  const minutos = Math.max(0, Math.ceil((due - now) / 60_000))
  const d = Math.floor(minutos / 1440)
  const h = Math.floor((minutos % 1440) / 60)
  const m = minutos % 60

  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`

  return `${m}m`
}

/** Verde hasta 60, ámbar hasta 85, rojo de ahí en adelante. */
export const tone = (percent: number): 'success' | 'warning' | 'error' => {
  if (percent >= 85) return 'error'
  if (percent >= 60) return 'warning'

  return 'success'
}
