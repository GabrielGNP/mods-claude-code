# Abre una sesión de Claude Code con el mod de ESTE repositorio en lugar del instalado.
#
#   .\probar.ps1                    # sesión interactiva
#   .\probar.ps1 --resume           # cualquier argumento extra va a claude
#
# Solo esa sesión usa la copia en desarrollo: el motor la antepone a la instalada
# («Plugin "mods-config" from --plugin-dir overrides installed version»), y las demás
# sesiones siguen con la versión instalada desde GitHub.
#
# La copia en desarrollo se recarga sola al terminar el turno que guardó un cambio.
# Guarda su configuración aparte (como mods-config@inline): mover elementos en el panel
# durante una prueba no cambia la disposición de la instalación real.

$mod = Join-Path $PSScriptRoot 'mods-config'
claude --plugin-dir $mod @args
