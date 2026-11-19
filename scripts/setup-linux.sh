#!/usr/bin/env bash
set -euo pipefail

# Shadow Desktop — Complete Linux Setup, Agent & Native Tauri Builder
# Supports Ubuntu/Debian (apt), Fedora/RHEL (dnf), and Arch Linux (pacman).

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

SKIP_SYSTEM_DEPS=false
SKIP_TAURI_BUILD=false
AGENT_ONLY=false

for arg in "$@"; do
  case "${arg}" in
    --skip-system-deps) SKIP_SYSTEM_DEPS=true ;;
    --skip-tauri-build) SKIP_TAURI_BUILD=true ;;
    --agent-only) AGENT_ONLY=true ;;
    -h|--help)
      cat <<EOF
Usage: ./scripts/setup-linux.sh [options]

Options:
  --skip-system-deps   Skip installing apt/dnf/pacman Tauri & X11 packages
  --skip-tauri-build   Skip compiling the native Tauri desktop binary/bundles
  --agent-only         Only install and start the background Laptop Agent
  -h, --help           Show this help message
EOF
      exit 0
      ;;
    *)
      echo "Unknown option: ${arg}"
      exit 1
      ;;
  esac
done

log() {
  printf "\n\033[1;36m[Shadow Linux Setup]\033[0m %s\n" "$1"
}

warn() {
  printf "\033[1;33m[Warning]\033[0m %s\n" "$1"
}

if [[ "${AGENT_ONLY}" == "true" ]]; then
  log "Installing Shadow Laptop Agent background service..."
  chmod +x "${ROOT_DIR}/scripts/install-shadow-agent.sh"
  bash "${ROOT_DIR}/scripts/install-shadow-agent.sh"
  exit 0
fi

# 1. System packages for Tauri v2 + X11 window tiling (wmctrl, xdotool)
if [[ "${SKIP_SYSTEM_DEPS}" == "false" ]]; then
  log "Checking Linux system dependencies..."
  SUDO=""
  if [[ "${EUID}" -ne 0 ]] && command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
  fi

  if command -v apt-get >/dev/null 2>&1; then
    ${SUDO} apt-get update
    ${SUDO} apt-get install -y \
      libwebkit2gtk-4.1-dev \
      build-essential \
      curl \
      wget \
      file \
      libxdo-dev \
      libssl-dev \
      libayatana-appindicator3-dev \
      librsvg2-dev \
      pkg-config \
      wmctrl \
      xdotool \
      xdg-utils
  elif command -v dnf >/dev/null 2>&1; then
    ${SUDO} dnf groupinstall -y "Development Tools" || true
    ${SUDO} dnf install -y \
      webkit2gtk4.1-devel \
      openssl-devel \
      curl \
      wget \
      file \
      libappindicator-gtk3-devel \
      librsvg2-devel \
      pkg-config \
      wmctrl \
      xdotool \
      xdg-utils
  elif command -v pacman >/dev/null 2>&1; then
    ${SUDO} pacman -Sy --needed --noconfirm \
      webkit2gtk-4.1 \
      base-devel \
      curl \
      wget \
      file \
      openssl \
      appmenu-gtk-module \
      libappindicator-gtk3 \
      librsvg \
      pkgconf \
      wmctrl \
      xdotool \
      xdg-utils
  else
    warn "Unsupported package manager. Ensure WebKit2GTK 4.1, OpenSSL dev headers, build-essential, wmctrl, and xdotool are installed."
  fi
fi

# 2. Verify Node.js >= 20
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Error: Node.js 20+ and npm are required. Install Node.js from https://nodejs.org/ and re-run."
  exit 1
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [[ "${NODE_MAJOR}" -lt 20 ]]; then
  warn "Detected Node.js $(node -v). Node.js 20+ is recommended."
fi

# 3. Install Rust & Tauri CLI v2 if building native binary
if [[ "${SKIP_TAURI_BUILD}" == "false" ]]; then
  if ! command -v cargo >/dev/null 2>&1; then
    log "Installing Rust & Cargo via rustup..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    # shellcheck disable=SC1091
    source "${HOME}/.cargo/env"
  fi

  if ! cargo tauri --version >/dev/null 2>&1; then
    log "Installing Tauri CLI v2..."
    cargo install tauri-cli --version "^2" --locked
  fi
fi

