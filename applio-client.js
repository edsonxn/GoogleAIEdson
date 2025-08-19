import axios from 'axios';
import fs from 'fs';
import path from 'path';

class ApplioClient {
    constructor(applioUrl = 'http://127.0.0.1:6969') {
        this.applioUrl = applioUrl;
        this.sessionHash = this._generateSessionHash();
    }

    _generateSessionHash() {
        const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let result = '';
        for (let i = 0; i < 10; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    async textToSpeech(text, outputPath, options = {}) {
        const {
            model = "fr-FR-RemyMultilingualNeural",
            speed = 0,
            pitch = 0
        } = options;

        console.log(`\n🎬 Iniciando TTS: «${text.substring(0, 100)}...»`);
        console.log(`🎛️ Modelo: ${model}`);
        console.log(`🔑 Session: ${this.sessionHash}\n`);

        try {
            // Obtener timestamp del archivo antes de la solicitud
            const beforeTimestamp = await this._getFileTimestamp();
            
            // Payload para Applio
            const data = [
                true,                           // enable_vc
                "",                             // speaker_wav
                text,                           // input_text
                model,                          // model_name  
                pitch,                          // pitch
                0,                              // filter_radius
                0.75,                           // index_rate
                1,                              // volume_envelope
                0.5,                            // protect
                "rmvpe",                        // f0_method
                "C:\\applio2\\Applio\\assets\\audios\\tts_output.wav",
                "C:\\applio2\\Applio\\assets\\audios\\tts_rvc_output.wav",
                "logs\\VOCES\\RemyOriginal.pth",
                "logs\\VOCES\\esponja.index",
                false,                          // split_audio
                false,                          // autotune
                1,                              // clean_audio
                false,                          
                155,                            // clean_strength
                false,                          // export_format_enabled
                0.5,                            // upscale_audio
                "WAV",                          // export_format
                "contentvec",                   // embedder_model
                null,                           // custom_model
                speed                           // speed
            ];

            const joinPayload = {
                data: data,
                event_data: null,
                fn_index: 94,
                session_hash: this.sessionHash,
                trigger_id: Math.floor(Math.random() * 1000)
            };

            console.log('📡 Enviando a Applio...');
            
            const response = await axios.post(`${this.applioUrl}/gradio_api/queue/join`, joinPayload, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 60000
            });

            console.log('✅ Solicitud enviada');
            console.log(`📋 Event ID: ${response.data.event_id}`);

            // Esperar el archivo nuevo y copiarlo al destino
            return await this._waitForNewFile(beforeTimestamp, outputPath);

        } catch (error) {
            console.error('❌ Error:', error.message);
            throw error;
        }
    }

    async _getFileTimestamp() {
        const paths = [
            "C:\\applio2\\Applio\\assets\\audios\\tts_rvc_output.wav",
            "C:\\applio2\\Applio\\assets\\audios\\tts_output.wav"
        ];

        for (const filePath of paths) {
            if (fs.existsSync(filePath)) {
                const stats = fs.statSync(filePath);
                return { path: filePath, mtime: stats.mtime.getTime() };
            }
        }
        return { path: paths[0], mtime: 0 };
    }

    async _waitForNewFile(beforeTimestamp, outputPath) {
        console.log('⏳ Esperando generación...');
        
        const startTime = Date.now();
        const timeout = 45000; // 45 segundos

        return new Promise((resolve, reject) => {
            const checkFile = async () => {
                try {
                    if (Date.now() - startTime > timeout) {
                        reject(new Error('Timeout: Applio tardó demasiado'));
                        return;
                    }

                    const current = await this._getFileTimestamp();
                    
                    // Verificar si hay un archivo nuevo
                    if (current.mtime > beforeTimestamp.mtime) {
                        console.log('🎯 ¡Archivo nuevo detectado!');
                        
                        // Esperar un poco para que termine de escribirse
                        await new Promise(r => setTimeout(r, 1000));
                        
                        // Verificar que el archivo existe y tiene contenido
                        if (fs.existsSync(current.path)) {
                            const stats = fs.statSync(current.path);
                            
                            if (stats.size > 1000) { // Al menos 1KB
                                console.log(`📊 Archivo válido: ${(stats.size / 1024).toFixed(1)} KB`);
                                
                                // Asegurar que el directorio de destino existe
                                const destDir = path.dirname(outputPath);
                                if (!fs.existsSync(destDir)) {
                                    fs.mkdirSync(destDir, { recursive: true });
                                }

                                // Copiar al destino
                                fs.copyFileSync(current.path, outputPath);
                                const finalStats = fs.statSync(outputPath);

                                console.log(`✅ Guardado: ${outputPath}`);

                                resolve({
                                    success: true,
                                    filePath: outputPath,
                                    size: finalStats.size,
                                    sourcePath: current.path
                                });
                                return;
                            }
                        }
                    }

                    // Seguir verificando
                    setTimeout(checkFile, 1000);

                } catch (error) {
                    reject(error);
                }
            };

            // Empezar a verificar después de 2 segundos
            setTimeout(checkFile, 2000);
        });
    }

    async checkConnection() {
        try {
            console.log('🔍 Verificando Applio...');
            await axios.get(`${this.applioUrl}/`, { timeout: 5000 });
            console.log('✅ Conectado');
            return true;
        } catch (error) {
            console.error('❌ Applio no disponible en puerto 6969');
            return false;
        }
    }
}

export default ApplioClient;
