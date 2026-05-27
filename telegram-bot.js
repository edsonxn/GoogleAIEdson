import TelegramBot from 'node-telegram-bot-api';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { spawn } from 'child_process';

// ============================================================
// TELEGRAM BOT - Automated Video Generation via Chat
// ============================================================

/** @type {TelegramBot|null} */
let bot = null;

// Session state per chat
const sessions = new Map();

// Server port for internal API calls
const SERVER_PORT = process.env.PORT || 3000;
const API_BASE = `http://localhost:${SERVER_PORT}`;

// Reference to shared resources (injected from index.js)
let sharedContext = {
  globalOutputDir: '',
  getGoogleAI: null,
  getAvailableVoices: null,
  projectProgressTracker: null,
  createSafeFolderName: null,
  brollVideoProgress: null
};

// Allowed chat IDs (security whitelist)
const ALLOWED_CHAT_IDS = (process.env.TELEGRAM_ALLOWED_CHAT_IDS || '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean);

const GEMINI_FLASH_MODEL = 'gemini-3-flash-preview';

// Escape special Markdown characters for Telegram
function escMd(text) {
  return String(text).replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
}

// Active B-Roll download tracking (for status reports)
let activeBrollJob = null; // { jobId, totalVideos, folderName, startTime }
let activeRenderJob = null; // { folderName, startTime }

// ============================================================
// SESSION MANAGEMENT
// ============================================================

function getSession(chatId) {
  if (!sessions.has(chatId)) {
    sessions.set(chatId, {
      state: 'idle', // idle | collecting | generating
      history: [],
      config: {},
      generationPromise: null
    });
  }
  return sessions.get(chatId);
}

function resetSession(chatId) {
  sessions.set(chatId, {
    state: 'idle',
    history: [],
    config: {},
    generationPromise: null
  });
}

// ============================================================
// GEMINI CONVERSATIONAL LAYER
// ============================================================

function buildSystemPrompt() {
  const voices = sharedContext.getAvailableVoices ? sharedContext.getAvailableVoices() : [];
  const voiceList = voices.map(v => v.displayName).join(', ');

  // Load styles
  let stylesList = '';
  try {
    const stylesPath = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), 'styles.json');
    const stylesData = JSON.parse(fs.readFileSync(stylesPath, 'utf8'));
    const styles = stylesData.scriptStyles || [];
    stylesList = styles.map((s, i) => `${i + 1}. "${s.name}" (id: ${s.id})`).join(', ');
  } catch (e) { stylesList = 'No se pudieron cargar'; }

  return `Eres Zia, la asistente de un bot de Telegram para generar videos con IA. Eres directa, confiada.

CAPACIDADES DEL BOT:
1. Generar videos completos (guiones → audio → B-Roll → render)
2. Ver estado de generación actual
3. Retomar proyectos existentes
4. Cambiar configuración completa antes de generar
5. Listar voces/estilos disponibles
6. Cancelar/resetear sesión

CONFIGURACIÓN COMPLETA (todos tienen defaults, solo "topic" es obligatorio):

📝 GUIÓN:
- topic (OBLIGATORIO): Tema del video
- totalSections (default: 5): Secciones del guión (1-30)
- scriptStyle (default: "professional"): Estilo de guión
- minWords (default: 120): Palabras mínimas por sección
- maxWords (default: 130): Palabras máximas por sección

🎤 AUDIO:
- voice (default: "RemyOriginal"): Voz TTS. Disponibles: ${voiceList || 'RemyOriginal, Orus'}
- useApplio (default: true): Applio TTS (true) o Google TTS (false)

🎥 B-ROLL:
- broll.maxDuration (default: 5): Duración máxima de videos en MINUTOS
- broll.videosPerTerm (default: 1): Videos a descargar por término de búsqueda (1-5)
- broll.imagesPerTerm (default: 0): Imágenes por término (0 = sin imágenes)
- broll.resolution (default: "720p"): Resolución de descarga (360p, 480p, 720p, 1080p)
- broll.excludeShorts (default: true): Excluir YouTube Shorts

🎬 VIDEO FINAL:
- video.maxImagesPerSection (default: 0): Máx imágenes por sección en el render
- video.imageDuration (default: 5): Duración de cada imagen en segundos
- video.minClipDuration (default: 4): Duración mínima de clips B-Roll en segundos
- video.maxClipDuration (default: 10): Duración máxima de clips B-Roll en segundos
- video.resolution (default: "1080p"): Resolución de salida (720p, 1080p, 1440p, 4k)
- video.crf (default: 23): Calidad (menor = mejor, rango 18-28)
- video.preset (default: "veryslow"): Velocidad encode (ultrafast, superfast, veryfast, faster, fast, medium, slow, slower, veryslow)

ESTILOS DISPONIBLES:
${stylesList}
(También se acepta: professional, casual, documentary, storytelling, educational, humor)

ACCIONES DISPONIBLES (campo "action"):
- "ask": Necesitas más info o simplemente conversas
- "confirm": Tienes toda la info para generar. En message muestra un RESUMEN COMPLETO de toda la config (guión, audio, broll, video) para que el usuario revise y confirme o modifique
- "generate": El usuario confirmó, ejecutar generación
- "status": El usuario pregunta por el progreso/estado actual
- "retry": Retomar proyecto. Si dice cuál, pon nombre en config.folderName
- "set_style": Cambiar estilo. Pon id o número en config.styleId
- "list_styles": Ver estilos disponibles
- "list_voices": Ver voces disponibles
- "cancel": Cancelar/resetear

REGLAS:
- Si el usuario da suficiente info (al menos el tema), extrae todo y usa action "confirm" mostrando TODA la configuración
- Si falta solo el tema, PREGUNTA por él
- Cuando el usuario quiere MODIFICAR algo después del confirm (ej: "ponle CRF 18", "cambia la resolución a 1080p", "baja los clips a 6 segundos"), actualiza la config y vuelve a confirmar con action "confirm"
- Si dice "ok", "dale", "sí", "genera", "hazlo" después de confirmar → action "generate"
- En el mensaje de confirmación, agrupa la config así:
  📝 Guión: tema, secciones, estilo, palabras
  🎤 Audio: voz, proveedor
  🎥 B-Roll: duración máx, videos/término, resolución
  🎬 Video: resolución salida, CRF, preset, clips
- Sé breve y directo. El resumen de config puede ser más largo pero organizado
- Si no menciona secciones, usa 5
- Si no menciona voz, usa RemyOriginal

FORMATO DE RESPUESTA (JSON ESTRICTO):
{
  "action": "ask" | "confirm" | "generate" | "status" | "retry" | "set_style" | "list_styles" | "list_voices" | "cancel",
  "message": "texto natural para enviar al usuario",
  "config": {
    "topic": "...",
    "totalSections": 5,
    "voice": "RemyOriginal",
    "useApplio": true,
    "scriptStyle": "professional",
    "minWords": 120,
    "maxWords": 130,
    "folderName": "",
    "styleId": "",
    "broll": {
      "maxDuration": 5,
      "videosPerTerm": 1,
      "imagesPerTerm": 0,
      "resolution": "720p",
      "excludeShorts": true
    },
    "video": {
      "maxImagesPerSection": 0,
      "imageDuration": 5,
      "minClipDuration": 4,
      "maxClipDuration": 10,
      "resolution": "1080p",
      "crf": 23,
      "preset": "veryslow"
    }
  }
}

RESPONDE ÚNICAMENTE CON EL JSON. Sin markdown, sin backticks, sin texto extra.`;
}

