# Bakesail

Open source Klipper-based control system for PCB rework and thermal process equipment — and any other Klipper-attached device that needs a better dashboard than it ships with.

Installs on top of MainsailOS and replaces Mainsail's frontend with a purpose-built interface featuring a fully customizable widget dashboard, a guided hardware setup wizard, and per-device-type tab layouts.

## Supported Device Types

| Type | Dashboard | Notes |
|------|-----------|-------|
| `oven` | Thermal | Reflow oven |
| `ir_rework` | Thermal | IR BGA rework station |
| `hot_air` | Thermal | Hot air rework |
| `hot_plate` | Thermal | Hot plate |
| `laser_plotter` | Laser | Laser cutter / plotter |
| `3d_printer` | Printer | 3D printer (Mainsail-equivalent) |

Each device type gets its own dashboard widget palette and default layout. All dashboards share the same drag-and-drop customization system.

## Install

Run on a fresh MainsailOS image over SSH:

```bash
curl -sSL https://raw.githubusercontent.com/ThomasTheTestEngine/Bakesail/main/install.sh | bash
```

Open a browser to your Pi's IP address. The setup wizard runs on first visit and walks you through pin assignment, hardware testing, and config generation.

Mainsail remains accessible at port 8888 and is linked from the sidebar.

## Uninstall / Restore Mainsail

```bash
~/bakesail/scripts/uninstall.sh
```

Your `printer.cfg`, profiles, and Klipper installation are left intact.

---

## Architecture

Bakesail is intentionally thin on top of the existing Klipper ecosystem:

- **`bakesail.py`** — Klipper extra. Implements the profile execution engine and device state machine for rework/thermal device types. Exposes state via Klipper's standard status reporting. Not used by the 3D printer or laser types — those talk directly to standard Klipper/Moonraker objects.
- **Moonraker** — completely unchanged. Bakesail uses its existing REST and WebSocket API only.
- **Frontend** — Vue 3 + Vite SPA, served by nginx on port 80. Talks exclusively to Moonraker.
- **nginx** — replaces Mainsail's site config on port 80. Mainsail config is backed up and fully restorable via the uninstall script.

### Dashboard System

The dashboard is the core of the project. Every device type has its own dashboard component with its own set of widget types. All dashboards share:

- **`useDashboardLayout.js`** — composable that manages widget positions, drag/resize, grid snap, and save/load. Layouts persist per device type as JSON files in the Moonraker config directory.
- **`WidgetShell.vue`** — wrapper that handles the customize-mode chrome (drag handle, resize handles, settings popout, remove button) around any widget's content.
- **`DashboardRouter.vue`** — maps `deviceType` → dashboard component. Adding a new device type means adding one import and one map entry here.

### Adding a New Device Type

1. Create `src/frontend/src/views/YourDashboard.vue` — use `PrinterDashboard.vue` as a template
2. Add it to the map in `DashboardRouter.vue`
3. Add a `<option>` for it in the Settings device type dropdown (`Settings.vue`)
4. Add any tab visibility rules (`hiddenFor` / `onlyFor`) to `ALL_TABS` in `router/index.js`

### Adding a Widget to an Existing Dashboard

1. Add an entry to `WIDGET_DEFS` in the dashboard file
2. Add a `<template v-else-if="w.type === 'yourtype'">` block in the canvas section
3. Wire reactive data from `handleStatus()` into the local state object

---

## Project Structure

```
bakesail/
├── install.sh
├── scripts/
│   └── uninstall.sh
├── config/
│   ├── nginx/
│   │   └── bakesail.nginx.conf
│   ├── profiles/
│   │   └── lead_free_standard.json
│   └── bakesail_macros.cfg
└── src/
    ├── klipper/
    │   └── bakesail.py                 # Klipper extra (rework/thermal types)
    └── frontend/
        └── src/
            ├── App.vue                 # Shell, sidebar, theme, connection status
            ├── router/
            │   └── index.js            # ALL_TABS — tab definitions + device visibility
            ├── composables/
            │   ├── useMoonraker.js     # WS connection, subscriptions, sendGcode
            │   ├── useDashboardLayout.js # Widget drag/resize/save/load
            │   └── useTestPins.js      # GPIO pool management for setup wizard
            ├── components/
            │   ├── WidgetShell.vue     # Customize-mode wrapper for all widgets
            │   └── CameraFeed.vue
            ├── stores/
            │   ├── device.js           # Live device state (rework types)
            │   └── settings.js         # Device config, persisted to bakesail_settings.json
            ├── utils/
            │   └── configWriter.js     # Generates bakesail.cfg from settings store
            └── views/
                ├── DashboardRouter.vue # deviceType → dashboard component map
                ├── ThermalDashboard.vue  # oven / ir_rework / hot_air / hot_plate
                ├── LaserDashboard.vue    # laser_plotter
                ├── PrinterDashboard.vue  # 3d_printer
                ├── Dashboard.vue         # legacy — superseded by ThermalDashboard
                ├── ProfileManager.vue
                ├── JobQueue.vue          # laser_plotter only
                ├── MaterialLibrary.vue   # laser_plotter only
                ├── Cameras.vue
                ├── Calibration.vue
                ├── Alignment.vue         # semi-auto / automatic only
                ├── Settings.vue
                └── wizard/
                    ├── SetupWizard.vue
                    └── TestPinButton.vue
```

## Hardware

- **Host:** Raspberry Pi 4 / BTT Pi 1.2 or any SBC running MainsailOS
- **MCU:** Any Klipper-compatible board (BTT SKR Mini E3, Octopus Pro, etc.)
- **Thermocouples:** MAX31855 (SPI) for rework/thermal types
- **Camera:** USB webcam via Crowsnest

## Stack

- [Klipper](https://github.com/Klipper3d/klipper) + [Moonraker](https://github.com/Arksine/moonraker) + [MainsailOS](https://github.com/mainsail-crew/MainsailOS)
- Vue 3 + Vite + Pinia
- nginx
