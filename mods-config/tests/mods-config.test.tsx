import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import {
  alternarMcp,
  claveMcp,
  conectados,
  estadoDeLinea,
  leerMcpList,
  nombreLegible,
  servidorDeHerramienta,
  servidoresConocidos,
  tieneContenido,
} from '../hooks/config'
import { CONFIG_INICIAL } from '../hooks/disposicion'

/** Lo último que se guardó en el almacén, como configuración. */
type Guardada = {
  elementos: Record<string, { franja: boolean; linea: number; alineacion: string; tablero: boolean }>
  mcps: string[]
}

/*
 * El entorno de las pruebas tiene `setTimeout`, pero los tipos del motor no lo
 * declaran: el de los hooks no lo tiene. Solo se usa acá, para esperar.
 */
declare const setTimeout: (fn: () => void, ms: number) => unknown

/** Espera a que avance lo que el mod dejó corriendo sin esperar. */
const asentar = () => new Promise<void>(r => setTimeout(() => r(), 50))

const REG_ES = [
  '',
  'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Perflib\\CurrentLanguage',
  '    Counter    REG_MULTI_SZ    1\\01847\\02\\0Sistema\\04\\0Memoria\\01382\\0Mbytes disponibles\\0230\\0Proceso\\0784\\0Id. de proceso\\01478\\0Espacio de trabajo - Privado',
  '',
].join('\r\n')

/** Una salida de `claude mcp list` como la medida el 2026-10-29. */
const MCP_LIST = [
  'Checking MCP server health…',
  '',
  'claude.ai Claude Docs: https://api.anthropic.com/v1/pages/mcp - ✔ Connected',
  'claude.ai Google Docs: https://docsmcp.googleapis.com/mcp/v1 - ✔ Connected',
  'claude.ai Github CAJT: https://api.githubcopilot.com/mcp - ! Needs authentication',
  'context7: npx -y @upstash/context7-mcp@3.2.1 - ⊘ Disabled for this project (re-enable via /mcp)',
  'roto: node servidor.js - ✘ Failed to connect',
  'mycelium: C:\\Programas\\Mycelium\\mycelium-mcp.exe  - ✔ Connected',
].join('\r\n')

const LINEA = (mb: number) => `"10/28/2026 10:47:13.799","${mb}.000000"`

// ─── la lógica ──────────────────────────────────────────────────────────────


test('claude mcp list: nombre, clave y estado de cada servidor', async () => {
  const l = leerMcpList(MCP_LIST)
  expect(l.map(x => `${x.nombre}|${x.etiqueta}|${x.estado}`)).toEqual([
    'claude_ai_Claude_Docs|claude.ai Claude Docs|conectado',
    'claude_ai_Google_Docs|claude.ai Google Docs|conectado',
    'claude_ai_Github_CAJT|claude.ai Github CAJT|autenticacion',
    'context7|context7|deshabilitado',
    'roto|roto|fallo',
    'mycelium|mycelium|conectado',
  ])
  expect(estadoDeLinea('algo raro')).toBe('desconocido')
  expect(claveMcp('claude.ai Claude Docs')).toBe('claude_ai_Claude_Docs')
})

test('las herramientas confirman conectados; nunca marcan desconectado', async () => {
  expect(servidorDeHerramienta('mcp__mycelium__mycelium_abrir')).toBe('mycelium')
  expect(servidorDeHerramienta('Read')).toBeNull()
  const ahora = conectados([
    { name: 'Read', mcp: false },
    { name: 'mcp__mycelium__mycelium_abrir', mcp: true },
    { name: 'mcp__roto__x', mcp: true },
  ])
  expect([...ahora].sort()).toEqual(['mycelium', 'roto'])

  const l = servidoresConocidos(leerMcpList(MCP_LIST), ahora, ['github'], ['perdido'])
  const por = Object.fromEntries(l.map(x => [x.nombre, x.estado]))
  // El listado dice que falló, pero tiene herramientas ahora: conectado.
  expect(por.roto).toBe('conectado')
  // Conectado en el listado y ausente de las herramientas (carga bajo demanda): sigue conectado.
  expect(por.claude_ai_Google_Docs).toBe('conectado')
  // Visto antes y elegido sin datos: a la vista, sin estado.
  expect(por.github).toBe('desconocido')
  expect(por.perdido).toBe('desconocido')
  // Sin listado todavía, solo las herramientas.
  expect(servidoresConocidos(null, ahora, [], []).map(x => x.estado)).toEqual(['conectado', 'conectado'])
  expect(nombreLegible('claude_ai_Gmail')).toBe('claude.ai Gmail')
  expect(alternarMcp({ ...CONFIG_INICIAL, mcps: ['a'] }, 'b').mcps).toEqual(['a', 'b'])
  expect(alternarMcp({ ...CONFIG_INICIAL, mcps: ['a', 'b'] }, 'a').mcps).toEqual(['b'])
})

