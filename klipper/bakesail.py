"""
bakesail.py — Klipper extra for Bakesail BGA rework station control.

Drop into ~/klipper/klippy/extras/  and add [bakesail] to printer.cfg.

Provides GCode commands:
  BGA_PROFILE_RUN PROFILE=<name>   — load and start a named profile
  BGA_PROFILE_PAUSE                 — pause current profile
  BGA_PROFILE_RESUME                — resume paused profile
  BGA_PROFILE_ABORT                 — abort, all heaters off, return to idle
  BGA_PROFILE_LIST                  — list available profiles

Device state machine:
  Idle ──► Running ──► Complete
             │ ▲
             ▼ │
           Paused
  Any state ──► Error   (on fault)
  Any state ──► Idle    (on abort)

  Note: 'Ready' is a valid state exposed to the frontend for a future
  "load but don't start" workflow. Not yet reachable via GCode commands.

Running substates: heating (ramp in progress) | dwelling | cooling

Pause semantics:
  - Pause mid-dwell:  wall clock keeps running against dwell duration.
                      On resume, if elapsed >= duration the stage is skipped
                      immediately; otherwise the remaining time is served.
  - Pause mid-ramp:   heater holds last setpoint. On resume the ramp
                      re-anchors from the current measured temperature so
                      the hardware doesn't skip a portion it never executed.
  - Pause mid-cool:   heaters stay off; resume re-enters cool monitoring.
"""

import os
import json
import logging

# Control loop tick interval — how often the state machine evaluates
CONTROL_INTERVAL = 0.5   # seconds

# Minimum setpoint change before we bother issuing a SET command
SETPOINT_RESOLUTION = 0.5  # °C

# ── State / substate string constants ────────────────────────────────────────

STATE_IDLE     = 'idle'
STATE_READY    = 'ready'       # profile loaded, not yet started (future use)
STATE_RUNNING  = 'running'
STATE_PAUSED   = 'paused'
STATE_COMPLETE = 'complete'
STATE_ERROR    = 'error'

SUB_NONE     = ''
SUB_HEATING  = 'heating'      # ramp stage in progress
SUB_DWELLING = 'dwelling'     # dwell stage in progress
SUB_COOLING  = 'cooling'      # cool stage in progress


# =============================================================================
# BakesailZone — one heater + one thermocouple
# =============================================================================

class BakesailZone:
    """
    Pairs a Klipper heater with a temperature sensor.
    Applies a per-zone offset to every setpoint so zones can track the same
    profile curve at different absolute temperatures.
    """

    def __init__(self, index, heater_name, sensor_name, offset, printer):
        self.index       = index
        self.heater_name = heater_name
        self.sensor_name = sensor_name
        self.offset      = offset     # °C added to profile target for this zone
        self._printer    = printer
        self._pheater    = None
        self._psensor    = None

    # Klipper objects aren't available at config parse time, so we resolve lazily
    def _resolve(self):
        if self._pheater is None:
            pheaters = self._printer.lookup_object('heaters')
            self._pheater = pheaters.lookup_heater(self.heater_name)
        if self._psensor is None:
            self._psensor = self._printer.lookup_object(self.sensor_name)

    def get_temp(self):
        """Return current measured temperature for this zone."""
        self._resolve()
        current, _target = self._psensor.get_temp(0)
        return current

    def set_target(self, profile_target):
        """
        Set this zone's heater target.
        Applies zone offset: actual_target = profile_target + offset.
        Passing 0 turns the heater off (Klipper convention).
        """
        self._resolve()
        adjusted = (profile_target + self.offset) if profile_target > 0 else 0.0
        self._pheater.set_temp(adjusted)

    def turn_off(self):
        self._resolve()
        self._pheater.set_temp(0)

    def get_status(self):
        try:
            temp = round(self.get_temp(), 1)
        except Exception:
            temp = 0.0
        return {
            'index':   self.index,
            'heater':  self.heater_name,
            'sensor':  self.sensor_name,
            'offset':  self.offset,
            'temp':    temp,
        }


# =============================================================================
# BakesailProfile — a parsed, validated rework profile
# =============================================================================

