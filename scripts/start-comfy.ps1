#!/usr/bin/env pwsh
# Lancement ComfyUI - Windows (PowerShell), jumeau de start-comfy.sh
#
# Usage :
#   .\start-comfy.ps1              -> backend SDPA (recommande, a mesurer)
#   .\start-comfy.ps1 split        -> backend split (repli si saturation memoire)
#   .\start-comfy.ps1 subquad      -> backend sub-quadratique (l'ancien, le plus lent)
#   .\start-comfy.ps1 sdpa local   -> ecoute sur 127.0.0.1 au lieu de Tailscale
#
# Chemins surchargeables par variables d'environnement (adapter a votre install ;
# il n'existe pas de defaut universel sous Windows) :
#   $env:COMFY_DIR="C:\ComfyUI"; $env:VENV_PY="C:\ComfyUI\.venv\Scripts\python.exe"; `
#     $env:BASE_DIR="C:\ComfyUI-data"; .\start-comfy.ps1

param(
  [string]$Attention = "sdpa",
  [string]$Listen = "tailscale"
)

$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Chemins (surchargeables par variables d'environnement)
# ---------------------------------------------------------------------------
$ComfyDir = if ($env:COMFY_DIR) { $env:COMFY_DIR } else { "$env:USERPROFILE\ComfyUI" }
$VenvPy   = if ($env:VENV_PY)   { $env:VENV_PY }   else { "$env:USERPROFILE\ComfyUI\.venv\Scripts\python.exe" }
$BaseDir  = if ($env:BASE_DIR)  { $env:BASE_DIR }  else { "$env:USERPROFILE\ComfyUI" }
$Port     = if ($env:PORT)      { $env:PORT }      else { "8188" }

# ---------------------------------------------------------------------------
# Pas de variables MPS : MPS est le backend Metal d'Apple Silicon. Sous Windows
# c'est CUDA (NVIDIA) ou le CPU ; PyTorch choisit tout seul, rien a exporter.
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Backend d'attention - LE reglage a mesurer
# ---------------------------------------------------------------------------
switch ($Attention) {
  "sdpa"    { $AttentionFlag = "--use-pytorch-cross-attention" }
  "split"   { $AttentionFlag = "--use-split-cross-attention" }
  "subquad" { $AttentionFlag = "--use-quad-cross-attention" }
  default   { Write-Error "Backend inconnu : $Attention (sdpa | split | subquad)"; exit 1 }
}

# ---------------------------------------------------------------------------
# Adresse d'ecoute
# ---------------------------------------------------------------------------
if ($Listen -eq "local") {
  $ListenAddr = "127.0.0.1"
} else {
  $ListenAddr = (tailscale ip -4 | Select-Object -First 1).Trim()
}

# ---------------------------------------------------------------------------

Write-Host "-----------------------------------------"
Write-Host "  attention : $Attention"
Write-Host "  ecoute    : http://${ListenAddr}:${Port}"
Write-Host "-----------------------------------------"

Set-Location $ComfyDir

# ---------------------------------------------------------------------------
# Capture des logs en temps reel (jumeau de start-comfy.sh)
# ---------------------------------------------------------------------------
# Duplique la console de ComfyUI vers un fichier de log par session (tronque a
# chaque lancement) pour que le superviseur Komfy puisse la diffuser dans l'app,
# tout en la laissant visible ici. PYTHONUNBUFFERED force Python a streamer
# ligne par ligne au lieu de bufferiser a travers le pipe.
$LogFile = if ($env:KOMFY_LOG_FILE) { $env:KOMFY_LOG_FILE } else { Join-Path $BaseDir "logs\comfyui.log" }
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $LogFile) | Out-Null
$env:PYTHONUNBUFFERED = "1"

# protobuf : backend pur-Python (fix conflit transformers <-> sentencepiece).
# transformers et sentencepiece enregistrent le meme `sentencepiece_model.proto` ;
# le backend C++ (defaut de protobuf >= 5) refuse le doublon et fait echouer le
# chargement d'un tokenizer Gemma GGUF. Le backend pur-Python le tolere. Impact
# perf negligeable (protobuf ne sert qu'au chargement des tokenizers).
$env:PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION = "python"

$comfyArgs = @(
  'main.py',
  '--listen', $ListenAddr,
  '--port', $Port,
  $AttentionFlag,
  '--bf16-text-enc',
  '--preview-method', 'auto',
  '--enable-manager',
  '--base-directory', $BaseDir,
  '--user-directory', "$BaseDir\user_tailscale"
)

# Pipeline synchrone : pas de banniere de fin de demarrage asynchrone sous
# Windows (le pipe Tee-Object est bloquant). L'URL est deja imprimee ci-dessus
# avant le lancement, et `npm run pair` la porte sur le telephone par QR.
& $VenvPy @comfyArgs 2>&1 | Tee-Object -FilePath $LogFile
exit $LASTEXITCODE

# Notes sur les flags (identiques a start-comfy.sh) :
#
#   --output-directory / --input-directory
#       Redondants : --base-directory les couvre deja (models, custom_nodes,
#       input, output, temp, user).
#
#   --extra-model-paths-config
#       A n'ajouter que si des modeles vivent hors de <BASE_DIR>\models,
#       sinon ils apparaissent en double dans les listes deroulantes.
#       Sous Windows l'emplacement Comfy Desktop est %APPDATA%\ComfyUI\...