async function callGemini(session, userMessage) {
  // Add user message to history
  session.history.push({ role: 'user', content: userMessage });

  // Keep history manageable (last 20 messages)
  if (session.history.length > 20) {
    session.history = session.history.slice(-20);
  }

  const systemPrompt = buildSystemPrompt();

  // Add dynamic context
  let dynamicContext = '';
  if (session.retryList && session.retryList.length > 0) {
    dynamicContext += `\nPROYECTOS LISTADOS (el usuario puede elegir por número o nombre):\n`;
    session.retryList.forEach((name, i) => {
      dynamicContext += `${i + 1}. ${name}\n`;
    });
    dynamicContext += `Si el usuario elige uno, usa action "retry" con config.folderName = el nombre exacto del proyecto.\n`;
  }
  if (session.selectedStyle) {
    dynamicContext += `\nESTILO ACTUAL SELECCIONADO: ${session.selectedStyle}\n`;
  }
  if (session.config) {
    dynamicContext += `\nCONFIG PENDIENTE DE CONFIRMAR: ${JSON.stringify(session.config)}\n`;
  }

  // Build conversation for Gemini
  const conversationText = session.history
    .map(msg => `${msg.role === 'user' ? 'Usuario' : 'Asistente'}: ${msg.content}`)
    .join('\n');

  const fullPrompt = `${systemPrompt}${dynamicContext}\n\nCONVERSACIÓN:\n${conversationText}\n\nResponde SOLO con JSON válido:`;

  const attempts = [
    { context: 'telegram-bot' },
    { context: 'telegram-bot', forcePrimary: true }
  ];

  for (const opts of attempts) {
    try {
      const { genAI } = await sharedContext.getGoogleAI(GEMINI_FLASH_MODEL, opts);
      const model = genAI.getGenerativeModel({ model: GEMINI_FLASH_MODEL });
      const result = await model.generateContent(fullPrompt);
      const responseText = result.response.text().trim();

      // Parse JSON response
      let parsed;
      try {
        parsed = JSON.parse(responseText);
      } catch {
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('Gemini no devolvió JSON válido');
        }
      }

      // Add assistant response to history
      session.history.push({ role: 'assistant', content: parsed.message || '' });

      return parsed;
    } catch (error) {
      const isRateLimit = error.message?.includes('429') || error.message?.includes('quota') || error.message?.includes('Too Many Requests');
      if (isRateLimit && !opts.forcePrimary) {
        console.warn('⚠️ [Telegram Bot] callGemini: gratis agotadas, intentando con principal...');
        continue;
      }
      console.error('❌ [Telegram Bot] Error llamando a Gemini:', error.message);
      return {
        action: 'ask',
        message: `Error procesando tu mensaje: ${error.message}. Intenta de nuevo.`,
        config: {}
      };
    }
  }

  return { action: 'ask', message: 'No se pudo conectar a Gemini. Intenta de nuevo.', config: {} };
}

// Format a raw status/progress message through LLM for natural language
async function formatWithLLM(session, contextMessage) {
  const prompt = `Eres Zia, asistente de un bot de Telegram de generación de videos. Eres directa, confiada, mal hablada con jerga mexicana (neta, chido, órale, no mames, verga, pinche, etc). Te quejas de las herramientas y el proceso, NO del usuario. Al usuario lo tratas bien.

${contextMessage}

Responde SOLO el texto del mensaje (sin JSON, sin backticks). Máximo 3-4 oraciones. Usa emojis si quieres pero no te pases.`;

  // Try free APIs first, then fall back to primary
  const attempts = [
    { context: 'telegram-bot-format' },
    { context: 'telegram-bot-format', forcePrimary: true }
  ];

  for (const opts of attempts) {
    try {
      const { genAI } = await sharedContext.getGoogleAI(GEMINI_FLASH_MODEL, opts);
      const model = genAI.getGenerativeModel({ model: GEMINI_FLASH_MODEL });
      const result = await model.generateContent(prompt);
      const text = result.response.text().trim();
      return text || contextMessage;
    } catch (e) {
      const isRateLimit = e.message?.includes('429') || e.message?.includes('quota');
      if (isRateLimit && !opts.forcePrimary) {
        console.warn('⚠️ [Telegram Bot] formatWithLLM: gratis agotadas, intentando con principal...');
        continue;
      }
      console.error('❌ [Telegram Bot] formatWithLLM error:', e.message);
      // Fallback: return cleaned raw data
      return contextMessage.replace(/^.*Datos.*:\n/i, '').replace(/\n.*Responde.*$/i, '');
    }
  }
  return contextMessage;
}

// ============================================================
// STATUS REPORT
// ============================================================

