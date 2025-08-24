import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { GoogleGenAI, Modality } from "@google/genai";
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

// Almacén de conversaciones en memoria (historial por proyecto)
const conversationStore = new Map();

// Función para obtener o crear una conversación
function getOrCreateConversation(projectKey) {
  if (!conversationStore.has(projectKey)) {
    conversationStore.set(projectKey, {
      history: [],
      topic: '',
      totalSections: 0,
      currentSection: 0,
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
  console.log(`🔍 DEBUG - getThumbnailStyleInstructions recibió:`, styleId);
  console.log(`🔍 DEBUG - tipo de styleId:`, typeof styleId);
  
  // Si es un estilo personalizado (enviado desde el frontend)
  if (typeof styleId === 'object' && styleId) {
    console.log(`✅ DEBUG - Usando estilo personalizado:`, styleId.name);
    
    // Construir instrucciones completas usando los colores específicos
    const primaryColor = styleId.primaryColor || 'amarillo';
    const secondaryColor = styleId.secondaryColor || 'blanco';
    const customInstructions = styleId.instructions || '';
    
    const fullInstructions = `El texto debe tener la frase principal en color ${primaryColor} brillante y la frase secundaria en color ${secondaryColor}, ambas con contorno negro grueso, letras brillosas con efecto luminoso y resplandor. Estilo visual: ${customInstructions}`;
    
    console.log(`🎨 DEBUG - Instrucciones construidas:`, fullInstructions);
    return fullInstructions;
  }
  
  // Si es un estilo predeterminado
  if (typeof styleId === 'string' && defaultThumbnailStyles[styleId]) {
    console.log(`✅ DEBUG - Usando estilo predeterminado:`, styleId);
    return defaultThumbnailStyles[styleId].instructions;
  }
  
  // Fallback al estilo predeterminado
  console.log(`⚠️ DEBUG - Usando fallback al estilo default`);
  return defaultThumbnailStyles.default.instructions;
}

// Limpiar conversaciones antiguas cada hora
setInterval(cleanOldConversations, 60 * 60 * 1000);

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
  console.log(`🔍 DEBUG - generateImageWithModel llamada con modelType: "${modelType}"`);
  console.log(`🔍 DEBUG - Tipo de modelType: ${typeof modelType}`);
  console.log(`🔍 DEBUG - ¿Es igual a 'gemini2'?: ${modelType === 'gemini2'}`);
  
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
function generateScriptPrompt(style, topic, sections, section, customStyleInstructions = null) {
  console.log(`🎨 DEBUG BACKEND - generateScriptPrompt llamada:`);
  console.log(`🎨 DEBUG BACKEND - style: "${style}"`);
  console.log(`🎨 DEBUG BACKEND - customStyleInstructions: "${customStyleInstructions}"`);
  console.log(`🎨 DEBUG BACKEND - style.startsWith('custom_'): ${style && style.startsWith('custom_')}`);
  
  if (style === 'comedy') {
    console.log(`🎨 DEBUG BACKEND - Usando estilo comedy`);
    return generateComedyPrompt(topic, sections, section);
  } else if (style && style.startsWith('custom_') && customStyleInstructions) {
    console.log(`🎨 DEBUG BACKEND - Usando estilo personalizado: ${style}`);
    return generateCustomPrompt(topic, sections, section, customStyleInstructions);
  } else {
    console.log(`🎨 DEBUG BACKEND - Usando estilo profesional (default)`);
    return generateProfessionalPrompt(topic, sections, section);
  }
}

// Función para generar prompt con estilo personalizado
function generateCustomPrompt(topic, sections, section, customInstructions) {
  const currentSection = section;
  const totalSections = sections;
  
  if (currentSection === 1) {
    // Primera sección
    return `${customInstructions}

TEMA SOLICITADO: "${topic}"
TOTAL DE SECCIONES: ${sections}

Vamos a crear un guión de YouTube dividido en ${sections} secciones sobre el tema que el usuario ha solicitado.

POR FAVOR, DAME SOLO LA SECCIÓN 1 DE ${sections}.

INSTRUCCIONES GENERALES:
- Crea contenido basado exactamente en lo que el usuario ha pedido en el tema
- Si es sobre lore de videojuegos, enfócate en la historia interna del juego
- Si es sobre desarrollo/creación de videojuegos, enfócate en los aspectos reales de producción
- Si es sobre historia de la industria, enfócate en hechos históricos y datos
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

MANTÉN EXACTAMENTE EL MISMO ESTILO PERSONALIZADO: ${customInstructions}

ESTRUCTURA REQUERIDA PARA LA SECCIÓN ${currentSection}:
- Exactamente 3 párrafos detallados
- Máximo 300 palabras en total para esta sección
- Mínimo 250 palabras por sección
- Mantén continuidad narrativa con las secciones anteriores
- Progresa de manera lógica en el desarrollo del tema
- Sigue el mismo estilo y enfoque que estableciste en las secciones anteriores
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
function generateProfessionalPrompt(topic, sections, section) {
  if (section === 1) {
    return `Eres un escritor profesional especializado en guiones para YouTube del canal que el usuario indique, si no indica entonces es para "Crónicas del Gaming".

TEMA SOLICITADO: "${topic}"
TOTAL DE SECCIONES: ${sections}

Vamos a crear un guión de YouTube dividido en ${sections} secciones sobre el tema que el usuario ha solicitado.

POR FAVOR, DAME SOLO LA SECCIÓN 1 DE ${sections}.

INSTRUCCIONES GENERALES:
- Crea contenido basado exactamente en lo que el usuario ha pedido en el tema
- Si es sobre lore de videojuegos, enfócate en la historia interna del juego
- Si es sobre desarrollo/creación de videojuegos, enfócate en los aspectos reales de producción
- Si es sobre historia de la industria, enfócate en hechos históricos y datos
- Adapta tu estilo narrativo al tipo de contenido solicitado

ESTRUCTURA REQUERIDA PARA LA SECCIÓN 1:
- Exactamente 3 párrafos detallados
- Máximo 300 palabras en total para esta sección
- Mínimo 250 palabras por sección
- Mantén un tono profesional y enganchante
- Establece las bases del tema para las siguientes secciones

FORMATO DE RESPUESTA OBLIGATORIO:
- Responde ÚNICAMENTE con el texto del guión
- NO incluyas explicaciones, comentarios, ni texto adicional
- NO incluyas etiquetas como "Sección 1:", "Guión:", etc.
- NO incluyas notas, aclaraciones o pensamientos
- El texto debe estar listo para ser usado directamente en TTS
- Comienza directamente con el contenido del guión

IMPORTANTE: 
- Esta es la PRIMERA sección, establece los fundamentos del tema
- NO incluyas despedida ya que habrá más secciones
- Basa tu contenido completamente en lo que el usuario solicita en el tema
- RESPONDE SOLO CON EL TEXTO DEL GUIÓN, NADA MÁS`;
  } else {
    return `Ahora dame la sección ${section} de ${sections} del mismo tema.

ESTRUCTURA REQUERIDA PARA LA SECCIÓN ${section}:
- Exactamente 3 párrafos detallados
- Máximo 300 palabras en total para esta sección
- Mínimo 250 palabras por sección
- Mantén continuidad narrativa con las secciones anteriores
- Progresa de manera lógica en el desarrollo del tema
- Sigue el mismo estilo y enfoque que estableciste en las secciones anteriores

FORMATO DE RESPUESTA OBLIGATORIO:
- Responde ÚNICAMENTE con el texto del guión
- NO incluyas explicaciones, comentarios, ni texto adicional
- NO incluyas etiquetas como "Sección ${section}:", "Guión:", etc.
- NO incluyas notas, aclaraciones o pensamientos
- El texto debe estar listo para ser usado directamente en TTS
- Comienza directamente con el contenido del guión

${section === sections ? `IMPORTANTE: Como esta es la ÚLTIMA sección (${section}/${sections}), DEBES incluir una despedida profesional al final que invite a:
- Comentar sus opiniones sobre el tema presentado
- Suscribirse al canal para más contenido  
- Dar like si disfrutaron el contenido
- Sugerir futuros temas que les gustaría ver

Ejemplo de despedida: "Y así concluye este episodio sobre [tema]... Si este contenido te ha resultado interesante, déjanos un like y suscríbete a al canal para más contenido. Compártenos en los comentarios qué otros temas te gustaría que cubramos..."` : 'NO incluyas despedida ya que esta no es la última sección.'}

RECUERDA: RESPONDE SOLO CON EL TEXTO DEL GUIÓN, SIN COMENTARIOS NI EXPLICACIONES ADICIONALES.`;
  }
}

// Función para generar prompt estilo cómico/sarcástico
function generateComedyPrompt(topic, sections, section) {
  if (section === 1) {
    return `Eres un escritor de guiones para gameplays del canal de YouTube Crónicas del Gaming.

Tu tarea es construir guiones con un tono sarcástico, irónico, con humor negro, muchas groserías y un chingo de humor absurdo.

TEMA SOLICITADO: "${topic}"
TOTAL DE SECCIONES: ${sections}

Vamos a crear un guión de YouTube dividido en ${sections} secciones sobre el tema que el usuario ha solicitado.

POR FAVOR, DAME SOLO LA SECCIÓN 1 DE ${sections}.

🎭 FORMATO DEL GUION:

El guion debe leerse como una actuación, además de una narración cronológica.

Usa múltiples voces indicadas con corchetes, por ejemplo:
[voz de narrador serio], [voz sarcástica], [grito desesperado], [voz de niña loca], [voz de viejita], etc.

Las escenas deben sentirse teatrales, exageradas, bizarras y alucinantes.
en algunas ocasiones interpreta lo que los personajes en el guion podrian decir o pensar.

ESTRUCTURA REQUERIDA PARA LA SECCIÓN 1:
- Exactamente 3 párrafos detallados
- Máximo 300 palabras en total para esta sección
- Mínimo 250 palabras por sección
- Mantén un tono sarcástico, irónico y absurdo y muy ácido.
- Establece las bases del tema para las siguientes secciones

PALABRAS Y EXPRESIONES A USAR:
Usas algunas veces palabras como: pinche, wey, pendejo, cabrón, verga, chinga tu madre, me vale verga, come verga, hijo de la verga.

RESTRICCIONES:
- No se permite usar la palabra "show"
- No se permiten chistes sobre políticos ni ex parejas

FORMATO DE RESPUESTA OBLIGATORIO:
- Responde ÚNICAMENTE con el texto del guión
- NO incluyas explicaciones, comentarios, ni texto adicional
- NO incluyas etiquetas como "Sección 1:", "Guión:", etc.
- El texto debe estar listo para ser usado directamente en TTS
- Comienza directamente con el contenido del guión

IMPORTANTE: 
- Esta es la PRIMERA sección, establece los fundamentos del tema
- NO incluyas despedida ya que habrá más secciones
- Basa tu contenido completamente en lo que el usuario solicita en el tema
- RESPONDE SOLO CON EL TEXTO DEL GUIÓN, NADA MÁS`;
  } else {
    return `Ahora dame la sección ${section} de ${sections} del mismo tema.

Mantén el mismo estilo sarcástico, irónico, con humor negro y groserías.

ESTRUCTURA REQUERIDA PARA LA SECCIÓN ${section}:
- Exactamente 3 párrafos detallados
- Máximo 300 palabras en total para esta sección
- Mínimo 250 palabras por sección
- Mantén continuidad narrativa con las secciones anteriores
- Progresa de manera lógica en el desarrollo del tema
- Sigue el mismo estilo cómico y absurdo que estableciste

🎭 FORMATO DEL GUION:
- Usa múltiples voces indicadas con corchetes al menos 4 en cada párrafo
- Usa onomatopeyas y efectos sonoros ridículos
- Las escenas deben sentirse teatrales y exageradas

PALABRAS Y EXPRESIONES A USAR:
Usa muchas palabras como: pinche, wey, pendejo, cabrón, verga, chinga tu madre, me vale verga, come verga.

FORMATO DE RESPUESTA OBLIGATORIO:
- Responde ÚNICAMENTE con el texto del guión
- NO incluyas explicaciones, comentarios, ni texto adicional
- NO incluyas etiquetas como "Sección ${section}:", "Guión:", etc.
- El texto debe estar listo para ser usado directamente en TTS
- Comienza directamente con el contenido del guión

${section === sections ? `IMPORTANTE: Como esta es la ÚLTIMA sección (${section}/${sections}), DEBES incluir una despedida cómica al final que invite a:
- Comentar sus opiniones sobre el tema presentado
- Suscribirse al canal para más contenido  
- Dar like si disfrutaron el contenido
- Sugerir futuros temas que les gustaría ver

Ejemplo de despedida cómica: "Y así concluye este pinche episodio sobre [tema]... Si te cagaste de risa, déjanos un like y suscríbete al canal para más contenido cabrón. Compártenos en los comentarios qué otros temas te gustaría que cubramos, wey..."` : 'NO incluyas despedida ya que esta no es la última sección.'}

RECUERDA: RESPONDE SOLO CON EL TEXTO DEL GUIÓN, SIN COMENTARIOS NI EXPLICACIONES ADICIONALES.`;
  }
}

app.post('/generate', async (req, res) => {
  try {
    const { topic, folderName, voice, totalSections, currentSection, previousSections, imageCount, promptModifier, imageModel, skipImages, scriptStyle, customStyleInstructions } = req.body;
    
    console.log(`🔍 DEBUG REQUEST - Datos recibidos en /generate:`);
    console.log(`🔍 DEBUG REQUEST - topic: "${topic}"`);
    console.log(`🔍 DEBUG REQUEST - scriptStyle: "${scriptStyle}"`);
    console.log(`🔍 DEBUG REQUEST - customStyleInstructions: "${customStyleInstructions || 'N/A'}"`);
    console.log(`🔍 DEBUG REQUEST - skipImages: ${skipImages} (tipo: ${typeof skipImages})`);
    console.log(`🔍 DEBUG REQUEST - imageCount: ${imageCount}`);
    console.log(`🔍 DEBUG REQUEST - Cuerpo completo:`, req.body);
    
    const selectedVoice = voice || 'Orus';
    const sections = totalSections || 3;
    const section = currentSection || 1;
    const selectedStyle = scriptStyle || 'professional'; // Default al estilo profesional
    const numImages = imageCount || 5; // Default a 5 imágenes si no se especifica
    const additionalInstructions = promptModifier || ''; // Instrucciones adicionales para imágenes
    const selectedImageModel = imageModel || 'gemini2'; // Default a gemini2 si no se especifica
    const shouldSkipImages = skipImages === true; // Verificar explícitamente si es true
    
    console.log(`🎯 Solicitud recibida: ${shouldSkipImages ? 'SIN IMÁGENES' : numImages + ' imágenes'} para la sección ${section}`);
    console.log(`📁 Nombre de carpeta personalizado: ${folderName || 'auto-generado'}`);
    console.log(`� Estilo de guión seleccionado: ${selectedStyle}`);
    console.log(`�🎨 Instrucciones adicionales recibidas:`, additionalInstructions);
    console.log(`📊 Tipo de dato additionalInstructions:`, typeof additionalInstructions);
    console.log(`🤖 Modelo de imagen seleccionado: ${selectedImageModel}`);
    console.log(`📏 Longitud additionalInstructions:`, additionalInstructions ? additionalInstructions.length : 0);
    console.log(`✅ ¿Hay instrucciones adicionales?:`, !!additionalInstructions);
    console.log(`🚫 ¿Omitir imágenes?:`, shouldSkipImages);
    console.log(`🔍 DEBUG - skipImages original: ${skipImages}, shouldSkipImages procesado: ${shouldSkipImages}`);
    
    if (!topic) {
      return res.status(400).json({ error: 'Tema requerido' });
    }

    // Crear estructura de carpetas
    const folderStructure = createProjectStructure(topic, section, folderName);
    console.log(`📁 Estructura de carpetas creada: ${folderStructure.sectionDir}`);

    // Crear clave única para la conversación (proyecto)
    const projectKey = folderName ? createSafeFolderName(folderName) : createSafeFolderName(topic);
    const conversation = getOrCreateConversation(projectKey);
    
    console.log(`💬 Usando conversación: ${projectKey}`);
    console.log(`📝 Historial actual: ${conversation.history.length} mensajes`);

    // Paso 1: Generar guión usando conversación continua
    console.log(`📝 Generando guión de YouTube - Sección ${section}/${sections} para el tema: ${topic}...`);
    console.log(`🎭 Usando estilo: ${selectedStyle === 'comedy' ? 'Cómico/Sarcástico' : 'Profesional'}`);
    
    let promptContent;
    
    if (section === 1) {
      // Primera sección: Configurar la conversación inicial
      conversation.topic = topic;
      conversation.totalSections = sections;
      conversation.currentSection = 1;
      conversation.history = []; // Limpiar historial para nueva conversación

      promptContent = generateScriptPrompt(selectedStyle, topic, sections, section, customStyleInstructions);

      // Limpiar historial y agregar mensaje inicial
      conversation.history = [
        { role: 'user', parts: [{ text: promptContent }] }
      ];
      
    } else {
      // Secciones posteriores: Continuar la conversación
      promptContent = generateScriptPrompt(selectedStyle, topic, sections, section, customStyleInstructions);

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

    const scriptResponse = await ai.models.generateContent({
      model: "models/gemini-2.5-flash",
      contents: conversation.history,
      config: {
        systemInstruction: systemInstruction,
      },
    });

    const script = scriptResponse.text;
    
    // Limpiar el script de cualquier texto adicional no deseado
    const cleanScript = cleanScriptText(script);
    
    // Agregar respuesta al historial
    conversation.history.push({ role: 'model', parts: [{ text: cleanScript }] });
    
    console.log(`✅ Guión de la sección ${section} generado usando conversación continua`);
    console.log(`💾 Historial actualizado: ${conversation.history.length} mensajes`);

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

    // Verificar si se deben omitir las imágenes
    if (shouldSkipImages) {
      console.log(`🚫 Omitiendo generación de imágenes, pero generando prompts para mostrar`);
      console.log(`🔍 DEBUG SKIP - shouldSkipImages: ${shouldSkipImages}`);
      console.log(`🔍 DEBUG SKIP - numImages: ${numImages}`);
      
      // Generar prompts para mostrar al usuario aunque no se generen imágenes
      console.log(`🎨 Generando prompts para secuencia de ${numImages} imágenes (solo texto)...`);
      const promptsResponse = await ai.models.generateContent({
        model: "models/gemini-2.5-flash",
        contents: `Basándote en este guión de la sección ${section} sobre "${topic}": "${cleanScript}", crea EXACTAMENTE ${numImages} prompts detallados para generar una SECUENCIA de ${numImages} imágenes que ilustren visualmente el contenido del guión en orden cronológico.

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
      console.log(`📝 DEBUG SKIP - Respuesta del modelo: ${promptsText ? promptsText.substring(0, 200) + '...' : 'RESPUESTA VACÍA'}`);
      console.log(`🔍 DEBUG SKIP - Buscando delimitadores "||PROMPT||" en la respuesta...`);
      
      const imagePrompts = promptsText.split('||PROMPT||').filter(p => p.trim()).slice(0, numImages);
      console.log(`🔍 DEBUG SKIP - Delimitadores encontrados: ${promptsText.split('||PROMPT||').length - 1}`);
      console.log(`🔍 DEBUG SKIP - Prompts después del filtro: ${imagePrompts.length}`);
      console.log(`🔢 DEBUG SKIP - Se solicitaron ${numImages} prompts, se generaron ${imagePrompts.length} prompts válidos`);
      console.log(`🎨 DEBUG SKIP - Primeros 3 prompts:`, imagePrompts.slice(0, 3));
      
      // Aplicar instrucciones adicionales a los prompts si existen
      let enhancedPrompts = imagePrompts;
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
      console.log(`🔍 DEBUG SKIP - imagesSkipped:`, true);

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
        imagesSkipped: true
      });
      return;
    }

    // Paso 2: Crear prompts para imágenes secuenciales basadas en el guión
    console.log(`🎨 Generando prompts para secuencia de ${numImages} imágenes...`);
    const promptsResponse = await ai.models.generateContent({
      model: "models/gemini-2.5-flash",
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
      folderPath: path.relative('./public', folderStructure.sectionDir).replace(/\\/g, '/')
    });
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
    const { script, topic, folderName, currentSection, voice } = req.body;
    
    if (!script || !topic || !currentSection) {
      return res.status(400).json({ 
        error: 'Script, tema y número de sección son requeridos' 
      });
    }

    const section = parseInt(currentSection);
    
    // Crear estructura de carpetas
    const folderStructure = createProjectStructure(topic, section, folderName);
    
    console.log(`🎵 Generando audio con Applio Node.js para sección ${section}...`);
    
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
        model: "fr-FR-RemyMultilingualNeural",
        speed: 0,
        pitch: 0
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
    
    console.log(`🎨 DEBUG - thumbnailStyle recibido:`, thumbnailStyle);
    console.log(`📝 DEBUG - thumbnailInstructions generadas:`, thumbnailInstructions);

    const prompt = `
Basándote en el siguiente tema y guión completo de un video de gaming, genera metadata optimizada para YouTube:

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
   - Incluye palabras clave relevantes del gaming
   - Menciona el contenido principal del video
   - Incluye call-to-action para suscribirse
   - Formato atractivo con emojis

3. **25 ETIQUETAS** (separadas por comas):
   - Palabras clave relacionadas al tema
   - Tags de gaming populares
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

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});
