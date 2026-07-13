#!/usr/bin/env python3
"""
bakesail-fs.py — Bakesail FS server (standalone)

Lightweight HTTP file-browser API on port 7127, proxied by nginx at
/bakesail/. Runs as a dedicated systemd service (bakesail-fs.service)
so it doesn't depend on the [bakesail] Klipper extra being loaded.

Endpoints:
  GET  /info          → {"home": "/home/<user>", "version": "1.0"}
  GET  /list          → {"path":…, "dirs":[…], "files":[…]}
  GET  /download      → file stream
  POST /upload        → multipart upload into ?dir=
  POST /mkdir         → create directory at ?path=
  DELETE /delete      → delete file or dir at ?path=
  GET  /search        → {"results":[…]} filename search under ?path=&q=
"""

import http.server
import os
import json
import email.parser
import urllib.parse
import shutil
import logging
import sys
import re
import struct
import threading
import queue

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [bakesail-fs] %(levelname)s %(message)s',
    stream=sys.stdout,
)

FS_PORT = 7127


class FSHandler(http.server.BaseHTTPRequestHandler):

    def do_GET(self):
        p, _, qs_raw = self.path.partition('?')
        qs  = urllib.parse.parse_qs(qs_raw)
        get = lambda k, d='': qs.get(k, [d])[0]
        ep  = p.rstrip('/')

        if   ep == '/info':      self._info()
        elif ep == '/list':      self._list(get('path', os.path.expanduser('~')))
        elif ep == '/download':  self._download(get('path'))
        elif ep == '/read':      self._read(get('path'))
        elif ep == '/search':         self._search(get('path', '/'), get('q', ''))
        elif ep == '/gcode-preview':      self._gcode_preview(get('path'))
        elif ep == '/gcode-preview-meta':  self._gcode_preview_meta(get('path'))
        elif ep == '/gcode-full':             self._gcode_full(get('path'))
        elif ep == '/gcode-full-meta':        self._gcode_full_meta(get('path'))
        else:                                 self._err(404, 'Not found')

    def do_POST(self):
        p, _, qs_raw = self.path.partition('?')
        qs  = urllib.parse.parse_qs(qs_raw)
        get = lambda k, d='': qs.get(k, [d])[0]
        ep  = p.rstrip('/')

        if   ep == '/upload':    self._upload(get('dir', os.path.expanduser('~')))
        elif ep == '/mkdir':     self._mkdir(get('path'))
        elif ep == '/delete':    self._delete(get('path'))
        elif ep == '/duplicate': self._duplicate(get('path'))
        elif ep == '/rename':    self._rename(get('path'), get('name'))
        elif ep == '/write':          self._write(get('path'))
        elif ep == '/gcode-parse':         self._gcode_parse(get('path'))
        elif ep == '/gcode-parse-full':     self._gcode_parse_full(get('path'))
        else:                               self._err(404, 'Not found')

    def do_DELETE(self):
        _, _, qs_raw = self.path.partition('?')
        qs  = urllib.parse.parse_qs(qs_raw)
        path = qs.get('path', [''])[0]
        self._delete(path)

    # ── Endpoints ─────────────────────────────────────────────────────────────

    def _info(self):
        self._json({'home': os.path.expanduser('~'), 'version': '1.0'})

    def _list(self, path):
        path = os.path.realpath(os.path.expanduser(path))
        if not os.path.isdir(path):
            return self._err(404, 'Not a directory: ' + path)
        try:
            entries = list(os.scandir(path))
        except PermissionError as e:
            return self._err(403, str(e))
        dirs, files = [], []
        for e in sorted(entries, key=lambda x: x.name.lower()):
            try:
                st = e.stat(follow_symlinks=False)
                ts = int(st.st_mtime)
                if e.is_dir(follow_symlinks=False):
                    dirs.append({'name': e.name, 'modified': ts})
                else:
                    files.append({'name': e.name, 'size': st.st_size, 'modified': ts})
            except Exception:
                pass
        self._json({'path': path, 'dirs': dirs, 'files': files})

    def _download(self, path):
        path = os.path.realpath(os.path.expanduser(path))
        if not os.path.isfile(path):
            return self._err(404, 'File not found: ' + path)
        try:
            size = os.path.getsize(path)
            self.send_response(200)
            self.send_header('Content-Type', 'application/octet-stream')
            self.send_header('Content-Disposition',
                             'attachment; filename="%s"' % os.path.basename(path))
            self.send_header('Content-Length', str(size))
            self.end_headers()
            with open(path, 'rb') as f:
                while True:
                    chunk = f.read(65536)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
        except Exception as e:
            logging.warning('Download error: %s', e)

    def _upload(self, dest_dir):
        dest_dir = os.path.realpath(os.path.expanduser(dest_dir))
        if not os.path.isdir(dest_dir):
            return self._err(400, 'Not a directory: ' + dest_dir)
        ct = self.headers.get('Content-Type', '')
        cl = int(self.headers.get('Content-Length', 0) or 0)
        body = self.rfile.read(cl)
        msg_bytes = ('Content-Type: ' + ct + '\r\n\r\n').encode() + body
        try:
            msg = email.parser.BytesParser().parsebytes(msg_bytes)
        except Exception as e:
            return self._err(400, 'Multipart parse error: ' + str(e))
        written = []
        for part in msg.walk():
            fn = part.get_filename()
            if fn:
                dest = os.path.join(dest_dir, os.path.basename(fn))
                data = part.get_payload(decode=True) or b''
                with open(dest, 'wb') as f:
                    f.write(data)
                written.append(fn)
        self._json({'written': written})

    def _mkdir(self, path):
        path = os.path.realpath(os.path.expanduser(path))
        try:
            os.makedirs(path, exist_ok=True)
            self._json({'created': path})
        except Exception as e:
            self._err(500, str(e))

    def _delete(self, path):
        path = os.path.realpath(os.path.expanduser(path))
        if not os.path.exists(path):
            return self._err(404, 'Not found: ' + path)
        try:
            if os.path.isdir(path) and not os.path.islink(path):
                shutil.rmtree(path)
            else:
                os.unlink(path)
            self._json({'deleted': path})
        except Exception as e:
            self._err(500, str(e))

    def _read(self, path):
        """Return file contents as text for the editor."""
        path = os.path.realpath(os.path.expanduser(path))
        if not os.path.isfile(path):
            return self._err(404, 'File not found: ' + path)
        try:
            size = os.path.getsize(path)
            if size > 5 * 1024 * 1024:  # 5 MB safety limit for editor
                return self._err(400, 'File too large for editor (>5 MB)')
            with open(path, 'r', errors='replace') as f:
                content = f.read()
            self._json({'path': path, 'content': content})
        except Exception as e:
            self._err(500, str(e))

    def _write(self, path):
        """Write text body to file (editor save)."""
        path = os.path.realpath(os.path.expanduser(path))
        cl   = int(self.headers.get('Content-Length', 0) or 0)
        body = self.rfile.read(cl)
        try:
            with open(path, 'wb') as f:
                f.write(body)
            self._json({'saved': path})
        except Exception as e:
            self._err(500, str(e))

    def _duplicate(self, path):
        """Copy a file, appending _2, _3, … before the extension until unique."""
        path = os.path.realpath(os.path.expanduser(path))
        if not os.path.isfile(path):
            return self._err(404, 'File not found: ' + path)
        base, ext = os.path.splitext(path)
        n = 2
        while True:
            dest = f'{base}_{n}{ext}'
            if not os.path.exists(dest):
                break
            n += 1
        try:
            shutil.copy2(path, dest)
            self._json({'original': path, 'copy': dest})
        except Exception as e:
            self._err(500, str(e))

    def _rename(self, path, new_name):
        """Rename a file or directory within the same parent directory."""
        path = os.path.realpath(os.path.expanduser(path))
        if not os.path.exists(path):
            return self._err(404, 'Not found: ' + path)
        if not new_name or '/' in new_name or new_name in ('.', '..'):
            return self._err(400, 'Invalid name: ' + new_name)
        dest = os.path.join(os.path.dirname(path), new_name)
        if os.path.exists(dest):
            return self._err(409, 'Already exists: ' + dest)
        try:
            os.rename(path, dest)
            self._json({'renamed': dest})
        except Exception as e:
            self._err(500, str(e))

    def _gcode_parse(self, path):
        """Trigger async parse of a gcode file. Returns immediately."""
        path = os.path.realpath(os.path.expanduser(path))
        if not os.path.isfile(path):
            return self._err(404, 'File not found: ' + path)
        if not path.lower().endswith(('.gcode', '.gc', '.g', '.gco')):
            return self._err(400, 'Not a gcode file')
        out = path + PREVIEW_SUFFIX
        if path not in PARSE_LOCK:
            PARSE_LOCK[path] = True
            PARSE_QUEUE.put(path)
            self._json({'status': 'queued', 'path': path, 'out': out})
        else:
            self._json({'status': 'already_parsing', 'path': path})

    def _gcode_preview(self, path):
        """Serve the binary preview file for a gcode path."""
        path = os.path.realpath(os.path.expanduser(path))
        out  = path + PREVIEW_SUFFIX
        if not os.path.isfile(out):
            return self._err(404, 'Preview not ready: ' + out)
        try:
            size = os.path.getsize(out)
            self.send_response(200)
            self.send_header('Content-Type', 'application/octet-stream')
            self.send_header('Content-Length', str(size))
            self.end_headers()
            with open(out, 'rb') as f:
                while True:
                    chunk = f.read(65536)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
        except Exception as e:
            logging.warning('Preview serve error: %s', e)

    def _gcode_preview_meta(self, path):
        """Return JSON metadata about parse status for a gcode file."""
        path = os.path.realpath(os.path.expanduser(path))
        out  = path + PREVIEW_SUFFIX
        parsing = path in PARSE_LOCK
        ready   = os.path.isfile(out)
        meta = {
            'path':    path,
            'out':     out,
            'ready':   ready,
            'parsing': parsing,
            'size':    os.path.getsize(out) if ready else 0,
            'mtime':   int(os.path.getmtime(out)) if ready else 0,
        }
        self._json(meta)

    def _gcode_parse_full(self, path):
        path = os.path.realpath(os.path.expanduser(path))
        if not os.path.isfile(path):
            return self._err(404, 'File not found: ' + path)
        key = path + ':full'
        out = path + FULL_SUFFIX
        if key not in PARSE_LOCK:
            PARSE_LOCK[key] = True
            FULL_PARSE_QUEUE.put(path)
            self._json({'status': 'queued', 'out': out})
        else:
            self._json({'status': 'already_parsing'})

    def _gcode_full(self, path):
        path = os.path.realpath(os.path.expanduser(path))
        out  = path + FULL_SUFFIX
        if not os.path.isfile(out):
            return self._err(404, 'Full parse not ready')
        try:
            size = os.path.getsize(out)
            self.send_response(200)
            self.send_header('Content-Type', 'application/octet-stream')
            self.send_header('Content-Length', str(size))
            self.end_headers()
            with open(out, 'rb') as f:
                while True:
                    chunk = f.read(65536)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
        except Exception as e:
            logging.warning('gcode-full serve error: %s', e)

    def _gcode_full_meta(self, path):
        path = os.path.realpath(os.path.expanduser(path))
        out  = path + FULL_SUFFIX
        key  = path + ':full'
        self._json({
            'ready':   os.path.isfile(out),
            'parsing': key in PARSE_LOCK,
            'size':    os.path.getsize(out) if os.path.isfile(out) else 0,
        })

    def _search(self, root, q):
        root = os.path.realpath(os.path.expanduser(root))
        q    = q.lower()
        results = []
        MAX = 200
        try:
            for dirpath, dirnames, filenames in os.walk(root):
                dirnames[:] = sorted(d for d in dirnames
                                     if not d.startswith('.') and d != '__pycache__')
                for name in sorted(dirnames):
                    if q in name.lower():
                        results.append({'path': os.path.join(dirpath, name), 'is_dir': True})
                        if len(results) >= MAX: break
                for name in sorted(filenames):
                    if q in name.lower():
                        results.append({'path': os.path.join(dirpath, name), 'is_dir': False})
                        if len(results) >= MAX: break
                if len(results) >= MAX: break
        except Exception:
            pass
        self._json({'results': results, 'root': root, 'query': q})

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _json(self, data):
        body = json.dumps(data).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _err(self, code, msg):
        body = json.dumps({'error': msg}).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        logging.info(fmt, *args)



