$ErrorActionPreference = 'Stop'
$washPython = 'C:\ProgramData\NovaFlow\AI-Runtime\engine\python\python.exe'
$washRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $washRoot
$common = @('tools/wan-wash-reference-smoke.py','--production-size','--reference','0','--reference-mode','flowedit','--steps','7','--shift','8','--source-cfg','1','--target-cfg','1','--distilled','--reserve-vram','7','--node')
& $washPython @common --strengths '.2,.65' --output docs/image-wash-q5-flowedit/anime-distilled-range *> .tmp-wan-flowedit-anime-distilled-range.log
if ($LASTEXITCODE) { throw 'Anime validation failed' }
& $washPython @common --strength '.9' --source 'C:/ProgramData/NovaFlow/AI-Runtime/engine/python/Lib/site-packages/skimage/data/coffee.png' --profile docs/image-wash-q5-flowedit/coffee-analysis-trim/style-profile.json --output docs/image-wash-q5-flowedit/coffee-distilled *> .tmp-wan-flowedit-coffee-distilled.log
if ($LASTEXITCODE) { throw 'Photography validation failed' }
& $washPython @common --strength '.9' --source docs/object-transfer-integration/reference-cutout.png --profile docs/image-wash-q5-flowedit/cg-analysis/style-profile.json --output docs/image-wash-q5-flowedit/cg-distilled *> .tmp-wan-flowedit-cg-distilled.log
if ($LASTEXITCODE) { throw 'CG validation failed' }
'success' | Set-Content -LiteralPath .tmp-wan-flowedit-distilled-validation-status.txt
