import requests
import json
import os
import time
import random
import shutil
from pathlib import Path

class ApplioTTS:
    def __init__(self, base_url="http://127.0.0.1:6969"):  # ← CORREGIDO: 6969 en lugar de 6968
        self.base_url = base_url
        # Copia tu hash o genera uno nuevo
        self.session_hash = "dw12123"  # o f"{random.getrandbits(40):x}"
        
    def text_to_speech(self, text, model="fr-FR-RemyMultilingualNeural", output_path=None):
        print(f"\n🎬 Iniciando TTS: «{text[:100]}...» (modelo={model})")
        print(f"🔑 Session hash: {self.session_hash}\n")
        
        # Probemos diferentes fn_index para encontrar el correcto
        indices_to_try = [94, 93, 95, 96, 92, 97, 91, 98, 90, 99]
        
        for fn_index in indices_to_try:
            print(f"🧪 Probando fn_index: {fn_index}")
            result = self._try_tts_with_index(text, model, output_path, fn_index)
            if result:
                print(f"✅ ¡Éxito con fn_index {fn_index}!")
                return result
            
        print("❌ No se pudo generar audio con ningún fn_index")
        return None
    
    def _try_tts_with_index(self, text, model, output_path, fn_index):
        
        # ——————————————————————————————————
        # 1) Payload COMPLETO a /queue/join
        # ——————————————————————————————————
        data = [
            True,    #  0 enable
            "",      #  1 session 
            text,    #  2 text
            model,   #  3 model
            0,       #  4 input_text_format
            0,       #  5 language
            0.75,    #  6 stability
            1,       #  7 similarity
            0.5,     #  8 speak_rate
            128,     #  9 sample_rate
            "rmvpe", # 10 extractor
            "C:\\applio2\\Applio\\assets\\audios\\tts_output.wav",     # 11 temp output
            "C:\\applio2\\Applio\\assets\\audios\\tts_rvc_output.wav", # 12 temp RVC
            "logs\\VOCES\\RemyOriginal.pth",                  # 13 modelo
            "",      # 14 (vacío)
            False,   # 15
            False,   # 16
            1,       # 17
            True,    # 18
            0.5,     # 19
            "WAV",   # 20
            None,    # 21
            "contentvec", #22
            None,    # 23
            0        # 24
        ]
        join_payload = {
            "data": data,
            "fn_index": 94,              # Volvamos al original
            "session_hash": self.session_hash
        }
        
        join_url = f"{self.base_url}/gradio_api/queue/join"
        print(f"➡️ POST {join_url}")
        
        try:
            res = requests.post(join_url, json=join_payload, headers={"Content-Type":"application/json"})
            res.raise_for_status()
            jr = res.json()
            print("📝 Join response:", jr, "\n")
            
            # Si devuelve nuevo hash, lo actualizamos
            if "session_hash" in jr:
                self.session_hash = jr["session_hash"]
                print(f"🔄 Nuevo session_hash: {self.session_hash}\n")
            
            # Ahora a escuchar el SSE hasta que termine
            return self._wait_for_result(output_path)
        
        except Exception as e:
            print("💥 Error uniéndonos a la cola:", e)
            return None

    def _wait_for_result(self, output_path=None):
        data_url = f"{self.base_url}/gradio_api/queue/data?session_hash={self.session_hash}"
        print(f"👂 Esperando resultados en {data_url}\n")
        
        with requests.get(data_url, stream=True, headers={"Accept":"text/event-stream"}) as resp:
            if resp.status_code != 200:
                print("🚫 Falló conexión SSE:", resp.status_code, resp.text)
                return None
            
            for raw in resp.iter_lines():
                if not raw:
                    continue
                line = raw.decode("utf-8").strip()
                
                if not line.startswith("data:"):
                    continue
                
                try:
                    evt = json.loads(line[5:])
                except json.JSONDecodeError:
                    continue
                
                msg = evt.get("msg", "")
                print(f"🔔 msg: {msg}")
                
                if msg == "process_completed":
                    out = evt.get("output", {}).get("data", [])
                    print(f"🔍 Output completo: {out}")
                    wav_paths = []
                    for item in out:
                        print(f"🔍 Analizando item: {item} (tipo: {type(item)})")
                        if isinstance(item, dict) and item.get("path", "").lower().endswith(".wav"):
                            wav_paths.append(item["path"])
                        elif isinstance(item, str) and item.lower().endswith(".wav"):
                            wav_paths.append(item)
                    
                    if not wav_paths:
                        print("⚠️ ¡Sorpresa! No encontré ningún .wav en output.data:", out)
                        return None
                    
                    selected = wav_paths[0]
                    print(f"📂 Ruta del WAV detectado: {selected}")
                    
                    if output_path:
                        os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
                        try:
                            shutil.copy(selected, output_path)
                            print(f"✅ Archivo copiado a: {output_path}\n")
                            return output_path
                        except Exception as e:
                            print(f"❌ Error copiando archivo: {e}")
                            return selected
                    else:
                        return selected
        
        print("⌛️ Stream cerrado sin resultado.")
        return None


if __name__ == "__main__":
    tts = ApplioTTS()
    texto = "Hola, este es un ejemplo mejorado con emojis 👍"
    modelo = "fr-FR-RemyMultilingualNeural"
    salida = Path("output") / "audio_final.wav"

    print("\n=== Lanzando TTS ===")
    res = tts.text_to_speech(texto, modelo, str(salida))
    if res:
        print("🎉 ¡Listo, audio generado!: ", res)
    else:
        print("😢 Algo falló durante la conversión.")