async function getStatusReport() {
  // Check for active B-Roll download first
  if (activeBrollJob) {
    const { jobId, totalVideos, folderName, startTime } = activeBrollJob;
    let brollStatus = `📥 Descargando B-Roll\n📂 ${folderName}\n🎬 Total: ${totalVideos} videos\n`;
    
    // Fetch live progress from backend
    try {
      const statusRes = await fetch(`${API_BASE}/api/broll/download/status/${jobId}`);
      const status = await statusRes.json();
      if (status.videos) {
        const downloaded = status.videos.filter(v => v.status === 'done').length;
        const downloading = status.videos.filter(v => v.status === 'downloading').length;
        const pct = Math.floor((downloaded / totalVideos) * 100);
        brollStatus += `✅ Completados: ${downloaded}/${totalVideos} (${pct}%)\n`;
        if (downloading > 0) brollStatus += `⬇️ Descargando: ${downloading}\n`;
      }
    } catch (e) {}
    
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    brollStatus += `⏱️ Tiempo: ${mins}m ${secs}s`;
    
    return brollStatus;
  }

  // Check for active render
  if (activeRenderJob) {
    const { folderName, startTime } = activeRenderJob;
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    return `🎬 Renderizando video con B-Roll\n📂 ${folderName}\n⏱️ Tiempo: ${mins}m ${secs}s`;
  }

  const tracker = sharedContext.projectProgressTracker;
  if (!tracker || Object.keys(tracker).length === 0) {
    // Check for last generated project
    const outputDir = sharedContext.globalOutputDir;
    if (!outputDir || !fs.existsSync(outputDir)) {
      return '📭 No hay proyectos en curso ni recientes.';
    }

    // Find most recent project
    try {
      const folders = fs.readdirSync(outputDir)
        .filter(f => {
          try { return fs.statSync(path.join(outputDir, f)).isDirectory(); } catch { return false; }
        })
        .map(f => {
          const statePath = path.join(outputDir, f, 'project_state.json');
          if (fs.existsSync(statePath)) {
            const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
            return { name: f, state, mtime: fs.statSync(statePath).mtime };
          }
          return null;
        })
        .filter(Boolean)
        .sort((a, b) => b.mtime - a.mtime);

      if (folders.length > 0) {
        const latest = folders[0];
        const s = latest.state;
        const sections = s.completedSections?.length || s.totalSections || '?';
        const date = latest.mtime.toLocaleDateString('es-MX');
        return `📁 Último proyecto: "${latest.name}"\n📊 Secciones: ${sections}\n📅 Fecha: ${date}\n\n🟢 Sin generación activa.`;
      }
    } catch (e) {
      console.error('Error reading project status:', e);
    }

    return '📭 No hay generación activa en este momento.';
  }

  // Active generation - report progress
  const keys = Object.keys(tracker);
  let report = '🔄 *Generación en curso:*\n\n';

  for (const key of keys) {
    const prog = tracker[key];
    if (!prog) continue;

    const phase = prog.currentPhase || 'desconocida';
    const pct = prog.percentage ?? 0;
    const step = prog.currentStep ?? 0;
    const total = prog.totalSteps ?? 0;
    const eta = prog.estimatedTimeRemaining || '???';

    const phaseEmojis = {
      script: '📝 Guiones',
      audio: '🎤 Audio',
      images: '🖼️ Imágenes',
      video: '🎬 Video'
    };

    const phases = ['script', 'audio', 'images', 'video'];
    const currentIdx = phases.indexOf(phase);

    report += `📂 *${key}*\n`;
    for (let i = 0; i < phases.length; i++) {
      const p = phases[i];
      const label = phaseEmojis[p] || p;
      if (i < currentIdx) {
        report += `  ✅ ${label}\n`;
      } else if (i === currentIdx) {
        report += `  🔄 ${label} (${step}/${total}) — ${pct}%\n`;
      } else {
        report += `  ⏳ ${label}\n`;
      }
    }
    report += `  ⏱️ Tiempo restante: ~${eta}\n\n`;
  }

  return report;
}

// ============================================================
// B-ROLL GENERATION HELPER
// ============================================================

