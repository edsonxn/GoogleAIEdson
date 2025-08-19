# applio_server_simple.py
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
import time
import os
import tempfile
import io

app = FastAPI(title="Applio TTS Simple 🚀")

class TTSRequest(BaseModel):
    text: str

@app.post("/applio_tts")
async def applio_tts(req: TTSRequest):
    print(f"🎵 Generando TTS para: {req.text[:50]}...")
    
    try:
        # Intentar conectar con el servidor Applio real primero
        try:
            print("🔗 Intentando conectar con servidor Applio real en puerto 6969...")
            import requests
            
            # Verificar si el servidor Applio está corriendo
            health_check = requests.get("http://127.0.0.1:6969", timeout=2)
            
            if health_check.status_code == 200:
                print("✅ Servidor Applio real detectado, usando ApplioTTS...")
                
                # Usar el sistema original de Applio
                from applio_tts import ApplioTTS
                
                tts = ApplioTTS(base_url="http://127.0.0.1:6969")
                temp_dir = tempfile.mkdtemp()
                out_path = os.path.join(temp_dir, f"{int(time.time()*1000)}.wav")
                
                # Usar la misma voz que en tu proyecto original
                result = tts.text_to_speech(
                    req.text, 
                    model="fr-FR-RemyMultilingualNeural",  # Misma voz que tu proyecto
                    output_path=out_path
                )
                
                if result and os.path.exists(out_path):
                    with open(out_path, 'rb') as f:
                        audio_content = f.read()
                    
                    # Limpiar archivo temporal
                    os.remove(out_path)
                    os.rmdir(temp_dir)
                    
                    print(f"✅ Audio generado con Applio real (Remy voice) - tamaño: {len(audio_content)} bytes")
                    
                    return Response(
                        content=audio_content,
                        media_type="audio/wav",
                        headers={"Content-Disposition": "attachment; filename=tts_output.wav"}
                    )
                else:
                    print("❌ Applio real no devolvió audio válido")
                    raise Exception("Applio real falló")
            
        except Exception as applio_error:
            print(f"⚠️ Servidor Applio real no disponible: {applio_error}")
            print("🔄 Usando TTS local como fallback...")
        
        # Fallback: Usar TTS local mejorado
        try:
            import pyttsx3
            
            # Crear carpeta temporal
            temp_dir = tempfile.mkdtemp()
            temp_file = os.path.join(temp_dir, f"tts_{int(time.time())}.wav")
            
            # Configurar TTS con configuraciones similares a Remy
            engine = pyttsx3.init()
            
            # Buscar la mejor voz disponible (preferiblemente masculina y clara)
            voices = engine.getProperty('voices')
            selected_voice = None
            
            # Prioridades de voces (buscamos voces de calidad similar a Remy)
            preferred_voices = [
                'spanish', 'spain', 'es-', 'male', 'david', 'pablo', 'jorge',
                'english', 'en-us', 'mark', 'richard', 'james'
            ]
            
            for priority in preferred_voices:
                for voice in voices:
                    if priority.lower() in voice.name.lower() or priority.lower() in voice.id.lower():
                        selected_voice = voice
                        print(f"🗣️ Usando voz: {voice.name} (similar a Remy)")
                        break
                if selected_voice:
                    break
            
            # Si no encontramos una voz específica, usar la primera disponible
            if not selected_voice and voices:
                selected_voice = voices[0]
                print(f"🗣️ Usando voz por defecto: {selected_voice.name}")
            
            if selected_voice:
                engine.setProperty('voice', selected_voice.id)
            
            # Configuraciones similares a las de Applio Remy
            engine.setProperty('rate', 160)     # Velocidad similar a speak_rate 0.5
            engine.setProperty('volume', 0.9)   # Volumen alto como Remy
            
            # Generar audio
            engine.save_to_file(req.text, temp_file)
            engine.runAndWait()
            
            # Leer el archivo generado
            if os.path.exists(temp_file):
                with open(temp_file, 'rb') as f:
                    audio_content = f.read()
                
                # Limpiar archivo temporal
                os.remove(temp_file)
                os.rmdir(temp_dir)
                
                print(f"✅ Audio TTS local generado (estilo Remy) - tamaño: {len(audio_content)} bytes")
                
                return Response(
                    content=audio_content,
                    media_type="audio/wav",
                    headers={"Content-Disposition": "attachment; filename=tts_output.wav"}
                )
            else:
                raise Exception("No se pudo generar el archivo de audio local")
                
        except ImportError:
            print("⚠️ pyttsx3 no está disponible, usando audio de prueba...")
            # Último fallback: audio de prueba
            wav_header = bytes([
                0x52, 0x49, 0x46, 0x46,  # RIFF
                0x24, 0x08, 0x00, 0x00,  # File size
                0x57, 0x41, 0x56, 0x45,  # WAVE
                0x66, 0x6D, 0x74, 0x20,  # fmt 
                0x10, 0x00, 0x00, 0x00,  # Chunk size
                0x01, 0x00,              # Audio format
                0x01, 0x00,              # Channels
                0x44, 0xAC, 0x00, 0x00,  # Sample rate (44100)
                0x88, 0x58, 0x01, 0x00,  # Byte rate
                0x02, 0x00,              # Block align
                0x10, 0x00,              # Bits per sample
                0x64, 0x61, 0x74, 0x61,  # data
                0x00, 0x08, 0x00, 0x00   # Data size
            ])
            
            # Datos de audio (silencio)
            audio_data = bytes([0x00] * 2048)
            wav_content = wav_header + audio_data
            
            print(f"⚠️ Audio de prueba generado (tamaño: {len(wav_content)} bytes)")
            print("💡 Para TTS real como Remy, ejecuta el servidor Applio en puerto 6969")
            
            return Response(
                content=wav_content,
                media_type="audio/wav",
                headers={"Content-Disposition": "attachment; filename=tts_output.wav"}
            )
        
    except Exception as e:
        print(f"❌ Error generando TTS: {e}")
        raise HTTPException(status_code=500, detail=f"Error generando TTS: {str(e)}")

@app.get("/")
async def health_check():
    return {"status": "ok", "message": "Applio TTS Simple funcionando"}

if __name__ == "__main__":
    import uvicorn
    print("🚀 Iniciando servidor Applio TTS Simple en puerto 5004...")
    print("💡 Para TTS real, instala: pip install pyttsx3")
    uvicorn.run("applio_server_simple:app", host="0.0.0.0", port=5004, log_level="info")
