/**
 * Configuración y armado de las frases: las partes puras del mod, aparte para
 * poder probarlas. Migrado de `hablar-stop-neural.ps1` y `hablar-pregunta.ps1`.
 */

// ------------------------------ CONFIGURACIÓN ------------------------------

/** La voz neuronal de edge-tts (o `es-AR-TomasNeural`, masculina). */
export const VOZ = 'es-AR-ElenaNeural'

/** `'-10%'` más lento, `'+15%'` más rápido. */
export const VELOCIDAD = '+0%'

/** Resumir con un modelo; con `false`, solo la primera oración (gratis e instantáneo). */
export const USAR_IA = true

/** El modelo que resume: el más rápido alcanza para una oración. */
export const MODELO_RESUMEN = 'haiku'

/** Anunciar el nombre de la sesión cuando tiene uno propio; si no, el del proyecto. */
export const DECIR_SESION = true

/** Techo de la frase hablada al terminar (~6 segundos). */
export const MAX_CARACTERES = 200

/** Cuánto del mensaje se le pasa al modelo para resumir. */
export const MAX_ENTRADA_IA = 2000

/** Lo que se dice antes de leer una pregunta. */
export const INTRO = 'Tengo una pregunta y necesito que me la respondas'

/** Silencio entre la intro y la primera pregunta. */
export const PAUSA_MS = 750

/** Silencio entre pregunta y pregunta. */
export const PAUSA_ENTRE = 900

/** Tope por pregunta, para casos patológicos. */
export const MAX_PREGUNTA = 400

// ---------------------------------------------------------------------------

/** Un tramo a decir y el silencio que va después. */
export type Pista = { texto: string; pausaMs: number }

