import { expect, test } from 'claude-code/testing'

import {
  archivoDeJuego,
  columnasDe,
  juegosCandidatos,
  leerArranque,
  leerCsv,
  lecturaDeFila,
  tamano,
} from '../hooks/ram'

// Los nombres del registro de un Windows en español, como los lee el mod.
const NOMBRES = new Map([
  ['4', 'Memoria'],
  ['1382', 'Mbytes disponibles'],
  ['230', 'Proceso'],
  ['784', 'Id. de proceso'],
  ['1478', 'Espacio de trabajo - Privado'],
])

// Encabezado y fila reales de `typeperf`, medidos el 2026-10-30 (con dos sesiones abiertas).
const ENCABEZADO =
  '"(PDH-CSV 4.0)","\\\\EQUIPO\\Memoria\\Mbytes disponibles","\\\\EQUIPO\\Proceso(claude)\\Id. de proceso",' +
  '"\\\\EQUIPO\\Proceso(claude#1)\\Id. de proceso","\\\\EQUIPO\\Proceso(claude)\\Espacio de trabajo - Privado",' +
  '"\\\\EQUIPO\\Proceso(claude#1)\\Espacio de trabajo - Privado"'
const FILA = '"10/30/2026 10:15:02.123","3120.000000","1200.000000","30664.000000","120000000.000000","365805568.000000"'

test('tamano usa solo la unidad más grande', () => {
  expect(tamano(512 * 1024)).toBe('512 KB')
  expect(tamano(349 * 1024 * 1024)).toBe('349 MB')
  expect(tamano(1.25 * 1024 ** 3)).toBe('1,3 GB')
  expect(tamano(1024 ** 3)).toBe('1,0 GB')
})

test('leerArranque toma total, id y nombre de la sesión', () => {
  expect(leerArranque('16597598208 30664 claude\r\n')).toEqual({ totalMB: 16597598208 / 1024 / 1024, pid: 30664, proceso: 'claude' })
  expect(leerArranque('16597598208')).toEqual({ totalMB: 16597598208 / 1024 / 1024, pid: null, proceso: null })
})

test('juegosCandidatos arma el traducido con el proceso y deja el inglés de respaldo', () => {
  const [es, en] = juegosCandidatos(NOMBRES, 'claude')
  expect(es?.memoria).toBe('\\Memoria\\Mbytes disponibles')
  expect(archivoDeJuego(es!)).toBe(
    '\\Memoria\\Mbytes disponibles\r\n\\Proceso(claude*)\\Id. de proceso\r\n\\Proceso(claude*)\\Espacio de trabajo - Privado\r\n',
  )
  expect(en?.proceso?.privado).toBe('Working Set - Private')
  // Sin saber el proceso, solo la memoria del equipo.
  expect(archivoDeJuego(juegosCandidatos(NOMBRES, null)[0]!)).toBe('\\Memoria\\Mbytes disponibles\r\n')
})

test('lecturaDeFila toma la columna cuyo id es el de la sesión', () => {
  const [es] = juegosCandidatos(NOMBRES, 'claude')
  const cols = columnasDe(leerCsv(ENCABEZADO)!, es!)
  expect(cols.memoria).toBe(1)
  expect(lecturaDeFila(leerCsv(FILA)!, cols, 30664)).toEqual({ libreMB: 3120, sesionBytes: 365805568 })
  expect(lecturaDeFila(leerCsv(FILA)!, cols, 1200)).toEqual({ libreMB: 3120, sesionBytes: 120000000 })
  // Un id que no está, o sin id: la memoria del equipo sigue valiendo.
  expect(lecturaDeFila(leerCsv(FILA)!, cols, 999)).toEqual({ libreMB: 3120, sesionBytes: null })
  expect(lecturaDeFila(leerCsv(FILA)!, cols, null)).toEqual({ libreMB: 3120, sesionBytes: null })
})

test('lecturaDeFila descarta filas sin lectura', () => {
  const [es] = juegosCandidatos(NOMBRES, 'claude')
  const cols = columnasDe(leerCsv(ENCABEZADO)!, es!)
  expect(lecturaDeFila(leerCsv('"10/30/2026 10:15:07.123"," "," "," "," "," "')!, cols, 30664)).toBeNull()
  expect(leerCsv('Saliendo, espere...')).toBeNull()
})
