# mods-config — la línea inferior y la configuración de los mods

El último grupo de la franja sobre el prompt. Una línea arriba de todo aparta la franja
del chat (solo si otros mods dibujan algo), y otra separa este grupo de lo de los demás:

```
──────────────────────────────────────────────────────────────────────────────────────
ASDD ▪▪◆▫▫▫ design · FULL · acceso-kyc                       <línea de asdd-estado>
<otros mods>
──────────────────────────────────────────────────────────────────────────────────────
⚙ mods                      RAM ████████████████░░░░  82%  12,7 / 15,5 GB   Sesión 349 MB
  ● mycelium   ● claude.ai Google Docs   ! claude.ai Github CAJT
```

- **`⚙ mods`**, a la izquierda: un clic, o `/mods-config`, abre el panel de configuración.
- **La memoria RAM** del equipo, a la derecha, medida con `typeperf` de Windows (unos
  18 MB y CPU prácticamente nula).
- **La memoria de la sesión**, al lado: lo que ocupa el proceso de esta sesión de Claude Code,
  en una sola unidad, la más grande que alcance (512 KB, 349 MB, 1,2 GB). Es el espacio de
  trabajo privado, la cifra que el Administrador de tareas muestra como «Memoria», y sale del
  mismo 	ypeperf que la RAM. Con varias sesiones abiertas, cada una muestra la suya.
- **Los servidores MCP** que se marquen, juntos en la línea de abajo (si son muchos,
  siguen en la siguiente), con su estado: `●` conectado, `!` requiere autenticación,
  `⊘` deshabilitado, `✘` falló, `○` sin datos. Sin ninguno marcado, esa línea no aparece.

## La voz

Al terminar cada turno de la sesión principal, Claude dice en voz alta un resumen de una
oración («Terminé en ASDD. …»), hecho por Haiku; cuando pregunta (`AskUserQuestion`), lee
la pregunta, sin las opciones. Usa la voz neuronal de **edge-tts** (`py -m pip install
edge-tts`) y, sin ella, la voz de Windows. Mientras habla, el elemento **Voz** muestra
`🔊` con lo que dice: un clic en el ícono, la tecla `1` con la franja enfocada, o
`/callar`, la cortan. No habla por los subagentes, ni en un `claude -p`.

Si se escucha la voz de Windows en lugar de la neuronal, Microsoft suele haber cambiado
su servicio: `py -m pip install --upgrade edge-tts`. El detalle de la última vez que
habló está en `%TEMP%\cc-voz\diagnostico.json`.

## El panel: dónde va cada elemento

Cada pieza que el mod dibuja es un **elemento** (`⚙`, RAM, memoria de la sesión, servidores MCP), con su
propia ubicación: **línea**, **alineación** (izquierda, centro o derecha) y **orden**
dentro de esa alineación. En el panel se elige uno y se mueve:

| Para | Tecla |
|---|---|
| Elegir qué se edita: la franja o el tablero | `m` |
| Elegir un elemento | `1`–`9` |
| Subir o bajar de línea | `s` / `b` (bajar desde la última abre una línea nueva) |
| Alinear a la izquierda, al centro o a la derecha | `i` / `c` / `d` |
| Antes o después dentro de su alineación | `a` / `l` |
| Mostrar u ocultar (el `⚙` no se oculta) | `v` |
| Llevar al tablero lateral, o sacarlo | `t` |
| Abrir o cerrar el tablero lateral | `p` |
| Volver a consultar el estado de los MCP | `r` |
| Cerrar | `x` o `Esc` |

Los servidores MCP a mostrar se marcan con un clic, o con `Tab` y `Enter`. Las teclas
son letras y números porque un mod no puede usar las flechas: el motor las usa para
moverse entre los botones.

Una línea sin nada al centro reparte izquierda y derecha en los extremos; con algo al
centro, se divide en tres zonas iguales. Las líneas que quedan vacías se cierran.

**La configuración se guarda por usuario**, en el almacén del mod dentro de la
configuración de Claude Code: vale en todas las sesiones y en todos los proyectos.

## El tablero lateral

Un panel aparte con los elementos que se marquen con `t`. Un elemento puede estar en la
franja, en el tablero o en los dos, y en cada lugar tiene **su propia posición**: con `m`
el panel pasa a editar el tablero, y las mismas teclas (`s`/`b`, `i`/`c`/`d`, `a`/`l`) lo
acomodan ahí sin tocar la franja. Un elemento que entra al tablero llega en una línea
nueva, al final.

- En pantalla completa y desde 110 columnas, el tablero va **al costado de la
  conversación**; en una terminal más angosta, **sobre el prompt**.
- Se abre solo al marcar el primer elemento, y se cierra al sacar el último.
- Al iniciar una sesión se abre solo si tiene algo marcado. Cuando lo abre el mod por su
  cuenta, Claude Code lo dibuja desde 144 columnas (110 si alguna vez se abrió a mano);
  más angosto, espera a que se abra con `/tablero`.
- `/tablero`, o `p` en el panel, lo abren o lo cierran.

## Cómo sabe el estado de los MCP

El motor no le da a un mod la lista de servidores MCP. Hay dos fuentes:

- `claude mcp list`, la completa: todos los servidores configurados y su estado. Tarda
  unos 6 s y 1,2 s de CPU, así que se consulta al iniciar la sesión, al abrir el panel,
  con `r` y cada 5 minutos.
- Las herramientas que el modelo tiene disponibles, cada 10 s y sin costo: confirman que
  un servidor está conectado. Los servidores cuyas herramientas se cargan bajo demanda no
  aparecen ahí, así que su ausencia no significa que estén desconectados.

## Orden en la franja

Para que esta sea la **última** línea, el mod tiene que ser el **primero** de
`enabledPlugins` en `~/.claude/settings.json`: los mods se apilan en ese orden, y el
primero queda abajo de todo.

## Pruebas

```powershell
claude plugin validate .\mods-config
claude plugin test .\mods-config
```
