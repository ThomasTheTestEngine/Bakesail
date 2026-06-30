#!/usr/bin/env bash
# =============================================================================
# Bakesail Installer
# Installs the Bakesail frontend on top of MainsailOS.
# Run as your normal user (not root) — the script uses sudo internally.
#
# Usage:
#   curl -sSL https://raw.githubusercontent.com/ThomasTheTestEngine/Bakesail/main/install.sh | bash
# =============================================================================

set -euo pipefail

RED='\033[0;31m'
GRN='\033[0;32m'
YLW='\033[1;33m'
BLU='\033[0;34m'
CYN='\033[0;36m'
BLD='\033[1m'
RST='\033[0m'

info()    { echo -e "${BLU}[bakesail]${RST} $*"; }
success() { echo -e "${GRN}[bakesail]${RST} $*"; }
warn()    { echo -e "${YLW}[bakesail]${RST} $*"; }
error()   { echo -e "${RED}[bakesail]${RST} $*" >&2; }
die()     { error "$*"; exit 1; }
section() { echo -e "\n${CYN}${BLD}>>> $* ${RST}"; }

# -----------------------------------------------------------------------------
# Configuration — all paths derived from HOME, no hardcoded usernames
# -----------------------------------------------------------------------------
BAKESAIL_REPO="https://github.com/ThomasTheTestEngine/Bakesail.git"
BAKESAIL_BRANCH="main"

BAKESAIL_DIR="${HOME}/bakesail"
KLIPPER_EXTRAS_DIR="${HOME}/klipper/klippy/extras"
PRINTER_DATA_DIR="${HOME}/printer_data"
PRINTER_CONFIG_DIR="${PRINTER_DATA_DIR}/config"
PROFILES_DIR="${PRINTER_CONFIG_DIR}/bakesail_profiles"
MOONRAKER_CONF="${PRINTER_CONFIG_DIR}/moonraker.conf"

NGINX_AVAIL="/etc/nginx/sites-available"
NGINX_ENABLED="/etc/nginx/sites-enabled"
NGINX_MAINSAIL_CONF="${NGINX_AVAIL}/mainsail"
NGINX_MAINSAIL_8080_CONF="${NGINX_AVAIL}/mainsail-8080"
NGINX_BAKESAIL_CONF="${NGINX_AVAIL}/bakesail"
NGINX_BACKUP_DIR="${BAKESAIL_DIR}/.nginx_backup"

MAINSAIL_PORT=8080
NODE_MIN_MAJOR=18

# -----------------------------------------------------------------------------
# Pre-flight checks
# -----------------------------------------------------------------------------
preflight_checks() {
    section "Pre-flight checks"

    [[ "${EUID}" -ne 0 ]] || die "Do not run this script as root. Run as your normal user."
    sudo -n true 2>/dev/null || die "This script requires passwordless sudo. On MainsailOS this should be the default."
    command -v apt-get &>/dev/null || die "apt-get not found. This installer targets Debian-based systems (MainsailOS)."
    [[ -d "${HOME}/klipper" ]] || die "Klipper directory not found at ~/klipper. Please install MainsailOS first."
    [[ -d "${KLIPPER_EXTRAS_DIR}" ]] || die "Klipper extras directory not found at ${KLIPPER_EXTRAS_DIR}."
    [[ -f "${MOONRAKER_CONF}" ]] || die "moonraker.conf not found at ${MOONRAKER_CONF}. Please install MainsailOS first."
    [[ -d "${PRINTER_CONFIG_DIR}" ]] || die "printer_data/config not found at ${PRINTER_CONFIG_DIR}."

    success "Pre-flight checks passed."
}

