
import asyncio
import edge_tts

TEXT = "Hola, esto es una prueba de audio."
VOICE = "es-MX-DaliaNeural"
OUTPUT_FILE = "test_audio.mp3"

async def _main() -> None:
    print(f"Probando generación TTS con voz: {VOICE}...")
    communicate = edge_tts.Communicate(TEXT, VOICE)
    await communicate.save(OUTPUT_FILE)
    print(f"¡Éxito! Audio guardado en {OUTPUT_FILE}")

if __name__ == "__main__":
    try:
        loop = asyncio.get_event_loop_policy().get_event_loop()
        loop.run_until_complete(_main())
    except Exception as e:
        print(f"\n❌ ERROR FATAL:\n{e}")
