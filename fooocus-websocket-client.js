import express from 'express';
import WebSocket from 'ws';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// Obtener __dirname para ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Importar configuraciones de performance
const PERFORMANCE_CONFIGS = {
    "Quality": {
        mode: "Quality",
        steps: 30,
        cfg_scale: 7,
        sampler: "dpmpp_2m_sde_gpu",
        scheduler: "karras"
    },
    "Speed": {
        mode: "Speed", 
        steps: 15,
        cfg_scale: 4,
        sampler: "dpmpp_2m_sde_gpu",
        scheduler: "karras"
    },
  "Extreme Speed": {
        mode: "Extreme Speed",
        steps: 2,
        cfg_scale: 4,
        sampler: "dpmpp_2m_sde_gpu", 
        scheduler: "karras"
    },
    "Lightning": {
        mode: "Lightning",
        steps: 2,
        cfg_scale: 1,
        sampler: "dpmpp_2m_sde_gpu",
        scheduler: "karras"
    },
    "Hyper-SD": {
        mode: "Hyper-SD",
        steps: 1,
        cfg_scale: 1,
        sampler: "dpmpp_2m_sde_gpu",
        scheduler: "karras"
    }
};

// Crear una instancia separada de Express para el cliente Fooocus
const fooocusApp = express();
const FOOOCUS_PORT = 3006;

// Middleware
fooocusApp.use(express.static(path.join(__dirname, 'public')));
fooocusApp.use(express.json());

// Endpoint para servir imágenes generadas
fooocusApp.get('/image/:filename', (req, res) => {
    const filename = req.params.filename;
    
    // Buscar el archivo en el directorio temporal de Fooocus
    const tempDir = process.env.TEMP || process.env.TMP || 'C:\\Users\\jaire\\AppData\\Local\\Temp';
    const fooocusDir = path.join(tempDir, 'fooocus');
    
    // Buscar recursivamente el archivo
    function findImageFile(dir, filename) {
        try {
            const items = fs.readdirSync(dir);
            for (const item of items) {
                const fullPath = path.join(dir, item);
                const stat = fs.statSync(fullPath);
                
                if (stat.isDirectory()) {
                    const found = findImageFile(fullPath, filename);
                    if (found) return found;
                } else if (item === filename) {
                    return fullPath;
                }
            }
        } catch (error) {
            // Ignorar errores de permisos
        }
        return null;
    }
    
    const imagePath = findImageFile(fooocusDir, filename);
    
    if (imagePath && fs.existsSync(imagePath)) {
        res.sendFile(imagePath);
    } else {
        res.status(404).json({ error: 'Imagen no encontrada' });
    }
});

// Endpoint para generar imagen usando WebSocket
fooocusApp.post('/generate-websocket', (req, res) => {
    const { prompt = 'a beautiful landscape' } = req.body;
    
    console.log('🎯 Iniciando generación WebSocket con prompt:', prompt);
    
    generateImageWebSocket(prompt)
        .then(result => {
            // Extraer la ruta del archivo de imagen de la respuesta
            let imageFile = null;
            let imagePath = null;
            let imageUrl = null;
            
            try {
                // Buscar el archivo de imagen en la estructura de respuesta
                console.log('🔍 Analizando respuesta para extraer imagen...');
                
                if (result.data && Array.isArray(result.data)) {
                    for (const item of result.data) {
                        console.log('📋 Item encontrado:', item);
                        
                        // Buscar en item.value si es array
                        if (item.value && Array.isArray(item.value)) {
                            for (const file of item.value) {
                                console.log('📁 Archivo encontrado:', file);
                                if (file.name && file.name.endsWith('.png')) {
                                    imageFile = file.name;
                                    imagePath = file.name.replace(/\\/g, '/');
                                    
                                    // Extraer solo el nombre del archivo
                                    const filename = path.basename(file.name);
                                    imageUrl = `/image/${filename}`;
                                    console.log('✅ Imagen extraída exitosamente:', {
                                        imageFile,
                                        filename,
                                        imageUrl
                                    });
                                    break;
                                }
                            }
                        }
                        
                        if (imageFile) break;
                    }
                }
                
                if (!imageFile) {
                    console.log('⚠️ No se encontró imagen en la respuesta');
                    console.log('📦 Estructura completa:', JSON.stringify(result, null, 2));
                }
            } catch (error) {
                console.error('❌ Error extrayendo imagen:', error);
            }
            
            res.json({
                success: true,
                message: 'Imagen generada exitosamente',
                data: result,
                prompt: prompt,
                imageFile: imageFile,
                imagePath: imagePath,
                imageUrl: imageUrl
            });
        })
        .catch(error => {
            console.error('❌ Error generando imagen:', error);
            res.status(500).json({
                success: false,
                error: 'Error generando imagen',
                details: error.message
            });
        });
});

