import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register, SessionContextUsage } from 'claude-code'

import type { Alineacion, Config, ContextView, EstadoRam, Lugar, ServidorMcp } from '../types'
import {
  CLAVE_CONFIG,
  MARCA_MCP,
  alternarMcp,
  conectados,
  leerMcpList,
  servidoresConocidos,
  tieneContenido,
} from './config'
import {
  CONFIG_INICIAL,
  ELEMENTOS,
  ELEMENTO_CONFIG,
  alinear,
  alternarFranja,
  alternarTablero,
  describir,
  leerConfig,
  moverLinea,
  moverOrden,
  organizar,
  posicion,
  visibleEn,
} from './disposicion'
import type { Linea } from './disposicion'
import {
  ANCHO_ETIQUETA,
  ANCHO_PCT,
  ANCHO_TIEMPO,
  SESION,
  bar,
  contextoDeAgente,
  enVentana,
  fmt,
  limits,
  modelTone,
  tail,
  tone as tonoLimite,
  until,
} from './contexto'
import type { Contexto, Limit } from './contexto'
import {
  CANDIDATOS_EDGE_TTS,
  comandoPowerShell,
  DECIR_SESION,
  duracionMp3,
  etiqueta,
  fraseFinal,
  limpiarMarkdown,
  MAX_CARACTERES,
  MODELO_RESUMEN,
  pedidoDeResumen,
  pistasDePreguntas,
  recortar,
  scriptReproduccion,
  scriptSistema,
  USAR_IA,
  VELOCIDAD,
  VOZ,
} from './voz'
import type { Pista, Tramo } from './voz'
import { COMANDO_GIT, distancia, leerEstado, textoCambios } from './git'
import {
  ANCHO,
  CLAVE_CONTADORES,
  INTERVALO_S,
  barra,
  enUso,
  archivoDeJuego,
  columnasDe,
  gb,
  juegosCandidatos,
  leerArranque,
  leerCsv,
  lecturaDeFila,
  nombresContadores,
  partirLineas,
  tamano,
  tono,
} from './ram'
import type { Columnas, Juego } from './ram'

const ram = atom({ plugin: 'mods-config', key: 'ram' } as const, { kind: 'esperando' })
const sesion = atom({ plugin: 'mods-config', key: 'sesion' } as const, null)
const config = atom({ plugin: 'mods-config', key: 'config' } as const, CONFIG_INICIAL)
const mcps = atom({ plugin: 'mods-config', key: 'mcps' } as const, [])
const consultandoMcp = atom({ plugin: 'mods-config', key: 'consultandoMcp' } as const, false)
const seleccion = atom({ plugin: 'mods-config', key: 'seleccion' } as const, ELEMENTO_CONFIG)
const editando = atom({ plugin: 'mods-config', key: 'editando' } as const, 'franja')
const contexto = atom({ plugin: 'mods-config', key: 'contexto' } as const, { kind: 'none' })
const modelo = atom({ plugin: 'mods-config', key: 'modelo' } as const, null)
const limites = atom({ plugin: 'mods-config', key: 'limites' } as const, [])
const pasos = atom({ plugin: 'mods-config', key: 'pasos' } as const, {})
const hablando = atom({ plugin: 'mods-config', key: 'hablando' } as const, null)
const repo = atom({ plugin: 'mods-config', key: 'repo' } as const, null)

/** Cada cuánto se sondea lo que ningún evento le avisa al mod: `/model`, `/clear`, la cuenta regresiva. */
const TIC = 10_000

/** `tokens` y `percent` faltan hasta la primera respuesta de la ventana viva. */
const deLaVentana = (c: SessionContextUsage): ContextView | null =>
  c.percent === undefined || c.tokens === undefined
    ? null
    : { kind: 'ready', percent: c.percent, tokens: c.tokens, window: c.window, estimated: false }

/** El id del panel de configuración. */
const PANEL = 'mods-config'

/** El id del tablero lateral: un elemento por renglón, los que se marcaron para él. */
const TABLERO = 'mods-tablero'

/** Cómo se llama cada elemento en el panel. */
const NOMBRES: Record<string, string> = {
  modelo: 'Modelo',
  contexto: 'Contexto',
  'limite-5h': 'Límite de 5 h',
  'limite-7d': 'Límite de 7 d',
  [ELEMENTO_CONFIG]: '⚙ Configuración',
  ram: 'Memoria RAM',
  sesion: 'Memoria de la sesión',
  mcp: 'Servidores MCP',
  voz: 'Voz (mientras habla)',
  git: 'Git (rama y cambios)',
}

/**
 * Cada cuánto se relee el repositorio sin que pase ningún turno: un `git checkout`
 * hecho en otra terminal aparece a lo sumo en este tiempo.
 */
const LATIDO_GIT_MS = 15_000

/** Cada cuánto se mira, sin costo, qué MCP tienen herramientas disponibles. */
const LATIDO_MCP_MS = 10_000

/** Cada cuánto se consulta `claude mcp list`, que tarda unos 6 s y 1,2 s de CPU. */
const LATIDO_MCP_LIST_MS = 5 * 60_000

// ─── la RAM: typeperf, como lo midió ram-bar en el motor real ───────────────

/**
 * Cuántas muestras toma cada `typeperf` antes de terminar y ser relanzado: 12 × 5 s, un
 * minuto. Es el seguro contra huérfanos: el mod lo lanza a través de `cmd`, y al
 * cerrarse la sesión o recargarse el mod el motor mata a `cmd` pero no a su hijo
 * (medido el 2026-10-28). Ese `typeperf` termina solo al completar su tanda.
 */
const MUESTRAS_POR_TANDA = 12

/** Cuántas tandas seguidas sin ninguna lectura se toleran antes de rendirse. */
const MAX_TANDAS_VACIAS = 3

/** La pausa antes de relanzar: si algo falla una y otra vez, no gira en vacío. */
const PAUSA_RELANZAR_MS = 1000

/** El total de RAM del equipo, en MB; null si no se pudo saber. Se consulta una vez. */
let totalMB: number | null = null

/** Si ya hay una medición en curso en este módulo. */
let midiendo = false

/** Si la RAM tiene que medirse ahora; apagarla desde el panel corta la medición. */
let ramEncendida = false

/** Si la sesión tiene a una persona delante: solo entonces se mide. */
let interactiva = false

/** Los servidores MCP vistos conectados en esta sesión, aunque después se caigan. */
let vistos: string[] = []

/** El último `claude mcp list`, o null si todavía no hubo uno. */
let listado: ServidorMcp[] | null = null