class BakesailProfile:
    """
    Loads and validates a profile JSON file.

    Expected structure:
    {
      "name": "Lead-Free Standard",
      "description": "...",
      "rate_default": 2.0,
      "stages": [
        { "type": "ramp",  "target": 150, "rate": 2.0 },
        { "type": "dwell", "duration": 90 },
        { "type": "ramp",  "target": 245, "rate": 2.0 },
        { "type": "dwell", "duration": 15 },
        { "type": "cool" }
      ]
    }

    rate is °C/second.  Per-stage rate overrides rate_default.
    """

    RATE_MIN = 1.0
    RATE_MAX = 3.0

    def __init__(self, path):
        with open(path, 'r') as f:
            data = json.load(f)

        self.path         = path
        self.name         = data.get('name', os.path.splitext(os.path.basename(path))[0])
        self.description  = data.get('description', '')
        self.rate_default = float(data.get('rate_default', 2.0))
        self.stages       = self._parse_stages(data.get('stages', []))

        if not self.stages:
            raise ValueError("Profile '%s' has no stages" % self.name)

    def _parse_stages(self, raw):
        stages = []
        for i, s in enumerate(raw):
            stage_type = s.get('type')

            if stage_type == 'ramp':
                rate = float(s.get('rate', self.rate_default))
                if not (self.RATE_MIN <= rate <= self.RATE_MAX):
                    raise ValueError(
                        "Stage %d: rate %.1f out of range [%.1f–%.1f]°C/s"
                        % (i + 1, rate, self.RATE_MIN, self.RATE_MAX))
                stages.append({
                    'type':   'ramp',
                    'target': float(s['target']),
                    'rate':   rate,
                })

            elif stage_type == 'dwell':
                duration = float(s['duration'])
                if duration <= 0:
                    raise ValueError("Stage %d: dwell duration must be > 0" % (i + 1))
                stages.append({
                    'type':     'dwell',
                    'duration': duration,
                })

            elif stage_type == 'cool':
                stages.append({'type': 'cool'})

            else:
                raise ValueError("Stage %d: unknown type '%s'" % (i + 1, stage_type))

        return stages

    def to_dict(self):
        return {
            'name':         self.name,
            'description':  self.description,
            'rate_default': self.rate_default,
            'stages':       self.stages,
        }


# =============================================================================
# Bakesail — main extra class
# =============================================================================