FULL_SUFFIX = '.bsgcode'   # full gcode parse cache

# Feature type → index mapping (shared with frontend)
FEATURE_TYPES = {
    'outer_wall':   0,
    'inner_wall':   1,
    'infill':       2,
    'support':      3,
    'skin':         4,   # top/bottom solid layers
    'travel':       5,
    'other':        6,
}

_FEATURE_MAP = [
    (re.compile(r'TYPE:(?:External perimeter|WALL-OUTER|Outer wall)|FEATURE:Outer wall', re.I), 'outer_wall'),
    (re.compile(r'TYPE:(?:Perimeter|WALL-INNER|Inner wall|Inner Wall)|FEATURE:Inner wall', re.I), 'inner_wall'),
    (re.compile(r'TYPE:(?:fill|FILL|Infill|Internal infill)|FEATURE:Internal infill', re.I), 'infill'),
    (re.compile(r'TYPE:(?:Support|SUPPORT|Support material|Support interface)|FEATURE:Support', re.I), 'support'),
    (re.compile(r'TYPE:(?:Top surface skin|Solid infill|Bridge infill|skin|Skin)|FEATURE:(?:Top surface|Bridge)', re.I), 'skin'),
]

def _detect_feature(line):
    for pat, name in _FEATURE_MAP:
        if pat.search(line):
            return name
    return None