function generateImageWebSocket(prompt, performanceMode = "Extreme Speed") {
    return new Promise((resolve, reject) => {
        const sessionHash = Math.random().toString(36).substring(2, 15);
        let responses = [];
        let taskId = null; // Variable para almacenar el task ID
        
        // Obtener configuración de performance
        const config = PERFORMANCE_CONFIGS[performanceMode] || PERFORMANCE_CONFIGS["Extreme Speed"];
        console.log(`🚀 Usando configuración: ${config.mode} (${config.steps} pasos, CFG: ${config.cfg_scale})`);
        
        // Paso 1: fn_index 66 para obtener Task ID
        const ws1 = new WebSocket('ws://127.0.0.1:7865/queue/join', {
            headers: {
                'Origin': 'http://127.0.0.1:7865',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        
        ws1.on('open', () => {
            console.log('🔌 Paso 1: Conectado para obtener Task ID');
            ws1.send(JSON.stringify({
                fn_index: 66,
                session_hash: sessionHash
            }));
        });
        
        ws1.on('message', (data) => {
            const message = JSON.parse(data.toString());
            console.log('📥 Paso 1:', message.msg);
            
            if (message.msg === 'send_data') {
                ws1.send(JSON.stringify({
                    data: [true, "0"],
                    event_data: null,
                    fn_index: 66,
                    session_hash: sessionHash
                }));
                
            } else if (message.msg === 'process_completed') {
                taskId = message.output?.data?.[0]; // Almacenar el task ID
                console.log('✅ Task ID obtenido:', taskId);
                ws1.close();
                
                // Paso 2: fn_index 67 para configurar parámetros
                setTimeout(() => {
                    const ws2 = new WebSocket('ws://127.0.0.1:7865/queue/join', {
                        headers: {
                            'Origin': 'http://127.0.0.1:7865',
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                        }
                    });
                    
                    ws2.on('open', () => {
                        console.log('🔧 Paso 2: Configurando parámetros');
                        ws2.send(JSON.stringify({
                            fn_index: 67,
                            session_hash: sessionHash
                        }));
                    });
                    
                    ws2.on('message', (data) => {
                        const message = JSON.parse(data.toString());
                        console.log('📥 Paso 2:', message.msg);
                        
                        if (message.msg === 'send_data') {
                            const fullParams = [
                                null, false, prompt, "", 
                                ["Fooocus V2","Fooocus Enhance","Fooocus Sharp"], 
                                config.mode, // Usar el modo de performance configurado
                                "1344×768 <span style=\"color: grey;\"> ∣ 16:9</span>", 
                                1, "png", taskId, false, config.steps, config.cfg_scale, // Usar pasos y CFG de la config
                                "juggernautXL_v8Rundiffusion.safetensors", "None", 0.5, true, 
                                "sd_xl_offset_example-lora_1.0.safetensors", 0.1, true, "None", 1, true, 
                                "None", 1, true, "None", 1, true, "None", 1, false, "uov", "Disabled", 
                                null, [], null, "", null, false, true, false, false, 1.5, 0.8, 0.3, 7, 2, 
                                config.sampler, config.scheduler, "Default (model)", -1, -1, -1, -1, -1, -1, // Usar sampler y scheduler
                                false, false, false, false, 64, 128, "joint", 0.25, false, 1.01, 1.02, 
                                0.99, 0.95, false, false, "v2.6", 1, 0.618, false, false, 0, false, false, 
                                "fooocus", null, 0.5, 0.6, "ImagePrompt", null, 0.5, 0.6, "ImagePrompt", 
                                null, 0.5, 0.6, "ImagePrompt", null, 0.5, 0.6, "ImagePrompt", false, 0, 
                                false, null, false, "Disabled", "Before First Enhancement", "Original Prompts", 
                                false, "", "", "", "sam", "full", "vit_b", 0.25, 0.3, 0, false, "v2.6", 
                                1, 0.618, 0, false, false, "", "", "", "sam", "full", "vit_b", 0.25, 0.3, 
                                0, false, "v2.6", 1, 0.618, 0, false, false, "", "", "", "sam", "full", 
                                "vit_b", 0.25, 0.3, 0, false, "v2.6", 1, 0.618, 0, false
                            ];
                            
                            ws2.send(JSON.stringify({
                                data: fullParams,
                                event_data: null,
                                fn_index: 67,
                                session_hash: sessionHash
                            }));
                            
                        } else if (message.msg === 'process_completed') {
                            console.log('✅ Parámetros configurados');
                            ws2.close();
                            
                            // Paso 3: fn_index 68 para ejecutar generación
                            setTimeout(() => {
                                const ws3 = new WebSocket('ws://127.0.0.1:7865/queue/join', {
                                    headers: {
                                        'Origin': 'http://127.0.0.1:7865',
                                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                                    }
                                });
                                
                                ws3.on('open', () => {
                                    console.log('🎨 Paso 3: Ejecutando generación');
                                    ws3.send(JSON.stringify({
                                        fn_index: 68,
                                        session_hash: sessionHash
                                    }));
                                });
                                
                                ws3.on('message', (data) => {
                                    const message = JSON.parse(data.toString());
                                    
                                    if (message.msg === 'send_data') {
                                        ws3.send(JSON.stringify({
                                            data: [null],
                                            event_data: null,
                                            fn_index: 68,
                                            session_hash: sessionHash
                                        }));
                                        
                                    } else if (message.msg === 'process_generating') {
                                        // Extraer progreso
                                        const progressHTML = message.output?.data?.[0]?.value;
                                        if (progressHTML && progressHTML.includes('progress')) {
                                            const match = progressHTML.match(/value="(\d+)"/);
                                            if (match) {
                                                console.log(`🎨 Progreso: ${match[1]}%`);
                                            }
                                        }
                                        
                                    } else if (message.msg === 'process_completed') {
                                        console.log('✅ ¡Imagen generada exitosamente!');
                                        console.log('📦 Output completo:', JSON.stringify(message.output, null, 2));
                                        
                                        // Buscar la imagen final en el output
                                        if (message.output && message.output.data) {
                                            for (const item of message.output.data) {
                                                if (item.value && Array.isArray(item.value)) {
                                                    for (const file of item.value) {
                                                        if (file.name && file.name.endsWith('.png')) {
                                                            console.log('🎯 Imagen final encontrada:', file.name);
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                        
                                        ws3.close();
                                        resolve(message.output);
                                    }
                                });
                                
                                ws3.on('error', (error) => {
                                    console.error('❌ Error en paso 3:', error.message);
                                    reject(error);
                                });
                                
                            }, 100);
                        }
                    });
                    
                    ws2.on('error', (error) => {
                        console.error('❌ Error en paso 2:', error.message);
                        reject(error);
                    });
                    
                }, 100);
            }
        });
        
        ws1.on('error', (error) => {
            console.error('❌ Error en paso 1:', error.message);
            reject(error);
        });
    });
}

// Endpoint de status
fooocusApp.get('/status', (req, res) => {
    res.json({ 
        status: 'ok', 
        message: 'Fooocus WebSocket Client funcionando',
        port: FOOOCUS_PORT,
        protocol: 'WebSocket'
    });
});

// Función para iniciar el servidor Fooocus integrado
function startFooocusServer() {
    return new Promise((resolve, reject) => {
        const server = fooocusApp.listen(FOOOCUS_PORT, (error) => {
            if (error) {
                console.error(`❌ Error iniciando servidor Fooocus en puerto ${FOOOCUS_PORT}:`, error.message);
                reject(error);
            } else {
                console.log(`🤖 Servidor Fooocus WebSocket Client integrado ejecutándose en http://localhost:${FOOOCUS_PORT}`);
                console.log('🔌 Protocolo: WebSocket (ws://127.0.0.1:7865)');
                console.log('📋 Parámetros: 153 elementos completos');
                resolve(server);
            }
        });
        
        server.on('error', (error) => {
            if (error.code === 'EADDRINUSE') {
                console.log(`⚠️ Puerto ${FOOOCUS_PORT} ya está en uso. El servidor Fooocus ya está ejecutándose.`);
                resolve(null); // No es un error grave, solo está ya ejecutándose
            } else {
                console.error(`❌ Error en servidor Fooocus:`, error.message);
                reject(error);
            }
        });
    });
}

export { startFooocusServer, fooocusApp };
