import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs/promises';

const GOOGLE_API_KEY = "AIzaSyDOmBt7UfMfJFbRH_R8xFnQVYpO6UqjYG8";

async function testSimpleGoogleTTS() {
  try {
    console.log('🧪 Probando Google TTS con configuración simple...');
    
    const ai = new GoogleGenerativeAI(GOOGLE_API_KEY);
    const model = ai.getGenerativeModel({ model: "gemini-2.5-flash-preview-tts" });

    // Script muy simple
    const testScript = "Hola mundo, esto es una prueba.";

    console.log(`📝 Script de prueba: "${testScript}"`);

    const response = await model.generateContent({
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

    console.log('📡 Respuesta recibida');
    console.log('🔍 Candidates:', response.candidates?.length || 0);
    console.log('🔍 Parts:', response.candidates?.[0]?.content?.parts?.length || 0);
    
    const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    
    if (!audioData) {
      console.log('❌ No se recibió audio data');
      console.log('🔍 Response structure:', JSON.stringify(response, null, 2));
      return;
    }

    console.log(`✅ Audio data recibido, tamaño: ${audioData.length} caracteres`);
    console.log(`🔍 Primeros 100 caracteres: ${audioData.substring(0, 100)}`);
    console.log(`🔍 Últimos 100 caracteres: ${audioData.substring(audioData.length - 100)}`);
    
    // Verificar si son todos iguales
    const firstChar = audioData.charAt(0);
    const uniqueChars = new Set(audioData.split(''));
    console.log(`🔍 Caracteres únicos en el audio: ${uniqueChars.size}`);
    console.log(`🔍 Primeros caracteres únicos: ${Array.from(uniqueChars).slice(0, 10).join(', ')}`);
    
    if (uniqueChars.size < 10) {
      console.log('⚠️ Muy pocos caracteres únicos, posible error en la generación');
      return;
    }

    // Intentar decodificar
    try {
      const audioBuffer = Buffer.from(audioData, 'base64');
      console.log(`✅ Buffer creado exitosamente, tamaño: ${audioBuffer.length} bytes`);
      
      // Verificar si parece un archivo WAV válido
      const wavHeader = audioBuffer.slice(0, 12).toString('ascii');
      console.log(`🔍 Header del archivo: ${wavHeader}`);
      
      if (wavHeader.includes('RIFF') && wavHeader.includes('WAVE')) {
        console.log('✅ Parece ser un archivo WAV válido');
        
        // Guardar archivo de prueba
        await fs.writeFile('./test_output.wav', audioBuffer);
        console.log('✅ Archivo guardado como test_output.wav');
      } else {
        console.log('⚠️ No parece ser un archivo WAV válido');
      }
      
    } catch (bufferError) {
      console.log('❌ Error al crear buffer:', bufferError.message);
    }
    
  } catch (error) {
    console.error('❌ Error en prueba:', error);
  }
}

testSimpleGoogleTTS();