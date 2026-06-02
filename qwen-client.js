import { Client, handle_file } from "@gradio/client";
import fs from 'fs';
import path from 'path';

class QwenClient {
    constructor(qwenUrl = 'http://127.0.0.1:8000') {
        this.qwenUrl = qwenUrl;
    }

    /**
     * Genera un audio clonado usando el archivo "empaquetado" de la voz (.pt) en Qwen3-TTS
     * @param {string} promptFilePath - Ruta al archivo .pt (ej: voice_clone_prompt_xxx.pt)
     * @param {string} text - Texto que quieres que la voz diga
     * @param {string} language - Idioma ('Auto', 'es', 'en', etc.)
     * @param {string} outputDest - Ruta donde guardarás el archivo .wav en tu proyecto
     */
    async generateFromPrompt(promptFilePath, text, language = "Auto", outputDest = "./qwen_output.wav") {
        try {
            console.log(`🔌 Conectando con Qwen TTS Demo en ${this.qwenUrl}...`);
            // Nos conectamos a la demo de Qwen
            const client = await Client.connect(this.qwenUrl);

            console.log(`🎙️ Enviando texto: "${text}"`);
            
            // Segun tu captura, el fn_index es el 2 ("Load Voice & Generate")
            // Y los parametros son [archivo_pt, texto, lenguaje]
            const result = await client.predict(2, [
                handle_file(promptFilePath), 
                text,                 
                language              
            ]);

            // Gradio nos devuelve la URL temporal del audio generado
            if (result.data && result.data[0] && result.data[0].url) {
                console.log("✅ Audio generado, descargando a tu carpeta...");
                
                // Fetch al audio desde el servidor local de Qwen
                const resResponse = await fetch(result.data[0].url);
                const buffer = await resResponse.arrayBuffer();
                
                // Guardarlo en tu carpeta (GoogleImagenes u otra)
                fs.writeFileSync(outputDest, Buffer.from(buffer));
                console.log(`💾 Guardado exitosamente en: ${outputDest}`);
                
                return outputDest;
            } else {
                console.error("⚠️ La respuesta no tuvo un audio o hubo un error:", result);
                return null;
            }
        } catch (error) {
            console.error("❌ Error al interactuar con Qwen:", error.message);
            return null;
        }
    }
}

export default QwenClient;

// ====== TEST RÁPIDO ========
// Si ejecutas "node qwen-client.js" en la consola, se correrá esto:
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
    const qwen = new QwenClient();
    
    // Sustituye esto por la ruta real a algun archivo ".pt" que hayas guardado usando 
    // el botón "Save Voice File" de la interfaz web.
    // Ejemplo de tu captura:
    const archivoPT = "C:\\Users\\jaire\\AppData\\Local\\Temp\\gradio\\c5b8a0edce37a2a170f955d22a12d0d1a0a903c46f47aa0cc50234f2b4a3c2d7\\voice_clone_prompt_ttzmo_wk.pt"; 
    
    if (fs.existsSync(archivoPT)) {
        console.log("Iniciando prueba...");
        await qwen.generateFromPrompt(
            archivoPT,
            "¡Bienvenidos al canal! Si conocen las historias oscuras del PlayStation, prepárense.",
            "Auto",
            "./qwen_test_clonado.wav" // Se guardará junto a este script (en tu carpeta googleimagenes)
        );
    } else {
        console.log(`⚠️ Archivo de voz no encontrado. Para probar, sube un .pt valido o edita el script con una ruta real.`);
        console.log(`Ruta buscada: ${archivoPT}`);
    }
}
