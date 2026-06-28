#!/usr/bin/env python3
"""
Chatterbox Multilingual TTS HTTP server.
Puerto por defecto: 7171
"""
import sys, os, json, threading, argparse

# Forzar UTF-8 en stdout/stderr para evitar UnicodeEncodeError en Windows (CP1252)
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

from http.server import HTTPServer, BaseHTTPRequestHandler

# Prioridad: paquete instalado (pip install chatterbox-tts), luego repo local
_REPO_SRC = r'C:\chatterbox\repo\src'
if os.path.isdir(_REPO_SRC):
    sys.path.insert(0, _REPO_SRC)

import re
import torch
import torchaudio as ta
import numpy as np

# Audio de referencia por idioma (igual que multilingual_app.py)
LANGUAGE_AUDIO = {
    "ar": "https://storage.googleapis.com/chatterbox-demo-samples/mtl_prompts/ar_f/ar_prompts2.flac",
    "da": "https://storage.googleapis.com/chatterbox-demo-samples/mtl_prompts/da_m1.flac",
    "de": "https://storage.googleapis.com/chatterbox-demo-samples/mtl_prompts/de_f1.flac",
    "el": "https://storage.googleapis.com/chatterbox-demo-samples/mtl_prompts/el_m.flac",
    "en": "https://storage.googleapis.com/chatterbox-demo-samples/mtl_prompts/en_f1.flac",
    "es": "https://storage.googleapis.com/chatterbox-demo-samples/mtl_prompts/es_f1.flac",
    "fi": "https://storage.googleapis.com/chatterbox-demo-samples/mtl_prompts/fi_m.flac",
    "fr": "https://storage.googleapis.com/chatterbox-demo-samples/mtl_prompts/fr_f1.flac",
    "hi": "https://storage.googleapis.com/chatterbox-demo-samples/mtl_prompts/hi_f1.flac",
    "it": "https://storage.googleapis.com/chatterbox-demo-samples/mtl_prompts/it_m1.flac",
    "ja": "https://storage.googleapis.com/chatterbox-demo-samples/mtl_prompts/ja/ja_prompts1.flac",
    "ko": "https://storage.googleapis.com/chatterbox-demo-samples/mtl_prompts/ko_f.flac",
    "nl": "https://storage.googleapis.com/chatterbox-demo-samples/mtl_prompts/nl_m.flac",
    "pl": "https://storage.googleapis.com/chatterbox-demo-samples/mtl_prompts/pl_m.flac",
    "pt": "https://storage.googleapis.com/chatterbox-demo-samples/mtl_prompts/pt_m1.flac",
    "ru": "https://storage.googleapis.com/chatterbox-demo-samples/mtl_prompts/ru_m.flac",
    "sv": "https://storage.googleapis.com/chatterbox-demo-samples/mtl_prompts/sv_f.flac",
    "tr": "https://storage.googleapis.com/chatterbox-demo-samples/mtl_prompts/tr_m.flac",
    "zh": "https://storage.googleapis.com/chatterbox-demo-samples/mtl_prompts/zh_f2.flac",
}

_model = None
_lock  = threading.Lock()

def _device():
    if torch.cuda.is_available(): return 'cuda'
    if getattr(getattr(torch, 'backends', None), 'mps', None) and torch.backends.mps.is_available(): return 'mps'
    return 'cpu'

def _load():
    global _model
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS
    dev = _device()
    print(f'[Chatterbox] Cargando modelo multilingue en {dev}...', flush=True)
    _model = ChatterboxMultilingualTTS.from_pretrained(device=dev)
    print('[Chatterbox] Modelo listo OK', flush=True)

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
        voice        = body.get('voice') or None        # ruta local de voz del usuario
        language     = body.get('language', 'es') or 'es'
        exaggeration = float(body.get('exaggeration', 0.5))
        cfg_weight   = float(body.get('cfg_weight', 0.5))
        temperature  = float(body.get('temperature', 0.8))

        if not text:   self._json(400, {'error': 'text requerido'}); return
        if not output: self._json(400, {'error': 'output requerido'}); return

        # Si el usuario no eligió voz propia, usar el audio de referencia del idioma
        audio_prompt = voice if (voice and os.path.isfile(voice)) else LANGUAGE_AUDIO.get(language)

        try:
            with _lock:
                m = _get()

                # Split into ~250-char chunks to bypass the ~15s per-call limit
                sentences = [s.strip() for s in re.split(r'(?<=[.!?])\s+', text) if s.strip()]
                if not sentences:
                    sentences = [text]

                chunks = []
                cur = ''
                for s in sentences:
                    if len(cur) + len(s) + 1 <= 250:
                        cur = (cur + ' ' + s).strip()
                    else:
                        if cur:
                            chunks.append(cur)
                        cur = s
                if cur:
                    chunks.append(cur)

                # Ensure every chunk ends with terminal punctuation so the model
                # produces a closed prosodic contour (avoids cut-off-sounding audio)
                chunks = [
                    c if c and c[-1] in '.!?…' else c + '.'
                    for c in chunks if c
                ]

                print(f'[Chatterbox] lang={language} prompt={audio_prompt} chunks={len(chunks)}', flush=True)
                silence = np.zeros(int(m.sr * 0.3), dtype=np.float32)
                wavs = []
                current_prompt = audio_prompt  # solo en el primer chunk
                for i, chunk in enumerate(chunks):
                    print(f'[Chatterbox] Chunk {i+1}/{len(chunks)}: {chunk[:60]}', flush=True)
                    w = m.generate(
                        chunk,
                        language_id=language,
                        audio_prompt_path=current_prompt,
                        exaggeration=exaggeration,
                        cfg_weight=cfg_weight,
                        temperature=temperature,
                    )
                    wavs.append(w.squeeze(0).cpu().numpy() if hasattr(w, 'squeeze') else np.array(w))
                    if i < len(chunks) - 1:
                        wavs.append(silence)
                    current_prompt = None  # chunks siguientes reusan las condiciones ya cargadas

                full = np.concatenate(wavs)
                tensor = torch.from_numpy(full).unsqueeze(0)
                out_dir = os.path.dirname(output)
                if out_dir: os.makedirs(out_dir, exist_ok=True)
                ta.save(output, tensor, m.sr)
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