// ─── el mod en marcha ───────────────────────────────────────────────────────

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

const PANE = {
  plugin: 'mods-config',
  component: 'Pane',
  requestId: 'mods-config',
  props: {
    title: 'Configuración de mods',
    isFocused: true,
    bodyColumns: 120,
    placement: 'inline',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

/** Lo que el fondo registra: lo guardado, los paneles abiertos, los typeperf y las consultas. */
type Registro = { guardado: unknown[]; abiertos: string[]; ahora: string[]; lanzados: string[]; consultasMcp: number }

/**
 * El fondo: el almacén con lo que la prueba diga, las herramientas MCP disponibles,
 * `claude mcp list` con la salida medida, y una RAM al 90 % que typeperf informa.
 */
const fondo = (
  on: On,
  {
    almacen = undefined as unknown,
    herramientas = [] as { name: string; mcp: boolean }[],
    vecino = true,
    arranque = '16597598208\r\n',
    typeperf = `"(PDH-CSV 4.0)","x"\r\n${LINEA(1580)}\r\n`,
  } = {},
) => {
  const r: Registro = { guardado: [], abiertos: [], ahora: [], lanzados: [], consultasMcp: 0 }
  const archivos: Record<string, string> = {}
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('store.get', () => ({ value: almacen as never }))
  on('store.set', ($, e) => {
    r.guardado.push(e.value)

    return { value: undefined }
  })
  on('tool.list', () => ({ value: herramientas as never }))
  on('ui.open', ($, e) => {
    r.abiertos.push(e.id)
    if (!r.ahora.includes(e.id)) r.ahora.push(e.id)

    return { value: { isPlaced: true } }
  })
  on('ui.close', ($, e) => {
    r.ahora = r.ahora.filter(id => id !== e.id)

    return { value: undefined as never }
  })
  on('ui.panes', () => ({
    value: r.ahora.map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) as never,
  }))
  on('env.get', ($, e) => ({ value: (e.name === 'TEMP' ? 'C:\\Temp' : undefined) as never }))
  on('fs.write', ($, e) => {
    archivos[e.path] = e.text

    return { value: undefined }
  })
  on('process.run', ($, e) => {
    if (e.argv[0] === 'reg') return { value: { exitCode: 0, stdout: REG_ES, stderr: '' } as never }
    if (e.argv[0] === 'claude') {
      r.consultasMcp++

      return { value: { exitCode: 0, stdout: MCP_LIST, stderr: '' } as never }
    }

    return { value: { exitCode: 0, stdout: arranque, stderr: '' } as never }
  })
  on('process.spawn', async function* ($, e) {
    const archivo = /-cf (\S+)/.exec(e.argv[3] ?? '')?.[1] ?? ''
    r.lanzados.push((archivos[archivo] ?? '').trim())
    yield { stream: 'stdout' as const, text: typeperf }

    return { value: { code: 0, signal: null } }
  })
  on('ui.render', ($, e) => {
    const { Box, Text } = $.ui.resolve(e)

    // Sin vecino, los otros mods no dibujan nada: una caja vacía.
    return vecino ? <Text>VECINO</Text> : <Box />
  })

  return r
}

test('la línea inferior: ⚙ a la izquierda y la RAM, debajo de los otros mods', async ($, on) => {
  mock.clock(on, { now: 0 })
  fondo(on)
  await $.session.start({ cwd: '/proyecto', surface: 'terminal', isInteractive: true })
  await asentar()

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ key: 'abrir-config' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /90%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /VECINO/ })).toBeDefined()
    // En la misma línea, el ⚙ antes que la RAM.
    const linea = JSON.stringify(await ui.find({ key: 'mods-config-linea-1' }))
    expect(linea.indexOf('mods')).toBeLessThan(linea.indexOf('90%'))
    // El grupo empieza con la línea de separación, del ancho de la franja.
    const grupo = JSON.stringify(await ui.find({ key: 'mods-config-grupo' }))
    expect(grupo).toContain('─'.repeat(120))
    expect(grupo.indexOf('─')).toBeLessThan(grupo.indexOf('⚙ mods'))
    // Sin MCP elegidos, no hay fila de MCP.
    expect(await ui.find({ key: 'mods-config-mcp' })).toBeUndefined()
    await ui.unmount()
  }
})

