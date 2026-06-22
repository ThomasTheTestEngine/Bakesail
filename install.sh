#!/usr/bin/env bash
# =============================================================================
# Bakesail Installer
# Installs the Bakesail BGA rework station frontend on top of MainsailOS.
# Run as the default 'pi' user (or equivalent) — not as root.
#
# Usage:
#   curl -sSL https://raw.githubusercontent.com/ThomasTheTestEngine/Bakesail/main/install.sh | bash
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# Colour helpers
# -----------------------------------------------------------------------------
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
# Configuration
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
NGINX_BAKESAIL_CONF="${NGINX_AVAIL}/bakesail"
NGINX_BACKUP_DIR="${BAKESAIL_DIR}/.nginx_backup"

FIRST_RUN_FLAG="${BAKESAIL_DIR}/.first_run"

NODE_MIN_MAJOR=18

# -----------------------------------------------------------------------------
# Pre-flight checks
# -----------------------------------------------------------------------------
preflight_checks() {
    section "Pre-flight checks"

    # Must not run as root
    [[ "${EUID}" -ne 0 ]] || die "Do not run this script as root. Run as your normal user (e.g. pi)."

    # sudo must be available and work without password (standard on MainsailOS)
    sudo -n true 2>/dev/null || die "This script requires passwordless sudo. On MainsailOS this should be the default."

    # We expect to be on a Debian/Ubuntu-based system
    command -v apt-get &>/dev/null || die "apt-get not found. This installer targets Debian-based systems (MainsailOS)."

    # Klipper must already be installed
    [[ -d "${HOME}/klipper" ]] || die "Klipper directory not found at ~/klipper. Please install MainsailOS first."
    [[ -d "${KLIPPER_EXTRAS_DIR}" ]] || die "Klipper extras directory not found at ${KLIPPER_EXTRAS_DIR}."

    # Moonraker must already be present
    [[ -f "${MOONRAKER_CONF}" ]] || die "moonraker.conf not found at ${MOONRAKER_CONF}. Please install MainsailOS first."

    # Printer data dir must exist
    [[ -d "${PRINTER_CONFIG_DIR}" ]] || die "printer_data/config not found at ${PRINTER_CONFIG_DIR}."

    success "Pre-flight checks passed."
}

