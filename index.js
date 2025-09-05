import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { GoogleGenAI, Modality } from "@google/genai";
import OpenAI from 'openai';
import wav from 'wav';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import ApplioClient from "./applio-client.js";
import { transcribeAudio, getAudioTracks } from "./transcriber.js";
import multer from 'multer';

const app = express();
const PORT = 3000;

// Configurar cliente Applio
const applioClient = new ApplioClient();

app.use(cors());
app.use(bodyParser.json());
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

const ai = new GoogleGenAI({
  apiKey: process.env.GOOGLE_API_KEY,
});

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
        return {
          text: response.choices[0].message.content
        };
        
      } else {
        // Usar Google AI (comportamiento existente)
        const params = {
          model: `models/${model}`
        };
        
        // Si promptOrHistory es un array (historial de conversación)
        if (Array.isArray(promptOrHistory)) {
          params.contents = promptOrHistory;
        } else {
          params.contents = promptOrHistory;
        }
        
        if (systemInstruction) {
          params.config = { systemInstruction };
        }
        
        const response = await ai.models.generateContent(params);
        console.log(`✅ Contenido generado exitosamente con Google AI en intento ${attempt}`);
        return response;
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

    // Llamar a la IA para generar metadatos
    const genAI = new GoogleGenAI(process.env.GEMINI_API_KEY);
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
          const projectState = JSON.parse(fs.readFileSync(projectStateFile, 'utf8'));
          projects.push({
            ...projectState,
            folderPath: folder,
            sectionsCompleted: projectState.completedSections.length,
            lastModifiedDate: new Date(projectState.lastModified).toLocaleString()
          });
        } catch (parseError) {
          console.warn(`⚠️ Error leyendo proyecto ${folder}:`, parseError);
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
    
    if (!fs.existsSync(projectStateFile)) {
      return null;
    }
    
    const projectState = JSON.parse(fs.readFileSync(projectStateFile, 'utf8'));
    
    // Cargar datos adicionales de cada sección completada
    for (const section of projectState.completedSections) {
      const sectionDir = path.join('./public/outputs', folderName, `seccion_${section.section}`);
      
      // Verificar si existen las imágenes
      if (section.hasImages && fs.existsSync(sectionDir)) {
        const imageFiles = fs.readdirSync(sectionDir).filter(file => 
          file.endsWith('.png') || file.endsWith('.jpg') || file.endsWith('.jpeg')
        );
        section.imageFiles = imageFiles.map(file => `outputs/${folderName}/seccion_${section.section}/${file}`);
      }
    }
    
    // 🎬 CARGAR METADATOS DE YOUTUBE SI EXISTEN
    const metadataFile = path.join('./public/outputs', folderName, `${folderName}_youtube_metadata.txt`);
    if (fs.existsSync(metadataFile)) {
      try {
        const metadataContent = fs.readFileSync(metadataFile, 'utf8');
        console.log(`📽️ Metadatos de YouTube encontrados para ${folderName}`);
        
        // Si no hay metadatos en el estado pero sí en archivo, agregarlos
        if (!projectState.youtubeMetadata) {
          projectState.youtubeMetadata = {
            generatedAt: fs.statSync(metadataFile).mtime.toISOString(),
            content: metadataContent,
            filename: `${folderName}_youtube_metadata.txt`,
            fileExists: true
          };
          
          console.log(`✅ Metadatos cargados desde archivo para proyecto ${folderName}`);
        } else {
          // Asegurar que el flag de archivo existe esté presente
          projectState.youtubeMetadata.fileExists = true;
        }
      } catch (error) {
        console.error(`❌ Error cargando metadatos de YouTube:`, error);
      }
    }
    
    return projectState;
  } catch (error) {
    console.error('❌ Error cargando estado del proyecto:', error);
    return null;
  }
}