test('con la RAM y la sesión apagadas en la configuración, no se mide ni se dibuja', async ($, on) => {
  mock.clock(on, { now: 0 })
  const oculto = { franja: false, linea: 2, alineacion: 'derecha', orden: 0, tablero: false }
  const r = fondo(on, { almacen: { version: 2, elementos: { ram: oculto, sesion: { ...oculto, orden: 1 } }, mcps: [] } })
  await $.session.start({ cwd: '/proyecto', surface: 'terminal', isInteractive: true })
  await asentar()

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /RAM/ })).toBeUndefined()
  expect(await ui.find({ key: 'abrir-config' })).toBeDefined()
  await ui.unmount()
  expect(r.lanzados).toEqual([])
})

test('los MCP elegidos se ven en la línea con el estado que informa claude mcp list', async ($, on) => {
  mock.clock(on, { now: 0 })
  fondo(on, {
    almacen: { ram: false, mcps: ['mycelium', 'claude_ai_Google_Docs', 'claude_ai_Github_CAJT', 'perdido'] },
    herramientas: [{ name: 'mcp__mycelium__mycelium_abrir', mcp: true }],
  })
  await $.session.start({ cwd: '/proyecto', surface: 'terminal', isInteractive: true })
  await asentar()

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /● mycelium/ })).toBeDefined()
  // Conectado aunque sus herramientas se carguen bajo demanda.
  expect(await ui.find({ type: 'Text', text: /● claude\.ai Google Docs/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /! claude\.ai Github CAJT/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /○ perdido/ })).toBeDefined()
  // Conectado pero no elegido: no está en la línea.
  expect(await ui.find({ type: 'Text', text: /Claude Docs/ })).toBeUndefined()
  // Los MCP van juntos en su propia fila, no en la del ⚙ y la RAM.
  const filaMcp = JSON.stringify(await ui.find({ key: 'mods-config-mcp' }))
  expect(filaMcp).toContain('mycelium')
  expect(filaMcp).toContain('claude.ai Github CAJT')
  // RAM apagada: la primera línea es la del ⚙; los MCP, en la segunda.
  expect(JSON.stringify(await ui.find({ key: 'mods-config-linea-1' }))).not.toContain('mycelium')
  expect(JSON.stringify(await ui.find({ key: 'mods-config-linea-2' }))).toContain('mycelium')
  await ui.unmount()
})

test('sin persona delante no consulta claude mcp list', async ($, on) => {
  mock.clock(on, { now: 0 })
  const r = fondo(on)
  await $.session.start({ cwd: '/proyecto', surface: 'terminal', isInteractive: false })
  await asentar()
  expect(r.consultasMcp).toBe(0)
})

