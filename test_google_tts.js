import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs/promises';
import path from 'path';

const GOOGLE_API_KEY = "AIzaSyDOmBt7UfMfJFbRH_R8xFnQVYpO6UqjYG8";

async function testGoogleTTS() {
  try {
    console.log('🧪 Probando Google TTS...');
    
    const ai = new GoogleGenerativeAI(GOOGLE_API_KEY);
    const model = ai.getGenerativeModel({
      model: 'gemini-2.5-flash-preview-tts',
    });

    const testScript = "Hola, esto es una prueba del sistema de text to speech de Google Gemini. Si puedes escuchar esto, significa que la función está funcionando correctamente.";

    const result = await model.generateContent({
      contents: [{
        role: 'user',
        parts: [{
          text: testScript
        }]
      }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: 'Orus'
            }
          }
        }
      }
    });

    console.log('📡 Respuesta recibida de Google Gemini TTS');
    
    const audioData = result.response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    
    if (!audioData) {
      console.log('❌ No se recibió audio data');
      console.log('🔍 Estructura de respuesta:', JSON.stringify(result.response, null, 2));
      return;
    }

    console.log(`✅ Audio data recibido, tamaño: ${audioData.length} caracteres`);

    // Convertir de base64 a buffer
    const audioBuffer = Buffer.from(audioData, 'base64');
    
    // Crear directorio de prueba
    const testDir = './test_audio';
    await fs.mkdir(testDir, { recursive: true });
    
    // Guardar archivo
    const testFile = path.join(testDir, `test_${Date.now()}.wav`);
    await fs.writeFile(testFile, audioBuffer);
    
    console.log(`✅ Archivo de prueba guardado en: ${testFile}`);
    console.log(`📊 Tamaño del archivo: ${audioBuffer.length} bytes`);
    
  } catch (error) {
    console.error('❌ Error en prueba:', error);
  }
}

testGoogleTTS();