/** Quita el markdown que no se lee bien en voz alta. */
export const limpiarMarkdown = (t: string): string => {
  if (!t) return ''

  return t
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#*_>|]/g, ' ')
    .replace(/^\s*[-+]\s+/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Recorta a `max` caracteres, siempre en palabra completa: primero intenta
 * cortar en el fin de una oración; si no hay, en una coma, y si no, en un espacio.
 */
export const recortar = (texto: string, max: number): string => {
  if (!texto) return ''

  const t = texto.replace(/\s+/g, ' ').trim().replace(/^["']+|["']+$/g, '')

  const oracion = new RegExp(`^(.{10,${max}}?[.!?])(\\s|$)`).exec(t)
  if (oracion) return oracion[1] ?? t

  if (t.length <= max) return /[.!?]$/.test(t) ? t : `${t}.`

  let trozo = t.slice(0, max)
  let corte = Math.max(trozo.lastIndexOf(', '), trozo.lastIndexOf('; '))
  if (corte < Math.floor(max * 0.5)) corte = trozo.lastIndexOf(' ')
  if (corte > 10) trozo = trozo.slice(0, corte)

  return `${trozo.replace(/[\s,;:-]+$/, '')}.`
}

/**
 * La etiqueta que se anuncia: el nombre de la sesión si tiene uno propio, si no
 * el del proyecto. El nombre por defecto (`<proyecto>-xx`) no aporta nada sobre el
 * del proyecto, así que se descarta, en mayúsculas o no (la carpeta `ASDD` da
 * sesiones `asdd-xx`). Los guiones se leen como espacios, para que
 * la voz no deletree «auth guion refactor».
 */
export const etiqueta = (sesion: string | null, proyecto: string | null): string | null => {
  const porDefecto =
    sesion !== null &&
    proyecto !== null &&
    new RegExp(`^${proyecto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-[a-z0-9]{2}$`, 'i').test(sesion)

  const elegida = sesion !== null && !porDefecto ? sesion : proyecto

  return elegida === null ? null : elegida.replace(/[-_]/g, ' ').trim()
}

/** La frase que se dice al terminar un turno. */
export const fraseFinal = (lugar: string | null, resumen: string | null): string => {
  if (lugar && resumen) return `Terminé en ${lugar}. ${resumen}`
  if (lugar) return `Terminé en ${lugar}.`
  if (resumen) return resumen

  return 'Terminé.'
}

/** Lo que se le pide al modelo para resumir, con la entrada acotada por los dos extremos. */
export const pedidoDeResumen = (texto: string): string => {
  let t = texto
  if (t.length > MAX_ENTRADA_IA) {
    const mitad = Math.floor(MAX_ENTRADA_IA / 2)
    t = `${t.slice(0, mitad)} [...] ${t.slice(t.length - mitad)}`
  }

  return (
    'Resumí en UNA sola oración breve, en primera persona, qué se hizo. ' +
    'Máximo 15 palabras. ' +
    'Si se hicieron varias cosas, NO las enumeres: mencioná solo la principal ' +
    'y cuántas más hubo. Ejemplo: "Refactoricé el módulo de autenticación y cuatro cosas más". ' +
    'Sin markdown, sin viñetas, sin preámbulo: respondé solo la oración. ' +
    'Si no hay nada concreto que reportar, respondé exactamente: Terminé. ' +
    `Texto: ${t}`
  )
}

/** Una pregunta de AskUserQuestion como la lee la voz, o null si no tiene cuerpo. */
const leerPregunta = (q: { question?: string; header?: string }): string | null => {
  const cuerpo = recortarPregunta(limpiarMarkdown(q.question ?? ''))
  if (!cuerpo) return null

  const contexto = limpiarMarkdown(q.header ?? '')

  return contexto && contexto !== cuerpo ? `Sobre ${contexto}. ${cuerpo}` : cuerpo
}

const recortarPregunta = (t: string): string => {
  if (t.length <= MAX_PREGUNTA) return t

  let trozo = t.slice(0, MAX_PREGUNTA)
  const corte = trozo.lastIndexOf(' ')
  if (corte > 20) trozo = trozo.slice(0, corte)

  return `${trozo.replace(/[\s,;:]+$/, '')}.`
}

/**
 * Las pistas de una pregunta: la intro, una pausa real, y cada pregunta con su
 * pausa. Las opciones no se leen. Vacío si no hay ninguna pregunta legible.
 */
export const pistasDePreguntas = (
  preguntas: readonly { question?: string; header?: string }[],
): Pista[] => {
  const textos = preguntas.map(leerPregunta).filter((t): t is string => t !== null)
  if (textos.length === 0) return []

  return [
    { texto: INTRO, pausaMs: PAUSA_MS },
    ...textos.map((texto, i) => ({
      texto,
      pausaMs: i < textos.length - 1 ? PAUSA_ENTRE : 0,
    })),
  ]
}

/** Cómo invocar edge-tts, en orden de preferencia: suelto, o como módulo de Python. */
export const CANDIDATOS_EDGE_TTS: readonly (readonly string[])[] = [
  ['edge-tts'],
  ['py', '-m', 'edge_tts'],
  ['python', '-m', 'edge_tts'],
]

// ------------------------- reproducción en Windows --------------------------

/*
 * En Windows el motor no reproduce: `$.audio.play` resuelve en ~16 ms sin sonar
 * y `$.audio.speak` falla con «no speech synthesizer on windows» (medido el
 * 2026-10-09). Por eso suena un proceso de PowerShell, que el mod mata para
 * callarlo. Uno solo por frase: lanzar uno por tramo agregaría su arranque a
 * cada pausa.
 */

/** Un texto como literal de PowerShell entre comillas simples. */
export const psLiteral = (texto: string): string => `'${texto.replace(/'/g, "''")}'`

/**
 * Un tramo a reproducir: el archivo, cuánto dura (si se sabe) y el silencio que
 * va después.
 */
export type Tramo = { ruta: string; pausaMs: number; duracionMs?: number }

/*
 * edge-tts escribe MP3 a 48 kbps (`audio-24khz-48kbitrate-mono-mp3`): 6000 bytes
 * por segundo. Hace falta saberlo porque `MediaPlayer`, en un proceso sin
 * ventana, no llega a conocer la duración (medido: `NaturalDuration` queda en
 * `Automatic`), y sin ella el script esperaría un tiempo fijo: cortando las
 * frases largas o esperando de más en las cortas.
 */
const BYTES_POR_SEGUNDO = 6000

/** Cuánto dura un MP3 de edge-tts, por su tamaño. */
export const duracionMp3 = (bytes: number): number => Math.ceil((bytes / BYTES_POR_SEGUNDO) * 1000)

/** Lo que se espera si no se sabe la duración: el techo de una frase hablada. */
const DURACION_DESCONOCIDA_MS = 8000

/** El script que reproduce los MP3 en orden, cada uno entero, con sus pausas. */
export const scriptReproduccion = (tramos: readonly Tramo[]): string =>
  [
    'Add-Type -AssemblyName presentationCore',
    'function Tocar($f, $ms) {',
    '  $p = New-Object System.Windows.Media.MediaPlayer',
    '  $p.Open([uri]$f)',
    '  Start-Sleep -Milliseconds 300',
    '  $p.Play()',
    '  Start-Sleep -Milliseconds ($ms + 300)',
    '  $p.Close()',
    '}',
    ...tramos.flatMap(t => [
      `Tocar ${psLiteral(t.ruta)} ${t.duracionMs ?? DURACION_DESCONOCIDA_MS}`,
      ...(t.pausaMs > 0 ? [`Start-Sleep -Milliseconds ${t.pausaMs}`] : []),
    ]),
  ].join('\n')

/**
 * El respaldo sin edge-tts: la voz de Windows (SAPI), en español si hay. Los
 * textos se leen de archivos UTF-8, no de la línea de comandos, donde se rompen
 * la ñ y los acentos.
 */
export const scriptSistema = (tramos: readonly Tramo[]): string =>
  [
    'Add-Type -AssemblyName System.Speech',
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    "$v = $s.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -like 'es*' } | Select-Object -First 1",
    'if ($v) { $s.SelectVoice($v.VoiceInfo.Name) }',
    '$s.Volume = 85',
    ...tramos.flatMap(t => [
      `$s.Speak([System.IO.File]::ReadAllText(${psLiteral(t.ruta)}, [System.Text.Encoding]::UTF8))`,
      ...(t.pausaMs > 0 ? [`Start-Sleep -Milliseconds ${t.pausaMs}`] : []),
    ]),
    '$s.Dispose()',
  ].join('\n')

/** Cómo se lanza PowerShell para un script. */
export const comandoPowerShell = (script: string): string[] => [
  'powershell.exe',
  '-NoProfile',
  '-ExecutionPolicy',
  'Bypass',
  '-Command',
  script,
]