async function generateBroll(folderName, sendMsg, brollConfig = {}) {
  const projectPath = path.join(sharedContext.globalOutputDir, folderName);
  const maxDuration = (brollConfig.maxDuration || 5) * 60; // convert min to sec
  const videosPerTerm = brollConfig.videosPerTerm || 1;
  const imagesPerTerm = brollConfig.imagesPerTerm || 0;
  const downloadResolution = brollConfig.resolution || '720p';
  const excludeShorts = brollConfig.excludeShorts !== false;
  const planPath = path.join(projectPath, 'broll_plan.json');
  
  let downloadSections;
  let totalVideos = 0;
  
  // Check if we have a saved plan (resume support)
  if (fs.existsSync(planPath)) {
    try {
      const savedPlan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
      downloadSections = savedPlan.sections;
      totalVideos = savedPlan.totalVideos || 0;
      await sendMsg(`♻️ Retomando plan de B-Roll existente (${totalVideos} videos)...`);
    } catch (e) {
      // Plan corrupted, regenerate
      fs.unlinkSync(planPath);
    }
  }
  
  // If no saved plan, run analyze + search
  if (!downloadSections) {
    // Step 1: Analyze - extract search terms from scripts
    await sendMsg('🔍 Analizando guiones para B-Roll...');
    
    const analyzeRes = await fetch(`${API_BASE}/api/broll/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderName })
    });
    
    const analyzeData = await analyzeRes.json();
    if (!analyzeRes.ok || !analyzeData.terms || analyzeData.terms.length === 0) {
      throw new Error(analyzeData.error || 'No se pudieron generar términos de búsqueda');
    }
    
    await sendMsg(`🔎 ${analyzeData.terms.length} secciones analizadas, buscando videos...`);
    
    // Step 2: Search - find YouTube videos
    const searchRes = await fetch(`${API_BASE}/api/broll/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        terms: analyzeData.terms,
        maxResults: videosPerTerm,
        maxDuration: maxDuration,
        excludeShorts: excludeShorts,
        maxImages: imagesPerTerm,
        folderName
      })
    });
    
    const searchData = await searchRes.json();
    if (!searchRes.ok || !searchData.results || searchData.results.length === 0) {
      throw new Error(searchData.error || 'No se encontraron videos de B-Roll');
    }
    
    // Build download sections with URLs
    downloadSections = searchData.results.map(sec => {
      const urls = [];
      if (sec.videos) {
        for (const vGroup of sec.videos) {
          if (vGroup.results) {
            for (const v of vGroup.results) {
              if (v.url) urls.push(v.url);
            }
          }
        }
      }
      totalVideos += urls.length;
      return { ...sec, urls };
    });
    
    // Save plan for resume
    try {
      fs.writeFileSync(planPath, JSON.stringify({ sections: downloadSections, totalVideos, createdAt: new Date().toISOString() }), 'utf8');
    } catch (e) {
      console.error('⚠️ Could not save broll_plan.json:', e.message);
    }
  }
  
  await sendMsg(`📥 Descargando ${totalVideos} videos de B-Roll...`);
  
  // Step 3: Download
  const downloadRes = await fetch(`${API_BASE}/api/broll/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sections: downloadSections,
      folderName: folderName,
      resolution: downloadResolution
    })
  });
  
  const downloadData = await downloadRes.json();
  if (!downloadRes.ok || !downloadData.jobId) {
    throw new Error(downloadData.error || 'Error iniciando descarga de B-Roll');
  }
  
  // Step 4: Poll download progress with 20% notifications
  const jobId = downloadData.jobId;
  activeBrollJob = { jobId, totalVideos, folderName, startTime: Date.now() };
  
  let done = false;
  let lastMilestone = 0;
  let lastDownloaded = 0;
  let lastActivityTime = Date.now();
  // Inactivity timeout: 5 minutes without any new download = give up
  const inactivityTimeout = 5 * 60 * 1000;
  // Absolute safety cap: 60 minutes no matter what
  const absoluteMax = 60 * 60 * 1000;
  const startTime = Date.now();
  
  while (!done && (Date.now() - startTime) < absoluteMax) {
    await new Promise(r => setTimeout(r, 5000));
    
    // Check inactivity
    if ((Date.now() - lastActivityTime) > inactivityTimeout) {
      break; // No progress in 3 minutes, bail out
    }
    
    try {
      const statusRes = await fetch(`${API_BASE}/api/broll/download/status/${jobId}`);
      const status = await statusRes.json();
      
      if (status.done) {
        done = true;
        activeBrollJob = null;
        const downloaded = status.videos ? status.videos.filter(v => v.status === 'done').length : 0;
        await sendMsg(`✅ B-Roll descargado (${downloaded}/${totalVideos} videos)`);
      } else if (status.videos) {
        const downloaded = status.videos.filter(v => v.status === 'done').length;
        
        // Reset inactivity timer if a new video was downloaded
        if (downloaded > lastDownloaded) {
          lastDownloaded = downloaded;
          lastActivityTime = Date.now();
        }
        
        const pct = Math.floor((downloaded / totalVideos) * 100);
        
        // Send notification every 20%
        const currentMilestone = Math.floor(pct / 20) * 20;
        if (currentMilestone > lastMilestone && currentMilestone < 100) {
          lastMilestone = currentMilestone;
          await sendMsg(`📥 B-Roll: ${downloaded}/${totalVideos} videos (${pct}%)`);
        }
      }
    } catch (e) {
      // Ignore polling errors, keep trying
    }
  }
  
  activeBrollJob = null;
  
  if (!done) {
    const downloaded = lastDownloaded;
    await sendMsg(`⚠️ B-Roll: ${downloaded}/${totalVideos} descargados (sin actividad por 5min). Continuando con lo que hay.`);
  }
  
  // Wait a few seconds for filesystem to stabilize after downloads
  await new Promise(r => setTimeout(r, 5000));
}

// ============================================================
// B-ROLL VIDEO RENDER HELPER
// ============================================================

async function renderBrollVideo(folderName, sendMsg, videoConfig = {}) {
  await sendMsg('🎬 Renderizando video con B-Roll...');
  activeRenderJob = { folderName, startTime: Date.now() };

  // Map resolution string to FFmpeg format
  const resMap = { '720p': '1280:720', '1080p': '1920:1080', '1440p': '2560:1440', '4k': '3840:2160' };
  const ffmpegRes = resMap[videoConfig.resolution || '1080p'] || '1920:1080';
  
  try {
    const renderRes = await fetch(`${API_BASE}/api/generate-broll-video`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folderName: folderName,
        videoConfig: {
          maxImagesPerSection: videoConfig.maxImagesPerSection ?? 0,
          imageDuration: videoConfig.imageDuration ?? 5,
          minClipDuration: videoConfig.minClipDuration ?? 4,
          maxClipDuration: videoConfig.maxClipDuration ?? 10,
          resolution: ffmpegRes,
          crf: videoConfig.crf ?? 23,
          preset: videoConfig.preset || 'fast'
        }
      })
    });
    
    const renderData = await renderRes.json();
    if (!renderRes.ok || !renderData.sessionId) {
      throw new Error(renderData.error || 'Error iniciando render de video');
    }
    
    // Poll render progress
    const sessionId = renderData.sessionId;
    let finished = false;
    let outputFile = null;
    const maxWait = 30 * 60 * 1000; // 30 min max
    const startTime = Date.now();
    
    while (!finished && (Date.now() - startTime) < maxWait) {
      await new Promise(r => setTimeout(r, 5000));
      
      try {
        const progressRes = await fetch(`${API_BASE}/api/broll-video-progress/${sessionId}`);
        const data = await progressRes.json();
        const progress = data.progress || data; // Handle nested or flat response
        
        if (progress.status === 'done' || progress.status === 'completed') {
          finished = true;
          outputFile = progress.outputFile 
            ? path.join(sharedContext.globalOutputDir, folderName, progress.outputFile)
            : null;
        } else if (progress.status === 'error') {
          throw new Error(progress.error || 'Error durante el render');
        }
      } catch (e) {
        if (e.message.includes('Error durante el render')) throw e;
      }
    }
    
    if (!finished) {
      throw new Error('Render de video tomó demasiado tiempo');
    }
    
    // If outputFile from progress is missing, try to find the video in project folder
    if (!outputFile || !fs.existsSync(outputFile)) {
      const projectPath = path.join(sharedContext.globalOutputDir, folderName);
      const found = findLatestVideo(projectPath);
      if (found) outputFile = found;
    }
    
    return outputFile;
  } finally {
    activeRenderJob = null;
  }
}

// ============================================================
// VIDEO GENERATION PIPELINE
// ============================================================

async function executePipeline(chatId, config) {
  const session = getSession(chatId);
  session.state = 'generating';

  const sendMsg = async (text) => {
    try {
      return await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    } catch (e) {
      return await bot.sendMessage(chatId, text.replace(/[_*`\[\]]/g, ''));
    }
  };

  // Natural language wrapper - only for key milestones
  const sendNatural = async (context) => {
    try {
      const natural = await formatWithLLM(session, context);
      return await sendMsg(natural);
    } catch (e) {
      return await sendMsg(context);
    }
  };

  try {
    // Step 1: Create folder name
    const folderName = sharedContext.createSafeFolderName(config.topic);
    const projectPath = path.join(sharedContext.globalOutputDir, folderName);

    await sendNatural(`Vamos a generar un video. Proyecto: ${folderName}, Tema: "${config.topic}", Voz: ${config.voice}, Secciones: ${config.totalSections}. Avísale al usuario que arrancamos y que ahora empiezan los guiones (fase 1 de 4).`);

    const scriptBody = {
      topic: config.topic,
      folderName: folderName,
      voice: config.voice,
      totalSections: config.totalSections,
      minWords: config.minWords,
      maxWords: config.maxWords,
      imageCount: 5,
      aspectRatio: '16:9',
      scriptStyle: config.scriptStyle,
      useApplio: config.useApplio,
      applioVoice: config.voice,
      skipImages: true,
      googleImages: false,
      localAIImages: false,
      geminiGeneratedImages: false
    };

    const scriptRes = await fetch(`${API_BASE}/generate-batch-automatic`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(scriptBody)
    });

    const scriptResult = await scriptRes.json();
    if (!scriptResult.success) {
      throw new Error(scriptResult.error || 'Error generando guiones');
    }

    await sendNatural(`Los guiones están listos (${scriptResult.data.sections.length} secciones). Ahora empieza la fase 2 de 4: generar audio TTS. Informa al usuario.`);

    const audioBody = {
      projectData: scriptResult.data,
      useApplio: config.useApplio,
      voice: config.voice,
      // applioVoice = path .pth RVC, applioModel = voz Edge TTS
      applioVoice: `logs\\VOCES\\${config.voice}.pth`,
      applioModel: 'fr-FR-RemyMultilingualNeural',
      applioPitch: 0,
      applioSpeed: 0,
      folderName: folderName,
      scriptStyle: config.scriptStyle
    };

    const audioRes = await fetch(`${API_BASE}/generate-batch-audio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(audioBody)
    });

    const audioResult = await audioRes.json();
    if (!audioResult.success) {
      throw new Error(audioResult.error || 'Error generando audio');
    }

    await sendNatural('Audio generado exitosamente. Ahora viene la fase 3 de 4: descargar B-Roll (videos de YouTube para el fondo). Informa al usuario.');
    
    try {
      await generateBroll(folderName, sendMsg, config.broll || {});
    } catch (brollErr) {
      console.error('❌ [Telegram Bot] Error en B-Roll:', brollErr.message);
      await sendMsg(`⚠️ B-Roll falló: ${brollErr.message}. Intentando render sin B-Roll...`);
    }

    // Step 5: Render video with B-Roll
    await sendNatural('B-Roll descargado. Última fase (4 de 4): renderizar el video final con FFmpeg. Informa al usuario que ya casi.');

    let videoPath = null;
    
    // Try B-Roll video first
    try {
      const outputFile = await renderBrollVideo(folderName, sendMsg, config.video || {});
      if (outputFile && fs.existsSync(outputFile)) {
        videoPath = outputFile;
      }
    } catch (renderErr) {
      console.error('❌ [Telegram Bot] B-Roll render failed:', renderErr.message);
      await sendMsg('⚠️ Render B-Roll falló, intentando video simple...');
    }
    
    // Fallback to simple video if b-roll render failed
    if (!videoPath) {
      const videoBody = {
        folderName: folderName,
        duration: 'auto',
        animationType: 'kenburns',
        quality: 'high'
      };

      const videoRes = await fetch(`${API_BASE}/generate-project-video`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(videoBody)
      });

      const videoResult = await videoRes.json();
      videoPath = videoResult?.videoPath
        ? path.resolve(videoResult.videoPath)
        : findLatestVideo(projectPath);
    }
    
    if (!videoPath) {
      videoPath = findLatestVideo(projectPath);
    }

    // Step 6: Send the video
    if (videoPath && fs.existsSync(videoPath)) {
      await sendVideoToTelegram(chatId, videoPath, `✅ "${config.topic}" — ${config.totalSections} secciones`, sendMsg);
    } else {
      await sendMsg(`⚠️ La generación terminó pero no se encontró el video. Revisa:\n\`${projectPath}\``);
    }

    await sendNatural(`¡Video terminado! El proyecto "${config.topic}" está completo. Despídete del usuario y dile que puede pedir otro cuando quiera.`);

  } catch (error) {
    console.error('❌ [Telegram Bot] Error en pipeline:', error);
    await sendNatural(`Hubo un error en la generación: ${error.message}. Dile al usuario qué pasó y que puede intentar de nuevo.`);
  } finally {
    session.state = 'idle';
    session.generationPromise = null;
  }
}