# -----------------------------------------------------------------------------
# Dependency installation
# -----------------------------------------------------------------------------
install_dependencies() {
    section "Installing system dependencies"

    sudo apt-get update -qq

    local pkgs=()

    command -v git &>/dev/null  || pkgs+=(git)
    command -v curl &>/dev/null || pkgs+=(curl)
    command -v jq &>/dev/null   || pkgs+=(jq)

    if [[ ${#pkgs[@]} -gt 0 ]]; then
        info "Installing: ${pkgs[*]}"
        sudo apt-get install -y -qq "${pkgs[@]}"
    else
        info "System dependencies already satisfied."
    fi

    # Node.js — check version, install/upgrade via NodeSource if needed
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
# Clone or update the Bakesail repo
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
# Build the Vue frontend
# -----------------------------------------------------------------------------
build_frontend() {
    section "Building Bakesail frontend"

    local frontend_dir="${BAKESAIL_DIR}/src/frontend"

    [[ -d "${frontend_dir}" ]] || die "Frontend source not found at ${frontend_dir}."

    info "Installing npm dependencies..."
    npm --prefix "${frontend_dir}" ci --silent

    info "Building production bundle..."
    npm --prefix "${frontend_dir}" run build --silent

    success "Frontend built."
}

# -----------------------------------------------------------------------------
# Install the Klipper extra
# -----------------------------------------------------------------------------
install_klipper_extra() {
    section "Installing Klipper extra"

    local src="${BAKESAIL_DIR}/src/klipper/bakesail.py"
    local dst="${KLIPPER_EXTRAS_DIR}/bakesail.py"

    [[ -f "${src}" ]] || die "bakesail.py not found at ${src}."

    cp "${src}" "${dst}"
    success "bakesail.py installed to ${dst}."
}

# -----------------------------------------------------------------------------
# Install config fragments (macros, example profile)
# -----------------------------------------------------------------------------
install_config() {
    section "Installing config files"

    # Bakesail macros include (test-pin macro etc.)
    local macros_src="${BAKESAIL_DIR}/config/bakesail_macros.cfg"
    local macros_dst="${PRINTER_CONFIG_DIR}/bakesail_macros.cfg"

    if [[ -f "${macros_src}" ]]; then
        cp "${macros_src}" "${macros_dst}"
        info "bakesail_macros.cfg installed."
    else
        warn "bakesail_macros.cfg not found in repo — skipping."
    fi

    # Profile directory
    mkdir -p "${PROFILES_DIR}"
    local example_profile="${BAKESAIL_DIR}/config/profiles/lead_free_standard.json"
    if [[ -f "${example_profile}" ]]; then
        cp "${example_profile}" "${PROFILES_DIR}/lead_free_standard.json"
        info "Example profile installed."
    fi

    success "Config files installed."
}

# -----------------------------------------------------------------------------
# Register Bakesail with Moonraker's update manager
# -----------------------------------------------------------------------------
register_moonraker() {
    section "Registering with Moonraker update manager"

    local marker="[update_manager bakesail]"

    if grep -qF "${marker}" "${MOONRAKER_CONF}"; then
        info "Moonraker update manager entry already present — skipping."
        return
    fi

    cat >> "${MOONRAKER_CONF}" << EOF

# --- Bakesail (added by installer) ---
[update_manager bakesail]
type: git_repo
path: ${BAKESAIL_DIR}
origin: ${BAKESAIL_REPO}
primary_branch: ${BAKESAIL_BRANCH}
is_system_service: False
EOF

    success "Moonraker update manager entry added."
}

# -----------------------------------------------------------------------------
# Configure nginx — back up Mainsail config, install Bakesail config
# -----------------------------------------------------------------------------
configure_nginx() {
    section "Configuring nginx"

    # Back up Mainsail nginx config if not already backed up
    if [[ -f "${NGINX_MAINSAIL_CONF}" ]]; then
        mkdir -p "${NGINX_BACKUP_DIR}"
        if [[ ! -f "${NGINX_BACKUP_DIR}/mainsail.bak" ]]; then
            sudo cp "${NGINX_MAINSAIL_CONF}" "${NGINX_BACKUP_DIR}/mainsail.bak"
            info "Mainsail nginx config backed up to ${NGINX_BACKUP_DIR}/mainsail.bak"
        else
            info "Mainsail nginx config backup already exists — skipping backup."
        fi
    fi

    # Disable Mainsail nginx site
    if [[ -L "${NGINX_ENABLED}/mainsail" ]]; then
        sudo rm "${NGINX_ENABLED}/mainsail"
        info "Mainsail nginx site disabled."
    fi

    # Install Bakesail nginx config
    local nginx_src="${BAKESAIL_DIR}/config/nginx/bakesail.nginx.conf"
    [[ -f "${nginx_src}" ]] || die "Bakesail nginx config not found at ${nginx_src}."

    sudo cp "${nginx_src}" "${NGINX_BAKESAIL_CONF}"

    # Enable Bakesail nginx site
    if [[ ! -L "${NGINX_ENABLED}/bakesail" ]]; then
        sudo ln -s "${NGINX_BAKESAIL_CONF}" "${NGINX_ENABLED}/bakesail"
    fi

    # Test and reload nginx
    sudo nginx -t -q || die "nginx config test failed. Check ${NGINX_BAKESAIL_CONF}."
    sudo systemctl reload nginx
    success "nginx configured and reloaded."
}

# -----------------------------------------------------------------------------
# Mark first-run so the wizard launches on first browser visit
# -----------------------------------------------------------------------------
set_first_run_flag() {
    touch "${FIRST_RUN_FLAG}"
    info "First-run wizard flag set."
}

# -----------------------------------------------------------------------------
# Restart Klipper / Moonraker to pick up new extra and config
# -----------------------------------------------------------------------------
restart_services() {
    section "Restarting services"

    # Restart Moonraker first so it re-reads its config
    if systemctl is-active --quiet moonraker; then
        sudo systemctl restart moonraker
        info "Moonraker restarted."
    else
        warn "Moonraker service not active — skipping restart."
    fi

    # Restart Klipper so it loads bakesail.py
    if systemctl is-active --quiet klipper; then
        sudo systemctl restart klipper
        info "Klipper restarted."
    else
        warn "Klipper service not active — skipping restart."
    fi

    success "Services restarted."
}

# -----------------------------------------------------------------------------
# Done banner
# -----------------------------------------------------------------------------
print_done() {
    local ip
    ip=$(hostname -I | awk '{print $1}' 2>/dev/null || echo "<your-pi-ip>")

    echo
    echo -e "${GRN}${BLD}============================================${RST}"
    echo -e "${GRN}${BLD}  Bakesail installation complete!${RST}"
    echo -e "${GRN}${BLD}============================================${RST}"
    echo
    echo -e "  Open ${BLD}http://${ip}${RST} in your browser."
    echo -e "  The setup wizard will run on first visit."
    echo
    echo -e "  To restore Mainsail later, run:"
    echo -e "  ${BLD}${BAKESAIL_DIR}/scripts/uninstall.sh${RST}"
    echo
}

# -----------------------------------------------------------------------------
# Entry point
# -----------------------------------------------------------------------------
main() {
    echo -e "\n${CYN}${BLD}  Bakesail Installer${RST}"
    echo -e "  BGA rework station control — https://github.com/ThomasTheTestEngine/Bakesail\n"

    preflight_checks
    install_dependencies
    clone_repo
    build_frontend
    install_klipper_extra
    install_config
    register_moonraker
    configure_nginx
    set_first_run_flag
    restart_services
    print_done
}

main "$@"