/** Los que `$.tool.list()` vio conectados la última vez. */
let ahora: Set<string> = new Set()

/** Espera con el reloj del motor: un temporizador, no una espera del hook. */
const pausa = ($: Engine, ms: number): Promise<void> =>
  new Promise(resolve => {
    $.clock.after(ms, () => resolve())
  })

/** El id del proceso de la sesión y su nombre (`claude`); null hasta saberlos. */
let sesionPid: number | null = null
let proceso: string | null = null

/**
 * El total de RAM y quién es la sesión: se le pregunta una sola vez a Windows, con un
 * PowerShell que termina. La sesión es el padre de ese PowerShell: el motor lanza los
 * procesos del mod como hijos directos de la sesión (medido el 2026-10-30).
 */
const consultarArranque = async ($: Engine): Promise<void> => {
  // Sin comillas dobles: según cómo se pasen los argumentos, llegan mal a PowerShell.
  const script =
    '$t=(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory;' +
    "$p=(Get-CimInstance Win32_Process -Filter ('ProcessId='+$PID)).ParentProcessId;" +
    "Write-Output ([string]$t+' '+$p+' '+(Get-Process -Id $p).ProcessName)"
  const r = await $.process.run(['powershell.exe', '-NoProfile', '-Command', script], { timeoutMs: 30_000 }).catch(() => null)
  if (r === null || r.exitCode !== 0) return
  const leido = leerArranque(r.stdout)
  totalMB = leido.totalMB
  sesionPid = leido.pid
  proceso = leido.proceso
}

/** Los nombres de los contadores en el idioma de este Windows, de su registro. */
const consultarNombres = async ($: Engine): Promise<Map<string, string>> => {
  const r = await $.process.run(['reg', 'query', CLAVE_CONTADORES, '/v', 'Counter'], { timeoutMs: 15_000 }).catch(() => null)

  return r !== null && r.exitCode === 0 ? nombresContadores(r.stdout) : new Map()
}

/** Una carpeta sin espacios para el archivo de contadores: su ruta va sin comillas. */
const carpetaSinEspacios = async ($: Engine): Promise<string | null> => {
  // Cada nombre va literal: el motor lista así qué variables lee un mod.
  const candidatas = [
    await $.env.get('TEMP').catch(() => undefined),
    await $.env.get('TMP').catch(() => undefined),
    await $.env.get('PUBLIC').catch(() => undefined),
  ]

  return candidatas.find((v): v is string => typeof v === 'string' && v !== '' && !/\s/.test(v)) ?? null
}

/**
 * Una tanda de `typeperf`: lo lanza y sigue sus lecturas. Devuelve cuántas dio; cero
 * es que esa ruta no sirve. Va por `cmd` con `< NUL` porque con la entrada cerrada
 * `typeperf` termina en la primera muestra, y el contador va en un archivo (`-cf`)
 * porque por `cmd` las comillas de una ruta con espacios llegan mal (las dos cosas,
 * medidas en el motor real). Si la RAM se apaga, sale del bucle: salir del bucle es lo
 * que mata al proceso.
 */
const tanda = async ($: Engine, juego: Juego, carpeta: string): Promise<number> => {
  let lecturas = 0
  let pendiente = ''
  let columnas: Columnas | null = null
  const archivo = `${carpeta}\\cc-ram-contadores.txt`
  await $.fs.write(archivo, archivoDeJuego(juego))
  const typeperf = $.process.spawn({
    argv: ['cmd.exe', '/d', '/c', `typeperf -cf ${archivo} -si ${INTERVALO_S} -sc ${MUESTRAS_POR_TANDA} < NUL`],
  })

  for await (const { stream, text } of typeperf) {
    if (!ramEncendida) break
    if (stream !== 'stdout') continue
    const partes = partirLineas(pendiente, text)
    pendiente = partes.pendiente
    for (const linea of partes.lineas) {
      const campos = leerCsv(linea)
      if (campos === null) continue
      // El encabezado dice qué columna es cada contador; sin él, la primera es la memoria.
      if ((campos[0] ?? '').startsWith('(PDH-CSV')) {
        columnas = columnasDe(campos, juego)
        continue
      }
      const lectura = lecturaDeFila(campos, columnas ?? { memoria: 1, ids: new Map(), privados: new Map() }, sesionPid)
      if (lectura === null) continue
      lecturas++
      await update($, ram, (): EstadoRam => ({ kind: 'lectura', libreMB: lectura.libreMB, totalMB }))
      await update($, sesion, () => lectura.sesionBytes)
    }
  }

  return lecturas
}

/** Mide mientras la RAM esté encendida: la ruta traducida o la inglesa, por tandas. */
const medir = async ($: Engine): Promise<void> => {
  if (midiendo || !ramEncendida || !interactiva) return
  midiendo = true

  try {
    const carpeta = await carpetaSinEspacios($)
    if (carpeta === null) {
      await update($, ram, (): EstadoRam => ({ kind: 'no disponible' }))
      return
    }
    if (totalMB === null) await consultarArranque($)
    const rutas = juegosCandidatos(await consultarNombres($), proceso)

    let i = 0
    let funciona = false
    let vacias = 0
    while (i < rutas.length && ramEncendida) {
      const juego = rutas[i]
      if (juego === undefined) break
      const lecturas = await tanda($, juego, carpeta)
      if (!ramEncendida) break
      if (lecturas > 0) {
        funciona = true
        vacias = 0
        await pausa($, PAUSA_RELANZAR_MS)
        continue
      }
      if (!funciona) {
        i++
        continue
      }
      if (++vacias >= MAX_TANDAS_VACIAS) break
      await pausa($, PAUSA_RELANZAR_MS)
    }

    // Apagada desde el panel: se vuelve a esperar. Si no, es que no se pudo medir.
    await update($, ram, (): EstadoRam => (ramEncendida ? { kind: 'no disponible' } : { kind: 'esperando' }))
  } finally {
    midiendo = false
  }
}

// ─── los MCP ────────────────────────────────────────────────────────────────

/** Rehace la lista de servidores con lo último que se sabe de cada fuente. */
const recalcularMcps = async ($: Engine): Promise<void> => {
  const elegidos = (await read($, config)).mcps
  await update($, mcps, (): ServidorMcp[] => servidoresConocidos(listado, ahora, vistos, elegidos))
}

