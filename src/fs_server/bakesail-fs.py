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
        elif ep == '/search':    self._search(get('path', '/'), get('q', ''))
        else:                    self._err(404, 'Not found')

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
        elif ep == '/write':     self._write(get('path'))
        else:                    self._err(404, 'Not found')

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


if __name__ == '__main__':
    server = http.server.HTTPServer(('127.0.0.1', FS_PORT), FSHandler)
    logging.info('Bakesail FS server listening on 127.0.0.1:%d', FS_PORT)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