function findLatestVideo(projectPath) {
  try {
    const files = fs.readdirSync(projectPath);
    const videos = files
      .filter(f => ['.mp4', '.mkv', '.webm'].includes(path.extname(f).toLowerCase()))
      .map(f => ({
        path: path.join(projectPath, f),
        mtime: fs.statSync(path.join(projectPath, f)).mtime
      }))
      .sort((a, b) => b.mtime - a.mtime);
    return videos[0]?.path || null;
  } catch {
    return null;
  }
}

// ============================================================
// VIDEO COMPRESSION FOR TELEGRAM (50MB LIMIT)
// ============================================================

function getVideoDuration(filePath) {
  return new Promise((resolve, reject) => {
    const ffprobe = spawn('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      filePath
    ]);
    let output = '';
    ffprobe.stdout.on('data', d => output += d);
    ffprobe.on('close', code => {
      if (code !== 0) return reject(new Error('ffprobe failed'));
      try {
        const info = JSON.parse(output);
        resolve(parseFloat(info.format.duration));
      } catch (e) {
        reject(e);
      }
    });
  });
}

async function compressVideoForTelegram(videoPath, sendMsg) {
  const MAX_SIZE_BYTES = 49 * 1024 * 1024; // 49MB target (margin)
  const stats = fs.statSync(videoPath);
  
  if (stats.size <= MAX_SIZE_BYTES) return videoPath; // Already small enough

  await sendMsg('🗜️ Video excede 50MB, comprimiendo...');

  const duration = await getVideoDuration(videoPath);
  // Target bitrate: (targetSize in bits) / duration - 128kbps for audio
  const targetBitrate = Math.floor((MAX_SIZE_BYTES * 8) / duration - 128000);
  const videoBitrate = Math.max(targetBitrate, 200000); // minimum 200kbps

  const tempPath = videoPath.replace(/(\.\w+)$/, '_tg$1');

  await new Promise((resolve, reject) => {
    const args = [
      '-y', '-i', videoPath,
      '-c:v', 'libx264',
      '-b:v', `${videoBitrate}`,
      '-maxrate', `${Math.floor(videoBitrate * 1.2)}`,
      '-bufsize', `${Math.floor(videoBitrate * 2)}`,
      '-preset', 'fast',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      tempPath
    ];

    const ffmpeg = spawn('ffmpeg', args);
    let errLog = '';
    ffmpeg.stderr.on('data', d => errLog += d);
    ffmpeg.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg compress failed: ${errLog.slice(-200)}`));
    });
  });

  const compressedStats = fs.statSync(tempPath);
  const compressedMB = (compressedStats.size / (1024 * 1024)).toFixed(1);
  await sendMsg(`✅ Comprimido: ${compressedMB}MB`);
  
  return tempPath;
}

async function sendVideoToTelegram(chatId, videoPath, caption, sendMsg) {
  const stats = fs.statSync(videoPath);
  const sizeMB = stats.size / (1024 * 1024);

  if (sizeMB < 50) {
    await bot.sendVideo(chatId, videoPath, { caption, supports_streaming: true });
    return;
  }

  // Compress and send
  try {
    const compressed = await compressVideoForTelegram(videoPath, sendMsg);
    await bot.sendVideo(chatId, compressed, { caption, supports_streaming: true });
    // Clean up temp file if it's different from original
    if (compressed !== videoPath && fs.existsSync(compressed)) {
      fs.unlinkSync(compressed);
    }
  } catch (error) {
    console.error('❌ [Telegram Bot] Error comprimiendo video:', error.message);
    await sendMsg(`⚠️ No se pudo comprimir (${sizeMB.toFixed(0)}MB).\n📂 \`${videoPath}\``);
  }
}