// Función para crear nombre de carpeta seguro basado en el tema
function createSafeFolderName(topic) {
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '') // Remover caracteres especiales
    .replace(/\s+/g, '_') // Reemplazar espacios con guiones bajos
    .substring(0, 50); // Limitar longitud
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
  // Usar nombre personalizado si se proporciona, sino usar el tema
  const folderName = customFolderName && customFolderName.trim() 
    ? createSafeFolderName(customFolderName.trim())
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
    safeTopicName: folderName
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

// Función para generar prompts según el estilo seleccionado
function generateScriptPrompt(style, topic, sections, section, customStyleInstructions = null, chapterStructure = null, previousChapterContent = null) {
  if (style === 'comedy') {
    return generateComedyPrompt(topic, sections, section, chapterStructure, previousChapterContent);
  } else if (style && style.startsWith('custom_') && customStyleInstructions) {
    return generateCustomPrompt(topic, sections, section, customStyleInstructions, chapterStructure, previousChapterContent);
  } else {
    return generateProfessionalPrompt(topic, sections, section, chapterStructure, previousChapterContent);
  }
}

// Función para generar prompt con estilo personalizado
function generateCustomPrompt(topic, sections, section, customInstructions, chapterStructure = null, previousChapterContent = null) {
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
- Máximo 300 palabras en total para este capítulo
- Mínimo 250 palabras por capítulo
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
    return `Ahora dame el capítulo ${currentSection} de ${totalSections} del mismo tema.${chapterContext}

MANTÉN EXACTAMENTE EL MISMO ESTILO PERSONALIZADO: ${customInstructions}

ESTRUCTURA REQUERIDA PARA EL CAPÍTULO ${currentSection}:
- Exactamente 3 párrafos detallados
- Máximo 300 palabras en total para este capítulo
- Mínimo 250 palabras por capítulo
- Mantén continuidad narrativa con los capítulos anteriores
- Progresa de manera lógica en el desarrollo del tema
- Sigue el mismo estilo y enfoque que estableciste en los capítulos anteriores
- APLICA ESTRICTAMENTE el estilo personalizado: ${customInstructions}
${chapterStructure ? `- ENFÓCATE en el contenido específico del CAPÍTULO ${currentSection}: "${chapterStructure[currentSection - 1] || 'Sin título'}"` : ''}

FORMATO DE RESPUESTA OBLIGATORIO:
- Responde ÚNICAMENTE con el texto del guión
- NO incluyas explicaciones, comentarios, ni texto adicional
- NO incluyas etiquetas como "Capítulo ${currentSection}:", "Guión:", etc.
- NO incluyas notas, aclaraciones o pensamientos
- El texto debe estar listo para ser usado directamente en TTS
- Comienza directamente con el contenido del guión

${currentSection === totalSections ? `IMPORTANTE: Como este es el ÚLTIMO capítulo (${currentSection}/${totalSections}), DEBES incluir una despedida profesional al final que invite a:
- Comentar sus opiniones sobre el tema presentado
- Suscribirse al canal para más contenido  
- Dar like si disfrutaron el contenido
- Sugerir futuros temas que les gustaría ver

Ejemplo de despedida: "Y así concluye este episodio sobre [tema]... Si este contenido te ha resultado interesante, déjanos un like y suscríbete al canal para más contenido. Compártenos en los comentarios qué otros temas te gustaría que cubramos..."` : 'NO incluyas despedida ya que este no es el último capítulo.'}

🎯 RECORDATORIO CRÍTICO: Debes seguir fielmente este estilo: ${customInstructions}

RECUERDA: RESPONDE SOLO CON EL TEXTO DEL GUIÓN, SIN COMENTARIOS NI EXPLICACIONES ADICIONALES.`;
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
function generateProfessionalPrompt(topic, sections, section, chapterStructure = null, previousChapterContent = null) {
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
- Máximo 300 palabras en total para este capítulo
- Mínimo 250 palabras por capítulo
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

ESTRUCTURA REQUERIDA PARA EL CAPÍTULO ${section}:
- Exactamente 3 párrafos detallados
- Máximo 300 palabras en total para este capítulo
- Mínimo 250 palabras por capítulo
- Mantén continuidad narrativa con los capítulos anteriores
- Progresa de manera lógica en el desarrollo del tema
- Sigue el mismo estilo y enfoque que estableciste en los capítulos anteriores
- CONECTA directamente con el contenido de los capítulos anteriores
- Haz referencias sutiles a información ya mencionada cuando sea relevante
${chapterStructure ? `- ENFÓCATE en el contenido específico del CAPÍTULO ${section}: "${chapterStructure[section - 1] || 'Sin título'}"` : ''}

FORMATO DE RESPUESTA OBLIGATORIO:
- Responde ÚNICAMENTE con el texto del guión
- NO incluyas explicaciones, comentarios, ni texto adicional
- NO incluyas etiquetas como "Capítulo ${section}:", "Guión:", etc.
- NO incluyas notas, aclaraciones o pensamientos
- El texto debe estar listo para ser usado directamente en TTS
- Comienza directamente con el contenido del guión

${section === sections ? `IMPORTANTE: Como este es el ÚLTIMO capítulo (${section}/${sections}), DEBES incluir una despedida profesional al final que invite a:
- Comentar sus opiniones sobre el tema presentado
- Suscribirse al canal para más contenido  
- Dar like si disfrutaron el contenido
- Sugerir futuros temas que les gustaría ver

Ejemplo de despedida: "Y así concluye este episodio sobre [tema]... Si este contenido te ha resultado interesante, déjanos un like y suscríbete a al canal para más contenido. Compártenos en los comentarios qué otros temas te gustaría que cubramos..."` : 'NO incluyas despedida ya que este no es el último capítulo.'}

RECUERDA: RESPONDE SOLO CON EL TEXTO DEL GUIÓN, SIN COMENTARIOS NI EXPLICACIONES ADICIONALES.`;
  }
}

// Función para generar prompt estilo cómico/sarcástico
function generateComedyPrompt(topic, sections, section, chapterStructure = null, previousChapterContent = null) {
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
- Máximo 300 palabras en total para este capítulo
- Mínimo 250 palabras por capítulo
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

ESTRUCTURA REQUERIDA PARA EL CAPÍTULO ${section}:
- Exactamente 3 párrafos detallados
- Máximo 300 palabras en total para este capítulo
- Mínimo 250 palabras por capítulo
- Mantén continuidad narrativa con los capítulos anteriores
- Progresa de manera lógica en el desarrollo del tema
- Sigue el mismo estilo y enfoque que estableciste en los capítulos anteriores
- CONECTA directamente con el contenido de los capítulos anteriores
- Haz referencias sutiles a información ya mencionada cuando sea relevante
${chapterStructure ? `- ENFÓCATE en el contenido específico del CAPÍTULO ${section}: "${chapterStructure[section - 1] || 'Sin título'}"` : ''}
- Mínimo 250 palabras por capítulo
- Mantén continuidad narrativa con los capítulos anteriores
- Progresa de manera lógica en el desarrollo del tema
- Sigue el mismo estilo cómico y absurdo que estableciste
${chapterStructure ? `- ENFÓCATE en el contenido específico del CAPÍTULO ${section}: "${chapterStructure[section - 1] || 'Sin título'}"` : ''}

🎭 FORMATO DEL GUION:
- Usa múltiples voces indicadas con corchetes al menos 4 en cada párrafo
- Usa onomatopeyas y efectos sonoros ridículos
- Las escenas deben sentirse teatrales y exageradas

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

RECUERDA: RESPONDE SOLO CON EL TEXTO DEL GUIÓN, SIN COMENTARIOS NI EXPLICACIONES ADICIONALES.`;
  }
}

