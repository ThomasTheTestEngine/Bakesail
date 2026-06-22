# Bakesail

Open source BGA rework station and reflow oven control, built on top of Klipper + Moonraker + MainsailOS.

## Install

Run on a fresh MainsailOS image over SSH:

```bash
curl -sSL https://raw.githubusercontent.com/[org]/bakesail/main/install.sh | bash
```

Open a browser to your Pi's IP address. The setup wizard will run on first visit.

## Uninstall / Restore Mainsail

```bash
~/bakesail/scripts/uninstall.sh
```

Your `printer.cfg`, profiles, and Klipper installation are left intact.

---

## Project Structure

```
bakesail/
├── install.sh                      # Installer (entry point)
├── scripts/
│   └── uninstall.sh                # Restores Mainsail, removes Bakesail
├── config/
│   ├── nginx/
│   │   └── bakesail.nginx.conf     # nginx site config (replaces Mainsail's)
│   ├── profiles/
│   │   └── lead_free_standard.json # Example reflow profile
│   └── bakesail_macros.cfg         # Klipper macros (test pin, estop)
└── src/
    ├── klipper/
    │   └── bakesail.py             # Klipper extra — profile runner + state machine
    └── frontend/                   # Vue.js SPA
        ├── package.json
        ├── vite.config.js
        ├── index.html
        └── src/
            ├── main.js
            ├── App.vue
            ├── router/
            │   └── index.js        # Vue Router — tabs
            ├── composables/
            │   └── useMoonraker.js # Moonraker WS + REST connection
            ├── stores/
            │   └── device.js       # Pinia store — device state
            └── views/
                ├── Dashboard.vue
                ├── ProfileManager.vue
                ├── Cameras.vue
                ├── Calibration.vue
                ├── Alignment.vue
                ├── Settings.vue
                └── wizard/
                    └── SetupWizard.vue
```

## Architecture

- **Klipper extra** (`bakesail.py`) — profile execution engine and state machine. Loaded by Klipper on startup. Exposes state via Klipper's status reporting.
- **Moonraker** — unchanged. Bakesail consumes its existing REST + websocket API only.
- **Frontend** — Vue 3 SPA served by nginx. Talks exclusively to Moonraker.
- **nginx** — replaces Mainsail's site config. Mainsail config is backed up and restorable.

## Hardware Targets

- Host: BigTreeTech Pi 1.2 (or any Raspberry Pi / SBC running MainsailOS)
- MCU: Any Klipper-compatible board (BTT SKR Mini E3 and similar tested)
- Thermocouples: MAX31855 (SPI)
- Camera: USB webcam via Crowsnest
