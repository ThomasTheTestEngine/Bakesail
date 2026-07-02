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
- **Frontend** — Vue 3 + Vite SPA, served by nginx on port 80. Talks exclusively to Moonraker, except for the terminal (see below).
- **nginx** — replaces Mainsail's site config on port 80. Mainsail config is backed up and fully restorable via the uninstall script. Also proxies `/terminal/ws` to a local `ttyd` instance for the browser terminal.
- **ttyd** — installed as a systemd service (`bakesail-ttyd`, port 7681, localhost only) to back the topbar terminal. Installed automatically by `install.sh`.

### Console / Terminal

The global topbar has a collapsible console bar with two modes: a Klipper gcode console (same data as Fluidd/Mainsail's console, via Moonraker's websocket) and a full shell terminal (`xterm.js` + `ttyd`, real PTY access to the Pi). This is the canonical implementation, available from every device type.

`ConsoleWidget.vue` is a second, self-contained console+terminal widget currently only used on `PrinterDashboard.vue`. Its terminal mode talks to Moonraker's own `/machine/terminal` endpoint rather than ttyd — a different backend from the topbar's. It's being kept as-is intentionally, as a starting point for fleshing out a dashboard-embeddable terminal widget down the road; it isn't wired into the shared widget system yet and shouldn't be assumed equivalent to the topbar terminal.

### Dashboard System

The dashboard is the core of the project. Every device type has its own dashboard component with its own set of widget types, but as of the current refactor they all share the same shell and, increasingly, the same widget implementations rather than each reimplementing them:

- **`useDashboardLayout.js`** — composable that manages widget positions, drag/resize, grid snap, and save/load. Layouts persist per device type as JSON files in the Moonraker config directory.
- **`WidgetShell.vue`** — wrapper that handles the customize-mode chrome (drag handle, resize handles, settings popout, remove button) around any widget's content.
- **`DashboardCustomizeBar.vue`** — shared "customize mode" shell: the gear button teleported into the global topbar, plus the Add Widget / Load Saved / Save As / Reset / Apply controls bar. `PrinterDashboard.vue` is the most fleshed-out dashboard and originated this pattern; `ThermalDashboard.vue` and `LaserDashboard.vue` now use the same component instead of their own toolbar/footer.
- **`DashboardRouter.vue`** — maps `deviceType` → dashboard component. Adding a new device type means adding one import and one map entry here.
- **Shared widget components** (`src/components/*Widget.vue`) — widgets whose data isn't tied to one device type live here once, not once per dashboard. `CameraWidget.vue` is the first of these. The plan is to keep pulling genuinely device-agnostic widgets (system monitor, status header) out of the per-dashboard files the same way as they get built out; widgets tied to real hardware specifics (toolhead jog, laser power, zone temperature) stay local to their dashboard.

### Adding a New Device Type

1. Create `src/frontend/src/views/YourDashboard.vue` — use `PrinterDashboard.vue` as a template. It already gets the shared customize shell for free via `<DashboardCustomizeBar>`; you only need to define `WIDGET_DEFS`, a default layout, and your device-specific widget templates.
2. Add it to the map in `DashboardRouter.vue`
3. Add a `<option>` for it in the Settings device type dropdown (`Settings.vue`)
4. Add any tab visibility rules (`hiddenFor` / `onlyFor`) to `ALL_TABS` in `router/index.js`

### Adding a Widget to an Existing Dashboard

1. Check whether the widget is device-agnostic (camera, generic status/monitor displays). If so, look for or add a shared component in `src/components/` instead of writing it inline — see `CameraWidget.vue` for the pattern.
2. Add an entry to that dashboard's `WIDGET_DEFS`. Set `multiple: true` if more than one instance should be addable at once (e.g. camera); omit it for widgets that only make sense once.
3. Add a `<template v-else-if="w.type === 'yourtype'">` block in the canvas section — either rendering the shared component, or inline markup for something genuinely device-specific.
4. Wire reactive data from `handleStatus()` into the local state object.

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
            ├── App.vue                 # Shell, topbar (incl. console/terminal bar), theme, connection status
            ├── router/
            │   └── index.js            # ALL_TABS — tab definitions + device visibility
            ├── composables/
            │   ├── useMoonraker.js     # WS connection, subscriptions, sendGcode
            │   ├── useDashboardLayout.js # Widget drag/resize/save/load
            │   └── useTestPins.js      # GPIO pool management for setup wizard
            ├── components/
            │   ├── WidgetShell.vue     # Customize-mode wrapper for all widgets
            │   ├── DashboardCustomizeBar.vue # Shared customize shell (gear + toolbar), used by all dashboards
            │   ├── CameraFeed.vue      # Low-level camera stream renderer
            │   ├── CameraWidget.vue    # Dashboard `camera` widget — wraps CameraFeed, shared by all dashboards
            │   └── ConsoleWidget.vue   # Dashboard console/terminal widget (PrinterDashboard only, experimental — see below)
            ├── stores/
            │   ├── device.js           # Live device state (rework types)
            │   └── settings.js         # Device config, persisted to bakesail_settings.json
            ├── utils/
            │   ├── configWriter.js     # Generates bakesail.cfg from settings store
            │   └── cameraTypes.js      # Camera type -> display label, shared everywhere a camera is shown
            └── views/
                ├── DashboardRouter.vue # deviceType → dashboard component map
                ├── ThermalDashboard.vue  # oven / ir_rework / hot_air / hot_plate
                ├── LaserDashboard.vue    # laser_plotter
                ├── PrinterDashboard.vue  # 3d_printer — most fleshed-out dashboard; shell pattern others follow
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