test('el ⚙ abre el panel; ahí se apaga la RAM y se elige un MCP, y queda guardado', async ($, on) => {
  mock.clock(on, { now: 0 })
  const r = fondo(on)
  await $.session.start({ cwd: '/proyecto', surface: 'terminal', isInteractive: true })
  await asentar()

  const banda = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await banda.press({ key: 'abrir-config' })
  expect(r.abiertos).toEqual(['mods-config'])

  const panel = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await panel.find({ type: 'Text', text: /línea 3 · derecha · 1º/ })).toBeDefined()
  expect(await panel.find({ type: 'Text', text: /\[ \] claude\.ai Google Docs/ })).toBeDefined()
  expect(await panel.find({ type: 'Text', text: /! requiere autenticación/ })).toBeDefined()
  expect(await panel.find({ type: 'Text', text: /⊘ deshabilitado/ })).toBeDefined()

  // Actualizar vuelve a consultar claude mcp list.
  const antes = r.consultasMcp
  await panel.press({ key: 'actualizar-mcp' })
  expect(r.consultasMcp).toBe(antes + 1)

  // Ocultar la RAM: se elige el elemento y se oculta; se guarda y deja de verse.
  await panel.press({ key: 'elegir-ram' })
  await panel.press({ key: 'ver' })
  expect((r.guardado.at(-1) as Guardada).elementos.ram?.franja).toBe(false)
  expect(await banda.find({ type: 'Text', text: /RAM/ })).toBeUndefined()

  // Elegir un MCP: se guarda y aparece en la línea.
  await panel.press({ key: 'opt-mcp-claude_ai_Google_Docs' })
  expect((r.guardado.at(-1) as Guardada).mcps).toEqual(['claude_ai_Google_Docs'])
  expect(await banda.find({ type: 'Text', text: /● claude\.ai Google Docs/ })).toBeDefined()

  // Y se vuelve a quitar.
  await panel.press({ key: 'opt-mcp-claude_ai_Google_Docs' })
  expect((r.guardado.at(-1) as Guardada).mcps).toEqual([])
  await panel.unmount()
  await banda.unmount()
})

test('lo guardado vale en la sesión siguiente', async ($, on) => {
  mock.clock(on, { now: 0 })
  fondo(on, { almacen: { ram: true, mcps: ['claude_ai_Gmail'] }, herramientas: [] })
  await $.session.start({ cwd: '/proyecto', surface: 'terminal', isInteractive: true })
  await asentar()

  const panel = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // Elegido en otra sesión y hoy no configurado: sigue a la vista, sin datos.
  expect(await panel.find({ type: 'Text', text: /\[x\] claude\.ai Gmail/ })).toBeDefined()
  expect(await panel.find({ type: 'Text', text: /○ sin datos/ })).toBeDefined()
  await panel.unmount()
})

test('la RAM sigue midiéndose como en ram-bar: cmd, archivo de contadores y < NUL', async ($, on) => {
  mock.clock(on, { now: 0 })
  const r = fondo(on)
  await $.session.start({ cwd: '/proyecto', surface: 'terminal', isInteractive: true })
  await asentar()
  expect(r.lanzados[0]).toBe('\\Memoria\\Mbytes disponibles')
})

test('la memoria de la sesión: el proceso cuyo id es el de la sesión, en su unidad más grande', async ($, on) => {
  mock.clock(on, { now: 0 })
  const encabezado =
    '"(PDH-CSV 4.0)","\\\\EQUIPO\\Memoria\\Mbytes disponibles","\\\\EQUIPO\\Proceso(claude)\\Id. de proceso",' +
    '"\\\\EQUIPO\\Proceso(claude#1)\\Id. de proceso","\\\\EQUIPO\\Proceso(claude)\\Espacio de trabajo - Privado",' +
    '"\\\\EQUIPO\\Proceso(claude#1)\\Espacio de trabajo - Privado"'
  const fila = '"10/30/2026 10:15:02.123","1580.000000","1200.000000","4242.000000","2000000000.000000","365805568.000000"'
  const r = fondo(on, { arranque: '16597598208 4242 claude\r\n', typeperf: `${encabezado}\r\n${fila}\r\n` })
  await $.session.start({ cwd: '/proyecto', surface: 'terminal', isInteractive: true })
  await asentar()

  // El archivo de contadores pide, además, los del proceso de la sesión.
  expect(r.lanzados[0]).toContain('\\Proceso(claude*)\\Espacio de trabajo - Privado')
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Sesión 349 MB/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /90%/ })).toBeDefined()
  await ui.unmount()
})

// ─── 0.8.0: el tablero lateral ──────────────────────────────────────────────

const TABLERO = { ...PANE, requestId: 'mods-tablero', props: { ...PANE.props, title: 'Mods', placement: 'dock' } } as const