/** La consulta rápida: qué servidores tienen herramientas disponibles. Sin costo. */
const refrescarMcps = async ($: Engine): Promise<void> => {
  const herramientas = await $.tool.list().catch(() => null)
  if (herramientas === null) return
  ahora = conectados(herramientas)
  vistos = [...new Set([...vistos, ...ahora])]
  await recalcularMcps($)
}

/**
 * La consulta completa: `claude mcp list`, con el estado de cada servidor configurado.
 * Una a la vez; mientras corre, el panel lo dice.
 */
const consultarMcpList = async ($: Engine): Promise<void> => {
  if (await read($, consultandoMcp)) return
  await update($, consultandoMcp, () => true)
  try {
    const r = await $.process.run(['claude', 'mcp', 'list'], { timeoutMs: 60_000 }).catch(() => null)
    if (r !== null && r.exitCode === 0) listado = leerMcpList(r.stdout)
    await refrescarMcps($)
  } finally {
    await update($, consultandoMcp, () => false)
  }
}

// ─── git: lo que era el mod git-rama ────────────────────────────────────────

/**
 * Relee el repositorio del directorio de la sesión, si el elemento se ve en algún lado.
 * Fuera de un repositorio (git sale con error), o sin git instalado, queda en null y el
 * elemento no se dibuja.
 */
const releerGit = async ($: Engine): Promise<void> => {
  if (!seVe(await read($, config), 'git')) return
  try {
    const { exitCode, stdout } = await $.process.run(COMANDO_GIT, { timeoutMs: 5_000 })
    const nuevo = exitCode === 0 ? leerEstado(stdout) : null
    // Sin cambios no se escribe: cada escritura redibuja la franja.
    if (JSON.stringify(nuevo) !== JSON.stringify(await read($, repo))) await update($, repo, () => nuevo)
  } catch {
    // Leer git es opcional: si falla, queda lo último que se supo.
  }
}

// ─── la voz: lo que era el mod voz ──────────────────────────────────────────

/** Lo que hay que abortar para callarse: el habla en curso, o null. */
let enCurso: AbortController | null = null


/** Cómo se invoca edge-tts en esta máquina; undefined mientras no se buscó. */
let edgeTts: readonly string[] | null | undefined

// ------------------------------- síntesis ----------------------------------

const buscarEdgeTts = async ($: Engine): Promise<readonly string[] | null> => {
  for (const candidato of CANDIDATOS_EDGE_TTS) {
    try {
      const r = await $.process.run([...candidato, '--version'], { timeoutMs: 15_000 })
      if (r.exitCode === 0) return candidato
    } catch {
      // ese candidato no está: se prueba el siguiente
    }
  }

  return null
}

/** La carpeta de trabajo, en el TEMP del usuario. */
const carpetaVoz = async ($: Engine): Promise<string> =>
  `${(await $.env.get('TEMP').catch(() => undefined)) ?? '.'}\\cc-voz`

/**
 * Un tramo a MP3 con edge-tts; devuelve la ruta del MP3 y cuánto dura, o null si
 * no se pudo. El texto viaja por archivo y no por la línea de comandos, que es
 * donde se rompen la ñ y los acentos en Windows. Los archivos se reusan por
 * posición (`voz-0`, `voz-1`): no se acumulan.
 */
const sintetizar = async (
  $: Engine,
  texto: string,
  n: number,
): Promise<{ ruta: string; duracionMs: number } | null> => {
  if (edgeTts === undefined) edgeTts = await buscarEdgeTts($)
  if (edgeTts === null) return null

  const base = `${await carpetaVoz($)}\\voz-${n}`

  await $.fs.write(`${base}.txt`, texto)
  const r = await $.process.run(
    [...edgeTts, `--voice=${VOZ}`, `--rate=${VELOCIDAD}`, '--file', `${base}.txt`, '--write-media', `${base}.mp3`],
    { timeoutMs: 60_000 },
  )
  if (r.exitCode !== 0) return null

  // Menos de ~512 bytes no es audio: edge-tts falló sin decirlo (red, proxy, voz).
  const { base64 } = await $.fs.read(`${base}.mp3`, { as: 'bytes' })
  const bytes = Math.floor((base64.length * 3) / 4)

  return bytes >= 512 ? { ruta: `${base}.mp3`, duracionMs: duracionMp3(bytes) } : null
}

/**
 * Corre un script de PowerShell hasta que termine o lo corten. La señal mata el
 * proceso: `return()` sobre el stream de `$.process.spawn` es lo que lo termina.
 */
const correr = async ($: Engine, script: string, senal: AbortSignal): Promise<void> => {
  const proceso = $.process.spawn({ argv: comandoPowerShell(script) })
  const matar = () => {
    void proceso.return({ code: null, signal: null })
  }
  senal.addEventListener('abort', matar, { once: true })

  try {
    for await (const _ of proceso) {
      // nada que leer: lo que importa es que el proceso siga vivo mientras suena
    }
  } finally {
    senal.removeEventListener('abort', matar)
  }
}

// -------------------------------- hablar -----------------------------------

/**
 * Dice las pistas en orden. Lo nuevo corta a lo anterior: si Claude termina otra
 * vez mientras habla, lo de antes ya quedó viejo.
 *
 * Se sintetiza todo antes de reproducir nada, para que las pausas duren
 * exactamente lo configurado y no lo que tarde la red.
 */