app.post('/generate', async (req, res) => {
  try {
    const { topic, folderName, voice, totalSections, currentSection, previousSections, imageCount, promptModifier, imageModel, llmModel, skipImages, googleImages, scriptStyle, customStyleInstructions, applioVoice, applioModel, applioPitch } = req.body;
    
    const selectedVoice = voice || 'Orus';
    const sections = totalSections || 3;
    const section = currentSection || 1;
    const selectedStyle = scriptStyle || 'professional'; // Default al estilo profesional
    const numImages = imageCount || 5; // Default a 5 imágenes si no se especifica
    const additionalInstructions = promptModifier || ''; // Instrucciones adicionales para imágenes
    const selectedImageModel = imageModel || 'gemini2';
    const selectedLlmModel = llmModel || 'gemini-2.5-pro';
    let shouldSkipImages = skipImages === true;
    let shouldUseGoogleImages = googleImages === true;
    
    console.log(`🎯 Solicitud recibida: ${shouldUseGoogleImages ? 'ENLACES GOOGLE' : shouldSkipImages ? 'SIN IMÁGENES' : numImages + ' imágenes'} para la sección ${section}`);
    
    if (!topic) {
      return res.status(400).json({ error: 'Tema requerido' });
    }

    // Crear estructura de carpetas
    const folderStructure = createProjectStructure(topic, section, folderName);
    console.log(`📁 Estructura de carpetas creada: ${folderStructure.sectionDir}`);

    // Crear clave única para la conversación (proyecto)
    // Usar siempre el tema como clave de conversación para mantener continuidad
    // incluso si cambia el nombre de la carpeta
    const projectKey = createSafeFolderName(topic);
    const conversation = getOrCreateConversation(projectKey);
    
    console.log(`💬 Usando conversación: ${projectKey} (basada en tema: "${topic}")`);
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

        const chaptersText = chapterResponse.text || '';
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
      promptContent = generateScriptPrompt(selectedStyle, topic, sections, section, customStyleInstructions, chapterStructure, null);

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
      
      promptContent = generateScriptPrompt(selectedStyle, topic, sections, section, customStyleInstructions, chapterStructure, previousChapterContent);

      // Agregar nueva pregunta al historial
      conversation.history.push({ role: 'user', parts: [{ text: promptContent }] });
    }
    
    // Actualizar sección actual
    conversation.currentSection = section;

    // Generar respuesta usando el historial de conversación
    let systemInstruction;
    if (selectedStyle === 'comedy') {
      systemInstruction = "Eres un escritor de guiones cómicos para YouTube con tono sarcástico y humor negro. IMPORTANTE: Responde ÚNICAMENTE con el texto del guión, sin explicaciones, comentarios, etiquetas o texto adicional. El texto debe estar listo para TTS. Incluye groserías, humor absurdo y múltiples voces entre corchetes. ESTRUCTURA OBLIGATORIA: Exactamente 3 párrafos detallados, máximo 300 palabras total, mínimo 200 palabras. Solo el guión puro.";
    } else if (selectedStyle && selectedStyle.startsWith('custom_') && customStyleInstructions) {
      systemInstruction = `Eres un escritor de guiones para YouTube especializado en el estilo personalizado que el usuario ha definido. IMPORTANTE: Responde ÚNICAMENTE con el texto del guión siguiendo exactamente estas instrucciones de estilo: ${customStyleInstructions}. Sin explicaciones, comentarios, etiquetas o texto adicional. El texto debe estar listo para TTS aplicando fielmente el estilo especificado. ESTRUCTURA OBLIGATORIA: Exactamente 3 párrafos detallados, máximo 250 palabras total, mínimo 200 palabras por sección. Solo el guión puro.`;
    } else {
      systemInstruction = "Eres un escritor profesional de guiones para YouTube. IMPORTANTE: Responde ÚNICAMENTE con el texto del guión, sin explicaciones, comentarios, etiquetas o texto adicional. El texto debe estar listo para TTS. No incluyas pensamientos, notas o aclaraciones. ESTRUCTURA OBLIGATORIA: Exactamente 3 párrafos detallados, máximo 300 palabras total, mínimo 200 palabras. Solo el guión puro.";
    }

    const scriptResponse = await generateUniversalContent(
      selectedLlmModel,
      conversation.history,
      systemInstruction
    );

    console.log(`🔍 scriptResponse:`, typeof scriptResponse, scriptResponse);
    const script = scriptResponse.text || scriptResponse.message?.content || scriptResponse;
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
      const scriptFileName = `${folderStructure.safeTopicName}_seccion_${section}_guion.txt`;
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

    // Verificar si se deben omitir las imágenes o usar Google Images
    if (shouldSkipImages || shouldUseGoogleImages) {
      const modeDescription = shouldUseGoogleImages ? 'Generando prompts para enlaces de Google Images' : 'Omitiendo generación de imágenes, pero generando prompts para mostrar';
      console.log(`🚫 ${modeDescription}`);
      console.log(`🔍 DEBUG SKIP - shouldSkipImages: ${shouldSkipImages}`);
      console.log(`🔍 DEBUG GOOGLE - shouldUseGoogleImages: ${shouldUseGoogleImages}`);
      console.log(`🔍 DEBUG SKIP - numImages: ${numImages}`);
      
      // Generar contenido según el modo seleccionado
      let enhancedPrompts = [];
      
      if (shouldUseGoogleImages) {
        console.log(`🔍 Generando palabras clave para búsquedas de Google de ${numImages} términos...`);
        const keywordsResponse = await generateUniversalContent(
          selectedLlmModel,
          `Analiza este guión de la sección ${section} sobre "${topic}": "${cleanScript}"

          Extrae EXACTAMENTE ${numImages} frases descriptivas EN INGLÉS (entre 1 y 4 palabras cada una) que sean perfectas para búsquedas de imágenes en Google Images y que den contexto específico al contenido. 

          CRITERIOS:
          - Frases descriptivas de 1-4 palabras EN INGLÉS que incluyan contexto específico
          - Términos específicos mencionados en el guión (lugares, personajes, objetos, conceptos) traducidos al inglés con adjetivos descriptivos
          - Frases que generen buenas imágenes de referencia en Google Images con contexto visual
          - Conceptos visuales concretos con detalles específicos, no abstractos
          - Combinaciones de elementos que ayuden a ilustrar visualmente el contenido del guión
          - EN INGLÉS para mejores resultados de búsqueda en Google Images (mayor cantidad de contenido disponible)
          - Incluir detalles como colores, estilos, épocas o características específicas cuando sea relevante
          - Usar terminología en inglés que sea común en búsquedas de imágenes

          IMPORTANTE: Debes devolver EXACTAMENTE ${numImages} frases descriptivas EN INGLÉS separadas por "||KEYWORD||"

          FORMATO DE RESPUESTA OBLIGATORIO:
          english descriptive phrase 1||KEYWORD||english descriptive phrase 2||KEYWORD||english descriptive phrase 3||KEYWORD||...hasta ${numImages} frases

          EJEMPLO PARA 3 FRASES:
          Hyrule Castle medieval fantasy||KEYWORD||Golden Triforce glowing symbol||KEYWORD||Link Master Sword ocarina time

          VERIFICACIÓN: Tu respuesta debe tener exactamente ${numImages - 1} delimitadores "||KEYWORD||" para generar ${numImages} términos.`,
          `Eres un experto en extraer palabras clave para búsquedas visuales. Tu ÚNICA tarea es devolver términos separados por "||KEYWORD||".

REGLAS CRÍTICAS:
1. SIEMPRE usa el delimitador exacto "||KEYWORD||" (sin espacios adicionales)
2. NUNCA generes texto adicional fuera de los términos
3. CUENTA cuidadosamente para generar el número exacto solicitado
4. Cada término debe ser específico y visual
5. Máximo 3-4 palabras por término

Si te piden N términos, tu respuesta debe tener exactamente (N-1) delimitadores "||KEYWORD||".`
        );

        const keywordsText = keywordsResponse.text || '';
        console.log(`📝 DEBUG GOOGLE - Respuesta del modelo: ${keywordsText ? keywordsText.substring(0, 200) + '...' : 'RESPUESTA VACÍA'}`);
        console.log(`🔍 DEBUG GOOGLE - Buscando delimitadores "||KEYWORD||" en la respuesta...`);
        
        const keywords = keywordsText.split('||KEYWORD||').filter(k => k.trim()).slice(0, numImages);
        console.log(`🔍 DEBUG GOOGLE - Delimitadores encontrados: ${keywordsText.split('||KEYWORD||').length - 1}`);
        console.log(`🔍 DEBUG GOOGLE - Keywords después del filtro: ${keywords.length}`);
        console.log(`🔢 DEBUG GOOGLE - Se solicitaron ${numImages} keywords, se generaron ${keywords.length} keywords válidas`);
        console.log(`🎯 DEBUG GOOGLE - Keywords generadas:`, keywords);
        
        enhancedPrompts = keywords.map(keyword => keyword.trim());
      } else {
        console.log(`🎨 Generando prompts para secuencia de ${numImages} imágenes (solo texto)...`);
        const promptsResponse = await generateUniversalContent(
          selectedLlmModel,
          `Basándote en este guión de la sección ${section} sobre "${topic}": "${cleanScript}", crea EXACTAMENTE ${numImages} prompts detallados para generar una SECUENCIA de ${numImages} imágenes que ilustren visualmente el contenido del guión en orden cronológico.

          IMPORTANTE: Debes crear EXACTAMENTE ${numImages} prompts, ni más ni menos.

          ENFOQUE:
          - Las imágenes deben seguir la narrativa del guión paso a paso
          - Cada imagen debe representar una parte específica del guión en orden
          - Enfócate en elementos del lore interno del juego mencionados en el guión
          - Ilustra lugares, personajes, eventos y elementos específicos del guión
          - Mantén consistencia visual entre las ${numImages} imágenes

          INSTRUCCIONES CRÍTICAS PARA EL FORMATO:
          - DEBES dividir el guión en EXACTAMENTE ${numImages} partes cronológicas
          - DEBES crear un prompt independiente para cada parte
          - DEBES separar cada prompt con "||PROMPT||" (sin espacios adicionales)
          - DEBES asegurarte de que haya exactamente ${numImages} prompts en tu respuesta
          - Las imágenes deben contar la historia del guión de forma visual secuencial
          - Incluye detalles específicos mencionados en el texto del guión

          REQUISITOS OBLIGATORIOS para cada prompt:
          - Formato: Aspecto 16:9 (widescreen)
          
          FORMATO DE RESPUESTA OBLIGATORIO:
          DEBES presentar EXACTAMENTE ${numImages} prompts separados por "||PROMPT||" (sin espacios antes o después del delimitador).
          
          ESTRUCTURA REQUERIDA:
          Prompt 1 aquí||PROMPT||Prompt 2 aquí||PROMPT||Prompt 3 aquí||PROMPT||... hasta el Prompt ${numImages}
          
          EJEMPLO PARA 3 PROMPTS (adaptar a ${numImages}):
          Un bosque oscuro con árboles ancianos||PROMPT||Una batalla épica entre guerreros||PROMPT||Un castillo en ruinas bajo la luna
          
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

        const promptsText = promptsResponse.text || '';
        console.log(`📝 DEBUG SKIP - Respuesta del modelo: ${promptsText ? promptsText.substring(0, 200) + '...' : 'RESPUESTA VACÍA'}`);
        console.log(`🔍 DEBUG SKIP - Buscando delimitadores "||PROMPT||" en la respuesta...`);
        
        const imagePrompts = promptsText.split('||PROMPT||').filter(p => p.trim()).slice(0, numImages);
        console.log(`🔍 DEBUG SKIP - Delimitadores encontrados: ${promptsText.split('||PROMPT||').length - 1}`);
        console.log(`🔍 DEBUG SKIP - Prompts después del filtro: ${imagePrompts.length}`);
        console.log(`🔢 DEBUG SKIP - Se solicitaron ${numImages} prompts, se generaron ${imagePrompts.length} prompts válidos`);
        console.log(`🎨 DEBUG SKIP - Primeros 3 prompts:`, imagePrompts.slice(0, 3));
        
        // Aplicar instrucciones adicionales a los prompts si existen
        enhancedPrompts = imagePrompts;
        if (additionalInstructions && additionalInstructions.trim()) {
          console.log(`✅ DEBUG SKIP - Aplicando instrucciones adicionales a prompts: "${additionalInstructions}"`);
          enhancedPrompts = imagePrompts.map((prompt, index) => {
            const enhanced = `${prompt.trim()}. ${additionalInstructions.trim()}`;
            console.log(`🎨 DEBUG SKIP - Prompt ${index + 1} mejorado: ${enhanced.substring(0, 100)}...`);
            return enhanced;
          });
        } else {
          console.log(`❌ DEBUG SKIP - No hay instrucciones adicionales para aplicar a prompts`);
        }
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
${additionalInstructions ? `Instrucciones adicionales aplicadas: ${additionalInstructions}` : 'Sin instrucciones adicionales'}

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
      console.log(`🔍 DEBUG GOOGLE - googleImagesMode:`, shouldUseGoogleImages);

      res.json({ 
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
        imagePrompts: enhancedPrompts,
        voice: selectedVoice,
        currentSection: section,
        totalSections: sections,
        topic: topic,
        isComplete: section >= sections,
        projectFolder: folderStructure.safeTopicName,
        sectionFolder: `seccion_${section}`,
        folderPath: path.relative('./public', folderStructure.sectionDir).replace(/\\/g, '/'),
        imagesSkipped: shouldSkipImages && !shouldUseGoogleImages,
        googleImagesMode: shouldUseGoogleImages,
        chapterStructure: chapterStructure,
        tokenUsage: {
          inputTokens: inputTokens,
          outputTokens: outputTokens,
          totalTokens: totalTokens,
          model: selectedLlmModel
        }
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
    const promptsResponse = await ai.models.generateContent({
      model: `models/${selectedLlmModel}`,
      contents: `Basándote en este guión de la sección ${section} sobre "${topic}" ": "${cleanScript}", crea EXACTAMENTE ${numImages} prompts detallados para generar una SECUENCIA de ${numImages} imágenes que ilustren visualmente el contenido del guión en orden cronológico.

      IMPORTANTE: Debes crear EXACTAMENTE ${numImages} prompts, ni más ni menos.

      ENFOQUE:
      - Las imágenes deben seguir la narrativa del guión paso a paso
      - Cada imagen debe representar una parte específica del guión en orden
      - Enfócate en elementos del lore interno del juego mencionados en el guión
      - Ilustra lugares, personajes, eventos y elementos específicos del guión
      - Mantén consistencia visual entre las ${numImages} imágenes

      INSTRUCCIONES CRÍTICAS PARA EL FORMATO:
      - DEBES dividir el guión en EXACTAMENTE ${numImages} partes cronológicas
      - DEBES crear un prompt independiente para cada parte
      - DEBES separar cada prompt con "||PROMPT||" (sin espacios adicionales)
      - DEBES asegurarte de que haya exactamente ${numImages} prompts en tu respuesta
      - Las imágenes deben contar la historia del guión de forma visual secuencial
      - Incluye detalles específicos mencionados en el texto del guión

      REQUISITOS OBLIGATORIOS para cada prompt:
      - Formato: Aspecto 16:9 (widescreen)
      
      FORMATO DE RESPUESTA OBLIGATORIO:
      DEBES presentar EXACTAMENTE ${numImages} prompts separados por "||PROMPT||" (sin espacios antes o después del delimitador).
      
      ESTRUCTURA REQUERIDA:
      Prompt 1 aquí||PROMPT||Prompt 2 aquí||PROMPT||Prompt 3 aquí||PROMPT||... hasta el Prompt ${numImages}
      
      EJEMPLO PARA 3 PROMPTS (adaptar a ${numImages}):
      Un bosque oscuro con árboles ancianos||PROMPT||Una batalla épica entre guerreros||PROMPT||Un castillo en ruinas bajo la luna
      
      VERIFICACIÓN FINAL: Tu respuesta debe contener exactamente ${numImages - 1} ocurrencias del delimitador "||PROMPT||" para generar ${numImages} prompts.`,
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
        console.log(`📋 Prompt base para imagen ${index + 1}: ${prompt.trim().substring(0, 100)}...`);
        
        // Construir el prompt completo con estilo y agregar instrucciones adicionales al final
        let enhancedPrompt = `${prompt.trim()}.`;

        // Agregar instrucciones adicionales del usuario AL FINAL del prompt si existen
        if (additionalInstructions && additionalInstructions.trim()) {
          enhancedPrompt += `. ${additionalInstructions.trim()}`;
          console.log(`✅ Instrucciones adicionales aplicadas al final de imagen ${index + 1}:`, additionalInstructions);
        } else {
          console.log(`❌ No hay instrucciones adicionales para imagen ${index + 1} (valor: "${additionalInstructions}")`);
        }
        
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
    
    // Si no se proporciona script, intentar leerlo del archivo guardado
    let scriptContent = script;
    if (!scriptContent) {
      console.log(`🔍 Script no proporcionado, intentando leer archivo de sección ${section}...`);
      
      try {
        const folderStructure = createProjectStructure(topic, section, folderName);
        const scriptFileName = `${folderStructure.safeTopicName}_seccion_${section}_guion.txt`;
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
    
    // Crear estructura de carpetas para el audio
    const folderStructure = createProjectStructure(topic, section, folderName);
    
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
    
    // Crear estructura de carpetas
    const folderStructure = createProjectStructure(topic, section, folderName);
    
    console.log(`🎵 Generando audio con Applio Node.js para sección ${section}...`);
    console.log(`🎤 Voz de Applio seleccionada: ${selectedApplioVoice}`);
    console.log(`🎛️ Modelo TTS seleccionado: ${selectedApplioModel}`);
    console.log(`🎵 Pitch seleccionado: ${selectedPitch}`);
    
    try {
      // Verificar conexión con Applio primero
      const isConnected = await applioClient.checkConnection();
      if (!isConnected) {
        throw new Error('Applio no está disponible en el puerto 6969');
      }
      
      // Crear nombre del archivo
      const safeTopicName = createSafeFolderName(topic);
      const fileName = `${safeTopicName}_seccion_${section}_applio_${Date.now()}.wav`;
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
      
      // Retornar la ruta relativa para acceso web
      const relativePath = path.relative('./public', filePath).replace(/\\/g, '/');
      
      res.json({ 
        success: true,
        audioFile: relativePath,
        method: 'Applio Node.js',
        section: section,
        size: result.size,
        message: `Audio generado con Applio para la sección ${section}`
      });
      
    } catch (applioError) {
      console.error('❌ Error con cliente Applio Node.js:', applioError);
      
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

    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash-exp",
      contents: [{
        role: "user",
        parts: [{ text: prompt }]
      }]
    });

    const responseText = response.text;

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

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});