test('t lleva un elemento al tablero: se guarda, el tablero se abre y lo muestra; sacarlo lo cierra', async ($, on) => {
  mock.clock(on, { now: 0 })
  const r = fondo(on)
  await $.session.start({ cwd: '/proyecto', surface: 'terminal', isInteractive: true })
  await asentar()
  expect(r.ahora).not.toContain('mods-tablero')

  const panel = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await panel.press({ key: 'elegir-ram' })
  await panel.press({ key: 'tablero' })
  expect((r.guardado.at(-1) as Guardada).elementos.ram?.tablero).toBe(true)
  // Sigue también en la franja: son dos lugares independientes.
  expect((r.guardado.at(-1) as Guardada).elementos.ram?.franja).toBe(true)
  expect(r.ahora).toContain('mods-tablero')
  expect(await panel.find({ type: 'Text', text: /línea 3 · derecha · 1º · en el tablero/ })).toBeDefined()

  const tablero = await $.ui.mount({ ...TABLERO, surface: 'terminal' })
  const linea = JSON.stringify(await tablero.find({ key: 'mods-tablero-linea-1' }))
  expect(linea).toContain('90%')
  // Lo que no se marcó no está.
  expect(await tablero.find({ key: 'mods-tablero-linea-2' })).toBeUndefined()
  await tablero.unmount()

  // El último que sale cierra el tablero.
  await panel.press({ key: 'tablero' })
  expect((r.guardado.at(-1) as Guardada).elementos.ram?.tablero).toBe(false)
  expect(r.ahora).not.toContain('mods-tablero')
  await panel.unmount()
})

test('con algo marcado, el tablero se abre al iniciar; /tablero lo cierra y lo vuelve a abrir', async ($, on) => {
  mock.clock(on, { now: 0 })
  const r = fondo(on, {
    almacen: {
      version: 2,
      elementos: { sesion: { franja: false, linea: 2, alineacion: 'derecha', orden: 1, tablero: true } },
      mcps: [],
    },
  })
  await $.session.start({ cwd: '/proyecto', surface: 'terminal', isInteractive: true })
  await asentar()
  expect(r.ahora).toContain('mods-tablero')

  const cerrar = await $.command.run({ command: 'tablero', args: '', origin: 'user' } as never)
  expect(cerrar.text).toBe('Tablero cerrado.')
  expect(r.ahora).not.toContain('mods-tablero')
  const abrir = await $.command.run({ command: 'tablero', args: '', origin: 'user' } as never)
  expect(abrir.text).toBe('Tablero abierto.')
  expect(r.ahora).toContain('mods-tablero')
})

test('con m se edita el tablero: las mismas teclas mueven ahí sin tocar la franja', async ($, on) => {
  mock.clock(on, { now: 0 })
  const r = fondo(on)
  await $.session.start({ cwd: '/proyecto', surface: 'terminal', isInteractive: true })
  await asentar()

  const panel = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // La RAM y el ⚙ al tablero: cada uno en su línea.
  await panel.press({ key: 'elegir-ram' })
  await panel.press({ key: 'tablero' })
  await panel.press({ key: 'elegir-config' })
  await panel.press({ key: 'tablero' })

  await panel.press({ key: 'editando' })
  expect(await panel.find({ type: 'Text', text: /\[el tablero\]/ })).toBeDefined()
  // El ⚙ sube a la línea de la RAM, a la derecha.
  await panel.press({ key: 'subir' })
  await panel.press({ key: 'derecha' })
  const g = (r.guardado.at(-1) as { elementos: Record<string, { linea: number; alineacion: string; enTablero: { linea: number; alineacion: string } }> }).elementos
  expect(g.config?.enTablero).toEqual({ linea: g.ram?.enTablero.linea, alineacion: 'derecha', orden: 0 })
  // En la franja, el ⚙ sigue donde estaba.
  expect(g.config).toMatchObject({ linea: 2, alineacion: 'izquierda' })

  const tablero = await $.ui.mount({ ...TABLERO, surface: 'terminal' })
  const linea = JSON.stringify(await tablero.find({ key: 'mods-tablero-linea-1' }))
  expect(linea.indexOf('90%')).toBeLessThan(linea.indexOf('⚙ mods'))
  await tablero.unmount()
  await panel.unmount()
})