# 4. Prepare .env configuration
if [[ ! -f "${ROOT_DIR}/.env" ]] && [[ -f "${ROOT_DIR}/.env.example" ]]; then
  cp "${ROOT_DIR}/.env.example" "${ROOT_DIR}/.env"
  sed -i 's|APP_URL="MY_APP_URL"|APP_URL="http://localhost:3000"|g' "${ROOT_DIR}/.env" || true
  warn "Created .env from .env.example. Set GEMINI_API_KEY in ${ROOT_DIR}/.env before launching."
fi

# 5. Install Node dependencies & build production frontend
log "Installing npm dependencies..."
if ! npm install; then
  warn "Standard npm install hit a peer resolution conflict; retrying with --legacy-peer-deps..."
  npm install --legacy-peer-deps
fi

log "Building Shadow frontend bundle..."
npm run build

# 6. Install Playwright Chromium for real browser automation
log "Installing Playwright Chromium runtime (if available)..."
npx --yes playwright install chromium || warn "Playwright Chromium install skipped; install manually with 'npx playwright install chromium'."

# 7. Install & start background Shadow Laptop Agent
log "Installing Shadow Laptop Agent background service..."
chmod +x "${ROOT_DIR}/scripts/install-shadow-agent.sh"
bash "${ROOT_DIR}/scripts/install-shadow-agent.sh"

# 8. Build native Tauri Linux desktop package (.deb / .AppImage)
BUILT_BIN=""
if [[ "${SKIP_TAURI_BUILD}" == "false" ]]; then
  log "Building native Shadow Desktop Tauri release bundle..."
  npm run tauri:build
  if [[ -x "${ROOT_DIR}/src-tauri/target/release/jarvis-desktop" ]]; then
    BUILT_BIN="${ROOT_DIR}/src-tauri/target/release/jarvis-desktop"
  fi
fi

# 9. Install ~/.local/bin/shadow-desktop launcher & .desktop entry
BIN_DIR="${HOME}/.local/bin"
APP_DIR="${HOME}/.local/share/applications"
mkdir -p "${BIN_DIR}" "${APP_DIR}" "${HOME}/.shadow-agent"

LAUNCHER_PATH="${BIN_DIR}/shadow-desktop"
cat > "${LAUNCHER_PATH}" <<EOF
#!/usr/bin/env bash
set -euo pipefail

SHADOW_DIR="${ROOT_DIR}"
LOG_FILE="${HOME}/.shadow-agent/server.log"

cd "\${SHADOW_DIR}"

if ! curl -sf http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
  nohup npm start > "\${LOG_FILE}" 2>&1 &
  for _ in \$(seq 1 30); do
    if curl -sf http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
      break
    fi
    sleep 0.5
  done
fi

if [[ -x "\${SHADOW_DIR}/src-tauri/target/release/jarvis-desktop" ]]; then
  exec "\${SHADOW_DIR}/src-tauri/target/release/jarvis-desktop" "\$@"
elif command -v jarvis-desktop >/dev/null 2>&1; then
  exec jarvis-desktop "\$@"
else
  exec xdg-open "http://127.0.0.1:3000"
fi
EOF
chmod +x "${LAUNCHER_PATH}"

DESKTOP_FILE="${APP_DIR}/shadow-desktop.desktop"
cat > "${DESKTOP_FILE}" <<EOF
[Desktop Entry]
Type=Application
Name=Shadow Desktop
Comment=Voice-first AI desktop, browser automation, research, and visuals workspace
Exec=${LAUNCHER_PATH}
Terminal=false
Categories=Utility;Development;AudioVideo;
StartupNotify=true
EOF

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "${APP_DIR}" >/dev/null 2>&1 || true
fi

log "Linux setup complete!"
echo "  • Launcher command : ${LAUNCHER_PATH}"
echo "  • App menu entry   : ${DESKTOP_FILE}"
if [[ -n "${BUILT_BIN}" ]]; then
  echo "  • Native binary    : ${BUILT_BIN}"
fi
if [[ -d "${ROOT_DIR}/src-tauri/target/release/bundle" ]]; then
  echo "  • Installers       : ${ROOT_DIR}/src-tauri/target/release/bundle/"
fi
echo ""
echo "Next:"
echo "  1. Ensure GEMINI_API_KEY is set inside ${ROOT_DIR}/.env"
echo "  2. Run '${LAUNCHER_PATH}' (or 'npm run tauri:dev' for dev mode)"
