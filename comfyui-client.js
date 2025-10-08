import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';

export class ComfyUIClient {
    constructor(apiUrl = 'http://127.0.0.1:8188') {
        this.apiUrl = apiUrl;
        this.outputDir = './public/outputs';
        
        // Crear directorio de salida si no existe
        if (!fs.existsSync(this.outputDir)) {
            fs.mkdirSync(this.outputDir, { recursive: true });
        }
    }

    // Función para generar el workflow basado en Flux
    generateWorkflow(prompt, options = {}) {
        const clientId = uuidv4();
        const seed = options.seed || Math.floor(Math.random() * 1000000000000000);
        const width = options.width || 600;
        const height = options.height || 300;
        const steps = options.steps || 10;
        const cfg = options.cfg || 1;
        const guidance = options.guidance || 3.5;
        const sampler = options.sampler || "euler";
        const scheduler = options.scheduler || "simple";
        const model = options.model || "flux1-dev-fp8.safetensors";
        
        return {
            client_id: clientId,
            prompt: {
                "6": {
                    "inputs": {
                        "text": prompt,
                        "clip": ["30", 1]
                    },
                    "class_type": "CLIPTextEncode",
                    "_meta": {
                        "title": "CLIP Text Encode (Positive Prompt)"
                    }
                },
                "8": {
                    "inputs": {
                        "samples": ["31", 0],
                        "vae": ["30", 2]
                    },
                    "class_type": "VAEDecode",
                    "_meta": {
                        "title": "Decodificación VAE"
                    }
                },
                "9": {
                    "inputs": {
                        "filename_prefix": "ComfyUI_Generated",
                        "images": ["8", 0]
                    },
                    "class_type": "SaveImage",
                    "_meta": {
                        "title": "Guardar Imagen"
                    }
                },
                "27": {
                    "inputs": {
                        "width": width,
                        "height": height,
                        "batch_size": 1
                    },
                    "class_type": "EmptySD3LatentImage",
                    "_meta": {
                        "title": "EmptySD3LatentImage"
                    }
                },
                "30": {
                    "inputs": {
                        "ckpt_name": model
                    },
                    "class_type": "CheckpointLoaderSimple",
                    "_meta": {
                        "title": "Cargar Punto de Control"
                    }
                },
                "31": {
                    "inputs": {
                        "seed": seed,
                        "steps": steps,
                        "cfg": cfg,
                        "sampler_name": sampler,
                        "scheduler": scheduler,
                        "denoise": 1,
                        "model": ["30", 0],
                        "positive": ["35", 0],
                        "negative": ["33", 0],
                        "latent_image": ["27", 0]
                    },
                    "class_type": "KSampler",
                    "_meta": {
                        "title": "KSampler"
                    }
                },
                "33": {
                    "inputs": {
                        "text": options.negativePrompt || "",
                        "clip": ["30", 1]
                    },
                    "class_type": "CLIPTextEncode",
                    "_meta": {
                        "title": "CLIP Text Encode (Negative Prompt)"
                    }
                },
                "35": {
                    "inputs": {
                        "guidance": guidance,
                        "conditioning": ["6", 0]
                    },
                    "class_type": "FluxGuidance",
                    "_meta": {
                        "title": "FluxGuidance"
                    }
                }
            },
            extra_data: {
                extra_pnginfo: {
                    workflow: {
                        id: uuidv4(),
                        revision: 0,
                        last_node_id: 37,
                        last_link_id: 57
                    }
                }
            }
        };
    }

