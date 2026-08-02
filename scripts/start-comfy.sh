#!/usr/bin/env bash
# Lancement ComfyUI - macOS / Linux
#
# Usage :
#   ./start-comfy.sh              -> backend SDPA (recommande, a mesurer)
#   ./start-comfy.sh split        -> backend split (repli si saturation memoire)
#   ./start-comfy.sh subquad      -> backend sub-quadratique (l'ancien, le plus lent)
#   ./start-comfy.sh sdpa local   -> ecoute sur 127.0.0.1 au lieu de Tailscale
#
# Chemins surchargeables par variables d'environnement (les defauts ci-dessous
# correspondent au poste du mainteneur). Ex. sur une autre install :
#   COMFY_DIR=/opt/ComfyUI VENV_PY=/opt/ComfyUI/.venv/bin/python3 \
#     BASE_DIR=/opt/ComfyUI-data ./start-comfy.sh
# Sous Windows, utiliser plutot scripts/start-comfy.ps1 (PowerShell).

set -euo pipefail

COMFY_DIR="${COMFY_DIR:-$HOME/ComfyUI-Installs/ComfyUI/ComfyUI}"
VENV_PY="${VENV_PY:-$HOME/Documents/ComfyUI/.venv/bin/python3}"
BASE_DIR="${BASE_DIR:-$HOME/Documents/ComfyUI}"
PORT="${PORT:-8188}"
# Per-session log the Komfy supervisor tails to stream the console to the app.
LOG_FILE="${KOMFY_LOG_FILE:-$BASE_DIR/logs/comfyui.log}"

# ---------------------------------------------------------------------------
# Variables d'environnement MPS (Apple Silicon uniquement)
# ---------------------------------------------------------------------------
# Ces reglages ne concernent que le backend Metal (MPS) de macOS. Sur Linux
# NVIDIA (CUDA) ou AMD (ROCm) ils n'ont aucun sens : on les gate donc derriere
# une detection Darwin. Le backend d'attention par defaut convient sur CUDA ;
# on ne force pas le tuning MPS ailleurs.
if [ "$(uname)" = "Darwin" ]; then
  # Retire le plafond d'allocation memoire de PyTorch sur MPS.
  # Par defaut PyTorch se limite a une fraction de la memoire unifiee ;
  # sur 64 Go c'est du gachis, surtout avec un expert 14B charge.
  export PYTORCH_MPS_HIGH_WATERMARK_RATIO=0.0

  # Autorise les operateurs non supportes par Metal a retomber sur le CPU.
  # ATTENTION : c'est un compromis. Sans cette variable, un operateur manquant
  # leve une erreur claire ; avec elle, il s'execute silencieusement sur CPU
  # et peut couter un facteur 10 sans rien signaler. Commente-la si tu
  # debogues une lenteur inexpliquee, pour rendre les problemes bruyants.
  export PYTORCH_ENABLE_MPS_FALLBACK=1
fi

# ---------------------------------------------------------------------------
# Backend d'attention - LE reglage a mesurer
# ---------------------------------------------------------------------------
# Sur des sequences video longues (>50k tokens), l'attention represente
# l'essentiel du calcul. Le mode sub-quadratique recalcule au lieu de
# stocker : il economise la memoire au prix du temps. C'est le pire choix
# a cette longueur de sequence, et c'est pourtant le defaut chez toi.

case "${1:-sdpa}" in
  sdpa)    ATTENTION="--use-pytorch-cross-attention" ;;
  split)   ATTENTION="--use-split-cross-attention" ;;
  subquad) ATTENTION="--use-quad-cross-attention" ;;
  *)       echo "Backend inconnu : $1 (sdpa | split | subquad)" >&2; exit 1 ;;
esac

# ---------------------------------------------------------------------------
# Adresse d'ecoute
# ---------------------------------------------------------------------------
if [[ "${2:-tailscale}" == "local" ]]; then
  LISTEN="127.0.0.1"
else
  LISTEN="$(tailscale ip -4 | head -1)"
fi

