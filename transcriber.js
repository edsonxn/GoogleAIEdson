import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import FormData from 'form-data';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import { fileURLToPath } from 'url';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configurar ffmpeg
ffmpeg.setFfmpegPath(ffmpegPath);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.GOOGLE_API_KEY;

/**
 * Obtiene las pistas de audio de un archivo MP4
 */
async function getAudioTracks(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      
      const audioStreams = metadata.streams.filter(s => s.codec_type === 'audio');
      const tracks = audioStreams.map((stream, index) => ({
        index,
        codec: stream.codec_name,
        channels: stream.channels,
        language: stream.tags?.language || 'unknown',
        title: stream.tags?.title || `Pista ${index + 1}`
      }));
      
      resolve(tracks);
    });
  });
}

/**
 * Transcribe audio usando OpenAI Whisper
 */
async function transcribeAudio({ filePath, onUploadProgress, audioTrackIndex }) {
  let audioPath = filePath;
  let tempMp3 = null;

  // Si es MP4, convertir a MP3 y permitir seleccionar pista
  if (filePath.toLowerCase().endsWith('.mp4')) {
    // Validar que la pista existe
    const tracks = await getAudioTracks(filePath);
    
    if (audioTrackIndex !== undefined && audioTrackIndex !== null) {
      if (audioTrackIndex < 0 || audioTrackIndex >= tracks.length) {
        throw new Error(`La pista de audio seleccionada (${audioTrackIndex}) no existe en el archivo. Total de pistas: ${tracks.length}`);
      }
    }

    const tempDir = os.tmpdir();
    const baseName = path.basename(filePath, path.extname(filePath));
    tempMp3 = path.join(tempDir, `${baseName}-${Date.now()}.mp3`);

    await new Promise((resolve, reject) => {
      let cmd = ffmpeg(filePath)
        .output(tempMp3)
        .audioCodec('libmp3lame');

      if (audioTrackIndex !== undefined && audioTrackIndex !== null) {
        cmd = cmd.outputOptions([`-map 0:a:${audioTrackIndex}`]);
      }

      cmd.on('end', resolve)
        .on('error', reject)
        .run();
    });

    audioPath = tempMp3;
  }

  const formData = new FormData();
  formData.append("file", fs.createReadStream(audioPath));
  formData.append("model", "whisper-1");
  formData.append("language", "es");

  const response = await axios.post(
    "https://api.openai.com/v1/audio/transcriptions",
    formData,
    {
      headers: {
        ...formData.getHeaders(),
        "Authorization": `Bearer ${OPENAI_API_KEY}`
      },
      onUploadProgress: ev => {
        const percent = Math.round((ev.loaded * 100) / ev.total);
        if (onUploadProgress) onUploadProgress(percent);
      }
    }
  );

  // Eliminar el archivo temporal si se creó
  if (tempMp3) {
    try { 
      fs.unlinkSync(tempMp3); 
    } catch (e) {
      console.warn('No se pudo eliminar archivo temporal:', e.message);
    }
  }

  return response.data.text;
}

export { 
  transcribeAudio, 
  getAudioTracks 
};
