#!/usr/bin/env bash
# =============================================================================
# Bakesail Uninstaller
# Removes Bakesail and restores Mainsail to port 80.
# Does NOT remove printer.cfg, profiles, or Klipper itself.
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

BAKESAIL_DIR="${HOME}/bakesail"
KLIPPER_EXTRAS_DIR="${HOME}/klipper/klippy/extras"
MOONRAKER_CONF="${HOME}/printer_data/config/moonraker.conf"
NGINX_AVAIL="/etc/nginx/sites-available"
NGINX_ENABLED="/etc/nginx/sites-enabled"
NGINX_BACKUP_DIR="${BAKESAIL_DIR}/.nginx_backup"

[[ "${EUID}" -ne 0 ]] || die "Do not run as root."
sudo -n true 2>/dev/null || die "Requires passwordless sudo."

echo -e "\n${CYN}${BLD}  Bakesail Uninstaller${RST}\n"
warn "This will remove Bakesail and restore Mainsail to port 80."
read -r -p "Continue? [y/N] " confirm
[[ "${confirm}" =~ ^[Yy]$ ]] || { info "Aborted."; exit 0; }

section "Removing Bakesail nginx site"
if [[ -L "${NGINX_ENABLED}/bakesail" ]]; then
    sudo rm "${NGINX_ENABLED}/bakesail"
    info "Bakesail nginx site disabled."
fi
if [[ -f "${NGINX_AVAIL}/bakesail" ]]; then
    sudo rm "${NGINX_AVAIL}/bakesail"
    info "Bakesail nginx config removed."
fi

section "Removing Mainsail port-8080 site"
if [[ -L "${NGINX_ENABLED}/mainsail-8080" ]]; then
    sudo rm "${NGINX_ENABLED}/mainsail-8080"
    info "Mainsail port-8080 site disabled."
fi
if [[ -f "${NGINX_AVAIL}/mainsail-8080" ]]; then
    sudo rm "${NGINX_AVAIL}/mainsail-8080"
    info "Mainsail port-8080 config removed."
fi

section "Restoring Mainsail to port 80"
if [[ -f "${NGINX_BACKUP_DIR}/mainsail.bak" ]]; then
    sudo cp "${NGINX_BACKUP_DIR}/mainsail.bak" "${NGINX_AVAIL}/mainsail"
    if [[ ! -L "${NGINX_ENABLED}/mainsail" ]]; then
        sudo ln -s "${NGINX_AVAIL}/mainsail" "${NGINX_ENABLED}/mainsail"
    fi
    sudo nginx -t -q && sudo systemctl reload nginx
    success "Mainsail restored to port 80."
else
    warn "No Mainsail nginx backup found at ${NGINX_BACKUP_DIR}/mainsail.bak — restore manually."
fi

section "Removing Klipper extra"
if [[ -f "${KLIPPER_EXTRAS_DIR}/bakesail.py" ]]; then
    rm "${KLIPPER_EXTRAS_DIR}/bakesail.py"
    success "bakesail.py removed."
fi

section "Removing Moonraker update manager entry"
if grep -qF "[update_manager bakesail]" "${MOONRAKER_CONF}" 2>/dev/null; then
    sed -i '/# --- Bakesail/,/^$/d' "${MOONRAKER_CONF}"
    success "Moonraker entry removed."
fi

section "Restarting services"
sudo systemctl restart moonraker 2>/dev/null && info "Moonraker restarted." || warn "Moonraker restart failed."
sudo systemctl restart klipper   2>/dev/null && info "Klipper restarted."   || warn "Klipper restart failed."

echo
echo -e "${GRN}${BLD}Bakesail removed. Mainsail is back on port 80.${RST}"
echo
echo "  Note: printer.cfg, profiles, and bakesail_macros.cfg were left in place."
echo "  Remove ${HOME}/bakesail manually if desired."
echo
