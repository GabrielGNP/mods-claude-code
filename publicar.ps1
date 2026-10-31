# Publica la versión que está en mods-config/.claude-plugin/plugin.json: valida, corre las
# pruebas, commitea, etiqueta y sube. Se detiene en el primer paso que falla.
#
#   .\publicar.ps1 -Mensaje "qué cambia en esta versión"
#
# Antes: subir "version" en el plugin.json. Sin cambio de versión, `claude plugin update`
# no ve nada nuevo, y este script se niega a publicar.

param([Parameter(Mandatory)][string]$Mensaje)

$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
$mod = Join-Path $repo 'mods-config'

$version = (Get-Content (Join-Path $mod '.claude-plugin\plugin.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
$tag = "v$version"

git -C $repo fetch --tags --quiet
if (git -C $repo tag --list $tag) { throw "La versión $version ya está publicada ($tag). Suba la versión en plugin.json." }
if (git -C $repo status --porcelain --branch | Select-String 'behind') { throw 'El repositorio está atrasado respecto de GitHub: corra git pull primero.' }

claude plugin validate $repo
if ($LASTEXITCODE -ne 0) { throw 'El marketplace no valida.' }
claude plugin validate $mod
if ($LASTEXITCODE -ne 0) { throw 'El mod no valida.' }
claude plugin test $mod
if ($LASTEXITCODE -ne 0) { throw 'Las pruebas fallaron: no se publica.' }

git -C $repo add -A
git -C $repo commit -m "mods-config ${version}: $Mensaje"
if ($LASTEXITCODE -ne 0) { throw 'No se pudo commitear (¿no hay cambios?).' }
git -C $repo tag -a $tag -m "mods-config $version"
git -C $repo push --follow-tags
if ($LASTEXITCODE -ne 0) { throw 'No se pudo subir a GitHub. El commit y el tag quedaron locales: repita git push --follow-tags.' }

Write-Host "Publicada $tag. Para instalarla en este equipo:"
Write-Host '  claude plugin marketplace update mods-claude-code'
Write-Host '  claude plugin update mods-config@mods-claude-code'