def _parse_gcode_full(gcode_path, out_path):
    """Full gcode parse: all extrusion types + travel moves + feature colours.

    Binary format (BSGF v1):
      Header 44 bytes:
        4s  b'BSGF'
        I   version=1
        f   minX minY minZ maxX maxY maxZ
        f   layerHeight
        I   layerCount
        I   extrusionSegCount
        I   travelSegCount

      Layer boundary table (layerCount * 2 * I):
        Per layer: extr_start_idx, travel_start_idx
        (index into the flat segment arrays below)

      Extrusion segments (extrusionSegCount * 8 floats + 1 byte feature):
        Stored sorted by layer.
        x1 y1 z  x2 y2 z  [unused_f unused_f]  feature_type_byte
        = 8 floats (32 bytes) + 1 byte, padded to 33 bytes per seg

      Travel segments (travelSegCount * 6 floats):
        x1 y1 z  x2 y2 z
    """
    try:
        logging.info('[full-parse] parsing %s', gcode_path)

        layers = []          # [{'z': f, 'h': f, 'extr': [(x1,y1,x2,y2,feat)], 'trav': [(x1,y1,x2,y2)]}]
        cur_z = 0.0
        prev_z = None
        cur_extr = []
        cur_trav = []
        cur_feature = 'other'
        last_x = last_y = None
        last_e = 0.0
        rel_e  = False
        is_traveling = False

        min_x = min_y = min_z =  1e9
        max_x = max_y = max_z = -1e9

        def flush():
            nonlocal cur_extr, cur_trav, prev_z
            if prev_z is not None:
                layers.append({'z': prev_z, 'extr': cur_extr, 'trav': cur_trav})
            cur_extr = []
            cur_trav = []

        with open(gcode_path, 'r', errors='replace', buffering=1<<20) as f:
            for raw in f:
                line = raw.strip()
                if not line:
                    continue

                if line.upper().startswith('M83'):
                    rel_e = True; continue
                if line.upper().startswith('M82'):
                    rel_e = False; continue

                if line.startswith(';'):
                    feat = _detect_feature(line)
                    if feat:
                        cur_feature = feat
                        is_traveling = False
                    continue

                zm = _Z_MOVE_RE.match(line)
                if zm:
                    new_z = round(float(zm.group(1)), 4)
                    # Ignore Z-hops: only treat as new layer if Z increases
                    # by at least 0.05mm above the current print Z
                    if new_z > cur_z + 0.04:
                        flush()
                        prev_z = cur_z
                        cur_z  = new_z
                        min_z = min(min_z, new_z)
                        max_z = max(max_z, new_z)
                        last_x = last_y = None
                    # Z-hops (up then back) are silently ignored
                    continue

                if not line.upper().startswith('G1'):
                    if line.upper().startswith('G0'):
                        is_traveling = True
                    continue

                m = _XY_RE.search(line)
                if not m:
                    continue
                x, y = float(m.group(1)), float(m.group(2))
                e_str = m.group(3)
                has_e = e_str is not None
                extruding = False
                if has_e:
                    e_val = float(e_str)
                    if rel_e:
                        extruding = e_val > 0.0001
                        last_e += e_val
                    else:
                        extruding = e_val > last_e + 0.0001
                        last_e = e_val

                if last_x is not None:
                    if extruding and not is_traveling:
                        fi = FEATURE_TYPES.get(cur_feature, 6)
                        cur_extr.append((last_x, last_y, x, y, fi))
                        min_x = min(min_x, last_x, x)
                        max_x = max(max_x, last_x, x)
                        min_y = min(min_y, last_y, y)
                        max_y = max(max_y, last_y, y)
                    elif not extruding:
                        cur_trav.append((last_x, last_y, x, y))
                        is_traveling = True

                if has_e and extruding:
                    is_traveling = False
                last_x, last_y = x, y

        flush()

        # Modal layer height
        heights = []
        for i in range(1, len(layers)):
            dz = round(layers[i]['z'] - layers[i-1]['z'], 4)
            if 0.01 < dz < 1.0:
                heights.append(dz)
        modal_h = max(set(heights), key=heights.count) if heights else 0.2

        total_extr  = sum(len(l['extr']) for l in layers)
        total_trav  = sum(len(l['trav']) for l in layers)

        with open(out_path, 'wb') as f:
            # Header
            f.write(struct.pack('<4sIfffffffIII',
                b'BSGF', 1,
                min_x if min_x < 1e8 else 0,
                min_y if min_y < 1e8 else 0,
                min_z if min_z < 1e8 else 0,
                max_x if max_x > -1e8 else 0,
                max_y if max_y > -1e8 else 0,
                max_z if max_z > -1e8 else 0,
                modal_h,
                len(layers), total_extr, total_trav,
            ))

            # Layer boundary table: [extr_start, trav_start] per layer
            ei = ti = 0
            for layer in layers:
                f.write(struct.pack('<II', ei, ti))
                ei += len(layer['extr'])
                ti += len(layer['trav'])
            # sentinel
            f.write(struct.pack('<II', total_extr, total_trav))

            # Extrusion segments (sorted by layer naturally)
            for layer in layers:
                z = layer['z']
                for (x1, y1, x2, y2, fi) in layer['extr']:
                    f.write(struct.pack('<ffffffB', x1, y1, z, x2, y2, z, fi))

            # Travel segments
            for layer in layers:
                z = layer['z']
                for (x1, y1, x2, y2) in layer['trav']:
                    f.write(struct.pack('<ffffff', x1, y1, z, x2, y2, z))

        logging.info('[full-parse] wrote %s (%d layers, %d extr, %d trav)',
                     out_path, len(layers), total_extr, total_trav)
    except Exception as e:
        logging.exception('[full-parse] error for %s: %s', gcode_path, e)
    finally:
        PARSE_LOCK.pop(gcode_path + ':full', None)


