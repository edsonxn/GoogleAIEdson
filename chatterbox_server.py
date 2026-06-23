#!/usr/bin/env python3
"""
Chatterbox TTS HTTP server — carga el modelo una vez, atiende POST /generate.
Puerto por defecto: 7171
"""
import sys, os, json, threading, argparse

# Usar modelos ya descargados, no conectar a HuggingFace Hub
os.environ.setdefault('HF_HUB_OFFLINE', '1')
os.environ.setdefault('TRANSFORMERS_OFFLINE', '1')

from http.server import HTTPServer, BaseHTTPRequestHandler

# Prioridad: paquete instalado (pip install chatterbox-tts), luego repo local
_REPO_SRC = r'C:\chatterbox\repo\src'
if os.path.isdir(_REPO_SRC):
    sys.path.insert(0, _REPO_SRC)

import torch
import torchaudio as ta

_model = None
_lock  = threading.Lock()

def _device():
    if torch.cuda.is_available(): return 'cuda'
    if getattr(getattr(torch, 'backends', None), 'mps', None) and torch.backends.mps.is_available(): return 'mps'
    return 'cpu'

def _load():
    global _model
    from chatterbox.tts import ChatterboxTTS
    dev = _device()
    print(f'[Chatterbox] Cargando modelo en {dev}...', flush=True)
    _model = ChatterboxTTS.from_pretrained(device=dev)
    print('[Chatterbox] Modelo listo ✓', flush=True)

def _get():
    if _model is None: _load()
    return _model


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_): pass

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == '/health':
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain')
            self.end_headers()
            self.wfile.write(b'OK')
        else:
            self.send_response(404); self.end_headers()

    def do_POST(self):
        if self.path != '/generate':
            self.send_response(404); self.end_headers(); return

        try:
            body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))))
        except Exception as e:
            self._json(400, {'error': f'JSON invalido: {e}'}); return

        text         = body.get('text', '').strip()
        output       = body.get('output', '').strip()
        voice        = body.get('voice') or None
        exaggeration = float(body.get('exaggeration', 0.5))
        cfg_weight   = float(body.get('cfg_weight', 0.5))

        if not text:   self._json(400, {'error': 'text requerido'}); return
        if not output: self._json(400, {'error': 'output requerido'}); return

        try:
            with _lock:
                m = _get()
                kw = {'exaggeration': exaggeration, 'cfg_weight': cfg_weight}
                if voice and os.path.isfile(voice):
                    kw['audio_prompt_path'] = voice
                wav = m.generate(text, **kw)
                out_dir = os.path.dirname(output)
                if out_dir: os.makedirs(out_dir, exist_ok=True)
                ta.save(output, wav, m.sr)
            self._json(200, {'success': True, 'output': output})
        except Exception as e:
            print(f'[Chatterbox] Error: {e}', flush=True)
            self._json(500, {'error': str(e)})


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=7171)
    args = ap.parse_args()
    _load()
    srv = HTTPServer(('127.0.0.1', args.port), Handler)
    print(f'[Chatterbox] Servidor en http://127.0.0.1:{args.port}', flush=True)
    try: srv.serve_forever()
    except KeyboardInterrupt: print('[Chatterbox] Detenido.')