test('el tablero vacío dice cómo llenarlo', async ($, on) => {
  mock.clock(on, { now: 0 })
  fondo(on)
  await $.session.start({ cwd: '/proyecto', surface: 'terminal', isInteractive: true })
  await asentar()
  const tablero = await $.ui.mount({ ...TABLERO, surface: 'terminal' })
  expect(await tablero.find({ type: 'Text', text: /pulse t/ })).toBeDefined()
  await tablero.unmount()
})

test('en una sesión sin persona delante no mide', async ($, on) => {
  mock.clock(on, { now: 0 })
  const r = fondo(on)
  await $.session.start({ cwd: '/proyecto', surface: 'terminal', isInteractive: false })
  await asentar()
  expect(r.lanzados).toEqual([])
})

// ─── 0.3.0: una separación arriba de todo ───────────────────────────────────

test('tieneContenido: un texto cuenta; cajas vacías, no', async () => {
  expect(tieneContenido(null)).toBe(false)
  expect(tieneContenido({ type: 'Box' })).toBe(false)
  expect(tieneContenido({ type: 'Box', children: [{ type: 'Box', children: ['  '] }] })).toBe(false)
  expect(tieneContenido({ type: 'Box', children: [{ type: 'Text', children: ['ASDD'] }] })).toBe(true)
  expect(tieneContenido({ type: 'Button', props: { label: 'Panel' } })).toBe(true)
})

test('una separación arriba de todo aparta los mods del chat', async ($, on) => {
  mock.clock(on, { now: 0 })
  fondo(on)
  await $.session.start({ cwd: '/proyecto', surface: 'terminal', isInteractive: true })
  await asentar()

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ key: 'mods-config-separacion-superior' })).toBeDefined()
    // Arriba de lo que dibujan los otros mods, y la del grupo, debajo de ellos.
    const todo = JSON.stringify(await ui.find({ key: 'mods-config-separacion-superior' }))
    expect(todo).toContain('─'.repeat(120))
    await ui.unmount()
  }
})

test('si los otros mods no dibujan nada, no hay separación de arriba', async ($, on) => {
  mock.clock(on, { now: 0 })
  fondo(on, { vecino: false })
  await $.session.start({ cwd: '/proyecto', surface: 'terminal', isInteractive: true })
  await asentar()

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ key: 'mods-config-separacion-superior' })).toBeUndefined()
  // La del grupo sigue.
  expect(JSON.stringify(await ui.find({ key: 'mods-config-grupo' }))).toContain('─'.repeat(120))
  await ui.unmount()
})

// ─── etapa 1: la disposición desde el panel ─────────────────────────────────

test('desde el panel: la RAM al centro, y después a otra línea; queda guardado', async ($, on) => {
  mock.clock(on, { now: 0 })
  const r = fondo(on)
  await $.session.start({ cwd: '/proyecto', surface: 'terminal', isInteractive: true })
  await asentar()

  const banda = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const panel = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await panel.press({ key: 'elegir-ram' })
  expect(await panel.find({ type: 'Text', text: /Mover «Memoria RAM»/ })).toBeDefined()

  // Al centro: la línea pasa a tres zonas, con la RAM en la del medio.
  await panel.press({ key: 'centro' })
  expect((r.guardado.at(-1) as Guardada).elementos.ram?.alineacion).toBe('centro')
  expect(await panel.find({ type: 'Text', text: /línea 3 · centro · 1º/ })).toBeDefined()
  const linea1 = JSON.stringify(await banda.find({ key: 'mods-config-linea-1' }))
  expect(linea1).toContain('"justifyContent":"center"')
  expect(linea1).toContain('90%')

  // Bajarla de línea: la primera queda solo con el ⚙ y la RAM pasa a la segunda.
  await panel.press({ key: 'bajar' })
  expect((r.guardado.at(-1) as Guardada).elementos.ram?.linea).toBe(3)
  expect(JSON.stringify(await banda.find({ key: 'mods-config-linea-1' }))).not.toContain('90%')
  expect(JSON.stringify(await banda.find({ key: 'mods-config-linea-2' }))).toContain('90%')

  // El ⚙ no se puede ocultar: no tiene la acción.
  await panel.press({ key: 'elegir-config' })
  expect(await panel.find({ key: 'ver' })).toBeUndefined()

  await panel.unmount()
  await banda.unmount()
})