FULL_PARSE_QUEUE = queue.Queue()

def _full_parse_worker():
    while True:
        path = FULL_PARSE_QUEUE.get()
        try:
            out = path + FULL_SUFFIX
            _parse_gcode_full(path, out)
        finally:
            FULL_PARSE_QUEUE.task_done()

_tf = threading.Thread(target=_full_parse_worker, daemon=True)
_tf.start()

# ── Gcode Preview Parser ──────────────────────────────────────────────────────


PREVIEW_SUFFIX  = '.bspreview'   # compact binary cache
PARSE_QUEUE     = queue.Queue()
PARSE_LOCK      = {}             # path → True while parsing

# Feature type tags for common slicers
# Returns True if the comment line changes feature type to one we want
_OUTER_WALL_RE = re.compile(
    r'TYPE:(?:External perimeter|WALL-OUTER|Outer wall)'
    r'|feature outer wall'
    r'|FEATURE:Outer wall',
    re.IGNORECASE
)
_INNER_WALL_RE = re.compile(
    r'TYPE:(?:Perimeter|WALL-INNER|Inner wall|Inner Wall)'
    r'|feature inner wall'
    r'|FEATURE:Inner wall',
    re.IGNORECASE
)
_SUPPORT_RE = re.compile(
    r'TYPE:(?:Support|SUPPORT|Support material|Support interface)'
    r'|feature support'
    r'|FEATURE:Support',
    re.IGNORECASE
)
_LAYER_RE  = re.compile(r'(?:^;LAYER:|layer_num|layer_change)', re.IGNORECASE)
_Z_MOVE_RE = re.compile(r'^G[01]\s[^;]*Z([\d.]+)', re.IGNORECASE)
_XY_RE     = re.compile(r'X([\d.]+)\s*Y([\d.]+)(?:\s*E([\d.eE+\-]+))?', re.IGNORECASE)

