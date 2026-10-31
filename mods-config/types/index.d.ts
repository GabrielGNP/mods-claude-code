/** Qué sabe la línea de la memoria del equipo. */
export type EstadoRam =
  /** Todavía no llegó la primera lectura, o la RAM está apagada. */
  | { kind: 'esperando' }
  /** La última lectura: MB libres, y el total si se pudo saber. */
  | { kind: 'lectura'; libreMB: number; totalMB: number | null }
  /** No se pudo medir: ningún contador funcionó en este equipo. */
  | { kind: 'no disponible' }

/** Qué se sabe de la ventana de contexto de la sesión principal. */
export type ContextView =
  /** Todavía no hubo ninguna medición: el elemento no se dibuja. */
  | { kind: 'none' }
  /** Se compactó o se vació: la cifra anterior ya no vale y no hay otra todavía. */
  | { kind: 'measuring' }
  | {
      kind: 'ready'
      /** Porcentaje entero 0–100 de la ventana en uso. */
      percent: number
      /** Tokens en uso. */
      tokens: number
      /** La ventana contra la que se mide, en tokens. */
      window: number
      /** true cuando sale del desglose estimado, no de una respuesta de la API. */
      estimated: boolean
    }

/** Lo que se está diciendo en este momento, para el elemento de voz. */
export type Hablando = {
  /** La frase completa, para mostrarla recortada al lado del ícono. */
  texto: string
  /** Si se puede cortar: las dos vías (edge-tts y la voz de Windows) corren en un proceso que se mata. */
  detenible: boolean
}

/** Dónde va un elemento dentro de su línea. */
export type Alineacion = 'izquierda' | 'centro' | 'derecha'

/** Dónde se ve un elemento: en la franja sobre el chat, y en el tablero lateral. */
export type Ubicacion = {
  /** Si se ve en la franja. */
  franja: boolean
  /** La línea de la franja, desde 0, de arriba hacia abajo. */
  linea: number
  alineacion: Alineacion
  /** El orden entre los de su misma línea y alineación, desde 0. */
  orden: number
  /** Si se ve en el tablero lateral. */
  tablero: boolean
}

/**
 * Lo que la persona eligió en el panel. Se guarda en el almacén del mod, que es por
 * usuario: vale en todas las sesiones y en todos los proyectos.
 */
export type Config = {
  version: 2
  /** La ubicación de cada elemento, por su id. */
  elementos: Record<string, Ubicacion>
  /** Los servidores MCP cuyo estado se muestra, por nombre. */
  mcps: string[]
}

/** El estado de un servidor MCP, como lo informa `claude mcp list`. */
export type EstadoMcp = 'conectado' | 'autenticacion' | 'deshabilitado' | 'fallo' | 'desconocido'

/**
 * Un servidor MCP que el mod conoce. `nombre` es la clave, con la forma que tiene en el
 * nombre de sus herramientas (`claude_ai_Gmail`); `etiqueta`, como lo muestra Claude
 * Code (`claude.ai Gmail`).
 */
export type ServidorMcp = { nombre: string; etiqueta: string; estado: EstadoMcp }

declare module 'claude-code' {
  interface PluginState {
    'mods-config': {
      ram: EstadoRam
      /** La memoria que ocupa el proceso de esta sesión, en bytes; null sin lectura. */
      sesion: number | null
      config: Config
      mcps: ServidorMcp[]
      /** Si se está consultando `claude mcp list` ahora. */
      consultandoMcp: boolean
      /** El elemento elegido en el panel, sobre el que actúan las teclas de mover. */
      seleccion: string
      /** La ventana de contexto de la sesión principal. */
      contexto: ContextView
      /** El modelo del loop principal, como lo muestra `/model`; null si no se pudo leer. */
      modelo: string | null
      /**
       * Las ventanas de límite de uso que informó la última respuesta. Vacío sin
       * suscripción o antes de la primera lectura.
       */
      limites: { kind: string; percentUsed: number; resetsAt?: string }[]
      /**
       * El último pedido al modelo de cada loop, por id de agente (`''` es la sesión
       * principal): qué modelo respondió y cuántos tokens ocupaba.
       */
      pasos: Record<string, { model: string; tokens: number }>
      /** Lo que se está diciendo; null en silencio. */
      hablando: Hablando | null
    }
  }
}
