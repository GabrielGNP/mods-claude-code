# mods-claude-code

Mods de [Claude Code](https://claude.com/claude-code) para **Windows**. Por ahora, uno:

**mods-config**: una franja configurable sobre el prompt.

```
──────────────────────────────────────────────────────────────────────────────────────
opus 4.x                                                     5h ██████░░░░  58%  2h 10m
Contexto [████████░░░░░░░░░░░░]  41%  82k / 200k            7d ███░░░░░░░  31%  3d 4h
⚙ mods                      RAM ████████████████░░░░  82%  12,7 / 15,5 GB   Sesión 349 MB
  ● mycelium   ● claude.ai Google Docs   ! claude.ai Github
```

- el **modelo**, la **ventana de contexto** y los **límites de uso** de 5 h y 7 d;
- la **RAM del equipo** y la **memoria que ocupa la sesión** (con sus subagentes);
- el **estado de los servidores MCP** que se elijan;
- una **voz** que resume en una oración lo que hizo Claude al terminar cada turno.

Cada elemento se ubica desde el panel `⚙ mods`: en qué línea, a la izquierda, al centro o
a la derecha, en qué orden, o se oculta. La configuración se guarda por usuario y vale en
todas las sesiones. El detalle está en [`mods-config/README.md`](mods-config/README.md).

## Requisitos

- **Windows 10 u 11.** La memoria se mide con `typeperf` y la voz usa PowerShell.
- Claude Code con soporte de mods (`claude plugin --help` muestra `marketplace`).
- Opcional, para una voz neuronal: `py -m pip install edge-tts`. Sin él, usa la voz de Windows.

## Instalar

Una sola vez, en PowerShell:

```powershell
claude plugin marketplace add GabrielGNP/mods-claude-code
claude plugin install mods-config@mods-claude-code --scope user
```

Después, en una sesión ya abierta, `/reload-plugins`; o abra una sesión nueva.

Para que la franja quede **abajo de todo**, `mods-config` tiene que ser el **primero** de
`enabledPlugins` en `~/.claude/settings.json`: los mods se apilan en ese orden y el primero
queda al fondo.

## Actualizar

Cuando haya una versión nueva:

```powershell
claude plugin marketplace update mods-claude-code
claude plugin update mods-config@mods-claude-code
```

Y `/reload-plugins` en las sesiones abiertas. La versión instalada se ve con
`claude plugin list`; las publicadas, en las [etiquetas del repositorio](https://github.com/GabrielGNP/mods-claude-code/tags).

## Desinstalar

```powershell
claude plugin uninstall mods-config@mods-claude-code
claude plugin marketplace remove mods-claude-code
```

## Publicar una versión nueva (para quien mantiene el repositorio)

El mod se desarrolla en `~/.claude/mods/mods-config`, instalado desde un marketplace local.
Para publicar:

1. Subir `version` en `mods-config/.claude-plugin/plugin.json` del mod en desarrollo.
   **Sin cambio de versión, `claude plugin update` no ve nada nuevo.**
2. Traer el mod al repositorio, validarlo y correr sus pruebas:

   ```powershell
   .\sincronizar.ps1
   ```

3. Commitear, etiquetar y subir:

   ```powershell
   git add -A
   git commit -m "mods-config X.Y.Z: <qué cambia>"
   git tag vX.Y.Z
   git push --follow-tags
   ```

## Licencia

[MIT](LICENSE).
