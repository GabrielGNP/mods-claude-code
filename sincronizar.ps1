# Trae al repositorio la versión del mod que está en desarrollo en ~/.claude/mods/mods-config,
# corre sus pruebas y muestra la versión, lista para commitear y etiquetar.
#
#   .\sincronizar.ps1
#
# Después: git add -A ; git commit -m "mods-config X.Y.Z: ..." ; git tag vX.Y.Z ; git push --follow-tags

$ErrorActionPreference = 'Stop'
$origen = Join-Path $env:USERPROFILE '.claude\mods\mods-config'
$destino = Join-Path $PSScriptRoot 'mods-config'

if (-not (Test-Path (Join-Path $origen '.claude-plugin\plugin.json'))) { throw "No está el mod en $origen" }

# /MIR deja el destino idéntico al origen, sin los archivos que Claude Code genera al cargarlo.
robocopy $origen $destino /MIR /XD types /XF tsconfig.json /NFL /NDL /NJH /NJS | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy falló con código $LASTEXITCODE" }
# robocopy excluye cualquier carpeta 'types': la del mod se copia aparte.
robocopy (Join-Path $origen 'types') (Join-Path $destino 'types') /MIR /NFL /NDL /NJH /NJS | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy falló con código $LASTEXITCODE" }

claude plugin validate $destino
claude plugin test $destino
if ($LASTEXITCODE -ne 0) { throw 'Las pruebas fallaron: no publique esta versión.' }

$version = (Get-Content (Join-Path $destino '.claude-plugin\plugin.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
$etiquetas = git -C $PSScriptRoot tag --list "v$version"
if ($etiquetas) { Write-Warning "La versión $version ya está publicada (v$version). Suba la versión en plugin.json antes de publicar." }
else { Write-Host "Listo para publicar la versión $version." }
git -C $PSScriptRoot status --short