    // Función principal para generar imagen con timeout y reinicio automático
    async generateImage(prompt, options = {}) {
        const startTime = Date.now();
    const timeout = 300000; // 300 segundos timeout

        try {
            console.log(`🎨 [COMFYUI CLIENT] Generando imagen: "${prompt}"`);
            console.log(`📊 [COMFYUI CLIENT] Opciones recibidas:`, options);
            console.log(`⏱️ [COMFYUI CLIENT] Timeout configurado: 300 segundos`);

            // Generar workflow
            const workflow = this.generateWorkflow(prompt, options);
            console.log(`⚙️ [COMFYUI CLIENT] Workflow generado con ${options.steps || 25} pasos`);
            console.log(`🔧 [COMFYUI CLIENT] Parámetros del workflow:`, {
                steps: workflow.prompt["31"].inputs.steps,
                guidance: workflow.prompt["35"].inputs.guidance,
                width: workflow.prompt["27"].inputs.width,
                height: workflow.prompt["27"].inputs.height,
                sampler: workflow.prompt["31"].inputs.sampler_name,
                scheduler: workflow.prompt["31"].inputs.scheduler
            });
            
            // Enviar a ComfyUI con timeout estricto
            const response = await Promise.race([
                axios.post(`${this.apiUrl}/prompt`, workflow, {
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    timeout: 15000 // 15 segundos para envío
                }),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('TIMEOUT_SEND')), 15000)
                )
            ]);

            const promptId = response.data.prompt_id;
            console.log(`📤 [COMFYUI CLIENT] Prompt enviado con ID: ${promptId}`);

            // Esperar a que se complete la generación con timeout estricto
            const result = await Promise.race([
                this.waitForCompletion(promptId, 300), // 300 segundos máximo
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('TIMEOUT_GENERATION')), timeout)
                )
            ]);
            
            const elapsedTime = Date.now() - startTime;
            console.log(`⏱️ [COMFYUI CLIENT] Tiempo total: ${elapsedTime}ms`);
            
            if (result.success) {
                console.log(`✅ Imagen generada exitosamente: ${result.filename}`);
                return {
                    success: true,
                    imageUrl: result.imageUrl,
                    filename: result.filename,
                    promptId: promptId,
                    localPath: result.localPath,
                    elapsedTime: elapsedTime
                };
            } else {
                throw new Error(result.error || 'Error desconocido al generar imagen');
            }

        } catch (error) {
            const elapsedTime = Date.now() - startTime;
            console.error(`❌ Error generando imagen después de ${elapsedTime}ms:`, error.message);
            
            // Si es timeout, lanzar error específico para que el llamador maneje el reinicio
            if (error.message.includes('TIMEOUT') || elapsedTime >= timeout) {
                throw new Error(`COMFYUI_TIMEOUT:${elapsedTime}`);
            }
            
            throw error;
        }
    }

    // Función para esperar a que se complete la generación con timeout más estricto
    async waitForCompletion(promptId, timeoutSeconds = 300) {
        let completed = false;
        let attempts = 0;
        const maxAttempts = timeoutSeconds; // 1 segundo por intento
        
        console.log(`⏳ [COMFYUI CLIENT] Esperando completar ${promptId}, timeout: ${timeoutSeconds}s`);
        
        while (!completed && attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            try {
                const historyResponse = await axios.get(`${this.apiUrl}/history/${promptId}`, {
                    timeout: 5000 // Timeout más estricto para consultas
                });
                const history = historyResponse.data;
                
                if (history[promptId] && history[promptId].status) {
                    const status = history[promptId].status;
                    
                    if (status.status_str === 'success' || status.completed === true) {
                        completed = true;
                        
                        // Buscar la imagen generada
                        const outputs = history[promptId].outputs;
                        if (outputs && outputs["9"] && outputs["9"].images) {
                            const imageInfo = outputs["9"].images[0];
                            
                            // Copiar imagen al directorio público
                            const result = await this.copyImageToPublic(imageInfo);
                            console.log(`✅ [COMFYUI CLIENT] Imagen completada en ${attempts}s`);
                            return result;
                        }
                    } else if (status.status_str === 'error') {
                        console.error(`❌ [COMFYUI CLIENT] Error en ComfyUI: ${status.messages?.join(', ')}`);
                        return {
                            success: false,
                            error: `Error en ComfyUI: ${status.messages?.join(', ') || 'Error desconocido'}`
                        };
                    }
                }
            } catch (historyError) {
                // Solo loggear cada 10 intentos para no saturar
                if (attempts % 10 === 0) {
                    console.log(`⏳ [COMFYUI CLIENT] Esperando completar... intento ${attempts + 1}/${maxAttempts}`);
                }
            }
            
            attempts++;
        }
        
        console.error(`⏱️ [COMFYUI CLIENT] TIMEOUT después de ${timeoutSeconds}s`);
        return {
            success: false,
            error: `TIMEOUT: La generación tardó más de ${timeoutSeconds} segundos`
        };
    }

    // Función para copiar imagen al directorio público
    async copyImageToPublic(imageInfo) {
        try {
            // La ruta donde ComfyUI guarda las imágenes (ajustar según tu instalación)
            const comfyOutputPath = path.join('C:', 'comfy', 'ComfyUI', 'output', imageInfo.filename);
            const publicPath = path.join(this.outputDir, imageInfo.filename);
            
            // Verificar si el archivo existe en la ubicación de ComfyUI
            if (fs.existsSync(comfyOutputPath)) {
                // Copiar archivo
                fs.copyFileSync(comfyOutputPath, publicPath);
                
                return {
                    success: true,
                    imageUrl: `/outputs/${imageInfo.filename}`,
                    filename: imageInfo.filename,
                    localPath: publicPath
                };
            } else {
                // Buscar en subdirectorios comunes de ComfyUI
                const possiblePaths = [
                    path.join('C:', 'comfy', 'ComfyUI', 'output', imageInfo.subfolder || '', imageInfo.filename),
                    path.join('C:', 'ComfyUI', 'output', imageInfo.subfolder || '', imageInfo.filename),
                    path.join('.', 'ComfyUI', 'output', imageInfo.subfolder || '', imageInfo.filename)
                ];
                
                for (const possiblePath of possiblePaths) {
                    if (fs.existsSync(possiblePath)) {
                        fs.copyFileSync(possiblePath, publicPath);
                        return {
                            success: true,
                            imageUrl: `/outputs/${imageInfo.filename}`,
                            filename: imageInfo.filename,
                            localPath: publicPath
                        };
                    }
                }
                
                return {
                    success: false,
                    error: `No se pudo encontrar la imagen generada: ${imageInfo.filename}`
                };
            }
        } catch (error) {
            return {
                success: false,
                error: `Error copiando imagen: ${error.message}`
            };
        }
    }

    // Función para verificar si ComfyUI está disponible
    async checkConnection() {
        try {
            const response = await axios.get(`${this.apiUrl}/system_stats`, {
                timeout: 5000
            });
            return { success: true, data: response.data };
        } catch (error) {
            return { 
                success: false, 
                error: `No se puede conectar a ComfyUI en ${this.apiUrl}` 
            };
        }
    }

    // Función para obtener modelos disponibles
    async getAvailableModels() {
        try {
            const response = await axios.get(`${this.apiUrl}/object_info`, {
                timeout: 10000
            });
            
            const checkpoints = response.data.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || [];
            return { success: true, models: checkpoints };
        } catch (error) {
            return { 
                success: false, 
                error: `Error obteniendo modelos: ${error.message}` 
            };
        }
    }
}

export default ComfyUIClient;
