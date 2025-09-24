import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';

const API_KEY = 'AIzaSyB3Ng2lAMp4KzpCWcptQJphJyQy6t39bhI';

async function testCorrectTTSImplementation() {
    try {
        console.log('🔍 Probando implementación correcta de TTS...');
        
        const genAI = new GoogleGenerativeAI(API_KEY);
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash-preview-tts",
            generationConfig: {
                responseModalities: ["AUDIO"],
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: { 
                            voiceName: 'Kore' 
                        }
                    }
                }
            }
        });

        const text = "Hola mundo, esta es una prueba de síntesis de voz con Gemini.";
        console.log(`📝 Texto a convertir: "${text}"`);

        console.log('📤 Enviando solicitud...');
        const result = await model.generateContent([{
            text: text
        }]);

        console.log('✅ Solicitud exitosa!');

        const audioData = result.response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        
        if (!audioData) {
            console.log('❌ No se encontró audio data');
            console.log('🔍 Estructura de respuesta:', JSON.stringify(result.response, null, 2));
            return;
        }

        console.log(`✅ Audio data recibido, tamaño: ${audioData.length} caracteres`);
        
        // Verificaciones de validez
        console.log('\n🔍 VERIFICACIONES DE VALIDEZ:');
        
        // 1. Tamaño mínimo
        const isValidSize = audioData.length > 1000;
        console.log(`📏 Tamaño válido (>1000): ${isValidSize} (${audioData.length})`);
        
        // 2. No solo caracteres repetidos
        const uniqueChars = [...new Set(audioData.substring(0, 1000))];
        const hasVariety = uniqueChars.length > 10;
        console.log(`🎭 Variedad de caracteres: ${hasVariety} (${uniqueChars.length} únicos)`);
        
        // 3. Patrón base64 válido
        const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
        const sample = audioData.substring(0, 1000);
        const isValidBase64 = base64Regex.test(sample);
        console.log(`🔤 Base64 válido: ${isValidBase64}`);
        
        if (!isValidSize || !hasVariety || !isValidBase64) {
            console.log('❌ Audio data no válido');
            console.log('🔍 Primeros 200 caracteres:', audioData.substring(0, 200));
            return;
        }
        
        // Decodificar y guardar
        try {
            const audioBuffer = Buffer.from(audioData, 'base64');
            console.log(`📦 Buffer creado, tamaño: ${audioBuffer.length} bytes`);
            
            // Verificar cabecera WAV
            if (audioBuffer.length >= 12) {
                const riffHeader = audioBuffer.toString('ascii', 0, 4);
                const wavHeader = audioBuffer.toString('ascii', 8, 12);
                console.log(`🎵 Cabecera RIFF: "${riffHeader}"`);
                console.log(`🎵 Cabecera WAV: "${wavHeader}"`);
                
                if (riffHeader === 'RIFF' && wavHeader === 'WAVE') {
                    console.log('✅ Archivo WAV válido detectado!');
                } else {
                    console.log('⚠️ No es un archivo WAV estándar, pero puede ser audio válido');
                }
            }
            
            // Guardar archivo
            const fileName = 'test_tts_correcto.wav';
            fs.writeFileSync(fileName, audioBuffer);
            console.log(`💾 Audio guardado como: ${fileName}`);
            
            console.log('\n🎉 ¡ÉXITO! TTS funcionando correctamente');
            
        } catch (decodeError) {
            console.log('❌ Error decodificando audio:', decodeError.message);
        }

    } catch (error) {
        console.error('❌ Error:', error);
        console.error('📊 Tipo de error:', error.constructor.name);
        console.error('📊 Mensaje:', error.message);
        if (error.errorDetails) {
            console.error('📊 Detalles del error:', error.errorDetails);
        }
    }
}

testCorrectTTSImplementation();