# ---------------------------------------------------------------------------

echo "─────────────────────────────────────────"
echo "  attention : ${1:-sdpa}"
echo "  ecoute    : http://${LISTEN}:${PORT}"
echo "─────────────────────────────────────────"

# ---------------------------------------------------------------------------
# Bannière de fin de démarrage
# ---------------------------------------------------------------------------
# Rappel bien visible de l'URL à coller dans l'app Komfy (assistant de première
# ouverture), imprimé UNE FOIS ComfyUI prêt — donc SOUS tout le log de
# démarrage, pas noyé au-dessus. Sous-shell en tâche de fond qui sonde le port
# (bash /dev/tcp, zéro dépendance : ni curl ni tailscale) ; plafonné à 120 s
# pour ne jamais fuiter si le serveur ne monte pas. L'URL sur sa propre ligne
# est cliquable (Cmd/Ctrl-clic) dans les terminaux modernes.
(
  url="http://${LISTEN}:${PORT}"
  for _ in $(seq 1 120); do
    if : > "/dev/tcp/${LISTEN}/${PORT}" 2>/dev/null; then
      printf '\n'
      echo "════════════════════════════════════════════════════════════"
      echo "  ✅  ComfyUI est prêt — URL du serveur pour l'app Komfy :"
      echo ""
      echo "        ${url}"
      echo ""
      echo "  À coller au premier lancement (ou dans Réglages ▸ URL serveur)."
      echo "════════════════════════════════════════════════════════════"
      printf '\n'
      break
    fi
    sleep 1
  done
) &

cd "$COMFY_DIR"

# Real-time log capture: mirror everything below to a per-session log file
# (truncated each launch) so the Komfy supervisor can stream ComfyUI's console
# to the app — while you still see it in this terminal. `exec > >(tee …)`
# preserves the final `exec` (clean signal handling); PYTHONUNBUFFERED forces
# Python to stream line-by-line through the pipe instead of block-buffering.
mkdir -p "$(dirname "$LOG_FILE")"
export PYTHONUNBUFFERED=1

# ---------------------------------------------------------------------------
# protobuf : backend pur-Python (fix conflit transformers <-> sentencepiece)
# ---------------------------------------------------------------------------
# transformers ET sentencepiece enregistrent chacun `sentencepiece_model.proto`
# dans le pool de descripteurs par defaut. Le backend C++ (upb, defaut de
# protobuf >= 5) refuse le doublon -> "Couldn't build proto file into descriptor
# pool" au chargement d'un tokenizer Gemma GGUF (DualCLIPLoaderGGUF). Le backend
# pur-Python tolere le doublon. Impact perf negligeable (protobuf ne sert qu'au
# chargement des tokenizers, pas dans la boucle de sampling). Verifie sur ce
# venv : upb echoue, python passe.
export PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION=python

exec > >(tee "$LOG_FILE") 2>&1

exec "$VENV_PY" main.py \
  --listen "$LISTEN" \
  --port "$PORT" \
  $ATTENTION \
  --bf16-text-enc \
  --preview-method auto \
  --enable-manager \
  --base-directory "$BASE_DIR" \
  --user-directory "$BASE_DIR/user_tailscale"

# Notes sur les flags retires de ta commande d'origine :
#
#   --output-directory / --input-directory
#       Redondants : --base-directory les couvre deja (models, custom_nodes,
#       input, output, temp, user). Les garder n'est pas faux, juste inutile.
#
#   --extra-model-paths-config .../shared_model_paths.yaml
#       Probablement redondant aussi, et potentiellement nuisible : si ce YAML
#       pointe vers les memes dossiers que --base-directory, tes modeles
#       apparaitront EN DOUBLE dans les listes deroulantes. Si tu vois chaque
#       fichier deux fois, c'est la cause. Remets-le uniquement si des modeles
#       vivent ailleurs que dans ~/Documents/ComfyUI/models.
#
#   --fp32-vae
#       Inutile : le test d'aller-retour VAE a montre que le bfloat16 passe
#       tres bien sur cette machine.