# applio_server.py
import io
import time

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from pathlib import Path
from applio_tts import ApplioTTS   # importa tu clase

app = FastAPI(title="Applio TTS 🚀")

class TTSRequest(BaseModel):
    text: str

@app.post("/applio_tts")
async def applio_tts(req: TTSRequest):
    tts = ApplioTTS(base_url="http://127.0.0.1:6969")
    # define un temp file único
    out_path = Path("temp") / f"{int(time.time()*1000)}.wav"
    out_path.parent.mkdir(exist_ok=True)
    result = tts.text_to_speech(req.text, model="fr-FR-RemyMultilingualNeural", output_path=str(out_path))

    if not result:
        raise HTTPException(500, "❌ Applio no devolvió audio")
    # abre el WAV y lo devuelve
    return StreamingResponse(out_path.open("rb"), media_type="audio/wav")

if __name__ == "__main__":
    import uvicorn, time
    uvicorn.run("applio_server:app", host="0.0.0.0", port=5004, log_level="info")