def _parse_gcode_preview(gcode_path, out_path):
    """Parse gcode for preview: outer walls + inner walls + supports.

    Output binary format (little-endian):
      Header (32 bytes):
        4s  magic   b'BSPV'
        I   version 1
        f   min_x
        f   min_y
        f   min_z
        f   max_x
        f   max_y
        f   max_z
        f   layer_height (modal average)
        I   layer_count

      Per layer (variable):
        f   z
        f   height          (this layer's thickness)
        I   seg_count       (number of XY segments = pairs of floats)
        <seg_count * 4 * f> x1 y1 x2 y2 ...
    """
    try:
        logging.info('[preview] parsing %s', gcode_path)
        layers   = []          # list of {'z': float, 'segs': list of (x1,y1,x2,y2)}
        cur_z    = 0.0
        prev_z   = None
        cur_segs = []
        want_extrusion = False  # are we in a feature we care about?
        last_x   = None
        last_y   = None
        last_e   = 0.0          # track absolute E position
        rel_e    = False        # M83 = relative extrusion
        min_x = min_y = min_z =  1e9
        max_x = max_y = max_z = -1e9

        def flush_layer():
            nonlocal cur_segs
            if cur_segs and prev_z is not None:
                layers.append({'z': prev_z, 'segs': cur_segs})
                cur_segs = []

        with open(gcode_path, 'r', errors='replace', buffering=1 << 20) as f:
            for raw in f:
                line = raw.strip()
                if not line:
                    continue

                # Track extrusion mode
                if line.upper().startswith('M83'):
                    rel_e = True; continue
                if line.upper().startswith('M82'):
                    rel_e = False; continue

                # Comment lines — detect feature/layer changes
                if line.startswith(';'):
                    if _OUTER_WALL_RE.search(line):
                        want_extrusion = True
                    elif _INNER_WALL_RE.search(line):
                        want_extrusion = True
                    elif _SUPPORT_RE.search(line):
                        want_extrusion = True
                    elif re.search(r'TYPE:|FEATURE:', line, re.IGNORECASE):
                        # Any other feature type: don't capture
                        want_extrusion = False
                    continue

                # Z change → new layer boundary (ignore Z-hops < 0.05mm rise)
                zm = _Z_MOVE_RE.match(line)
                if zm:
                    new_z = round(float(zm.group(1)), 4)
                    if new_z > cur_z + 0.04:
                        flush_layer()
                        prev_z = cur_z
                        cur_z  = new_z
                        min_z = min(min_z, new_z)
                        max_z = max(max_z, new_z)
                        last_x = last_y = None

                # XY moves in a wanted feature
                if not want_extrusion:
                    continue
                if not line.upper().startswith('G1'):
                    continue
                m = _XY_RE.search(line)
                if not m:
                    continue
                x, y = float(m.group(1)), float(m.group(2))
                e_str = m.group(3)
                is_extrusion = False
                if e_str is not None:
                    e_val = float(e_str)
                    if rel_e:
                        is_extrusion = e_val > 0.0001
                        last_e += e_val
                    else:
                        is_extrusion = e_val > last_e + 0.0001
                        last_e = e_val

                if is_extrusion and last_x is not None:
                    cur_segs.append((last_x, last_y, x, y))
                    min_x = min(min_x, last_x, x)
                    max_x = max(max_x, last_x, x)
                    min_y = min(min_y, last_y, y)
                    max_y = max(max_y, last_y, y)

                last_x, last_y = x, y

        flush_layer()

        # Compute modal layer height
        heights = []
        for i in range(1, len(layers)):
            dz = round(layers[i]['z'] - layers[i-1]['z'], 4)
            if 0.01 < dz < 1.0:
                heights.append(dz)
        modal_h = max(set(heights), key=heights.count) if heights else 0.2

        # Write binary
        with open(out_path, 'wb') as f:
            # Header
            f.write(struct.pack('<4sIfffffff I',
                b'BSPV', 1,
                min_x if min_x < 1e8 else 0,
                min_y if min_y < 1e8 else 0,
                min_z if min_z < 1e8 else 0,
                max_x if max_x > -1e8 else 0,
                max_y if max_y > -1e8 else 0,
                max_z if max_z > -1e8 else 0,
                modal_h,
                len(layers),
            ))
            # Layers
            for i, layer in enumerate(layers):
                segs = layer['segs']
                if i + 1 < len(layers):
                    h = round(layers[i+1]['z'] - layer['z'], 4)
                else:
                    h = modal_h
                h = max(0.05, min(h, 1.0))
                f.write(struct.pack('<ffI', layer['z'], h, len(segs)))
                if segs:
                    flat = [v for s in segs for v in s]
                    f.write(struct.pack('<%df' % len(flat), *flat))

        logging.info('[preview] wrote %s (%d layers, %d total segs)',
                     out_path, len(layers),
                     sum(len(l['segs']) for l in layers))
    except Exception as e:
        logging.exception('[preview] parse error for %s: %s', gcode_path, e)
    finally:
        PARSE_LOCK.pop(gcode_path, None)


def _parse_worker():
    while True:
        path = PARSE_QUEUE.get()
        try:
            out = path + PREVIEW_SUFFIX
            _parse_gcode_preview(path, out)
        finally:
            PARSE_QUEUE.task_done()


# Start background parse thread
_t = threading.Thread(target=_parse_worker, daemon=True)
_t.start()

if __name__ == '__main__':
    import socketserver
    class ThreadingServer(socketserver.ThreadingMixIn, http.server.HTTPServer): pass
    server = ThreadingServer(('127.0.0.1', FS_PORT), FSHandler)
    logging.info('Bakesail FS server listening on 127.0.0.1:%d', FS_PORT)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