# -----------------------------------------------------------------------------
# Dependencies
# -----------------------------------------------------------------------------
install_dependencies() {
    section "Installing system dependencies"

    sudo apt-get update -qq

    local pkgs=()
    command -v git  &>/dev/null || pkgs+=(git)
    command -v curl &>/dev/null || pkgs+=(curl)
    command -v jq   &>/dev/null || pkgs+=(jq)

    if [[ ${#pkgs[@]} -gt 0 ]]; then
        info "Installing: ${pkgs[*]}"
        sudo apt-get install -y -qq "${pkgs[@]}"
    else
        info "System dependencies already satisfied."
    fi

    install_node
}

install_node() {
    local current_major=0
    if command -v node &>/dev/null; then
        current_major=$(node --version | sed 's/v\([0-9]*\).*/\1/')
    fi

    if [[ "${current_major}" -ge "${NODE_MIN_MAJOR}" ]]; then
        success "Node.js $(node --version) already installed."
        return
    fi

    info "Installing Node.js ${NODE_MIN_MAJOR}.x via NodeSource..."
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MIN_MAJOR}.x" | sudo -E bash - &>/dev/null
    sudo apt-get install -y -qq nodejs
    success "Node.js $(node --version) installed."
}

# -----------------------------------------------------------------------------
# Clone / update repo
# -----------------------------------------------------------------------------
clone_repo() {
    section "Fetching Bakesail source"

    if [[ -d "${BAKESAIL_DIR}/.git" ]]; then
        info "Existing installation found at ${BAKESAIL_DIR} — updating."
        git -C "${BAKESAIL_DIR}" fetch --quiet origin
        git -C "${BAKESAIL_DIR}" checkout --quiet "${BAKESAIL_BRANCH}"
        git -C "${BAKESAIL_DIR}" pull --quiet --ff-only
        success "Repository updated."
    else
        info "Cloning Bakesail into ${BAKESAIL_DIR}..."
        git clone --quiet --branch "${BAKESAIL_BRANCH}" "${BAKESAIL_REPO}" "${BAKESAIL_DIR}"
        success "Repository cloned."
    fi
}

# -----------------------------------------------------------------------------
# Build frontend
# -----------------------------------------------------------------------------
build_frontend() {
    section "Building Bakesail frontend"

    local frontend_dir="${BAKESAIL_DIR}/src/frontend"
    [[ -d "${frontend_dir}" ]] || die "Frontend source not found at ${frontend_dir}."

    info "Installing npm dependencies..."
    npm --prefix "${frontend_dir}" install --silent

    info "Building production bundle..."
    npm --prefix "${frontend_dir}" run build --silent

    success "Frontend built."
}

# -----------------------------------------------------------------------------
# Install Klipper extra
# -----------------------------------------------------------------------------
install_klipper_extra() {
    section "Installing Klipper extra"

    local src="${BAKESAIL_DIR}/src/klipper/bakesail.py"
    local dst="${KLIPPER_EXTRAS_DIR}/bakesail.py"
    [[ -f "${src}" ]] || die "bakesail.py not found at ${src}."
    cp "${src}" "${dst}"
    success "bakesail.py installed."
}

# -----------------------------------------------------------------------------
# Install config fragments
# -----------------------------------------------------------------------------
install_config() {
    section "Installing config files"

    local macros_src="${BAKESAIL_DIR}/config/bakesail_macros.cfg"
    if [[ -f "${macros_src}" ]]; then
        cp "${macros_src}" "${PRINTER_CONFIG_DIR}/bakesail_macros.cfg"
        info "bakesail_macros.cfg installed."
    fi

    mkdir -p "${PROFILES_DIR}"
    local example_profile="${BAKESAIL_DIR}/config/profiles/lead_free_standard.json"
    if [[ -f "${example_profile}" ]]; then
        cp "${example_profile}" "${PROFILES_DIR}/lead_free_standard.json"
        info "Example profile installed."
    fi

    success "Config files installed."
}

# -----------------------------------------------------------------------------
# Register with Moonraker update manager
# -----------------------------------------------------------------------------
register_moonraker() {
    section "Registering with Moonraker update manager"

    local marker="[update_manager bakesail]"
    if grep -qF "${marker}" "${MOONRAKER_CONF}"; then
        info "Moonraker update manager entry already present — skipping."
        return
    fi

    cat >> "${MOONRAKER_CONF}" << MCEOF

# --- Bakesail (added by installer) ---
[update_manager bakesail]
type: git_repo
path: ${BAKESAIL_DIR}
origin: ${BAKESAIL_REPO}
primary_branch: ${BAKESAIL_BRANCH}
is_system_service: False
MCEOF

    success "Moonraker update manager entry added."
}

# -----------------------------------------------------------------------------
# Configure nginx
#   - Back up the original Mainsail config
#   - Move Mainsail to port 8080 (new config written alongside original)
#   - Install Bakesail on port 80
# -----------------------------------------------------------------------------
configure_nginx() {
    section "Configuring nginx"

    mkdir -p "${NGINX_BACKUP_DIR}"

    # ── Back up original Mainsail config ──────────────────────────────────────
    if [[ -f "${NGINX_MAINSAIL_CONF}" ]] && [[ ! -f "${NGINX_BACKUP_DIR}/mainsail.bak" ]]; then
        sudo cp "${NGINX_MAINSAIL_CONF}" "${NGINX_BACKUP_DIR}/mainsail.bak"
        info "Original Mainsail nginx config backed up."
    fi

    # ── Write Mainsail-on-8080 config ─────────────────────────────────────────
    # Take the original config and swap port 80 → 8080. We write it as a
    # separate file so the original is never modified.
    if [[ -f "${NGINX_BACKUP_DIR}/mainsail.bak" ]]; then
        sed 's/listen 80\b/listen '"${MAINSAIL_PORT}"'/g; s/listen \[::\]:80\b/listen [::]:'"${MAINSAIL_PORT}"'/g' \
            "${NGINX_BACKUP_DIR}/mainsail.bak" | sudo tee "${NGINX_MAINSAIL_8080_CONF}" > /dev/null
        info "Mainsail-on-${MAINSAIL_PORT} config written."
    fi

    # ── Disable Mainsail on port 80, enable it on 8080 ────────────────────────
    if [[ -L "${NGINX_ENABLED}/mainsail" ]]; then
        sudo rm "${NGINX_ENABLED}/mainsail"
        info "Mainsail port-80 site disabled."
    fi
    if [[ ! -L "${NGINX_ENABLED}/mainsail-8080" ]]; then
        sudo ln -s "${NGINX_MAINSAIL_8080_CONF}" "${NGINX_ENABLED}/mainsail-8080"
        info "Mainsail port-${MAINSAIL_PORT} site enabled."
    fi

    # ── Install Bakesail on port 80 ───────────────────────────────────────────
    # Substitute the actual home directory so no username is hardcoded
    local nginx_src="${BAKESAIL_DIR}/config/nginx/bakesail.nginx.conf"
    [[ -f "${nginx_src}" ]] || die "Bakesail nginx config not found at ${nginx_src}."

    sed "s|BAKESAIL_DIST_PATH|${BAKESAIL_DIR}/src/frontend/dist|g" \
        "${nginx_src}" | sudo tee "${NGINX_BAKESAIL_CONF}" > /dev/null

    if [[ ! -L "${NGINX_ENABLED}/bakesail" ]]; then
        sudo ln -s "${NGINX_BAKESAIL_CONF}" "${NGINX_ENABLED}/bakesail"
    fi

    sudo nginx -t -q || die "nginx config test failed."
    sudo systemctl reload nginx
    success "nginx configured — Bakesail on :80, Mainsail on :${MAINSAIL_PORT}."
}

# -----------------------------------------------------------------------------
# Auto-detect existing printer.cfg — skip wizard and set device type
# -----------------------------------------------------------------------------
maybe_skip_wizard() {
    local printer_cfg="${PRINTER_CONFIG_DIR}/printer.cfg"
    local bakesail_cfg="${PRINTER_CONFIG_DIR}/bakesail.cfg"
    local bakesail_settings="${PRINTER_CONFIG_DIR}/bakesail_settings.json"

    if [[ ! -f "${printer_cfg}" ]]; then
        info "No printer.cfg found — setup wizard will run on first visit."
        return
    fi

    info "Existing printer.cfg detected — configuring as 3D printer, skipping wizard."

    if [[ ! -f "${bakesail_cfg}" ]] || grep -q "\[heater_bed\]\|\[bakesail\]\|\[fan\]\|\[bed_mesh\]" "${bakesail_cfg}" 2>/dev/null; then
        cat > "${bakesail_cfg}" << 'CFGEOF'
# bakesail.cfg — auto-generated by Bakesail installer
# Device type: 3d_printer
# This file signals that first-run setup is complete.
# Delete it to re-run the setup wizard.
CFGEOF
        info "bakesail.cfg stub written."
    fi

    if [[ ! -f "${bakesail_settings}" ]]; then
        cat > "${bakesail_settings}" << JSONEOF
{
  "deviceType": "3d_printer",
  "machineClass": "manual",
  "zones": [],
  "thermocouples": [],
  "cameras": [],
  "dashboardGridSnap": true,
  "dashboardGridSize": 10
}
JSONEOF
        info "bakesail_settings.json written with deviceType: 3d_printer."
    fi

    success "3D printer auto-configuration complete."
}

# -----------------------------------------------------------------------------
# Restart services
# -----------------------------------------------------------------------------
restart_services() {
    section "Restarting services"

    if systemctl is-active --quiet moonraker; then
        sudo systemctl restart moonraker
        info "Moonraker restarted."
    else
        warn "Moonraker not active — skipping."
    fi

    if systemctl is-active --quiet klipper; then
        sudo systemctl restart klipper
        info "Klipper restarted."
    else
        warn "Klipper not active — skipping."
    fi

    success "Services restarted."
}

# -----------------------------------------------------------------------------
# Done banner
# -----------------------------------------------------------------------------
print_done() {
    local ip
    ip=$(hostname -I | awk '{print $1}' 2>/dev/null || echo "<your-pi-ip>")
    local printer_cfg="${PRINTER_CONFIG_DIR}/printer.cfg"

    echo
    echo -e "${GRN}${BLD}============================================${RST}"
    echo -e "${GRN}${BLD}  Bakesail installation complete!${RST}"
    echo -e "${GRN}${BLD}============================================${RST}"
    echo
    echo -e "  Bakesail  →  ${BLD}http://${ip}${RST}"
    echo -e "  Mainsail  →  ${BLD}http://${ip}:${MAINSAIL_PORT}${RST}"
    echo
    if [[ -f "${printer_cfg}" ]]; then
        echo -e "  Existing printer.cfg detected — opening as ${BLD}3D Printer${RST}."
        echo -e "  Change device type any time in ${BLD}Settings${RST}."
    else
        echo -e "  Setup wizard will run on first visit."
    fi
    echo
    echo -e "  To restore Mainsail to port 80:"
    echo -e "  ${BLD}${BAKESAIL_DIR}/scripts/uninstall.sh${RST}"
    echo
}

# -----------------------------------------------------------------------------
# Entry point
# -----------------------------------------------------------------------------
main() {
    echo -e "\n${CYN}${BLD}  Bakesail Installer${RST}"
    echo -e "  Open source Klipper dashboard — https://github.com/ThomasTheTestEngine/Bakesail\n"

    preflight_checks
    install_dependencies
    clone_repo
    build_frontend
    install_klipper_extra
    install_config
    register_moonraker
    configure_nginx
    maybe_skip_wizard
    restart_services
    print_done
}

main "$@"
