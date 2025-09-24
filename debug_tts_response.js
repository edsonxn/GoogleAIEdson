import { GoogleGenerativeAI } from '@google/generative-ai';

const API_KEY = 'AIzaSyB3Ng2lAMp4KzpCWcptQJphJyQy6t39bhI';

async function debugGoogleTTSResponse() {
    try {
        console.log('🔍 Iniciando diagnóstico detallado de respuesta TTS...');
        
        const genAI = new GoogleGenerativeAI(API_KEY);
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash-preview-tts"
        });

        const text = "Hola mundo.";
        console.log(`📝 Texto a convertir: "${text}"`);

        console.log('📤 Enviando solicitud...');
        const result = await model.generateContent([
            {
                text: text
            }
        ]);

        console.log('\n🔍 ANÁLISIS DE RESPUESTA:');
        console.log('📦 Tipo de resultado:', typeof result);
        console.log('📦 Claves del resultado:', Object.keys(result));

        if (result.response) {
            console.log('\n📦 Tipo de response:', typeof result.response);
            console.log('📦 Claves de response:', Object.keys(result.response));

            const response = result.response;
            
            if (response.candidates && response.candidates.length > 0) {
                const candidate = response.candidates[0];
                console.log('\n📦 Primer candidato:', typeof candidate);
                console.log('📦 Claves del candidato:', Object.keys(candidate));

                if (candidate.content) {
                    console.log('\n📦 Contenido:', typeof candidate.content);
                    console.log('📦 Claves del contenido:', Object.keys(candidate.content));

                    if (candidate.content.parts && candidate.content.parts.length > 0) {
                        const part = candidate.content.parts[0];
                        console.log('\n📦 Primera parte:', typeof part);
                        console.log('📦 Claves de la parte:', Object.keys(part));

                        if (part.inlineData) {
                            console.log('\n📦 InlineData encontrado:');
                            console.log('📦 Tipo de inlineData:', typeof part.inlineData);
                            console.log('📦 Claves de inlineData:', Object.keys(part.inlineData));
                            
                            if (part.inlineData.mimeType) {
                                console.log('📦 MimeType:', part.inlineData.mimeType);
                            }
                            
                            if (part.inlineData.data) {
                                const audioData = part.inlineData.data;
                                console.log('📦 Tipo de datos de audio:', typeof audioData);
                                console.log('📦 Longitud de datos de audio:', audioData.length);
                                
                                // Examinar los primeros 200 caracteres
                                console.log('📦 Primeros 200 caracteres:', audioData.substring(0, 200));
                                
                                // Contar caracteres únicos en los primeros 1000 caracteres
                                const sample = audioData.substring(0, 1000);
                                const uniqueChars = [...new Set(sample)];
                                console.log('📦 Caracteres únicos en muestra (primeros 1000):', uniqueChars.length);
                                console.log('📦 Caracteres únicos:', uniqueChars.join(''));
                                
                                // Verificar si es base64 válido
                                const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
                                const isValidBase64 = base64Regex.test(sample);
                                console.log('📦 ¿Parece base64 válido?:', isValidBase64);
                                
                                // Intentar decodificar una muestra pequeña
                                try {
                                    const sampleBuffer = Buffer.from(audioData.substring(0, 100), 'base64');
                                    console.log('📦 Primeros 20 bytes del buffer:', Array.from(sampleBuffer.slice(0, 20)));
                                    
                                    // Verificar cabecera WAV
                                    const wavHeader = sampleBuffer.toString('ascii', 0, 4);
                                    console.log('📦 Posible cabecera WAV:', wavHeader);
                                    
                                } catch (decodeError) {
                                    console.log('❌ Error decodificando muestra:', decodeError.message);
                                }
                            }
                        }
                    }
                }
            }
        }

        console.log('\n📊 RESUMEN:');
        console.log('✅ Solicitud completada exitosamente');
        
    } catch (error) {
        console.error('❌ Error en diagnóstico:', error);
        console.error('📊 Tipo de error:', error.constructor.name);
        console.error('📊 Mensaje:', error.message);
        if (error.stack) {
            console.error('📊 Stack:', error.stack.split('\n').slice(0, 3).join('\n'));
        }
    }
}

debugGoogleTTSResponse();