const decir = async ($: Engine, pistas: readonly Pista[]): Promise<void> => {
  enCurso?.abort()
  const control = new AbortController()
  enCurso = control
  const texto = pistas.map(pista => pista.texto).join(' ')

  /*
   * Diagnóstico de la última vez que habló: cuánto tardó cada paso y qué falló.
   * Queda en %TEMP%\cc-voz\diagnostico.json. Lo que no se ve desde afuera —que
   * la reproducción resuelva al instante sin sonar, por ejemplo— se mide acá.
   */
  const inicio = Date.now()
  const traza: Record<string, unknown> = { inicio: new Date(inicio).toISOString(), texto }

  try {
    const audios: ({ ruta: string; duracionMs: number } | null)[] = []
    for (const [i, pista] of pistas.entries()) {
      if (control.signal.aborted) return
      audios.push(
        await sintetizar($, pista.texto, i).catch(error => {
          traza.errorSintesis = String(error)
          return null
        }),
      )
    }
    traza.sintesisMs = Date.now() - inicio
    traza.duracionesMs = audios.map(audio => audio?.duracionMs ?? null)
    if (control.signal.aborted) return

    if (audios.every(audio => audio !== null)) {
      traza.via = 'edge-tts'
      const tramos: Tramo[] = pistas.map((pista, i) => ({
        ruta: (audios[i] as { ruta: string }).ruta,
        duracionMs: (audios[i] as { duracionMs: number }).duracionMs,
        pausaMs: pista.pausaMs,
      }))
      await update($, hablando, () => ({ texto, detenible: true }))

      const t0 = Date.now()
      await correr($, scriptReproduccion(tramos), control.signal)
      traza.reproduccionMs = Date.now() - t0
    } else {
      // Sin edge-tts: la voz de Windows, en el mismo proceso, así que también se corta.
      traza.via = 'sistema'
      const dir = await carpetaVoz($)
      const tramos: Tramo[] = []
      for (const [i, pista] of pistas.entries()) {
        const ruta = `${dir}\\sistema-${i}.txt`
        await $.fs.write(ruta, pista.texto)
        tramos.push({ ruta, pausaMs: pista.pausaMs })
      }
      await update($, hablando, () => ({ texto, detenible: true }))

      const t0 = Date.now()
      await correr($, scriptSistema(tramos), control.signal)
      traza.reproduccionMs = Date.now() - t0
    }
  } catch (error) {
    traza.error = String(error)
    throw error
  } finally {
    traza.cortado = control.signal.aborted
    traza.totalMs = Date.now() - inicio
    await escribirDiagnostico($, traza)

    if (enCurso === control) {
      enCurso = null
      await update($, hablando, () => null).catch(() => {})
    }
  }
}

/** Deja el diagnóstico de la última vez; si no se puede escribir, no importa. */
const escribirDiagnostico = async ($: Engine, traza: Record<string, unknown>): Promise<void> => {
  try {
    await $.fs.write(`${await carpetaVoz($)}\\diagnostico.json`, JSON.stringify(traza, null, 2))
  } catch {
    // el diagnóstico es opcional
  }
}

/** Corta lo que se esté diciendo. Dice si había algo. */
const detener = async ($: Engine): Promise<boolean> => {
  const habia = enCurso !== null
  enCurso?.abort()
  enCurso = null
  await update($, hablando, () => null)

  return habia
}

// ------------------------------ qué decir ----------------------------------

/**
 * El nombre propio de la sesión, por la vía documentada (`claude agents --json`):
 * el formato de los transcripts es interno y cambia entre versiones.
 */
const nombreDeSesion = async ($: Engine): Promise<string | null> => {
  try {
    const id = await $.session.id()
    const r = await $.process.run(['claude', 'agents', '--json'], { timeoutMs: 15_000 })
    if (r.exitCode !== 0) return null

    const lista = JSON.parse(r.stdout) as { sessionId?: string; name?: string }[]

    return lista.find(sesion => sesion.sessionId === id)?.name ?? null
  } catch {
    return null
  }
}

const resumir = async ($: Engine, texto: string): Promise<string | null> => {
  const r = await $.model
    .complete({ model: MODELO_RESUMEN, prompt: pedidoDeResumen(texto), maxTokens: 120 })
    .catch(() => null)

  return r !== null && r.isAnswered && r.text.trim() ? r.text.trim() : null
}

const alTerminar = async ($: Engine, respuesta: string): Promise<void> => {
  const cwd = await $.session.cwd().catch(() => null)
  const proyecto = cwd?.split(/[\\/]/).filter(Boolean).pop() ?? null
  const sesion = DECIR_SESION ? await nombreDeSesion($) : null

  const limpio = limpiarMarkdown(respuesta)
  const resumen = USAR_IA && limpio ? await resumir($, limpio) : null
  const recortado = recortar(resumen ?? limpio, MAX_CARACTERES)

  await decir($, [{ texto: fraseFinal(etiqueta(sesion, proyecto), recortado || null), pausaMs: 0 }])
}

// -------------------------------- hooks ------------------------------------

// ─── la configuración ───────────────────────────────────────────────────────

/** Guarda la configuración: en la sesión, y en el almacén del mod, que es por usuario. */
const guardar = async ($: Engine, cambio: (c: Config) => Config): Promise<Config> => {
  const nueva = await update($, config, cambio)
  await $.store.set(CLAVE_CONFIG, nueva).catch(() => {})

  return nueva
}

/** Los elementos marcados para el tablero, en el orden de la lista del panel. */
const delTablero = (c: Config): string[] => ELEMENTOS.filter(id => c.elementos[id]?.tablero === true)

/** Si un elemento se ve en algún lado: en la franja o en el tablero. */
const seVe = (c: Config, id: string): boolean => c.elementos[id]?.franja === true || c.elementos[id]?.tablero === true

/** Si la RAM o la memoria de la sesión se ven en algún lado: solo entonces se mide. */
const ramVisible = (c: Config): boolean => seVe(c, 'ram') || seVe(c, 'sesion')

const abrirTablero = async ($: Engine): Promise<void> => {
  // Sin `focus`: el tablero acompaña, no le quita el teclado al chat.
  await $.ui.open({ id: TABLERO, title: 'Mods', columns: 48 }).catch(() => {})
}

const tableroAbierto = async ($: Engine): Promise<boolean> =>
  (await $.ui.panes().catch(() => [])).some(p => p.id === TABLERO)

/** Abre el tablero, o lo cierra si ya está abierto. Dice cómo quedó. */
const alternarTableroAbierto = async ($: Engine): Promise<boolean> => {
  if (await tableroAbierto($)) {
    await $.ui.close({ id: TABLERO }).catch(() => {})
    $.ui.invalidate('ui.render')

    return false
  }
  await abrirTablero($)
  $.ui.invalidate('ui.render')

  return true
}

/**
 * Cambia la disposición y la guarda. Si con el cambio la RAM pasa a verse, arranca la
 * medición; si deja de verse, la medición se corta sola en su próxima lectura. El primer
 * elemento que entra al tablero lo abre, y el último que sale lo cierra.
 */
const cambiarDisposicion = async ($: Engine, cambio: (c: Config) => Config): Promise<void> => {
  const antes = delTablero(await read($, config)).length
  const nueva = await guardar($, cambio)
  ramEncendida = ramVisible(nueva)
  if (ramEncendida) void medir($).catch(() => {})
  // Git puede haber pasado a verse: se lee ya, sin esperar al latido.
  await releerGit($)

  const despues = delTablero(nueva).length
  if (antes === 0 && despues > 0) await abrirTablero($)
  if (antes > 0 && despues === 0) await $.ui.close({ id: TABLERO }).catch(() => {})
}

