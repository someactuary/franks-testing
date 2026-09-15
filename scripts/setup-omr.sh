#!/usr/bin/env bash
# Installs Audiveris (OMR engine) and its English OCR data for the local OMR
# service (server/omr-service.ts). Idempotent: safe to re-run, each step is
# skipped if already done. See docs/ARCHITECTURE.md "M4 contracts: PDF import
# (OMR)".
#
# Usage:
#   bash scripts/setup-omr.sh            install whatever is missing
#   bash scripts/setup-omr.sh --check    report status only, install nothing
set -euo pipefail

REPO="Audiveris/audiveris"
VERSION="5.11.0"
APP_DIR="$HOME/Applications"
APP_PATH="$APP_DIR/Audiveris.app"
AUDIVERIS_BIN="$APP_PATH/Contents/MacOS/Audiveris"
TESSDATA_DIR="$HOME/Library/Application Support/AudiverisLtd/audiveris/tessdata"
ENG_TRAINEDDATA="$TESSDATA_DIR/eng.traineddata"
ENG_URL="https://github.com/tesseract-ocr/tessdata/raw/main/eng.traineddata"

CHECK_ONLY=0
case "${1:-}" in
  "") ;;
  --check) CHECK_ONLY=1 ;;
  *)
    echo "usage: $0 [--check]" >&2
    exit 1
    ;;
esac

log() { echo "[setup-omr] $*"; }

tmp_dir=""
cleanup() {
  if [[ -n "$tmp_dir" && -d "$tmp_dir" ]]; then
    rm -rf "$tmp_dir"
  fi
}
trap cleanup EXIT

detect_arch() {
  case "$(uname -m)" in
    arm64) echo "arm64" ;;
    x86_64) echo "x86_64" ;;
    *)
      echo "[setup-omr] unsupported architecture: $(uname -m)" >&2
      exit 1
      ;;
  esac
}

install_audiveris() {
  if [[ -x "$AUDIVERIS_BIN" ]]; then
    log "Audiveris already installed at $APP_PATH (skipping)"
    return
  fi
  if [[ "$CHECK_ONLY" == "1" ]]; then
    log "Audiveris not installed (would download Audiveris ${VERSION} and install to $APP_DIR)"
    return
  fi

  local arch dmg_name url dmg_path mount_point app_source
  arch="$(detect_arch)"
  dmg_name="Audiveris-${VERSION}-macosx-${arch}.dmg"
  url="https://github.com/${REPO}/releases/download/${VERSION}/${dmg_name}"

  tmp_dir="$(mktemp -d)"
  dmg_path="$tmp_dir/$dmg_name"
  mount_point="$tmp_dir/mnt"
  mkdir -p "$mount_point"

  log "Downloading $dmg_name..."
  curl -fL --progress-bar -o "$dmg_path" "$url"

  log "Mounting disk image (accepting the license prompt)..."
  # The DMG shows an interactive license agreement; `yes` answers it. `hdiutil`
  # closes stdin once it's done reading, which sends `yes` a SIGPIPE and makes
  # it exit non-zero -- under `pipefail` that would look like a failure even on
  # a successful mount, so we don't trust the pipeline's exit status here and
  # instead verify the mount actually produced a volume below.
  yes 2>/dev/null | hdiutil attach -nobrowse -readonly -noautoopen -mountpoint "$mount_point" "$dmg_path" >/dev/null || true

  app_source="$(find "$mount_point" -maxdepth 1 -iname '*.app' -print -quit)"
  if [[ -z "$app_source" ]]; then
    hdiutil detach "$mount_point" >/dev/null 2>&1 || true
    echo "[setup-omr] failed to mount $dmg_name (no .app found in $mount_point)" >&2
    exit 1
  fi

  mkdir -p "$APP_DIR"
  log "Copying $(basename "$app_source") to $APP_DIR..."
  rm -rf "$APP_PATH"
  cp -R "$app_source" "$APP_PATH"

  hdiutil detach "$mount_point" >/dev/null

  log "Audiveris installed at $APP_PATH"
}

install_ocr_data() {
  if [[ -f "$ENG_TRAINEDDATA" ]]; then
    log "English OCR data already installed at $ENG_TRAINEDDATA (skipping)"
    return
  fi
  if [[ "$CHECK_ONLY" == "1" ]]; then
    log "English OCR data not installed (would download to $TESSDATA_DIR)"
    return
  fi

  mkdir -p "$TESSDATA_DIR"
  log "Downloading English OCR data..."
  curl -fL --progress-bar -o "${ENG_TRAINEDDATA}.part" "$ENG_URL"
  mv "${ENG_TRAINEDDATA}.part" "$ENG_TRAINEDDATA"
  log "English OCR data installed at $ENG_TRAINEDDATA"
}

print_status() {
  echo
  echo "== OMR setup status =="
  if [[ -x "$AUDIVERIS_BIN" ]]; then
    local version
    version="$("$AUDIVERIS_BIN" -version 2>/dev/null | awk -F': *' '/Version/ {print $2}')"
    echo "Audiveris: installed at $APP_PATH${version:+ (version $version)}"
  else
    echo "Audiveris: NOT installed (run 'bash scripts/setup-omr.sh')"
  fi
  if [[ -f "$ENG_TRAINEDDATA" ]]; then
    echo "OCR (eng): installed at $ENG_TRAINEDDATA"
  else
    echo "OCR (eng): NOT installed; lyrics and other text will be misread (run 'bash scripts/setup-omr.sh')"
  fi
}

install_audiveris
install_ocr_data
print_status
