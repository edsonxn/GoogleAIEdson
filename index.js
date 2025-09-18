import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import wav from 'wav';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import ApplioClient from "./applio-client.js";
import { transcribeAudio, getAudioTracks } from "./transcriber.js";
import multer from 'multer';
import axios from 'axios';
import * as cheerio from 'cheerio';
import ffmpeg from 'fluent-ffmpeg';
import { spawn, exec } from 'child_process';
import { createCanvas, loadImage } from 'canvas';
import ComfyUIClient from './comfyui-client.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Obtener __dirname equivalente en módulos ES6
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = 3000;

// Configurar cliente Applio
const applioClient = new ApplioClient();

// Variables para control de proceso ComfyUI
let comfyUIProcess = null;
const COMFYUI_PATH = 'C:\\comfy\\ComfyUI';
const COMFYUI_START_BAT = path.join(COMFYUI_PATH, 'start.bat');

// Variables para control de proceso Applio
let applioProcess = null;
let applioStarted = false; // Nueva variable para rastrear si ya se inició
const APPLIO_PATH = 'C:\\applio2\\Applio';
const APPLIO_START_BAT = path.join(APPLIO_PATH, 'run-applio.bat');

// Variable para rastrear progreso de proyectos
const projectProgressTracker = {};

/**
 * Extrae solo el contenido del guión de un archivo TXT completo
 * @param {string} fullContent - Contenido completo del archivo TXT con metadatos
 * @returns {object} - Objeto con el contenido del guión y información adicional
 */
function extractScriptContent(fullContent) {
  try {
    if (!fullContent || typeof fullContent !== 'string') {
      return { content: '', isEmpty: true, hasStructure: false };
    }
    
    // Verificar si tiene la estructura esperada de metadatos
    const hasStructure = fullContent.includes('CONTENIDO DEL GUIÓN:') || 
                        fullContent.includes('===============================');
    
    // Buscar el marcador de inicio del contenido
    const contentStart = fullContent.indexOf('CONTENIDO DEL GUIÓN:');
    if (contentStart === -1) {
      // Si no encuentra el marcador, intentar buscar patrones alternativos
      const altPatterns = [
        'CONTENIDO:',
        'GUIÓN:',
        'SCRIPT:',
        'TEXTO:'
      ];
      
      let startIndex = -1;
      for (const pattern of altPatterns) {
        const index = fullContent.indexOf(pattern);
        if (index !== -1) {
          startIndex = index + pattern.length;
          break;
        }
      }
      
      if (startIndex === -1) {
        // Si no encuentra ningún patrón, devolver todo el contenido limpio
        console.warn('⚠️ No se encontró marcador de inicio del guión, devolviendo contenido limpio');
        const cleanContent = fullContent.trim();
        return { 
          content: cleanContent, 
          isEmpty: cleanContent.length === 0, 
          hasStructure: hasStructure 
        };
      }
      
      const textAfterMarker = fullContent.substring(startIndex);
      const endMarker = textAfterMarker.indexOf('===============================');
      
      const extractedContent = endMarker !== -1 
        ? textAfterMarker.substring(0, endMarker).trim()
        : textAfterMarker.trim();
        
      return { 
        content: extractedContent, 
        isEmpty: extractedContent.length === 0, 
        hasStructure: hasStructure 
      };
    }
    
    // Extraer texto después del marcador "CONTENIDO DEL GUIÓN:"
    const startIndex = contentStart + 'CONTENIDO DEL GUIÓN:'.length;
    const textAfterMarker = fullContent.substring(startIndex);
    
    // Buscar el marcador de fin (línea de separación)
    const endMarker = textAfterMarker.indexOf('===============================');
    
    let scriptContent;
    if (endMarker !== -1) {
      // Extraer solo hasta el marcador de fin
      scriptContent = textAfterMarker.substring(0, endMarker);
    } else {
      // Si no hay marcador de fin, tomar todo después del inicio
      scriptContent = textAfterMarker;
    }
    
    // Limpiar el contenido
    scriptContent = scriptContent
      .replace(/Guión generado automáticamente por IA.*$/g, '') // Remover pie de página si quedó
      .replace(/^\s*\n+/, '') // Remover líneas vacías al inicio
      .replace(/\n+\s*$/, '') // Remover líneas vacías al final
      .trim();
    
    const isEmpty = scriptContent.length === 0;
    
    console.log(`📝 Script extraído: ${scriptContent.length} caracteres (de ${fullContent.length} originales)${isEmpty ? ' - CONTENIDO VACÍO' : ''}`);
    
    return { 
      content: scriptContent, 
      isEmpty: isEmpty, 
      hasStructure: hasStructure 
    };
    
  } catch (error) {
    console.error('❌ Error extrayendo contenido del script:', error);
    return { 
      content: fullContent.trim(), 
      isEmpty: fullContent.trim().length === 0, 
      hasStructure: false 
    }; // Devolver contenido original como fallback
  }
}

/**
 * Genera un guión faltante para una sección específica usando IA
 * @param {string} topic - Tema del proyecto
 * @param {number} sectionNumber - Número de la sección
 * @param {number} totalSections - Total de secciones del proyecto
 * @param {string} chapterTitle - Título del capítulo si está disponible
 * @param {Array} previousSections - Secciones anteriores para contexto
 * @param {string} scriptStyle - Estilo del script ('professional', 'comedy', 'custom')
 * @param {string} customStyleInstructions - Instrucciones personalizadas si es estilo custom
 * @param {number} wordsMin - Mínimo de palabras
 * @param {number} wordsMax - Máximo de palabras
 * @returns {Promise<object>} - Resultado de la generación
 */
async function generateMissingScript(topic, sectionNumber, totalSections, chapterTitle = null, previousSections = [], scriptStyle = 'professional', customStyleInstructions = '', wordsMin = 800, wordsMax = 1100) {
  try {
    console.log(`📝 Generando guión faltante para sección ${sectionNumber}/${totalSections}:`);
    console.log(`🎯 Tema: ${topic}`);
    console.log(`📖 Capítulo: ${chapterTitle || 'Sin título específico'}`);
    console.log(`🎨 Estilo: ${scriptStyle}`);
    
    // Preparar contexto de secciones anteriores en el formato correcto
    let previousChapterContent = [];
    if (previousSections && previousSections.length > 0) {
      previousChapterContent = previousSections.map(section => {
        const content = typeof section.script === 'string' ? section.script : section.script?.content || '';
        return content;
      });
    }
    
    // Preparar estructura de capítulos si hay título
    let chapterStructure = null;
    if (chapterTitle) {
      // Crear una estructura simple con el título actual
      chapterStructure = Array(totalSections).fill().map((_, index) => {
        if (index + 1 === sectionNumber) {
          return chapterTitle;
        }
        return `Capítulo ${index + 1}`;
      });
    }

    // Generar prompt usando las funciones existentes según el estilo
    let prompt;
    switch (scriptStyle) {
      case 'comedy':
        prompt = generateComedyPrompt(topic, totalSections, sectionNumber, chapterStructure, previousChapterContent, wordsMin, wordsMax);
        break;
      case 'custom':
        prompt = generateCustomPrompt(topic, totalSections, sectionNumber, chapterStructure, previousChapterContent, wordsMin, wordsMax, customStyleInstructions);
        break;
      case 'professional':
      default:
        prompt = generateProfessionalPrompt(topic, totalSections, sectionNumber, chapterStructure, previousChapterContent, wordsMin, wordsMax);
        break;
    }

    // Validar que la API key esté disponible
    if (!process.env.GOOGLE_API_KEY) {
      throw new Error('GOOGLE_API_KEY no está configurada en las variables de entorno');
    }

    // Usar el cliente de IA configurado (Gemini o similar)
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
    
    console.log('🤖 Enviando prompt al modelo de IA...');
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const generatedScript = response.text();
    
    if (!generatedScript || generatedScript.trim().length < 200) {
      throw new Error('El guión generado es demasiado corto o está vacío');
    }
    
    console.log(`✅ Guión generado: ${generatedScript.length} caracteres`);
    
    return {
      success: true,
      script: generatedScript.trim(),
      length: generatedScript.trim().length,
      sectionNumber: sectionNumber,
      topic: topic
    };
    
  } catch (error) {
    console.error(`❌ Error generando guión para sección ${sectionNumber}:`, error);
    return {
      success: false,
      error: error.message,
      sectionNumber: sectionNumber,
      topic: topic
    };
  }
}

// Funciones para controlar ComfyUI automáticamente
async function startComfyUI() {
  try {
    console.log('🚀 Iniciando ComfyUI en nueva ventana CMD...');
    
    // Verificar si ya está ejecutándose
    const client = new ComfyUIClient('http://127.0.0.1:8188');
    const connectionCheck = await client.checkConnection();
    if (connectionCheck.success) {
      console.log('✅ ComfyUI ya está ejecutándose');
      return true;
    }
    
    // Cerrar Applio antes de iniciar ComfyUI para evitar conflictos de recursos
    console.log('🛑 Cerrando Applio antes de iniciar ComfyUI para liberar recursos...');
    await stopApplio();
    console.log('✅ Applio cerrado, iniciando ComfyUI...');
    
    // Verificar que el archivo start.bat existe
    if (!fs.existsSync(COMFYUI_START_BAT)) {
      throw new Error(`No se encontró start.bat en: ${COMFYUI_START_BAT}`);
    }
    
    console.log(`📂 Abriendo nueva ventana CMD para ComfyUI...`);
    
    // Crear un archivo temporal .bat para evitar problemas con comillas
    const tempBatPath = path.join(__dirname, 'temp_start_comfyui.bat');
    const batContent = `@echo off
title ComfyUI Server - AutoRestart
cd /d "${COMFYUI_PATH}"
start.bat`;
    
    fs.writeFileSync(tempBatPath, batContent);
    
    // Ejecutar el archivo .bat en una nueva ventana
    comfyUIProcess = spawn('cmd', ['/c', 'start', tempBatPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    });
    
    // Desacoplar el proceso del proceso padre
    comfyUIProcess.unref();
    
    console.log(`🪟 Nueva ventana CMD abierta para ComfyUI`);
    
    // Limpiar el archivo temporal después de un momento
    setTimeout(() => {
      try {
        if (fs.existsSync(tempBatPath)) {
          fs.unlinkSync(tempBatPath);
        }
      } catch (error) {
        console.log('ℹ️ No se pudo eliminar archivo temporal:', tempBatPath);
      }
    }, 10000);
    
    // Esperar a que ComfyUI esté listo (máximo 90 segundos para dar tiempo al inicio)
    console.log('⏳ Esperando a que ComfyUI esté listo en la nueva ventana...');
    const maxAttempts = 90;
    let attempt = 0;
    
    while (attempt < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempt++;
      
      try {
        const check = await client.checkConnection();
        if (check.success) {
          console.log(`✅ ComfyUI listo después de ${attempt} segundos en nueva ventana`);
          return true;
        }
      } catch (error) {
        // Continuar intentando
      }
      
      if (attempt % 15 === 0) {
        console.log(`⏳ Intento ${attempt}/${maxAttempts}... (ComfyUI iniciándose en ventana separada)`);
      }
    }
    
    throw new Error('Timeout: ComfyUI no respondió después de 90 segundos');
    
  } catch (error) {
    console.error('❌ Error iniciando ComfyUI:', error.message);
    return false;
  }
}

async function stopComfyUI() {
  try {
    console.log('🛑 Cerrando ventana CMD de ComfyUI...');
    
    // Buscar y cerrar todos los procesos relacionados con ComfyUI
    // Esto cerrará tanto el proceso Python como la ventana CMD
    const killCommand = spawn('taskkill', [
      '/F',  // Forzar cierre
      '/IM', 'python.exe',  // Cerrar procesos Python (ComfyUI)
      '/T'   // Terminar árbol de procesos
    ], {
      stdio: 'ignore'
    });
    
    // También cerrar cualquier proceso CMD que tenga "ComfyUI" en el título
    const killCmdCommand = spawn('taskkill', [
      '/F',
      '/FI', 'WINDOWTITLE eq ComfyUI Server*'
    ], {
      stdio: 'ignore'
    });
    
    // Esperar a que los comandos de cierre terminen
    await Promise.all([
      new Promise(resolve => killCommand.on('close', resolve)),
      new Promise(resolve => killCmdCommand.on('close', resolve))
    ]);
    
    console.log('✅ Ventana CMD de ComfyUI cerrada');
    
    // Limpiar referencia del proceso
    comfyUIProcess = null;
    
    // Esperar un momento para que el proceso se cierre completamente
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    return true;
  } catch (error) {
    console.error('❌ Error cerrando ComfyUI:', error.message);
    return false;
  }
}

// Función para generar imagen con reinicio automático en caso de timeout
async function generateImageWithAutoRestart(prompt, options = {}, maxRetries = 2) {
  let attempt = 1;
  
  while (attempt <= maxRetries) {
    try {
      console.log(`🎨 [ATTEMPT ${attempt}/${maxRetries}] Generando imagen: "${prompt}"`);
      
      // Verificar si ComfyUI está disponible
      const client = new ComfyUIClient('http://127.0.0.1:8188');
      const connectionCheck = await client.checkConnection();
      
      if (!connectionCheck.success) {
        console.log(`⚠️ ComfyUI no disponible en intento ${attempt}, iniciando...`);
        const started = await startComfyUI();
        if (!started) {
          throw new Error('No se pudo iniciar ComfyUI');
        }
      }
      
      // Intentar generar imagen
      const result = await client.generateImage(prompt, options);
      console.log(`✅ Imagen generada exitosamente en intento ${attempt}`);
      return result;
      
    } catch (error) {
      console.error(`❌ Error en intento ${attempt}:`, error.message);
      
      // Si es timeout de ComfyUI y no es el último intento
      if (error.message.includes('COMFYUI_TIMEOUT') && attempt < maxRetries) {
        console.log(`⏱️ Timeout detectado (>90s), reiniciando ComfyUI...`);
        
        // Cerrar Applio y ComfyUI para liberar todos los recursos
        console.log('🛑 Cerrando Applio para liberar recursos GPU/VRAM...');
        await stopApplio();
        console.log('🛑 Cerrando ComfyUI que se colgó...');
        await stopComfyUI();
        
        // Esperar un momento antes de reiniciar
        console.log('⏳ Esperando 5 segundos antes de reiniciar...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Reiniciar ComfyUI
        console.log('🔄 Reiniciando ComfyUI en nueva ventana...');
        const restarted = await startComfyUI();
        
        if (!restarted) {
          console.error('❌ No se pudo reiniciar ComfyUI');
          if (attempt === maxRetries) {
            throw new Error('No se pudo reiniciar ComfyUI después del timeout');
          }
        } else {
          console.log('✅ ComfyUI reiniciado exitosamente, reintentando generación...');
        }
        
        attempt++;
        continue;
      }
      
      // Si no es timeout o es el último intento, lanzar error
      if (attempt === maxRetries) {
        throw error;
      }
      
      attempt++;
    }
  }
  
  throw new Error('Se agotaron los intentos de generación');
}

// Funciones para controlar Applio automáticamente
async function startApplio() {
  try {
    // Si ya está marcado como iniciado, solo verificar conexión
    if (applioStarted) {
      console.log('ℹ️ Applio ya fue iniciado anteriormente, verificando conexión...');
      const connectionCheck = await applioClient.checkConnection();
      if (connectionCheck) {
        console.log('✅ Applio sigue ejecutándose y listo');
        return true;
      } else {
        console.log('⚠️ Applio fue iniciado pero no responde, intentando reiniciar...');
        console.log('🔍 [DEBUG] Reseteando estado de Applio...');
        applioStarted = false; // Reset para permitir reinicio
      }
    }
    
    console.log('🚀 Iniciando Applio en nueva ventana CMD (primera vez)...');
    
    // Verificar si ya está ejecutándose
    const connectionCheck = await applioClient.checkConnection();
    if (connectionCheck) {
      console.log('✅ Applio ya está ejecutándose');
      applioStarted = true;
      return true;
    }
    
    // Verificar que el archivo run-applio.bat existe
    if (!fs.existsSync(APPLIO_START_BAT)) {
      throw new Error(`No se encontró run-applio.bat en: ${APPLIO_START_BAT}`);
    }
    
    console.log(`📂 Abriendo nueva ventana CMD para Applio...`);
    
    // Crear un archivo temporal .bat para evitar problemas con comillas
    const tempBatPath = path.join(__dirname, 'temp_start_applio.bat');
    const batContent = `@echo off
title Applio Server - PERMANENTE
cd /d "${APPLIO_PATH}"
run-applio.bat`;
    
    fs.writeFileSync(tempBatPath, batContent);
    
    // Ejecutar el archivo .bat en una nueva ventana
    applioProcess = spawn('cmd', ['/c', 'start', tempBatPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    });
    
    // Desacoplar el proceso del proceso padre
    applioProcess.unref();
    
    console.log(`🪟 Nueva ventana CMD abierta para Applio - PERMANENTE`);
    
    // Limpiar el archivo temporal después de un momento
    setTimeout(() => {
      try {
        if (fs.existsSync(tempBatPath)) {
          fs.unlinkSync(tempBatPath);
        }
      } catch (error) {
        console.log('ℹ️ No se pudo eliminar archivo temporal:', tempBatPath);
      }
    }, 10000);
    
    // Esperar a que Applio esté listo (máximo 120 segundos para dar tiempo al inicio)
    console.log('⏳ Esperando a que Applio esté listo en la nueva ventana...');
    const maxAttempts = 120;
    let attempt = 0;
    
    while (attempt < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempt++;
      
      try {
        const check = await applioClient.checkConnection();
        if (check) {
          console.log(`✅ Applio listo después de ${attempt} segundos en nueva ventana`);
          applioStarted = true; // Marcar como iniciado
          return true;
        }
      } catch (error) {
        // Continuar intentando
      }
      
      if (attempt % 20 === 0) {
        console.log(`⏳ Intento ${attempt}/${maxAttempts}... (Applio iniciándose en ventana separada)`);
      }
    }
    
    throw new Error('Timeout: Applio no respondió después de 120 segundos');
    
  } catch (error) {
    console.error('❌ Error iniciando Applio:', error.message);
    console.log('🔍 [DEBUG] Reseteando estado debido a error');
    applioStarted = false;
    return false;
  }
}

async function stopApplio() {
  try {
    console.log('🛑 Cerrando ventana CMD de Applio...');
    
    // Buscar y cerrar todos los procesos relacionados con Applio
    // Esto cerrará tanto el proceso Python como la ventana CMD
    const killCommand = spawn('taskkill', [
      '/F',  // Forzar cierre
      '/IM', 'python.exe',  // Cerrar procesos Python (Applio)
      '/T'   // Terminar árbol de procesos
    ], {
      stdio: 'ignore'
    });
    
    // También cerrar cualquier proceso CMD que tenga "Applio" en el título
    const killCmdCommand = spawn('taskkill', [
      '/F',
      '/FI', 'WINDOWTITLE eq Applio Server*'
    ], {
      stdio: 'ignore'
    });
    
    // Esperar a que los comandos de cierre terminen
    await Promise.all([
      new Promise(resolve => killCommand.on('close', resolve)),
      new Promise(resolve => killCmdCommand.on('close', resolve))
    ]);
    
    console.log('✅ Ventana CMD de Applio cerrada');
    
    // Limpiar referencia del proceso y estado
    applioProcess = null;
    applioStarted = false; // Reset del estado
    
    // Esperar un momento para que el proceso se cierre completamente
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    return true;
  } catch (error) {
    console.error('❌ Error cerrando Applio:', error.message);
    return false;
  }
}

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' })); // Aumentar límite para payloads grandes
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true })); // Para formularios grandes
app.use(express.static('public')); // Servir HTML y assets

// Configurar multer para subida de archivos
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const tempDir = './temp';
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    cb(null, tempDir);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '_' + file.originalname);
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 * 1024 // 5GB máximo para videos grandes
  },
  fileFilter: function (req, file, cb) {
    const allowedTypes = ['audio/mp3', 'audio/wav', 'audio/mpeg', 'audio/m4a', 'video/mp4'];
    const allowedExtensions = ['.mp3', '.wav', '.m4a', '.mp4'];
    
    const isValidType = allowedTypes.includes(file.mimetype) || 
                       allowedExtensions.some(ext => file.originalname.toLowerCase().endsWith(ext));
    
    if (isValidType) {
      cb(null, true);
    } else {
      cb(new Error('Formato de archivo no soportado'));
    }
  }
});

const ai = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

// Configurar cliente OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Almacén de conversaciones en memoria (historial por proyecto)
const conversationStore = new Map();

// Función helper para retry automático con Google AI
async function generateContentWithRetry(ai, params, maxRetries = 3, delay = 2000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🤖 Intento ${attempt}/${maxRetries} de generar contenido...`);
      const response = await ai.models.generateContent(params);
      console.log(`✅ Contenido generado exitosamente en el intento ${attempt}`);
      return response;
    } catch (error) {
      console.error(`❌ Error en intento ${attempt}/${maxRetries}:`, error.message);
      
      if (error.status === 503 && attempt < maxRetries) {
        console.log(`⏳ Esperando ${delay}ms antes del siguiente intento...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 1.5; // Incrementar delay exponencialmente
      } else {
        throw error; // Si no es error 503 o es el último intento, lanzar error
      }
    }
  }
}

// Función universal para generar contenido con múltiples proveedores LLM
async function generateUniversalContent(model, promptOrHistory, systemInstruction = null, maxRetries = 3) {
  console.log(`🤖 Generando contenido con modelo: ${model}`);
  
  // Determinar el proveedor basado en el modelo
  const isOpenAI = model.includes('gpt') || model.includes('openai');
  const isGoogle = model.includes('gemini') || model.includes('google');
  
  console.log(`🔍 Proveedor detectado: ${isOpenAI ? 'OpenAI' : 'Google AI'} para modelo "${model}"`);
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔄 Intento ${attempt}/${maxRetries} con ${isOpenAI ? 'OpenAI' : 'Google AI'}...`);
      
      if (isOpenAI) {
        // Usar OpenAI
        const messages = [];
        
        if (systemInstruction) {
          messages.push({
            role: "system",
            content: systemInstruction
          });
        }
        
        // Si promptOrHistory es un array (historial de conversación)
        if (Array.isArray(promptOrHistory)) {
          // OPTIMIZACIÓN PARA OPENAI: Solo usar los últimos 2 mensajes para ahorrar tokens
          const recentHistory = promptOrHistory.slice(-2);
          console.log(`🔄 OPTIMIZACIÓN OpenAI - Usando solo los últimos ${recentHistory.length} mensajes de ${promptOrHistory.length} total`);
          
          recentHistory.forEach(h => {
            if (h.role === 'user') {
              messages.push({
                role: "user",
                content: h.parts[0].text
              });
            } else if (h.role === 'model') {
              messages.push({
                role: "assistant", 
                content: h.parts[0].text
              });
            }
          });
        } else {
          // Si es un string simple
          messages.push({
            role: "user", 
            content: promptOrHistory
          });
        }
        
        // Configurar parámetros según el modelo
        const requestConfig = {
          model: model,
          messages: messages
        };
        
        // NO configurar max_completion_tokens - usar límites por defecto como Gemini
        // Esto permite máxima memoria disponible para cada modelo
        
        // Solo agregar temperature si NO es un modelo GPT-5 (todos los GPT-5 solo soportan valor por defecto)
        if (!model.startsWith('gpt-5')) {
          requestConfig.temperature = 0.7;
        }
        
        const response = await openai.chat.completions.create(requestConfig);
        
        console.log(`✅ Contenido generado exitosamente con OpenAI en intento ${attempt}`);
        
        const result = {
          text: response.choices[0].message.content
        };
        
        return result;
        
      } else {
        // Usar Google AI (comportamiento existente)
        const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
        const model_instance = genAI.getGenerativeModel({ model: model });
        
        // Si promptOrHistory es un array (historial de conversación)
        if (Array.isArray(promptOrHistory)) {
          const result = await model_instance.generateContent({
            contents: promptOrHistory,
            systemInstruction: systemInstruction
          });
          const response = await result.response;
          console.log(`✅ Contenido generado exitosamente con Google AI en intento ${attempt}`);
          return await response.text();
        } else {
          const result = await model_instance.generateContent(promptOrHistory);
          const response = await result.response;
          console.log(`✅ Contenido generado exitosamente con Google AI en intento ${attempt}`);
          return await response.text();
        }
      }
      
    } catch (error) {
      console.error(`❌ Error en intento ${attempt}/${maxRetries}:`, error.message);
      
      const isRetryableError = (isOpenAI && error.status >= 500) || 
                              (!isOpenAI && error.status === 503);
      
      if (isRetryableError && attempt < maxRetries) {
        const delay = 2000 * Math.pow(1.5, attempt - 1);
        console.log(`⏳ Esperando ${delay}ms antes del siguiente intento...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }
  
  // Si llegamos aquí, todos los intentos fallaron
  throw new Error(`No se pudo generar contenido después de ${maxRetries} intentos`);
}

// Función para optimizar historial manteniendo continuidad narrativa
function optimizeConversationHistory(conversation) {
  const historialAntes = conversation.history.length;
  
  // No optimizar si el historial es pequeño
  if (historialAntes <= 6) {
    return;
  }
  
  console.log(`🧠 OPTIMIZACIÓN INTELIGENTE - Manteniendo continuidad narrativa...`);
  
  if (historialAntes > 8) {
    // Para series largas: mantener contexto inicial + contexto reciente
    const contextoInicial = conversation.history.slice(0, 2); // Primer capítulo
    const contextoReciente = conversation.history.slice(-6);   // Últimos 3 capítulos
    
    conversation.history = [...contextoInicial, ...contextoReciente];
    
    console.log(`🔄 OPTIMIZACIÓN - Historial reestructurado de ${historialAntes} a ${conversation.history.length} mensajes`);
    console.log(`📚 ESTRATEGIA - Manteniendo: capítulo inicial (contexto base) + últimos 3 capítulos (continuidad)`);
  } else {
    // Para series medianas: mantener últimos 3 capítulos
    conversation.history = conversation.history.slice(-6);
    console.log(`🔄 OPTIMIZACIÓN - Historial reducido de ${historialAntes} a ${conversation.history.length} mensajes (últimos 3 capítulos)`);
  }
  
  console.log(`💰 AHORRO DE TOKENS - Eliminados ${historialAntes - conversation.history.length} mensajes intermedios`);
}

// Función para estimar tokens aproximadamente (1 token ≈ 4 caracteres en español)
function estimateTokens(text) {
  if (!text || typeof text !== 'string') return 0;
  return Math.ceil(text.length / 4);
}

// Función para obtener o crear una conversación
function getOrCreateConversation(projectKey) {
  if (!conversationStore.has(projectKey)) {
    conversationStore.set(projectKey, {
      history: [],
      topic: '',
      totalSections: 0,
      currentSection: 0,
      chapterStructure: [],
      createdAt: Date.now()
    });
  }
  return conversationStore.get(projectKey);
}

// Función para limpiar conversaciones antiguas (más de 24 horas)
function cleanOldConversations() {
  const now = Date.now();
  const oneDayInMs = 24 * 60 * 60 * 1000;
  
  for (const [key, conversation] of conversationStore.entries()) {
    if (now - conversation.createdAt > oneDayInMs) {
      conversationStore.delete(key);
    }
  }
}

// Función para obtener las voces disponibles de Applio
function getAvailableVoices() {
  try {
    const voicesPath = path.join('C:', 'applio2', 'Applio', 'logs', 'VOCES');
    console.log(`🔍 Buscando voces en: ${voicesPath}`);
    
    if (!fs.existsSync(voicesPath)) {
      console.warn(`⚠️ Carpeta de voces no encontrada: ${voicesPath}`);
      return [{
        name: 'RemyOriginal (Default)',
        path: 'logs\\VOCES\\RemyOriginal.pth',
        displayName: 'RemyOriginal'
      }];
    }
    
    const files = fs.readdirSync(voicesPath);
    const voiceFiles = files.filter(file => file.endsWith('.pth'));
    
    console.log(`📂 Archivos .pth encontrados: ${voiceFiles.length}`);
    
    const voices = voiceFiles.map(file => {
      const baseName = path.basename(file, '.pth');
      return {
        name: baseName,
        path: `logs\\VOCES\\${file}`,
        displayName: baseName
      };
    });
    
    // Si no hay voces, agregar la por defecto
    if (voices.length === 0) {
      voices.push({
        name: 'RemyOriginal (Default)',
        path: 'logs\\VOCES\\RemyOriginal.pth',
        displayName: 'RemyOriginal'
      });
    }
    
    console.log(`✅ Voces disponibles: ${voices.map(v => v.displayName).join(', ')}`);
    return voices;
    
  } catch (error) {
    console.error('❌ Error leyendo voces:', error);
    return [{
      name: 'RemyOriginal (Default)',
      path: 'logs\\VOCES\\RemyOriginal.pth',
      displayName: 'RemyOriginal'
    }];
  }
}

// Estilos predeterminados de miniatura
const defaultThumbnailStyles = {
  'default': {
    name: 'Amarillo y Blanco (Predeterminado)',
    description: 'Estilo clásico con texto amarillo y blanco',
    primaryColor: 'amarillo',
    secondaryColor: 'blanco',
    instructions: 'El texto que se muestre debe de tener 2 colores, letras llamativas y brillosas con efecto luminoso, la frase menos importante de color blanco, la frase importante color amarillo, todo con contorno negro, letras brillosas con resplandor'
  },
  'gaming_red': {
    name: 'Rojo Gaming',
    description: 'Estilo gaming agresivo con rojos brillantes',
    primaryColor: 'rojo brillante',
    secondaryColor: 'blanco',
    instructions: 'El texto debe tener un estilo gaming agresivo con la frase principal en rojo brillante intenso y la secundaria en blanco, ambas con contorno negro grueso y efecto de resplandor rojo'
  },
  'neon_blue': {
    name: 'Azul Neón',
    description: 'Estilo futurista con azul neón y efectos cyberpunk',
    primaryColor: 'azul neón',
    secondaryColor: 'cyan claro',
    instructions: 'El texto debe tener un estilo futurista cyberpunk con la frase principal en azul neón brillante y la secundaria en cyan claro, con contorno oscuro y efectos de resplandor azul neón'
  },
  'retro_purple': {
    name: 'Púrpura Retro',
    description: 'Estilo retro gaming con púrpura y rosa',
    primaryColor: 'púrpura brillante',
    secondaryColor: 'rosa',
    instructions: 'El texto debe tener un estilo retro gaming de los 80s con la frase principal en púrpura brillante y la secundaria en rosa, con contorno negro y efectos de resplandor púrpura'
  }
};

// Función para obtener instrucciones de estilo de miniatura
function getThumbnailStyleInstructions(styleId) {
  // Si es un estilo personalizado (enviado desde el frontend)
  if (typeof styleId === 'object' && styleId) {
    // Construir instrucciones completas usando los colores específicos
    const primaryColor = styleId.primaryColor || 'amarillo';
    const secondaryColor = styleId.secondaryColor || 'blanco';
    const customInstructions = styleId.instructions || '';
    
    const fullInstructions = `El texto debe tener la frase principal en color ${primaryColor} brillante y la frase secundaria en color ${secondaryColor}, ambas con contorno negro grueso, letras brillosas con efecto luminoso y resplandor. Estilo visual: ${customInstructions}`;
    
    return fullInstructions;
  }
  
  // Si es un estilo predeterminado
  if (typeof styleId === 'string' && defaultThumbnailStyles[styleId]) {
    return defaultThumbnailStyles[styleId].instructions;
  }
  
  // Fallback al estilo predeterminado
  return defaultThumbnailStyles.default.instructions;
}

// Limpiar conversaciones antiguas cada hora
setInterval(cleanOldConversations, 60 * 60 * 1000);

// ================================
// SISTEMA DE GUARDADO Y CARGA DE PROYECTOS
// ================================

// Función para guardar el estado completo del proyecto
function saveProjectState(projectData) {
  try {
    const { 
      topic, 
      folderName, 
      totalSections, 
      currentSection, 
      voice, 
      imageModel, 
      scriptStyle, 
      customStyleInstructions,
      promptModifier,
      imageCount,
      minWords,
      maxWords,
      skipImages,
      googleImages,
      applioVoice
    } = projectData;
    
    const safeFolderName = folderName && folderName.trim() 
      ? createSafeFolderName(folderName.trim())
      : createSafeFolderName(topic);
    
    const outputsDir = path.join('./public/outputs');
    const projectDir = path.join(outputsDir, safeFolderName);
    
    // Crear carpetas si no existen
    if (!fs.existsSync(outputsDir)) {
      fs.mkdirSync(outputsDir, { recursive: true });
    }
    if (!fs.existsSync(projectDir)) {
      fs.mkdirSync(projectDir, { recursive: true });
    }
    
    const projectStateFile = path.join(projectDir, 'project_state.json');
    
    const projectState = {
      topic,
      folderName: safeFolderName,
      originalFolderName: folderName,
      totalSections,
      currentSection,
      voice,
      imageModel,
      scriptStyle,
      customStyleInstructions,
      promptModifier: promptModifier || '',
      imageCount: imageCount || 3,
      minWords: minWords || 800,
      maxWords: maxWords || 1100,
      skipImages: skipImages || false,
      googleImages: googleImages || false,
      applioVoice: applioVoice || 'logs\\VOCES\\RemyOriginal.pth',
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      completedSections: []
    };
    
    // Si ya existe un archivo de estado, preservar secciones completadas
    if (fs.existsSync(projectStateFile)) {
      const existingState = JSON.parse(fs.readFileSync(projectStateFile, 'utf8'));
      projectState.completedSections = existingState.completedSections || [];
      projectState.createdAt = existingState.createdAt || projectState.createdAt;
    }
    
    fs.writeFileSync(projectStateFile, JSON.stringify(projectState, null, 2), 'utf8');
    console.log(`💾 Estado del proyecto guardado: ${projectStateFile}`);
    
    return projectState;
  } catch (error) {
    console.error('❌ Error guardando estado del proyecto:', error);
    return null;
  }
}

// Función para generar metadatos de YouTube automáticamente para un proyecto completo
async function generateYouTubeMetadataForProject(projectState) {
  try {
    console.log(`🎬 Iniciando generación automática de metadatos para: ${projectState.topic}`);
    
    const safeFolderName = projectState.folderName;
    const projectDir = path.join('./public/outputs', safeFolderName);
    const projectStateFile = path.join(projectDir, 'project_state.json');
    
    // Recopilar todos los scripts de las secciones completadas
    const allSections = [];
    for (const section of projectState.completedSections.sort((a, b) => a.section - b.section)) {
      if (section.script) {
        allSections.push(section.script);
      }
    }
    
    if (allSections.length === 0) {
      console.log(`⚠️ No hay secciones con script para generar metadatos`);
      return;
    }
    
    console.log(`📝 Generando metadatos con ${allSections.length} secciones`);
    
    // Combinar todas las secciones
    const fullScript = allSections.join('\n\n--- SECCIÓN ---\n\n');
    
    // Obtener instrucciones de estilo de miniatura (usar default si no está especificado)
    const thumbnailStyle = projectState.thumbnailStyle || 'default';
    const thumbnailInstructions = getThumbnailStyleInstructions(thumbnailStyle);
    
    console.log(`🎨 Usando estilo de miniatura: ${thumbnailStyle}`);
    
    // Generar prompt para metadatos
    const prompt = `
Basándote en el siguiente tema y guión completo del video, genera metadata optimizada para YouTube:

**TEMA:** ${projectState.topic}

**GUIÓN COMPLETO:**
${fullScript}

Por favor genera:

1. **10 TÍTULOS CLICKBAIT** (cada uno en una línea, numerados):
   - Usa palabras que generen curiosidad como "QUE PASA CUANDO", "POR QUE", "HICE ESTO Y PASO ESTO", "NO VAS A CREER", "ESTO CAMBIÓ TODO"
   - Que sean polémicos pero relacionados al contenido
   - maximo 15 palabras, minimo 10.

2. **DESCRIPCIÓN PARA VIDEO** (optimizada para SEO):
   - Entre 150-300 palabras
   - Incluye palabras clave relevantes del tema
   - Menciona el contenido principal del video
   - Incluye call-to-action para suscribirse
   - Formato atractivo con emojis

3. **25 ETIQUETAS** (separadas por comas):
   - Palabras clave relacionadas al tema
   - Tags populares del nicho correspondiente
   - Términos de búsqueda relevantes
   - Sin espacios en tags compuestos (usar guiones o camelCase)

4. **5 PROMPTS PARA MINIATURAS DE YOUTUBE** (cada uno en una línea, numerados):
   
   FORMATO OBLIGATORIO - DEBES SEGUIR ESTA ESTRUCTURA EXACTA PARA CADA UNO DE LOS 5 PROMPTS:
   
   "Miniatura de YouTube 16:9 mostrando [descripción visual muy detallada del contenido relacionado al tema, mínimo 15 palabras] con texto superpuesto '[frase clickbait específica relacionada al contenido]' con el texto aplicando el siguiente estilo: ${thumbnailInstructions}"
   
   REGLAS ESTRICTAS - NO GENERAR PROMPTS CORTOS O INCOMPLETOS:
   - CADA prompt debe tener mínimo 25 palabras de descripción visual
   - CADA prompt debe incluir una frase clickbait específica entre comillas
   - CADA prompt debe terminar con la frase completa del estilo
   - NO generar prompts como "el texto con contorno negro" - ESO ESTÁ PROHIBIDO
   - TODOS los prompts deben seguir el formato completo

REGLAS ESTRICTAS:
- EXACTAMENTE 5 prompts numerados del 1 al 5
- Cada prompt debe incluir la frase completa del estilo al final
- NO hacer referencias a estilos anteriores
`;

    // Validar que la API key esté disponible
    if (!process.env.GOOGLE_API_KEY) {
      throw new Error('GOOGLE_API_KEY no está configurada en las variables de entorno');
    }

    // Llamar a la IA para generar metadatos
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
    
    console.log(`🤖 Enviando request a Gemini para generar metadatos...`);
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const generatedMetadata = response.text();
    
    console.log(`✅ Metadatos generados exitosamente`);
    
    // Guardar metadatos en archivo separado
    const metadataFile = path.join(projectDir, `${safeFolderName}_youtube_metadata.txt`);
    const metadataContent = `METADATA DE YOUTUBE PARA: ${projectState.topic}
Generado automáticamente: ${new Date().toLocaleString()}
Proyecto: ${projectState.originalFolderName || projectState.topic}
Secciones: ${projectState.completedSections.length}/${projectState.totalSections}

====================================

${generatedMetadata}

====================================
GUIÓN COMPLETO UTILIZADO:
====================================

${fullScript}`;
    
    fs.writeFileSync(metadataFile, metadataContent, 'utf8');
    console.log(`💾 Metadatos guardados en: ${metadataFile}`);
    
    // Actualizar estado del proyecto con los metadatos
    const updatedProjectState = JSON.parse(fs.readFileSync(projectStateFile, 'utf8'));
    updatedProjectState.youtubeMetadata = {
      generatedAt: new Date().toISOString(),
      content: generatedMetadata,
      thumbnailStyle: thumbnailStyle,
      filename: `${safeFolderName}_youtube_metadata.txt`
    };
    updatedProjectState.lastModified = new Date().toISOString();
    
    fs.writeFileSync(projectStateFile, JSON.stringify(updatedProjectState, null, 2), 'utf8');
    
    console.log(`🎬 ¡Metadatos de YouTube generados automáticamente para el proyecto completado!`);
    
    return updatedProjectState;
    
  } catch (error) {
    console.error(`❌ Error generando metadatos automáticos:`, error);
    throw error;
  }
}

// Función para actualizar sección completada
function updateCompletedSection(projectData, sectionNumber, sectionData) {
  try {
    const { topic, folderName } = projectData;
    
    const safeFolderName = folderName && folderName.trim() 
      ? createSafeFolderName(folderName.trim())
      : createSafeFolderName(topic);
    
    const projectStateFile = path.join('./public/outputs', safeFolderName, 'project_state.json');
    
    if (fs.existsSync(projectStateFile)) {
      const projectState = JSON.parse(fs.readFileSync(projectStateFile, 'utf8'));
      
      // Actualizar o agregar sección completada
      const existingSectionIndex = projectState.completedSections.findIndex(s => s.section === sectionNumber);
      
      const sectionInfo = {
        section: sectionNumber,
        script: sectionData.script,
        imageCount: sectionData.images ? sectionData.images.length : 0,
        hasImages: !sectionData.imagesSkipped && !sectionData.googleImagesMode,
        googleImagesMode: sectionData.googleImagesMode || false,
        imagesSkipped: sectionData.imagesSkipped || false,
        imagePrompts: sectionData.imagePrompts || [],
        completedAt: new Date().toISOString(),
        scriptFile: sectionData.scriptFile,
        promptsFile: sectionData.promptsFile
      };
      
      if (existingSectionIndex >= 0) {
        projectState.completedSections[existingSectionIndex] = sectionInfo;
      } else {
        projectState.completedSections.push(sectionInfo);
      }
      
      // Ordenar secciones por número
      projectState.completedSections.sort((a, b) => a.section - b.section);
      
      projectState.lastModified = new Date().toISOString();
      projectState.currentSection = Math.max(projectState.currentSection, sectionNumber);
      
      fs.writeFileSync(projectStateFile, JSON.stringify(projectState, null, 2), 'utf8');
      console.log(`✅ Sección ${sectionNumber} marcada como completada en el proyecto`);
      
      // 🎬 VERIFICAR SI EL PROYECTO ESTÁ COMPLETO Y GENERAR METADATOS DE YOUTUBE
      const isProjectComplete = projectState.completedSections.length >= projectState.totalSections;
      console.log(`📊 Progreso del proyecto: ${projectState.completedSections.length}/${projectState.totalSections} - Completo: ${isProjectComplete}`);
      
      if (isProjectComplete && !projectState.youtubeMetadata) {
        console.log(`🎬 ¡Proyecto completo! Generando metadatos de YouTube automáticamente...`);
        
        // Generar metadatos automáticamente en background
        setTimeout(() => {
          generateYouTubeMetadataForProject(projectState).catch(error => {
            console.error('❌ Error generando metadatos automáticos:', error);
          });
        }, 1000); // Pequeño delay para que la respuesta HTTP se complete primero
      }
      
      return projectState;
    }
    
    return null;
  } catch (error) {
    console.error('❌ Error actualizando sección completada:', error);
    return null;
  }
}

// Función para reconstruir el estado de un proyecto desde las carpetas existentes
function reconstructProjectState(folderName) {
  try {
    console.log(`🔧 Reconstruyendo estado del proyecto: ${folderName}`);
    
    const projectDir = path.join('./public/outputs', folderName);
    
    if (!fs.existsSync(projectDir)) {
      console.error(`❌ Directorio del proyecto no existe: ${projectDir}`);
      return null;
    }
    
    // Buscar carpetas de secciones
    const sectionDirs = fs.readdirSync(projectDir)
      .filter(item => {
        const itemPath = path.join(projectDir, item);
        return fs.statSync(itemPath).isDirectory() && item.startsWith('seccion_');
      })
      .sort((a, b) => {
        const numA = parseInt(a.replace('seccion_', ''));
        const numB = parseInt(b.replace('seccion_', ''));
        return numA - numB;
      });
    
    console.log(`📁 Carpetas de secciones encontradas: ${sectionDirs.join(', ')}`);
    
    if (sectionDirs.length === 0) {
      console.error(`❌ No se encontraron carpetas de secciones en ${projectDir}`);
      return null;
    }
    
    const completedSections = [];
    let totalSections = 0;
    let projectTopic = folderName; // Usar el nombre de la carpeta como fallback
    
    // Analizar cada sección
    for (const sectionDir of sectionDirs) {
      const sectionNumber = parseInt(sectionDir.replace('seccion_', ''));
      totalSections = Math.max(totalSections, sectionNumber);
      
      const sectionPath = path.join(projectDir, sectionDir);
      const files = fs.readdirSync(sectionPath);
      
      console.log(`🔍 Analizando sección ${sectionNumber}: ${files.length} archivos`);
      
      // Buscar archivos de texto (script)
      const scriptFiles = files.filter(file => 
        file.endsWith('.txt') && !file.includes('metadata') && !file.includes('keywords')
      );
      
      // Buscar archivos de audio
      const audioFiles = files.filter(file => 
        file.endsWith('.wav') || file.endsWith('.mp3') || 
        file.endsWith('.m4a') || file.endsWith('.ogg')
      );
      
      // Buscar archivos de imágenes
      const imageFiles = files.filter(file => 
        file.endsWith('.png') || file.endsWith('.jpg') || 
        file.endsWith('.jpeg') || file.endsWith('.webp')
      );
      
      // Buscar archivo de keywords
      const keywordFiles = files.filter(file => 
        file.includes('keywords') && file.endsWith('.txt')
      );
      
      let sectionScript = '';
      let sectionTitle = `Sección ${sectionNumber}`;
      
      // Leer el script si existe
      if (scriptFiles.length > 0) {
        try {
          const scriptFilePath = path.join(sectionPath, scriptFiles[0]);
          const fullScriptContent = fs.readFileSync(scriptFilePath, 'utf8');
          
          // Extraer solo el contenido del guión sin metadatos
          const scriptResult = extractScriptContent(fullScriptContent);
          sectionScript = scriptResult.content;
          
          // Si el script está vacío, marcarlo para regeneración posterior
          if (scriptResult.isEmpty && scriptResult.hasStructure) {
            console.warn(`⚠️ Sección ${sectionNumber} tiene estructura pero contenido vacío - necesita regeneración`);
            sectionScript = ''; // Marcar como vacío para regenerar después
          }
          
          // Para el título, usar el contenido del archivo completo para extraer metadatos
          const firstLine = fullScriptContent.split('\n')[0];
          if (firstLine && firstLine.length > 0 && firstLine.length < 200) {
            sectionTitle = firstLine.trim();
          } else {
            // Usar las primeras 50 caracteres del script limpio como título (si no está vacío)
            if (sectionScript.length > 0) {
              sectionTitle = sectionScript.substring(0, 50).trim() + '...';
            } else {
              sectionTitle = `Sección ${sectionNumber} (sin contenido)`;
            }
          }
          
          console.log(`📝 Script encontrado para sección ${sectionNumber}: ${sectionScript.length} caracteres (limpio), ${fullScriptContent.length} caracteres (completo)${scriptResult.isEmpty ? ' - VACÍO' : ''}`);
        } catch (readError) {
          console.warn(`⚠️ Error leyendo script de sección ${sectionNumber}:`, readError.message);
        }
      }
      
      // Si es la primera sección, intentar inferir el tema del proyecto
      if (sectionNumber === 1 && sectionScript) {
        // Usar las primeras palabras del script como tema del proyecto
        const words = sectionScript.split(' ').slice(0, 10).join(' ');
        if (words.length > 10) {
          projectTopic = words.trim();
        }
      }
      
      const sectionData = {
        section: sectionNumber,
        title: sectionTitle,
        script: sectionScript,
        hasScript: scriptFiles.length > 0,
        hasAudio: audioFiles.length > 0,
        hasImages: imageFiles.length > 0,
        hasKeywords: keywordFiles.length > 0,
        scriptFile: scriptFiles[0] || null,
        audioFiles: audioFiles,
        imageFiles: imageFiles.map(file => `outputs/${folderName}/${sectionDir}/${file}`),
        keywordFile: keywordFiles[0] || null,
        fileCount: files.length
      };
      
      completedSections.push(sectionData);
      console.log(`✅ Sección ${sectionNumber} reconstruida: script=${sectionData.hasScript}, audio=${sectionData.hasAudio}, imágenes=${sectionData.hasImages}`);
    }
    
    // Construir el estado del proyecto
    const reconstructedState = {
      topic: projectTopic,
      originalFolderName: folderName,
      folderName: folderName,
      totalSections: totalSections,
      completedSections: completedSections,
      sectionsCompleted: completedSections.length,
      lastModified: new Date().toISOString(),
      reconstructed: true,
      reconstructedAt: new Date().toISOString(),
      voice: 'shimmer', // Valor por defecto
      imageModel: 'gemini2', // Valor por defecto
      llmModel: 'gemini-2.5-flash', // Valor por defecto (Flash más rápido)
      scriptStyle: 'professional', // Valor por defecto
      imageCount: 5, // Valor por defecto
      minWords: 800,
      maxWords: 1100,
      skipImages: false,
      googleImages: false,
      localAIImages: false
    };
    
    console.log(`🔧 Estado del proyecto reconstruido:`, {
      topic: reconstructedState.topic,
      totalSections: reconstructedState.totalSections,
      sectionsCompleted: reconstructedState.sectionsCompleted,
      carpetasAnalizadas: sectionDirs.length
    });
    
    return reconstructedState;
    
  } catch (error) {
    console.error(`❌ Error reconstruyendo estado del proyecto ${folderName}:`, error);
    return null;
  }
}

// Función para obtener lista de proyectos disponibles
function getAvailableProjects() {
  try {
    const outputsDir = path.join('./public/outputs');
    
    if (!fs.existsSync(outputsDir)) {
      return [];
    }
    
    const projects = [];
    const folders = fs.readdirSync(outputsDir);
    
    for (const folder of folders) {
      const projectDir = path.join(outputsDir, folder);
      const projectStateFile = path.join(projectDir, 'project_state.json');
      
      if (fs.existsSync(projectStateFile) && fs.statSync(projectDir).isDirectory()) {
        try {
          const fileContent = fs.readFileSync(projectStateFile, 'utf8');
          
          // Verificar si el archivo está vacío o incompleto
          if (!fileContent.trim()) {
            console.warn(`⚠️ Archivo JSON vacío para proyecto ${folder}, intentando reconstruir...`);
            
            // Intentar reconstruir el estado del proyecto
            const reconstructedState = reconstructProjectState(folder);
            
            if (reconstructedState) {
              // Guardar el estado reconstruido
              fs.writeFileSync(projectStateFile, JSON.stringify(reconstructedState, null, 2), 'utf8');
              console.log(`✅ Estado del proyecto ${folder} reconstruido y guardado`);
              
              projects.push({
                ...reconstructedState,
                folderPath: folder,
                sectionsCompleted: reconstructedState.completedSections?.length || 0,
                lastModifiedDate: new Date(reconstructedState.lastModified || Date.now()).toLocaleString()
              });
              continue;
            } else {
              console.error(`❌ No se pudo reconstruir el proyecto ${folder}`);
              continue;
            }
          }
          
          // Verificar si el JSON parece estar incompleto
          if (!fileContent.trim().endsWith('}') && !fileContent.trim().endsWith(']')) {
            console.warn(`⚠️ Archivo JSON parece incompleto para proyecto ${folder}: termina con '${fileContent.slice(-10)}'`);
            console.warn(`📋 Intentando reparar archivo JSON para proyecto ${folder}...`);
            
            // Intentar agregar llaves faltantes si es necesario
            let repairedContent = fileContent.trim();
            
            // Contar llaves abiertas vs cerradas
            const openBraces = (repairedContent.match(/\{/g) || []).length;
            const closeBraces = (repairedContent.match(/\}/g) || []).length;
            
            if (openBraces > closeBraces) {
              // Agregar llaves faltantes
              for (let i = 0; i < openBraces - closeBraces; i++) {
                repairedContent += '}';
              }
              console.log(`🔧 Agregadas ${openBraces - closeBraces} llaves faltantes para proyecto ${folder}`);
            }
            
            try {
              const projectState = JSON.parse(repairedContent);
              
              // Si la reparación fue exitosa, guardar el archivo corregido
              fs.writeFileSync(projectStateFile, JSON.stringify(projectState, null, 2), 'utf8');
              console.log(`✅ Archivo JSON reparado y guardado para proyecto ${folder}`);
              
              projects.push({
                ...projectState,
                folderPath: folder,
                sectionsCompleted: projectState.completedSections?.length || 0,
                lastModifiedDate: new Date(projectState.lastModified || Date.now()).toLocaleString()
              });
              continue;
            } catch (repairError) {
              console.error(`❌ No se pudo reparar JSON para proyecto ${folder}:`, repairError.message);
              console.log(`📄 Contenido problemático (primeros 200 chars): ${fileContent.substring(0, 200)}...`);
              continue;
            }
          }
          
          const projectState = JSON.parse(fileContent);
          projects.push({
            ...projectState,
            folderPath: folder,
            sectionsCompleted: projectState.completedSections?.length || 0,
            lastModifiedDate: new Date(projectState.lastModified || Date.now()).toLocaleString()
          });
        } catch (parseError) {
          console.warn(`⚠️ Error leyendo proyecto ${folder}:`, parseError);
          
          // Intentar crear un backup del archivo corrupto
          try {
            const backupPath = projectStateFile + '.corrupted.' + Date.now();
            fs.copyFileSync(projectStateFile, backupPath);
            console.log(`🗃️ Backup del archivo corrupto creado: ${backupPath}`);
          } catch (backupError) {
            console.warn(`⚠️ No se pudo crear backup para ${folder}:`, backupError.message);
          }
        }
      }
    }
    
    console.log(`📊 Total proyectos válidos: ${projects.length}`);
    
    // Ordenar por última modificación (más recientes primero)
    projects.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
    
    return projects;
  } catch (error) {
    console.error('❌ Error obteniendo proyectos disponibles:', error);
    return [];
  }
}

// Función para cargar estado completo de un proyecto
function loadProjectState(folderName) {
  try {
    const projectStateFile = path.join('./public/outputs', folderName, 'project_state.json');
    console.log(`🔍 Buscando archivo de estado: ${projectStateFile}`);
    
    if (!fs.existsSync(projectStateFile)) {
      console.log(`❌ Archivo project_state.json no existe para proyecto "${folderName}"`);
      return null;
    }
    
    console.log(`✅ Archivo de estado encontrado, leyendo contenido...`);
    
    let projectState;
    try {
      const fileContent = fs.readFileSync(projectStateFile, 'utf8');
      
      // Verificar si el archivo está vacío o incompleto
      if (!fileContent.trim()) {
        console.warn(`⚠️ Archivo JSON vacío para proyecto "${folderName}", intentando reconstruir...`);
        
        // Intentar reconstruir el estado del proyecto
        const reconstructedState = reconstructProjectState(folderName);
        
        if (reconstructedState) {
          // Guardar el estado reconstruido
          fs.writeFileSync(projectStateFile, JSON.stringify(reconstructedState, null, 2), 'utf8');
          console.log(`✅ Estado del proyecto "${folderName}" reconstruido y guardado`);
          projectState = reconstructedState;
        } else {
          console.error(`❌ No se pudo reconstruir el proyecto "${folderName}"`);
          return null;
        }
      }
      
      // Intentar parsear directamente primero
      try {
        projectState = JSON.parse(fileContent);
      } catch (initialParseError) {
        console.warn(`⚠️ Error inicial parseando JSON, intentando reparar...`);
        
        // Verificar si el JSON parece estar incompleto
        if (!fileContent.trim().endsWith('}') && !fileContent.trim().endsWith(']')) {
          console.warn(`⚠️ Archivo JSON parece incompleto para proyecto "${folderName}": termina con '${fileContent.slice(-10)}'`);
          
          // Intentar agregar llaves faltantes si es necesario
          let repairedContent = fileContent.trim();
          
          // Contar llaves abiertas vs cerradas
          const openBraces = (repairedContent.match(/\{/g) || []).length;
          const closeBraces = (repairedContent.match(/\}/g) || []).length;
          
          if (openBraces > closeBraces) {
            // Agregar llaves faltantes
            for (let i = 0; i < openBraces - closeBraces; i++) {
              repairedContent += '}';
            }
            console.log(`🔧 Agregadas ${openBraces - closeBraces} llaves faltantes para proyecto "${folderName}"`);
            
            try {
              projectState = JSON.parse(repairedContent);
              
              // Si la reparación fue exitosa, guardar el archivo corregido
              fs.writeFileSync(projectStateFile, JSON.stringify(projectState, null, 2), 'utf8');
              console.log(`✅ Archivo JSON reparado y guardado para proyecto "${folderName}"`);
            } catch (repairError) {
              console.error(`❌ No se pudo reparar JSON para proyecto "${folderName}":`, repairError.message);
              
              // Crear backup del archivo corrupto
              try {
                const backupPath = projectStateFile + '.corrupted.' + Date.now();
                fs.copyFileSync(projectStateFile, backupPath);
                console.log(`🗃️ Backup del archivo corrupto creado: ${backupPath}`);
              } catch (backupError) {
                console.warn(`⚠️ No se pudo crear backup: ${backupError.message}`);
              }
              
              return null;
            }
          } else {
            // No se pudo determinar cómo reparar
            console.error(`❌ No se pudo reparar JSON para proyecto "${folderName}"`);
            console.log(`📄 Contenido problemático (primeros 200 chars): ${fileContent.substring(0, 200)}...`);
            return null;
          }
        } else {
          // El archivo parece completo pero aún no se puede parsear
          throw initialParseError;
        }
      }
      
      console.log(`📊 Estado del proyecto "${folderName}" cargado:`, {
        topic: projectState.topic,
        totalSections: projectState.totalSections,
        completedSections: projectState.completedSections?.length || 0
      });
    } catch (parseError) {
      console.error(`❌ Error parseando JSON del proyecto "${folderName}":`, parseError.message);
      console.log(`📄 Contenido del archivo (primeros 500 chars):`);
      console.log(fs.readFileSync(projectStateFile, 'utf8').substring(0, 500) + '...');
      return null;
    }
    
    // Cargar datos adicionales de cada sección completada
    // Usar 'sections' si existe, o 'completedSections' si es un array
    let sectionsToProcess = [];
    
    if (projectState.sections && Array.isArray(projectState.sections)) {
      console.log(`📚 Proyecto "${folderName}" tiene ${projectState.sections.length} secciones en formato nuevo`);
      sectionsToProcess = projectState.sections;
      // Asegurar que completedSections apunte a las secciones reales
      projectState.completedSections = projectState.sections;
    } else if (projectState.completedSections && Array.isArray(projectState.completedSections)) {
      console.log(`📚 Proyecto "${folderName}" tiene ${projectState.completedSections.length} secciones en formato legacy`);
      sectionsToProcess = projectState.completedSections;
    } else {
      console.log(`⚠️ Proyecto "${folderName}" no tiene secciones completadas o completedSections no es un array`);
      // Asegurar que completedSections sea un array vacío si no existe o no es válido
      projectState.completedSections = [];
      sectionsToProcess = [];
    }
    
    // Procesar cada sección para agregar información de archivos
    for (const section of sectionsToProcess) {
      const sectionDir = path.join('./public/outputs', folderName, `seccion_${section.section}`);
      
      // 📝 CARGAR SCRIPT DESDE ARCHIVO
      const scriptFileName = `${folderName}_seccion_${section.section}_guion.txt`;
      const scriptFilePath = path.join(sectionDir, scriptFileName);
      
      if (fs.existsSync(scriptFilePath)) {
        try {
          const scriptContent = fs.readFileSync(scriptFilePath, 'utf8');
          section.script = scriptContent.trim();
          console.log(`📝 Script cargado para sección ${section.section}: ${scriptContent.length} caracteres`);
        } catch (error) {
          console.error(`❌ Error leyendo script de sección ${section.section}:`, error);
        }
      } else {
        console.log(`📝 Archivo de script no encontrado para sección ${section.section}: ${scriptFilePath}`);
        // Verificar si el script está guardado en el project_state.json (formato legacy)
        if (section.script) {
          console.log(`📝 Script encontrado en project_state.json para sección ${section.section}`);
        }
      }
      
      // 🎨 CARGAR PROMPTS DE IMAGEN DESDE ARCHIVO
      const promptsFileName = `${folderName}_seccion_${section.section}_prompts_imagenes.txt`;
      const promptsFilePath = path.join(sectionDir, promptsFileName);
      
      if (fs.existsSync(promptsFilePath)) {
        try {
          const promptsContent = fs.readFileSync(promptsFilePath, 'utf8');
          
          // Parsear el archivo de prompts que tiene formato específico
          const lines = promptsContent.split('\n');
          const prompts = [];
          let isInPromptsSection = false;
          
          lines.forEach(line => {
            const trimmedLine = line.trim();
            
            // Comenzar a leer prompts después de "PROMPTS GENERADOS:"
            if (trimmedLine === 'PROMPTS GENERADOS:') {
              isInPromptsSection = true;
              return;
            }
            
            // Si estamos en la sección de prompts y la línea no está vacía
            if (isInPromptsSection && trimmedLine.length > 0) {
              // Filtrar líneas que no son prompts (líneas separadoras, etc.)
              if (!trimmedLine.startsWith('=') && !trimmedLine.startsWith('Prompts generados automáticamente')) {
                // Remover numeración (ej: "1. ") del inicio del prompt
                const prompt = trimmedLine.replace(/^\d+\.\s*/, '').trim();
                if (prompt.length > 0) {
                  prompts.push(prompt);
                }
              }
            }
          });
          
          if (prompts.length > 0) {
            section.imagePrompts = prompts;
            console.log(`🎨 Prompts cargados para sección ${section.section}: ${prompts.length} prompts`);
          } else {
            console.log(`⚠️ Archivo de prompts encontrado pero no se pudieron extraer prompts válidos para sección ${section.section}`);
          }
        } catch (error) {
          console.error(`❌ Error leyendo prompts de sección ${section.section}:`, error);
        }
      } else {
        console.log(`🎨 Archivo de prompts no encontrado para sección ${section.section}: ${promptsFilePath}`);
        // Verificar si los prompts están en el project_state.json (formato legacy)
        if (section.imagePrompts && section.imagePrompts.length > 0) {
          console.log(`🎨 Prompts encontrados en project_state.json para sección ${section.section}: ${section.imagePrompts.length} prompts`);
        }
      }
      
      // Verificar si existen archivos de audio
      if (fs.existsSync(sectionDir)) {
        const audioFiles = fs.readdirSync(sectionDir).filter(file => 
          file.endsWith('.wav') || file.endsWith('.mp3')
        );
        if (audioFiles.length > 0) {
          section.hasAudio = true;
          section.audioFiles = audioFiles.map(file => `outputs/${folderName}/seccion_${section.section}/${file}`);
          console.log(`🎵 Sección ${section.section}: ${audioFiles.length} archivo(s) de audio encontrado(s)`);
        }
        
        // Verificar si existen las imágenes
        const imageFiles = fs.readdirSync(sectionDir).filter(file => 
          file.endsWith('.png') || file.endsWith('.jpg') || file.endsWith('.jpeg')
        );
        if (imageFiles.length > 0) {
          section.hasImages = true;
          section.imageFiles = imageFiles.map(file => `outputs/${folderName}/seccion_${section.section}/${file}`);
          console.log(`🖼️ Sección ${section.section}: ${imageFiles.length} archivo(s) de imagen encontrado(s)`);
        }
        
        // Verificar archivos de texto (guiones y prompts)
        const textFiles = fs.readdirSync(sectionDir).filter(file => 
          file.endsWith('.txt')
        );
        if (textFiles.length > 0) {
          section.textFiles = textFiles.map(file => `outputs/${folderName}/seccion_${section.section}/${file}`);
          console.log(`📝 Sección ${section.section}: ${textFiles.length} archivo(s) de texto encontrado(s)`);
        }
      } else {
        console.log(`📁 Directorio de sección ${section.section} no encontrado: ${sectionDir}`);
      }
    }
    
    // 🎬 CARGAR METADATOS DE YOUTUBE SI EXISTEN
    // Intentar ambos formatos de nombre de archivo para compatibilidad
    const metadataFile1 = path.join('./public/outputs', folderName, `${folderName}_metadata_youtube.txt`);
    const metadataFile2 = path.join('./public/outputs', folderName, `${folderName}_youtube_metadata.txt`);
    
    let metadataFile = null;
    if (fs.existsSync(metadataFile1)) {
      metadataFile = metadataFile1;
      console.log(`📽️ Metadatos de YouTube encontrados (formato 1): ${metadataFile1}`);
    } else if (fs.existsSync(metadataFile2)) {
      metadataFile = metadataFile2;
      console.log(`📽️ Metadatos de YouTube encontrados (formato 2): ${metadataFile2}`);
    } else {
      console.log(`📽️ No se encontraron metadatos de YouTube para ${folderName}`);
    }
    
    if (metadataFile) {
      try {
        const metadataContent = fs.readFileSync(metadataFile, 'utf8');
        const metadataFileName = path.basename(metadataFile);
        console.log(`📽️ Metadatos de YouTube encontrados para ${folderName}`);
        
        // Si no hay metadatos en el estado pero sí en archivo, agregarlos
        if (!projectState.youtubeMetadata) {
          projectState.youtubeMetadata = {
            generatedAt: fs.statSync(metadataFile).mtime.toISOString(),
            content: metadataContent,
            filename: metadataFileName,
            fileExists: true
          };
          
          console.log(`✅ Metadatos cargados desde archivo para proyecto ${folderName}`);
        } else {
          // Asegurar que el flag de archivo existe esté presente
          projectState.youtubeMetadata.fileExists = true;
          projectState.youtubeMetadata.filename = metadataFileName;
        }
      } catch (error) {
        console.error(`❌ Error cargando metadatos de YouTube:`, error);
      }
    }
    
    // 📁 Agregar el nombre de la carpeta al estado del proyecto
    projectState.folderName = folderName;
    
    return projectState;
  } catch (error) {
    console.error('❌ Error cargando estado del proyecto:', error);
    return null;
  }
}

// Función para crear nombre de carpeta seguro basado en el tema
function createSafeFolderName(topic) {
  if (!topic || typeof topic !== 'string') {
    console.warn('⚠️ createSafeFolderName recibió valor inválido:', topic);
    return 'proyecto_sin_nombre';
  }
  
  const safeName = topic
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '') // Remover caracteres especiales
    .replace(/\s+/g, '_') // Reemplazar espacios con guiones bajos
    .substring(0, 50); // Limitar longitud
    
  console.log(`📁 createSafeFolderName: "${topic}" → "${safeName}"`);
  return safeName;
}

// Función para limpiar el texto del guión de contenido no deseado
function cleanScriptText(text) {
  // Validar que text sea una string
  if (!text || typeof text !== 'string') {
    console.log(`⚠️ WARNING - cleanScriptText recibió:`, typeof text, text);
    return String(text || '').trim();
  }
  
  let cleanText = text.trim();
  
  // Remover patrones comunes de texto no deseado
  const unwantedPatterns = [
    /^Sección \d+:/gi,
    /^Guión:/gi,
    /^Texto del guión:/gi,
    /^Contenido:/gi,
    /^\*\*Sección \d+\*\*/gi,
    /^\# Sección \d+/gi,
    /^---+/g,
    /^\*\*Guión para TTS:\*\*/gi,
    /^\*\*Respuesta:\*\*/gi,
    /^Aquí está el guión:/gi,
    /^El guión para la sección \d+ es:/gi,
  ];
  
  // Aplicar limpieza de patrones
  unwantedPatterns.forEach(pattern => {
    cleanText = cleanText.replace(pattern, '').trim();
  });
  
  // Remover líneas que parezcan comentarios o explicaciones
  const lines = cleanText.split('\n');
  const filteredLines = lines.filter(line => {
    const trimmedLine = line.trim();
    // Filtrar líneas que parezcan comentarios o explicaciones
    return !trimmedLine.startsWith('*') && 
           !trimmedLine.startsWith('#') && 
           !trimmedLine.startsWith('//') &&
           !trimmedLine.startsWith('Nota:') &&
           !trimmedLine.startsWith('Aclaración:') &&
           trimmedLine.length > 0;
  });
  
  return filteredLines.join('\n').trim();
}

// Función para crear estructura de carpetas
function createProjectStructure(topic, section, customFolderName = null) {
  // Si hay customFolderName, usarlo directamente (ya viene normalizado del projectKey)
  // Sino, normalizar el topic
  const folderName = customFolderName && customFolderName.trim() 
    ? customFolderName.trim()  // Ya viene normalizado, no aplicar createSafeFolderName otra vez
    : createSafeFolderName(topic);
    
  const outputsDir = path.join('./public/outputs');
  const projectDir = path.join(outputsDir, folderName);
  const sectionDir = path.join(projectDir, `seccion_${section}`);
  
  // Crear todas las carpetas necesarias
  if (!fs.existsSync(outputsDir)) {
    fs.mkdirSync(outputsDir, { recursive: true });
  }
  if (!fs.existsSync(projectDir)) {
    fs.mkdirSync(projectDir, { recursive: true });
  }
  if (!fs.existsSync(sectionDir)) {
    fs.mkdirSync(sectionDir, { recursive: true });
  }
  
  return {
    outputsDir,
    projectDir,
    sectionDir,
    safeTopicName: folderName, // Este es el nombre real de la carpeta que se está usando
    folderName: folderName     // Agregar también como folderName para consistencia
  };
}

// Función para guardar archivo de audio WAV
async function saveWaveFile(filename, pcmData, channels = 1, rate = 24000, sampleWidth = 2) {
  return new Promise((resolve, reject) => {
    const writer = new wav.FileWriter(filename, {
      channels,
      sampleRate: rate,
      bitDepth: sampleWidth * 8,
    });

    writer.on('finish', resolve);
    writer.on('error', reject);

    writer.write(pcmData);
    writer.end();
  });
}

// Función para determinar el tono de narración basado en el tema
function getNarrationTone(topic) {
  // Tono fijo: cálido y amigable para todos los temas
  return " ";
}

// Función para generar audio del guión
async function generateStoryAudio(script, voiceName = 'Orus', sectionDir, topic, section, customNarrationStyle = null) {
  try {
    console.log(`🎵 Generando narración del guión con voz: ${voiceName}...`);
    console.log(`📝 Script a narrar (primeros 100 caracteres): ${script.substring(0, 100)}...`);
    console.log(`📏 Longitud del script: ${script.length} caracteres`);
    
    // Verificar si el script es demasiado largo
    if (script.length > 5000) {
      console.log(`⚠️ Script muy largo (${script.length} caracteres), truncando a 5000...`);
      script = script.substring(0, 5000) + "...";
    }
    
    // Usar estilo de narración personalizado si se proporciona, sino usar el tono por defecto
    let narrationTone;
    if (customNarrationStyle && customNarrationStyle.trim()) {
      narrationTone = `${customNarrationStyle.trim()}: `;
      console.log(`🎭 Estilo de narración personalizado: ${narrationTone}`);
    } else {
      narrationTone = getNarrationTone(topic);
      console.log(`🎭 Tono de narración por defecto: ${narrationTone}`);
    }
    
    // Intentar con configuración más simple
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ 
        parts: [{ 
          text: `Narra el siguiente guión ${narrationTone}:

${script}`
        }] 
      }],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { 
              voiceName: voiceName 
            }
          }
        }
      }
    });

    console.log(`🔍 Respuesta recibida:`, {
      candidates: response.candidates?.length || 0,
      hasContent: !!response.candidates?.[0]?.content,
      hasParts: !!response.candidates?.[0]?.content?.parts,
      partsLength: response.candidates?.[0]?.content?.parts?.length || 0
    });

    const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    
    if (!audioData) {
      console.log(`❌ Estructura de respuesta completa:`, JSON.stringify(response, null, 2));
      throw new Error('No se generó audio - revisa los logs para más detalles');
    }

    console.log(`✅ Audio data recibido, tamaño: ${audioData.length} caracteres`);

    const audioBuffer = Buffer.from(audioData, 'base64');
    const safeTopicName = createSafeFolderName(topic);
    const fileName = `${safeTopicName}_seccion_${section}_${Date.now()}.wav`;
    const filePath = path.join(sectionDir, fileName);
    
    await saveWaveFile(filePath, audioBuffer);
    console.log(`✅ Audio generado exitosamente con voz ${voiceName} en: ${filePath}`);
    
    // Retornar la ruta relativa para acceso web
    const relativePath = path.relative('./public', filePath).replace(/\\/g, '/');
    return relativePath;
  } catch (error) {
    console.error('❌ Error generando audio:', error.message);
    console.error('❌ Error completo:', error);
    
    // Si es un error de API, intentar diagnosticar
    if (error.message && error.message.includes('API')) {
      console.error('❌ Posible problema con la API de Gemini TTS');
    }
    
    // Crear un archivo de texto como fallback
    console.log('📝 Generando archivo de texto como alternativa...');
    const safeTopicName = createSafeFolderName(topic);
    const textFileName = `${safeTopicName}_seccion_${section}_guion_audio_fallback.txt`;
    const textFilePath = path.join(sectionDir, textFileName);
    
    const textContent = `GUIÓN PARA AUDIO - SECCIÓN ${section}
===============================
Tema: ${topic}
Voz solicitada: ${voiceName}
Fecha: ${new Date().toLocaleString()}
Estado: Audio no disponible (usando texto como fallback)

CONTENIDO DEL GUIÓN:
${script}

===============================
NOTA: Este archivo se generó porque el servicio de Text-to-Speech 
no está disponible temporalmente. El contenido del guión se ha 
guardado para referencia futura.
`;
    
    try {
      fs.writeFileSync(textFilePath, textContent, 'utf8');
      const textRelativePath = path.relative('./public', textFilePath).replace(/\\/g, '/');
      console.log(`📝 Archivo de texto fallback generado: ${textRelativePath}`);
    } catch (writeError) {
      console.error('❌ Error creando archivo de texto:', writeError);
    }
    
    throw new Error(`Error al generar audio: ${error.message}. El servicio TTS puede estar temporalmente no disponible.`);
  }
}

// Función para generar imágenes con diferentes modelos
async function generateImageWithModel(ai, prompt, modelType) {
  if (modelType === 'gemini2') {
    console.log(`🤖 Usando Gemini 2.0 Flash nativo...`);
    // Usar Gemini 2.0 nativo con responseModalities
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash-preview-image-generation",
      contents: prompt,
      config: {
        responseModalities: [Modality.TEXT, Modality.IMAGE],
      },
    });

    const images = [];
    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData && part.inlineData.mimeType?.includes('image')) {
        images.push({
          image: {
            imageBytes: part.inlineData.data
          }
        });
      }
    }
    
    return {
      generatedImages: images
    };
  } else {
    console.log(`🤖 Usando Imagen 4.0 tradicional...`);
    // Usar Imagen 4.0 (método tradicional)
    return await ai.models.generateImages({
      model: 'imagen-4.0-generate-preview-06-06',
      prompt: prompt,
      config: {
        numberOfImages: 1,
        aspectRatio: "16:9",
      },
    });
  }
}

// =====================================
// FUNCIONES PARA IA LOCAL (COMFYUI + FLUX)
// =====================================

// Inicializar cliente ComfyUI
const comfyUIClient = new ComfyUIClient('http://127.0.0.1:8188');

// Función para generar imágenes usando IA Local (ComfyUI + Flux)
async function generateLocalAIImages(imagePrompts, additionalInstructions, sectionDir, sectionNumber, customSettings = null, keepAlive = false) {
  const generatedImages = [];
  
  try {
    console.log(`🤖 Iniciando generación de ${imagePrompts.length} imágenes con ComfyUI + Flux...`);
    
    // 1. Iniciar ComfyUI automáticamente
    console.log('🚀 Iniciando ComfyUI para la sección...');
    const comfyUIStarted = await startComfyUI();
    if (!comfyUIStarted) {
      throw new Error('No se pudo iniciar ComfyUI automáticamente');
    }
    
    // 2. Verificar conexión con ComfyUI (ya debería estar listo por startComfyUI)
    const connectionCheck = await comfyUIClient.checkConnection();
    if (!connectionCheck.success) {
      throw new Error(`No se puede conectar a ComfyUI: ${connectionCheck.error}`);
    }
    
    console.log('✅ ComfyUI iniciado y listo para generar imágenes');
    
    for (let index = 0; index < imagePrompts.length; index++) {
      const basePrompt = imagePrompts[index].trim();
      
      // Usar el prompt directamente ya que las instrucciones adicionales están integradas desde el LLM
      const finalPrompt = basePrompt;
      console.log(`✅ Las instrucciones adicionales ya están integradas en el prompt desde el LLM`);
      
      console.log(`🎨 Generando imagen ${index + 1}/${imagePrompts.length} con ComfyUI + Flux...`);
      console.log(`📝 Prompt final: ${finalPrompt.substring(0, 100)}...`);
      
      try {
        // Configurar opciones (usar configuración personalizada si está disponible)
        const options = customSettings ? {
          width: parseInt(customSettings.width) || 1280,
          height: parseInt(customSettings.height) || 720,
          steps: parseInt(customSettings.steps) || 25,
          cfg: 1,
          guidance: parseFloat(customSettings.guidance) || 3.5,
          sampler: customSettings.sampler || "euler",
          scheduler: customSettings.scheduler || "simple",
          model: "flux1-dev-fp8.safetensors", // Modelo Flux optimizado
          negativePrompt: customSettings.negativePrompt || "low quality, blurry, distorted",
          timeout: Math.max(180, parseInt(customSettings.steps) * 6) // Timeout dinámico basado en pasos
        } : {
          width: 1280,
          height: 720,
          steps: 25, // Valor por defecto
          cfg: 1,
          guidance: 3.5,
          sampler: "euler",
          scheduler: "simple",
          model: "flux1-dev-fp8.safetensors", // Modelo Flux optimizado
          negativePrompt: "low quality, blurry, distorted",
          timeout: 180 // 3 minutos timeout por defecto
        };
        
        console.log(`⚙️ Usando configuración ComfyUI:`, {
          resolution: `${options.width}x${options.height}`,
          steps: options.steps,
          guidance: options.guidance,
          sampler: options.sampler,
          scheduler: options.scheduler
        });
        
        // Generar imagen con ComfyUI usando reinicio automático en caso de timeout
        const result = await generateImageWithAutoRestart(finalPrompt, options);
        
        if (result.success && result.localPath) {
          // Copiar imagen a la carpeta de la sección
          const imageFileName = `comfyui_seccion_${sectionNumber}_imagen_${index + 1}_${Date.now()}.png`;
          const imageFilePath = path.join(sectionDir, imageFileName);
          
          // Copiar archivo de la ubicación temporal a la carpeta de la sección
          fs.copyFileSync(result.localPath, imageFilePath);
          console.log(`💾 Imagen ComfyUI ${index + 1} guardada en: ${imageFilePath}`);
          
          // Eliminar la copia temporal de la carpeta outputs general
          try {
            if (fs.existsSync(result.localPath)) {
              fs.unlinkSync(result.localPath);
              console.log(`🗑️ Copia temporal eliminada de: ${result.localPath}`);
            }
          } catch (error) {
            console.log(`⚠️ No se pudo eliminar copia temporal: ${error.message}`);
          }
          
          // Retornar ruta relativa para acceso web
          const relativePath = path.relative('./public', imageFilePath).replace(/\\/g, '/');
          
          generatedImages.push({
            path: relativePath,
            prompt: finalPrompt,
            filename: imageFileName,
            source: 'IA Local (ComfyUI + Flux)',
            index: index + 1,
            promptId: result.promptId
          });
          
          console.log(`✅ Imagen ${index + 1} generada exitosamente con ComfyUI + Flux`);
        } else {
          throw new Error(`Error en generación de ComfyUI: ${result.error || 'Respuesta inválida'}`);
        }
        
        // Pequeña pausa entre generaciones para no sobrecargar el servidor
        if (index < imagePrompts.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
      } catch (imageError) {
        console.error(`❌ Error generando imagen ${index + 1} con ComfyUI:`, imageError.message);
        
        // Mensaje específico para conexión rechazada
        let errorMessage = imageError.message;
        if (imageError.message.includes('ECONNREFUSED') || imageError.message.includes('connect')) {
          errorMessage = 'Servidor ComfyUI no disponible en localhost:8188. Asegúrate de que ComfyUI esté ejecutándose.';
          console.error(`🔌 CONEXIÓN: ${errorMessage}`);
        }
        
        // Continuar con la siguiente imagen en caso de error
        generatedImages.push({
          path: null,
          prompt: finalPrompt,
          filename: null,
          source: 'IA Local (ComfyUI Error)',
          index: index + 1,
          error: errorMessage
        });
      }
    }
    
    console.log(`🎨 Generación de ComfyUI completada: ${generatedImages.filter(img => img.path).length}/${imagePrompts.length} exitosas`);
    
    // 3. Cerrar ComfyUI solo si no se debe mantener vivo
    if (!keepAlive) {
      console.log('🛑 Cerrando ComfyUI para liberar GPU...');
      await stopComfyUI();
      console.log('✅ ComfyUI cerrado, GPU liberada');
    } else {
      console.log('🔄 Manteniendo ComfyUI activo para próximas secciones...');
    }
    
    return generatedImages;
    
  } catch (error) {
    console.error(`❌ Error general en generación de ComfyUI:`, error.message);
    
    // Cerrar ComfyUI solo si no se debe mantener vivo, incluso si hay errores
    if (!keepAlive) {
      console.log('🛑 Cerrando ComfyUI debido a error...');
      await stopComfyUI();
      console.log('✅ ComfyUI cerrado después del error');
    } else {
      console.log('⚠️ Error en ComfyUI pero manteniéndolo activo para próximas secciones...');
    }
    
    throw error;
  }
}

// Función para generar archivo project_state.json
function generateProjectStateFile(projectData, requestData) {
  try {
    const { sections, imagePrompts, chapterStructure } = projectData;
    const { 
      topic, folderName, voice, imageModel, scriptStyle, customStyleInstructions, 
      promptModifier, imageCount, skipImages, googleImages, applioVoice 
    } = requestData;
    
    const projectState = {
      topic: topic,
      folderName: folderName,
      originalFolderName: folderName,
      totalSections: sections.length,
      currentSection: sections.length,
      voice: voice || 'Orus',
      imageModel: imageModel || 'gemini2',
      scriptStyle: scriptStyle || 'professional',
      customStyleInstructions: customStyleInstructions || null,
      promptModifier: promptModifier || '',
      imageCount: imageCount || 5,
      skipImages: skipImages || false,
      googleImages: googleImages || false,
      applioVoice: applioVoice || null,
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      completedSections: sections.map((section, index) => ({
        section: section.section,
        script: section.script,
        imageCount: 0,
        hasImages: !skipImages,
        googleImagesMode: googleImages || false,
        imagesSkipped: skipImages || false,
        imagePrompts: imagePrompts[index]?.prompts || [],
        completedAt: new Date().toISOString(),
        scriptFile: {
          path: `outputs/${folderName}/seccion_${section.section}/${folderName}_seccion_${section.section}_guion.txt`,
          filename: `${folderName}_seccion_${section.section}_guion.txt`,
          saved: true
        },
        promptsFile: {
          path: `outputs/${folderName}/seccion_${section.section}/${folderName}_seccion_${section.section}_prompts_imagenes.txt`,
          filename: `${folderName}_seccion_${section.section}_prompts_imagenes.txt`,
          saved: true
        }
      }))
    };
    
    // Guardar el archivo en la carpeta del proyecto
    const baseTopic = topic.split(' ')[0] || 'Proyecto';
    const folderStructure = createProjectStructure(baseTopic, 1, folderName);
    const projectStateFilePath = path.join(folderStructure.projectDir, 'project_state.json');
    
    fs.writeFileSync(projectStateFilePath, JSON.stringify(projectState, null, 2), 'utf8');
    console.log(`📄 Archivo project_state.json guardado: ${projectStateFilePath}`);
    
    return projectStateFilePath;
    
  } catch (error) {
    console.error('❌ Error generando project_state.json:', error);
    return null;
  }
}

// =====================================
// FUNCIONES DE MEMORIA DE PROMPTS PARA CONSISTENCIA
// =====================================

// Función para obtener prompts anteriores de un proyecto para mantener consistencia
function getPreviousImagePrompts(projectKey, currentSection) {
  try {
    const projectStateFile = `./public/outputs/${projectKey}/project_state.json`;
    
    if (!fs.existsSync(projectStateFile)) {
      console.log(`📝 No hay estado previo del proyecto para ${projectKey}`);
      return { previousPrompts: [], contextInfo: null };
    }
    
    const projectState = JSON.parse(fs.readFileSync(projectStateFile, 'utf8'));
    const completedSections = projectState.completedSections || [];
    
    // Verificar que completedSections sea un array
    if (!Array.isArray(completedSections)) {
      console.log(`⚠️ completedSections no es un array, iniciando como array vacío`);
      return { previousPrompts: [], contextInfo: null };
    }
    
    // Obtener los últimos 2 prompts de secciones anteriores
    const previousSections = completedSections
      .filter(section => section.section < currentSection)
      .sort((a, b) => b.section - a.section) // Ordenar por sección más reciente primero
      .slice(0, 2); // Tomar las 2 más recientes
    
    const previousPrompts = [];
    let contextInfo = null;
    
    if (previousSections.length > 0) {
      // Extraer prompts de secciones anteriores
      for (const section of previousSections) {
        const sectionPrompts = section.imagePrompts || [];
        if (sectionPrompts.length > 0) {
          // Tomar los primeros 2 prompts de cada sección para mantener consistencia
          const selectedPrompts = sectionPrompts.slice(0, 2);
          previousPrompts.push(...selectedPrompts.map(prompt => ({
            sectionNumber: section.section,
            prompt: prompt
          })));
        }
      }
      
      // Crear información de contexto para consistencia
      contextInfo = {
        lastSection: previousSections[0].section,
        totalPreviousPrompts: previousPrompts.length,
        projectTopic: projectState.topic,
        projectStyle: projectState.scriptStyle || 'professional'
      };
      
      console.log(`🧠 Recuperados ${previousPrompts.length} prompts de ${previousSections.length} secciones anteriores para consistencia`);
    } else {
      console.log(`📝 No hay secciones anteriores para la sección ${currentSection}`);
    }
    
    return { previousPrompts, contextInfo };
    
  } catch (error) {
    console.error('❌ Error obteniendo prompts anteriores:', error);
    return { previousPrompts: [], contextInfo: null };
  }
}

// Función para construir contexto de consistencia para el LLM
function buildConsistencyContext(previousPrompts, contextInfo) {
  if (!previousPrompts || previousPrompts.length === 0) {
    return '';
  }
  
  let consistencyContext = `\n\nPARA MANTENER CONSISTENCIA VISUAL:
Basándote en las imágenes generadas anteriormente en este proyecto, mantén consistencia en la descripción de personajes, lugares y estilo visual.

PROMPTS DE IMÁGENES ANTERIORES (úsalos como referencia para personajes y lugares):`;
  
  previousPrompts.forEach((item, index) => {
    consistencyContext += `\n${index + 1}. [Sección ${item.sectionNumber}]: ${item.prompt}`;
  });
  
  consistencyContext += `\n\nREQUISITOS DE CONSISTENCIA:
- Si aparecen los mismos personajes, mantén sus características físicas y vestimenta
- Si aparecen los mismos lugares, mantén su arquitectura y ambiente
- Mantén el mismo estilo artístico y paleta de colores
- Si introduces nuevos elementos, que sean coherentes con lo ya establecido`;
  
  return consistencyContext;
}

// Función para integrar instrucciones adicionales en el prompt del LLM
function integrateAdditionalInstructions(basePrompt, additionalInstructions) {
  if (!additionalInstructions || !additionalInstructions.trim()) {
    return basePrompt;
  }
  
  // Encontrar donde insertar las instrucciones adicionales en el prompt del LLM
  const additionalSection = `\n\nINSTRUCCIONES ADICIONALES DEL USUARIO:
${additionalInstructions.trim()}

IMPORTANTE: Integra estas instrucciones adicionales de manera natural en todos los prompts que generes. No las agregues literalmente al final, sino incorpóralas como parte orgánica de la descripción de cada imagen.`;

  // Insertar las instrucciones antes de los requisitos obligatorios
  const insertionPoint = basePrompt.indexOf('REQUISITOS OBLIGATORIOS para cada prompt:');
  if (insertionPoint !== -1) {
    return basePrompt.substring(0, insertionPoint) + additionalSection + '\n\n' + basePrompt.substring(insertionPoint);
  } else {
    // Si no encuentra el punto de inserción, agregar antes del formato de respuesta
    const formatPoint = basePrompt.indexOf('FORMATO DE RESPUESTA OBLIGATORIO:');
    if (formatPoint !== -1) {
      return basePrompt.substring(0, formatPoint) + additionalSection + '\n\n' + basePrompt.substring(formatPoint);
    } else {
      // Como fallback, agregar al final antes del último párrafo
      return basePrompt + additionalSection;
    }
  }
}

// =====================================
// FUNCIONES DE PROGRESO Y GUARDADO AUTOMÁTICO
// =====================================

// Función para calcular y actualizar el progreso del proyecto
function updateProjectProgress(projectKey, phase, completedItems, totalItems, itemType = 'elemento', estimatedTimePerItem = null) {
  try {
    // Obtener o crear datos de progreso existentes
    if (!projectProgressTracker[projectKey]) {
      projectProgressTracker[projectKey] = {
        projectKey: projectKey,
        currentPhase: phase,
        startTime: Date.now(),
        phases: {
          script: { total: 0, completed: 0, timePerItem: 0 },
          audio: { total: 0, completed: 0, timePerItem: 0 },
          images: { total: 0, completed: 0, timePerItem: 0 }
        },
        lastUpdate: Date.now()
      };
    }
    
    const progressData = projectProgressTracker[projectKey];
    
    // Actualizar datos de la fase actual
    progressData.currentPhase = phase;
    progressData.phases[phase].total = totalItems;
    progressData.phases[phase].completed = completedItems;
    progressData.lastUpdate = Date.now();
    
    // Actualizar tiempo promedio por elemento si se proporciona
    if (estimatedTimePerItem && completedItems > 0) {
      progressData.phases[phase].timePerItem = estimatedTimePerItem / completedItems;
    }
    
    // Calcular progreso general
    const totalPhases = Object.keys(progressData.phases).length;
    let overallProgress = 0;
    
    for (const [phaseName, phaseData] of Object.entries(progressData.phases)) {
      if (phaseData.total > 0) {
        const phaseProgress = (phaseData.completed / phaseData.total) * 100;
        overallProgress += phaseProgress / totalPhases;
      }
    }
    
    progressData.percentage = Math.min(Math.round(overallProgress), 100);
    progressData.currentStep = completedItems;
    progressData.totalSteps = totalItems;
    
    // Calcular tiempo estimado restante
    const elapsed = Date.now() - progressData.startTime;
    const currentPhaseData = progressData.phases[phase];
    
    if (completedItems > 0 && currentPhaseData.timePerItem > 0) {
      const remainingItems = totalItems - completedItems;
      const estimatedRemainingMs = remainingItems * currentPhaseData.timePerItem;
      
      const minutes = Math.floor(estimatedRemainingMs / 60000);
      const seconds = Math.floor((estimatedRemainingMs % 60000) / 1000);
      progressData.estimatedTimeRemaining = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    } else {
      progressData.estimatedTimeRemaining = 'Calculando...';
    }
    
    console.log(`📊 Progreso actualizado - ${phase}: ${completedItems}/${totalItems} (${progressData.percentage}%)`);
    
    return progressData;
    
  } catch (error) {
    console.error('❌ Error actualizando progreso:', error);
    return null;
  }
}

// Función para guardar el estado progresivo del proyecto
function saveProgressiveProjectState(projectKey, projectData, completedSections = [], completedAudio = [], completedImages = []) {
  try {
    const projectStateFile = `./public/outputs/${projectKey}/project_state.json`;
    
    // Cargar estado existente si existe
    let existingState = {};
    if (fs.existsSync(projectStateFile)) {
      existingState = JSON.parse(fs.readFileSync(projectStateFile, 'utf8'));
    }
    
    // Crear estructura actualizada
    const updatedState = {
      ...existingState,
      ...projectData,
      lastModified: new Date().toISOString(),
      completedSections: completedSections,
      completedAudio: completedAudio,
      completedImages: completedImages,
      resumableState: {
        canResumeScripts: completedSections.length < (projectData.totalSections || 0),
        canResumeAudio: completedSections.length > 0 && completedAudio.length < completedSections.length,
        canResumeImages: completedSections.length > 0 && completedImages.length < completedSections.length,
        nextPhase: getNextPhase(completedSections, completedAudio, completedImages, projectData.totalSections || 0)
      }
    };
    
    // Asegurar que el directorio existe
    const stateDir = path.dirname(projectStateFile);
    if (!fs.existsSync(stateDir)) {
      fs.mkdirSync(stateDir, { recursive: true });
    }
    
    // Guardar estado
    fs.writeFileSync(projectStateFile, JSON.stringify(updatedState, null, 2), 'utf8');
    
    return updatedState;
    
  } catch (error) {
    console.error('❌ Error guardando estado progresivo:', error);
    return null;
  }
}

// Función auxiliar para determinar la siguiente fase
function getNextPhase(completedSections, completedAudio, completedImages, totalSections) {
  if (completedSections.length < totalSections) {
    return 'scripts';
  } else if (completedAudio.length < completedSections.length) {
    return 'audio';
  } else if (completedImages.length < completedSections.length) {
    return 'images';
  } else {
    return 'completed';
  }
}

// Función para obtener el progreso actual del proyecto
function getProjectProgress(projectKey) {
  try {
    const progressFile = `./public/outputs/${projectKey}/progress.json`;
    if (fs.existsSync(progressFile)) {
      return JSON.parse(fs.readFileSync(progressFile, 'utf8'));
    }
    return null;
  } catch (error) {
    console.error('❌ Error obteniendo progreso:', error);
    return null;
  }
}

// =====================================
// FUNCIONES DE BÚSQUEDA Y DESCARGA DE IMÁGENES DE BING
// =====================================

// Función para generar palabras clave específicas para cada imagen usando LLM
async function generateImageKeywords(script, topic, imageCount) {
  try {
    console.log(`🧠 Generando ${imageCount} conjuntos de palabras clave para imágenes...`);
    
    const prompt = `Analiza el siguiente guión de YouTube y genera palabras clave específicas en inglés para buscar imágenes que complementen el contenido.

TEMA: ${topic}

GUIÓN:
${script}

INSTRUCCIONES:
1. PRIMERO detecta el universo/contexto principal del contenido (ej: World of Warcraft, League of Legends, Nintendo, Historia Medieval, etc.)
2. Genera exactamente ${imageCount} conjuntos de palabras clave para búsqueda de imágenes
3. CADA conjunto DEBE incluir el contexto detectado para evitar imágenes irrelevantes
4. Cada conjunto debe tener 3-4 palabras simples en inglés
5. Usa términos CONCRETOS y VISUALES que describan objetos, personajes, escenas

REGLAS DE CONTEXTO AUTOMÁTICO:
- Si mencionas "Alianza", "Horda", "Azeroth", "Stormwind", personajes como "Arthas", "Jaina", "Thrall": USA "World of Warcraft" 
- Si mencionas "Champions", "Rift", "Summoner", personajes como "Jinx", "Yasuo", "Garen": USA "League of Legends"
- Si mencionas "Mario", "Nintendo", "Mushroom Kingdom", "Bowser": USA "Nintendo Super Mario"
- Si mencionas "Roma", "Imperio Romano", "Gladiadores", "César": USA "Ancient Rome"
- Si mencionas "Medieval", "Caballeros", "Castillos", "Rey Arturo": USA "Medieval history"
- Si mencionas "Zelda", "Hyrule", "Link", "Ganondorf": USA "Nintendo Legend of Zelda"
- Para CUALQUIER videojuego: SIEMPRE incluye el nombre del juego específico

FORMATO DE RESPUESTA (exactamente ${imageCount} líneas):
[contexto específico + descripción visual]
[contexto específico + descripción visual]
[contexto específico + descripción visual]
...

EJEMPLOS CORRECTOS para diferentes universos:

Para guión sobre "Líderes de la Alianza en World of Warcraft":
World of Warcraft Alliance leaders meeting
WoW Stormwind City throne room
World of Warcraft King Anduin Wrynn
WoW Alliance army banner blue
World of Warcraft Ironforge council

Para guión sobre "La Horda en World of Warcraft":
World of Warcraft Horde leaders
WoW Orgrimmar city red banners
World of Warcraft Thrall shaman
WoW Horde warriors battle
World of Warcraft orc chieftain

Para guión sobre "Historia de Roma":
Ancient Rome senate meeting
Roman Empire emperor statue
Ancient Roman gladiator arena
Roman legion soldiers march
Classical Rome architecture

Para guión sobre "Nintendo Mario":
Nintendo Super Mario character
Mario Bros mushroom kingdom
Nintendo platformer game screenshot
Super Mario vintage console

IMPORTANTE: 
- NUNCA generes keywords genéricas sin contexto
- SIEMPRE incluye el universo/juego/contexto en cada keyword
- USA palabras que describan cosas VISIBLES (personajes, objetos, escenas)
- EVITA conceptos abstractos como "innovation", "challenge", "concept"

Responde SOLO con las ${imageCount} líneas de palabras clave, sin explicaciones adicionales.`;

    console.log(`🤖 Enviando prompt a LLM para generar keywords...`);
    
    const response = await generateUniversalContent('gemini-2.5-flash', prompt);
    const keywordsText = response ? response.trim() : '';
    
    console.log(`📝 Respuesta del LLM:`, keywordsText);
    
    // Procesar la respuesta para extraer las palabras clave
    const lines = keywordsText.split('\n').filter(line => line.trim().length > 0);
    const keywords = [];
    
    for (let i = 0; i < imageCount; i++) {
      if (i < lines.length) {
        // Limpiar la línea de corchetes y caracteres especiales
        const cleanLine = lines[i].replace(/[\[\]]/g, '').trim();
        keywords.push(cleanLine);
      } else {
        // Fallback si no hay suficientes líneas
        keywords.push(`${topic} ${i + 1}`);
      }
    }
    
    console.log(`✅ Palabras clave generadas:`, keywords);
    return keywords;
    
  } catch (error) {
    console.error('❌ Error generando palabras clave:', error.message);
    
    // Fallback: generar palabras clave básicas
    const fallbackKeywords = [];
    for (let i = 0; i < imageCount; i++) {
      fallbackKeywords.push(`${topic} part ${i + 1}`);
    }
    
    console.log(`🔄 Usando keywords de fallback:`, fallbackKeywords);
    return fallbackKeywords;
  }
}

// Función para buscar y descargar imágenes de Bing
async function searchAndDownloadBingImages(keywords, sectionDir) {
  console.log(`🔍 Buscando imágenes en Bing con ${keywords.length} conjuntos de palabras clave`);
  
  try {
    const downloadedImages = [];
    const maxRetries = 3; // Máximo 3 intentos por imagen
    
    // Buscar y descargar una imagen para cada conjunto de palabras clave
    for (let i = 0; i < keywords.length; i++) {
      const query = keywords[i];
      console.log(`📸 Buscando imagen ${i + 1}/${keywords.length} con: "${query}"`);
      
      let imageDownloaded = false;
      let retryCount = 0;
      
      // Intentar descargar la imagen con reintentos
      while (!imageDownloaded && retryCount < maxRetries) {
        try {
          // Buscar URLs de imágenes en Bing para este query específico
          const imageUrls = await searchBingImages(query, 20); // Buscar 20 opciones para más variedad
          
          if (imageUrls.length > 0) {
            // Intentar con diferentes URLs si la primera falla - usar más opciones
            for (let urlIndex = 0; urlIndex < Math.min(imageUrls.length, 10); urlIndex++) {
              try {
                const imageUrl = imageUrls[urlIndex];
                const filename = `bing_image_${i + 1}.jpg`;
                const filepath = path.join(sectionDir, filename);
                
                console.log(`📥 Descargando imagen ${i + 1} (intento ${retryCount + 1}/${maxRetries}, URL ${urlIndex + 1}): ${imageUrl.substring(0, 80)}...`);
                
                await downloadImageFromUrl(imageUrl, filepath);
                
                downloadedImages.push({
                  filename: filename,
                  path: filepath,
                  url: imageUrl,
                  source: 'bing',
                  keywords: query,
                  caption: `Imagen ${i + 1}: ${query}`
                });
                
                console.log(`✅ Descargada imagen ${i + 1}: ${filename} (${query})`);
                imageDownloaded = true;
                break; // Salir del loop de URLs
                
              } catch (urlError) {
                console.log(`⚠️ Error con URL ${urlIndex + 1}: ${urlError.message}`);
                continue; // Intentar con la siguiente URL
              }
            }
            
            if (!imageDownloaded) {
              retryCount++;
              if (retryCount < maxRetries) {
                console.log(`🔄 Reintentando imagen ${i + 1} (intento ${retryCount + 1}/${maxRetries})...`);
                await new Promise(resolve => setTimeout(resolve, 2000)); // Pausa antes de reintentar
              }
            }
            
          } else {
            console.log(`⚠️ No se encontraron imágenes para: "${query}"`);
            retryCount++;
            if (retryCount < maxRetries) {
              console.log(`🔄 Reintentando búsqueda para "${query}" (intento ${retryCount + 1}/${maxRetries})...`);
              await new Promise(resolve => setTimeout(resolve, 2000));
            }
          }
          
        } catch (error) {
          retryCount++;
          console.error(`❌ Error en intento ${retryCount} para imagen ${i + 1} (${query}):`, error.message);
          if (retryCount < maxRetries) {
            console.log(`🔄 Reintentando imagen ${i + 1} en 3 segundos...`);
            await new Promise(resolve => setTimeout(resolve, 3000));
          }
        }
      }
      
      // Si no se pudo descargar la imagen después de todos los intentos
      if (!imageDownloaded) {
        console.log(`❌ FALLO DEFINITIVO: No se pudo descargar imagen ${i + 1} con keywords "${query}" después de ${maxRetries} intentos`);
        
        // Crear placeholder o imagen vacía para mantener la secuencia
        const filename = `bing_image_${i + 1}.jpg`;
        downloadedImages.push({
          filename: filename,
          path: null, // Sin archivo físico
          url: null,
          source: 'bing',
          keywords: query,
          caption: `Imagen ${i + 1}: ${query}`,
          failed: true // Marcar como fallida
        });
      }
      
      // Pequeña pausa entre descargas para no sobrecargar Bing
      if (i < keywords.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    const successfulDownloads = downloadedImages.filter(img => !img.failed).length;
    console.log(`🎉 Descarga completada: ${successfulDownloads}/${keywords.length} imágenes exitosas`);
    
    if (successfulDownloads < keywords.length) {
      console.log(`⚠️ ADVERTENCIA: ${keywords.length - successfulDownloads} imágenes fallaron. Los keywords seguirán alineados.`);
    }
    
    return downloadedImages;
    
  } catch (error) {
    console.error('❌ Error en búsqueda y descarga de Bing:', error.message);
    return [];
  }
}

// Función para buscar imágenes en Bing Images usando web scraping
async function searchBingImages(query, count = 5) {
  try {
    const encodedQuery = encodeURIComponent(query);
    const searchUrl = `https://www.bing.com/images/search?q=${encodedQuery}&form=HDRSC2&first=1&cw=1177&ch=778`;
    
    console.log(`🌐 Buscando en Bing Images: ${query}`);
    
    const response = await axios.get(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Cache-Control': 'max-age=0'
      },
      timeout: 15000
    });

    const $ = cheerio.load(response.data);
    const imageUrls = [];

    // Buscar imágenes en diferentes selectores de Bing
    const selectors = [
      'a.iusc',
      '.imgpt img',
      '.img_cont img',
      'img.mimg'
    ];

    for (const selector of selectors) {
      $(selector).each((i, elem) => {
        try {
          let imageUrl = null;
          
          if (selector === 'a.iusc') {
            // Para enlaces con metadatos JSON
            const metadata = $(elem).attr('m');
            if (metadata) {
              const parsed = JSON.parse(metadata);
              imageUrl = parsed.murl || parsed.turl;
            }
          } else {
            // Para elementos img directos
            imageUrl = $(elem).attr('src') || $(elem).attr('data-src') || $(elem).attr('data-img');
          }
          
          if (imageUrl && 
              imageUrl.startsWith('http') && 
              !imageUrl.includes('bing.com') &&
              !imageUrl.includes('microsoft.com') &&
              !imageUrl.includes('data:image') &&
              imageUrl.length > 50 &&
              imageUrls.length < count) {
            
            imageUrls.push(imageUrl);
          }
        } catch (parseError) {
          // Continuar con la siguiente imagen si hay error de parsing
        }
      });
      
      if (imageUrls.length >= count) break;
    }

    console.log(`📸 Bing encontró: ${imageUrls.length} URLs de imágenes`);
    return imageUrls;
    
  } catch (error) {
    console.error('❌ Error en búsqueda de Bing Images:', error.message);
    return [];
  }
}

// Función para descargar una imagen desde URL
async function downloadImageFromUrl(url, filepath) {
  try {
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream',
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Fetch-Dest': 'image',
        'Sec-Fetch-Mode': 'no-cors',
        'Sec-Fetch-Site': 'cross-site'
      },
      maxRedirects: 5
    });

    const writer = fs.createWriteStream(filepath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        // Verificar que el archivo se escribió correctamente
        if (fs.existsSync(filepath)) {
          const stats = fs.statSync(filepath);
          if (stats.size > 1000) { // Al menos 1KB
            resolve(filepath);
          } else {
            fs.unlinkSync(filepath); // Eliminar archivo corrupto
            reject(new Error('Archivo muy pequeño, posiblemente corrupto'));
          }
        } else {
          reject(new Error('El archivo no se creó correctamente'));
        }
      });
      writer.on('error', reject);
      
      // Timeout adicional
      setTimeout(() => {
        writer.destroy();
        reject(new Error('Timeout en descarga de imagen'));
      }, 20000);
    });
  } catch (error) {
    throw new Error(`Error descargando imagen: ${error.message}`);
  }
}

// Función para generar prompts según el estilo seleccionado
function generateScriptPrompt(style, topic, sections, section, customStyleInstructions = null, chapterStructure = null, previousChapterContent = null, wordsMin = 800, wordsMax = 1100) {
  if (style === 'comedy') {
    return generateComedyPrompt(topic, sections, section, chapterStructure, previousChapterContent, wordsMin, wordsMax);
  } else if (style && style.startsWith('custom_') && customStyleInstructions) {
    return generateCustomPrompt(topic, sections, section, customStyleInstructions, chapterStructure, previousChapterContent, wordsMin, wordsMax);
  } else {
    return generateProfessionalPrompt(topic, sections, section, chapterStructure, previousChapterContent, wordsMin, wordsMax);
  }
}

// Función para generar prompt con estilo personalizado
function generateCustomPrompt(topic, sections, section, customInstructions, chapterStructure = null, previousChapterContent = null, wordsMin = 800, wordsMax = 1100) {
  const currentSection = section;
  const totalSections = sections;
  
  // Generar texto de estructura de capítulos si está disponible
  let chapterContext = '';
  if (chapterStructure && chapterStructure.length > 0) {
    chapterContext = `

ESTRUCTURA COMPLETA DE CAPÍTULOS:
${chapterStructure.map((title, index) => `${index + 1}. ${title}`).join('\n')}

CAPÍTULO ACTUAL: ${chapterStructure[section - 1] || `Capítulo ${section}`}`;
  }

  // Generar contexto de capítulos anteriores si está disponible
  let previousContext = '';
  if (previousChapterContent && previousChapterContent.length > 0) {
    previousContext = `

CONTEXTO DE CAPÍTULOS ANTERIORES (para continuidad narrativa):
${previousChapterContent.map((content, index) => {
      const chapterTitle = chapterStructure && chapterStructure[index] ? chapterStructure[index] : `Capítulo ${index + 1}`;
      const preview = content.length > 200 ? content.substring(0, 200) + '...' : content;
      return `📚 ${chapterTitle}:\n${preview}`;
    }).join('\n\n')}

IMPORTANTE: TOMA EN CUENTA EL CONTEXTO ANTERIOR para mantener continuidad narrativa, referencias y coherencia en el desarrollo del tema.`;
  }
  
  if (currentSection === 1) {
    // Primera sección
    return `${customInstructions}

TEMA SOLICITADO: "${topic}"
TOTAL DE SECCIONES: ${sections}${chapterContext}

Vamos a crear un guión de YouTube dividido en ${sections} capítulos sobre el tema que el usuario ha solicitado.

POR FAVOR, DAME SOLO EL CAPÍTULO 1 DE ${sections}.

INSTRUCCIONES GENERALES:
- Crea contenido basado exactamente en lo que el usuario ha pedido en el tema
- Si es sobre ficción, enfócate en los elementos narrativos y creativos
- Si es sobre desarrollo/creación, enfócate en los aspectos reales de producción
- Si es sobre historia, enfócate en hechos históricos y datos
- Adapta tu estilo narrativo al tipo de contenido solicitado
- APLICA ESTRICTAMENTE el estilo personalizado especificado arriba
- NO REPITAS IDEAS, SI ES NECESARIO SALTE UN POCO DEL TEMA PARA EXPLORAR NUEVAS PERSPECTIVAS, PUEDES EXPLORAR CURIOSIDADES TAMBIEN, EASTER EGGS, ETC.
${chapterStructure ? `- ENFÓCATE en el contenido específico del CAPÍTULO 1: "${chapterStructure[0] || 'Sin título'}"` : ''}

ESTRUCTURA REQUERIDA PARA EL CAPÍTULO 1:
- Exactamente 3 párrafos detallados
- Entre ${wordsMin} y ${wordsMax} palabras en total para este capítulo
- Mantén el estilo personalizado establecido arriba
- Establece las bases del tema para los siguientes capítulos
${chapterStructure ? `- Desarrolla el tema específico del capítulo: "${chapterStructure[0] || 'Sin título'}"` : ''}

FORMATO DE RESPUESTA OBLIGATORIO:
- Responde ÚNICAMENTE con el texto del guión
- NO incluyas explicaciones, comentarios, ni texto adicional
- NO incluyas etiquetas como "Capítulo 1:", "Guión:", etc.
- NO incluyas notas, aclaraciones o pensamientos
- El texto debe estar listo para ser usado directamente en TTS
- Comienza directamente con el contenido del guión
- APLICA FIELMENTE el estilo personalizado: ${customInstructions}

IMPORTANTE: 
- Este es el PRIMER capítulo, establece los fundamentos del tema, da una bienvenida al canal
- NO incluyas despedida ya que habrá más capítulos
- Basa tu contenido completamente en lo que el usuario solicita en el tema
- RESPONDE SOLO CON EL TEXTO DEL GUIÓN, NADA MÁS`;
  } else {
    // Secciones posteriores
    return `Ahora dame el capítulo ${currentSection} de ${totalSections} del mismo tema.${chapterContext}${previousContext}

MANTÉN EXACTAMENTE EL MISMO ESTILO PERSONALIZADO: ${customInstructions}

INSTRUCCIONES CRÍTICAS PARA CONTINUIDAD NARRATIVA:
- Esta es la CONTINUACIÓN de un video que ya comenzó, NO hagas nueva introducción o bienvenida
- NO repitas conceptos, situaciones o anécdotas ya mencionadas en capítulos anteriores
- CONTINÚA directamente desde donde se quedó la narrativa anterior
- Usa transiciones naturales apropiadas para tu estilo personalizado
- Haz referencias sutiles al contenido previo cuando sea relevante
- EVITA reiniciar la narrativa - ya estamos dentro del video
- CONSTRUYE sobre las situaciones ya presentadas, explora nuevos aspectos

ESTRUCTURA REQUERIDA PARA EL CAPÍTULO ${currentSection}:
- Exactamente 3 párrafos detallados
- Entre ${wordsMin} y ${wordsMax} palabras en total para este capítulo
- Mantén continuidad narrativa fluida con los capítulos anteriores
- Progresa de manera lógica en el desarrollo del tema
- Sigue el mismo estilo y enfoque que estableciste en los capítulos anteriores
- APLICA ESTRICTAMENTE el estilo personalizado: ${customInstructions}
- Explora nuevos aspectos sin repetir contenido ya cubierto
${chapterStructure ? `- ENFÓCATE en el contenido específico del CAPÍTULO ${currentSection}: "${chapterStructure[currentSection - 1] || 'Sin título'}"` : ''}

FORMATO DE RESPUESTA OBLIGATORIO:
- Responde ÚNICAMENTE con el texto del guión
- NO incluyas explicaciones, comentarios, ni texto adicional
- NO incluyas etiquetas como "Capítulo ${currentSection}:", "Guión:", etc.
- NO incluyas notas, aclaraciones o pensamientos
- El texto debe estar listo para ser usado directamente en TTS
- Comienza directamente con el contenido del guión
- INICIA con una transición natural, NO con bienvenida

${currentSection === totalSections ? `IMPORTANTE: Como este es el ÚLTIMO capítulo (${currentSection}/${totalSections}), DEBES incluir una despedida profesional al final que invite a:
- Comentar sus opiniones sobre el tema presentado
- Suscribirse al canal para más contenido  
- Dar like si disfrutaron el contenido
- Sugerir futuros temas que les gustaría ver

Ejemplo de despedida: "Y así concluye este episodio sobre [tema]... Si este contenido te ha resultado interesante, déjanos un like y suscríbete al canal para más contenido. Compártenos en los comentarios qué otros temas te gustaría que cubramos..."` : 'NO incluyas despedida ya que este no es el último capítulo.'}

🎯 RECORDATORIO CRÍTICO: Debes seguir fielmente este estilo: ${customInstructions}

RECUERDA: ESTE ES UN CAPÍTULO INTERMEDIO DE UN VIDEO YA INICIADO - CONTINÚA LA NARRATIVA SIN INTRODUCCIONES.`;
  }
  
  if (currentSection === 1) {
    // Primera sección
    return `${customInstructions}

TEMA SOLICITADO: "${topic}"
TOTAL DE SECCIONES: ${sections}

Vamos a crear un guión de YouTube dividido en ${sections} secciones sobre el tema que el usuario ha solicitado.

POR FAVOR, DAME SOLO LA SECCIÓN 1 DE ${sections}.

INSTRUCCIONES GENERALES:
- Crea contenido basado exactamente en lo que el usuario ha pedido en el tema
- Si es sobre ficción, enfócate en los elementos narrativos y creativos
- Si es sobre desarrollo/creación, enfócate en los aspectos reales de producción
- Si es sobre historia, enfócate en hechos históricos y datos
- Adapta tu estilo narrativo al tipo de contenido solicitado
- APLICA ESTRICTAMENTE el estilo personalizado especificado arriba
- NO REPITAS IDEAS, SI ES NECESARIO SALTE UN POCO DEL TEMA PARA EXPLORAR NUEVAS PERSPECTIVAS, PUEDES EXPLORAR CURIOSIDADES TAMBIEN, EASTER EGGS, ETC.

ESTRUCTURA REQUERIDA PARA LA SECCIÓN 1:
- Exactamente 3 párrafos detallados
- Máximo 300 palabras en total para esta sección
- Mínimo 250 palabras por sección
- Mantén el estilo personalizado establecido arriba
- Establece las bases del tema para las siguientes secciones

FORMATO DE RESPUESTA OBLIGATORIO:
- Responde ÚNICAMENTE con el texto del guión
- NO incluyas explicaciones, comentarios, ni texto adicional
- NO incluyas etiquetas como "Sección 1:", "Guión:", etc.
- NO incluyas notas, aclaraciones o pensamientos
- El texto debe estar listo para ser usado directamente en TTS
- Comienza directamente con el contenido del guión
- APLICA FIELMENTE el estilo personalizado: ${customInstructions}

IMPORTANTE: 
- Esta es la PRIMERA sección, establece los fundamentos del tema, da una bienvenida al canal
- NO incluyas despedida ya que habrá más secciones
- Basa tu contenido completamente en lo que el usuario solicita en el tema
- RESPONDE SOLO CON EL TEXTO DEL GUIÓN, NADA MÁS`;
  } else {
    // Secciones posteriores
    return `Ahora dame la sección ${currentSection} de ${totalSections} del mismo tema.

MANTÉN EXACTAMENTE EL MISMO ESTILO PERSONALIZADO: ${customInstructions}${chapterContext}${previousContext}

ESTRUCTURA REQUERIDA PARA LA SECCIÓN ${currentSection}:
- Exactamente 3 párrafos detallados
- Máximo 300 palabras en total para esta sección
- Mínimo 250 palabras por sección
- Mantén continuidad narrativa con las secciones anteriores
- Progresa de manera lógica en el desarrollo del tema
- Sigue el mismo estilo y enfoque que estableciste en las secciones anteriores
- CONECTA directamente con el contenido de los capítulos anteriores
- Haz referencias sutiles a información ya mencionada cuando sea relevante
- APLICA ESTRICTAMENTE el estilo personalizado: ${customInstructions}

FORMATO DE RESPUESTA OBLIGATORIO:
- Responde ÚNICAMENTE con el texto del guión
- NO incluyas explicaciones, comentarios, ni texto adicional
- NO incluyas etiquetas como "Sección ${currentSection}:", "Guión:", etc.
- NO incluyas notas, aclaraciones o pensamientos
- El texto debe estar listo para ser usado directamente en TTS
- Comienza directamente con el contenido del guión

${currentSection === totalSections ? `IMPORTANTE: Como esta es la ÚLTIMA sección (${currentSection}/${totalSections}), DEBES incluir una despedida profesional al final que invite a:
- Comentar sus opiniones sobre el tema presentado
- Suscribirse al canal para más contenido  
- Dar like si disfrutaron el contenido
- Sugerir futuros temas que les gustaría ver

Ejemplo de despedida: "Y así concluye este episodio sobre [tema]... Si este contenido te ha resultado interesante, déjanos un like y suscríbete al canal para más contenido. Compártenos en los comentarios qué otros temas te gustaría que cubramos..."` : 'NO incluyas despedida ya que esta no es la última sección.'}

🎯 RECORDATORIO CRÍTICO: Debes seguir fielmente este estilo: ${customInstructions}

RECUERDA: RESPONDE SOLO CON EL TEXTO DEL GUIÓN, SIN COMENTARIOS NI EXPLICACIONES ADICIONALES.`;
  }
}

// Función para generar prompt estilo profesional (original)
function generateProfessionalPrompt(topic, sections, section, chapterStructure = null, previousChapterContent = null, wordsMin = 800, wordsMax = 1100) {
  // Generar texto de estructura de capítulos si está disponible
  let chapterContext = '';
  if (chapterStructure && chapterStructure.length > 0) {
    chapterContext = `

ESTRUCTURA COMPLETA DE CAPÍTULOS:
${chapterStructure.map((title, index) => `${index + 1}. ${title}`).join('\n')}

CAPÍTULO ACTUAL: ${chapterStructure[section - 1] || `Capítulo ${section}`}`;
  }

  // Generar contexto de capítulos anteriores si está disponible
  let previousContext = '';
  if (previousChapterContent && previousChapterContent.length > 0) {
    previousContext = `

CONTEXTO DE CAPÍTULOS ANTERIORES (para continuidad narrativa):
${previousChapterContent.map((content, index) => {
      const chapterTitle = chapterStructure && chapterStructure[index] ? chapterStructure[index] : `Capítulo ${index + 1}`;
      const preview = content.length > 200 ? content.substring(0, 200) + '...' : content;
      return `📚 ${chapterTitle}:\n${preview}`;
    }).join('\n\n')}

IMPORTANTE: TOMA EN CUENTA EL CONTEXTO ANTERIOR para mantener continuidad narrativa, referencias y coherencia en el desarrollo del tema.`;
  }
  
  if (section === 1) {
    return `Eres un escritor profesional especializado en guiones para YouTube.

TEMA SOLICITADO: "${topic}"
TOTAL DE CAPÍTULOS: ${sections}${chapterContext}

Vamos a crear un guión de YouTube dividido en ${sections} capítulos sobre el tema que el usuario ha solicitado.

POR FAVOR, DAME SOLO EL CAPÍTULO 1 DE ${sections}.
al ser este el primer capítulo, da una bienvenida al canal y presenta el tema de manera atractiva.
INSTRUCCIONES GENERALES:
- Crea contenido basado exactamente en lo que el usuario ha pedido en el tema
- Si es sobre ficción, enfócate en los elementos narrativos y creativos
- Si es sobre desarrollo/creación, enfócate en los aspectos reales de producción
- Si es sobre historia, enfócate en hechos históricos y datos
- Adapta tu estilo narrativo al tipo de contenido solicitado
${chapterStructure ? `- ENFÓCATE en el contenido específico del CAPÍTULO 1: "${chapterStructure[0] || 'Sin título'}"` : ''}

ESTRUCTURA REQUERIDA PARA EL CAPÍTULO 1:
- Exactamente 3 párrafos detallados
- Entre ${wordsMin} y ${wordsMax} palabras en total para este capítulo
- Mantén un tono profesional y enganchante
- Establece las bases del tema para los siguientes capítulos
${chapterStructure ? `- Desarrolla el tema específico del capítulo: "${chapterStructure[0] || 'Sin título'}"` : ''}

FORMATO DE RESPUESTA OBLIGATORIO:
- Responde ÚNICAMENTE con el texto del guión
- NO incluyas explicaciones, comentarios, ni texto adicional
- NO incluyas etiquetas como "Capítulo 1:", "Guión:", etc.
- NO incluyas notas, aclaraciones o pensamientos
- El texto debe estar listo para ser usado directamente en TTS
- Comienza directamente con el contenido del guión

IMPORTANTE: 
- Este es el PRIMER capítulo, establece los fundamentos del tema
- NO incluyas despedida ya que habrá más capítulos
- Basa tu contenido completamente en lo que el usuario solicita en el tema
- RESPONDE SOLO CON EL TEXTO DEL GUIÓN, NADA MÁS`;
  } else {
    return `Ahora dame el capítulo ${section} de ${sections} del mismo tema.${chapterContext}${previousContext}

INSTRUCCIONES CRÍTICAS PARA CONTINUIDAD NARRATIVA:
- Esta es la CONTINUACIÓN de un video que ya comenzó, NO hagas nueva introducción o bienvenida
- NO repitas conceptos, datos o anécdotas ya mencionados en capítulos anteriores
- CONTINÚA directamente desde donde se quedó la narrativa anterior
- Usa transiciones naturales como "Ahora bien...", "Continuando con...", "Además de esto...", "Por otro lado..."
- Haz referencias sutiles al contenido previo cuando sea relevante (ej: "Como vimos anteriormente...", "Retomando ese punto...")
- EVITA frases como "Bienvenidos", "Hola", "En este video" - ya estamos dentro del video
- CONSTRUYE sobre la información ya presentada, no la repitas

ESTRUCTURA REQUERIDA PARA EL CAPÍTULO ${section}:
- Exactamente 3 párrafos detallados
- Entre ${wordsMin} y ${wordsMax} palabras en total para este capítulo
- Mantén continuidad narrativa fluida con los capítulos anteriores
- Progresa de manera lógica en el desarrollo del tema
- CONECTA directamente con el contenido de los capítulos anteriores
- Explora nuevos aspectos del tema sin repetir información ya cubierta
- Si necesitas mencionar algo ya dicho, hazlo brevemente como referencia y expande con nueva información
${chapterStructure ? `- ENFÓCATE en el contenido específico del CAPÍTULO ${section}: "${chapterStructure[section - 1] || 'Sin título'}"` : ''}

FORMATO DE RESPUESTA OBLIGATORIO:
- Responde ÚNICAMENTE con el texto del guión
- NO incluyas explicaciones, comentarios, ni texto adicional
- NO incluyas etiquetas como "Capítulo ${section}:", "Guión:", etc.
- NO incluyas notas, aclaraciones o pensamientos
- El texto debe estar listo para ser usado directamente en TTS
- Comienza directamente con el contenido del guión
- INICIA con una transición natural, NO con bienvenida

${section === sections ? `IMPORTANTE: Como este es el ÚLTIMO capítulo (${section}/${sections}), DEBES incluir una despedida profesional al final que invite a:
- Comentar sus opiniones sobre el tema presentado
- Suscribirse al canal para más contenido  
- Dar like si disfrutaron el contenido
- Sugerir futuros temas que les gustaría ver

Ejemplo de despedida: "Y así concluye este episodio sobre [tema]... Si este contenido te ha resultado interesante, déjanos un like y suscríbete al canal para más contenido. Compártenos en los comentarios qué otros temas te gustaría que cubramos..."` : 'NO incluyas despedida ya que este no es el último capítulo.'}

RECUERDA: ESTE ES UN CAPÍTULO INTERMEDIO DE UN VIDEO YA INICIADO - NO HAGAS BIENVENIDAS NI INTRODUCCIONES GENERALES.`;
  }
}

// Función para generar prompt estilo cómico/sarcástico
function generateComedyPrompt(topic, sections, section, chapterStructure = null, previousChapterContent = null, wordsMin = 800, wordsMax = 1100) {
  // Generar texto de estructura de capítulos si está disponible
  let chapterContext = '';
  if (chapterStructure && chapterStructure.length > 0) {
    chapterContext = `

ESTRUCTURA COMPLETA DE CAPÍTULOS:
${chapterStructure.map((title, index) => `${index + 1}. ${title}`).join('\n')}

CAPÍTULO ACTUAL: ${chapterStructure[section - 1] || `Capítulo ${section}`}`;
  }

  // Generar contexto de capítulos anteriores si está disponible
  let previousContext = '';
  if (previousChapterContent && previousChapterContent.length > 0) {
    previousContext = `

CONTEXTO DE CAPÍTULOS ANTERIORES (para continuidad narrativa):
${previousChapterContent.map((content, index) => {
      const chapterTitle = chapterStructure && chapterStructure[index] ? chapterStructure[index] : `Capítulo ${index + 1}`;
      const preview = content.length > 200 ? content.substring(0, 200) + '...' : content;
      return `📚 ${chapterTitle}:\n${preview}`;
    }).join('\n\n')}

IMPORTANTE: TOMA EN CUENTA EL CONTEXTO ANTERIOR para mantener continuidad narrativa, referencias y coherencia en el desarrollo del tema.`;
  }
  
  if (section === 1) {
    return `Eres un escritor de guiones creativo para contenido de YouTube.

Tu tarea es construir guiones con un tono sarcástico, irónico, con humor negro, muchas groserías y un chingo de humor absurdo.

TEMA SOLICITADO: "${topic}"
TOTAL DE CAPÍTULOS: ${sections}${chapterContext}

Vamos a crear un guión de YouTube dividido en ${sections} capítulos sobre el tema que el usuario ha solicitado.

POR FAVOR, DAME SOLO EL CAPÍTULO 1 DE ${sections}.

🎭 FORMATO DEL GUION:

El guion debe leerse como una actuación, además de una narración cronológica.
como es el primer capitulo usa una introducción llamativa para captar la atención del espectador.
Usa múltiples voces indicadas con corchetes, por ejemplo:
[voz de narrador serio], [voz sarcástica], [grito desesperado], [voz de niña loca], [voz de viejita], etc.

Las escenas deben sentirse teatrales, exageradas, bizarras y alucinantes.
en algunas ocasiones interpreta lo que los personajes en el guion podrian decir o pensar.
${chapterStructure ? `
🎯 ENFOQUE DEL CAPÍTULO: Centra todo el contenido en desarrollar específicamente "${chapterStructure[0] || 'Sin título'}"` : ''}

ESTRUCTURA REQUERIDA PARA EL CAPÍTULO 1:
- Exactamente 3 párrafos detallados
- Entre ${wordsMin} y ${wordsMax} palabras en total para este capítulo
- Mantén un tono sarcástico, irónico y absurdo y muy ácido.
- Establece las bases del tema para los siguientes capítulos
${chapterStructure ? `- Desarrolla el tema específico del capítulo: "${chapterStructure[0] || 'Sin título'}"` : ''}

PALABRAS Y EXPRESIONES A USAR:
Usas algunas veces palabras como: pinche, wey, pendejo, cabrón, verga, chinga tu madre, me vale verga, come verga, hijo de la verga.

RESTRICCIONES:
- No se permite usar la palabra "show"
- No se permiten chistes sobre políticos ni ex parejas

FORMATO DE RESPUESTA OBLIGATORIO:
- Responde ÚNICAMENTE con el texto del guión
- NO incluyas explicaciones, comentarios, ni texto adicional
- NO incluyas etiquetas como "Capítulo 1:", "Guión:", etc.
- El texto debe estar listo para ser usado directamente en TTS
- Comienza directamente con el contenido del guión

IMPORTANTE: 
- Este es el PRIMER capítulo, establece los fundamentos del tema
- NO incluyas despedida ya que habrá más capítulos
- Basa tu contenido completamente en lo que el usuario solicita en el tema
- RESPONDE SOLO CON EL TEXTO DEL GUIÓN, NADA MÁS`;
  } else {
    return `Ahora dame el capítulo ${section} de ${sections} del mismo tema.${chapterContext}${previousContext}

Mantén el mismo estilo sarcástico, irónico, con humor negro y groserías.

INSTRUCCIONES CRÍTICAS PARA CONTINUIDAD NARRATIVA:
- Esta es la CONTINUACIÓN de un video que ya comenzó, NO hagas nueva introducción o bienvenida
- NO repitas chistes, groserías o referencias ya mencionadas en capítulos anteriores  
- CONTINÚA directamente desde donde se quedó la narrativa anterior
- Usa transiciones cómicas naturales apropiadas para el estilo sarcástico
- Haz referencias humorísticas al contenido previo cuando sea relevante
- EVITA reiniciar la narrativa - ya estamos dentro del video cómico
- CONSTRUYE sobre las situaciones ya presentadas, explora nuevos aspectos con humor ácido

ESTRUCTURA REQUERIDA PARA EL CAPÍTULO ${section}:
- Exactamente 3 párrafos detallados
- Entre ${wordsMin} y ${wordsMax} palabras en total para este capítulo
- Mantén continuidad narrativa fluida con los capítulos anteriores
- Progresa de manera lógica en el desarrollo del tema
- Sigue el mismo estilo cómico y absurdo que estableciste
- CONECTA directamente con el contenido de los capítulos anteriores
- Haz referencias sutiles a información ya mencionada cuando sea relevante
- Explora nuevos aspectos del tema sin repetir contenido ya cubierto
${chapterStructure ? `- ENFÓCATE en el contenido específico del CAPÍTULO ${section}: "${chapterStructure[section - 1] || 'Sin título'}"` : ''}

🎭 FORMATO DEL GUION:
- Usa múltiples voces indicadas con corchetes al menos 4 en cada párrafo
- Usa onomatopeyas y efectos sonoros ridículos
- Las escenas deben sentirse teatrales y exageradas
- INICIA con una transición natural, NO con bienvenida

PALABRAS Y EXPRESIONES A USAR:
Usa muchas palabras como: pinche, wey, pendejo, cabrón, verga, chinga tu madre, me vale verga, come verga.

FORMATO DE RESPUESTA OBLIGATORIO:
- Responde ÚNICAMENTE con el texto del guión
- NO incluyas explicaciones, comentarios, ni texto adicional
- NO incluyas etiquetas como "Capítulo ${section}:", "Guión:", etc.
- El texto debe estar listo para ser usado directamente en TTS
- Comienza directamente con el contenido del guión

${section === sections ? `IMPORTANTE: Como este es el ÚLTIMO capítulo (${section}/${sections}), DEBES incluir una despedida cómica al final que invite a:
- Comentar sus opiniones sobre el tema presentado
- Suscribirse al canal para más contenido  
- Dar like si disfrutaron el contenido
- Sugerir futuros temas que les gustaría ver

Ejemplo de despedida cómica: "Y así concluye este pinche episodio sobre [tema]... Si te cagaste de risa, déjanos un like y suscríbete al canal para más contenido cabrón. Compártenos en los comentarios qué otros temas te gustaría que cubramos, wey..."` : 'NO incluyas despedida ya que este no es el último capítulo.'}

RECUERDA: ESTE ES UN CAPÍTULO INTERMEDIO DE UN VIDEO YA INICIADO - CONTINÚA LA NARRATIVA SIN INTRODUCCIONES.`;
  }
}

// NUEVO ENDPOINT PARA GENERACIÓN AUTOMÁTICA POR LOTES
app.post('/generate-batch-automatic', async (req, res) => {
  try {
    const { topic, folderName, voice, totalSections, minWords, maxWords, imageCount, promptModifier, imageModel, llmModel, skipImages, googleImages, localAIImages, geminiGeneratedImages, comfyUISettings, scriptStyle, customStyleInstructions, applioVoice, applioModel, applioPitch, useApplio } = req.body;
    
    console.log('\n' + '='.repeat(80));
    console.log('🚀 INICIANDO GENERACIÓN AUTOMÁTICA POR LOTES');
    console.log('='.repeat(80));
    console.log(`🎯 Tema: "${topic}"`);
    console.log(`📊 Total de secciones: ${totalSections}`);
    console.log(`🎤 Sistema de audio: ${useApplio ? 'Applio' : 'Google TTS'}`);
    console.log(`🖼️ Sistema de imágenes: ${localAIImages ? 'IA Local (ComfyUI)' : googleImages ? 'Google Images' : geminiGeneratedImages ? 'Gemini/Imagen 4' : skipImages ? 'Sin imágenes' : 'IA en la nube'}`);
    console.log('='.repeat(80) + '\n');
    
    const selectedVoice = voice || 'Orus';
    const sections = totalSections || 3;
    const selectedStyle = scriptStyle || 'professional';
    const numImages = imageCount || 5;
    const wordsMin = minWords || 800;
    const wordsMax = maxWords || 1100;
    const additionalInstructions = promptModifier || '';
    const selectedImageModel = imageModel || 'gemini2';
    const selectedLlmModel = llmModel || 'gemini-2.5-flash';
    let shouldSkipImages = skipImages === true;
    let shouldUseGoogleImages = googleImages === true;
    let shouldUseLocalAI = localAIImages === true;
    
    if (!topic) {
      return res.status(400).json({ error: 'Tema requerido' });
    }

    const allSections = [];
    const allImagePrompts = [];
    
    // Crear clave única para la conversación primero
    // Si hay folderName personalizado, usarlo; sino usar el topic
    const baseNameForKey = folderName && folderName.trim() 
      ? folderName.trim() 
      : topic;
    const projectKey = createSafeFolderName(baseNameForKey);
    console.log(`🔑 PROJECT KEY GENERADO: "${projectKey}" (de: "${baseNameForKey}")`);

    // Crear estructura de carpetas usando el mismo projectKey
    const folderStructure = createProjectStructure(topic, 1, projectKey);
    console.log(`📁 Estructura de proyecto creada: ${folderStructure.projectDir}`);

    // =======================================================================
    // FASE 1: GENERAR TODOS LOS GUIONES + PROMPTS DE IMÁGENES
    // =======================================================================
    console.log('\n' + '📝'.repeat(20));
    console.log('📝 FASE 1: GENERANDO TODOS LOS GUIONES Y PROMPTS');
    console.log('📝'.repeat(20));
    
    const conversation = getOrCreateConversation(projectKey);
    conversation.topic = topic;
    conversation.totalSections = sections;
    conversation.history = [];
    
    // Generar estructura de capítulos primero
    console.log(`📋 Generando estructura de ${sections} capítulos...`);
    
    let chapterPrompt;
    if (selectedStyle && selectedStyle.startsWith('custom_') && customStyleInstructions) {
      chapterPrompt = `Eres un experto en crear estructuras narrativas personalizadas.

TEMA SOLICITADO: "${topic}"
TOTAL DE CAPÍTULOS: ${sections}
ESTILO PERSONALIZADO: ${customStyleInstructions}

Tu tarea es crear una ESTRUCTURA NARRATIVA que respete completamente el estilo personalizado definido.

INSTRUCCIONES ESPECÍFICAS PARA ESTE ESTILO:
- Analiza cuidadosamente las instrucciones del estilo personalizado
- Crea títulos que reflejen EXACTAMENTE lo que pide el estilo
- Si el estilo menciona "situaciones cotidianas", crea capítulos sobre actividades diarias del personaje
- Si el estilo habla de "progresión del día", organiza los capítulos cronológicamente  
- Si pide "técnicas de hipnotización", enfócate en momentos relajantes del personaje
- IGNORA formatos educativos genéricos, sigue SOLO el estilo personalizado

PARA "${topic}" CON ESTE ESTILO ESPECÍFICO:
Genera títulos que narren momentos, actividades y situaciones del personaje, no información educativa sobre la serie.

FORMATO DE RESPUESTA OBLIGATORIO:
Debes responder ÚNICAMENTE con los títulos separados por "||CAPITULO||"

VERIFICACIÓN: Tu respuesta debe tener exactamente ${sections - 1} delimitadores "||CAPITULO||" para generar ${sections} títulos.

RESPONDE SOLO CON LOS TÍTULOS SEPARADOS POR "||CAPITULO||", NADA MÁS.`;
    } else {
      chapterPrompt = `Eres un experto en narrativa para YouTube especializado en contenido educativo y entretenimiento.

TEMA SOLICITADO: "${topic}"
TOTAL DE CAPÍTULOS: ${sections}

Tu tarea es crear una ESTRUCTURA NARRATIVA completa dividiendo el tema en ${sections} capítulos/secciones coherentes y bien organizadas.

INSTRUCCIONES:
- Crea EXACTAMENTE ${sections} títulos de capítulos
- Cada capítulo debe tener un título descriptivo y atractivo
- Los capítulos deben seguir un hilo narrativo lógico
- Progresión natural del tema de inicio a conclusión
- Títulos que generen curiosidad y mantengan el interés

FORMATO DE RESPUESTA OBLIGATORIO:
Debes responder ÚNICAMENTE con los títulos separados por "||CAPITULO||"

EJEMPLO PARA 3 CAPÍTULOS:
Capítulo 1: El Origen de la Leyenda||CAPITULO||Capítulo 2: Los Secretos Revelados||CAPITULO||Capítulo 3: El Legado Eterno

VERIFICACIÓN: Tu respuesta debe tener exactamente ${sections - 1} delimitadores "||CAPITULO||" para generar ${sections} títulos.

RESPONDE SOLO CON LOS TÍTULOS SEPARADOS POR "||CAPITULO||", NADA MÁS.`;
    }
    
    let chapterStructure = [];
    try {
      const chapterResponse = await generateUniversalContent(
        selectedLlmModel,
        chapterPrompt,
        "Eres un experto en estructura narrativa. Tu ÚNICA tarea es crear títulos de capítulos separados por '||CAPITULO||'. NUNCA generes texto adicional fuera de los títulos."
      );

      const chaptersText = chapterResponse || '';
      chapterStructure = chaptersText.split('||CAPITULO||').filter(title => title.trim()).slice(0, sections);
      
      console.log('📖 ESTRUCTURA DE CAPÍTULOS GENERADA:');
      chapterStructure.forEach((title, index) => {
        console.log(`📚 Capítulo ${index + 1}: ${title.trim()}`);
      });
      
      conversation.chapterStructure = chapterStructure;
    } catch (error) {
      console.error('❌ Error generando estructura de capítulos:', error);
      chapterStructure = [];
    }
    
    // Generar todos los guiones
    console.log(`\n📝 Generando guiones para ${sections} secciones...`);
    
    for (let section = 1; section <= sections; section++) {
      console.log(`📝 Generando guión de la sección ${section}/${sections}...`);
      
      try {
        const promptContent = generateScriptPrompt(selectedStyle, topic, sections, section, customStyleInstructions, chapterStructure, section === 1 ? null : allSections, wordsMin, wordsMax);
        
        if (section === 1) {
          conversation.history = [{ role: 'user', parts: [{ text: promptContent }] }];
        } else {
          conversation.history.push({ role: 'user', parts: [{ text: promptContent }] });
        }
        
        const scriptResponse = await generateUniversalContent(
          selectedLlmModel,
          conversation.history,  // Pasar el historial completo como segundo parámetro
          null  // No system instruction adicional
        );
        
        console.log(`🔍 DEBUG: scriptResponse tipo:`, typeof scriptResponse);
        console.log(`🔍 DEBUG: scriptResponse contenido:`, scriptResponse);
        console.log(`🔍 DEBUG: scriptResponse longitud:`, scriptResponse ? scriptResponse.length : 'NULL');
        
        const scriptText = scriptResponse || '';
        conversation.history.push({ role: 'model', parts: [{ text: scriptText }] });
        
        allSections.push({
          section: section,
          title: chapterStructure[section - 1] || `Sección ${section}`,
          script: scriptText,
          cleanScript: scriptText.replace(/[*_#]/g, '').trim()
        });
        
        console.log(`✅ Guión ${section} generado (${scriptText.length} caracteres)`);
        
        // Guardar el guión en archivo TXT
        try {
          const sectionFolderStructure = createProjectStructure(topic, section, projectKey);
          const scriptFileName = `${projectKey}_seccion_${section}_guion.txt`;
          const scriptFilePath = path.join(sectionFolderStructure.sectionDir, scriptFileName);
          
          const scriptContent = `GUIÓN DE SECCIÓN ${section}
===============================
Tema: ${topic}
Sección: ${section} de ${sections}
Capítulo: ${chapterStructure[section - 1] || `Sección ${section}`}
Longitud: ${scriptText.length} caracteres
Fecha de generación: ${new Date().toLocaleString()}
${folderName ? `Nombre del proyecto: ${folderName}` : ''}

CONTENIDO DEL GUIÓN:
${scriptText}

===============================
Guión generado automáticamente por IA
`;
          
          fs.writeFileSync(scriptFilePath, scriptContent, 'utf8');
          console.log(`💾 Guión guardado: ${scriptFilePath}`);
          
        } catch (saveError) {
          console.error(`❌ Error guardando guión de sección ${section}:`, saveError);
        }
        
        // Generar prompts de imágenes para esta sección
        if (!shouldSkipImages) {
          console.log(`🎨 Generando prompts de imágenes para sección ${section}...`);
          
          if (shouldUseGoogleImages) {
            // Para Google Images (Bing): generar keywords de búsqueda simples
            console.log(`🔍 Generando keywords de búsqueda para Google Images/Bing...`);
            
            const keywordsPrompt = `Basándote en este guión de la sección ${section} sobre "${topic}": "${scriptText}", 
            
extrae EXACTAMENTE ${numImages} keywords o frases cortas de búsqueda para encontrar imágenes relacionadas con esta sección.

IMPORTANTE:
- Cada keyword debe ser de 1-4 palabras máximo
- Deben ser términos que se puedan buscar en Google Images
- Enfócate en elementos visuales específicos mencionados en esta sección
- DEBES separar cada keyword con "||PROMPT||" (sin espacios adicionales)
- NO incluyas descripciones largas, solo keywords de búsqueda

EJEMPLO de respuesta:
castillo medieval||PROMPT||espada dorada||PROMPT||batalla épica||PROMPT||dragón volando||PROMPT||héroe guerrero

FORMATO DE RESPUESTA OBLIGATORIO:
keyword1||PROMPT||keyword2||PROMPT||keyword3||PROMPT||... hasta keyword${numImages}`;

            const keywordsResponse = await generateUniversalContent(
              selectedLlmModel,
              keywordsPrompt,
              `Eres un experto en SEO y búsqueda de imágenes. Tu ÚNICA tarea es extraer keywords simples separados por "||PROMPT||". NO generes descripciones largas.`
            );
            
            const keywordsText = keywordsResponse || '';
            const sectionImagePrompts = keywordsText.split('||PROMPT||').filter(p => p.trim()).slice(0, numImages);
            
            allImagePrompts.push({
              section: section,
              prompts: sectionImagePrompts
            });
            
            console.log(`✅ ${sectionImagePrompts.length} keywords de búsqueda generados para sección ${section}`);
            
          } else {
            // Para IA generativa: generar prompts descriptivos detallados
            console.log(`🎨 Generando prompts descriptivos para IA generativa...`);
            
            // Obtener prompts anteriores para mantener consistencia
            console.log(`🧠 Recuperando contexto de prompts anteriores...`);
            const { previousPrompts, contextInfo } = getPreviousImagePrompts(projectKey, section);
            
            // Construir contexto de consistencia
            const consistencyContext = buildConsistencyContext(previousPrompts, contextInfo);
          
          // Construir prompt base para el LLM
          let basePrompt = `Basándote en este guión de la sección ${section} sobre "${topic}": "${scriptText}", crea EXACTAMENTE ${numImages} prompts detallados para generar ${numImages} imágenes que ilustren visualmente el contenido ESPECÍFICO de esta sección.

IMPORTANTE: Debes crear EXACTAMENTE ${numImages} prompts, ni más ni menos.

ENFOQUE ESPECÍFICO PARA ESTA SECCIÓN:
- Estas imágenes deben representar SOLO el contenido de la sección ${section}, no de todo el proyecto
- Cada imagen debe mostrar diferentes aspectos, momentos o elementos clave mencionados en esta sección específica
- NO dividas la sección en partes cronológicas - en su lugar, crea ${numImages} perspectivas diferentes del mismo contenido de la sección
- Enfócate en elementos específicos, personajes, lugares, objetos, emociones o conceptos mencionados en esta sección
- Mantén consistencia visual con las secciones anteriores${consistencyContext}

TIPOS DE PROMPTS PARA ESTA SECCIÓN:
- Imagen principal: La escena o momento central de la sección
- Detalles importantes: Objetos, elementos o características específicas mencionadas
- Perspectivas diferentes: Diferentes ángulos o enfoques del mismo contenido
- Atmósfera: Imágenes que capturen el mood o ambiente de la sección
- Elementos secundarios: Aspectos adicionales que complementen la narrativa de esta sección

INSTRUCCIONES CRÍTICAS PARA EL FORMATO:
- DEBES crear ${numImages} prompts independientes que representen la MISMA sección desde diferentes perspectivas
- NO dividas el contenido en secuencia cronológica - todas las imágenes son de la MISMA sección
- DEBES separar cada prompt con "||PROMPT||" (sin espacios adicionales)
- DEBES asegurarte de que haya exactamente ${numImages} prompts en tu respuesta
- Todas las imágenes deben estar relacionadas con el contenido específico de la sección ${section}
- Incluye detalles específicos mencionados en el texto del guión de esta sección

REQUISITOS OBLIGATORIOS para cada prompt:
- Formato: Aspecto 16:9 (widescreen)
- Estilo: Realista, alta calidad, 4K

FORMATO DE RESPUESTA OBLIGATORIO:
DEBES presentar EXACTAMENTE ${numImages} prompts separados por "||PROMPT||" (sin espacios antes o después del delimitador).

ESTRUCTURA REQUERIDA:
Prompt 1 aquí||PROMPT||Prompt 2 aquí||PROMPT||Prompt 3 aquí||PROMPT||... hasta el Prompt ${numImages}

VERIFICACIÓN FINAL: Tu respuesta debe contener exactamente ${numImages - 1} ocurrencias del delimitador "||PROMPT||" para generar ${numImages} prompts.`;
            
            // Integrar instrucciones adicionales en el prompt del LLM
            const finalPromptForLLM = integrateAdditionalInstructions(basePrompt, additionalInstructions);
            
            console.log(`🧠 Creando prompts para secuencia de ${numImages} imágenes con contexto de consistencia...`);
            if (previousPrompts.length > 0) {
              console.log(`🔗 Usando ${previousPrompts.length} prompts anteriores para mantener consistencia`);
            }
            if (additionalInstructions && additionalInstructions.trim()) {
              console.log(`📝 Integrando instrucciones adicionales en el LLM: "${additionalInstructions.trim()}"`);
            }
            
            const imagePromptsResponse = await generateUniversalContent(
              selectedLlmModel,
              finalPromptForLLM,
              `Eres un experto en arte conceptual y narrativa visual. Tu ÚNICA tarea es crear prompts separados por "||PROMPT||".`
            );
            
            const promptsText = imagePromptsResponse || '';
            const sectionImagePrompts = promptsText.split('||PROMPT||').filter(p => p.trim()).slice(0, numImages);
            
            allImagePrompts.push({
              section: section,
              prompts: sectionImagePrompts
            });
            
            console.log(`✅ ${sectionImagePrompts.length} keywords de búsqueda generados para sección ${section}`);
          }
        }
        
        // ===============================================================
        // GUARDADO PROGRESIVO Y ACTUALIZACIÓN DE PROGRESO
        // ===============================================================
        
        console.log(`📊 ACTUALIZANDO PROGRESO: Sección ${section}/${sections} completada`);
        
        // Calcular tiempo de generación de esta sección
        const sectionStartTime = Date.now() - 30000; // Estimación aproximada
        const sectionEndTime = Date.now();
        const sectionDuration = sectionEndTime - sectionStartTime;
        
        // Actualizar progreso de la Fase 1 (Scripts)
        const progressData = updateProjectProgress(
          projectKey, 
          'script', 
          section,      // completedItems (actual)
          sections,     // totalItems 
          'sección', 
          sectionDuration
        );
        
        // Preparar datos del proyecto para guardado progresivo
        const projectDataForSave = {
          topic: topic,
          folderName: folderName,
          totalSections: sections,
          voice: selectedVoice,
          imageModel: selectedImageModel,
          llmModel: selectedLlmModel,
          scriptStyle: selectedStyle,
          customStyleInstructions: customStyleInstructions,
          promptModifier: additionalInstructions,
          imageCount: numImages,
          skipImages: shouldSkipImages,
          googleImages: shouldUseGoogleImages,
          localAIImages: shouldUseLocalAI,
          useApplio: useApplio || false,
          applioVoice: applioVoice,
          applioModel: applioModel,
          applioPitch: applioPitch,
          chapterStructure: chapterStructure,
          createdAt: new Date().toISOString()
        };
        
        // Crear información de la sección completada
        const completedSectionData = {
          section: section,
          title: chapterStructure[section - 1] || `Sección ${section}`,
          script: allSections[section - 1].script,
          imagePrompts: allImagePrompts.find(ip => ip.section === section)?.prompts || [],
          completedAt: new Date().toISOString(),
          scriptFile: {
            path: `outputs/${projectKey}/seccion_${section}/${projectKey}_seccion_${section}_guion.txt`,
            filename: `${projectKey}_seccion_${section}_guion.txt`,
            saved: true
          },
          promptsFile: shouldSkipImages ? null : {
            path: `outputs/${projectKey}/seccion_${section}/${projectKey}_seccion_${section}_prompts_imagenes.txt`,
            filename: `${projectKey}_seccion_${section}_prompts_imagenes.txt`,
            saved: true
          }
        };
        
        // Guardar estado progresivo
        const currentCompletedSections = allSections.map((sec, index) => {
          const sectionData = {
            section: sec.section,
            title: sec.title,
            script: sec.script,
            imagePrompts: allImagePrompts.find(ip => ip.section === sec.section)?.prompts || [],
            completedAt: new Date().toISOString(),
            scriptFile: {
              path: `outputs/${projectKey}/seccion_${sec.section}/${projectKey}_seccion_${sec.section}_guion.txt`,
              filename: `${projectKey}_seccion_${sec.section}_guion.txt`,
              saved: true
            },
            promptsFile: shouldSkipImages ? null : {
              path: `outputs/${projectKey}/seccion_${sec.section}/${projectKey}_seccion_${sec.section}_prompts_imagenes.txt`,
              filename: `${projectKey}_seccion_${sec.section}_prompts_imagenes.txt`,
              saved: true
            }
          };
          return sectionData;
        });
        
        saveProgressiveProjectState(projectKey, projectDataForSave, currentCompletedSections, [], []);
        
      } catch (error) {
        console.error(`❌ Error generando sección ${section}:`, error);
        allSections.push({
          section: section,
          title: `Sección ${section}`,
          script: `Error generando contenido: ${error.message}`,
          cleanScript: `Error generando contenido: ${error.message}`
        });
      }
    }
    
    console.log(`\n✅ FASE 1 COMPLETADA:`);
    console.log(`📝 ${allSections.length} guiones generados`);
    console.log(`🎨 ${allImagePrompts.length} sets de prompts de imágenes generados`);
    
    res.json({
      success: true,
      phase: 'scripts_completed',
      message: `Fase 1 completada: ${allSections.length} guiones y prompts generados`,
      data: {
        sections: allSections,
        imagePrompts: allImagePrompts,
        chapterStructure: chapterStructure,
        projectKey: projectKey,
        additionalInstructions: additionalInstructions, // Pasar las instrucciones adicionales
        topic: topic,
        folderName: folderName
      }
    });
    
  } catch (error) {
    console.error('❌ Error en generación automática por lotes:', error);
    res.status(500).json({ error: 'Error en generación automática: ' + error.message });
  }
});

// ENDPOINT PARA CONTINUAR CON FASE 2: GENERACIÓN DE AUDIO POR LOTES
app.post('/generate-batch-audio', async (req, res) => {
  try {
    const { projectData, useApplio, voice, applioVoice, applioModel, applioPitch, folderName } = req.body;
    
    console.log('\n' + '🎵'.repeat(20));
    console.log('🎵 FASE 2: GENERANDO TODOS LOS ARCHIVOS DE AUDIO');
    console.log('🎵'.repeat(20));
    
    const { sections, projectKey } = projectData;
    const audioMethod = useApplio ? 'Applio' : 'Google TTS';
    
    // Obtener el tema base del proyecto
    const baseTopic = projectData.sections[0].title.split(':')[0] || 'Proyecto';
    
    console.log(`🎤 Generando audio para ${sections.length} secciones con ${audioMethod}...`);
    
    // Si usamos Applio, inicializarlo una vez
    if (useApplio) {
      console.log('🔄 Iniciando Applio para generación de audio...');
      const applioStarted = await startApplio();
      if (!applioStarted) {
        throw new Error('No se pudo iniciar Applio');
      }
    }
    
    const audioResults = [];
    
    // Generar audio para todas las secciones
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      console.log(`🎵 Generando audio ${i + 1}/${sections.length}: ${section.title}`);
      
      // Crear estructura de carpetas individual para esta sección
      const sectionFolderStructure = createProjectStructure(baseTopic, section.section, folderName);
      
      try {
        let audioPath;
        
        if (useApplio) {
          // Generar con Applio
          const selectedApplioVoice = applioVoice || 'es-ES-ElviraNeural.pth';
          const selectedApplioModel = applioModel || 'rmvpe';
          const selectedPitch = applioPitch || 0;
          
          const fileName = `${createSafeFolderName(section.title)}_seccion_${section.section}_${Date.now()}.wav`;
          const filePath = path.join(sectionFolderStructure.sectionDir, fileName);
          
          console.log(`📁 Guardando audio en: ${filePath}`);
          
          // Generar audio con Applio
          const result = await applioClient.textToSpeech(section.cleanScript, filePath, {
            model: selectedApplioModel,
            speed: 0,
            pitch: selectedPitch,
            voicePath: selectedApplioVoice
          });
          
          if (!result.success) {
            throw new Error('Applio no generó el audio correctamente');
          }
          
          // Retornar ruta relativa para acceso web
          audioPath = path.relative('./public', filePath).replace(/\\/g, '/');
          
          console.log(`✅ Audio Applio generado: ${audioPath}`);
          
        } else {
          // Generar con Google TTS
          audioPath = await generateStoryAudio(
            section.cleanScript, 
            voice || 'Orus', 
            sectionFolderStructure.sectionDir, 
            section.title, 
            section.section
          );
          
          console.log(`✅ Audio Google TTS generado: ${audioPath}`);
        }
        
        audioResults.push({
          section: section.section,
          title: section.title,
          audioPath: audioPath,
          success: true
        });

        // 📊 GUARDADO PROGRESIVO: Actualizar progreso después de cada audio
        try {
          const progressData = updateProjectProgress(projectKey, 'audio', i + 1, sections.length);
          
          // Guardar estado del proyecto con audios completados hasta ahora
          const updatedProjectData = {
            ...projectData,
            audioResults: audioResults,
            audioMethod: audioMethod,
            audioConfig: useApplio ? { 
              voice: applioVoice, 
              model: applioModel, 
              pitch: applioPitch 
            } : { voice: voice },
            phase: 'audio',
            lastUpdate: new Date().toISOString()
          };
          
          await saveProgressiveProjectState(projectKey, updatedProjectData, progressData);
          
          console.log(`📊 Progreso guardado: Audio ${i + 1}/${sections.length} (${progressData.percentage}%) - Tiempo estimado restante: ${progressData.estimatedTimeRemaining}`);
          
        } catch (progressError) {
          console.error('⚠️ Error guardando progreso de audio:', progressError.message);
          // No interrumpir la generación por errores de guardado
        }
        
      } catch (error) {
        console.error(`❌ Error generando audio para sección ${section.section}:`, error);
        audioResults.push({
          section: section.section,
          title: section.title,
          audioPath: null,
          success: false,
          error: error.message
        });

        // 📊 GUARDADO PROGRESIVO: Actualizar progreso incluso en caso de error
        try {
          const progressData = updateProjectProgress(projectKey, 'audio', i + 1, sections.length);
          
          const updatedProjectData = {
            ...projectData,
            audioResults: audioResults,
            audioMethod: audioMethod,
            audioConfig: useApplio ? { 
              voice: applioVoice, 
              model: applioModel, 
              pitch: applioPitch 
            } : { voice: voice },
            phase: 'audio',
            lastUpdate: new Date().toISOString()
          };
          
          await saveProgressiveProjectState(projectKey, updatedProjectData, progressData);
          
          console.log(`📊 Progreso guardado (con error): Audio ${i + 1}/${sections.length} (${progressData.percentage}%)`);
          
        } catch (progressError) {
          console.error('⚠️ Error guardando progreso de audio:', progressError.message);
        }
      }
    }
    
    const successfulAudio = audioResults.filter(r => r.success).length;
    
    console.log(`\n✅ FASE 2 COMPLETADA:`);
    console.log(`🎵 ${successfulAudio}/${sections.length} archivos de audio generados con ${audioMethod}`);
    
    res.json({
      success: true,
      phase: 'audio_completed',
      message: `Fase 2 completada: ${successfulAudio}/${sections.length} audios generados con ${audioMethod}`,
      data: {
        audioResults: audioResults,
        projectKey: projectKey,
        audioMethod: audioMethod
      }
    });
    
  } catch (error) {
    console.error('❌ Error en generación de audio por lotes:', error);
    res.status(500).json({ error: 'Error en generación de audio: ' + error.message });
  }
});

// ENDPOINT PARA GENERAR SOLO AUDIOS FALTANTES CON APPLIO
app.post('/generate-missing-applio-audios', async (req, res) => {
  try {
    const { folderName, applioVoice, applioModel, applioPitch, totalSections, scriptStyle = 'professional', customStyleInstructions = '', wordsMin = 800, wordsMax = 1100 } = req.body;
    
    console.log('\n' + '🔍'.repeat(20));
    console.log('🔍 VERIFICANDO Y GENERANDO AUDIOS FALTANTES CON APPLIO');
    console.log('🔍'.repeat(20));
    
    console.log('🎤 Configuración de generación:', {
      proyecto: folderName,
      voz: applioVoice,
      modelo: applioModel,
      pitch: applioPitch,
      secciones: totalSections
    });
    
    // Verificar que el proyecto existe
    const projectState = loadProjectState(folderName);
    if (!projectState) {
      return res.status(404).json({ error: 'Proyecto no encontrado' });
    }
    
    // Verificar qué audios faltan
    const missingAudioSections = [];
    const projectDir = path.join('./public/outputs', folderName);
    
    for (let i = 0; i < projectState.completedSections.length; i++) {
      const section = projectState.completedSections[i];
      const sectionDir = path.join(projectDir, `seccion_${section.section}`);
      
      // Verificar si la carpeta de la sección existe
      if (!fs.existsSync(sectionDir)) {
        console.log(`📁 Creando carpeta faltante para sección ${section.section}: ${sectionDir}`);
        fs.mkdirSync(sectionDir, { recursive: true });
      }
      
      // Buscar archivos de audio en la carpeta de la sección
      let hasAudioFile = false;
      
      if (fs.existsSync(sectionDir)) {
        const files = fs.readdirSync(sectionDir);
        hasAudioFile = files.some(file => 
          file.endsWith('.wav') || 
          file.endsWith('.mp3') || 
          file.endsWith('.m4a') ||
          file.endsWith('.ogg')
        );
        
        if (hasAudioFile) {
          const audioFiles = files.filter(file => 
            file.endsWith('.wav') || file.endsWith('.mp3') || 
            file.endsWith('.m4a') || file.endsWith('.ogg')
          );
          console.log(`✅ Sección ${section.section} ya tiene audio: ${audioFiles.join(', ')}`);
        }
      }
      
      if (!hasAudioFile) {
        console.log(`🎵 Sección ${section.section} necesita audio`);
        missingAudioSections.push(section);
      }
    }
    
    console.log(`📊 Análisis completo: ${missingAudioSections.length}/${projectState.completedSections.length} secciones necesitan audio`);
    
    if (missingAudioSections.length === 0) {
      return res.json({
        success: true,
        message: 'Todos los audios ya existen, no se generó ninguno nuevo',
        data: {
          generatedCount: 0,
          totalSections: projectState.completedSections.length,
          skippedSections: projectState.completedSections.length,
          missingAudioSections: []
        }
      });
    }
    
    // Inicializar Applio solo si hay audios que generar
    console.log('🔄 Iniciando Applio para generación de audios faltantes...');
    const applioStarted = await startApplio();
    if (!applioStarted) {
      throw new Error('No se pudo iniciar Applio');
    }
    
    const generationResults = [];
    
    // Generar audio solo para las secciones que lo necesitan
    for (let i = 0; i < missingAudioSections.length; i++) {
      const section = missingAudioSections[i];
      console.log(`🎵 Generando audio faltante ${i + 1}/${missingAudioSections.length}: Sección ${section.section}`);
      
      try {
        // Obtener el directorio de la sección
        const sectionDir = path.join(projectDir, `seccion_${section.section}`);
        
        // Crear nombre de archivo único
        const fileName = `${folderName}_seccion_${section.section}_applio_${Date.now()}.wav`;
        const filePath = path.join(sectionDir, fileName);
        
        console.log(`📁 Generando audio en: ${filePath}`);
        console.log(`📝 Script completo: ${section.script.substring(0, 100)}...`);
        
        // Extraer solo el contenido del guión sin metadatos
        const scriptResult = extractScriptContent(section.script);
        let cleanScript = scriptResult.content;
        
        // Si el script está vacío, generar el contenido faltante
        if (scriptResult.isEmpty && scriptResult.hasStructure) {
          console.log(`🔧 Generando guión faltante para sección ${section.section}...`);
          
          // Obtener información adicional del proyecto para la generación
          const chapterTitle = section.title && section.title !== `Sección ${section.section}` 
            ? section.title 
            : null;
          
          // Obtener secciones anteriores para contexto
          const previousSections = projectState.completedSections
            .filter(s => s.section < section.section)
            .sort((a, b) => a.section - b.section);
          
          const generationResult = await generateMissingScript(
            projectState.topic || 'Proyecto de gaming',
            section.section,
            projectState.totalSections,
            chapterTitle,
            previousSections,
            scriptStyle,
            customStyleInstructions,
            wordsMin,
            wordsMax
          );
          
          if (generationResult.success) {
            cleanScript = generationResult.script;
            console.log(`✅ Guión generado: ${cleanScript.length} caracteres`);
            
            // Actualizar el archivo TXT con el nuevo contenido
            try {
              const sectionDir = path.join(projectDir, `seccion_${section.section}`);
              const scriptFiles = fs.readdirSync(sectionDir).filter(file => 
                file.endsWith('.txt') && !file.includes('metadata') && !file.includes('keywords')
              );
              
              if (scriptFiles.length > 0) {
                const scriptFilePath = path.join(sectionDir, scriptFiles[0]);
                const originalContent = fs.readFileSync(scriptFilePath, 'utf8');
                
                // Reconstruir el archivo con el nuevo contenido
                const updatedContent = originalContent.replace(
                  /(CONTENIDO DEL GUIÓN:\s*\n)(.*?)(===============================)/s,
                  `$1${cleanScript}\n\n$3`
                );
                
                fs.writeFileSync(scriptFilePath, updatedContent, 'utf8');
                console.log(`📝 Archivo TXT actualizado con el nuevo guión`);
              }
            } catch (updateError) {
              console.warn(`⚠️ No se pudo actualizar el archivo TXT:`, updateError.message);
            }
            
          } else {
            console.error(`❌ No se pudo generar el guión: ${generationResult.error}`);
            throw new Error(`No se pudo generar el guión faltante: ${generationResult.error}`);
          }
        } else if (scriptResult.isEmpty) {
          throw new Error('El script está vacío y no se puede generar audio');
        }
        
        console.log(`🧹 Script limpio: ${cleanScript.substring(0, 100)}...`);
        
        // Generar audio con Applio usando solo el contenido del guión
        const result = await applioClient.textToSpeech(cleanScript, filePath, {
          model: applioModel || 'rmvpe',
          speed: 0,
          pitch: applioPitch || 0,
          voicePath: applioVoice || 'es-ES-ElviraNeural.pth'
        });
        
        if (!result.success) {
          throw new Error('Applio no generó el audio correctamente');
        }
        
        // Retornar ruta relativa para acceso web
        const audioPath = path.relative('./public', filePath).replace(/\\/g, '/');
        
        generationResults.push({
          section: section.section,
          audioPath: audioPath,
          success: true,
          message: `Audio generado exitosamente`
        });
        
        console.log(`✅ Audio generado: ${audioPath}`);
        
      } catch (error) {
        console.error(`❌ Error generando audio para sección ${section.section}:`, error);
        generationResults.push({
          section: section.section,
          audioPath: null,
          success: false,
          error: error.message
        });
      }
    }
    
    const successfulGeneration = generationResults.filter(r => r.success).length;
    
    console.log(`\n✅ GENERACIÓN DE AUDIOS FALTANTES COMPLETADA:`);
    console.log(`🎵 ${successfulGeneration}/${missingAudioSections.length} audios faltantes generados con Applio`);
    console.log(`⏭️ ${projectState.completedSections.length - missingAudioSections.length} audios ya existían`);
    
    res.json({
      success: true,
      message: `${successfulGeneration}/${missingAudioSections.length} audios faltantes generados exitosamente`,
      data: {
        generationResults: generationResults,
        generatedCount: successfulGeneration,
        totalSections: projectState.completedSections.length,
        skippedSections: projectState.completedSections.length - missingAudioSections.length,
        missingAudioSections: missingAudioSections.map(s => s.section),
        applioConfig: {
          voice: applioVoice,
          model: applioModel,
          pitch: applioPitch
        }
      }
    });
    
  } catch (error) {
    console.error('❌ Error en generación de audios faltantes:', error);
    res.status(500).json({ error: 'Error generando audios faltantes: ' + error.message });
  }
});

// ENDPOINT PARA REGENERAR AUDIOS CON APPLIO (MANTENER PARA COMPATIBILIDAD)
app.post('/regenerate-applio-audios', async (req, res) => {
  try {
    const { folderName, applioVoice, applioModel, applioPitch, totalSections, scriptStyle = 'professional', customStyleInstructions = '', wordsMin = 800, wordsMax = 1100 } = req.body;
    
    console.log('\n' + '🔄'.repeat(20));
    console.log('🔄 REGENERANDO AUDIOS CON APPLIO');
    console.log('🔄'.repeat(20));
    
    console.log('🎤 Configuración de regeneración:', {
      proyecto: folderName,
      voz: applioVoice,
      modelo: applioModel,
      pitch: applioPitch,
      secciones: totalSections
    });
    
    // Verificar que el proyecto existe
    const projectState = loadProjectState(folderName);
    if (!projectState) {
      return res.status(404).json({ error: 'Proyecto no encontrado' });
    }
    
    // Inicializar Applio
    console.log('🔄 Iniciando Applio para regeneración de audio...');
    const applioStarted = await startApplio();
    if (!applioStarted) {
      throw new Error('No se pudo iniciar Applio');
    }
    
    const regenerationResults = [];
    
    // Regenerar audio para todas las secciones completadas
    for (let i = 0; i < projectState.completedSections.length; i++) {
      const section = projectState.completedSections[i];
      console.log(`🎵 Regenerando audio ${i + 1}/${totalSections}: Sección ${section.section}`);
      
      try {
        // Obtener el directorio de la sección
        const projectDir = path.join('./public/outputs', folderName);
        const sectionDir = path.join(projectDir, `seccion_${section.section}`);
        
        // Crear nombre de archivo único
        const fileName = `${folderName}_seccion_${section.section}_regenerado_${Date.now()}.wav`;
        const filePath = path.join(sectionDir, fileName);
        
        console.log(`📁 Regenerando audio en: ${filePath}`);
        console.log(`📝 Script completo: ${section.script.substring(0, 100)}...`);
        
        // Extraer solo el contenido del guión sin metadatos
        const scriptResult = extractScriptContent(section.script);
        let cleanScript = scriptResult.content;
        
        // Si el script está vacío, generar el contenido faltante
        if (scriptResult.isEmpty && scriptResult.hasStructure) {
          console.log(`🔧 Generando guión faltante para sección ${section.section}...`);
          
          // Obtener información adicional del proyecto para la generación
          const chapterTitle = section.title && section.title !== `Sección ${section.section}` 
            ? section.title 
            : null;
          
          // Obtener secciones anteriores para contexto
          const previousSections = projectState.completedSections
            .filter(s => s.section < section.section)
            .sort((a, b) => a.section - b.section);
          
          const generationResult = await generateMissingScript(
            projectState.topic || 'Proyecto de gaming',
            section.section,
            projectState.totalSections,
            chapterTitle,
            previousSections,
            scriptStyle,
            customStyleInstructions,
            wordsMin,
            wordsMax
          );
          
          if (generationResult.success) {
            cleanScript = generationResult.script;
            console.log(`✅ Guión generado: ${cleanScript.length} caracteres`);
            
            // Actualizar el archivo TXT con el nuevo contenido
            try {
              const projectDir = path.join('./public/outputs', folderName);
              const sectionDir = path.join(projectDir, `seccion_${section.section}`);
              const scriptFiles = fs.readdirSync(sectionDir).filter(file => 
                file.endsWith('.txt') && !file.includes('metadata') && !file.includes('keywords')
              );
              
              if (scriptFiles.length > 0) {
                const scriptFilePath = path.join(sectionDir, scriptFiles[0]);
                const originalContent = fs.readFileSync(scriptFilePath, 'utf8');
                
                // Reconstruir el archivo con el nuevo contenido
                const updatedContent = originalContent.replace(
                  /(CONTENIDO DEL GUIÓN:\s*\n)(.*?)(===============================)/s,
                  `$1${cleanScript}\n\n$3`
                );
                
                fs.writeFileSync(scriptFilePath, updatedContent, 'utf8');
                console.log(`📝 Archivo TXT actualizado con el nuevo guión`);
              }
            } catch (updateError) {
              console.warn(`⚠️ No se pudo actualizar el archivo TXT:`, updateError.message);
            }
            
          } else {
            console.error(`❌ No se pudo generar el guión: ${generationResult.error}`);
            throw new Error(`No se pudo generar el guión faltante: ${generationResult.error}`);
          }
        } else if (scriptResult.isEmpty) {
          throw new Error('El script está vacío y no se puede generar audio');
        }
        
        console.log(`🧹 Script limpio: ${cleanScript.substring(0, 100)}...`);
        
        // Generar audio con Applio usando solo el contenido del guión
        const result = await applioClient.textToSpeech(cleanScript, filePath, {
          model: applioModel || 'rmvpe',
          speed: 0,
          pitch: applioPitch || 0,
          voicePath: applioVoice || 'es-ES-ElviraNeural.pth'
        });
        
        if (!result.success) {
          throw new Error('Applio no generó el audio correctamente');
        }
        
        // Retornar ruta relativa para acceso web
        const audioPath = path.relative('./public', filePath).replace(/\\/g, '/');
        
        regenerationResults.push({
          section: section.section,
          audioPath: audioPath,
          success: true,
          message: `Audio regenerado exitosamente`
        });
        
        console.log(`✅ Audio regenerado: ${audioPath}`);
        
      } catch (error) {
        console.error(`❌ Error regenerando audio para sección ${section.section}:`, error);
        regenerationResults.push({
          section: section.section,
          audioPath: null,
          success: false,
          error: error.message
        });
      }
    }
    
    const successfulRegeneration = regenerationResults.filter(r => r.success).length;
    
    console.log(`\n✅ REGENERACIÓN COMPLETADA:`);
    console.log(`🎵 ${successfulRegeneration}/${totalSections} audios regenerados con Applio`);
    
    res.json({
      success: true,
      message: `${successfulRegeneration}/${totalSections} audios regenerados exitosamente`,
      data: {
        regenerationResults: regenerationResults,
        successfulRegeneration: successfulRegeneration,
        totalSections: totalSections,
        applioConfig: {
          voice: applioVoice,
          model: applioModel,
          pitch: applioPitch
        }
      }
    });
    
  } catch (error) {
    console.error('❌ Error en regeneración de audios:', error);
    res.status(500).json({ error: 'Error regenerando audios: ' + error.message });
  }
});

// ENDPOINT PARA REGENERAR SOLO LOS GUIONES FALTANTES (SIN AUDIO)
app.post('/generate-missing-scripts', async (req, res) => {
  try {
    const { folderName, scriptStyle = 'professional', customStyleInstructions = '', wordsMin = 800, wordsMax = 1100 } = req.body;
    
    console.log('\n' + '📝'.repeat(20));
    console.log('📝 REGENERANDO GUIONES FALTANTES');
    console.log('📝'.repeat(20));
    
    // Verificar que el proyecto existe
    const projectState = loadProjectState(folderName);
    if (!projectState) {
      return res.status(404).json({ error: 'Proyecto no encontrado' });
    }
    
    console.log(`📝 Verificando guiones faltantes en proyecto: ${folderName}`);
    console.log(`📊 Total de secciones: ${projectState.completedSections.length}`);
    
    // Verificar qué secciones tienen guiones vacíos
    const missingSectionScripts = [];
    const projectDir = path.join('./public/outputs', folderName);
    
    for (let i = 0; i < projectState.completedSections.length; i++) {
      const section = projectState.completedSections[i];
      const sectionDir = path.join(projectDir, `seccion_${section.section}`);
      
      if (fs.existsSync(sectionDir)) {
        const scriptFiles = fs.readdirSync(sectionDir).filter(file => 
          file.endsWith('.txt') && !file.includes('metadata') && !file.includes('keywords')
        );
        
        if (scriptFiles.length > 0) {
          const scriptFilePath = path.join(sectionDir, scriptFiles[0]);
          const fullContent = fs.readFileSync(scriptFilePath, 'utf8');
          const scriptResult = extractScriptContent(fullContent);
          
          if (scriptResult.isEmpty && scriptResult.hasStructure) {
            console.log(`📝 Sección ${section.section} necesita regeneración de guión`);
            missingSectionScripts.push({
              ...section,
              scriptFilePath: scriptFilePath,
              originalContent: fullContent
            });
          } else if (scriptResult.content.length > 0) {
            console.log(`✅ Sección ${section.section} ya tiene guión (${scriptResult.content.length} caracteres)`);
          }
        }
      }
    }
    
    console.log(`📊 Análisis de guiones: ${missingSectionScripts.length}/${projectState.completedSections.length} secciones necesitan regeneración`);
    
    if (missingSectionScripts.length === 0) {
      return res.json({
        success: true,
        message: 'Todos los guiones ya existen, no se regeneró ninguno',
        data: {
          generatedCount: 0,
          totalSections: projectState.completedSections.length,
          skippedSections: projectState.completedSections.length,
          missingScripts: []
        }
      });
    }
    
    const scriptResults = [];
    
    // Generar guiones solo para las secciones que lo necesitan
    for (let i = 0; i < missingSectionScripts.length; i++) {
      const section = missingSectionScripts[i];
      console.log(`📝 Generando guión ${i + 1}/${missingSectionScripts.length}: Sección ${section.section}`);
      
      try {
        // Obtener información adicional del proyecto para la generación
        const chapterTitle = section.title && section.title !== `Sección ${section.section}` 
          ? section.title 
          : null;
        
        // Obtener secciones anteriores para contexto
        const previousSections = projectState.completedSections
          .filter(s => s.section < section.section)
          .sort((a, b) => a.section - b.section);
        
        const generationResult = await generateMissingScript(
          projectState.topic || 'Proyecto de gaming',
          section.section,
          projectState.totalSections,
          chapterTitle,
          previousSections,
          scriptStyle,
          customStyleInstructions,
          wordsMin,
          wordsMax
        );
        
        if (generationResult.success) {
          // Actualizar el archivo TXT con el nuevo contenido
          const updatedContent = section.originalContent.replace(
            /(CONTENIDO DEL GUIÓN:\s*\n)(.*?)(===============================)/s,
            `$1${generationResult.script}\n\n$3`
          );
          
          fs.writeFileSync(section.scriptFilePath, updatedContent, 'utf8');
          
          scriptResults.push({
            section: section.section,
            scriptLength: generationResult.script.length,
            success: true,
            message: `Guión generado exitosamente`
          });
          
          console.log(`✅ Guión generado para sección ${section.section}: ${generationResult.script.length} caracteres`);
          
        } else {
          scriptResults.push({
            section: section.section,
            success: false,
            error: generationResult.error
          });
          console.error(`❌ Error generando guión para sección ${section.section}: ${generationResult.error}`);
        }
        
      } catch (error) {
        console.error(`❌ Error procesando sección ${section.section}:`, error);
        scriptResults.push({
          section: section.section,
          success: false,
          error: error.message
        });
      }
    }
    
    const successfulGeneration = scriptResults.filter(r => r.success).length;
    
    console.log(`\n✅ REGENERACIÓN DE GUIONES COMPLETADA:`);
    console.log(`📝 ${successfulGeneration}/${missingSectionScripts.length} guiones faltantes regenerados`);
    console.log(`⏭️ ${projectState.completedSections.length - missingSectionScripts.length} guiones ya existían`);
    
    res.json({
      success: true,
      message: `${successfulGeneration}/${missingSectionScripts.length} guiones faltantes regenerados exitosamente`,
      data: {
        scriptResults: scriptResults,
        generatedCount: successfulGeneration,
        totalSections: projectState.completedSections.length,
        skippedSections: projectState.completedSections.length - missingSectionScripts.length,
        missingScripts: missingSectionScripts.map(s => s.section)
      }
    });
    
  } catch (error) {
    console.error('❌ Error en regeneración de guiones:', error);
    res.status(500).json({ error: 'Error regenerando guiones: ' + error.message });
  }
});

// ENDPOINT PARA CONTINUAR CON FASE 3: GENERACIÓN DE IMÁGENES POR LOTES
app.post('/generate-batch-images', async (req, res) => {
  try {
    const { projectData, skipImages, googleImages, localAIImages, geminiGeneratedImages, imageModel, comfyUISettings, folderName } = req.body;
    
    console.log('\n' + '🎨'.repeat(20));
    console.log('🎨 FASE 3: GENERANDO TODAS LAS IMÁGENES');
    console.log('🎨'.repeat(20));
    
    const { sections, imagePrompts, projectKey, additionalInstructions, topic } = projectData;
    let shouldSkipImages = skipImages === true;
    let shouldUseGoogleImages = googleImages === true;
    let shouldUseLocalAI = localAIImages === true;
    let shouldUseGeminiImages = geminiGeneratedImages === true;
    
    console.log(`📝 Instrucciones adicionales recibidas: "${additionalInstructions || 'Ninguna'}"`);
    
    // Crear estructura de carpetas base para este proyecto
    const baseTopic = topic || sections[0].title.split(':')[0] || 'Proyecto';
    
    if (shouldSkipImages) {
      console.log('⏭️ Saltando generación de imágenes...');
      return res.json({
        success: true,
        phase: 'images_skipped',
        message: 'Fase 3: Generación de imágenes omitida',
        data: { projectKey: projectKey }
      });
    }

    const imageMethod = shouldUseLocalAI ? 'ComfyUI (IA Local)' : shouldUseGoogleImages ? 'Google Images' : 'IA en la nube';
    console.log(`🖼️ Generando imágenes para ${sections.length} secciones con ${imageMethod}...`);

    const allImageResults = [];

    // Procesar cada sección
    for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
      const section = sections[sectionIndex];
      const sectionImagePrompts = imagePrompts[sectionIndex]?.prompts || [];

      if (sectionImagePrompts.length === 0) {
        console.log(`⚠️ No hay prompts de imágenes para sección ${section.section}`);
        continue;
      }

      console.log(`🎨 Generando ${sectionImagePrompts.length} imágenes para sección ${section.section}: ${section.title}`);

      // Crear estructura de carpetas individual para esta sección usando el folderName ya normalizado
      const sectionFolderStructure = createProjectStructure(baseTopic, section.section, folderName);      try {
        let sectionImages = [];
        
        if (shouldUseLocalAI) {
          // Determinar si esta es la última sección para cerrar ComfyUI
          const isLastSection = sectionIndex === sections.length - 1;
          
          // Generar con ComfyUI - los prompts ya tienen las instrucciones integradas desde Fase 1
          sectionImages = await generateLocalAIImages(
            sectionImagePrompts,
            '', // Los prompts ya vienen con instrucciones integradas desde Fase 1
            sectionFolderStructure.sectionDir,
            section.section,
            comfyUISettings,
            !isLastSection // keepAlive = true para todas excepto la última
          );
          
        } else if (shouldUseGoogleImages) {
          // Buscar imágenes de Google
          console.log(`🔍 Buscando imágenes de Google para sección ${section.section}...`);
          
          // CORREGIDO: Pasar todos los keywords de una vez para generar nombres únicos
          const googleImages = await searchAndDownloadBingImages(sectionImagePrompts, sectionFolderStructure.sectionDir);
          
          if (googleImages && googleImages.length > 0) {
            googleImages.forEach((image, index) => {
              sectionImages.push({
                path: image.path,
                prompt: image.keywords,
                filename: image.filename,
                source: 'Google Images',
                index: index + 1
              });
            });
            
            // ✅ NUEVO: Crear images_metadata.json para cargar keywords posteriormente (batch)
            try {
              const metadataPath = path.join(sectionFolderStructure.sectionDir, 'images_metadata.json');
              const metadata = {};
              
              googleImages.forEach((img, index) => {
                metadata[img.filename] = {
                  originalUrl: img.url,
                  keywords: img.keywords || '',
                  timestamp: new Date().toISOString(),
                  source: 'bing',
                  section: section.section
                };
              });
              
              fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
              console.log(`📝 Metadata de imágenes guardada en: ${metadataPath} (batch section ${section.section})`);
            } catch (metadataError) {
              console.warn(`⚠️ Error guardando images_metadata.json (batch): ${metadataError.message}`);
            }
          }
          
        } else {
          // Generar con IA en la nube
          console.log(`🤖 Generando con IA en la nube (modelo: ${imageModel})...`);
          
          for (let promptIndex = 0; promptIndex < sectionImagePrompts.length; promptIndex++) {
            const prompt = sectionImagePrompts[promptIndex];
            
            try {
              const enhancedPrompt = `${prompt.trim()}.`;
              const imageResponse = await generateImageWithModel(ai, enhancedPrompt, imageModel);
              
              if (imageResponse.generatedImages && imageResponse.generatedImages.length > 0) {
                const generatedImage = imageResponse.generatedImages[0];
                const imageData = generatedImage.image.imageBytes;
                
                // Guardar imagen
                const timestamp = Date.now();
                const imageFileName = `seccion_${section.section}_imagen_${promptIndex + 1}_${timestamp}.png`;
                const imageFilePath = path.join(sectionFolderStructure.sectionDir, imageFileName);
                
                const imageBuffer = Buffer.from(imageData, 'base64');
                fs.writeFileSync(imageFilePath, imageBuffer);
                
                // Retornar ruta relativa para acceso web
                const relativePath = path.relative('./public', imageFilePath).replace(/\\/g, '/');
                
                sectionImages.push({
                  path: relativePath,
                  prompt: prompt,
                  filename: imageFileName,
                  source: `IA en la nube (${imageModel === 'gemini2' ? 'Gemini 2.0' : 'Imagen 4.0'})`,
                  index: promptIndex + 1
                });
                
                console.log(`✅ Imagen ${promptIndex + 1} generada con IA en la nube`);
                
              } else {
                throw new Error('No se generó imagen');
              }
              
            } catch (imageError) {
              console.error(`❌ Error generando imagen ${promptIndex + 1} con IA:`, imageError);
              sectionImages.push({
                path: null,
                prompt: prompt,
                filename: null,
                source: 'IA en la nube Error',
                index: promptIndex + 1,
                error: imageError.message
              });
            }
          }
        }
        
        // Guardar los prompts de esta sección en archivo TXT
        try {
          const promptsFileName = `${createSafeFolderName(baseTopic)}_seccion_${section.section}_prompts_imagenes.txt`;
          const promptsFilePath = path.join(sectionFolderStructure.sectionDir, promptsFileName);
          
          const promptsContent = `PROMPTS DE IMÁGENES - SECCIÓN ${section.section}
===============================
Tema: ${baseTopic}
Sección: ${section.section} de ${sections.length}
Título: ${section.title}
Cantidad de prompts: ${sectionImagePrompts.length}
Fecha de generación: ${new Date().toLocaleString()}
${folderName ? `Nombre del proyecto: ${folderName}` : ''}
Método de generación: ${imageMethod}

PROMPTS GENERADOS:
${sectionImagePrompts.map((prompt, index) => `
${index + 1}. ${prompt.trim()}
`).join('')}

===============================
ESTADÍSTICAS DE GENERACIÓN:
- Prompts totales: ${sectionImagePrompts.length}
- Imágenes exitosas: ${sectionImages.filter(img => img.path).length}
- Imágenes fallidas: ${sectionImages.filter(img => !img.path).length}

===============================
Generado automáticamente por el sistema de creación de contenido (Modo Batch)
`;
          
          fs.writeFileSync(promptsFilePath, promptsContent, 'utf8');
          console.log(`📝 Prompts de sección ${section.section} guardados en: ${promptsFilePath}`);
          
        } catch (saveError) {
          console.error(`❌ Error guardando prompts de sección ${section.section}:`, saveError);
          // No detener el proceso por este error, solo registrarlo
        }
        
        allImageResults.push({
          section: section.section,
          title: section.title,
          images: sectionImages,
          success: sectionImages.filter(img => img.path).length > 0
        });
        
        const successfulImages = sectionImages.filter(img => img.path).length;
        console.log(`✅ Sección ${section.section}: ${successfulImages}/${sectionImagePrompts.length} imágenes generadas`);

        // 📊 GUARDADO PROGRESIVO: Actualizar progreso después de cada sección de imágenes
        try {
          const progressData = updateProjectProgress(projectKey, 'images', sectionIndex + 1, sections.length);
          
          // Guardar estado del proyecto con imágenes completadas hasta ahora
          const updatedProjectData = {
            ...projectData,
            imageResults: allImageResults,
            imageMethod: imageMethod,
            imageConfig: shouldUseLocalAI ? { 
              method: 'localAI', 
              settings: comfyUISettings 
            } : shouldUseGoogleImages ? { 
              method: 'google' 
            } : { 
              method: 'cloud', 
              model: imageModel 
            },
            phase: 'images',
            lastUpdate: new Date().toISOString()
          };
          
          await saveProgressiveProjectState(projectKey, updatedProjectData, progressData);
          
          console.log(`📊 Progreso guardado: Sección ${sectionIndex + 1}/${sections.length} imágenes (${progressData.percentage}%) - Tiempo estimado restante: ${progressData.estimatedTimeRemaining}`);
          
        } catch (progressError) {
          console.error('⚠️ Error guardando progreso de imágenes:', progressError.message);
          // No interrumpir la generación por errores de guardado
        }
        
      } catch (error) {
        console.error(`❌ Error generando imágenes para sección ${section.section}:`, error);
        allImageResults.push({
          section: section.section,
          title: section.title,
          images: [],
          success: false,
          error: error.message
        });

        // 📊 GUARDADO PROGRESIVO: Actualizar progreso incluso en caso de error
        try {
          const progressData = updateProjectProgress(projectKey, 'images', sectionIndex + 1, sections.length);
          
          const updatedProjectData = {
            ...projectData,
            imageResults: allImageResults,
            imageMethod: imageMethod,
            imageConfig: shouldUseLocalAI ? { 
              method: 'localAI', 
              settings: comfyUISettings 
            } : shouldUseGoogleImages ? { 
              method: 'google' 
            } : { 
              method: 'cloud', 
              model: imageModel 
            },
            phase: 'images',
            lastUpdate: new Date().toISOString()
          };
          
          await saveProgressiveProjectState(projectKey, updatedProjectData, progressData);
          
          console.log(`📊 Progreso guardado (con error): Sección ${sectionIndex + 1}/${sections.length} imágenes (${progressData.percentage}%)`);
          
        } catch (progressError) {
          console.error('⚠️ Error guardando progreso de imágenes:', progressError.message);
        }
      }
    }
    
    const totalSuccessfulImages = allImageResults.reduce((total, section) => {
      return total + (section.images?.filter(img => img.path).length || 0);
    }, 0);
    
    const totalExpectedImages = imagePrompts.reduce((total, section) => {
      return total + (section.prompts?.length || 0);
    }, 0);
    
    console.log(`\n✅ FASE 3 COMPLETADA:`);
    console.log(`🖼️ ${totalSuccessfulImages}/${totalExpectedImages} imágenes generadas con ${imageMethod}`);
    
    // Asegurar que ComfyUI se cierre al final de la fase 3 (solo si se usó)
    if (shouldUseLocalAI) {
      console.log('🛑 Cerrando ComfyUI al finalizar Fase 3...');
      await stopComfyUI();
      console.log('✅ ComfyUI cerrado, GPU liberada');
    }
    
    // Generar archivo project_state.json para persistencia del proyecto
    try {
      await generateProjectStateFile(projectData, {
        topic,
        voice: selectedVoice,
        totalSections,
        imageCount,
        promptModifier,
        imageModel,
        llmModel,
        scriptStyle,
        customStyleInstructions,
        applioVoice,
        applioModel,
        applioPitch
      });
      console.log('📄 Archivo project_state.json generado exitosamente');
    } catch (stateError) {
      console.error('❌ Error generando project_state.json:', stateError.message);
    }
    
    res.json({
      success: true,
      phase: 'images_completed',
      message: `Fase 3 completada: ${totalSuccessfulImages}/${totalExpectedImages} imágenes generadas con ${imageMethod}`,
      data: {
        imageResults: allImageResults,
        projectKey: projectKey,
        imageMethod: imageMethod,
        totalImages: totalSuccessfulImages
      }
    });
    
  } catch (error) {
    console.error('❌ Error en generación de imágenes por lotes:', error);
    
    // Asegurar que ComfyUI se cierre en caso de error
    try {
      console.log('🛑 Cerrando ComfyUI debido a error en batch...');
      await stopComfyUI();
      console.log('✅ ComfyUI cerrado después del error');
    } catch (closeError) {
      console.error('❌ Error cerrando ComfyUI:', closeError);
    }
    
    res.status(500).json({ error: 'Error en generación de imágenes: ' + error.message });
  }
});

// ENDPOINT PARA OBTENER PROGRESO EN TIEMPO REAL
app.get('/progress/:projectKey', (req, res) => {
  try {
    const { projectKey } = req.params;
    
    if (!projectProgressTracker[projectKey]) {
      return res.json({ 
        success: false, 
        error: 'Proyecto no encontrado' 
      });
    }
    
    const progressData = projectProgressTracker[projectKey];
    
    res.json({
      success: true,
      progress: progressData
    });
    
  } catch (error) {
    console.error('❌ Error obteniendo progreso:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error obteniendo progreso: ' + error.message 
    });
  }
});

app.post('/generate', async (req, res) => {
  try {
    const { topic, folderName, voice, totalSections, currentSection, previousSections, minWords, maxWords, imageCount, promptModifier, imageModel, llmModel, skipImages, googleImages, localAIImages, comfyUISettings, scriptStyle, customStyleInstructions, applioVoice, applioModel, applioPitch } = req.body;
    
    const selectedVoice = voice || 'Orus';
    const sections = totalSections || 3;
    const section = currentSection || 1;
    const wordsMin = minWords || 800;
    const wordsMax = maxWords || 1100;
    const selectedStyle = scriptStyle || 'professional'; // Default al estilo profesional
    const numImages = imageCount || 5; // Default a 5 imágenes si no se especifica
    const additionalInstructions = promptModifier || ''; // Instrucciones adicionales para imágenes
    const selectedImageModel = imageModel || 'gemini2';
    const selectedLlmModel = llmModel || 'gemini-2.5-flash';
    let shouldSkipImages = skipImages === true;
    let shouldUseGoogleImages = googleImages === true;
    let shouldUseLocalAI = localAIImages === true;
    
    console.log(`🎯 Solicitud recibida: ${shouldUseLocalAI ? 'IA LOCAL' : shouldUseGoogleImages ? 'ENLACES GOOGLE' : shouldSkipImages ? 'SIN IMÁGENES' : numImages + ' imágenes'} para la sección ${section}`);
    
    if (!topic) {
      return res.status(400).json({ error: 'Tema requerido' });
    }

    // Crear clave única para la conversación (proyecto)
    // Usar el mismo folderName que se usa para la estructura de carpetas
    const actualFolderName = folderName && folderName.trim() 
      ? createSafeFolderName(folderName.trim())
      : createSafeFolderName(topic);
    const projectKey = actualFolderName;
    const conversation = getOrCreateConversation(projectKey);

    // Crear estructura de carpetas usando el actualFolderName ya normalizado
    const folderStructure = createProjectStructure(topic, section, actualFolderName);
    console.log(`📁 Estructura de carpetas creada: ${folderStructure.sectionDir}`);
    
    console.log(`💬 Usando conversación: ${projectKey} (folderName: "${actualFolderName}")`);
    console.log(`📝 Historial actual: ${conversation.history.length} mensajes`);

    // Paso 1: Generar guión usando conversación continua
    console.log(`📝 Generando guión de YouTube - Sección ${section}/${sections} para el tema: ${topic}...`);
    console.log(`🎭 Usando estilo: ${selectedStyle === 'comedy' ? 'Cómico/Sarcástico' : 'Profesional'}`);
    
    let promptContent;
    let chapterStructure = null;
    
    if (section === 1) {
      // Primera sección: Generar estructura completa de capítulos primero
      conversation.topic = topic;
      conversation.totalSections = sections;
      conversation.currentSection = 1;
      conversation.history = []; // Limpiar historial para nueva conversación

      console.log(`📋 PASO 1: Generando estructura de ${sections} capítulos para el tema: ${topic}...`);
      
      // Generar estructura de capítulos
      let chapterPrompt;
      
      // Detectar si se está usando un estilo personalizado
      if (selectedStyle && selectedStyle.startsWith('custom_') && customStyleInstructions) {
        // Prompt especializado para estilos personalizados
        chapterPrompt = `Eres un experto en crear estructuras narrativas personalizadas.

TEMA SOLICITADO: "${topic}"
TOTAL DE CAPÍTULOS: ${sections}
ESTILO PERSONALIZADO: ${customStyleInstructions}

Tu tarea es crear una ESTRUCTURA NARRATIVA que respete completamente el estilo personalizado definido.

INSTRUCCIONES ESPECÍFICAS PARA ESTE ESTILO:
- Analiza cuidadosamente las instrucciones del estilo personalizado
- Crea títulos que reflejen EXACTAMENTE lo que pide el estilo
- Si el estilo menciona "situaciones cotidianas", crea capítulos sobre actividades diarias del personaje
- Si el estilo habla de "progresión del día", organiza los capítulos cronológicamente  
- Si pide "técnicas de hipnotización", enfócate en momentos relajantes del personaje
- IGNORA formatos educativos genéricos, sigue SOLO el estilo personalizado

PARA "${topic}" CON ESTE ESTILO ESPECÍFICO:
Genera títulos que narren momentos, actividades y situaciones del personaje, no información educativa sobre la serie.

FORMATO DE RESPUESTA OBLIGATORIO:
Debes responder ÚNICAMENTE con los títulos separados por "||CAPITULO||"

VERIFICACIÓN: Tu respuesta debe tener exactamente ${sections - 1} delimitadores "||CAPITULO||" para generar ${sections} títulos.

RESPONDE SOLO CON LOS TÍTULOS SEPARADOS POR "||CAPITULO||", NADA MÁS.`;
      } else {
        // Prompt estándar para estilos no personalizados  
        chapterPrompt = `Eres un experto en narrativa para YouTube especializado en contenido educativo y entretenimiento.

TEMA SOLICITADO: "${topic}"
TOTAL DE CAPÍTULOS: ${sections}

Tu tarea es crear una ESTRUCTURA NARRATIVA completa dividiendo el tema en ${sections} capítulos/secciones coherentes y bien organizadas.

INSTRUCCIONES:
- Crea EXACTAMENTE ${sections} títulos de capítulos
- Cada capítulo debe tener un título descriptivo y atractivo
- Los capítulos deben seguir un hilo narrativo lógico
- Progresión natural del tema de inicio a conclusión
- Títulos que generen curiosidad y mantengan el interés

FORMATO DE RESPUESTA OBLIGATORIO:
Debes responder ÚNICAMENTE con los títulos separados por "||CAPITULO||"

EJEMPLO PARA 3 CAPÍTULOS:
Capítulo 1: El Origen de la Leyenda||CAPITULO||Capítulo 2: Los Secretos Revelados||CAPITULO||Capítulo 3: El Legado Eterno

VERIFICACIÓN: Tu respuesta debe tener exactamente ${sections - 1} delimitadores "||CAPITULO||" para generar ${sections} títulos.

RESPONDE SOLO CON LOS TÍTULOS SEPARADOS POR "||CAPITULO||", NADA MÁS.`;
      }

      console.log(`🔄 Enviando prompt de capítulos al modelo ${selectedLlmModel}...`);
      
      try {
        const chapterResponse = await generateUniversalContent(
          selectedLlmModel,
          chapterPrompt,
          "Eres un experto en estructura narrativa. Tu ÚNICA tarea es crear títulos de capítulos separados por '||CAPITULO||'. NUNCA generes texto adicional fuera de los títulos."
        );

        console.log(`✅ Respuesta de capítulos recibida exitosamente`);

        const chaptersText = chapterResponse || '';
        console.log(`📝 Respuesta de estructura: ${chaptersText ? chaptersText.substring(0, 200) + '...' : 'RESPUESTA VACÍA'}`);
        
        const chapterTitles = chaptersText.split('||CAPITULO||').filter(title => title.trim()).slice(0, sections);
        console.log(`📚 Capítulos generados: ${chapterTitles.length} de ${sections} solicitados`);
        console.log(`📖 Títulos: ${chapterTitles.join(', ')}`);
        
        // 📋 MOSTRAR ESTRUCTURA COMPLETA DE CAPÍTULOS
        console.log('\n' + '='.repeat(60));
        console.log('📖 ESTRUCTURA COMPLETA DE CAPÍTULOS GENERADA');
        console.log('='.repeat(60));
        console.log(`🎯 Tema: "${topic}"`);
        console.log(`📊 Total de capítulos: ${sections}`);
        console.log(`🧠 Modelo LLM usado: ${selectedLlmModel}`);
        console.log('─'.repeat(60));
        
        if (chapterTitles.length > 0) {
          chapterTitles.forEach((title, index) => {
            const chapterNumber = index + 1;
            const cleanTitle = title.trim();
            console.log(`📚 Capítulo ${chapterNumber}: ${cleanTitle}`);
          });
        } else {
          console.log('⚠️ No se generaron títulos de capítulos');
        }
        
        console.log('='.repeat(60) + '\n');
        
        // Guardar estructura en la conversación
        conversation.chapterStructure = chapterTitles;
        chapterStructure = chapterTitles;
        
      } catch (chapterError) {
        console.error('❌ ERROR generando estructura de capítulos:', chapterError);
        console.log('⚠️ Continuando sin estructura de capítulos...');
        chapterStructure = [];
        conversation.chapterStructure = [];
      }

      console.log(`📝 PASO 2: Generando contenido del Capítulo 1: ${chapterStructure[0] || 'Sin título'}...`);
      
      // Ahora generar el contenido de la primera sección con contexto de estructura
      promptContent = generateScriptPrompt(selectedStyle, topic, sections, section, customStyleInstructions, chapterStructure, null, wordsMin, wordsMax);

      // Limpiar historial y agregar mensaje inicial
      conversation.history = [
        { role: 'user', parts: [{ text: promptContent }] }
      ];
      
    } else {
      // Secciones posteriores: Usar estructura existente
      chapterStructure = conversation.chapterStructure || [];
      console.log(`📖 Usando estructura existente: ${chapterStructure.length} capítulos`);
      console.log(`📝 Generando Capítulo ${section}: ${chapterStructure[section - 1] || 'Sin título'}...`);
      
      // � EXTRAER CONTEXTO DE CAPÍTULOS ANTERIORES
      console.log(`🔗 Extrayendo contexto de ${section - 1} capítulos anteriores...`);
      const previousChapterContent = [];
      
      // Obtener el contenido de las respuestas anteriores del asistente
      conversation.history.forEach((message, index) => {
        if (message.role === 'model' && message.parts && message.parts[0] && message.parts[0].text) {
          const content = message.parts[0].text.trim();
          if (content.length > 50) { // Solo incluir respuestas con contenido sustancial
            previousChapterContent.push(content);
          }
        }
      });
      
      console.log(`📚 Capítulos anteriores encontrados: ${previousChapterContent.length}`);
      if (previousChapterContent.length > 0) {
        console.log(`📖 Último capítulo preview: ${previousChapterContent[previousChapterContent.length - 1].substring(0, 100)}...`);
      }
      
      // 📋 MOSTRAR PROGRESO DE CAPÍTULOS
      console.log('\n' + '─'.repeat(50));
      console.log(`📚 CAPÍTULO ${section} DE ${sections}`);
      console.log('─'.repeat(50));
      console.log(`🎯 Tema: "${topic}"`);
      console.log(`📖 Capítulo actual: ${chapterStructure[section - 1] || 'Sin título'}`);
      console.log(`🧠 Modelo LLM: ${selectedLlmModel}`);
      
      // Mostrar contexto de todos los capítulos
      console.log('\n📋 Estructura completa:');
      chapterStructure.forEach((title, index) => {
        const chapterNumber = index + 1;
        const isCurrentChapter = chapterNumber === section;
        const statusIcon = chapterNumber < section ? '✅' : isCurrentChapter ? '🔄' : '⏳';
        const cleanTitle = title.trim();
        console.log(`${statusIcon} Capítulo ${chapterNumber}: ${cleanTitle}`);
      });
      console.log('─'.repeat(50) + '\n');
      
      promptContent = generateScriptPrompt(selectedStyle, topic, sections, section, customStyleInstructions, chapterStructure, previousChapterContent, wordsMin, wordsMax);

      // Agregar nueva pregunta al historial
      conversation.history.push({ role: 'user', parts: [{ text: promptContent }] });
    }
    
    // Actualizar sección actual
    conversation.currentSection = section;

    // Generar respuesta usando el historial de conversación
    let systemInstruction;
    if (selectedStyle === 'comedy') {
      systemInstruction = `Eres un escritor de guiones cómicos para YouTube con tono sarcástico y humor negro. IMPORTANTE: Responde ÚNICAMENTE con el texto del guión, sin explicaciones, comentarios, etiquetas o texto adicional. El texto debe estar listo para TTS. Incluye groserías, humor absurdo y múltiples voces entre corchetes. ESTRUCTURA OBLIGATORIA: Exactamente 3 párrafos detallados, entre ${wordsMin} y ${wordsMax} palabras total. Solo el guión puro.`;
    } else if (selectedStyle && selectedStyle.startsWith('custom_') && customStyleInstructions) {
      systemInstruction = `Eres un escritor de guiones para YouTube especializado en el estilo personalizado que el usuario ha definido. IMPORTANTE: Responde ÚNICAMENTE con el texto del guión siguiendo exactamente estas instrucciones de estilo: ${customStyleInstructions}. Sin explicaciones, comentarios, etiquetas o texto adicional. El texto debe estar listo para TTS aplicando fielmente el estilo especificado. ESTRUCTURA OBLIGATORIA: Exactamente 3 párrafos detallados, entre ${wordsMin} y ${wordsMax} palabras total. Solo el guión puro.`;
    } else {
      systemInstruction = `Eres un escritor profesional de guiones para YouTube. IMPORTANTE: Responde ÚNICAMENTE con el texto del guión, sin explicaciones, comentarios, etiquetas o texto adicional. El texto debe estar listo para TTS. No incluyas pensamientos, notas o aclaraciones. ESTRUCTURA OBLIGATORIA: Exactamente 3 párrafos detallados, entre ${wordsMin} y ${wordsMax} palabras total. Solo el guión puro.`;
    }

    const scriptResponse = await generateUniversalContent(
      selectedLlmModel,
      conversation.history,
      systemInstruction
    );

    console.log(`🔍 scriptResponse:`, typeof scriptResponse, scriptResponse);
    const script = scriptResponse || '';
    console.log(`🔍 script extraído:`, typeof script);
    console.log(`🔍 script preview:`, script && typeof script === 'string' && script.length > 0 ? script.substring(0, 100) + '...' : 'VACÍO O INVÁLIDO');
    
    // Validar que tenemos contenido válido
    if (!script || typeof script !== 'string' || script.trim().length === 0) {
      throw new Error(`No se pudo extraer contenido válido de la respuesta. Response: ${JSON.stringify(scriptResponse)}`);
    }
    
    // Limpiar el script de cualquier texto adicional no deseado
    const cleanScript = cleanScriptText(script);
    
    // Calcular tokens de entrada y salida
    const inputTokens = estimateTokens(promptContent + (systemInstruction || ''));
    const outputTokens = estimateTokens(cleanScript);
    const totalTokens = inputTokens + outputTokens;
    
    console.log(`📊 TOKENS - Entrada: ${inputTokens}, Salida: ${outputTokens}, Total: ${totalTokens}`);
    
    // Agregar respuesta al historial
    conversation.history.push({ role: 'model', parts: [{ text: cleanScript }] });
    
    // Optimizar historial manteniendo continuidad narrativa
    optimizeConversationHistory(conversation);
    
    // OPTIMIZACIÓN: Mantener solo los últimos 4 mensajes (2 intercambios: pregunta+respuesta anteriores)
    // Esto ahorra tokens manteniendo solo el contexto del capítulo anterior
    const historialAntes = conversation.history.length;
    if (conversation.history.length > 10) { // Activar optimización más tarde
      conversation.history = conversation.history.slice(-8); // Mantener más contexto para continuidad
      console.log(`� OPTIMIZACIÓN - Historial reducido de ${historialAntes} a ${conversation.history.length} mensajes`);
      console.log(`💰 AHORRO DE TOKENS - Eliminados ${historialAntes - conversation.history.length} mensajes antiguos`);
    }
    
    console.log(`✅ Guión de la sección ${section} generado usando conversación continua`);
    console.log(`💾 Historial actualizado: ${conversation.history.length} mensajes`);
    
    // Mostrar información de ahorro de tokens
    if (historialAntes > 4) {
      const tokensActuales = conversation.history.reduce((total, msg) => {
        return total + estimateTokens(msg.parts[0].text);
      }, 0);
      console.log(`📊 MÉTRICAS - Tokens actuales en historial: ~${tokensActuales} (optimizado vs ~${tokensActuales * (historialAntes / 4)} sin optimización)`);
    }

    // Guardar el guión como archivo de texto en la carpeta de la sección
    try {
      const scriptFileName = `${actualFolderName}_seccion_${section}_guion.txt`;
      const scriptFilePath = path.join(folderStructure.sectionDir, scriptFileName);
      
      const scriptContent = `GUIÓN DE LA SECCIÓN ${section}
===============================
Tema: ${topic}
Sección: ${section} de ${sections}
Fecha de generación: ${new Date().toLocaleString()}
${folderName ? `Nombre del proyecto: ${folderName}` : ''}

CONTENIDO DEL GUIÓN:
${cleanScript}

===============================
Generado automáticamente por el sistema de creación de contenido
`;
      
      fs.writeFileSync(scriptFilePath, scriptContent, 'utf8');
      console.log(`📝 Guión guardado automáticamente en: ${scriptFilePath}`);
    } catch (saveError) {
      console.error('❌ Error guardando archivo de guión:', saveError);
      // No detener el proceso por este error, solo registrarlo
    }

    // Verificar si se deben omitir las imágenes, usar Google Images o usar IA Local
    if (shouldSkipImages || shouldUseGoogleImages || shouldUseLocalAI) {
      let modeDescription = 'Modo desconocido';
      if (shouldUseLocalAI) {
        modeDescription = 'Generando imágenes con IA Local (ComfyUI + Flux)';
      } else if (shouldUseGoogleImages) {
        modeDescription = 'Descargando imágenes específicas de Bing';
      } else {
        modeDescription = 'Omitiendo generación de imágenes, pero generando prompts para mostrar';
      }
      
      console.log(`🎨 ${modeDescription}`);
      console.log(`🔍 DEBUG SKIP - shouldSkipImages: ${shouldSkipImages}`);
      console.log(`🔍 DEBUG BING - shouldUseGoogleImages: ${shouldUseGoogleImages}`);
      console.log(`🔍 DEBUG AI LOCAL - shouldUseLocalAI: ${shouldUseLocalAI}`);
      console.log(`🔍 DEBUG - numImages: ${numImages}`);
      
      let enhancedPrompts = [];
      let downloadedImages = [];
      let localAIImages = []; // Declarar para imágenes de IA Local
      let imageKeywords = []; // Declarar aquí para uso posterior
      
      if (shouldUseGoogleImages) {
        console.log(`🔍 Generando palabras clave específicas y descargando ${numImages} imágenes de Bing...`);
        
        try {
          // Generar palabras clave específicas usando el LLM
          console.log(`🧠 Analizando guión para generar palabras clave específicas...`);
          imageKeywords = await generateImageKeywords(cleanScript, topic, numImages);
          
          console.log(`🎯 Palabras clave generadas para ${numImages} imágenes:`, imageKeywords);
          
          // Descargar imágenes usando las palabras clave específicas
          downloadedImages = await searchAndDownloadBingImages(imageKeywords, folderStructure.sectionDir);
          
          if (downloadedImages.length > 0) {
            console.log(`✅ ${downloadedImages.length} imágenes descargadas de Bing exitosamente con keywords específicas`);
            
            // Guardar keywords en archivo para cargarlas posteriormente
            try {
              const keywordsToSave = downloadedImages.map(img => img.keywords || '').filter(k => k.trim());
              if (keywordsToSave.length > 0) {
                const keywordsFilePath = path.join(folderStructure.sectionDir, `${actualFolderName}_seccion_${section}_keywords.txt`);
                fs.writeFileSync(keywordsFilePath, keywordsToSave.join('\n'), 'utf8');
                console.log(`💾 Keywords guardadas en: ${keywordsFilePath}`);
              }
            } catch (keywordSaveError) {
              console.warn(`⚠️ Error guardando keywords: ${keywordSaveError.message}`);
            }
            
            // ✅ NUEVO: Crear images_metadata.json para cargar keywords posteriormente
            try {
              const metadataPath = path.join(folderStructure.sectionDir, 'images_metadata.json');
              const metadata = {};
              
              downloadedImages.forEach((img, index) => {
                metadata[img.filename] = {
                  originalUrl: img.url,
                  keywords: img.keywords || '',
                  timestamp: new Date().toISOString(),
                  source: 'bing',
                  section: section
                };
              });
              
              fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
              console.log(`📝 Metadata de imágenes guardada en: ${metadataPath}`);
              console.log(`📊 Metadata guardado:`, metadata);
            } catch (metadataError) {
              console.warn(`⚠️ Error guardando images_metadata.json: ${metadataError.message}`);
            }
            
            // Crear "prompts" mostrando las palabras clave específicas que se usaron
            enhancedPrompts = downloadedImages.map((img, index) => 
              `Imagen ${index + 1}: ${img.keywords || img.caption || img.filename}`
            );
            
            console.log(`📋 Prompts generados con keywords:`, enhancedPrompts);
          } else {
            console.log(`⚠️ No se pudieron descargar imágenes de Bing, generando prompts como fallback`);
            // Fallback: mostrar las keywords que se intentaron usar
            enhancedPrompts = imageKeywords.map((keyword, index) => 
              `Keywords intentadas ${index + 1}: ${keyword}`
            );
          }
        } catch (error) {
          console.error(`❌ Error descargando imágenes de Bing:`, error.message);
          enhancedPrompts = [`Error generando keywords o descargando imágenes: ${error.message}`];
        }
      } else if (shouldUseLocalAI) {
        console.log(`🤖 Generando ${numImages} imágenes con IA Local (ComfyUI + Flux)...`);
        
        try {
          // Paso 1: Obtener prompts anteriores para mantener consistencia
          console.log(`🧠 Recuperando contexto de prompts anteriores...`);
          const { previousPrompts, contextInfo } = getPreviousImagePrompts(projectKey, section);
          
          // Paso 2: Construir contexto de consistencia
          const consistencyContext = buildConsistencyContext(previousPrompts, contextInfo);
          
          // Paso 3: Construir prompt base para el LLM
          let basePrompt = `Basándote en este guión de la sección ${section} sobre "${topic}": "${cleanScript}", crea EXACTAMENTE ${numImages} prompts detallados para generar ${numImages} imágenes que ilustren visualmente el contenido ESPECÍFICO de esta sección.

            IMPORTANTE: Debes crear EXACTAMENTE ${numImages} prompts, ni más ni menos.

            ENFOQUE ESPECÍFICO PARA ESTA SECCIÓN:
            - Estas imágenes deben representar SOLO el contenido de la sección ${section}, no de todo el proyecto
            - Cada imagen debe mostrar diferentes aspectos, momentos o elementos clave mencionados en esta sección específica
            - NO dividas la sección en partes cronológicas - en su lugar, crea ${numImages} perspectivas diferentes del mismo contenido de la sección
            - Enfócate en elementos específicos, personajes, lugares, objetos, emociones o conceptos mencionados en esta sección
            - Mantén consistencia visual con las secciones anteriores${consistencyContext}

            TIPOS DE PROMPTS PARA ESTA SECCIÓN:
            - Imagen principal: La escena o momento central de la sección
            - Detalles importantes: Objetos, elementos o características específicas mencionadas
            - Perspectivas diferentes: Diferentes ángulos o enfoques del mismo contenido
            - Atmósfera: Imágenes que capturen el mood o ambiente de la sección
            - Elementos secundarios: Aspectos adicionales que complementen la narrativa de esta sección

            INSTRUCCIONES CRÍTICAS PARA EL FORMATO:
            - DEBES crear ${numImages} prompts independientes que representen la MISMA sección desde diferentes perspectivas
            - NO dividas el contenido en secuencia cronológica - todas las imágenes son de la MISMA sección`;
          
          // Paso 4: Integrar instrucciones adicionales en el prompt del LLM
          const finalPromptForLLM = integrateAdditionalInstructions(basePrompt, additionalInstructions);
          
          console.log(`🧠 Creando prompts para secuencia de ${numImages} imágenes con contexto de consistencia...`);
          if (previousPrompts.length > 0) {
            console.log(`🔗 Usando ${previousPrompts.length} prompts anteriores para mantener consistencia`);
          }
          if (additionalInstructions && additionalInstructions.trim()) {
            console.log(`📝 Integrando instrucciones adicionales en el LLM: "${additionalInstructions.trim()}"`);
          }
          
          const promptsResponse = await generateUniversalContent(
            selectedLlmModel,
            finalPromptForLLM + `
            - DEBES separar cada prompt con "||PROMPT||" (sin espacios adicionales)
            - DEBES asegurarte de que haya exactamente ${numImages} prompts en tu respuesta
            - Las imágenes deben contar la historia del guión de forma visual secuencial
            - Incluye detalles específicos mencionados en el texto del guión

            REQUISITOS OBLIGATORIOS para cada prompt:
            - Formato: Aspecto 16:9 (widescreen)
            - Estilo: Realista, alta calidad, 4K
            
            FORMATO DE RESPUESTA OBLIGATORIO:
            DEBES presentar EXACTAMENTE ${numImages} prompts separados por "||PROMPT||" (sin espacios antes o después del delimitador).
            
            ESTRUCTURA REQUERIDA:
            Prompt 1 aquí||PROMPT||Prompt 2 aquí||PROMPT||Prompt 3 aquí||PROMPT||... hasta el Prompt ${numImages}
            
            VERIFICACIÓN FINAL: Tu respuesta debe contener exactamente ${numImages - 1} ocurrencias del delimitador "||PROMPT||" para generar ${numImages} prompts.`,
            `Eres un experto en arte conceptual y narrativa visual. Tu ÚNICA tarea es crear prompts separados por "||PROMPT||". 

REGLAS CRÍTICAS:
1. SIEMPRE usa el delimitador exacto "||PROMPT||" (sin espacios adicionales)
2. NUNCA generes texto adicional fuera de los prompts
3. CUENTA cuidadosamente para generar el número exacto solicitado
4. DIVIDE el contenido equitativamente entre todos los prompts
5. Cada prompt debe ser independiente y descriptivo

Si te piden N prompts, tu respuesta debe tener exactamente (N-1) delimitadores "||PROMPT||".`
          );

          const promptsText = promptsResponse || '';
          console.log(`📝 Respuesta del modelo para IA Local: ${promptsText ? promptsText.substring(0, 200) + '...' : 'RESPUESTA VACÍA'}`);
          
          const imagePrompts = promptsText.split('||PROMPT||').filter(p => p.trim()).slice(0, numImages);
          console.log(`🎨 ${imagePrompts.length} prompts secuenciales generados para IA Local`);

          // Paso 2: Generar las imágenes usando ComfyUI + Flux
          console.log(`🖼️ Generando secuencia de ${numImages} imágenes con ComfyUI + Flux...`);
          
          // Registrar configuración recibida
          if (comfyUISettings) {
            console.log(`⚙️ Configuración ComfyUI recibida del frontend:`, comfyUISettings);
            console.log(`🔧 Pasos configurados en frontend: ${comfyUISettings.steps}`);
            console.log(`🎯 Guidance configurado en frontend: ${comfyUISettings.guidance}`);
            console.log(`📐 Resolución configurada: ${comfyUISettings.width}x${comfyUISettings.height}`);
          } else {
            console.log(`⚠️ No se recibió configuración ComfyUI, usando valores por defecto`);
          }
          
          localAIImages = await generateLocalAIImages(imagePrompts, additionalInstructions, folderStructure.sectionDir, section, comfyUISettings);
          
          if (localAIImages.length > 0) {
            console.log(`✅ ${localAIImages.length} imágenes generadas con IA Local exitosamente`);
            
            // Usar los prompts originales como descripción de las imágenes generadas
            enhancedPrompts = localAIImages.map((img, index) => 
              `IA Local ${index + 1}: ${img.prompt || imagePrompts[index] || 'Imagen generada'}`
            );
            
            console.log(`📋 Prompts de IA Local generados:`, enhancedPrompts);
          } else {
            console.log(`⚠️ No se pudieron generar imágenes con IA Local, usando prompts como fallback`);
            enhancedPrompts = imagePrompts.map((prompt, index) => 
              `IA Local prompt ${index + 1}: ${prompt}`
            );
          }
        } catch (error) {
          console.error(`❌ Error generando imágenes con IA Local:`, error.message);
          enhancedPrompts = [`Error generando imágenes con IA Local: ${error.message}`];
        }
      } else {
        console.log(`🎨 Generando prompts para secuencia de ${numImages} imágenes (solo texto)...`);
        
        // Paso 1: Obtener prompts anteriores para mantener consistencia
        console.log(`🧠 Recuperando contexto de prompts anteriores...`);
        const { previousPrompts, contextInfo } = getPreviousImagePrompts(projectKey, section);
        
        // Paso 2: Construir contexto de consistencia
        const consistencyContext = buildConsistencyContext(previousPrompts, contextInfo);
        
        // Paso 3: Construir prompt base para el LLM
        let basePrompt = `Basándote en este guión de la sección ${section} sobre "${topic}": "${cleanScript}", crea EXACTAMENTE ${numImages} prompts detallados para generar ${numImages} imágenes que ilustren visualmente el contenido ESPECÍFICO de esta sección.

          IMPORTANTE: Debes crear EXACTAMENTE ${numImages} prompts, ni más ni menos.

          ENFOQUE ESPECÍFICO PARA ESTA SECCIÓN:
          - Estas imágenes deben representar SOLO el contenido de la sección ${section}, no de todo el proyecto
          - Cada imagen debe mostrar diferentes aspectos, momentos o elementos clave mencionados en esta sección específica
          - NO dividas la sección en partes cronológicas - en su lugar, crea ${numImages} perspectivas diferentes del mismo contenido de la sección
          - Enfócate en elementos específicos, personajes, lugares, objetos, emociones o conceptos mencionados en esta sección
          - Mantén consistencia visual con las secciones anteriores${consistencyContext}

          TIPOS DE PROMPTS PARA ESTA SECCIÓN:
          - Imagen principal: La escena o momento central de la sección
          - Detalles importantes: Objetos, elementos o características específicas mencionadas
          - Perspectivas diferentes: Diferentes ángulos o enfoques del mismo contenido
          - Atmósfera: Imágenes que capturen el mood o ambiente de la sección
          - Elementos secundarios: Aspectos adicionales que complementen la narrativa de esta sección

          INSTRUCCIONES CRÍTICAS PARA EL FORMATO:
          - DEBES crear ${numImages} prompts independientes que representen la MISMA sección desde diferentes perspectivas
          - NO dividas el contenido en secuencia cronológica - todas las imágenes son de la MISMA sección
          - DEBES separar cada prompt con "||PROMPT||" (sin espacios adicionales)
          - DEBES asegurarte de que haya exactamente ${numImages} prompts en tu respuesta
          - Todas las imágenes deben estar relacionadas con el contenido específico de la sección ${section}
          - Incluye detalles específicos mencionados en el texto del guión

          REQUISITOS OBLIGATORIOS para cada prompt:
          - Formato: Aspecto 16:9 (widescreen)
          
          FORMATO DE RESPUESTA OBLIGATORIO:
          DEBES presentar EXACTAMENTE ${numImages} prompts separados por "||PROMPT||" (sin espacios antes o después del delimitador).
          
          ESTRUCTURA REQUERIDA:
          Prompt 1 aquí||PROMPT||Prompt 2 aquí||PROMPT||Prompt 3 aquí||PROMPT||... hasta el Prompt ${numImages}
          
          EJEMPLO PARA 3 PROMPTS (adaptar a ${numImages}):
          Un bosque oscuro con árboles ancianos||PROMPT||Una batalla épica entre guerreros||PROMPT||Un castillo en ruinas bajo la luna
          
          VERIFICACIÓN FINAL: Tu respuesta debe contener exactamente ${numImages - 1} ocurrencias del delimitador "||PROMPT||" para generar ${numImages} prompts.`;
        
        // Paso 4: Integrar instrucciones adicionales en el prompt del LLM
        const finalPromptForLLM = integrateAdditionalInstructions(basePrompt, additionalInstructions);
        
        console.log(`🧠 Creando prompts para secuencia de ${numImages} imágenes con contexto de consistencia...`);
        if (previousPrompts.length > 0) {
          console.log(`🔗 Usando ${previousPrompts.length} prompts anteriores para mantener consistencia`);
        }
        if (additionalInstructions && additionalInstructions.trim()) {
          console.log(`📝 Integrando instrucciones adicionales en el LLM: "${additionalInstructions.trim()}"`);
        }
        
        const promptsResponse = await generateUniversalContent(
          selectedLlmModel,
          finalPromptForLLM,
          `Eres un experto en arte conceptual y narrativa visual. Tu ÚNICA tarea es crear prompts separados por "||PROMPT||". 

REGLAS CRÍTICAS:
1. SIEMPRE usa el delimitador exacto "||PROMPT||" (sin espacios adicionales)
2. NUNCA generes texto adicional fuera de los prompts
3. CUENTA cuidadosamente para generar el número exacto solicitado
4. DIVIDE el contenido equitativamente entre todos los prompts
5. Cada prompt debe ser independiente y descriptivo

Si te piden N prompts, tu respuesta debe tener exactamente (N-1) delimitadores "||PROMPT||".`
        );

        const promptsText = promptsResponse || '';
        console.log(`📝 DEBUG SKIP - Respuesta del modelo: ${promptsText ? promptsText.substring(0, 200) + '...' : 'RESPUESTA VACÍA'}`);
        console.log(`🔍 DEBUG SKIP - Buscando delimitadores "||PROMPT||" en la respuesta...`);
        
        const imagePrompts = promptsText.split('||PROMPT||').filter(p => p.trim()).slice(0, numImages);
        console.log(`🔍 DEBUG SKIP - Delimitadores encontrados: ${promptsText.split('||PROMPT||').length - 1}`);
        console.log(`🔍 DEBUG SKIP - Prompts después del filtro: ${imagePrompts.length}`);
        console.log(`🔢 DEBUG SKIP - Se solicitaron ${numImages} prompts, se generaron ${imagePrompts.length} prompts válidos`);
        console.log(`🎨 DEBUG SKIP - Primeros 3 prompts:`, imagePrompts.slice(0, 3));
        
        // Ya no aplicamos instrucciones adicionales aquí - están integradas en el LLM
        enhancedPrompts = imagePrompts;
        console.log(`✅ Las instrucciones adicionales ya están integradas en los prompts por el LLM`);
      }

      // Guardar los prompts como archivo de texto en la carpeta de la sección
      try {
        const promptsFileName = `${folderStructure.safeTopicName}_seccion_${section}_prompts_imagenes.txt`;
        const promptsFilePath = path.join(folderStructure.sectionDir, promptsFileName);
        
        const promptsContent = `PROMPTS DE IMÁGENES - SECCIÓN ${section}
===============================
Tema: ${topic}
Sección: ${section} de ${sections}
Cantidad de prompts: ${enhancedPrompts.length}
Fecha de generación: ${new Date().toLocaleString()}
${folderName ? `Nombre del proyecto: ${folderName}` : ''}
${additionalInstructions ? `Instrucciones adicionales integradas en LLM: ${additionalInstructions}` : 'Sin instrucciones adicionales'}

PROMPTS GENERADOS:
${enhancedPrompts.map((prompt, index) => `
${index + 1}. ${prompt.trim()}
`).join('')}

===============================
NOTA: Estos prompts fueron generados para ilustrar visualmente 
el contenido del guión pero no se generaron imágenes porque 
la opción "Omitir generación de imágenes" estaba activada.

Puedes usar estos prompts en cualquier generador de imágenes 
como Midjourney, DALL-E, Stable Diffusion, etc.
===============================
Generado automáticamente por el sistema de creación de contenido
`;
        
        fs.writeFileSync(promptsFilePath, promptsContent, 'utf8');
        console.log(`📝 Prompts de imágenes guardados automáticamente en: ${promptsFilePath}`);
        
        // Crear información sobre el archivo de prompts guardado
        const promptsFileRelativePath = path.relative('./public', promptsFilePath).replace(/\\/g, '/');
        
        console.log(`✅ Archivo de prompts creado: ${promptsFileRelativePath}`);
      } catch (saveError) {
        console.error('❌ Error guardando archivo de prompts:', saveError);
        // No detener el proceso por este error, solo registrarlo
      }
      
      // Crear información sobre el archivo de guión guardado
      const scriptFileName = `${folderStructure.safeTopicName}_seccion_${section}_guion.txt`;
      const scriptFilePath = path.relative('./public', path.join(folderStructure.sectionDir, scriptFileName)).replace(/\\/g, '/');

      // Crear información sobre el archivo de prompts guardado
      const promptsFileName = `${folderStructure.safeTopicName}_seccion_${section}_prompts_imagenes.txt`;
      const promptsFilePath = path.relative('./public', path.join(folderStructure.sectionDir, promptsFileName)).replace(/\\/g, '/');

      console.log(`🔍 DEBUG SKIP - Enviando respuesta con imagePrompts:`, !!enhancedPrompts);
      console.log(`🔍 DEBUG SKIP - imagePrompts.length:`, enhancedPrompts.length);
      console.log(`🔍 DEBUG SKIP - imagesSkipped:`, shouldSkipImages && !shouldUseGoogleImages);
      console.log(`🔍 DEBUG BING - bingImagesMode:`, shouldUseGoogleImages);
      console.log(`🔍 DEBUG BING - downloadedImages.length:`, downloadedImages.length);

      // Construir respuesta según el modo
      const response = { 
        script: cleanScript,
        scriptFile: {
          path: scriptFilePath,
          filename: scriptFileName,
          saved: true
        },
        promptsFile: {
          path: promptsFilePath,
          filename: promptsFileName,
          saved: true
        },
        voice: selectedVoice,
        currentSection: section,
        totalSections: sections,
        topic: topic,
        isComplete: section >= sections,
        projectFolder: folderStructure.safeTopicName,
        sectionFolder: `seccion_${section}`,
        folderPath: path.relative('./public', folderStructure.sectionDir).replace(/\\/g, '/'),
        chapterStructure: chapterStructure,
        tokenUsage: {
          inputTokens: inputTokens,
          outputTokens: outputTokens,
          totalTokens: totalTokens,
          model: selectedLlmModel
        }
      };

      // Agregar datos específicos según el modo
      if (shouldUseLocalAI) {
        // Modo IA Local: incluir imágenes generadas
        const localImages = localAIImages ? localAIImages.filter(img => img.path) : []; // Solo imágenes exitosas
        
        response.localAIImages = localImages.map(img => ({
          url: `/${img.path}`,
          caption: `IA Local: ${img.filename ? img.filename.replace(/\.[^/.]+$/, '') : 'Imagen generada'}`,
          filename: img.filename,
          path: img.path,
          prompt: img.prompt
        }));
        response.localAIMode = true;
        response.imagesGenerated = localImages.length;
        response.mode = 'local_ai';
        response.imagePrompts = enhancedPrompts;
        console.log(`🤖 Respuesta configurada para modo IA Local con ${localImages.length} imágenes generadas`);
        
      } else if (shouldUseGoogleImages && downloadedImages.length > 0) {
        // Modo Bing Images: filtrar solo imágenes exitosas que realmente existen
        const existingImages = downloadedImages.filter(img => {
          // Si la imagen fue marcada como fallida, no incluirla
          if (img.failed) {
            console.log(`⚠️ Imagen marcada como fallida, excluyendo: ${img.filename} (${img.keywords})`);
            return false;
          }
          
          const imagePath = path.join('./public', 'outputs', folderStructure.safeTopicName, `seccion_${section}`, img.filename);
          const exists = fs.existsSync(imagePath);
          if (!exists) {
            console.log(`⚠️ Archivo no encontrado, excluyendo de respuesta: ${img.filename}`);
          }
          return exists;
        });
        
        // Crear arrays de keywords solo para imágenes exitosas para mantener correspondencia
        const successfulKeywords = existingImages.map(img => img.keywords);
        
        response.downloadedImages = existingImages.map(img => ({
          url: `/outputs/${folderStructure.safeTopicName}/seccion_${section}/${img.filename}`,
          caption: `Imagen de Bing: ${img.filename.replace(/\.[^/.]+$/, '')}`,
          filename: img.filename,
          path: img.path
        }));
        response.bingImagesMode = true;
        response.imagesDownloaded = existingImages.length;
        response.mode = 'bing_images';
        console.log(`✅ Respuesta configurada para modo Bing con ${existingImages.length} imágenes (${downloadedImages.length} descargadas, ${existingImages.length} existentes)`);
        
        // Usar keywords directamente de las imágenes exitosas (ya filtradas)
        response.imageKeywords = successfulKeywords;
        console.log(`🎯 Keywords incluidas en respuesta (solo existentes):`, successfulKeywords);
        console.log(`🖼️ URLs de imágenes:`, response.downloadedImages.map(img => img.url));
      } else if (shouldUseGoogleImages) {
        // Fallback si no se descargaron imágenes de Bing
        response.imagePrompts = enhancedPrompts;
        response.bingImagesMode = true;
        response.bingImagesFailed = true;
        response.mode = 'bing_fallback';
        // Incluir las keywords para el botón de refresh
        if (imageKeywords && imageKeywords.length > 0) {
          response.imageKeywords = imageKeywords;
          console.log(`🎯 Keywords incluidas en respuesta fallback:`, imageKeywords);
        }
        console.log(`⚠️ Modo Bing falló, usando prompts como fallback`);
      } else {
        // Modo skip images normal
        response.imagePrompts = enhancedPrompts;
        response.imagesSkipped = shouldSkipImages;
        response.mode = 'skip_images';
        console.log(`📝 Modo skip images con ${enhancedPrompts.length} prompts`);
      }

      res.json(response);

      console.log(`🚨 RESPUESTA FINAL ENVIADA AL FRONTEND:`);
      console.log(`🚨 response.downloadedImages:`, response.downloadedImages);
      console.log(`🚨 response.bingImagesMode:`, response.bingImagesMode);
      console.log(`🚨 response.mode:`, response.mode);
      console.log(`🚨 Respuesta completa:`, JSON.stringify(response, null, 2));

      // Guardar estado del proyecto automáticamente
      try {
        const projectData = {
          topic: topic,
          folderName: folderName,
          totalSections: sections,
          currentSection: section,
          voice: selectedVoice,
          imageModel: selectedImageModel,
          llmModel: selectedLlmModel,
          scriptStyle: scriptStyle,
          customStyleInstructions: customStyleInstructions,
          promptModifier: promptModifier,
          imageCount: imageCount,
          skipImages: shouldSkipImages,
          googleImages: shouldUseGoogleImages,
          applioVoice: applioVoice,
          applioModel: applioModel || 'fr-FR-RemyMultilingualNeural',
          applioPitch: applioPitch || 0,
          chapterStructure: chapterStructure
        };
        
        const savedState = saveProjectState(projectData);
        
        if (savedState) {
          // Actualizar sección completada
          const sectionData = {
            script: cleanScript,
            images: [], // Sin imágenes en este modo
            imagesSkipped: shouldSkipImages && !shouldUseGoogleImages,
            googleImagesMode: shouldUseGoogleImages,
            imagePrompts: enhancedPrompts,
            scriptFile: {
              path: scriptFilePath,
              filename: scriptFileName,
              saved: true
            },
            promptsFile: {
              path: promptsFilePath,
              filename: promptsFileName,
              saved: true
            }
          };
          
          updateCompletedSection(projectData, section, sectionData);
          console.log(`💾 Estado del proyecto guardado automáticamente`);
        }
      } catch (saveError) {
        console.error('⚠️ Error guardando estado del proyecto:', saveError);
        // No detener el proceso por este error
      }
      return;
    }

    // Paso 2: Crear prompts para imágenes secuenciales basadas en el guión
    console.log(`🎨 Generando prompts para secuencia de ${numImages} imágenes...`);
    
    // Obtener prompts anteriores para mantener consistencia
    console.log(`🧠 Recuperando contexto de prompts anteriores...`);
    const { previousPrompts, contextInfo } = getPreviousImagePrompts(projectKey, section);
    
    // Construir contexto de consistencia
    const consistencyContext = buildConsistencyContext(previousPrompts, contextInfo);
    
    // Construir prompt base para el LLM
    let basePrompt = `Basándote en este guión de la sección ${section} sobre "${topic}" ": "${cleanScript}", crea EXACTAMENTE ${numImages} prompts detallados para generar ${numImages} imágenes que ilustren visualmente el contenido ESPECÍFICO de esta sección.

      IMPORTANTE: Debes crear EXACTAMENTE ${numImages} prompts, ni más ni menos.

      ENFOQUE ESPECÍFICO PARA ESTA SECCIÓN:
      - Estas imágenes deben representar SOLO el contenido de la sección ${section}, no de todo el proyecto
      - Cada imagen debe mostrar diferentes aspectos, momentos o elementos clave mencionados en esta sección específica
      - NO dividas la sección en partes cronológicas - en su lugar, crea ${numImages} perspectivas diferentes del mismo contenido de la sección
      - Enfócate en elementos específicos, personajes, lugares, objetos, emociones o conceptos mencionados en esta sección
      - Mantén consistencia visual con las secciones anteriores${consistencyContext}

      TIPOS DE PROMPTS PARA ESTA SECCIÓN:
      - Imagen principal: La escena o momento central de la sección
      - Detalles importantes: Objetos, elementos o características específicas mencionadas
      - Perspectivas diferentes: Diferentes ángulos o enfoques del mismo contenido
      - Atmósfera: Imágenes que capturen el mood o ambiente de la sección
      - Elementos secundarios: Aspectos adicionales que complementen la narrativa de esta sección

      INSTRUCCIONES CRÍTICAS PARA EL FORMATO:
      - DEBES crear ${numImages} prompts independientes que representen la MISMA sección desde diferentes perspectivas
      - NO dividas el contenido en secuencia cronológica - todas las imágenes son de la MISMA sección
      - DEBES separar cada prompt con "||PROMPT||" (sin espacios adicionales)
      - DEBES asegurarte de que haya exactamente ${numImages} prompts en tu respuesta
      - Todas las imágenes deben estar relacionadas con el contenido específico de la sección ${section}
      - Incluye detalles específicos mencionados en el texto del guión de esta sección

      REQUISITOS OBLIGATORIOS para cada prompt:
      - Formato: Aspecto 16:9 (widescreen)
      
      FORMATO DE RESPUESTA OBLIGATORIO:
      DEBES presentar EXACTAMENTE ${numImages} prompts separados por "||PROMPT||" (sin espacios antes o después del delimitador).
      
      ESTRUCTURA REQUERIDA:
      Prompt 1 aquí||PROMPT||Prompt 2 aquí||PROMPT||Prompt 3 aquí||PROMPT||... hasta el Prompt ${numImages}
      
      EJEMPLO PARA 3 PROMPTS (adaptar a ${numImages}):
      Un bosque oscuro con árboles ancianos||PROMPT||Una batalla épica entre guerreros||PROMPT||Un castillo en ruinas bajo la luna
      
      VERIFICACIÓN FINAL: Tu respuesta debe contener exactamente ${numImages - 1} ocurrencias del delimitador "||PROMPT||" para generar ${numImages} prompts.`;
    
    // Integrar instrucciones adicionales en el prompt del LLM
    const finalPromptForLLM = integrateAdditionalInstructions(basePrompt, additionalInstructions);
    
    console.log(`🧠 Creando prompts para secuencia de ${numImages} imágenes con contexto de consistencia...`);
    if (previousPrompts.length > 0) {
      console.log(`🔗 Usando ${previousPrompts.length} prompts anteriores para mantener consistencia`);
    }
    if (additionalInstructions && additionalInstructions.trim()) {
      console.log(`📝 Integrando instrucciones adicionales en el LLM: "${additionalInstructions.trim()}"`);
    }
    
    const promptsResponse = await ai.models.generateContent({
      model: `models/${selectedLlmModel}`,
      contents: finalPromptForLLM,
      config: {
        systemInstruction: `Eres un experto en arte conceptual y narrativa visual. Tu ÚNICA tarea es crear prompts separados por "||PROMPT||". 

REGLAS CRÍTICAS:
1. SIEMPRE usa el delimitador exacto "||PROMPT||" (sin espacios adicionales)
2. NUNCA generes texto adicional fuera de los prompts
3. CUENTA cuidadosamente para generar el número exacto solicitado
4. DIVIDE el contenido equitativamente entre todos los prompts
5. Cada prompt debe ser independiente y descriptivo

Si te piden N prompts, tu respuesta debe tener exactamente (N-1) delimitadores "||PROMPT||".`,
      },
    });

    const promptsText = promptsResponse.text || '';
    console.log(`📝 Respuesta del modelo: ${promptsText ? promptsText.substring(0, 200) + '...' : 'RESPUESTA VACÍA'}`);
    console.log(`🔍 Buscando delimitadores "||PROMPT||" en la respuesta...`);
    
    const imagePrompts = promptsText.split('||PROMPT||').filter(p => p.trim()).slice(0, numImages);
    console.log(`🔍 Delimitadores encontrados: ${promptsText.split('||PROMPT||').length - 1}`);
    console.log(`🔍 Prompts después del filtro: ${imagePrompts.length}`);
    console.log(`🔢 Se solicitaron ${numImages} imágenes, se encontraron ${imagePrompts.length} prompts válidos`);
    
    console.log(`🎨 ${imagePrompts.length} prompts secuenciales generados para la sección ${section}`);

    // Paso 3: Generar las imágenes secuenciales y guardarlas
    console.log(`🖼️ Generando secuencia de ${numImages} imágenes...`);
    const imagePromises = imagePrompts.map(async (prompt, index) => {
      try {
        console.log(`🖼️ Generando imagen ${index + 1}/${numImages}...`);
        console.log(`📋 Prompt para imagen ${index + 1}: ${prompt.trim().substring(0, 100)}...`);
        
        // Usar el prompt directamente ya que las instrucciones adicionales están integradas en el LLM
        const enhancedPrompt = prompt.trim();
        console.log(`✅ Las instrucciones adicionales ya están integradas en el prompt por el LLM`);
        
        console.log(`📝 Prompt completo para imagen ${index + 1}: ${enhancedPrompt}`);
        console.log(`🤖 Usando modelo: ${selectedImageModel === 'gemini2' ? 'Gemini 2.0 Flash (nativo)' : 'Imagen 4.0'}`);

        const imageResponse = await generateImageWithModel(ai, enhancedPrompt, selectedImageModel);

        if (imageResponse.generatedImages && imageResponse.generatedImages.length > 0) {
          const results = [];
          
          // Procesar las imágenes generadas
          for (let varIndex = 0; varIndex < imageResponse.generatedImages.length; varIndex++) {
            const generatedImage = imageResponse.generatedImages[varIndex];
            const imageData = generatedImage.image.imageBytes;
            
            // Guardar imagen con nombre único
            const imageFileName = `${folderStructure.safeTopicName}_seccion_${section}_imagen_${index + 1}_${Date.now()}.png`;
            const imageFilePath = path.join(folderStructure.sectionDir, imageFileName);
            const imageBuffer = Buffer.from(imageData, 'base64');
            
            fs.writeFileSync(imageFilePath, imageBuffer);
            console.log(`💾 Imagen ${index + 1} guardada en: ${imageFilePath}`);
            console.log(`🤖 Generada con: ${selectedImageModel === 'gemini2' ? 'Gemini 2.0 Flash' : 'Imagen 4.0'}`);
            
            // Retornar ruta relativa para acceso web
            const relativePath = path.relative('./public', imageFilePath).replace(/\\/g, '/');
            
            results.push({ 
              index: index,
              originalPromptIndex: index,
              variationIndex: varIndex,
              image: imageData,
              imagePath: relativePath,
              prompt: enhancedPrompt,
              model: selectedImageModel === 'gemini2' ? 'Gemini 2.0 Flash' : 'Imagen 4.0'
            });
          }
          
          return results;
        }
        return null;
      } catch (error) {
        console.error(`❌ Error generando imagen ${index + 1}:`, error);
        return null;
      }
    });

    const imageResults = await Promise.all(imagePromises);
    // Aplanar el array ya que cada prompt ahora devuelve un array de 3 imágenes
    const allImages = imageResults.filter(result => result !== null).flat();

    if (allImages.length === 0) {
      return res.status(500).json({ error: 'No se pudo generar ninguna imagen' });
    }

    console.log(`✅ ${allImages.length} imágenes generadas (${imagePrompts.length} prompts × 3 variaciones cada uno) para la sección ${section}`);

    // Crear información sobre el archivo de guión guardado
    const scriptFileName = `${folderStructure.safeTopicName}_seccion_${section}_guion.txt`;
    const scriptFilePath = path.relative('./public', path.join(folderStructure.sectionDir, scriptFileName)).replace(/\\/g, '/');

    res.json({ 
      images: allImages,
      script: cleanScript,
      scriptFile: {
        path: scriptFilePath,
        filename: scriptFileName,
        saved: true
      },
      imagePrompts: imagePrompts,
      voice: selectedVoice,
      sequenceType: 'chronological',
      currentSection: section,
      totalSections: sections,
      topic: topic,
      isComplete: section >= sections,
      projectFolder: folderStructure.safeTopicName,
      sectionFolder: `seccion_${section}`,
      folderPath: path.relative('./public', folderStructure.sectionDir).replace(/\\/g, '/'),
      chapterStructure: chapterStructure
    });

    // Guardar estado del proyecto automáticamente
    try {
      const projectData = {
        topic: topic,
        folderName: folderName,
        totalSections: sections,
        currentSection: section,
        voice: selectedVoice,
        imageModel: selectedImageModel,
        llmModel: selectedLlmModel,
        scriptStyle: scriptStyle,
        customStyleInstructions: customStyleInstructions,
        promptModifier: promptModifier,
        imageCount: imageCount,
        skipImages: shouldSkipImages,
        googleImages: shouldUseGoogleImages,
        chapterStructure: chapterStructure
      };
      
      const savedState = saveProjectState(projectData);
      
      if (savedState) {
        // Actualizar sección completada
        const sectionData = {
          script: cleanScript,
          images: allImages,
          imagesSkipped: false,
          googleImagesMode: false,
          imagePrompts: imagePrompts,
          scriptFile: {
            path: scriptFilePath,
            filename: scriptFileName,
            saved: true
          }
        };
        
        updateCompletedSection(projectData, section, sectionData);
        console.log(`💾 Estado del proyecto guardado automáticamente`);
      }
    } catch (saveError) {
      console.error('⚠️ Error guardando estado del proyecto:', saveError);
      // No detener el proceso por este error
    }
  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({ error: 'Error generando contenido' });
  }
});

// RUTA COMENTADA - Ahora usamos el cliente Applio directo en Node.js
/*
// Nueva ruta simple para generar audio TTS (compatible con applio_tts)
app.post('/applio_tts', async (req, res) => {
  try {
    const { text, sectionDir } = req.body;
    
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Texto requerido para generar audio' });
    }

    console.log(`🎵 Intentando TTS para texto: ${text.substring(0, 100)}...`);
    
    // Intentar primero con servidor Applio externo si está disponible
    const APPLIO_URL = process.env.APPLIO_SERVER_URL || "http://localhost:5004";
    
    try {
      console.log(`🔗 Intentando conexión con servidor Applio en ${APPLIO_URL}...`);
      const applioResponse = await fetch(`${APPLIO_URL}/applio_tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        timeout: 5000 // 5 segundos timeout
      });
      
      if (applioResponse.ok) {
        console.log(`✅ Servidor Applio respondió exitosamente`);
        // Reenviar la respuesta del servidor Applio
        const audioBuffer = await applioResponse.buffer();
        res.setHeader('Content-Type', 'audio/wav');
        res.setHeader('Content-Length', audioBuffer.length);
        return res.send(audioBuffer);
      }
    } catch (applioError) {
      console.log(`⚠️ Servidor Applio no disponible: ${applioError.message}`);
      console.log(`🔄 Intentando con Gemini TTS como fallback...`);
    }
    
    // Fallback a Gemini TTS
    const response = await ai.models.generateContent({
      model: "gemini-2.5-pro-preview-tts",
      contents: [{ 
        parts: [{ 
          text: `Narra el siguiente texto de manera natural y clara: ${text}`
        }] 
      }],
      config: {
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

    const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    
    if (!audioData) {
      throw new Error('No se pudo generar el audio con Gemini TTS');
    }

    const audioBuffer = Buffer.from(audioData, 'base64');
    
    // Configurar headers para audio streaming
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Length', audioBuffer.length);
    
    // Enviar el audio directamente como stream
    res.send(audioBuffer);
    
  } catch (error) {
    console.error('❌ Error en TTS:', error);
    
    // Mensaje más específico basado en el tipo de error
    let errorMessage = 'Error generando audio TTS';
    if (error.status === 429) {
      errorMessage = 'Cuota de TTS excedida. Intenta nuevamente en unos minutos o configura servidor Applio.';
    }
    
    res.status(500).json({ error: errorMessage });
  }
});
*/

// Nueva ruta para generar solo el audio del guión
app.post('/generate-audio', async (req, res) => {
  try {
    const { script, voice, topic, folderName, currentSection, narrationStyle } = req.body;
    
    if (!topic || !currentSection) {
      return res.status(400).json({ error: 'Tema y sección requeridos para organizar archivos' });
    }

    const selectedVoice = voice || 'Orus';
    const section = currentSection || 1;
    const customNarrationStyle = narrationStyle || null;
    
    // Crear nombre normalizado consistente
    const actualFolderName = folderName && folderName.trim() 
      ? createSafeFolderName(folderName.trim())
      : createSafeFolderName(topic);
    
    // Si no se proporciona script, intentar leerlo del archivo guardado
    let scriptContent = script;
    if (!scriptContent) {
      console.log(`🔍 Script no proporcionado, intentando leer archivo de sección ${section}...`);
      
      try {
        const folderStructure = createProjectStructure(topic, section, actualFolderName);
        const scriptFileName = `${actualFolderName}_seccion_${section}_guion.txt`;
        const scriptFilePath = path.join(folderStructure.sectionDir, scriptFileName);
        
        if (fs.existsSync(scriptFilePath)) {
          scriptContent = fs.readFileSync(scriptFilePath, 'utf8');
          console.log(`✅ Script leído desde archivo: ${scriptFilePath}`);
        } else {
          return res.status(400).json({ error: `No se encontró el guión para la sección ${section}. Archivo esperado: ${scriptFilePath}` });
        }
      } catch (readError) {
        console.error('❌ Error leyendo archivo de script:', readError);
        return res.status(400).json({ error: 'No se pudo leer el guión de la sección. Asegúrate de que el guión se haya generado primero.' });
      }
    }
    
    if (!scriptContent || scriptContent.trim() === '') {
      return res.status(400).json({ error: 'Guión vacío o no válido' });
    }
    
    // Crear estructura de carpetas para el audio usando el nombre normalizado
    const folderStructure = createProjectStructure(topic, section, actualFolderName);
    
    console.log(`🎵 Generando audio del guión con voz ${selectedVoice}...`);
    if (customNarrationStyle) {
      console.log(`🎭 Estilo de narración personalizado recibido: "${customNarrationStyle}"`);
    }
    
    try {
      const audioFilePath = await generateStoryAudio(scriptContent, selectedVoice, folderStructure.sectionDir, topic, section, customNarrationStyle);
      
      res.json({ 
        success: true,
        audio: audioFilePath,
        voice: selectedVoice,
        projectFolder: folderStructure.safeTopicName,
        sectionFolder: `seccion_${section}`
      });
    } catch (audioError) {
      console.error('❌ Error específico en generación de audio:', audioError.message);
      
      // Responder con información más específica sobre el error
      res.status(500).json({ 
        error: 'Error generando audio',
        details: audioError.message,
        suggestion: 'El servicio de Text-to-Speech puede estar temporalmente no disponible. Intenta nuevamente en unos momentos.'
      });
    }
  } catch (error) {
    console.error('❌ Error general en endpoint de audio:', error);
    res.status(500).json({ error: 'Error procesando solicitud de audio' });
  }
});

// Nueva ruta para regenerar una imagen específica
app.post('/regenerate-image', async (req, res) => {
  try {
    const { prompt, imageIndex, topic, folderName, currentSection, imageModel } = req.body;
    
    if (!prompt || typeof imageIndex !== 'number') {
      return res.status(400).json({ error: 'Prompt e índice de imagen requeridos' });
    }

    if (!topic || !currentSection) {
      return res.status(400).json({ error: 'Tema y sección requeridos para organizar archivos' });
    }

    const selectedImageModel = 'gemini2'; // TEMPORAL: Forzar Gemini 2.0 para depuración
    console.log(`🔄 Regenerando imagen ${imageIndex + 1} con nuevo prompt...`);
    console.log(`🤖 Forzando uso de Gemini 2.0 Flash para depuración...`);
    console.log(`🔍 Modelo recibido del frontend: ${imageModel}`);
    console.log(`🔍 Modelo que se usará: ${selectedImageModel}`);
    
    // Crear estructura de carpetas
    const folderStructure = createProjectStructure(topic, currentSection, folderName);
    
    try {
      console.log(`🔍 DEBUG REGENERACION - Iniciando proceso de regeneración...`);
      console.log(`🔍 DEBUG REGENERACION - Prompt recibido: ${prompt.substring(0, 50)}...`);
      
      // Agregar especificaciones de estilo oscuro 2D al prompt
      const enhancedPrompt = `${prompt.trim()}. `;
      console.log(`🔍 DEBUG REGENERACION - Enhanced prompt: ${enhancedPrompt.substring(0, 50)}...`);
      console.log(`🔍 DEBUG REGENERACION - Llamando a generateImageWithModel con modelo: ${selectedImageModel}`);

      const imageResponse = await generateImageWithModel(ai, enhancedPrompt, selectedImageModel);
      console.log(`🔍 DEBUG REGENERACION - Respuesta recibida:`, !!imageResponse);

      if (imageResponse.generatedImages && imageResponse.generatedImages.length > 0) {
        const regeneratedImages = [];
        
        // Procesar las imágenes generadas
        for (let varIndex = 0; varIndex < imageResponse.generatedImages.length; varIndex++) {
          const generatedImage = imageResponse.generatedImages[varIndex];
          const imageData = generatedImage.image.imageBytes;
          
          // Guardar imagen regenerada con un nombre único
          const timestamp = Date.now();
          const imageFileName = `${folderStructure.safeTopicName}_seccion_${currentSection}_imagen_${imageIndex + 1}_regenerated_${timestamp}.png`;
          const imageFilePath = path.join(folderStructure.sectionDir, imageFileName);
          const imageBuffer = Buffer.from(imageData, 'base64');
          
          fs.writeFileSync(imageFilePath, imageBuffer);
          console.log(`💾 Imagen regenerada ${imageIndex + 1} guardada en: ${imageFilePath}`);
          console.log(`🤖 Regenerada con: ${selectedImageModel === 'gemini2' ? 'Gemini 2.0 Flash' : 'Imagen 4.0'}`);
          
          // Retornar ruta relativa para acceso web
          const relativePath = path.relative('./public', imageFilePath).replace(/\\/g, '/');
          
          regeneratedImages.push({
            image: imageData,
            imagePath: relativePath,
            variationIndex: varIndex,
            model: selectedImageModel === 'gemini2' ? 'Gemini 2.0 Flash' : 'Imagen 4.0'
          });
        }
        
        res.json({ 
          success: true,
          images: regeneratedImages,
          prompt: enhancedPrompt,
          imageIndex: imageIndex,
          model: selectedImageModel === 'gemini2' ? 'Gemini 2.0 Flash' : 'Imagen 4.0'
        });
        return;
      }
      
      res.status(500).json({ error: 'No se pudo regenerar la imagen' });
      
    } catch (error) {
      console.error('❌ Error regenerando imagen:', error.message);
      res.status(500).json({ 
        error: 'Error regenerando imagen',
        details: error.message
      });
    }
  } catch (error) {
    console.error('❌ Error general en endpoint de regenerar imagen:', error);
    res.status(500).json({ error: 'Error procesando solicitud de regeneración' });
  }
});

// Nuevo endpoint para generar imagen con ComfyUI + Flux
app.post('/generate-comfyui-image', async (req, res) => {
  try {
    const { prompt, options = {} } = req.body;
    
    if (!prompt) {
      return res.status(400).json({ error: 'Prompt es requerido' });
    }

    console.log(`🎨 [PRUEBA COMFYUI] Generando imagen: "${prompt.substring(0, 50)}..."`);
    console.log(`📊 [PRUEBA COMFYUI] Opciones recibidas del frontend:`, options);
    
    try {
      // Configurar opciones (usar las del frontend si están disponibles)
      const comfyOptions = {
        width: parseInt(options.width) || 1280,
        height: parseInt(options.height) || 720,
        steps: parseInt(options.steps) || 25,
        cfg: options.cfg || 1,
        guidance: parseFloat(options.guidance) || 3.5,
        sampler: options.sampler || "euler",
        scheduler: options.scheduler || "simple",
        model: options.model || "flux1-dev-fp8.safetensors",
        negativePrompt: options.negativePrompt || "low quality, blurry, distorted",
        timeout: Math.max(180, parseInt(options.steps) * 6) || 180
      };
      
      console.log(`⚙️ [PRUEBA COMFYUI] Configuración final que se enviará a ComfyUI:`, {
        resolution: `${comfyOptions.width}x${comfyOptions.height}`,
        steps: comfyOptions.steps,
        guidance: comfyOptions.guidance,
        sampler: comfyOptions.sampler,
        scheduler: comfyOptions.scheduler,
        timeout: comfyOptions.timeout
      });
      
      console.log(`🚀 [PRUEBA COMFYUI] Iniciando generación con ${comfyOptions.steps} pasos...`);
      
      // Generar imagen con ComfyUI usando reinicio automático
      const result = await generateImageWithAutoRestart(prompt, comfyOptions);
      
      if (result.success) {
        res.json({
          success: true,
          imageUrl: result.imageUrl,
          filename: result.filename,
          promptId: result.promptId,
          prompt: prompt,
          options: comfyOptions
        });
      } else {
        res.status(500).json({
          error: 'Error generando imagen con ComfyUI',
          details: result.error || 'Error desconocido'
        });
      }
      
    } catch (error) {
      console.error('❌ Error en generación ComfyUI:', error.message);
      res.status(500).json({
        error: 'Error interno generando imagen',
        details: error.message
      });
    }
  } catch (error) {
    console.error('❌ Error general en endpoint ComfyUI:', error);
    res.status(500).json({ error: 'Error procesando solicitud de ComfyUI' });
  }
});

// Endpoint para verificar estado de ComfyUI
app.get('/comfyui-status', async (req, res) => {
  try {
    const connectionCheck = await comfyUIClient.checkConnection();
    
    if (connectionCheck.success) {
      const modelsInfo = await comfyUIClient.getAvailableModels();
      res.json({
        success: true,
        connected: true,
        stats: connectionCheck.data,
        models: modelsInfo.success ? modelsInfo.models : [],
        fluxAvailable: modelsInfo.success ? modelsInfo.models.includes('flux1-dev-fp8.safetensors') : false
      });
    } else {
      res.json({
        success: false,
        connected: false,
        error: connectionCheck.error
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      connected: false,
      error: error.message
    });
  }
});

// Nueva ruta para generar audio de sección específica usando cliente Applio Node.js
app.post('/generate-section-audio', async (req, res) => {
  try {
    const { script, topic, folderName, currentSection, voice, applioVoice, applioModel, applioPitch } = req.body;
    
    if (!script || !topic || !currentSection) {
      return res.status(400).json({ 
        error: 'Script, tema y número de sección son requeridos' 
      });
    }

    const section = parseInt(currentSection);
    const selectedApplioVoice = applioVoice || "logs\\VOCES\\RemyOriginal.pth";
    const selectedApplioModel = applioModel || "fr-FR-RemyMultilingualNeural";
    const selectedPitch = parseInt(applioPitch) || 0;
    
    // Crear nombre normalizado consistente
    const actualFolderName = folderName && folderName.trim() 
      ? createSafeFolderName(folderName.trim())
      : createSafeFolderName(topic);
    
    // Crear estructura de carpetas usando el nombre normalizado
    const folderStructure = createProjectStructure(topic, section, actualFolderName);
    
    console.log(`🎵 Generando audio con Applio para sección ${section}...`);
    console.log(`🎤 Voz de Applio seleccionada: ${selectedApplioVoice}`);
    console.log(`🎛️ Modelo TTS seleccionado: ${selectedApplioModel}`);
    console.log(`🎵 Pitch seleccionado: ${selectedPitch}`);
    
    try {
      // 1. Iniciar Applio automáticamente
      console.log('🚀 [DEBUG] Iniciando Applio para la sección...');
      console.log('🔍 [DEBUG] Estado antes de startApplio:', {
        applioStarted: applioStarted,
        section: section
      });
      
      const applioStartResult = await startApplio();
      if (!applioStartResult) {
        throw new Error('No se pudo iniciar Applio automáticamente');
      }
      
      console.log('🔍 [DEBUG] startApplio completado exitosamente');
      
      // 2. Verificar conexión con Applio (ya debería estar listo por startApplio)
      const isConnected = await applioClient.checkConnection();
      if (!isConnected) {
        throw new Error('Applio no está disponible en el puerto 6969');
      }
      
      console.log('✅ Applio iniciado y listo para generar audio');
      console.log('🔍 [DEBUG] Estado después de verificación:', {
        applioStarted: applioStarted,
        connected: isConnected
      });
      
      // Crear nombre del archivo usando el nombre normalizado consistente
      const fileName = `${actualFolderName}_seccion_${section}_applio_${Date.now()}.wav`;
      const filePath = path.join(folderStructure.sectionDir, fileName);
      
      console.log(`📁 Guardando audio en: ${filePath}`);
      
      // Generar audio con Applio
      const result = await applioClient.textToSpeech(script, filePath, {
        model: selectedApplioModel,
        speed: 0,
        pitch: selectedPitch,
        voicePath: selectedApplioVoice
      });
      
      if (!result.success) {
        throw new Error('Applio no generó el audio correctamente');
      }
      
      console.log(`✅ Audio Applio generado exitosamente: ${filePath}`);
      console.log(`📊 Tamaño del archivo: ${(result.size / 1024).toFixed(1)} KB`);
      
      // Applio permanece abierto para futuras generaciones
      console.log('ℹ️ Applio permanece abierto para futuras generaciones de audio');
      console.log('🔍 [DEBUG] Audio generado, estado de Applio:', {
        applioStarted: applioStarted,
        section: section,
        timestamp: new Date().toISOString()
      });
      
      // Retornar la ruta relativa para acceso web
      const relativePath = path.relative('./public', filePath).replace(/\\/g, '/');
      
      res.json({ 
        success: true,
        audioFile: relativePath,
        method: 'Applio Node.js',
        section: section,
        size: result.size,
        message: `Audio generado con Applio para la sección ${section}`,
        applioStatus: 'permanece_abierto'
      });
      
      console.log('🔍 [DEBUG] Respuesta enviada, Applio sigue disponible');
      
    } catch (applioError) {
      console.error('❌ Error con cliente Applio:', applioError);
      console.log('🔍 [DEBUG] Error en generación, estado de Applio:', {
        applioStarted: applioStarted,
        error: applioError.message
      });
      
      // No cerrar Applio en caso de error, solo registrar el error
      console.log('⚠️ Error generando audio, pero Applio permanece abierto para reintentarlo');
      
      if (applioError.message.includes('6969') || applioError.message.includes('Timeout')) {
        res.status(503).json({ 
          error: 'Applio no disponible',
          details: 'Asegúrate de que Applio esté corriendo en el puerto 6969',
          suggestion: 'Abre la interfaz de Applio y verifica que esté en el puerto 6969'
        });
      } else {
        res.status(500).json({ 
          error: 'Error generando audio con Applio',
          details: applioError.message
        });
      }
    }
    
  } catch (error) {
    console.error('❌ Error general:', error);
    res.status(500).json({ error: 'Error procesando solicitud' });
  }
});

// Ruta para subir archivo para transcripción
app.post('/upload-audio', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se recibió ningún archivo' });
    }

    console.log(`📁 Archivo subido: ${req.file.filename}`);
    res.json({ 
      success: true, 
      filePath: req.file.path,
      originalName: req.file.originalname 
    });
    
  } catch (error) {
    console.error('❌ Error subiendo archivo:', error);
    res.status(500).json({ error: 'Error subiendo archivo: ' + error.message });
  }
});

// Ruta para obtener pistas de audio de un archivo
app.post('/get-audio-tracks', async (req, res) => {
  try {
    const { filePath } = req.body;
    
    if (!filePath) {
      return res.status(400).json({ error: 'Ruta del archivo requerida' });
    }

    console.log(`🎵 Obteniendo pistas de audio de: ${filePath}`);
    const tracks = await getAudioTracks(filePath);
    
    res.json({ tracks });
  } catch (error) {
    console.error('❌ Error obteniendo pistas de audio:', error);
    res.status(500).json({ error: 'Error obteniendo pistas de audio: ' + error.message });
  }
});

// Ruta para transcribir audio/video con Whisper LOCAL
app.post('/transcribe-audio-local', async (req, res) => {
  try {
    const { filePath, audioTrackIndex, modelSize = 'medium', language } = req.body;
    
    if (!filePath) {
      return res.status(400).json({ error: 'Ruta del archivo requerida' });
    }

    console.log(`🎤 Iniciando transcripción LOCAL de: ${filePath}`);
    console.log(`🔧 Modelo: ${modelSize} | Idioma: ${language || 'auto-detectar'}`);
    if (audioTrackIndex !== undefined) {
      console.log(`📡 Usando pista de audio: ${audioTrackIndex}`);
    }

    // Importar dinámicamente el módulo local de Python
    const { spawn } = await import('child_process');
    
    // Crear script Python temporal para la transcripción
    const pythonScript = `
# -*- coding: utf-8 -*-
import sys
import json
import os
import subprocess
import tempfile
import shutil
from pathlib import Path

# Configurar codificación UTF-8 para Windows
if sys.platform == 'win32':
    import codecs
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.detach())
    sys.stderr = codecs.getwriter('utf-8')(sys.stderr.detach())

sys.path.append('${process.cwd().replace(/\\/g, '/')}')

from whisper_local import whisper_local

def extract_audio_from_mp4(input_path, output_path, track_index=None):
    """Extrae audio de MP4 usando FFmpeg"""
    try:
        cmd = ['ffmpeg', '-y', '-i', input_path]
        
        if track_index is not None:
            cmd.extend(['-map', f'0:a:{track_index}'])
        else:
            cmd.extend(['-map', '0:a:0'])  # Primera pista de audio por defecto
        
        cmd.extend(['-acodec', 'libmp3lame', '-ab', '192k', output_path])
        
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        if result.returncode != 0:
            print(f"Error FFmpeg: {result.stderr}")
            return False
        
        return True
        
    except Exception as e:
        print(f"Error extrayendo audio: {e}")
        return False

def main():
    file_path = r'${filePath}'
    audio_track_index = ${audioTrackIndex || 'None'}
    model_size = '${modelSize}'
    language = ${language ? `'${language}'` : 'None'}
    
    temp_audio_file = None
    
    try:
        # Verificar que el archivo existe
        if not os.path.exists(file_path):
            raise Exception(f"Archivo no encontrado: {file_path}")
        
        # Determinar archivo de audio a procesar
        if file_path.lower().endswith('.mp4'):
            # Extraer audio de MP4
            temp_audio_file = tempfile.mktemp(suffix='.mp3')
            print(f"Extrayendo audio de MP4 a: {temp_audio_file}")
            
            if not extract_audio_from_mp4(file_path, temp_audio_file, audio_track_index):
                raise Exception("Error extrayendo audio del MP4")
            
            audio_file = temp_audio_file
        else:
            # Usar archivo de audio directamente
            audio_file = file_path
        
        # Cargar modelo si no está cargado
        if not whisper_local.is_loaded or whisper_local.model_size != model_size:
            print(f"Cargando modelo {model_size}...")
            if not whisper_local.load_model(model_size):
                raise Exception(f"No se pudo cargar el modelo {model_size}")
        
        # Transcribir
        print(f"Transcribiendo archivo: {os.path.basename(audio_file)}")
        result = whisper_local.transcribe_audio(audio_file, language)
        
        if result['success']:
            print(json.dumps({
                'success': True,
                'transcript': result['transcript'],
                'language': result['language'],
                'duration': result['duration'],
                'model_info': result['model_info'],
                'stats': result['stats']
            }, ensure_ascii=False))
        else:
            print(json.dumps({
                'success': False,
                'error': result['error']
            }, ensure_ascii=False))
            
    except Exception as e:
        print(json.dumps({
            'success': False,
            'error': str(e)
        }, ensure_ascii=False))
    
    finally:
        # Limpiar archivo temporal de audio si se creó
        if temp_audio_file and os.path.exists(temp_audio_file):
            try:
                os.unlink(temp_audio_file)
                print(f"Archivo temporal de audio eliminado: {temp_audio_file}")
            except:
                pass

if __name__ == '__main__':
    main()
`;

    // Escribir script temporal
    const tempScriptPath = path.join(process.cwd(), 'temp', `transcribe_${Date.now()}.py`);
    fs.mkdirSync(path.dirname(tempScriptPath), { recursive: true });
    fs.writeFileSync(tempScriptPath, pythonScript);

    // Ejecutar transcripción
    const pythonProcess = spawn('python', [tempScriptPath], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { 
        ...process.env, 
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1'
      }
    });

    let stdout = '';
    let stderr = '';

    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    pythonProcess.on('close', (code) => {
      // Limpiar script temporal
      try {
        fs.unlinkSync(tempScriptPath);
      } catch (e) {
        console.warn('No se pudo eliminar script temporal:', e.message);
      }

      // Limpiar archivo de audio temporal
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log(`🗑️ Archivo temporal eliminado: ${filePath}`);
        }
      } catch (cleanupError) {
        console.warn('⚠️ No se pudo eliminar archivo temporal:', cleanupError.message);
      }

      if (code !== 0) {
        console.error('❌ Error en transcripción local:', stderr);
        return res.status(500).json({ 
          error: 'Error en transcripción local: ' + stderr,
          stdout: stdout 
        });
      }

      try {
        // Buscar la última línea que sea JSON válido
        const lines = stdout.trim().split('\n');
        let result = null;
        
        for (let i = lines.length - 1; i >= 0; i--) {
          try {
            result = JSON.parse(lines[i]);
            break;
          } catch (e) {
            continue;
          }
        }

        if (!result) {
          throw new Error('No se pudo parsear el resultado');
        }

        if (result.success) {
          console.log(`✅ Transcripción LOCAL completada. Caracteres: ${result.transcript.length}`);
          console.log(`📊 Velocidad: ${result.stats.processing_speed.toFixed(1)}x tiempo real`);
          console.log(`🌍 Idioma: ${result.language}`);
          
          res.json({
            transcript: result.transcript,
            language: result.language,
            duration: result.duration,
            model_info: result.model_info,
            stats: result.stats,
            method: 'local'
          });
        } else {
          throw new Error(result.error);
        }

      } catch (parseError) {
        console.error('❌ Error parseando resultado:', parseError);
        console.log('Raw stdout:', stdout);
        res.status(500).json({ 
          error: 'Error parseando resultado de transcripción',
          stdout: stdout,
          stderr: stderr 
        });
      }
    });

    pythonProcess.on('error', (error) => {
      console.error('❌ Error ejecutando Python:', error);
      res.status(500).json({ error: 'Error ejecutando transcripción local: ' + error.message });
    });
    
  } catch (error) {
    console.error('❌ Error en transcripción local:', error);
    res.status(500).json({ error: 'Error en transcripción local: ' + error.message });
  }
});

// Ruta para obtener las voces disponibles de Applio
app.get('/api/applio-voices', (req, res) => {
  try {
    console.log('🎤 Solicitando lista de voces de Applio...');
    const voices = getAvailableVoices();
    
    res.json({
      success: true,
      voices: voices,
      count: voices.length
    });
    
    console.log(`✅ Enviadas ${voices.length} voces al cliente`);
  } catch (error) {
    console.error('❌ Error obteniendo voces:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener las voces disponibles',
      voices: [{
        name: 'RemyOriginal (Default)',
        path: 'logs\\VOCES\\RemyOriginal.pth',
        displayName: 'RemyOriginal'
      }]
    });
  }
});

// Ruta para obtener información del modelo local
app.get('/whisper-local-info', async (req, res) => {
  try {
    const { spawn } = await import('child_process');
    
    const pythonScript = `
import sys
import json
sys.path.append('${process.cwd().replace(/\\/g, '/')}')

from whisper_local import whisper_local

try:
    info = whisper_local.get_model_info()
    print(json.dumps(info))
except Exception as e:
    print(json.dumps({'error': str(e)}))
`;

    const tempScriptPath = path.join(process.cwd(), 'temp', `info_${Date.now()}.py`);
    fs.mkdirSync(path.dirname(tempScriptPath), { recursive: true });
    fs.writeFileSync(tempScriptPath, pythonScript);

    const pythonProcess = spawn('python', [tempScriptPath], {
      env: { 
        ...process.env, 
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1'
      }
    });
    let stdout = '';

    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    pythonProcess.on('close', (code) => {
      try {
        fs.unlinkSync(tempScriptPath);
      } catch (e) {}

      try {
        const result = JSON.parse(stdout.trim());
        res.json(result);
      } catch (error) {
        res.status(500).json({ error: 'Error obteniendo información del modelo' });
      }
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Ruta para transcribir audio/video
app.post('/transcribe-audio', async (req, res) => {
  try {
    const { filePath, audioTrackIndex } = req.body;
    
    if (!filePath) {
      return res.status(400).json({ error: 'Ruta del archivo requerida' });
    }

    console.log(`🎤 Iniciando transcripción de: ${filePath}`);
    if (audioTrackIndex !== undefined) {
      console.log(`📡 Usando pista de audio: ${audioTrackIndex}`);
    }

    const transcript = await transcribeAudio({
      filePath,
      audioTrackIndex,
      onUploadProgress: (percent) => {
        // Aquí podrías implementar WebSockets para progreso en tiempo real si quisieras
        console.log(`📊 Progreso de transcripción: ${percent}%`);
      }
    });

    console.log(`✅ Transcripción completada. Caracteres: ${transcript.length}`);
    
    // Limpiar archivo temporal después de la transcripción
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`🗑️ Archivo temporal eliminado: ${filePath}`);
      }
    } catch (cleanupError) {
      console.warn('⚠️ No se pudo eliminar archivo temporal:', cleanupError.message);
    }
    
    res.json({ transcript });
    
  } catch (error) {
    console.error('❌ Error transcribiendo audio:', error);
    res.status(500).json({ error: 'Error transcribiendo audio: ' + error.message });
  }
});

// Endpoint para generar títulos, descripción y etiquetas para YouTube
app.post('/generate-youtube-metadata', async (req, res) => {
  try {
    const { topic, allSections, folderName, thumbnailStyle } = req.body;

    if (!topic || !allSections || allSections.length === 0) {
      return res.status(400).json({ error: 'Tema y secciones requeridos' });
    }

    console.log(`🎬 Generando metadata de YouTube para: ${topic}`);
    console.log(`📝 Número de secciones: ${allSections.length}`);
    console.log(`🖼️ Estilo de miniatura: ${thumbnailStyle || 'default'}`);

    // Combinar todas las secciones en un resumen
    const fullScript = allSections.join('\n\n--- SECCIÓN ---\n\n');

    // Obtener instrucciones de estilo de miniatura
    const thumbnailInstructions = getThumbnailStyleInstructions(thumbnailStyle || 'default');
    
    console.log(`🎨 thumbnailStyle recibido:`, thumbnailStyle);
    console.log(`📝 thumbnailInstructions generadas:`, thumbnailInstructions);

    const prompt = `
Basándote en el siguiente tema y guión completo del video, genera metadata optimizada para YouTube:

**TEMA:** ${topic}

**GUIÓN COMPLETO:**
${fullScript}

Por favor genera:

1. **10 TÍTULOS CLICKBAIT** (cada uno en una línea, numerados):
   - Usa palabras que generen curiosidad como "QUE PASA CUANDO", "POR QUE", "HICE ESTO Y PASO ESTO", "NO VAS A CREER", "ESTO CAMBIÓ TODO"
   - Que sean polémicos pero relacionados al contenido
   - maximo 15 palabras, minimo 10.

2. **DESCRIPCIÓN PARA VIDEO** (optimizada para SEO):
   - Entre 150-300 palabras
   - Incluye palabras clave relevantes del tema
   - Menciona el contenido principal del video
   - Incluye call-to-action para suscribirse
   - Formato atractivo con emojis

3. **25 ETIQUETAS** (separadas por comas):
   - Palabras clave relacionadas al tema
   - Tags populares del nicho correspondiente
   - Términos de búsqueda relevantes
   - Sin espacios en tags compuestos (usar guiones o camelCase)

4. **5 PROMPTS PARA MINIATURAS DE YOUTUBE** (cada uno en una línea, numerados):
   
   FORMATO OBLIGATORIO - DEBES SEGUIR ESTA ESTRUCTURA EXACTA PARA CADA UNO DE LOS 5 PROMPTS:
   
   "Miniatura de YouTube 16:9 mostrando [descripción visual muy detallada del contenido relacionado al tema, mínimo 15 palabras] con texto superpuesto '[frase clickbait específica relacionada al contenido]' con el texto aplicando el siguiente estilo: ${thumbnailInstructions}"
   
   REGLAS ESTRICTAS - NO GENERAR PROMPTS CORTOS O INCOMPLETOS:
   - CADA prompt debe tener mínimo 25 palabras de descripción visual
   - CADA prompt debe incluir una frase clickbait específica entre comillas
   - CADA prompt debe terminar con la frase completa del estilo
   - NO generar prompts como "el texto con contorno negro" - ESO ESTÁ PROHIBIDO
   - TODOS los prompts deben seguir el formato completo
   
   EJEMPLO DE FORMATO CORRECTO (SEGUIR EXACTAMENTE ESTA ESTRUCTURA):
   1. Miniatura de YouTube 16:9 mostrando a Link adulto con expresión de shock mirando directamente a la cámara mientras sostiene la Master Sword brillante, con el Castillo de Hyrule destruido de fondo y llamas rojas. El rostro de Link debe mostrar sorpresa extrema con ojos muy abiertos con texto superpuesto "¡ZELDA ESTÁ MUERTA!" con el texto aplicando el siguiente estilo: ${thumbnailInstructions}

REGLAS ESTRICTAS:
- EXACTAMENTE 5 prompts numerados del 1 al 5
- Cada prompt debe incluir la frase completa del estilo al final
- NO hacer referencias a estilos anteriores
- Descripción visual específica y detallada en cada uno
IMPORTANTE: 
- Genera EXACTAMENTE 5 prompts completos, numerados del 1 al 5
- Cada prompt debe ser una oración completa y detallada (mínimo 25 palabras)
- SIEMPRE incluye la frase completa del estilo al final de cada prompt
- NO usar "aplicando el estilo especificado anteriormente" NUNCA
- NO generar prompts cortos como "el texto con contorno negro" - ESTO ESTÁ PROHIBIDO
- VERIFICA que cada prompt tenga: descripción visual + frase clickbait + estilo completo
- Si un prompt sale corto, reescríbelo completo


Formato de respuesta:
**TÍTULOS CLICKBAIT:**
1. [título]
2. [título]
...

**DESCRIPCIÓN:**
[descripción completa]

**ETIQUETAS:**
tag1, tag2, tag3, ...

**PROMPTS PARA MINIATURAS:**
1. [prompt completo para miniatura]
2. [prompt completo para miniatura]  
3. [prompt completo para miniatura]
4. [prompt completo para miniatura]
5. [prompt completo para miniatura]
    `;

    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
    
    const response = await model.generateContent(prompt);
    const result = await response.response;
    const responseText = await result.text();

    // Validar que los prompts de miniatura no estén incompletos
    const thumbnailSection = responseText.match(/\*\*PROMPTS PARA MINIATURAS:\*\*([\s\S]*?)(?=\n\n|$)/);
    if (thumbnailSection) {
      const thumbnailPrompts = thumbnailSection[1].trim().split('\n').filter(line => line.trim());
      
      // Verificar prompts incompletos
      const incompletePrompts = thumbnailPrompts.filter(prompt => {
        const cleanPrompt = prompt.replace(/^\d+\.\s*/, '').trim();
        return cleanPrompt.length < 50 || 
               cleanPrompt.includes('el texto con contorno negro y muy brillante el texto') ||
               !cleanPrompt.includes('con el texto aplicando el siguiente estilo:');
      });
      
      if (incompletePrompts.length > 0) {
        console.log(`⚠️ Detectados ${incompletePrompts.length} prompts incompletos, regenerando...`);
        console.log('Prompts problemáticos:', incompletePrompts);
        
        // Regenerar solo la sección de prompts
        const regeneratePrompt = `
Genera EXACTAMENTE 5 prompts completos para miniaturas de YouTube sobre: ${topic}

FORMATO OBLIGATORIO para cada prompt:
"Miniatura de YouTube 16:9 mostrando [descripción visual muy detallada, mínimo 20 palabras] con texto superpuesto '[frase clickbait específica]' con el texto aplicando el siguiente estilo: ${thumbnailInstructions}"

REGLAS ESTRICTAS:
- Cada prompt debe tener mínimo 30 palabras
- NUNCA generar "el texto con contorno negro y muy brillante el texto"
- TODOS deben incluir la frase completa del estilo al final
- Numerar del 1 al 5

1. [prompt completo]
2. [prompt completo]
3. [prompt completo]
4. [prompt completo]
5. [prompt completo]
        `;
        
        const regenerateResponse = await ai.models.generateContent({
          model: "gemini-2.0-flash-exp",
          contents: [{
            role: "user",
            parts: [{ text: regeneratePrompt }]
          }]
        });
        
        // Reemplazar la sección de prompts en la respuesta original
        const newThumbnailPrompts = regenerateResponse.text.trim();
        const updatedResponse = responseText.replace(
          /(\*\*PROMPTS PARA MINIATURAS:\*\*)([\s\S]*?)(?=\n\n|$)/,
          `$1\n${newThumbnailPrompts}`
        );
        
        console.log(`✅ Prompts regenerados exitosamente`);
        
        // Guardar los metadatos en archivo con los prompts corregidos
        try {
          const safeFolderName = folderName && folderName.trim() 
            ? createSafeFolderName(folderName.trim())
            : createSafeFolderName(topic);
            
          const outputsDir = path.join('./public/outputs');
          const projectDir = path.join(outputsDir, safeFolderName);
          
          if (!fs.existsSync(outputsDir)) {
            fs.mkdirSync(outputsDir, { recursive: true });
          }
          if (!fs.existsSync(projectDir)) {
            fs.mkdirSync(projectDir, { recursive: true });
          }
          
          const metadataFileName = `${safeFolderName}_metadata_youtube.txt`;
          const metadataFilePath = path.join(projectDir, metadataFileName);
          
          const metadataContent = `METADATA DE YOUTUBE
===============================
Tema: ${topic}
Número de secciones: ${allSections.length}
${folderName ? `Nombre del proyecto: ${folderName}` : ''}
Fecha de generación: ${new Date().toLocaleString()}

CONTENIDO DE METADATA:
${updatedResponse}

===============================
Generado automáticamente por el sistema de creación de contenido
`;
          
          fs.writeFileSync(metadataFilePath, metadataContent, 'utf8');
          console.log(`💾 Metadata de YouTube guardada (con prompts corregidos): ${metadataFilePath}`);
          
        } catch (saveError) {
          console.error('❌ Error guardando archivo de metadata:', saveError);
        }
        
        return res.json({ 
          success: true, 
          metadata: updatedResponse,
          message: 'Metadata generada exitosamente (con prompts corregidos)' 
        });
      }
    }

    console.log(`✅ Metadata de YouTube generada exitosamente`);
    
    // Guardar los metadatos en archivo
    try {
      // Usar el mismo sistema que las secciones para determinar el nombre de carpeta
      const safeFolderName = folderName && folderName.trim() 
        ? createSafeFolderName(folderName.trim())
        : createSafeFolderName(topic);
        
      const outputsDir = path.join('./public/outputs');
      const projectDir = path.join(outputsDir, safeFolderName);
      
      // Crear carpetas si no existen
      if (!fs.existsSync(outputsDir)) {
        fs.mkdirSync(outputsDir, { recursive: true });
      }
      if (!fs.existsSync(projectDir)) {
        fs.mkdirSync(projectDir, { recursive: true });
      }
      
      // Guardar en la misma carpeta donde están las secciones del guión
      const metadataFileName = `${safeFolderName}_metadata_youtube.txt`;
      const metadataFilePath = path.join(projectDir, metadataFileName);
      
      const metadataContent = `METADATA DE YOUTUBE
===============================
Tema: ${topic}
Número de secciones: ${allSections.length}
${folderName ? `Nombre del proyecto: ${folderName}` : ''}
Fecha de generación: ${new Date().toLocaleString()}

CONTENIDO DE METADATA:
${responseText}

===============================
Generado automáticamente por el sistema de creación de contenido
`;
      
      fs.writeFileSync(metadataFilePath, metadataContent, 'utf8');
      console.log(`💾 Metadata de YouTube guardada en la carpeta del proyecto: ${metadataFilePath}`);
      
    } catch (saveError) {
      console.error('❌ Error guardando archivo de metadata:', saveError);
      // No detener el proceso por este error, solo registrarlo
    }
    
    res.json({
      success: true,
      metadata: responseText,
      topic: topic,
      sectionsCount: allSections.length
    });

  } catch (error) {
    console.error('❌ Error generando metadata de YouTube:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error generando metadata de YouTube: ' + error.message 
    });
  }
});

// ================================
// RUTAS PARA SISTEMA DE PROYECTOS
// ================================

// Ruta para obtener lista de proyectos disponibles
app.get('/api/projects', (req, res) => {
  try {
    console.log('📡 API /api/projects llamada');
    const projects = getAvailableProjects();
    console.log('📊 Proyectos encontrados:', projects.length);
    res.json({ success: true, projects });
  } catch (error) {
    console.error('❌ Error obteniendo proyectos:', error);
    res.status(500).json({ success: false, error: 'Error obteniendo proyectos: ' + error.message });
  }
});

// Ruta para cargar un proyecto específico
app.get('/api/projects/:folderName', (req, res) => {
  try {
    const { folderName } = req.params;
    const projectState = loadProjectState(folderName);
    
    if (!projectState) {
      return res.status(404).json({ success: false, error: 'Proyecto no encontrado' });
    }
    
    res.json({ success: true, project: projectState });
  } catch (error) {
    console.error('❌ Error cargando proyecto:', error);
    res.status(500).json({ success: false, error: 'Error cargando proyecto' });
  }
});

// Endpoint para diagnosticar y reparar un proyecto específico
app.get('/api/projects/:folderName/diagnose', (req, res) => {
  try {
    const { folderName } = req.params;
    const projectDir = path.join('./public/outputs', folderName);
    const projectStateFile = path.join(projectDir, 'project_state.json');
    
    console.log(`🔍 Diagnosticando proyecto: ${folderName}`);
    
    const diagnosis = {
      projectName: folderName,
      projectDirExists: fs.existsSync(projectDir),
      projectStateFileExists: fs.existsSync(projectStateFile),
      errors: [],
      warnings: [],
      repairAttempted: false,
      repairSuccessful: false
    };
    
    if (!diagnosis.projectDirExists) {
      diagnosis.errors.push('El directorio del proyecto no existe');
      return res.json({ success: false, diagnosis });
    }
    
    if (!diagnosis.projectStateFileExists) {
      diagnosis.errors.push('El archivo project_state.json no existe');
      return res.json({ success: false, diagnosis });
    }
    
    // Leer y analizar el archivo
    try {
      const fileContent = fs.readFileSync(projectStateFile, 'utf8');
      diagnosis.fileSize = fileContent.length;
      diagnosis.filePreview = fileContent.substring(0, 200) + (fileContent.length > 200 ? '...' : '');
      
      if (!fileContent.trim()) {
        diagnosis.errors.push('El archivo JSON está vacío');
        return res.json({ success: false, diagnosis });
      }
      
      // Intentar parsear
      try {
        const projectState = JSON.parse(fileContent);
        diagnosis.parseSuccessful = true;
        diagnosis.projectData = {
          topic: projectState.topic,
          totalSections: projectState.totalSections,
          completedSections: projectState.completedSections?.length || 0,
          lastModified: projectState.lastModified
        };
      } catch (parseError) {
        diagnosis.errors.push(`Error de JSON: ${parseError.message}`);
        
        // Intentar reparar
        diagnosis.repairAttempted = true;
        
        if (!fileContent.trim().endsWith('}') && !fileContent.trim().endsWith(']')) {
          let repairedContent = fileContent.trim();
          
          // Contar llaves abiertas vs cerradas
          const openBraces = (repairedContent.match(/\{/g) || []).length;
          const closeBraces = (repairedContent.match(/\}/g) || []).length;
          
          if (openBraces > closeBraces) {
            // Agregar llaves faltantes
            for (let i = 0; i < openBraces - closeBraces; i++) {
              repairedContent += '}';
            }
            
            try {
              const repairedState = JSON.parse(repairedContent);
              
              // Crear backup del archivo original
              const backupPath = projectStateFile + '.backup.' + Date.now();
              fs.copyFileSync(projectStateFile, backupPath);
              
              // Guardar archivo reparado
              fs.writeFileSync(projectStateFile, JSON.stringify(repairedState, null, 2), 'utf8');
              
              diagnosis.repairSuccessful = true;
              diagnosis.repairDetails = `Agregadas ${openBraces - closeBraces} llaves faltantes`;
              diagnosis.backupPath = path.basename(backupPath);
              diagnosis.projectData = {
                topic: repairedState.topic,
                totalSections: repairedState.totalSections,
                completedSections: repairedState.completedSections?.length || 0,
                lastModified: repairedState.lastModified
              };
            } catch (repairError) {
              diagnosis.errors.push(`Error en reparación: ${repairError.message}`);
            }
          } else {
            diagnosis.warnings.push('El archivo parece completo pero no se puede parsear');
          }
        }
      }
      
    } catch (readError) {
      diagnosis.errors.push(`Error leyendo archivo: ${readError.message}`);
    }
    
    const isHealthy = diagnosis.errors.length === 0 && (diagnosis.parseSuccessful || diagnosis.repairSuccessful);
    
    res.json({ 
      success: isHealthy, 
      diagnosis,
      message: isHealthy ? 'Proyecto saludable' : 'Proyecto tiene problemas'
    });
    
  } catch (error) {
    console.error('❌ Error diagnosticando proyecto:', error);
    res.status(500).json({ success: false, error: 'Error diagnosticando proyecto: ' + error.message });
  }
});

// Endpoint para reconstruir manualmente un proyecto específico
app.post('/api/projects/:folderName/reconstruct', (req, res) => {
  try {
    const { folderName } = req.params;
    
    console.log(`🔧 Solicitud de reconstrucción manual para proyecto: ${folderName}`);
    
    const reconstructedState = reconstructProjectState(folderName);
    
    if (!reconstructedState) {
      return res.status(500).json({ 
        success: false, 
        error: 'No se pudo reconstruir el proyecto. Verifica que las carpetas existan.' 
      });
    }
    
    // Guardar el estado reconstruido
    const projectStateFile = path.join('./public/outputs', folderName, 'project_state.json');
    
    // Crear backup del archivo existente si existe
    if (fs.existsSync(projectStateFile)) {
      const backupPath = projectStateFile + '.backup.' + Date.now();
      fs.copyFileSync(projectStateFile, backupPath);
      console.log(`🗃️ Backup creado: ${path.basename(backupPath)}`);
    }
    
    fs.writeFileSync(projectStateFile, JSON.stringify(reconstructedState, null, 2), 'utf8');
    
    res.json({ 
      success: true, 
      message: 'Proyecto reconstruido exitosamente',
      data: {
        projectName: folderName,
        totalSections: reconstructedState.totalSections,
        completedSections: reconstructedState.completedSections.length,
        reconstructedAt: reconstructedState.reconstructedAt,
        sectionsAnalyzed: reconstructedState.completedSections.map(s => ({
          section: s.section,
          hasScript: s.hasScript,
          hasAudio: s.hasAudio,
          hasImages: s.hasImages,
          fileCount: s.fileCount
        }))
      }
    });
    
  } catch (error) {
    console.error('❌ Error reconstruyendo proyecto:', error);
    res.status(500).json({ success: false, error: 'Error reconstruyendo proyecto: ' + error.message });
  }
});

// Endpoint para obtener imágenes de una sección específica
app.get('/api/project-images/:folderName/:sectionNumber', (req, res) => {
  try {
    const { folderName, sectionNumber } = req.params;
    const projectDir = path.join('./public/outputs', folderName);
    const sectionDir = path.join(projectDir, `seccion_${sectionNumber}`);
    
    console.log(`🖼️ Buscando imágenes en: ${sectionDir}`);
    
    if (!fs.existsSync(sectionDir)) {
      console.log(`📁 Directorio de sección no encontrado: ${sectionDir}`);
      return res.json({ success: true, images: [], keywords: [], prompts: [] });
    }
    
    // Buscar archivos de imagen
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
    const files = fs.readdirSync(sectionDir);
    const imageFiles = files.filter(file => 
      imageExtensions.includes(path.extname(file).toLowerCase())
    );
    
    console.log(`🖼️ Archivos de imagen encontrados: ${imageFiles.length}`);
    
    // Crear URLs para las imágenes
    const images = imageFiles.map(filename => {
      // Detectar si es imagen de Bing/Google por el nombre del archivo
      const isBingImage = filename.startsWith('bing_image_');
      
      return {
        url: `/outputs/${folderName}/seccion_${sectionNumber}/${filename}`,
        filename: filename,
        caption: `Imagen: ${filename}`,
        path: path.join(sectionDir, filename),
        source: isBingImage ? 'Google Images' : 'AI Generated'
      };
    });
    
    // Buscar archivo de keywords
    let keywords = [];
    const keywordsFile = path.join(sectionDir, `${folderName}_seccion_${sectionNumber}_keywords.txt`);
    if (fs.existsSync(keywordsFile)) {
      try {
        const keywordsContent = fs.readFileSync(keywordsFile, 'utf8');
        keywords = keywordsContent.split('\n').filter(line => line.trim());
        console.log(`📋 Keywords cargadas desde archivo keywords: ${keywords.length}`);
      } catch (error) {
        console.warn(`⚠️ Error leyendo keywords: ${error.message}`);
      }
    } else {
      // Intentar extraer keywords del archivo de prompts como fallback
      const promptsFile = path.join(sectionDir, `${folderName}_seccion_${sectionNumber}_prompts_imagenes.txt`);
      if (fs.existsSync(promptsFile)) {
        try {
          const promptsContent = fs.readFileSync(promptsFile, 'utf8');
          const lines = promptsContent.split('\n');
          
          // Buscar líneas que contengan "Imagen X: [keyword]"
          const keywordLines = lines.filter(line => {
            return line.match(/^\d+\.\s*Imagen\s+\d+:\s*(.+)$/);
          });
          
          keywords = keywordLines.map(line => {
            const match = line.match(/^\d+\.\s*Imagen\s+\d+:\s*(.+)$/);
            return match ? match[1].trim() : '';
          }).filter(keyword => keyword);
          
          console.log(`📋 Keywords extraídas desde archivo de prompts: ${keywords.length}`);
        } catch (error) {
          console.warn(`⚠️ Error extrayendo keywords desde prompts: ${error.message}`);
        }
      }
    }
    
    // 🔍 INTENTAR CARGAR KEYWORDS DESDE images_metadata.json
    if (keywords.length === 0) {
      const metadataFile = path.join(sectionDir, 'images_metadata.json');
      console.log(`🔍 Buscando archivo de metadata: ${metadataFile}`);
      if (fs.existsSync(metadataFile)) {
        try {
          const metadataContent = fs.readFileSync(metadataFile, 'utf8');
          const metadata = JSON.parse(metadataContent);
          console.log(`📊 Metadata cargado:`, metadata);
          
          // Extraer keywords para cada imagen en orden
          const imageKeywords = [];
          for (const image of images) {
            const filename = image.filename;
            if (metadata[filename] && metadata[filename].keywords) {
              imageKeywords.push(metadata[filename].keywords);
              console.log(`🔑 Keyword para ${filename}: ${metadata[filename].keywords}`);
            } else {
              imageKeywords.push(''); // Placeholder vacío si no hay keyword
              console.log(`⚠️ No se encontró keyword para ${filename}`);
            }
          }
          
          if (imageKeywords.length > 0) {
            keywords = imageKeywords;
            console.log(`📋 Keywords finales cargadas desde images_metadata.json: ${keywords.length} items`);
            console.log(`📋 Keywords array:`, keywords);
          }
        } catch (error) {
          console.warn(`⚠️ Error leyendo images_metadata.json: ${error.message}`);
        }
      } else {
        console.log(`❌ Archivo images_metadata.json no encontrado`);
      }
    }
    
    // Buscar archivo de prompts
    let prompts = [];
    const promptsFile = path.join(sectionDir, `${folderName}_seccion_${sectionNumber}_prompts_imagenes.txt`);
    if (fs.existsSync(promptsFile)) {
      try {
        const promptsContent = fs.readFileSync(promptsFile, 'utf8');
        prompts = promptsContent.split('\n').filter(line => line.trim());
        console.log(`🎨 Prompts cargados: ${prompts.length}`);
      } catch (error) {
        console.warn(`⚠️ Error leyendo prompts: ${error.message}`);
      }
    }
    
    console.log(`✅ Respondiendo con ${images.length} imágenes, ${keywords.length} keywords, ${prompts.length} prompts`);
    
    // Si no hay keywords suficientes o hay keywords vacíos, llenar con keywords por defecto
    if (keywords.length < images.length) {
      console.log(`⚠️ Hay ${images.length} imágenes pero solo ${keywords.length} keywords. Rellenando con valores por defecto.`);
      const defaultKeywords = [];
      for (let i = 0; i < images.length; i++) {
        if (keywords[i] && keywords[i].trim()) {
          defaultKeywords.push(keywords[i]);
        } else {
          // Generar keyword por defecto basado en el tema del proyecto
          const projectTopic = folderName.includes('guldan') ? 'guldan' : 'imagen';
          defaultKeywords.push(`${projectTopic} ${i + 1}`);
        }
      }
      keywords = defaultKeywords;
      console.log(`📋 Keywords finales después del relleno:`, keywords);
    } else {
      // Verificar si hay keywords vacíos y rellenarlos
      const defaultKeywords = [];
      let hasEmptyKeywords = false;
      for (let i = 0; i < keywords.length; i++) {
        if (keywords[i] && keywords[i].trim()) {
          defaultKeywords.push(keywords[i]);
        } else {
          // Generar keyword por defecto basado en el tema del proyecto  
          const projectTopic = folderName.includes('guldan') ? 'guldan' : 'imagen';
          defaultKeywords.push(`${projectTopic} ${i + 1}`);
          hasEmptyKeywords = true;
        }
      }
      if (hasEmptyKeywords) {
        keywords = defaultKeywords;
        console.log(`📋 Keywords rellenados (habían algunos vacíos):`, keywords);
      }
    }
    
    res.json({
      success: true, 
      images: images,
      keywords: keywords,
      prompts: prompts,
      sectionNumber: parseInt(sectionNumber)
    });  } catch (error) {
    console.error('❌ Error obteniendo imágenes del proyecto:', error);
    res.status(500).json({ success: false, error: 'Error obteniendo imágenes del proyecto' });
  }
});

// Ruta para eliminar un proyecto
app.delete('/api/projects/:folderName', (req, res) => {
  try {
    const { folderName } = req.params;
    const projectDir = path.join('./public/outputs', folderName);
    
    if (fs.existsSync(projectDir)) {
      fs.rmSync(projectDir, { recursive: true, force: true });
      console.log(`🗑️ Proyecto eliminado: ${folderName}`);
      res.json({ success: true, message: 'Proyecto eliminado exitosamente' });
    } else {
      res.status(404).json({ success: false, error: 'Proyecto no encontrado' });
    }
  } catch (error) {
    console.error('❌ Error eliminando proyecto:', error);
    res.status(500).json({ success: false, error: 'Error eliminando proyecto' });
  }
});

// Ruta para duplicar un proyecto
app.post('/api/projects/:folderName/duplicate', (req, res) => {
  try {
    const { folderName } = req.params;
    const { newName } = req.body;
    
    const sourceDir = path.join('./public/outputs', folderName);
    const newFolderName = createSafeFolderName(newName);
    const targetDir = path.join('./public/outputs', newFolderName);
    
    if (!fs.existsSync(sourceDir)) {
      return res.status(404).json({ success: false, error: 'Proyecto fuente no encontrado' });
    }
    
    if (fs.existsSync(targetDir)) {
      return res.status(400).json({ success: false, error: 'Ya existe un proyecto con ese nombre' });
    }
    
    // Copiar directorio completo
    fs.cpSync(sourceDir, targetDir, { recursive: true });
    
    // Actualizar el archivo de estado del proyecto duplicado
    const projectStateFile = path.join(targetDir, 'project_state.json');
    if (fs.existsSync(projectStateFile)) {
      const projectState = JSON.parse(fs.readFileSync(projectStateFile, 'utf8'));
      projectState.originalFolderName = newName;
      projectState.folderName = newFolderName;
      projectState.createdAt = new Date().toISOString();
      projectState.lastModified = new Date().toISOString();
      
      fs.writeFileSync(projectStateFile, JSON.stringify(projectState, null, 2), 'utf8');
    }
    
    console.log(`📋 Proyecto duplicado: ${folderName} -> ${newFolderName}`);
    res.json({ 
      success: true, 
      message: 'Proyecto duplicado exitosamente',
      newFolderName: newFolderName
    });
  } catch (error) {
    console.error('❌ Error duplicando proyecto:', error);
    res.status(500).json({ success: false, error: 'Error duplicando proyecto' });
  }
});

// Ruta para refrescar una imagen específica
app.post('/api/refresh-image', async (req, res) => {
  console.log('🎯 ENDPOINT /api/refresh-image llamado con body:', req.body);
  try {
    const { folderName, imageIndex, sectionNum, keywords, currentImages } = req.body;
    
    console.log('📋 Parámetros recibidos:', { folderName, imageIndex, sectionNum, keywords: keywords.substring(0, 50) + '...' });
    
    if (!folderName || imageIndex === undefined || !sectionNum || !keywords) {
      console.log('❌ Faltan parámetros requeridos');
      return res.status(400).json({ error: 'Faltan parámetros requeridos' });
    }

    // Intentar extraer el folderName real desde las URLs de las imágenes actuales
    let actualFolderName = folderName;
    if (currentImages && currentImages.length > 0) {
      const firstImageUrl = currentImages[0].url;
      const urlMatch = firstImageUrl.match(/\/outputs\/([^\/]+)\//);
      if (urlMatch) {
        actualFolderName = urlMatch[1];
        console.log(`🔍 Folder name extraído de URL de imagen: "${actualFolderName}"`);
      }
    }
    
    // Usar la función estándar para normalización consistente
    const normalizedFolderName = createSafeFolderName(actualFolderName);
    console.log(`🔄 Carpeta normalizada: "${folderName}" → "${normalizedFolderName}"`);
    
    const imagesDir = path.join('./public/outputs', normalizedFolderName, `seccion_${sectionNum}`);
    console.log('📁 Directorio de imágenes:', imagesDir);
    
    if (!fs.existsSync(imagesDir)) {
      console.log('❌ Carpeta no encontrada:', imagesDir);
      return res.status(404).json({ error: 'Carpeta no encontrada' });
    }

    console.log(`🔄 Refrescando imagen en posición visual ${imageIndex} con keywords: ${keywords}`);
    
    // Si tenemos el array de imágenes actuales del frontend, usarlo
    let targetFilename = null;
    
    if (currentImages && currentImages[imageIndex]) {
      // Extraer el nombre del archivo de la URL
      const imageUrl = currentImages[imageIndex].url || currentImages[imageIndex];
      targetFilename = imageUrl.split('/').pop().split('?')[0]; // Remover query params
      console.log(`🎯 Usando mapeo directo del frontend: posición ${imageIndex} → ${targetFilename}`);
    } else {
      // Fallback: usar orden alfabético (comportamiento anterior)
      const files = fs.readdirSync(imagesDir);
      const imageFiles = files.filter(file => 
        /\.(jpg|jpeg|png|gif|webp)$/i.test(file)
      ).sort();
      
      if (imageIndex >= imageFiles.length) {
        return res.status(400).json({ error: 'Índice de imagen inválido' });
      }
      
      targetFilename = imageFiles[imageIndex];
      console.log(`⚠️ Usando fallback alfabético: posición ${imageIndex} → ${targetFilename}`);
    }

    // Verificar que el archivo existe
    const currentImagePath = path.join(imagesDir, targetFilename);
    if (!fs.existsSync(currentImagePath)) {
      return res.status(404).json({ error: `Archivo no encontrado: ${targetFilename}` });
    }

    // Buscar y descargar una nueva imagen con las mismas keywords
    console.log(`🔄 Buscando nueva imagen con keywords: ${keywords}`);
    
    // Convertir keywords a string si es un array, o usarlo directamente si es string
    const searchQuery = Array.isArray(keywords) ? keywords.join(' ') : keywords;
    const imageUrls = await searchBingImages(searchQuery, 60); // Buscar 60 imágenes para máxima variación
    
    if (imageUrls && imageUrls.length > 0) {
      // Obtener URLs de imágenes existentes para evitar duplicados
      const existingFiles = fs.readdirSync(imagesDir);
      const existingImageUrls = new Set();
      
      // Leer metadata si existe para obtener URLs originales
      const metadataPath = path.join(imagesDir, 'images_metadata.json');
      if (fs.existsSync(metadataPath)) {
        try {
          const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
          Object.values(metadata).forEach(img => {
            if (img.originalUrl) existingImageUrls.add(img.originalUrl);
          });
        } catch (error) {
          console.log('⚠️ Error leyendo metadata, continuando sin filtro de duplicados');
        }
      }
      
      // Filtrar URLs que ya tenemos
      const filteredUrls = imageUrls.filter(url => !existingImageUrls.has(url));
      const urlsToUse = filteredUrls.length > 0 ? filteredUrls : imageUrls;
      
      // Seleccionar una imagen aleatoria para obtener variación
      const randomIndex = Math.floor(Math.random() * urlsToUse.length);
      const imageUrl = urlsToUse[randomIndex];
      console.log(`🎲 Seleccionando imagen ${randomIndex + 1} de ${urlsToUse.length} encontradas (${filteredUrls.length > 0 ? 'sin duplicados' : 'total'})`);
      
      // Mantener el mismo nombre base pero con timestamp para evitar cache
      const timestamp = Date.now();
      const extension = imageUrl.split('.').pop()?.split('?')[0] || 'jpg';
      
      // Crear nombre que mantenga la posición visual
      let newImageName;
      
      // Mejorar extracción de extensión para evitar extensiones corruptas
      let validExtension = 'jpg'; // Default seguro
      try {
        const urlParts = imageUrl.split('.');
        if (urlParts.length > 1) {
          const lastPart = urlParts[urlParts.length - 1];
          const cleanExtension = lastPart.split('?')[0].split('/')[0].split('#')[0].toLowerCase();
          // Validar que la extensión sea válida y no muy larga
          if (/^(jpg|jpeg|png|gif|webp)$/i.test(cleanExtension) && cleanExtension.length <= 5) {
            validExtension = cleanExtension;
          }
        }
      } catch (error) {
        console.log(`⚠️ Error extrayendo extensión de URL, usando jpg por defecto: ${error.message}`);
      }
      
      if (targetFilename.startsWith('bing_image_')) {
        // Mantener el formato bing_image_X para compatibilidad
        const imageNumber = targetFilename.match(/bing_image_(\d+)/)?.[1] || (imageIndex + 1);
        newImageName = `bing_image_${imageNumber}.jpg`;
      } else {
        // Para archivos con otros formatos, usar formato consistente
        newImageName = `image_${imageIndex}_${timestamp}.${validExtension}`;
      }
      
      const newImagePath = path.join(imagesDir, newImageName);
      
      // Descargar la nueva imagen con reintentos
      let downloadSuccess = false;
      let attemptCount = 0;
      const maxAttempts = Math.min(5, urlsToUse.length); // Máximo 5 intentos
      
      // Crear ruta temporal para la nueva imagen
      const tempImagePath = newImagePath.replace('.jpg', '_temp.jpg');
      
      while (!downloadSuccess && attemptCount < maxAttempts) {
        try {
          const attemptIndex = (randomIndex + attemptCount) % urlsToUse.length;
          const attemptUrl = urlsToUse[attemptIndex];
          console.log(`📥 Intento ${attemptCount + 1}/${maxAttempts} descargando desde: ${attemptUrl.substring(0, 80)}...`);
          
          // Descargar en archivo temporal primero
          await downloadImageFromUrl(attemptUrl, tempImagePath);
          downloadSuccess = true;
          console.log(`✅ Descarga exitosa en intento ${attemptCount + 1}`);
        } catch (error) {
          attemptCount++;
          console.log(`❌ Fallo en intento ${attemptCount}: ${error.message}`);
          if (attemptCount < maxAttempts) {
            console.log(`🔄 Reintentando con otra URL...`);
          }
        }
      }
      
      if (!downloadSuccess) {
        // Limpiar archivo temporal si falló la descarga
        if (fs.existsSync(tempImagePath)) {
          fs.unlinkSync(tempImagePath);
          console.log(`🗑️ Archivo temporal borrado tras fallo: ${tempImagePath}`);
        }
        console.log(`❌ No se pudo descargar ninguna imagen después de ${maxAttempts} intentos`);
        return res.status(500).json({ error: 'No se pudo descargar una nueva imagen después de varios intentos' });
      }

      // Solo borrar la imagen anterior DESPUÉS de confirmar que la nueva se descargó exitosamente
      if (fs.existsSync(currentImagePath)) {
        fs.unlinkSync(currentImagePath);
        console.log(`🗑️ Imagen anterior borrada: ${currentImagePath}`);
      }
      
      // Mover imagen temporal a ubicación final
      fs.renameSync(tempImagePath, newImagePath);
      console.log(`📁 Imagen temporal movida a ubicación final: ${newImagePath}`);
      
      // Actualizar metadata para rastrear URL original
      const metadataFilePath = path.join(imagesDir, 'images_metadata.json');
      let metadata = {};
      
      if (fs.existsSync(metadataFilePath)) {
        try {
          metadata = JSON.parse(fs.readFileSync(metadataFilePath, 'utf8'));
        } catch (error) {
          console.log('⚠️ Error leyendo metadata existente, creando nuevo');
        }
      }
      
      metadata[newImageName] = {
        originalUrl: imageUrl,
        keywords: searchQuery,
        timestamp: timestamp,
        refreshed: true
      };
      
      try {
        fs.writeFileSync(metadataFilePath, JSON.stringify(metadata, null, 2));
        console.log(`📝 Metadata actualizada para ${newImageName}`);
      } catch (error) {
        console.log('⚠️ Error guardando metadata:', error.message);
      }
      
      console.log(`✅ Nueva imagen descargada: ${newImagePath}`);
      console.log(`🎯 Mapeo mantenido: posición visual ${imageIndex} → ${newImageName}`);
      
      // Devolver la información de la nueva imagen
      res.json({ 
        success: true,
        message: `Imagen ${imageIndex + 1} refrescada exitosamente`,
        newImageUrl: `/outputs/${normalizedFolderName}/seccion_${sectionNum}/${newImageName}`,
        filename: newImageName,
        imageIndex: imageIndex
      });
    } else {
      res.status(404).json({ error: 'No se pudo encontrar una nueva imagen' });
    }

  } catch (error) {
    console.error('❌ Error al refrescar imagen:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ================================
// ENDPOINTS PARA GENERACIÓN DE VIDEO
// ================================

// Almacén de progreso en memoria para cada sesión de video
const videoProgressStore = new Map();

// Función helper para actualizar progreso de video
function updateVideoProgress(sessionId, percent, message) {
  videoProgressStore.set(sessionId, { percent, message, timestamp: Date.now() });
  console.log(`[VIDEO-${sessionId}] ${Math.round(percent)}% - ${message}`);
}

// Endpoint para progreso de video en tiempo real usando Server-Sent Events
app.get('/video-progress/:sessionId', (req, res) => {
  const sessionId = req.params.sessionId;
  
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control'
  });

  // Función para enviar progreso
  const sendProgress = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Enviar progreso inicial
  const initialProgress = videoProgressStore.get(sessionId) || { percent: 0, message: 'Iniciando generación de video...' };
  sendProgress(initialProgress);

  // Verificar progreso cada segundo
  const progressInterval = setInterval(() => {
    const progress = videoProgressStore.get(sessionId);
    if (progress) {
      sendProgress(progress);
      
      // Si está completo, limpiar después de un tiempo
      if (progress.percent >= 100) {
        setTimeout(() => {
          videoProgressStore.delete(sessionId);
          clearInterval(progressInterval);
        }, 30000); // Limpiar después de 30 segundos
      }
    }
  }, 1000);

  // Limpiar al cerrar conexión
  req.on('close', () => {
    clearInterval(progressInterval);
  });
});

// Endpoint para generar video desde el proyecto
app.post('/generate-project-video', async (req, res) => {
  const sessionId = Date.now().toString(); // ID único para esta sesión
  
  try {
    updateVideoProgress(sessionId, 0, 'Iniciando procesamiento de video...');
    
    const { 
      folderName, 
      duration = 3, 
      animationType = 'zoom-out', 
      quality = 'standard' 
    } = req.body;
    
    // Enviar sessionId al cliente para que pueda conectarse al progreso
    res.setHeader('X-Video-Session-ID', sessionId);
    
    if (!folderName) {
      return res.status(400).json({ error: 'Nombre de carpeta requerido' });
    }

    console.log(`🎬 Iniciando generación de video para proyecto: ${folderName}`);
    console.log(`🎬 Configuración: duración=${duration}s, animación=${animationType}, calidad=${quality}`);

    updateVideoProgress(sessionId, 5, 'Analizando estructura del proyecto...');
    
    // Normalizar nombre de la carpeta
    const normalizedFolderName = createSafeFolderName(folderName);
    const projectPath = path.join(process.cwd(), 'public', 'outputs', normalizedFolderName);
    
    if (!fs.existsSync(projectPath)) {
      return res.status(404).json({ error: 'Proyecto no encontrado' });
    }

    // Organizar archivos por secciones
    updateVideoProgress(sessionId, 10, 'Organizando archivos por secciones...');
    const secciones = await organizarArchivosPorSecciones(projectPath);
    
    if (secciones.length === 0) {
      return res.status(404).json({ error: 'No se encontraron secciones con imágenes' });
    }

    console.log(`🎬 Encontradas ${secciones.length} secciones para procesar`);
    updateVideoProgress(sessionId, 15, `Encontradas ${secciones.length} secciones para procesar`);
    
    // Generar video
    const outputPath = await procesarVideoCompleto(secciones, normalizedFolderName, duration, animationType, quality, sessionId);
    
    // Verificar que el archivo existe antes de enviarlo
    if (!fs.existsSync(outputPath)) {
      throw new Error('El archivo de video no se generó correctamente');
    }
    
    console.log('🎬 Enviando video al cliente');
    updateVideoProgress(sessionId, 100, '¡Video completado y listo para descarga!');
    
    const filename = `${normalizedFolderName}_video_completo.mp4`;
    
    res.download(outputPath, filename, (err) => {
      if (err) {
        console.error('❌ Error enviando video:', err);
      } else {
        console.log('✅ Video enviado exitosamente');
        
        // Limpiar archivo temporal después de un tiempo
        setTimeout(() => {
          try {
            if (fs.existsSync(outputPath)) {
              fs.unlinkSync(outputPath);
              console.log('🗑️ Archivo temporal de video limpiado');
            }
          } catch (e) {
            console.log('⚠️ No se pudo limpiar archivo temporal:', e.message);
          }
        }, 60000); // Limpiar después de 1 minuto
      }
    });

  } catch (error) {
    console.error('❌ Error al procesar video:', error);
    updateVideoProgress(sessionId, 0, `Error: ${error.message}`);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Endpoint para generar video simple (sin animaciones)
app.post('/generate-simple-video', async (req, res) => {
  try {
    const { folderName } = req.body;
    
    if (!folderName) {
      return res.status(400).json({ error: 'Nombre de carpeta requerido' });
    }

    console.log(`🎬 Iniciando generación de video simple para proyecto: ${folderName}`);
    console.log(`🎬 Configuración: duración automática basada en audio (sin animaciones)`);
    
    // Normalizar nombre de la carpeta
    const normalizedFolderName = createSafeFolderName(folderName);
    const projectPath = path.join(process.cwd(), 'public', 'outputs', normalizedFolderName);
    
    if (!fs.existsSync(projectPath)) {
      return res.status(404).json({ error: 'Proyecto no encontrado' });
    }

    // Organizar archivos por secciones
    const secciones = await organizarArchivosPorSecciones(projectPath);
    
    if (secciones.length === 0) {
      return res.status(404).json({ error: 'No se encontraron secciones con imágenes' });
    }

    console.log(`🎬 Encontradas ${secciones.length} secciones para procesar (modo simple)`);
    
    // Generar video simple (sin animaciones) - sin parámetro duration
    const outputPath = await procesarVideoSimple(secciones, normalizedFolderName);
    
    // Verificar que el archivo existe antes de enviarlo
    if (!fs.existsSync(outputPath)) {
      throw new Error('El archivo de video no se generó correctamente');
    }
    
    console.log('🎬 Enviando video simple al cliente');
    
    const filename = `${normalizedFolderName}_video_simple.mp4`;
    
    res.download(outputPath, filename, (err) => {
      if (err) {
        console.error('❌ Error enviando video simple:', err);
      } else {
        console.log('✅ Video simple enviado exitosamente');
        
        // Limpiar archivo temporal después de un tiempo
        setTimeout(() => {
          try {
            if (fs.existsSync(outputPath)) {
              fs.unlinkSync(outputPath);
              console.log('🗑️ Archivo temporal de video simple limpiado');
            }
          } catch (e) {
            console.log('⚠️ No se pudo limpiar archivo temporal:', e.message);
          }
        }, 60000); // Limpiar después de 1 minuto
      }
    });

  } catch (error) {
    console.error('❌ Error al procesar video simple:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Función para organizar archivos por secciones desde el proyecto
async function organizarArchivosPorSecciones(projectPath) {
  const secciones = [];
  
  try {
    console.log(`🔍 Explorando directorio del proyecto: ${projectPath}`);
    const items = fs.readdirSync(projectPath);
    console.log(`📁 Elementos encontrados en ${projectPath}:`, items);
    
    // Buscar carpetas de secciones
    for (const item of items) {
      const itemPath = path.join(projectPath, item);
      const stats = fs.statSync(itemPath);
      
      console.log(`🔍 Revisando elemento: ${item} (${stats.isDirectory() ? 'directorio' : 'archivo'})`);
      
      if (stats.isDirectory() && item.startsWith('seccion_')) {
        console.log(`🎯 Carpeta de sección encontrada: ${item}`);
        const numeroSeccion = parseInt(item.replace('seccion_', ''));
        const imagenes = [];
        const audios = [];
        
        // Buscar archivos en la carpeta de sección
        const sectionFiles = fs.readdirSync(itemPath);
        console.log(`📂 Archivos en ${item}:`, sectionFiles);
        
        for (const file of sectionFiles) {
          const filePath = path.join(itemPath, file);
          const fileStats = fs.statSync(filePath);
          
          if (fileStats.isFile()) {
            const ext = path.extname(file).toLowerCase();
            console.log(`📄 Archivo: ${file} - Extensión: ${ext}`);
            
            if (['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'].includes(ext)) {
              imagenes.push({
                path: filePath,
                name: file,
                mtime: fileStats.mtime
              });
              console.log(`🖼️ Imagen agregada: ${file}`);
            } else if (['.mp3', '.wav', '.m4a', '.aac', '.ogg'].includes(ext)) {
              audios.push({
                path: filePath,
                name: file
              });
              console.log(`🎵 Audio agregado: ${file}`);
            } else {
              console.log(`⚠️ Archivo ignorado (extensión no reconocida): ${file}`);
            }
          }
        }
        
        if (imagenes.length > 0) {
          console.log(`🔍 DEBUG: Ordenando ${imagenes.length} imágenes en sección ${numeroSeccion}`);
          console.log(`🔍 DEBUG: Antes de ordenar:`, imagenes.map(img => img.name));
          
          // Ordenar imágenes por nombre para mantener orden consistente
          imagenes.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
          
          console.log(`🔍 DEBUG: Después de ordenar:`, imagenes.map(img => img.name));
          
          console.log(`📁 Sección ${numeroSeccion} encontrada: ${imagenes.length} imágenes, ${audios.length} audios`);
          console.log(`🖼️ Imágenes en sección ${numeroSeccion}:`, imagenes.map(img => img.name));
          console.log(`🎵 Audios en sección ${numeroSeccion}:`, audios.map(aud => aud.name));
          
          secciones.push({
            numero: numeroSeccion,
            nombre: `Sección ${numeroSeccion}`,
            imagenes: imagenes,
            audios: audios,
            path: itemPath
          });
        } else {
          console.log(`⚠️ Sección ${numeroSeccion} no tiene imágenes válidas`);
        }
      } else if (stats.isDirectory()) {
        console.log(`📁 Directorio ignorado (no es sección): ${item}`);
      }
    }
    
    // Ordenar secciones por número
    secciones.sort((a, b) => a.numero - b.numero);
    
    console.log(`🎬 Secciones encontradas: ${secciones.length}`);
    secciones.forEach(seccion => {
      console.log(`  - ${seccion.nombre}: ${seccion.imagenes.length} imágenes, ${seccion.audios.length} audios`);
    });
    
    console.log(`📊 Total: ${secciones.length} secciones, ${secciones.reduce((total, s) => total + s.imagenes.length, 0)} imágenes totales`);
    
    return secciones;
    
  } catch (error) {
    console.error('❌ Error organizando archivos:', error);
    return [];
  }
}

// Función principal para procesar video completo
async function procesarVideoCompleto(secciones, projectName, duration, animationType, quality, sessionId) {
  const outputDir = path.join(process.cwd(), 'temp');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  const finalOutputPath = path.join(outputDir, `${projectName}_video_${Date.now()}.mp4`);
  const videosSeccionesTemp = [];
  
  try {
    // Procesar cada sección individualmente
    for (let i = 0; i < secciones.length; i++) {
      const seccion = secciones[i];
      const progresoBase = 20 + (i * 60 / secciones.length);
      
      updateVideoProgress(sessionId, progresoBase, `Procesando ${seccion.nombre}...`);
      
      const videoSeccionPath = await procesarSeccionVideo(seccion, duration, animationType, quality, sessionId, progresoBase, secciones.length);
      
      if (videoSeccionPath && fs.existsSync(videoSeccionPath)) {
        videosSeccionesTemp.push(videoSeccionPath);
        console.log(`✅ ${seccion.nombre} procesada: ${videoSeccionPath}`);
      }
    }
    
    if (videosSeccionesTemp.length === 0) {
      throw new Error('No se pudieron procesar las secciones');
    }
    
    // Combinar todas las secciones
    updateVideoProgress(sessionId, 85, 'Combinando todas las secciones...');
    await combinarSeccionesVideo(videosSeccionesTemp, finalOutputPath, sessionId);
    
    // Limpiar videos temporales de secciones
    videosSeccionesTemp.forEach(video => {
      try {
        if (fs.existsSync(video)) {
          fs.unlinkSync(video);
        }
      } catch (e) {
        console.log('⚠️ No se pudo limpiar video temporal:', e.message);
      }
    });
    
    return finalOutputPath;
    
  } catch (error) {
    // Limpiar videos temporales en caso de error
    videosSeccionesTemp.forEach(video => {
      try {
        if (fs.existsSync(video)) {
          fs.unlinkSync(video);
        }
      } catch (e) {
        console.log('⚠️ No se pudo limpiar video temporal:', e.message);
      }
    });
    throw error;
  }
}

// Función para procesar una sección individual
async function procesarSeccionVideo(seccion, duration, animationType, quality, sessionId, progresoBase, totalSecciones) {
  try {
    const outputPath = path.join(process.cwd(), 'temp', `seccion_${seccion.numero}_${Date.now()}.mp4`);
    
    // Validar que la sección tiene imágenes
    if (!seccion.imagenes || seccion.imagenes.length === 0) {
      throw new Error(`${seccion.nombre} no tiene imágenes para procesar`);
    }
    
    // Buscar archivo de audio para esta sección
    let audioPath = null;
    let finalDuration = duration; // Duración por defecto
    
    if (seccion.audios && seccion.audios.length > 0) {
      // Usar el primer archivo de audio encontrado
      audioPath = seccion.audios[0].path;
      if (fs.existsSync(audioPath)) {
        console.log(`🎵 Audio encontrado para ${seccion.nombre}: ${audioPath}`);
        
        // Obtener duración del audio usando ffprobe
        try {
          const audioDuration = await getAudioDuration(audioPath);
          if (audioDuration > 0) {
            // Calcular duración por imagen basándose en el audio
            finalDuration = audioDuration / seccion.imagenes.length;
            console.log(`� Duración del audio: ${audioDuration} segundos`);
            console.log(`📐 Duración calculada por imagen: ${finalDuration.toFixed(2)} segundos`);
          } else {
            console.warn(`⚠️ No se pudo obtener duración válida del audio, usando duración fija: ${duration}s`);
          }
        } catch (error) {
          console.warn(`⚠️ Error obteniendo duración del audio: ${error.message}, usando duración fija: ${duration}s`);
        }
      } else {
        console.warn(`⚠️ Archivo de audio no existe: ${audioPath}`);
        audioPath = null;
      }
    } else {
      console.log(`📢 No se encontró audio para ${seccion.nombre}`);
    }
    
    // Validar que todas las imágenes existen y obtener sus rutas absolutas
    const imagenesValidadas = [];
    for (const imagen of seccion.imagenes) {
      let imagePath = imagen.path;
      
      // Si la ruta no es absoluta, convertirla
      if (!path.isAbsolute(imagePath)) {
        imagePath = path.resolve(imagePath);
      }
      
      if (!fs.existsSync(imagePath)) {
        console.error(`❌ Imagen no encontrada: ${imagePath}`);
        throw new Error(`Imagen no encontrada: ${imagePath}`);
      }
      
      // Verificar que es un archivo de imagen válido
      const ext = path.extname(imagePath).toLowerCase();
      if (!['.jpg', '.jpeg', '.png', '.bmp', '.gif', '.webp'].includes(ext)) {
        console.error(`❌ Formato de imagen no soportado: ${ext}`);
        throw new Error(`Formato de imagen no soportado: ${ext}`);
      }
      
      imagenesValidadas.push(imagePath);
      console.log(`✅ Imagen validada: ${imagePath}`);
    }
    
    console.log(`🎬 Procesando ${seccion.nombre} con ${imagenesValidadas.length} imágenes validadas${audioPath ? ' y audio' : ''}`);
    console.log(`⏱️ Duración por imagen: ${finalDuration.toFixed(2)} segundos`);
    
    // Procesar cada imagen con transiciones usando Canvas
    const transitionTypes = ['zoom-in', 'zoom-out', 'pan-right', 'pan-left', 'fade-in', 'slide-in-left', 'slide-in-right', 'rotate-zoom'];
    const framesPorSegundo = 30;
    
    if (imagenesValidadas.length === 1) {
      // Una sola imagen - generar directamente al archivo final
      const imagePath = imagenesValidadas[0];
      const transitionType = 'zoom-out'; // Usar zoom-out para imagen única
      
      console.log(`🎬 Procesando imagen única con transición ${transitionType}`);
      
      // Generar video con transición
      await generateImageVideoWithTransitions(imagePath, outputPath, finalDuration, transitionType, framesPorSegundo);
      
      // Agregar audio si existe
      if (audioPath) {
        const tempVideo = path.join(path.dirname(outputPath), `temp_${path.basename(outputPath)}`);
        fs.renameSync(outputPath, tempVideo);
        
        const ffmpegArgs = ['-i', tempVideo, '-i', audioPath, '-c:v', 'copy', '-c:a', 'aac', '-shortest', outputPath];
        
        await new Promise((resolve, reject) => {
          const ffmpeg = spawn('ffmpeg', ffmpegArgs, { stdio: 'pipe' });
          ffmpeg.on('close', (code) => {
            if (code === 0) {
              // Limpiar archivo temporal
              if (fs.existsSync(tempVideo)) fs.unlinkSync(tempVideo);
              resolve();
            } else {
              reject(new Error(`FFmpeg falló con código ${code}`));
            }
          });
        });
      }
    } else {
      // Múltiples imágenes - generar videos temporales y concatenar
      const tempVideos = [];
      
      for (let i = 0; i < imagenesValidadas.length; i++) {
        const imagePath = imagenesValidadas[i];
        const transitionType = 'zoom-out'; // Usar siempre zoom-out
        const tempVideoPath = path.join(path.dirname(outputPath), `temp_${i}_${Date.now()}.mp4`);
        
        console.log(`🎬 Procesando imagen ${i + 1}/${imagenesValidadas.length} con transición ${transitionType}`);
        
        // Generar video con transición para esta imagen
        await generateImageVideoWithTransitions(imagePath, tempVideoPath, finalDuration, transitionType, framesPorSegundo);
        tempVideos.push(tempVideoPath);
      }
      
      // Concatenar videos con transiciones de desvanecimiento
      await concatenateVideosWithCrossfade(tempVideos, audioPath, outputPath);
      
      // Limpiar archivos temporales
      tempVideos.forEach(video => {
        if (fs.existsSync(video)) fs.unlinkSync(video);
      });
    }
    
    console.log(`✅ Video de sección ${seccion.nombre} generado con transiciones: ${outputPath}`);
    return outputPath; // Devolver la ruta del video generado
        
  } catch (error) {
    console.error(`❌ Error en procesarSeccionVideo:`, error);
    throw error;
  }
}

// Función auxiliar para obtener la duración del audio
function getAudioDuration(audioPath) {
  return new Promise((resolve, reject) => {
    const ffprobeProcess = spawn('ffprobe', [
      '-v', 'quiet',
      '-show_entries', 'format=duration',
      '-of', 'csv=p=0',
      audioPath
    ]);
    
    let ffprobeOutput = '';
    
    ffprobeProcess.stdout.on('data', (data) => {
      ffprobeOutput += data.toString();
    });
    
    ffprobeProcess.on('close', (code) => {
      if (code === 0) {
        const duration = parseFloat(ffprobeOutput.trim());
        resolve(duration);
      } else {
        reject(new Error(`ffprobe falló con código ${code}`));
      }
    });
    
    ffprobeProcess.on('error', (err) => {
      reject(err);
    });
  });
}

// Función para combinar todas las secciones
async function combinarSeccionesVideo(videosSeccionesTemp, finalOutputPath, sessionId) {
  return new Promise((resolve, reject) => {
    updateVideoProgress(sessionId, 90, 'Concatenando todas las secciones...');
    
    const listFile = path.join(process.cwd(), 'temp', `concat_list_${Date.now()}.txt`);
    const listContent = videosSeccionesTemp.map(video => `file '${video}'`).join('\n');
    
    fs.writeFileSync(listFile, listContent);
    
    const args = [
      '-f', 'concat',
      '-safe', '0',
      '-i', listFile,
      '-c', 'copy',
      '-y',
      finalOutputPath
    ];
    
    const ffmpegProcess = spawn('ffmpeg', args);
    
    let stderrData = '';
    
    ffmpegProcess.stderr.on('data', (data) => {
      stderrData += data.toString();
    });
    
    ffmpegProcess.on('close', (code) => {
      // Limpiar archivo de lista temporal
      try {
        if (fs.existsSync(listFile)) {
          fs.unlinkSync(listFile);
        }
      } catch (e) {
        console.log('⚠️ No se pudo limpiar archivo de lista:', e.message);
      }
      
      if (code === 0) {
        console.log('✅ Video final concatenado exitosamente');
        updateVideoProgress(sessionId, 95, 'Video final generado exitosamente');
        resolve(finalOutputPath);
      } else {
        console.error('❌ Error en concatenación FFmpeg:', stderrData);
        reject(new Error(`FFmpeg falló con código ${code}`));
      }
    });
    
    ffmpegProcess.on('error', (err) => {
      console.error('❌ Error ejecutando FFmpeg:', err);
      reject(err);
    });
  });
}

// Función para procesar video simple (sin animaciones)
async function procesarVideoSimple(secciones, projectName) {
  const outputDir = path.join(process.cwd(), 'temp');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  const finalOutputPath = path.join(outputDir, `${projectName}_video_simple_${Date.now()}.mp4`);
  const videosSeccionesTemp = [];
  
  try {
    console.log(`🎬 Procesando video simple con ${secciones.length} secciones`);
    
    // Procesar cada sección individualmente (sin parámetro duration)
    for (let i = 0; i < secciones.length; i++) {
      const seccion = secciones[i];
      
      console.log(`📹 Procesando sección ${i + 1}/${secciones.length}: ${seccion.nombre}`);
      
      const videoSeccionPath = await procesarSeccionVideoSimple(seccion);
      
      if (videoSeccionPath && fs.existsSync(videoSeccionPath)) {
        videosSeccionesTemp.push(videoSeccionPath);
        console.log(`✅ ${seccion.nombre} procesada (simple): ${videoSeccionPath}`);
      }
    }
    
    if (videosSeccionesTemp.length === 0) {
      throw new Error('No se pudieron procesar las secciones');
    }
    
    // Combinar todas las secciones
    console.log('🔗 Combinando todas las secciones (video simple)...');
    await combinarSeccionesVideoSimple(videosSeccionesTemp, finalOutputPath);
    
    // Limpiar videos temporales de secciones
    videosSeccionesTemp.forEach(video => {
      try {
        if (fs.existsSync(video)) {
          fs.unlinkSync(video);
          console.log(`🗑️ Video temporal limpiado: ${path.basename(video)}`);
        }
      } catch (e) {
        console.log('⚠️ No se pudo limpiar video temporal:', e.message);
      }
    });
    
    return finalOutputPath;
    
  } catch (error) {
    // Limpiar videos temporales en caso de error
    videosSeccionesTemp.forEach(video => {
      try {
        if (fs.existsSync(video)) {
          fs.unlinkSync(video);
        }
      } catch (e) {
        console.log('⚠️ No se pudo limpiar video temporal:', e.message);
      }
    });
    throw error;
  }
}

// Función para procesar una sección individual sin animaciones
async function procesarSeccionVideoSimple(seccion) {
  try {
    const outputPath = path.join(process.cwd(), 'temp', `seccion_simple_${seccion.numero}_${Date.now()}.mp4`);
    
    // Validar que la sección tiene imágenes
    if (!seccion.imagenes || seccion.imagenes.length === 0) {
      throw new Error(`${seccion.nombre} no tiene imágenes para procesar`);
    }
    
    // Buscar archivo de audio para esta sección
    let audioPath = null;
    let finalDuration = 3; // Duración por defecto si no hay audio (3 segundos por imagen)
    
    if (seccion.audios && seccion.audios.length > 0) {
      // Usar el primer archivo de audio encontrado
      audioPath = seccion.audios[0].path;
      if (fs.existsSync(audioPath)) {
        console.log(`🎵 Audio encontrado para ${seccion.nombre}: ${audioPath}`);
        
        // Obtener duración del audio usando ffprobe
        try {
          const audioDuration = await getAudioDuration(audioPath);
          if (audioDuration > 0) {
            // ✅ CORREGIDO: No dividir la duración, usar duración completa
            // Calcular duración por imagen para que el video dure lo mismo que el audio
            finalDuration = audioDuration / seccion.imagenes.length;
            console.log(`🎵 Duración del audio: ${audioDuration.toFixed(2)} segundos`);
            console.log(`📐 Duración calculada por imagen: ${finalDuration.toFixed(2)} segundos`);
            console.log(`📐 Duración total del video: ${(finalDuration * seccion.imagenes.length).toFixed(2)} segundos`);
          }
        } catch (error) {
          console.warn(`⚠️ No se pudo obtener duración del audio: ${error.message}`);
        }
      } else {
        console.warn(`⚠️ Archivo de audio no existe: ${audioPath}`);
        audioPath = null;
      }
    } else {
      console.log(`📢 No se encontró audio para ${seccion.nombre}, usando duración por defecto: ${finalDuration}s por imagen`);
    }
    
    // Validar que todas las imágenes existen
    const imagenesValidadas = [];
    console.log(`🔍 DEBUG: Procesando imágenes de ${seccion.nombre}:`);
    console.log(`🔍 DEBUG: seccion.imagenes array:`, seccion.imagenes.map(img => img.name));
    
    for (const imagen of seccion.imagenes) {
      let imagePath = imagen.path;
      
      console.log(`🔍 DEBUG: Procesando imagen: ${imagen.name} - Path: ${imagePath}`);
      
      // Si la ruta no es absoluta, convertirla
      if (!path.isAbsolute(imagePath)) {
        imagePath = path.resolve(imagePath);
      }
      
      if (!fs.existsSync(imagePath)) {
        console.error(`❌ Imagen no encontrada: ${imagePath}`);
        throw new Error(`Imagen no encontrada: ${imagePath}`);
      }
      
      // Verificar que es un archivo de imagen válido
      const ext = path.extname(imagePath).toLowerCase();
      if (!['.jpg', '.jpeg', '.png', '.bmp', '.gif', '.webp'].includes(ext)) {
        console.error(`❌ Formato de imagen no soportado: ${ext}`);
        throw new Error(`Formato de imagen no soportado: ${ext}`);
      }
      
      imagenesValidadas.push(imagePath);
      console.log(`✅ Imagen validada: ${path.basename(imagePath)} (${imagenesValidadas.length}/${seccion.imagenes.length})`);
    }
    
    console.log(`🔍 DEBUG: Orden final de imágenes para ${seccion.nombre}:`);
    imagenesValidadas.forEach((img, index) => {
      console.log(`  ${index + 1}. ${path.basename(img)}`);
    });
    
    console.log(`📹 Procesando ${seccion.nombre} con ${imagenesValidadas.length} imágenes validadas${audioPath ? ' y audio' : ''} (SIN ANIMACIONES)`);
    
    // Crear video simple usando solo imágenes estáticas
    await generarVideoSimpleConImagenesOptimizado(imagenesValidadas, audioPath, outputPath, finalDuration);
    
    console.log(`✅ Video simple de sección ${seccion.nombre} generado: ${outputPath}`);
    return outputPath;
        
  } catch (error) {
    console.error(`❌ Error en procesarSeccionVideoSimple:`, error);
    throw error;
  }
}

// Función para generar video simple con imágenes estáticas
async function generarVideoSimpleConImagenes(imagenes, audioPath, outputPath, duracionPorImagen) {
  return new Promise((resolve, reject) => {
    console.log(`📹 Generando video simple con ${imagenes.length} imágenes estáticas`);
    console.log(`⏱️ Duración por imagen: ${duracionPorImagen.toFixed(2)} segundos`);
    
    // ✅ NUEVO ENFOQUE: Crear lista de archivos para concat demuxer pero sin audio
    const listFile = path.join(path.dirname(outputPath), `imagelist_${Date.now()}.txt`);
    
    // Verificar que todas las imágenes existen
    console.log(`🔍 Verificando existencia de ${imagenes.length} imágenes:`);
    for (let i = 0; i < imagenes.length; i++) {
      const imagePath = imagenes[i];
      if (fs.existsSync(imagePath)) {
        console.log(`✅ Imagen ${i+1}: ${path.basename(imagePath)} - EXISTE`);
      } else {
        console.error(`❌ Imagen ${i+1}: ${path.basename(imagePath)} - NO EXISTE`);
        return reject(new Error(`Imagen no encontrada: ${imagePath}`));
      }
    }
    
    // Crear lista de concatenación con duraciones precisas
    const imageList = imagenes.map(imagePath => {
      return `file '${imagePath.replace(/\\/g, '/')}'
duration ${duracionPorImagen.toFixed(3)}`;
    }).join('\n');
    
    // Agregar la última imagen una vez más sin duración (requerimiento de concat demuxer)
    const finalImageList = imageList + `\nfile '${imagenes[imagenes.length - 1].replace(/\\/g, '/')}'`;
    
    fs.writeFileSync(listFile, finalImageList);
    console.log(`📝 Lista de imágenes creada: ${listFile}`);
    console.log(`� Contenido de la lista (${imagenes.length} imágenes):`);
    console.log(finalImageList);
    
    // Usar spawn directo como VideoCreator para máxima velocidad
    const args = [
      '-f', 'concat',
      '-safe', '0',
      '-i', listFile
    ];
    
    // Si hay audio, agregarlo
    if (audioPath) {
      args.push('-i', audioPath);
      console.log(`🎵 Audio agregado: ${path.basename(audioPath)}`);
    }
    
    // Configuración optimizada VideoCreator style
    args.push(
      '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black',
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '23',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart'
    );
    
    // Si hay audio, configurarlo
    if (audioPath) {
      args.push(
        '-c:a', 'aac',
        '-b:a', '128k',
        '-map', '0:v',  // Video del concat
        '-map', '1:a'   // Audio del segundo input
      );
    }
    
    args.push('-y', outputPath);
    
    console.log('📹 Comando FFmpeg (VideoCreator style):', `ffmpeg ${args.join(' ')}`);
    
    const ffmpegProcess = spawn('ffmpeg', args);
    
    let stderrData = '';
    
    ffmpegProcess.stderr.on('data', (data) => {
      stderrData += data.toString();
      
      // Extraer progreso del stderr
      const progressMatch = stderrData.match(/time=(\d{2}):(\d{2}):(\d{2})/);
      if (progressMatch) {
        const [, hours, minutes, seconds] = progressMatch;
        const currentTime = parseInt(hours) * 3600 + parseInt(minutes) * 60 + parseInt(seconds);
        const totalTime = duracionPorImagen * imagenes.length;
        const percent = Math.min((currentTime / totalTime) * 100, 100);
        
        if (percent > 0) {
          console.log(`⏳ Progreso video simple: ${Math.round(percent)}%`);
        }
      }
    });
    
    ffmpegProcess.on('close', (code) => {
      // Limpiar archivo de lista temporal
      try {
        if (fs.existsSync(listFile)) {
          fs.unlinkSync(listFile);
          console.log('🗑️ Archivo de lista temporal limpiado');
        }
      } catch (e) {
        console.log('⚠️ No se pudo limpiar archivo de lista:', e.message);
      }
      
      if (code === 0) {
        console.log('✅ Video simple generado exitosamente con método VideoCreator');
        
        // Verificar propiedades del video generado
        if (fs.existsSync(outputPath)) {
          const stats = fs.statSync(outputPath);
          console.log(`📊 Archivo generado: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
          
          // Verificar duración real
          exec(`ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${outputPath}"`, (error, stdout) => {
            if (!error && stdout.trim()) {
              const actualDuration = parseFloat(stdout.trim());
              console.log(`⏱️ Duración real del video: ${actualDuration.toFixed(2)} segundos`);
              console.log(`🎯 Duración esperada: ${(duracionPorImagen * imagenes.length).toFixed(2)} segundos`);
            }
          });
        }
        
        resolve(outputPath);
      } else {
        console.error('❌ Error en FFmpeg (VideoCreator method):', stderrData);
        reject(new Error(`FFmpeg exited with code ${code}: ${stderrData}`));
      }
    });
    
    ffmpegProcess.on('error', (err) => {
      console.error('❌ Error ejecutando FFmpeg:', err);
      
      // Limpiar archivo de lista temporal en caso de error
      try {
        if (fs.existsSync(listFile)) {
          fs.unlinkSync(listFile);
        }
      } catch (e) {
        console.log('⚠️ No se pudo limpiar archivo de lista:', e.message);
      }
      
      reject(err);
    });
  });
}

// Función optimizada para generar video simple con imágenes (método videos temporales)
async function generarVideoSimpleConImagenesOptimizado(imagenes, audioPath, outputPath, duracionPorImagen) {
  return new Promise(async (resolve, reject) => {
    console.log(`📹 Generando video simple con ${imagenes.length} imágenes estáticas (método videos temporales)`);
    console.log(`⏱️ Duración por imagen: ${duracionPorImagen.toFixed(2)} segundos`);
    
    // Verificar que todas las imágenes existen
    console.log(`🔍 Verificando existencia de ${imagenes.length} imágenes:`);
    for (let i = 0; i < imagenes.length; i++) {
      const imagePath = imagenes[i];
      if (fs.existsSync(imagePath)) {
        console.log(`✅ Imagen ${i+1}: ${path.basename(imagePath)} - EXISTE`);
      } else {
        console.error(`❌ Imagen ${i+1}: ${path.basename(imagePath)} - NO EXISTE`);
        return reject(new Error(`Imagen no encontrada: ${imagePath}`));
      }
    }
    
    const tempDir = path.join(process.cwd(), 'temp');
    const tempVideos = [];
    
    try {
      // Crear videos temporales de cada imagen
      console.log(`🎬 Creando ${imagenes.length} videos temporales...`);
      
      for (let i = 0; i < imagenes.length; i++) {
        const imagePath = imagenes[i];
        const tempVideoPath = path.join(tempDir, `temp_vid_${i}_${Date.now()}.mp4`);
        
        console.log(`📸 Procesando imagen ${i + 1}/${imagenes.length}: ${path.basename(imagePath)}`);
        
        await new Promise((resolveVid, rejectVid) => {
          ffmpeg()
            .input(imagePath)
            .inputOptions([
              '-loop', '1',
              '-t', duracionPorImagen.toString()
            ])
            .outputOptions([
              '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black',
              '-c:v', 'libx264',
              '-profile:v', 'main',
              '-level', '3.1',
              '-crf', '23',
              '-preset', 'fast',
              '-pix_fmt', 'yuv420p',
              '-r', '30'
            ])
            .output(tempVideoPath)
            .on('end', () => {
              console.log(`✅ Video temporal ${i + 1} creado`);
              tempVideos.push(tempVideoPath);
              resolveVid();
            })
            .on('error', (err) => {
              console.error(`❌ Error creando video temporal ${i + 1}:`, err);
              rejectVid(err);
            })
            .run();
        });
      }
      
      // Crear lista para concat demuxer
      const listFile = path.join(tempDir, `concat_list_${Date.now()}.txt`);
      const listContent = tempVideos.map(video => `file '${video.replace(/\\/g, '/')}'`).join('\n');
      
      fs.writeFileSync(listFile, listContent);
      console.log(`📝 Lista de concatenación creada con ${tempVideos.length} videos`);
      
      // Concatenar videos y agregar audio
      const command = ffmpeg();
      
      command.input(listFile)
        .inputOptions([
          '-f', 'concat',
          '-safe', '0'
        ]);
      
      if (audioPath) {
        command.input(audioPath);
        console.log(`🎵 Audio agregado: ${path.basename(audioPath)}`);
      }
      
      const outputOptions = [
        '-c:v', 'copy', // No recodificar video
        '-movflags', '+faststart'
      ];
      
      if (audioPath) {
        outputOptions.push('-c:a', 'aac');
        outputOptions.push('-b:a', '128k');
        outputOptions.push('-ar', '44100');
        outputOptions.push('-map', '0:v');
        outputOptions.push('-map', '1:a');
      }
      
      command
        .outputOptions(outputOptions)
        .output(outputPath)
        .on('start', (commandLine) => {
          console.log('📹 Comando FFmpeg (concatenación final):', commandLine);
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            console.log(`⏳ Progreso concatenación: ${Math.round(progress.percent)}%`);
          }
        })
        .on('end', () => {
          console.log('✅ Video simple generado exitosamente');
          
          // Limpiar archivos temporales
          tempVideos.forEach(tempVideo => {
            try {
              if (fs.existsSync(tempVideo)) {
                fs.unlinkSync(tempVideo);
                console.log(`🗑️ Video temporal limpiado: ${path.basename(tempVideo)}`);
              }
            } catch (e) {
              console.log('⚠️ No se pudo limpiar video temporal:', e.message);
            }
          });
          
          try {
            if (fs.existsSync(listFile)) {
              fs.unlinkSync(listFile);
              console.log('🗑️ Lista temporal limpiada');
            }
          } catch (e) {
            console.log('⚠️ No se pudo limpiar lista temporal:', e.message);
          }
          
          // Verificar duración final
          if (fs.existsSync(outputPath)) {
            const stats = fs.statSync(outputPath);
            console.log(`📊 Archivo generado: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
            
            exec(`ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${outputPath}"`, (error, stdout) => {
              if (!error && stdout.trim()) {
                const actualDuration = parseFloat(stdout.trim());
                console.log(`⏱️ Duración real del video: ${actualDuration.toFixed(2)} segundos`);
                console.log(`🎯 Duración esperada: ${(duracionPorImagen * imagenes.length).toFixed(2)} segundos`);
              }
            });
          }
          
          resolve(outputPath);
        })
        .on('error', (err) => {
          console.error('❌ Error en concatenación final:', err);
          
          // Limpiar archivos temporales en caso de error
          tempVideos.forEach(tempVideo => {
            try {
              if (fs.existsSync(tempVideo)) {
                fs.unlinkSync(tempVideo);
              }
            } catch (e) {
              // Ignorar errores de limpieza
            }
          });
          
          try {
            if (fs.existsSync(listFile)) {
              fs.unlinkSync(listFile);
            }
          } catch (e) {
            // Ignorar errores de limpieza
          }
          
          reject(err);
        })
        .run();
        
    } catch (error) {
      console.error('❌ Error en proceso de generación:', error);
      
      // Limpiar archivos temporales en caso de error
      tempVideos.forEach(tempVideo => {
        try {
          if (fs.existsSync(tempVideo)) {
            fs.unlinkSync(tempVideo);
          }
        } catch (e) {
          // Ignorar errores de limpieza
        }
      });
      
      reject(error);
    }
  });
}

// Función mejorada para generar video simple con imágenes estáticas
async function generarVideoSimpleConImagenesV2(imagenes, audioPath, outputPath, duracionPorImagen) {
  return new Promise((resolve, reject) => {
    console.log(`📹 Generando video simple con ${imagenes.length} imágenes estáticas`);
    console.log(`⏱️ Duración por imagen: ${duracionPorImagen.toFixed(2)} segundos`);
    
    // ✅ NUEVO ENFOQUE: Crear videos individuales y luego concatenarlos
    const tempVideos = [];
    const tempDir = path.join(process.cwd(), 'temp');
    
    // Función para crear video de una sola imagen
    const createSingleImageVideo = (imagePath, duration, index) => {
      return new Promise((resolveImg, rejectImg) => {
        const tempVideoPath = path.join(tempDir, `temp_img_${index}_${Date.now()}.mp4`);
        
        console.log(`🖼️ Creando video para imagen ${index + 1}: ${path.basename(imagePath)}`);
        
        const command = ffmpeg();
        command.input(imagePath)
          .inputOptions([
            '-loop', '1',
            '-t', duration.toString()
          ])
          .outputOptions([
            '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black',
            '-c:v', 'libx264',
            '-profile:v', 'high',
            '-level', '4.0',
            '-crf', '23',
            '-preset', 'fast',
            '-pix_fmt', 'yuv420p',
            '-r', '30',
            '-vsync', 'cfr'
          ])
          .output(tempVideoPath)
          .on('end', () => {
            console.log(`✅ Video temporal ${index + 1} creado: ${path.basename(tempVideoPath)}`);
            resolveImg(tempVideoPath);
          })
          .on('error', (err) => {
            console.error(`❌ Error creando video temporal ${index + 1}:`, err);
            rejectImg(err);
          })
          .run();
      });
    };
    
    // Crear videos temporales para cada imagen
    const createAllTempVideos = async () => {
      console.log(`🎬 Creando ${imagenes.length} videos temporales...`);
      
      for (let i = 0; i < imagenes.length; i++) {
        try {
          const tempVideo = await createSingleImageVideo(imagenes[i], duracionPorImagen, i);
          tempVideos.push(tempVideo);
        } catch (error) {
          throw new Error(`Error creando video temporal ${i + 1}: ${error.message}`);
        }
      }
      
      console.log(`✅ Todos los videos temporales creados: ${tempVideos.length}`);
    };
    
    // Concatenar todos los videos temporales
    const concatenateVideos = () => {
      return new Promise((resolveCat, rejectCat) => {
        console.log(`🔗 Concatenando ${tempVideos.length} videos temporales...`);
        
        // Crear lista de concatenación para videos
        const listFile = path.join(tempDir, `videolist_${Date.now()}.txt`);
        const videoList = tempVideos.map(video => `file '${video.replace(/\\/g, '/')}'`).join('\n');
        
        fs.writeFileSync(listFile, videoList);
        console.log(`📝 Lista de videos creada: ${listFile}`);
        console.log(`📝 Videos a concatenar:\n${videoList}`);
        
        const command = ffmpeg();
        
        // Concatenar videos
        command.input(listFile)
          .inputOptions([
            '-f', 'concat',
            '-safe', '0'
          ]);
        
        // Agregar audio si existe
        if (audioPath) {
          command.input(audioPath);
        }
        
        const outputOptions = [
          '-c:v', 'copy', // No recodificar video
          '-movflags', '+faststart',
          '-avoid_negative_ts', 'make_zero'
        ];
        
        // Si hay audio, configurarlo
        if (audioPath) {
          outputOptions.push('-c:a', 'aac');
          outputOptions.push('-b:a', '128k');
          outputOptions.push('-ar', '44100');
          outputOptions.push('-map', '0:v'); // Video concatenado
          outputOptions.push('-map', '1:a'); // Audio
        }
        
        command
          .outputOptions(outputOptions)
          .output(outputPath)
          .on('start', (commandLine) => {
            console.log('📹 Comando FFmpeg para concatenación final:', commandLine);
          })
          .on('progress', (progress) => {
            if (progress.percent) {
              console.log(`⏳ Progreso concatenación: ${Math.round(progress.percent)}%`);
            }
          })
          .on('end', () => {
            console.log('✅ Video final concatenado exitosamente');
            
            // Limpiar archivos temporales
            tempVideos.forEach(tempVideo => {
              try {
                if (fs.existsSync(tempVideo)) {
                  fs.unlinkSync(tempVideo);
                  console.log(`🗑️ Video temporal limpiado: ${path.basename(tempVideo)}`);
                }
              } catch (e) {
                console.log('⚠️ No se pudo limpiar video temporal:', e.message);
              }
            });
            
            try {
              if (fs.existsSync(listFile)) {
                fs.unlinkSync(listFile);
                console.log('🗑️ Lista temporal limpiada');
              }
            } catch (e) {
              console.log('⚠️ No se pudo limpiar lista temporal:', e.message);
            }
            
            resolveCat();
          })
          .on('error', (err) => {
            console.error('❌ Error en concatenación final:', err);
            rejectCat(err);
          })
          .run();
      });
    };
    
    // Ejecutar proceso completo
    createAllTempVideos()
      .then(() => concatenateVideos())
      .then(() => {
        console.log('✅ Video simple generado exitosamente con método de concatenación');
        
        // Verificar duración final
        if (fs.existsSync(outputPath)) {
          const stats = fs.statSync(outputPath);
          console.log(`📊 Archivo generado: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
          
          exec(`ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${outputPath}"`, (error, stdout) => {
            if (!error && stdout.trim()) {
              const actualDuration = parseFloat(stdout.trim());
              console.log(`⏱️ Duración real del video: ${actualDuration.toFixed(2)} segundos`);
              console.log(`🎯 Duración esperada: ${(duracionPorImagen * imagenes.length).toFixed(2)} segundos`);
            }
          });
        }
        
        resolve(outputPath);
      })
      .catch((error) => {
        console.error('❌ Error en proceso de generación:', error);
        
        // Limpiar archivos temporales en caso de error
        tempVideos.forEach(tempVideo => {
          try {
            if (fs.existsSync(tempVideo)) {
              fs.unlinkSync(tempVideo);
            }
          } catch (e) {
            // Ignorar errores de limpieza
          }
        });
        
        reject(error);
      });
  });
}

// Función para combinar secciones de video simple
async function combinarSeccionesVideoSimple(videosSeccionesTemp, finalOutputPath) {
  return new Promise((resolve, reject) => {
    console.log('🔗 Concatenando todas las secciones del video simple...');
    
    const listFile = path.join(process.cwd(), 'temp', `concat_list_simple_${Date.now()}.txt`);
    const listContent = videosSeccionesTemp.map(video => `file '${video}'`).join('\n');
    
    fs.writeFileSync(listFile, listContent);
    
    const args = [
      '-f', 'concat',
      '-safe', '0',
      '-i', listFile,
      '-c', 'copy',
      '-y',
      finalOutputPath
    ];
    
    const ffmpegProcess = spawn('ffmpeg', args);
    
    let stderrData = '';
    
    ffmpegProcess.stderr.on('data', (data) => {
      stderrData += data.toString();
    });
    
    ffmpegProcess.on('close', (code) => {
      // Limpiar archivo de lista temporal
      try {
        if (fs.existsSync(listFile)) {
          fs.unlinkSync(listFile);
        }
      } catch (e) {
        console.log('⚠️ No se pudo limpiar archivo de lista:', e.message);
      }
      
      if (code === 0) {
        console.log('✅ Video simple final concatenado exitosamente');
        resolve(finalOutputPath);
      } else {
        console.error('❌ Error en concatenación FFmpeg (video simple):', stderrData);
        reject(new Error(`FFmpeg falló con código ${code}`));
      }
    });
    
    ffmpegProcess.on('error', (err) => {
      console.error('❌ Error ejecutando FFmpeg (video simple):', err);
      reject(err);
    });
  });
}

// ================================
// FUNCIONES DE ANIMACIÓN AVANZADAS CON TRANSICIONES
// ================================

// Función para generar frames animados usando Canvas con transiciones avanzadas
async function generateAnimatedFrames(imagePath, outputPath, duration, animationType, smoothness = 'standard', useGPU = false) {
  // FPS optimizado según el nivel de suavidad seleccionado
  let fps = 25;
  
  if (smoothness === 'standard') {
    if (duration > 10) fps = 20;      // 20 FPS para videos de 10-30s
    if (duration > 30) fps = 15;      // 15 FPS para videos de 30-60s
    if (duration > 60) fps = 10;      // 10 FPS para videos de 1-2 minutos  
    if (duration > 120) fps = 8;      // 8 FPS para videos muy largos (>2 min)
  } else if (smoothness === 'smooth') {
    if (duration > 10) fps = 25;      // 25 FPS para videos de 10-30s
    if (duration > 30) fps = 20;      // 20 FPS para videos de 30-60s
    if (duration > 60) fps = 15;      // 15 FPS para videos de 1-2 minutos  
    if (duration > 120) fps = 12;     // 12 FPS para videos muy largos (>2 min)
  } else if (smoothness === 'ultra') {
    if (duration > 10) fps = 30;      // 30 FPS para videos de 10-30s
    if (duration > 30) fps = 25;      // 25 FPS para videos de 30-60s
    if (duration > 60) fps = 20;      // 20 FPS para videos de 1-2 minutos  
    if (duration > 120) fps = 15;     // 15 FPS para videos muy largos (>2 min)
  }
  
  const totalFrames = duration * fps;
  const tempDir = path.join(process.cwd(), 'temp_frames');
  
  console.log(`🎬 Generando ${totalFrames} frames a ${fps} FPS para duración de ${duration}s (calidad: ${smoothness})`);
  
  // Crear directorio temporal para los frames
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  
  try {
    // Verificar que es un archivo de imagen válido
    const validImageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
    const fileExtension = path.extname(imagePath).toLowerCase();
    
    console.log(`🖼️ Procesando archivo: ${imagePath}`);
    console.log(`📄 Extensión detectada: "${fileExtension}"`);
    
    if (!validImageExtensions.includes(fileExtension)) {
      throw new Error(`Tipo de imagen no soportado: "${fileExtension}" para archivo ${path.basename(imagePath)}`);
    }
    
    // Verificar que el archivo existe
    if (!fs.existsSync(imagePath)) {
      throw new Error(`Archivo no encontrado: ${imagePath}`);
    }
    
    console.log(`📂 Cargando imagen: ${path.basename(imagePath)} (${fileExtension})`);
    
    // Cargar la imagen original
    const image = await loadImage(imagePath);
    
    // Para videos muy largos, usar lotes más grandes para mejor rendimiento
    const batchSize = duration > 60 ? 20 : 50; // Lotes más pequeños para videos largos
    
    for (let batchStart = 0; batchStart < totalFrames; batchStart += batchSize) {
      const batchEnd = Math.min(batchStart + batchSize, totalFrames);
      
      console.log(`🎥 Procesando frames ${batchStart + 1}-${batchEnd} de ${totalFrames}`);
      
      // Generar frames del lote actual
      for (let frame = batchStart; frame < batchEnd; frame++) {
        const progress = frame / (totalFrames - 1); // 0 a 1
        
        // Función de easing para suavizar las transiciones (ease-in-out cubic)
        const easeInOutCubic = (t) => {
          return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        };
        
        // Función de easing suave (ease-out sine) para movimientos más naturales
        const easeOutSine = (t) => {
          return Math.sin((t * Math.PI) / 2);
        };
        
        // Aplicar easing al progreso para animaciones más fluidas
        const easedProgress = easeInOutCubic(progress);
        
        // Crear canvas de 1920x1080
        const canvas = createCanvas(1920, 1080);
        const ctx = canvas.getContext('2d');
        
        // Fondo negro
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, 1920, 1080);
        
        // Calcular aspect ratio de la imagen original y del canvas
        const imageAspectRatio = image.width / image.height;
        const canvasAspectRatio = 1920 / 1080;
        
        // Calcular dimensiones manteniendo aspect ratio
        let baseWidth, baseHeight;
        
        if (imageAspectRatio > canvasAspectRatio) {
          // Imagen más ancha: ajustar por ancho
          baseWidth = 1920;
          baseHeight = 1920 / imageAspectRatio;
        } else {
          // Imagen más alta: ajustar por alto
          baseHeight = 1080;
          baseWidth = 1080 * imageAspectRatio;
        }
        
        // Calcular posición centrada
        const baseCenterX = (1920 - baseWidth) / 2;
        const baseCenterY = (1080 - baseHeight) / 2;
        
        // Aplicar efectos de animación manteniendo aspect ratio
        let drawWidth, drawHeight, drawX, drawY;
        
        switch (animationType) {
          case 'zoom-in':
            // Zoom in: escala de 1.0 a 1.3 con easing suave
            const zoomInScale = 1 + (easedProgress * 0.3);
            drawWidth = baseWidth * zoomInScale;
            drawHeight = baseHeight * zoomInScale;
            drawX = baseCenterX - ((drawWidth - baseWidth) / 2);
            drawY = baseCenterY - ((drawHeight - baseHeight) / 2);
            break;
            
          case 'zoom-out':
            // Zoom out: escala de 1.3 a 1.0 con easing suave
            const zoomOutScale = 1.3 - (easedProgress * 0.3);
            drawWidth = baseWidth * zoomOutScale;
            drawHeight = baseHeight * zoomOutScale;
            drawX = baseCenterX - ((drawWidth - baseWidth) / 2);
            drawY = baseCenterY - ((drawHeight - baseHeight) / 2);
            break;
            
          case 'pan-right':
            // Pan derecha: imagen más grande que se mueve con easing suave
            const panScale = 1.2;
            drawWidth = baseWidth * panScale;
            drawHeight = baseHeight * panScale;
            const panOffsetX = ((drawWidth - baseWidth) / 2) + ((drawWidth - 1920) * easedProgress);
            drawX = baseCenterX - panOffsetX;
            drawY = baseCenterY - ((drawHeight - baseHeight) / 2);
            break;
            
          case 'pan-left':
            // Pan izquierda: imagen más grande que se mueve al revés con easing suave
            const leftPanScale = 1.2;
            drawWidth = baseWidth * leftPanScale;
            drawHeight = baseHeight * leftPanScale;
            const leftPanOffsetX = ((drawWidth - baseWidth) / 2) + ((drawWidth - 1920) * (1 - easedProgress));
            drawX = baseCenterX - leftPanOffsetX;
            drawY = baseCenterY - ((drawHeight - baseHeight) / 2);
            break;
            
          case 'fade-in':
            // Fade in: opacidad de 0 a 1
            drawWidth = baseWidth;
            drawHeight = baseHeight;
            drawX = baseCenterX;
            drawY = baseCenterY;
            ctx.globalAlpha = easedProgress;
            break;
            
          case 'slide-in-left':
            // Deslizar desde la izquierda
            drawWidth = baseWidth;
            drawHeight = baseHeight;
            drawX = baseCenterX - (1920 * (1 - easedProgress));
            drawY = baseCenterY;
            break;
            
          case 'slide-in-right':
            // Deslizar desde la derecha
            drawWidth = baseWidth;
            drawHeight = baseHeight;
            drawX = baseCenterX + (1920 * (1 - easedProgress));
            drawY = baseCenterY;
            break;
            
          case 'rotate-zoom':
            // Rotación con zoom
            const rotateZoomScale = 1 + (easedProgress * 0.2);
            const rotation = easedProgress * Math.PI * 2; // Una rotación completa
            drawWidth = baseWidth * rotateZoomScale;
            drawHeight = baseHeight * rotateZoomScale;
            
            ctx.save();
            ctx.translate(1920/2, 1080/2);
            ctx.rotate(rotation);
            ctx.translate(-drawWidth/2, -drawHeight/2);
            drawX = 0;
            drawY = 0;
            break;
            
          case 'none':
          default:
            // Sin animación: imagen estática centrada manteniendo aspect ratio
            drawWidth = baseWidth;
            drawHeight = baseHeight;
            drawX = baseCenterX;
            drawY = baseCenterY;
        }
        
        // Dibujar la imagen en el canvas manteniendo aspect ratio
        ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
        
        // Restaurar contexto si se usó transformación
        if (animationType === 'rotate-zoom') {
          ctx.restore();
        }
        
        // Resetear alpha si se usó
        if (animationType === 'fade-in') {
          ctx.globalAlpha = 1;
        }
        
        // Guardar el frame como imagen con calidad ajustada según duración
        const quality = duration > 60 ? 0.7 : 0.85; // Menor calidad para videos largos
        const framePath = path.join(tempDir, `frame_${String(frame).padStart(6, '0')}.jpg`);
        const buffer = canvas.toBuffer('image/jpeg', { quality });
        fs.writeFileSync(framePath, buffer);
      }
      
      // Forzar liberación de memoria entre lotes
      if (global.gc) {
        global.gc();
      }
    }
    
    // Convertir frames a video usando FFmpeg con aceleración GPU opcional
    await new Promise((resolve, reject) => {
      const videoCodec = useGPU ? 'h264_nvenc' : 'libx264';
      const outputOptions = [
        '-c:v', videoCodec,
        '-pix_fmt', 'yuv420p',
        '-t', duration.toString()
      ];
      
      if (useGPU) {
        // Opciones optimizadas para NVENC
        outputOptions.push(
          '-preset', 'fast',        // Preset rápido para NVENC
          '-rc', 'vbr',             // Variable bitrate
          '-cq', '23',              // Calidad constante
          '-b:v', '8M',             // Bitrate target
          '-maxrate', '15M',        // Bitrate máximo
          '-bufsize', '30M'         // Buffer size
        );
      } else {
        // Opciones para CPU
        outputOptions.push('-preset', duration > 60 ? 'ultrafast' : 'fast');
      }
      
      console.log(`🎬 Convirtiendo frames a video usando ${useGPU ? 'GPU (NVENC)' : 'CPU'}...`);
      
      ffmpeg()
        .input(path.join(tempDir, 'frame_%06d.jpg'))
        .inputOptions(['-framerate', fps.toString()])
        .outputOptions(outputOptions)
        .output(outputPath)
        .on('end', () => {
          console.log(`✅ Video generado exitosamente con ${useGPU ? 'aceleración GPU' : 'CPU'}`);
          resolve();
        })
        .on('error', reject)
        .run();
    });
    
    // Limpiar frames temporales
    const files = fs.readdirSync(tempDir);
    for (const file of files) {
      fs.unlinkSync(path.join(tempDir, file));
    }
    
  } catch (error) {
    throw error;
  }
}

// Función para generar video de una imagen con transiciones usando Canvas
async function generateImageVideoWithTransitions(imagePath, outputPath, duration, animationType = 'zoom-out', fps = 30) {
  return new Promise(async (resolve, reject) => {
    try {
      console.log(`🎬 Generando video con transición ${animationType} para ${path.basename(imagePath)}`);
      
      // Generar video completo con animación
      await generateAnimatedFrames(imagePath, outputPath, duration, animationType, 'standard', false);
      
      console.log(`✅ Video con transición generado: ${path.basename(outputPath)}`);
      resolve(outputPath);
      
    } catch (error) {
      console.error('Error en generateImageVideoWithTransitions:', error);
      reject(error);
    }
  });
}

// Función para concatenar videos con transición crossfade
async function concatenateVideosWithCrossfade(videoPaths, audioPath, outputPath) {
  return new Promise((resolve, reject) => {
    console.log(`🎬 Concatenando ${videoPaths.length} videos con transición crossfade...`);
    
    if (videoPaths.length === 0) {
      reject(new Error('No hay videos para concatenar'));
      return;
    }
    
    if (videoPaths.length === 1) {
      // Si solo hay un video, no necesitamos crossfade
      const command = ffmpeg(videoPaths[0]);
      if (audioPath) {
        command.input(audioPath);
      }
      command
        .outputOptions(['-c:v libx264', '-crf 23', '-preset medium'])
        .output(outputPath)
        .on('end', () => {
          console.log('✅ Video único procesado correctamente');
          resolve(outputPath);
        })
        .on('error', (err) => {
          console.error('Error procesando video único:', err);
          reject(err);
        })
        .run();
      return;
    }
    
    // Para múltiples videos, creamos filtros de crossfade
    const command = ffmpeg();
    
    // Agregar todos los videos como inputs
    videoPaths.forEach(videoPath => {
      command.input(videoPath);
    });
    
    // Agregar audio si existe
    if (audioPath) {
      command.input(audioPath);
    }
    
    // Construir el filtro complejo para crossfade
    const filterComplex = [];
    const crossfadeDuration = 0.5; // 0.5 segundos de crossfade
    
    // Para múltiples videos, usaremos un enfoque más simple: concatenar con fade
    // Primero, creamos un filtro que ajusta cada video para que tenga fade out al final
    for (let i = 0; i < videoPaths.length; i++) {
      if (i === 0) {
        // Primer video: solo fade out al final
        filterComplex.push(`[${i}:v]fade=t=out:st=9.5:d=0.5[v${i}]`);
      } else if (i === videoPaths.length - 1) {
        // Último video: solo fade in al inicio
        filterComplex.push(`[${i}:v]fade=t=in:st=0:d=0.5[v${i}]`);
      } else {
        // Videos del medio: fade in y fade out
        filterComplex.push(`[${i}:v]fade=t=in:st=0:d=0.5,fade=t=out:st=9.5:d=0.5[v${i}]`);
      }
    }
    
    // Ahora concatenamos todos los videos con fade
    const inputLabels = videoPaths.map((_, i) => `[v${i}]`).join('');
    filterComplex.push(`${inputLabels}concat=n=${videoPaths.length}:v=1:a=0[outv]`);
    
    const outputOptions = [
      '-filter_complex', filterComplex.join(';'),
      '-map', '[outv]',
      '-c:v', 'libx264',
      '-crf', '23',
      '-preset', 'medium',
      '-pix_fmt', 'yuv420p'
    ];
    
    // Si hay audio, mapearlo también
    if (audioPath) {
      outputOptions.push('-map', `${videoPaths.length}:a`);
      outputOptions.push('-c:a', 'aac');
      outputOptions.push('-b:a', '128k');
    }
    
    command
      .outputOptions(outputOptions)
      .output(outputPath)
      .on('start', (commandLine) => {
        console.log('🎬 Comando FFmpeg para crossfade:', commandLine);
      })
      .on('progress', (progress) => {
        if (progress.percent) {
          console.log(`⏳ Progreso crossfade: ${Math.round(progress.percent)}%`);
        }
      })
      .on('end', () => {
        console.log('✅ Videos concatenados con crossfade exitosamente');
        resolve(outputPath);
      })
      .on('error', (err) => {
        console.error('❌ Error en concatenación con crossfade:', err);
        reject(err);
      })
      .run();
  });
}

// Endpoint para probar el sistema automático de ComfyUI
app.post('/test-comfyui-auto', async (req, res) => {
  try {
    console.log('🧪 Iniciando prueba del sistema automático de ComfyUI...');
    
    // Probar iniciar ComfyUI
    const started = await startComfyUI();
    if (!started) {
      return res.status(500).json({ 
        success: false, 
        error: 'No se pudo iniciar ComfyUI automáticamente' 
      });
    }
    
    // Esperar un momento y luego cerrarlo
    console.log('⏳ Esperando 5 segundos antes de cerrar...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    const stopped = await stopComfyUI();
    
    res.json({ 
      success: true, 
      message: 'Sistema automático de ComfyUI probado exitosamente',
      started: started,
      stopped: stopped
    });
    
  } catch (error) {
    console.error('❌ Error en prueba automática:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Endpoint para probar el sistema automático de Applio
app.post('/test-applio-auto', async (req, res) => {
  try {
    console.log('🧪 Iniciando prueba del sistema automático de Applio...');
    
    // Probar iniciar Applio
    const started = await startApplio();
    if (!started) {
      return res.status(500).json({ 
        success: false, 
        error: 'No se pudo iniciar Applio automáticamente' 
      });
    }
    
    // Verificar conexión después del inicio
    console.log('✅ Verificando conexión con Applio...');
    const isConnected = await applioClient.checkConnection();
    
    res.json({ 
      success: true, 
      message: 'Sistema automático de Applio probado exitosamente - Applio permanece abierto',
      started: started,
      connected: isConnected,
      status: 'Applio permanece ejecutándose para futuras pruebas'
    });
    
  } catch (error) {
    console.error('❌ Error en prueba automática de Applio:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

app.listen(PORT, async () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
  
  // Verificar conexión con ComfyUI
  try {
    const connectionCheck = await comfyUIClient.checkConnection();
    if (connectionCheck.success) {
      console.log(`✅ Conectado exitosamente a ComfyUI en http://127.0.0.1:8188`);
      
      // Obtener modelos disponibles
      const modelsInfo = await comfyUIClient.getAvailableModels();
      if (modelsInfo.success) {
        console.log(`📦 Modelos disponibles en ComfyUI: ${modelsInfo.models.length}`);
        if (modelsInfo.models.includes('flux1-dev-fp8.safetensors')) {
          console.log(`🎯 Modelo Flux encontrado y listo para usar`);
        } else {
          console.warn(`⚠️ Modelo Flux no encontrado. Modelos disponibles:`, modelsInfo.models.slice(0, 3));
        }
      }
    } else {
      console.warn(`⚠️ No se pudo conectar a ComfyUI: ${connectionCheck.error}`);
      console.warn(`🔧 Asegúrate de que ComfyUI esté ejecutándose en http://127.0.0.1:8188`);
    }
  } catch (error) {
    console.warn(`⚠️ Error verificando ComfyUI: ${error.message}`);
    console.warn(`🔧 Las funciones de IA local requerirán que ComfyUI esté ejecutándose`);
  }
});

// Manejadores para cerrar ComfyUI y Applio cuando la aplicación se cierre
process.on('SIGINT', async () => {
  console.log('\n🛑 Cerrando aplicación...');
  console.log('🔄 Cerrando ventana CMD de ComfyUI...');
  await stopComfyUI();
  console.log('🔄 Cerrando ventana CMD de Applio...');
  await stopApplio();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Terminando aplicación...');
  console.log('🔄 Cerrando ventana CMD de ComfyUI...');
  await stopComfyUI();
  console.log('🔄 Cerrando ventana CMD de Applio...');
  await stopApplio();
  process.exit(0);
});

process.on('beforeExit', async () => {
  console.log('🔄 Cerrando ventanas CMD antes de salir...');
  await stopComfyUI();
  await stopApplio();
});