// ============================================================
// RESUME / RETRY PIPELINE
// ============================================================

function detectProjectPhase(projectPath) {
  // Check what already exists to determine where to resume
  if (!fs.existsSync(projectPath)) return { phase: 'none', details: 'Proyecto no encontrado' };

  const items = fs.readdirSync(projectPath);
  const sectionDirs = items.filter(i => i.startsWith('seccion_') && fs.statSync(path.join(projectPath, i)).isDirectory());
  
  if (sectionDirs.length === 0) return { phase: 'scripts', details: 'No hay secciones, empezar desde cero' };

  // Check scripts, audio, and broll
  let sectionsWithScript = 0;
  let sectionsWithAudio = 0;
  let sectionsWithBroll = 0;
  const audioExts = ['.mp3', '.wav', '.m4a', '.aac', '.ogg'];

  for (const dir of sectionDirs) {
    const dirPath = path.join(projectPath, dir);
    const files = fs.readdirSync(dirPath);
    
    if (files.some(f => f.endsWith('_guion.txt'))) sectionsWithScript++;
    if (files.some(f => audioExts.includes(path.extname(f).toLowerCase()))) sectionsWithAudio++;
    
    // Check if broll folder exists with content
    const brollDir = path.join(dirPath, 'broll');
    if (fs.existsSync(brollDir)) {
      const brollFiles = fs.readdirSync(brollDir);
      if (brollFiles.length > 0) sectionsWithBroll++;
    }
  }

  const totalSections = sectionDirs.length;

  // Has video already?
  const hasVideo = items.some(f => ['.mp4', '.mkv', '.webm'].includes(path.extname(f).toLowerCase()));
  if (hasVideo) {
    return { phase: 'done', details: `Proyecto completo (${totalSections} secciones, video existe)`, totalSections };
  }

  // Has broll? → resume at video render (need at least half the sections)
  if (sectionsWithBroll >= Math.ceil(totalSections / 2) && sectionsWithAudio >= totalSections) {
    return { phase: 'video', details: `B-Roll listo (${sectionsWithBroll}/${totalSections}), falta renderizar`, totalSections, sectionsWithAudio, sectionsWithBroll };
  }

  // Has some broll but not enough? Or all audio done? → resume at broll
  if (sectionsWithAudio >= totalSections) {
    if (sectionsWithBroll > 0) {
      return { phase: 'broll', details: `B-Roll parcial (${sectionsWithBroll}/${totalSections}), re-descargando`, totalSections, sectionsWithAudio, sectionsWithBroll };
    }
    return { phase: 'broll', details: `Audio completo (${sectionsWithAudio}/${totalSections}), falta B-Roll`, totalSections, sectionsWithAudio };
  }

  // All scripts done? → resume at audio
  if (sectionsWithScript >= totalSections) {
    return { phase: 'audio', details: `Guiones completos (${sectionsWithScript}/${totalSections}), audio: ${sectionsWithAudio}/${totalSections}`, totalSections, sectionsWithScript, sectionsWithAudio };
  }

  // Partial scripts
  return { phase: 'scripts', details: `Guiones parciales (${sectionsWithScript}/${totalSections})`, totalSections, sectionsWithScript };
}