class Bakesail:
    """
    Main Klipper extra.  Registered via [bakesail] in printer.cfg.

    Minimal printer.cfg config for one zone:
      [bakesail]
      heater_zone1: heater_generic bottom_zone
      sensor_zone1: temperature_sensor tc1
      profiles_path: ~/printer_data/config/bakesail_profiles

    Two-zone example with offset:
      [bakesail]
      heater_zone1: heater_generic bottom_zone
      sensor_zone1: temperature_sensor tc1
      offset_zone1: 0.0
      heater_zone2: heater_generic top_zone
      sensor_zone2: temperature_sensor tc2
      offset_zone2: 5.0
      profiles_path: ~/printer_data/config/bakesail_profiles
    """

    def __init__(self, config):
        self.printer = config.get_printer()
        self.reactor = self.printer.get_reactor()
        self.gcode   = self.printer.lookup_object('gcode')

        # Profiles directory
        raw_path = config.get(
            'profiles_path', '~/printer_data/config/bakesail_profiles')
        self.profiles_path = os.path.expanduser(raw_path)

        # Zone configuration
        self.zones = self._parse_zones(config)

        # ── State machine ──────────────────────────────────────────────────
        self.state     = STATE_IDLE
        self.substate  = SUB_NONE
        self.error_msg = ''

        # ── Active profile execution ───────────────────────────────────────
        self.profile              = None   # BakesailProfile currently loaded
        self.stage_index          = 0      # index into profile.stages
        self.stage_start_time     = 0.0    # reactor.monotonic() when stage began
        self.pause_start_time     = 0.0    # reactor.monotonic() when pause began
        self.total_pause_duration = 0.0    # cumulative seconds paused in this stage
        self.ramp_start_temp      = 0.0    # measured temp when current ramp began
        self.ramp_setpoint        = 0.0    # last setpoint issued during ramp

        # ── Control loop ───────────────────────────────────────────────────
        # Timer is registered but set to NEVER — only armed when running
        self._timer = self.reactor.register_timer(
            self._control_loop, self.reactor.NEVER)

        # ── GCode command registration ─────────────────────────────────────
        cmds = [
            ('BGA_PROFILE_RUN',    self.cmd_BGA_PROFILE_RUN,
             'Load and start a Bakesail rework profile (PROFILE=<name>)'),
            ('BGA_PROFILE_PAUSE',  self.cmd_BGA_PROFILE_PAUSE,
             'Pause the currently running profile'),
            ('BGA_PROFILE_RESUME', self.cmd_BGA_PROFILE_RESUME,
             'Resume a paused Bakesail profile'),
            ('BGA_PROFILE_ABORT',  self.cmd_BGA_PROFILE_ABORT,
             'Abort current profile, turn off all heaters, return to idle'),
            ('BGA_PROFILE_LIST',   self.cmd_BGA_PROFILE_LIST,
             'List available Bakesail profiles'),
        ]
        for name, handler, desc in cmds:
            self.gcode.register_command(name, handler, desc=desc)

        logging.info("Bakesail: initialised with %d zone(s)", len(self.zones))

    # =========================================================================
    # Configuration parsing
    # =========================================================================

    def _parse_zones(self, config):
        """
        Parse zone1..zone4 entries from [bakesail] config block.
        Zones must be defined contiguously starting at 1.
        Raises config.error on missing required keys.
        """
        zones = []
        for i in range(1, 5):
            heater_key = 'heater_zone%d' % i
            sensor_key = 'sensor_zone%d' % i
            offset_key = 'offset_zone%d' % i

            heater_name = config.get(heater_key, None)
            if heater_name is None:
                break  # no more zones

            sensor_name = config.get(sensor_key, None)
            if sensor_name is None:
                raise config.error(
                    "Bakesail: %s defined but %s is missing" % (heater_key, sensor_key))

            offset = config.getfloat(offset_key, 0.0)
            zones.append(BakesailZone(i, heater_name, sensor_name, offset, self.printer))

        if not zones:
            raise config.error(
                "Bakesail: no zones configured. "
                "Define at least heater_zone1 and sensor_zone1 in [bakesail].")
        return zones

    # =========================================================================
    # Profile I/O
    # =========================================================================

    def _load_profile(self, name):
        """
        Load a profile by name.  Tries <name> then <name>.json in profiles_path.
        Raises gcode.error on not found or parse failure.
        """
        candidates = [
            os.path.join(self.profiles_path, name),
            os.path.join(self.profiles_path, name + '.json'),
        ]
        for path in candidates:
            if os.path.isfile(path):
                try:
                    return BakesailProfile(path)
                except Exception as e:
                    raise self.gcode.error(
                        "Bakesail: failed to parse profile '%s': %s" % (name, e))

        raise self.gcode.error(
            "Bakesail: profile '%s' not found in %s" % (name, self.profiles_path))

    def _list_profiles(self):
        if not os.path.isdir(self.profiles_path):
            return []
        return sorted(
            fn[:-5] for fn in os.listdir(self.profiles_path)
            if fn.endswith('.json')
        )

    # =========================================================================
    # GCode command handlers
    # =========================================================================

    def cmd_BGA_PROFILE_RUN(self, gcmd):
        name = gcmd.get('PROFILE')

        if self.state == STATE_RUNNING:
            raise self.gcode.error(
                "Bakesail: profile '%s' already running. "
                "BGA_PROFILE_ABORT first." % (self.profile.name if self.profile else '?'))

        if self.state == STATE_ERROR:
            raise self.gcode.error(
                "Bakesail: in error state (%s). "
                "BGA_PROFILE_ABORT to reset." % self.error_msg)

        profile = self._load_profile(name)
        self._start_profile(profile)
        gcmd.respond_info(
            "Bakesail: starting profile '%s' (%d stages)"
            % (profile.name, len(profile.stages)))

    def cmd_BGA_PROFILE_PAUSE(self, gcmd):
        if self.state != STATE_RUNNING:
            raise self.gcode.error(
                "Bakesail: cannot pause — not running (state: %s)" % self.state)

        now = self.reactor.monotonic()
        self.pause_start_time = now
        self.state = STATE_PAUSED
        # Heaters hold their current setpoint — no changes on pause.
        # The board will continue to hold temperature on its own PID.
        gcmd.respond_info(
            "Bakesail: paused — stage %d/%d (%s)"
            % (self.stage_index + 1, len(self.profile.stages), self.substate))

    def cmd_BGA_PROFILE_RESUME(self, gcmd):
        if self.state != STATE_PAUSED:
            raise self.gcode.error(
                "Bakesail: cannot resume — not paused (state: %s)" % self.state)

        now = self.reactor.monotonic()
        pause_duration = now - self.pause_start_time
        self.total_pause_duration += pause_duration

        stage = self.profile.stages[self.stage_index]

        if stage['type'] == 'dwell':
            # Wall clock ran during pause — check if the dwell already expired
            elapsed = (now - self.stage_start_time) - self.total_pause_duration
            if elapsed >= stage['duration']:
                # Dwell complete: advance immediately rather than resuming
                self.state = STATE_RUNNING
                gcmd.respond_info(
                    "Bakesail: resumed — dwell completed during pause, advancing")
                self._advance_stage()
                return

        elif stage['type'] == 'ramp':
            # The hardware held setpoint while paused and did not ramp.
            # Re-anchor the ramp from current measured temperature so we
            # continue from where the board actually is, not where the timer
            # thinks it should be.
            avg_temp = self._avg_zone_temp()
            self.ramp_start_temp      = avg_temp
            self.ramp_setpoint        = avg_temp
            self.stage_start_time     = now
            self.total_pause_duration = 0.0   # fresh accounting from re-anchor

        # cool stage: heaters already off, nothing to re-establish

        self.state = STATE_RUNNING
        self.reactor.update_timer(self._timer, now + CONTROL_INTERVAL)
        gcmd.respond_info("Bakesail: resumed")

    def cmd_BGA_PROFILE_ABORT(self, gcmd):
        prev_state = self.state
        self._abort("user command")
        gcmd.respond_info(
            "Bakesail: aborted (was %s) — all heaters off" % prev_state)

    def cmd_BGA_PROFILE_LIST(self, gcmd):
        names = self._list_profiles()
        if names:
            gcmd.respond_info(
                "Bakesail profiles in %s:\n%s"
                % (self.profiles_path, "\n".join("  " + n for n in names)))
        else:
            gcmd.respond_info(
                "No profiles found in %s" % self.profiles_path)

    # =========================================================================
    # Profile lifecycle
    # =========================================================================

    def _start_profile(self, profile):
        """Initialise execution state and kick the control loop."""
        self.profile              = profile
        self.stage_index          = 0
        self.total_pause_duration = 0.0
        self.state                = STATE_RUNNING

        now = self.reactor.monotonic()
        self._enter_stage(now)
        self.reactor.update_timer(self._timer, now + CONTROL_INTERVAL)

    def _enter_stage(self, now):
        """Prepare internal state for the stage at self.stage_index."""
        self.stage_start_time     = now
        self.total_pause_duration = 0.0

        stage = self.profile.stages[self.stage_index]
        n     = self.stage_index + 1
        total = len(self.profile.stages)

        if stage['type'] == 'ramp':
            self.substate        = SUB_HEATING
            self.ramp_start_temp = self._avg_zone_temp()
            self.ramp_setpoint   = self.ramp_start_temp
            logging.info(
                "Bakesail: stage %d/%d — ramp to %.1f°C at %.1f°C/s (from %.1f°C)",
                n, total, stage['target'], stage['rate'], self.ramp_start_temp)

        elif stage['type'] == 'dwell':
            self.substate = SUB_DWELLING
            logging.info(
                "Bakesail: stage %d/%d — dwell %.0fs", n, total, stage['duration'])

        elif stage['type'] == 'cool':
            self.substate = SUB_COOLING
            self._all_heaters_off()
            logging.info("Bakesail: stage %d/%d — cooling (heaters off)", n, total)

    def _advance_stage(self):
        """Transition to the next stage, or complete the profile."""
        self.stage_index += 1
        if self.stage_index >= len(self.profile.stages):
            self._complete()
            return
        self._enter_stage(self.reactor.monotonic())

    def _complete(self):
        self.state    = STATE_COMPLETE
        self.substate = SUB_NONE
        self._all_heaters_off()
        self.reactor.update_timer(self._timer, self.reactor.NEVER)
        logging.info("Bakesail: profile '%s' complete", self.profile.name)

    def _abort(self, reason=''):
        self._all_heaters_off()
        self.reactor.update_timer(self._timer, self.reactor.NEVER)
        self.state                = STATE_IDLE
        self.substate             = SUB_NONE
        self.error_msg            = ''
        self.profile              = None
        self.stage_index          = 0
        self.total_pause_duration = 0.0
        logging.info("Bakesail: aborted (%s)", reason)

    def _fault(self, msg):
        """Enter error state — stops control loop, kills heaters."""
        self._all_heaters_off()
        self.reactor.update_timer(self._timer, self.reactor.NEVER)
        self.state     = STATE_ERROR
        self.substate  = SUB_NONE
        self.error_msg = msg
        logging.error("Bakesail FAULT: %s", msg)

    # =========================================================================
    # Control loop
    # =========================================================================

    def _control_loop(self, eventtime):
        """
        Timer callback.  Called every CONTROL_INTERVAL seconds while running.
        Returns the next scheduled call time (reactor convention).
        """
        if self.state != STATE_RUNNING:
            # Slow heartbeat when idle/paused/complete — keeps status fresh
            return eventtime + 1.0

        try:
            stage   = self.profile.stages[self.stage_index]
            elapsed = (eventtime - self.stage_start_time) - self.total_pause_duration

            if stage['type'] == 'ramp':
                advance = self._tick_ramp(stage, elapsed)
            elif stage['type'] == 'dwell':
                advance = self._tick_dwell(stage, elapsed)
            elif stage['type'] == 'cool':
                advance = self._tick_cool()
            else:
                self._fault("Unknown stage type: '%s'" % stage['type'])
                return self.reactor.NEVER

            if advance:
                self._advance_stage()

        except Exception as e:
            self._fault("Control loop exception at stage %d: %s"
                        % (self.stage_index + 1, str(e)))
            return self.reactor.NEVER

        return eventtime + CONTROL_INTERVAL

    def _tick_ramp(self, stage, elapsed):
        """
        Advance the heater setpoint toward stage target at the configured rate.
        Setpoint = ramp_start_temp + rate * elapsed, clamped to target.
        Transition triggers when average measured temp reaches target.

        Returns True when target reached.
        """
        target  = stage['target']
        rate    = stage['rate']
        desired = min(self.ramp_start_temp + rate * elapsed, target)

        # Only issue SET command when setpoint meaningfully changes
        if abs(desired - self.ramp_setpoint) >= SETPOINT_RESOLUTION:
            self.ramp_setpoint = desired
            for zone in self.zones:
                zone.set_target(desired)

        return self._avg_zone_temp() >= target

    def _tick_dwell(self, stage, elapsed):
        """
        Maintain current setpoint (held from end of preceding ramp).
        Returns True when dwell duration has elapsed.
        """
        return elapsed >= stage['duration']

    def _tick_cool(self):
        """
        v1: heaters already cut on stage entry (_enter_stage → _all_heaters_off).
        Profile advances to Complete immediately.

        # TODO: future milestone — controlled cool ramp with configurable rate
        #       and optional fan assist.  Will require a target_cool_temp config
        #       value and a rate parameter on the cool stage.
        """
        return True

    # =========================================================================
    # Zone helpers
    # =========================================================================

    def _avg_zone_temp(self):
        """Average measured temperature across all configured zones."""
        if not self.zones:
            return 0.0
        temps = [z.get_temp() for z in self.zones]
        return sum(temps) / len(temps)

    def _all_heaters_off(self):
        for zone in self.zones:
            try:
                zone.turn_off()
            except Exception as e:
                logging.warning(
                    "Bakesail: error turning off zone %d heater: %s", zone.index, e)

    # =========================================================================
    # Status reporting — consumed by Moonraker → frontend
    # =========================================================================

    def get_status(self, eventtime):
        """
        Called by Moonraker on every status poll.
        Exposed as the 'bakesail' object in Moonraker's objects namespace.
        Frontend subscribes via websocket: {"method": "printer.objects.subscribe",
                                            "params": {"objects": {"bakesail": null}}}
        """
        stage_info = {}

        if self.profile is not None and self.state in (STATE_RUNNING, STATE_PAUSED):
            stage = self.profile.stages[self.stage_index]
            elapsed = (eventtime - self.stage_start_time) - self.total_pause_duration

            stage_info = {
                'index':  self.stage_index,        # 0-based
                'number': self.stage_index + 1,    # 1-based for display
                'count':  len(self.profile.stages),
                'type':   stage['type'],
            }

            if stage['type'] == 'dwell':
                remaining = max(0.0, stage['duration'] - elapsed)
                stage_info.update({
                    'duration':  stage['duration'],
                    'elapsed':   round(elapsed, 1),
                    'remaining': round(remaining, 1),
                })
            elif stage['type'] == 'ramp':
                stage_info.update({
                    'target':   stage['target'],
                    'rate':     stage['rate'],
                    'setpoint': round(self.ramp_setpoint, 1),
                })

        return {
            # State machine
            'state':    self.state,
            'substate': self.substate,
            'error':    self.error_msg,
            # Active profile
            'profile':  self.profile.name if self.profile else '',
            'stage':    stage_info,
            # Live zone data
            'zones':    [z.get_status() for z in self.zones],
        }


# =============================================================================
# Klipper extra entry point
# =============================================================================

def load_config(config):
    return Bakesail(config)