/** Aplica un cambio al elemento elegido en el panel, en el lugar que se está editando. */
const sobreElegido = async ($: Engine, cambio: (c: Config, id: string, lugar: Lugar) => Config): Promise<void> => {
  const id = await read($, seleccion)
  const lugar = await read($, editando)
  await cambiarDisposicion($, c => cambio(c, id, lugar))
}

const alternarServidor = async ($: Engine, servidor: string): Promise<void> => {
  await guardar($, c => alternarMcp(c, servidor))
  await recalcularMcps($)
}

const abrirPanel = async ($: Engine): Promise<void> => {
  await refrescarMcps($)
  // La consulta completa, sin esperarla: el panel se abre y se completa al llegar.
  void consultarMcpList($).catch(() => {})
  // Sin `focus`: el panel no le quita el teclado al chat.
  await $.ui.open({ id: PANEL, title: 'Configuración de mods', closeOnEscape: true })
}

/** La tabla de elementos que da `$.ui.resolve(e)`: la misma en la franja y en los paneles. */
type Ui = ReturnType<Engine['ui']['resolve']>

/**
 * El dibujo de cada elemento, por su id; null si no tiene nada que mostrar. Lo usan la
 * franja y el tablero. `agentId` es el subagente a la vista, si lo hay; `columnas`, el
 * ancho del lugar donde se dibuja.
 */
const armarDibujos = async ($: Engine, ui: Ui, agentId: string | undefined, columnas: number): Promise<Record<string, unknown>> => {
const { Box, Button, Text } = ui
const c = await read($, config)
  const servidores = await read($, mcps)
  const medida = await read($, ram)
  const ocupa = await read($, sesion)
  const diciendo = await read($, hablando)
  const vista = await read($, contexto)
  const nombreModelo = await read($, modelo)
  const ventanas = limits(await read($, limites))
  const ahoraMs = await $.clock.now().catch(() => null)
  const repositorio = await read($, repo)

  const elegidos = servidores.filter(s => c.mcps.includes(s.nombre))

  /*
   * El dibujo de cada elemento, por su id; null si no tiene nada que mostrar. Agregar
   * un elemento es agregar su dibujo acá y su ubicación inicial en disposicion.ts.
   */
  /*
   * Lo que era context-bar. Qué está a la vista: la sesión principal, o el subagente
   * abierto desde la lista de tareas (`view.agentId`). Los límites de uso son de la
   * cuenta: valen igual para los dos.
   */
  let lineaModelo: string | null = nombreModelo
  let ctx: Contexto | null =
    vista.kind === 'none' ? null : vista.kind === 'measuring' ? { kind: 'measuring' } : { ...vista, kind: 'ready' }

  if (agentId !== undefined) {
    const anotados = await read($, pasos)
    const paso = anotados[agentId]
    const agentes = await $.agent.list().catch(() => [])
    const tipo = agentes.find(agente => agente.id === agentId)?.type
    lineaModelo =
      paso === undefined ? (tipo ?? 'subagente') : tipo === undefined ? paso.model : `${tipo} · ${paso.model}`
    ctx = contextoDeAgente(paso, anotados[''], vista.kind === 'ready' ? vista.window : null)
  }

  const elementoModelo = lineaModelo === null ? null : <Text color={modelTone(lineaModelo)}>{lineaModelo}</Text>

  const elementoContexto =
    ctx === null ? null : ctx.kind === 'measuring' ? (
      <Text dimColor>Contexto [{bar(0)}] midiendo…</Text>
    ) : ctx.kind === 'tokens' ? (
      <Text dimColor>Contexto {fmt(ctx.tokens)}</Text>
    ) : (
      <Box>
        <Text dimColor>Contexto </Text>
        <Text color={tonoLimite(ctx.percent)}>
          [{bar(ctx.percent)}] {ctx.estimated ? '~' : ''}
          {ctx.percent}%
        </Text>
        <Text dimColor>{tail(ctx.tokens, ctx.window, null)}</Text>
      </Box>
    )

  /*
   * Un límite de uso. Cada segmento de largo variable va en una caja de ancho fijo:
   * dos límites en la misma alineación quedan con sus barras en columna, sea cual
   * sea el porcentaje o el tiempo que les quede.
   */
  const ventana = (limite: Limit) => {
    const falta = ahoraMs === null ? null : until(limite.resetsAt, ahoraMs)
    const t = tonoLimite(limite.percent)

    return (
      <Box key={`limite-${limite.label}`}>
        <Box width={ANCHO_ETIQUETA}>
          <Text color={t}>{limite.label}</Text>
        </Box>
        <Text color={t}> [{bar(limite.percent, SESION)}] </Text>
        <Box width={ANCHO_PCT} justifyContent="flex-end">
          <Text color={t}>{limite.percent}%</Text>
        </Box>
        <Box width={ANCHO_TIEMPO}>
          <Text dimColor>{falta === null ? '' : ` · ${falta}`}</Text>
        </Box>
      </Box>
    )
  }
  // La ventana corta en su elemento; la larga, y cualquier otra que informe el motor, en el otro.
  const [corta, ...resto] = ventanas

  return {
    voz:
      diciendo === null ? null : (
        <Box key="mods-config-voz" width={columnas}>
          {diciendo.detenible ? (
            <Button key="callar" plain label={'\u{1F50A}'} hotkey="1" onPress={() => detener($)} />
          ) : (
            <Text>{'\u{1F50A}'}</Text>
          )}
          <Text dimColor wrap="truncate-end">
            {' '}
            {diciendo.texto}
          </Text>
        </Box>
      ),
    modelo: elementoModelo,
    contexto: elementoContexto,
    'limite-5h': corta === undefined ? null : ventana(corta),
    'limite-7d': resto.length === 0 ? null : <Box flexDirection="column">{resto.map(ventana)}</Box>,
    [ELEMENTO_CONFIG]: (
      <Button key="abrir-config" plain onPress={() => abrirPanel($)}>
        <Text dimColor>⚙ mods</Text>
      </Button>
    ),
    ram: (() => {
      if (medida.kind === 'esperando') return null
      if (medida.kind === 'no disponible') return <Text dimColor>RAM · no disponible</Text>
      if (medida.totalMB === null) return <Text dimColor>RAM · {gb(medida.libreMB)} GB libres</Text>

      const porcentaje = enUso(medida.libreMB, medida.totalMB)
      const color = tono(porcentaje)

      return (
        <Box>
          <Text dimColor>RAM </Text>
          <Text color={color}>{barra(porcentaje, ANCHO)}</Text>
          <Text color={color} bold={color !== undefined}>
            {' '}
            {String(porcentaje).padStart(3)}%
          </Text>
          <Text dimColor>
            {'  '}
            {gb(medida.totalMB - medida.libreMB)} / {gb(medida.totalMB)} GB
          </Text>
        </Box>
      )
    })(),
    sesion: ocupa === null ? null : <Text dimColor>Sesión {tamano(ocupa)}</Text>,
    // Los MCP, juntos: si son muchos, siguen en la línea siguiente.
    mcp:
      elegidos.length === 0 ? null : (
        <Box key="mods-config-mcp" flexWrap="wrap" columnGap={3}>
          {elegidos.map(s => (
            <Text key={`mcp-${s.nombre}`} color={MARCA_MCP[s.estado].tono}>
              {MARCA_MCP[s.estado].glifo} {s.etiqueta}
            </Text>
          ))}
        </Box>
      ),
    // La rama, lo que le falta o le sobra respecto de la remota, y los cambios sin commitear.
    git:
      repositorio === null ? null : (
        <Box key="mods-config-git">
          <Text dimColor>Git </Text>
          <Text color="cyan" wrap="truncate-end">
            {repositorio.rama}
          </Text>
          {repositorio.desacoplada ? <Text dimColor> (HEAD desacoplado)</Text> : null}
          {distancia(repositorio) === '' ? null : <Text> {distancia(repositorio)}</Text>}
          <Text dimColor> · </Text>
          <Text color={repositorio.cambios === 0 ? 'green' : 'yellow'}>{textoCambios(repositorio.cambios)}</Text>
          {repositorio.conUpstream || repositorio.desacoplada ? null : <Text dimColor> · sin remota</Text>}
        </Box>
      ),
  }
}

