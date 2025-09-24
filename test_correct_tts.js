import { GoogleGenerativeAI } from '@google/generative-ai';

const API_KEY = 'AIzaSyB3Ng2lAMp4KzpCWcptQJphJyQy6t39bhI';

async function testCorrectTTSConfig() {
    try {
        console.log('🔍 Probando configuración correcta de TTS...');
        
        const genAI = new GoogleGenerativeAI(API_KEY);
        
        // Configuración específica para TTS con modalidades de respuesta
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash-preview-tts",
            generationConfig: {
                responseModalities: ["AUDIO"]
            }
        });

        const text = "Hola mundo.";
        console.log(`📝 Texto a convertir: "${text}"`);

        console.log('📤 Enviando solicitud con configuración AUDIO...');
        const result = await model.generateContent([
            {
                text: text
            }
        ]);

        console.log('✅ Solicitud exitosa!');
        console.log('\n🔍 ANÁLISIS DE RESPUESTA:');

        if (result.response && result.response.candidates && result.response.candidates.length > 0) {
            const candidate = result.response.candidates[0];
            
            if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
                const part = candidate.content.parts[0];
                
                if (part.inlineData) {
                    console.log('✅ InlineData encontrado');
                    console.log('📦 MimeType:', part.inlineData.mimeType);
                    
                    const audioData = part.inlineData.data;
                    console.log('📦 Longitud de datos:', audioData.length);
                    
                    // Examinar los primeros caracteres
                    const sample = audioData.substring(0, 200);
                    console.log('📦 Primeros 200 caracteres:', sample);
                    
                    // Contar caracteres únicos
                    const uniqueChars = [...new Set(sample)];
                    console.log('📦 Caracteres únicos en muestra:', uniqueChars.length);
                    console.log('📦 Caracteres únicos:', uniqueChars.join(''));
                    
                    // Verificar patrón base64
                    const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
                    const isValidBase64 = base64Regex.test(sample);
                    console.log('📦 ¿Parece base64 válido?:', isValidBase64);
                    
                    // Intentar decodificar
                    try {
                        const buffer = Buffer.from(audioData.substring(0, 100), 'base64');
                        console.log('📦 Primeros 16 bytes del buffer:', Array.from(buffer.slice(0, 16)));
                        
                        // Verificar cabecera WAV
                        if (buffer.length >= 12) {
                            const riffHeader = buffer.toString('ascii', 0, 4);
                            const wavHeader = buffer.toString('ascii', 8, 12);
                            console.log('📦 Cabecera RIFF:', riffHeader);
                            console.log('📦 Cabecera WAV:', wavHeader);
                            
                            if (riffHeader === 'RIFF' && wavHeader === 'WAVE') {
                                console.log('✅ Archivo WAV válido detectado!');
                            } else {
                                console.log('❌ No es un archivo WAV válido');
                            }
                        }
                        
                    } catch (decodeError) {
                        console.log('❌ Error decodificando:', decodeError.message);
                    }
                    
                    // Intentar guardar una muestra pequeña
                    try {
                        import('fs').then(fs => {
                            const testBuffer = Buffer.from(audioData, 'base64');
                            fs.writeFileSync('test_audio_sample.wav', testBuffer);
                            console.log('💾 Muestra de audio guardada como test_audio_sample.wav');
                        });
                    } catch (saveError) {
                        console.log('❌ Error guardando muestra:', saveError.message);
                    }
                    
                } else {
                    console.log('❌ No se encontró inlineData');
                }
            } else {
                console.log('❌ No se encontró contenido válido');
            }
        } else {
            console.log('❌ No se encontraron candidatos');
        }

    } catch (error) {
        console.error('❌ Error:', error);
        console.error('📊 Tipo de error:', error.constructor.name);
        console.error('📊 Mensaje:', error.message);
    }
}

testCorrectTTSConfig();