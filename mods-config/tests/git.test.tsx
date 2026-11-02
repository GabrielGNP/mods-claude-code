import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { distancia, leerEstado, textoCambios } from '../hooks/git'

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

const INICIO = { cwd: '/proyecto', surface: 'terminal', isInteractive: false } as const

const EN_MAIN = [
  '# branch.oid 1a2b3c4d5e6f',
  '# branch.head main',
  '# branch.upstream origin/main',
  '# branch.ab +2 -1',
  '1 .M N... 100644 100644 100644 aaa bbb hooks/a.ts',
  '2 R. N... 100644 100644 100644 aaa bbb R100 b.ts\tviejo.ts',
  '? nuevo.md',
  '',
].join('\n')

/**
 * El fondo: el almacén con lo que la prueba diga y git contestando lo que diga
 * `respuesta` (fuera de un repo sale 128). Cuenta cuántas veces se le preguntó a git.
 */
const fondo = (on: On, respuesta: { salida: string; codigo?: number }, almacen: unknown = undefined) => {
  const r = { consultasGit: 0 }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('store.get', () => ({ value: almacen as never }))
  on('store.set', () => ({ value: undefined }))
  on('tool.list', () => ({ value: [] as never }))
  on('process.run', ($, e) => {
    if (e.argv[0] !== 'git') return { value: { exitCode: 1, stdout: '', stderr: '' } as never }
    r.consultasGit++

    return { value: { exitCode: respuesta.codigo ?? 0, stdout: respuesta.salida, stderr: '' } as never }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>VECINO</Text>
  })

  return r
}

test('la rama, la distancia a la remota y los cambios salen del estado de git', async () => {
  expect(leerEstado(EN_MAIN)).toEqual({ rama: 'main', desacoplada: false, conUpstream: true, adelante: 2, atras: 1, cambios: 3 })
  const suelto = leerEstado('# branch.oid 1a2b3c4d5e6f\n# branch.head (detached)\n')
  expect(suelto).toMatchObject({ rama: '1a2b3c4', desacoplada: true })
  expect(leerEstado('# branch.oid (initial)\n# branch.head nueva\n')).toMatchObject({ rama: 'nueva', conUpstream: false, cambios: 0 })
  expect(leerEstado('')).toBeNull()
})

test('la distancia y los cambios se escriben como se leen', async () => {
  const base = { rama: 'm', desacoplada: false, conUpstream: true, cambios: 0 }
  expect(distancia({ ...base, adelante: 2, atras: 1 })).toBe('↑2 ↓1')
  expect(distancia({ ...base, adelante: 0, atras: 3 })).toBe('↓3')
  expect(distancia({ ...base, adelante: 0, atras: 0 })).toBe('')
  expect(textoCambios(0)).toBe('limpio')
  expect(textoCambios(1)).toBe('1 cambio')
  expect(textoCambios(4)).toBe('4 cambios')
})

test('en un repo, el elemento Git va al lado del ⚙ con rama, distancia y cambios', async ($, on) => {
  mock.clock(on, { now: 0 })
  fondo(on, { salida: EN_MAIN })
  await $.session.start(INICIO)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    const git = JSON.stringify(await ui.find({ key: 'mods-config-git' }))
    expect(git).toContain('main')
    expect(git).toContain('↑2 ↓1')
    expect(git).toContain('3 cambios')
    // En la línea del ⚙, después de él.
    const linea = JSON.stringify(await ui.find({ key: 'mods-config-linea-1' }))
    expect(linea.indexOf('⚙ mods')).toBeLessThan(linea.indexOf('main'))
    await ui.unmount()
  }
})

test('fuera de un repo, el elemento no aparece', async ($, on) => {
  mock.clock(on, { now: 0 })
  fondo(on, { salida: '', codigo: 128 })
  await $.session.start(INICIO)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ key: 'mods-config-git' })).toBeUndefined()
  expect(await ui.find({ key: 'abrir-config' })).toBeDefined()
  await ui.unmount()
})

test('un cambio de rama aparece con el latido, sin esperar al turno', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const respuesta = { salida: EN_MAIN }
  fondo(on, respuesta)
  await $.session.start(INICIO)

  respuesta.salida = '# branch.oid 1a2b3c4\n# branch.head otra\n'
  await clock.advance(15_000)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const git = JSON.stringify(await ui.find({ key: 'mods-config-git' }))
  expect(git).toContain('otra')
  expect(git).toContain('limpio')
  expect(git).toContain('sin remota')
  await ui.unmount()
})

test('oculto en la franja y fuera del tablero, no se le pregunta a git', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const oculto = { franja: false, linea: 2, alineacion: 'izquierda', orden: 1, tablero: false }
  const r = fondo(on, { salida: EN_MAIN }, { version: 2, elementos: { modelo: { franja: true, linea: 0, alineacion: 'izquierda', orden: 0, tablero: false }, git: oculto }, mcps: [] })
  await $.session.start(INICIO)
  await clock.advance(30_000)

  expect(r.consultasGit).toBe(0)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ key: 'mods-config-git' })).toBeUndefined()
  await ui.unmount()
})