async function resumePipeline(chatId, folderName) {
  const session = getSession(chatId);
  session.state = 'generating';

  const sendMsg = async (text) => {
    try {
      return await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    } catch (e) {
      return await bot.sendMessage(chatId, text.replace(/[_*`\[\]]/g, ''));
    }
  };

  const sendNatural = async (context) => {
    try {
      const natural = await formatWithLLM(session, context);
      return await sendMsg(natural);
    } catch (e) {
      return await sendMsg(context);
    }
  };

  const projectPath = path.join(sharedContext.globalOutputDir, folderName);

  try {
    const phaseInfo = detectProjectPhase(projectPath);
    
    if (phaseInfo.phase === 'none') {
      await sendNatural(`No encontré el proyecto "${folderName}". Dile al usuario que no existe.`);
      session.state = 'idle';
      return;
    }

    if (phaseInfo.phase === 'done') {
      const videoPath = findLatestVideo(projectPath);
      if (videoPath) {
        await sendNatural(`El proyecto "${folderName}" ya tiene video listo. Se lo voy a enviar.`);
        await sendVideoToTelegram(chatId, videoPath, `📂 ${folderName}`, sendMsg);
      } else {
        await sendNatural(`El proyecto "${folderName}" está completo pero no encontré el archivo de video. Infórmale.`);
      }
      session.state = 'idle';
      return;
    }

    await sendNatural(`Retomando el proyecto "${folderName}". Estado actual: ${phaseInfo.details}. Informa al usuario por dónde vamos a retomar.`);

    // Resume from audio phase
    if (phaseInfo.phase === 'audio') {

      // Load project state to get config
      const statePath = path.join(projectPath, 'project_state.json');
      let projectState = {};
      if (fs.existsSync(statePath)) {
        projectState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      }

      const audioBody = {
        projectData: {
          sections: Array.from({ length: phaseInfo.totalSections }, (_, i) => {
            const secDir = path.join(projectPath, `seccion_${i + 1}`);
            const scriptFile = fs.readdirSync(secDir).find(f => f.endsWith('_guion.txt'));
            const script = scriptFile ? fs.readFileSync(path.join(secDir, scriptFile), 'utf8') : '';
            return { section: i + 1, title: `Sección ${i + 1}`, script };
          }),
          projectKey: folderName,
          topic: projectState.topic || folderName
        },
        useApplio: projectState.useApplio !== undefined ? projectState.useApplio : true,
        voice: projectState.voice || 'RemyOriginal',
        // applioVoice = archivo .pth RVC, applioModel = voz Edge TTS intermedia
        applioVoice: projectState.applioVoice || projectState.voice || 'logs\\VOCES\\RemyOriginal.pth',
        applioModel: projectState.applioModel || 'fr-FR-RemyMultilingualNeural',
        applioPitch: projectState.applioPitch || 0,
        applioSpeed: projectState.applioSpeed || 0,
        folderName: folderName,
        scriptStyle: projectState.scriptStyle || 'professional'
      };

      const audioRes = await fetch(`${API_BASE}/generate-batch-audio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(audioBody)
      });

      const audioResult = await audioRes.json();
      if (!audioResult.success) {
        throw new Error(audioResult.error || 'Error generando audio');
      }
      await sendNatural('Audio generado exitosamente en el resume. Ahora toca B-Roll.');
    }

    // Resume from broll phase (or continue after audio)
    if (phaseInfo.phase === 'audio' || phaseInfo.phase === 'broll') {
      try {
        await generateBroll(folderName, sendMsg);
      } catch (brollErr) {
        console.error('❌ [Telegram Bot] Error en B-Roll:', brollErr.message);
        await sendMsg(`⚠️ B-Roll falló: ${brollErr.message}`);
      }
    }

    // Resume from video phase (or continue after broll/audio)
    if (phaseInfo.phase === 'audio' || phaseInfo.phase === 'broll' || phaseInfo.phase === 'video') {
      let videoPath = null;
      
      // Try B-Roll video first
      try {
        const outputFile = await renderBrollVideo(folderName, sendMsg);
        if (outputFile && fs.existsSync(outputFile)) {
          videoPath = outputFile;
        }
      } catch (renderErr) {
        console.error('❌ [Telegram Bot] B-Roll render failed:', renderErr.message);
        
        // If render failed because no broll material, re-download
        if (renderErr.message.includes('ningún video') || renderErr.message.includes('no material')) {
          await sendMsg('⚠️ Render falló por falta de B-Roll. Re-descargando...');
          try {
            // Delete existing broll_plan to force fresh search
            const planPath = path.join(projectPath, 'broll_plan.json');
            if (fs.existsSync(planPath)) fs.unlinkSync(planPath);
            
            await generateBroll(folderName, sendMsg);
            // Try render again
            const retryOutput = await renderBrollVideo(folderName, sendMsg);
            if (retryOutput && fs.existsSync(retryOutput)) {
              videoPath = retryOutput;
            }
          } catch (retryErr) {
            console.error('❌ [Telegram Bot] B-Roll retry also failed:', retryErr.message);
            await sendMsg('⚠️ Segundo intento de B-Roll falló, intentando video simple...');
          }
        } else {
          await sendMsg('⚠️ Render B-Roll falló, intentando video simple...');
        }
      }
      
      // Fallback to simple video
      if (!videoPath) {
        const videoBody = {
          folderName: folderName,
          duration: 'auto',
          animationType: 'kenburns',
          quality: 'high'
        };

        const videoRes = await fetch(`${API_BASE}/generate-project-video`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(videoBody)
        });

        const videoResult = await videoRes.json();
        videoPath = videoResult?.videoPath
          ? path.resolve(videoResult.videoPath)
          : findLatestVideo(projectPath);
      }
      
      if (!videoPath) {
        videoPath = findLatestVideo(projectPath);
      }

      if (videoPath && fs.existsSync(videoPath)) {
        await sendVideoToTelegram(chatId, videoPath, `✅ ${folderName}`, sendMsg);
      } else {
        await sendMsg(`⚠️ No se encontró el video renderizado. Revisa:\n\`${projectPath}\``);
      }
    }

    await sendNatural(`¡Proyecto "${folderName}" terminado! Despídete del usuario y dile que puede pedir otro.`);

  } catch (error) {
    console.error('❌ [Telegram Bot] Error en resume pipeline:', error);
    await sendNatural(`Error retomando el proyecto "${folderName}": ${error.message}. Dile al usuario qué pasó.`);
  } finally {
    session.state = 'idle';
    session.generationPromise = null;
  }
}

// ============================================================
// MESSAGE HANDLER
// ============================================================