/**
 * Las líneas de un lugar, ya dibujadas. Cada línea: sin nada al centro, izquierda y
 * derecha en los extremos; con algo al centro, tres zonas iguales, para que el centro
 * quede centrado de verdad. Las líneas sin nada que mostrar no se dibujan.
 */
const armarLineas = (ui: Ui, lineas: Linea[], dibujos: Record<string, unknown>, prefijo: string): never[] => {
  const { Box } = ui
  const de = (ids: string[]) => ids.map(id => dibujos[id]).filter(d => d !== null && d !== undefined) as never[]
  const zona = (nodos: never[], justificar: 'flex-start' | 'center' | 'flex-end') => (
    <Box width={0} flexGrow={1} justifyContent={justificar} columnGap={2}>
      {nodos}
    </Box>
  )

  return lineas
    .map(l => ({ izquierda: de(l.izquierda), centro: de(l.centro), derecha: de(l.derecha) }))
    .filter(z => z.izquierda.length + z.centro.length + z.derecha.length > 0)
    .map((z, i) => {
      const clave = `${prefijo}-${i + 1}`
      if (z.centro.length === 0) {
        return (
          <Box key={clave} justifyContent="space-between" columnGap={2}>
            <Box columnGap={2}>{z.izquierda}</Box>
            <Box columnGap={2}>{z.derecha}</Box>
          </Box>
        )
      }

      return (
        <Box key={clave} columnGap={2}>
          {zona(z.izquierda, 'flex-start')}
          {zona(z.centro, 'center')}
          {zona(z.derecha, 'flex-end')}
        </Box>
      )
    }) as never[]
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const resultado = await next(e)
    interactiva = e.isInteractive

    const guardada = leerConfig(await $.store.get(CLAVE_CONFIG).catch(() => undefined))
    await update($, config, () => guardada)
    ramEncendida = ramVisible(guardada)

    await $.command
      .register({ name: 'mods-config', description: 'Abre la configuración de los mods', immediate: true })
      .catch(() => {})
    await $.command
      .register({ name: 'tablero', description: 'Abre o cierra el tablero lateral de los mods', immediate: true })
      .catch(() => {})
    if (interactiva) {
      // `immediate`: `/callar` corta aunque Claude esté a mitad de un turno.
      await $.command.register({ name: 'callar', description: 'Detiene la voz', immediate: true }).catch(() => {})
    }

    /*
     * Un tic cada TIC ms hace lo que ningún evento hace por este mod: mueve la cuenta
     * regresiva de los límites, relee el modelo (`classic.PostModelSwitch` no le
     * llega) y nota que la ventana se vació con `/clear` (`classic.SessionStart`
     * tampoco). Los dos eventos clásicos los saltea el plugin de seguridad para los
     * plugins de usuario (medido con `--debug`).
     */
    $.clock.every(TIC, async () => {
      try {
        const nombre = await $.session.model().catch(() => null)
        if (nombre !== null) await update($, modelo, () => nombre)

        const uso = await $.session.usage().catch(() => null)
        if (uso !== null) {
          const viva = deLaVentana(uso.context)
          const actual = await read($, contexto)
          if (viva !== null) await update($, contexto, () => viva)
          // Sin cifras teniendo en pantalla una medición real: la ventana se vació.
          else if (actual.kind === 'ready' && !actual.estimated) await update($, contexto, (): ContextView => ({ kind: 'measuring' }))
        }
      } finally {
        $.ui.invalidate('ui.render')
      }
    })

    // Las primeras lecturas, para no esperar al primer turno. Todo es opcional.
    const uso = await $.session.usage().catch(() => null)
    if (uso !== null) {
      const viva = deLaVentana(uso.context)
      if (viva !== null) await update($, contexto, () => viva)
      await update($, limites, () => [...uso.rateLimits])
    }
    const nombre = await $.session.model().catch(() => null)
    await update($, modelo, () => nombre)

    // Git: al arrancar y con su latido, que trae lo que se haga en otra terminal.
    await releerGit($)
    $.clock.every(LATIDO_GIT_MS, () => {
      releerGit($).catch(() => {})
    })

    await refrescarMcps($)
    $.clock.every(LATIDO_MCP_MS, () => {
      refrescarMcps($).catch(() => {})
    })
    // La consulta completa solo con una persona delante: en un `claude -p` no se mira.
    if (interactiva) {
      void consultarMcpList($).catch(() => {})
      $.clock.every(LATIDO_MCP_LIST_MS, () => {
        consultarMcpList($).catch(() => {})
      })
    }

    if (interactiva && ramEncendida) void medir($).catch(() => {})
    /*
     * Con algo marcado, el tablero se abre solo. Sin que la persona lo pida, el motor lo
     * dibuja desde 144 columnas (110 si alguna vez lo abrió); más angosto, espera.
     */
    if (interactiva && delTablero(guardada).length > 0) void abrirTablero($)

    return resultado
  })

  /*
   * El motor empuja la medición después de cada turno. El modelo se relee acá porque
   * `/model` puede cambiarlo en pleno vuelo.
   */
  on('session.measure', async ($, e, next) => {
    const viva = deLaVentana(e.context)
    if (viva !== null) await update($, contexto, () => viva)
    // Las ventanas llegan vacías sin suscripción: ahí no se pisa lo que haya.
    if (e.rateLimits.length > 0) await update($, limites, () => [...e.rateLimits])
    const nombre = await $.session.model().catch(() => null)
    await update($, modelo, () => nombre)
    // Claude pudo haber commiteado o cambiado de rama en el turno.
    await releerGit($)

    return next(e)
  })

  /*
   * Al compactar, la ventana viva se reinicia y el motor deja de informar `tokens` y
   * `percent` hasta la respuesta siguiente: sin esto, se seguiría viendo la cifra de
   * antes, que ya es falsa. El desglose estima localmente y da una cifra al instante.
   */
  on('session.compact', async ($, e, next) => {
    const resultado = await next(e)
    // `precompute` no instala nada, y una compactación vetada no cambió nada.
    if (e.trigger === 'precompute' || 'skip' in resultado) return resultado

    await update($, contexto, (): ContextView => ({ kind: 'measuring' }))
    const { breakdown } = (await $.session.usage({ breakdown: 'summary' })).context
    if (breakdown !== undefined) {
      await update($, contexto, (): ContextView => ({
        kind: 'ready',
        percent: breakdown.percentage,
        tokens: breakdown.totalTokens,
        window: breakdown.rawMaxTokens,
        estimated: true,
      }))
    }

    return resultado
    // Si algo falla, la compactación sigue su curso: este hook solo mira.
  }).catch(($, e, next) => next(e))

  /*
   * Cada pedido al modelo, de la sesión principal o de un subagente: de acá sale el
   * modelo y el contexto de un subagente, que ninguna otra vía da. Es el camino
   * caliente de toda la sesión: solo anota, y nada de lo suyo puede fallar.
   */
  on('turn.step', async function* ($, e, next) {
    const respuesta = yield* next(e)
    try {
      if (respuesta.usage !== null) {
        const paso = { model: e.model, tokens: enVentana(respuesta.usage) }
        await update($, pasos, previos => ({ ...previos, [e.agentId ?? '']: paso }))
      }
    } catch {
      // Anotar es opcional; el pedido ya se hizo.
    }

    return respuesta
  })

  /*
   * La voz, al terminar un turno de la sesión principal: no los de los subagentes, ni
   * uno interrumpido o fallido. Corre aparte, sin `await`, para no demorar el turno.
   */
  on('turn.complete', async ($, e, next) => {
    const resultado = await next(e)
    if (interactiva && e.agentId === undefined && e.reason === 'answer') {
      void alTerminar($, e.answer).catch(() => {})
    }

    return resultado
  })

  // Cuando Claude pregunta y queda esperando: se lee la pregunta, no las opciones.
  on('tool.call', { tool: 'AskUserQuestion' }, ($, e, next) => {
    if (interactiva) {
      const pistas = pistasDePreguntas(e.questions ?? [])
      if (pistas.length > 0) void decir($, pistas).catch(() => {})
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'callar' }, async $ => ({
    text: (await detener($)) ? 'Listo, me callo.' : 'No estaba hablando.',
  }))

  on('command.run', { command: 'mods-config' }, async $ => {
    await abrirPanel($)

    return { text: 'Configuración de mods abierta.' }
  })

  on('command.run', { command: 'tablero' }, async $ => {
    if (!(await alternarTableroAbierto($))) return { text: 'Tablero cerrado.' }
    const vacio = delTablero(await read($, config)).length === 0

    return { text: vacio ? 'Tablero abierto. Está vacío: márquele elementos con t en /mods-config.' : 'Tablero abierto.' }
  })

  // ─── la franja: los elementos, cada uno en su línea y alineación ──────────

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Lo de abajo primero, y se envuelve: esta franja la comparten varios mods.
    const beneath = await next(e)
    if (e.props.hasSurvey) return beneath

    const { Box, Text } = $.ui.resolve(e)
    const c = await read($, config)
    const dibujos = await armarDibujos($, $.ui.resolve(e), e.props.view.agentId, e.props.bodyColumns)
    const lineas = armarLineas($.ui.resolve(e), organizar(c, 'franja'), dibujos, 'mods-config-linea')

    // Con `key` en una Box: la de un Text no se conserva en el árbol.
    const separacion = (clave: string) => (
      <Box key={clave}>
        <Text dimColor wrap="truncate-end">
          {'─'.repeat(Math.max(0, e.props.bodyColumns))}
        </Text>
      </Box>
    )

    return (
      <Box flexDirection="column">
        {/*
          Este mod es el más externo: lo de abajo es todo lo que dibujan los demás. Una
          separación arriba de todo los aparta del chat; si no dibujan nada, no va, para
          no dejar dos líneas seguidas.
        */}
        {tieneContenido(beneath) ? separacion('mods-config-separacion-superior') : null}
        {beneath}
        {/* El grupo del mod: una separación arriba, y debajo sus líneas. */}
        <Box key="mods-config-grupo" flexDirection="column" width={e.props.bodyColumns}>
          <Text dimColor wrap="truncate-end">
            {'─'.repeat(Math.max(0, e.props.bodyColumns))}
          </Text>
          {lineas}
        </Box>
      </Box>
    )
  })

  // ─── el tablero lateral: su propia disposición, como la franja ────────────

  on('ui.render', { component: 'Pane', requestId: TABLERO }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const c = await read($, config)
    if (delTablero(c).length === 0) {
      return <Text dimColor>Vacío. En /mods-config, elija un elemento y pulse t para traerlo acá.</Text>
    }
    const dibujos = await armarDibujos($, $.ui.resolve(e), e.props.view.agentId, e.props.bodyColumns)
    // Lo que todavía no tiene nada que mostrar (la voz en silencio, la RAM antes de medir) no ocupa renglón.
    const lineas = armarLineas($.ui.resolve(e), organizar(c, 'tablero'), dibujos, 'mods-tablero-linea')
    if (lineas.length === 0) return <Text dimColor>Esperando los primeros datos…</Text>

    return (
      <Box flexDirection="column">
        {lineas}
      </Box>
    )
  })

  // ─── el panel de configuración ────────────────────────────────────────────

  on('ui.render', { component: 'Pane', requestId: PANEL }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const c = await read($, config)
    const lista = await read($, mcps)
    const consultando = await read($, consultandoMcp)
    const elegido = await read($, seleccion)
    const lugar = await read($, editando)
    const abierto = await tableroAbierto($)
    const marca = (si: boolean) => (si ? '[x]' : '[ ]')
    const u = c.elementos[elegido]
    const enLaFranja = lugar === 'franja'

    /** Dónde está un elemento en el lugar que se edita, o que no está ahí. */
    const donde = (ub: NonNullable<typeof u>) =>
      visibleEn(ub, lugar) ? describir(posicion(ub, lugar)) : enLaFranja ? 'oculto' : 'fuera del tablero'

    /** Un botón de acción sobre el elemento elegido: su tecla y su texto. */
    const accion = (clave: string, tecla: string, texto: string, cambio: (c: Config, id: string, lugar: Lugar) => Config) => (
      <Button key={clave} plain hotkey={tecla} onPress={() => sobreElegido($, cambio)}>
        <Text>{texto}</Text>
      </Button>
    )
    const a = (alineacion: Alineacion) => (cfg: Config, id: string, l: Lugar) => alinear(cfg, id, alineacion, l)
    const pestana = (l: Lugar, texto: string) => (
      <Text bold={lugar === l} color={lugar === l ? 'claude' : undefined} dimColor={lugar !== l}>
        {lugar === l ? `[${texto}]` : ` ${texto} `}
      </Text>
    )

    return (
      <Box flexDirection="column">
        <Box>
          <Text bold>Editando </Text>
          <Button key="editando" plain hotkey="m" onPress={() => update($, editando, (l): Lugar => (l === 'franja' ? 'tablero' : 'franja'))}>
            <Text>
              {pestana('franja', 'la franja')}
              {pestana('tablero', 'el tablero')}
            </Text>
          </Button>
          <Text dimColor> (m cambia)</Text>
        </Box>
        <Box marginTop={1}>
          <Text bold>Elementos </Text>
          <Text dimColor>(1-9 y 0 eligen uno; después, las teclas de abajo lo mueven)</Text>
        </Box>
        {ELEMENTOS.map((id, i) => {
          const ub = c.elementos[id]
          if (ub === undefined) return null
          // Dónde está en el otro lugar, como referencia.
          const otro = enLaFranja ? (ub.tablero ? ' · en el tablero' : '') : ub.franja ? ' · en la franja' : ''

          return (
            <Box key={`elemento-${id}`}>
              <Button key={`elegir-${id}`} plain hotkey={i < 9 ? `${i + 1}` : i === 9 ? '0' : undefined} onPress={() => update($, seleccion, () => id)}>
                <Text bold={id === elegido} color={id === elegido ? 'claude' : undefined}>
                  {id === elegido ? '▸ ' : '  '}
                  {NOMBRES[id] ?? id}
                </Text>
              </Button>
              <Text dimColor>
                {'   '}
                {donde(ub)}
                {otro}
              </Text>
            </Box>
          )
        })}

        {u === undefined ? null : (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>
              Mover «{NOMBRES[elegido] ?? elegido}» en {enLaFranja ? 'la franja' : 'el tablero'} <Text dimColor>({donde(u)})</Text>
            </Text>
            <Box flexWrap="wrap" columnGap={2}>
              {accion('subir', 's', 'subir de línea', (cfg, id, l) => moverLinea(cfg, id, -1, l))}
              {accion('bajar', 'b', 'bajar de línea', (cfg, id, l) => moverLinea(cfg, id, 1, l))}
              {accion('izquierda', 'i', 'izquierda', a('izquierda'))}
              {accion('centro', 'c', 'centro', a('centro'))}
              {accion('derecha', 'd', 'derecha', a('derecha'))}
              {accion('antes', 'a', 'antes', (cfg, id, l) => moverOrden(cfg, id, -1, l))}
              {accion('luego', 'l', 'después', (cfg, id, l) => moverOrden(cfg, id, 1, l))}
              {elegido === ELEMENTO_CONFIG
                ? null
                : accion('ver', 'v', u.franja ? 'ocultar de la franja' : 'mostrar en la franja', (cfg, id) => alternarFranja(cfg, id))}
              {accion('tablero', 't', u.tablero ? 'sacar del tablero' : 'al tablero', (cfg, id) => alternarTablero(cfg, id))}
            </Box>
          </Box>
        )}

        <Box marginTop={1}>
          <Text bold>Servidores MCP </Text>
          <Text dimColor>(los marcados se muestran en el elemento «Servidores MCP»)</Text>
        </Box>
        <Box>
          <Button key="actualizar-mcp" plain hotkey="r" onPress={() => consultarMcpList($)}>
            <Text dimColor>{consultando ? 'consultando claude mcp list…' : 'Actualizar estados'}</Text>
          </Button>
        </Box>
        {lista.length === 0 ? (
          <Text dimColor>{'  '}{consultando ? 'Buscando servidores…' : 'No hay servidores MCP configurados.'}</Text>
        ) : null}
        {lista.map(s => (
          <Box key={`fila-${s.nombre}`}>
            <Button key={`opt-mcp-${s.nombre}`} plain onPress={() => alternarServidor($, s.nombre)}>
              <Text>
                {marca(c.mcps.includes(s.nombre))} {s.etiqueta}
              </Text>
            </Button>
            <Text color={MARCA_MCP[s.estado].tono}>
              {'  '}
              {MARCA_MCP[s.estado].glifo} {MARCA_MCP[s.estado].texto}
            </Text>
          </Box>
        ))}

        <Box marginTop={1}>
          <Button key="cerrar" role="dismiss" hotkey="x" onPress={() => $.ui.close({ id: PANEL })}>
            Cerrar
          </Button>
          <Text>{'  '}</Text>
          <Button key="abrir-tablero" plain hotkey="p" onPress={() => alternarTableroAbierto($)}>
            <Text>{abierto ? 'Cerrar el tablero' : 'Abrir el tablero'}</Text>
          </Button>
        </Box>
        <Box>
          <Text dimColor>
            Se guarda por usuario · m franja o tablero · 1-9 y 0 eligen · s/b línea · i/c/d alineación · a/l orden ·
            v franja · t tablero · p abre o cierra el tablero · r actualiza MCP · Tab y Enter para los MCP · x o Esc cierra
          </Text>
        </Box>
      </Box>
    )
  })
}