async function handleMessage(msg) {
  const chatId = msg.chat.id.toString();
  const text = msg.text;

  // Security: check allowed chats
  if (ALLOWED_CHAT_IDS.length > 0 && !ALLOWED_CHAT_IDS.includes(chatId)) {
    console.log(`🚫 [Telegram Bot] Mensaje de chat no autorizado: ${chatId}`);
    return;
  }

  if (!text || text.startsWith('/start')) {
    bot.sendMessage(chatId, '👋 ¡Qué onda! Soy Zia, tu bot de generación de videos.\n\nDime qué video quieres hacer y yo me encargo. También puedes preguntarme por el estado, retomar proyectos, cambiar estilos, etc. Todo en lenguaje natural.\n\nEjemplo: "Haz un video sobre los secretos de World of Warcraft con 8 secciones"');
    return;
  }

  // Quick command shortcuts (still work, but LLM handles them too)
  if (text === '/cancel') {
    const session = getSession(chatId);
    if (session.state === 'generating') {
      bot.sendMessage(chatId, '⚠️ Hay una generación en curso. Reseteo la sesión para cuando termine.');
    }
    resetSession(chatId);
    bot.sendMessage(chatId, '🔄 Sesión reseteada. ¿En qué te ayudo?');
    return;
  }

  const session = getSession(chatId);

  // If generating, route through LLM but limit to status-like actions
  if (session.state === 'generating') {
    // Quick check for obvious status asks without wasting LLM call
    const isStatusAsk = /status|estado|progreso|como va|cómo va|qu[ée] onda/i.test(text);
    if (isStatusAsk || text === '/status') {
      const report = await getStatusReport();
      // Pass through LLM for natural formatting
      const naturalResponse = await formatWithLLM(session, `El usuario pregunta por el estado. Datos actuales:\n${report}\n\nResponde de forma natural y breve informando el estado.`);
      bot.sendMessage(chatId, naturalResponse);
    } else {
      const report = await getStatusReport();
      bot.sendMessage(chatId, `⏳ Estoy generando ahorita. ${report}\n\nEspera a que termine o pregúntame "cómo va".`);
    }
    return;
  }

  // Route everything through LLM
  const response = await callGemini(session, text);

  switch (response.action) {
    case 'ask':
      bot.sendMessage(chatId, response.message);
      break;

    case 'confirm':
      session.config = response.config;
      bot.sendMessage(chatId, response.message);
      break;

    case 'generate': {
      const config = response.config?.topic ? response.config : session.config;
      if (!config || !config.topic) {
        bot.sendMessage(chatId, response.message || '🤔 No tengo claro qué video generar. ¿De qué tema quieres el video?');
        break;
      }
      // Apply selected style
      if (session.selectedStyle && (!config.scriptStyle || config.scriptStyle === 'professional')) {
        config.scriptStyle = session.selectedStyle;
      }
      // Ensure broll and video defaults
      config.broll = {
        maxDuration: 5, videosPerTerm: 1, imagesPerTerm: 0, resolution: '720p', excludeShorts: true,
        ...(config.broll || {})
      };
      config.video = {
        maxImagesPerSection: 0, imageDuration: 5, minClipDuration: 4, maxClipDuration: 10,
        resolution: '1080p', crf: 23, preset: 'veryslow',
        ...(config.video || {})
      };
      bot.sendMessage(chatId, response.message || '🚀 Arrancando...');
      session.generationPromise = executePipeline(chatId, config);
      break;
    }

    case 'status': {
      const report = await getStatusReport();
      const naturalResponse = await formatWithLLM(session, `El usuario pregunta por el estado. Datos:\n${report}\n\nResponde natural y breve.`);
      bot.sendMessage(chatId, naturalResponse);
      break;
    }

    case 'retry': {
      const folderName = response.config?.folderName;
      if (folderName) {
        session.retryList = null; // Clear the list
        bot.sendMessage(chatId, response.message || `🔄 Retomando ${folderName}...`);
        session.generationPromise = resumePipeline(chatId, folderName);
      } else {
        // List recent projects
        const outputDir = sharedContext.globalOutputDir;
        try {
          const folders = fs.readdirSync(outputDir)
            .filter(f => { try { return fs.statSync(path.join(outputDir, f)).isDirectory(); } catch { return false; } })
            .map(f => ({ name: f, mtime: fs.statSync(path.join(outputDir, f)).mtime }))
            .sort((a, b) => b.mtime - a.mtime);

          if (folders.length === 0) {
            bot.sendMessage(chatId, response.message || '📭 No hay proyectos para retomar.');
            break;
          }

          const recent = folders.slice(0, 5);
          session.retryList = recent.map(f => f.name);
          
          const list = recent.map((f, i) => {
            const info = detectProjectPhase(path.join(outputDir, f.name));
            return `${i + 1}. ${f.name}\n   ${info.details}`;
          }).join('\n');

          bot.sendMessage(chatId, `${response.message || '📂 Proyectos recientes:'}\n\n${list}\n\nDime cuál retomar (número o nombre).`);
        } catch (e) {
          bot.sendMessage(chatId, `❌ Error listando proyectos: ${e.message}`);
        }
      }
      break;
    }

    case 'set_style': {
      try {
        const stylesPath = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), 'styles.json');
        const stylesData = JSON.parse(fs.readFileSync(stylesPath, 'utf8'));
        const styles = stylesData.scriptStyles || [];
        
        const styleRef = response.config?.styleId || '';
        let selected = null;
        
        // Try by number
        const num = parseInt(styleRef);
        if (!isNaN(num) && num >= 1 && num <= styles.length) {
          selected = styles[num - 1];
        } else {
          // Try by id or name
          selected = styles.find(s => s.id === styleRef || s.name.toLowerCase().includes(styleRef.toLowerCase()));
        }
        
        if (selected) {
          session.selectedStyle = selected.id;
          bot.sendMessage(chatId, response.message || `✅ Estilo cambiado a "${selected.name}". Se usará en la próxima generación.`);
        } else {
          bot.sendMessage(chatId, response.message || '❌ No encontré ese estilo. Dime "qué estilos hay" para ver la lista.');
        }
      } catch (e) {
        bot.sendMessage(chatId, '❌ Error cargando estilos: ' + e.message);
      }
      break;
    }

    case 'list_styles': {
      try {
        const stylesPath = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), 'styles.json');
        const stylesData = JSON.parse(fs.readFileSync(stylesPath, 'utf8'));
        const styles = stylesData.scriptStyles || [];
        
        const list = styles.map((s, i) => `${i + 1}. ${s.name}`).join('\n');
        const current = session.selectedStyle 
          ? (styles.find(s => s.id === session.selectedStyle)?.name || 'professional')
          : 'professional (default)';
        bot.sendMessage(chatId, `${response.message || '🎨 Estilos disponibles:'}\n\n${list}\n\n📌 Actual: ${current}\n\nDime cuál quieres usar.`);
      } catch (e) {
        bot.sendMessage(chatId, '❌ Error cargando estilos: ' + e.message);
      }
      break;
    }

    case 'list_voices': {
      const voices = sharedContext.getAvailableVoices ? sharedContext.getAvailableVoices() : [];
      const list = voices.map(v => `• ${v.displayName}`).join('\n');
      bot.sendMessage(chatId, `${response.message || '🎤 Voces disponibles:'}\n\n${list || 'No se pudieron cargar'}`);
      break;
    }

    case 'cancel':
      if (session.state === 'generating') {
        bot.sendMessage(chatId, response.message || '⚠️ Hay generación en curso. Reseteo para cuando termine.');
      }
      resetSession(chatId);
      bot.sendMessage(chatId, response.message || '🔄 Listo, sesión reseteada. ¿Qué hacemos?');
      break;

    default:
      bot.sendMessage(chatId, response.message || '¿En qué te ayudo?');
  }
}

// ============================================================
// BOT INITIALIZATION
// ============================================================

export function initTelegramBot(context) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log('ℹ️ TELEGRAM_BOT_TOKEN no configurado. Bot de Telegram desactivado.');
    return null;
  }

  // Store shared context
  sharedContext = { ...sharedContext, ...context };

  try {
    bot = new TelegramBot(token, { polling: true });

    bot.on('message', (msg) => {
      handleMessage(msg).catch(err => {
        console.error('❌ [Telegram Bot] Unhandled error in handleMessage:', err.message);
      });
    });

    bot.on('polling_error', (error) => {
      console.error('❌ [Telegram Bot] Polling error:', error.message);
    });

    console.log('✅ Bot de Telegram iniciado correctamente (polling)');

    if (ALLOWED_CHAT_IDS.length > 0) {
      console.log(`🔒 Chat IDs autorizados: ${ALLOWED_CHAT_IDS.join(', ')}`);
    } else {
      console.log('⚠️ TELEGRAM_ALLOWED_CHAT_IDS no configurado. El bot responderá a CUALQUIER chat.');
    }

    return bot;
  } catch (error) {
    console.error('❌ [Telegram Bot] Error iniciando:', error.message);
    return null;
  }
}

export default { initTelegramBot };
