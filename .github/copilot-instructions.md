# 🤖 Guía del Proyecto para GitHub Copilot

## 📋 Descripción General

Este es un **Generador de Scripts con IA** - una aplicación full-stack que genera guiones, imágenes, audio y video automáticamente usando múltiples APIs de inteligencia artificial.

**Tecnologías principales:**
- **Backend:** Node.js + Express (ES Modules)
- **Frontend:** HTML/CSS/JavaScript vanilla
- **APIs:** Google Gemini, OpenAI Whisper, ComfyUI, Applio
- **Arquitectura:** Servidor Express + Cliente web estático

---

## 📁 Estructura del Proyecto

```
googleimagenes/
├── index.js              # ⭐ SERVIDOR PRINCIPAL - Express API (18K+ líneas)
├── public/
│   ├── index.html        # Frontend HTML principal
│   ├── script.js         # ⭐ CLIENTE PRINCIPAL - JavaScript frontend (16K+ líneas)
│   ├── styles.css        # Estilos CSS
│   └── outputs/          # 📂 Carpetas de proyectos generados
├── applio-client.js      # Cliente para API de Applio (TTS con voces IA)
├── comfyui-client.js     # Cliente para ComfyUI (generación de imágenes Flux)
├── transcriber.js        # Transcripción de audio con OpenAI Whisper
├── performance-configs.js # Configuraciones de rendimiento
├── styles.json           # Estilos de escritura personalizados
├── .env                  # Variables de entorno (API keys)
├── package.json          # Dependencias npm
└── whisper_local.py      # Script Python para Whisper local
```

---

## 🔑 Archivos Clave y Sus Funciones

### `index.js` - Servidor Backend Principal
**Ubicación:** Raíz del proyecto  
**Líneas:** ~18,000  
**Función:** Servidor Express con todos los endpoints API

**Secciones importantes:**
- **Líneas 1-100:** Imports y configuración inicial
- **Líneas 70-200:** Sistema de API keys con fallback (gratis → principal)
- **Líneas 150-200:** Funciones `getGoogleAI()` y `getFreeGoogleAPIKeys()`
- **Líneas 1460-1500:** Endpoints de estilos personalizados
- **Líneas 5572-6000:** Generación automática batch (`/generate-batch-automatic`)
- **Líneas 6187-6800:** Generación de audio (`/generate-audio`, Applio, Google TTS)
- **Líneas 7378-8000:** Generación de imágenes faltantes
- **Líneas 10068-10500:** Generación batch de imágenes
- **Líneas 10499-11700:** Endpoint principal `/generate` (generación de contenido)
- **Líneas 11792-12000:** Generación de audio por sección
- **Líneas 12119-12600:** ComfyUI status, transcripción, voces Applio
- **Líneas 12969-13600:** Traducción de proyectos
- **Líneas 13858-14400:** API de proyectos (listar, cargar, eliminar, duplicar)
- **Líneas 14761-15100:** Generación de video
- **Líneas 17510+:** Traducción de video

### `public/script.js` - Cliente Frontend Principal
**Ubicación:** public/script.js  
**Líneas:** ~16,000  
**Función:** Toda la lógica del frontend

**Variables globales importantes:**
- `globalChapterStructure` - Estructura de capítulos del proyecto
- `currentImageKeywords` - Keywords de imágenes para regeneración
- `isGeneratingImages` / `isGeneratingVideo` - Estados de generación

**Funciones clave:**
- `normalizeImageModel()` - Normaliza nombres de modelos de imagen
- `getSelectedImageModel()` - Obtiene modelo seleccionado
- Manejo de progreso de clips y secciones

### `applio-client.js` - Cliente Applio TTS
**Ubicación:** Raíz  
**Función:** Genera audio con voces IA personalizadas

**Clase `ApplioClient`:**
- `textToSpeech(text, outputPath, options)` - Genera audio TTS
- `checkConnection()` - Verifica conexión con Applio
- Cola de ejecución secuencial para peticiones

**Configuración:** Variable `APPLIO_ROOT` en `.env`

### `comfyui-client.js` - Cliente ComfyUI
**Ubicación:** Raíz  
**Función:** Genera imágenes con modelos Flux via ComfyUI

**Clase `ComfyUIClient`:**
- `generateWorkflow(prompt, options)` - Crea workflow de generación
- Opciones: width, height, steps, cfg, guidance, sampler, scheduler, model

### `transcriber.js` - Transcriptor de Audio
**Ubicación:** Raíz  
**Función:** Transcribe audio usando OpenAI Whisper

**Funciones:**
- `transcribeAudio({ filePath, onUploadProgress, audioTrackIndex })` 
- `getAudioTracks(filePath)` - Lista pistas de audio de MP4

---

## 🌐 Endpoints API Principales

### 📝 Generación de Contenido
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/generate` | Genera guión/contenido principal |
| POST | `/generate-batch-automatic` | Genera todas las secciones automáticamente |
| POST | `/generate-batch-automatic/multi` | Genera múltiples proyectos en paralelo |
| POST | `/generate-missing-scripts` | Genera scripts faltantes |

### 🎨 Generación de Imágenes
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/generate-batch-images` | Genera imágenes para todas las secciones |
| POST | `/api/generate-missing-images` | Genera solo imágenes faltantes |
| POST | `/api/cancel-missing-images` | Cancela generación de imágenes |
| POST | `/regenerate-image` | Regenera una imagen específica |
| POST | `/generate-comfyui-image` | Genera imagen via ComfyUI |
| POST | `/api/refresh-image` | Refresca/regenera imagen |
| GET | `/api/comfy-defaults` | Obtiene configuración ComfyUI |

### 🎤 Generación de Audio
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/generate-audio` | Genera audio (Google TTS) |
| POST | `/applio_tts` | Genera audio con Applio |
| POST | `/generate-section-audio` | Audio para sección específica |
| POST | `/generate-batch-audio` | Audio para múltiples secciones |
| POST | `/generate-missing-applio-audios` | Genera audios Applio faltantes |
| POST | `/generate-missing-google-audios` | Genera audios Google faltantes |
| POST | `/regenerate-applio-audios` | Regenera audios Applio |
| GET | `/api/applio-voices` | Lista voces disponibles en Applio |

### 🎬 Generación de Video
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/generate-project-video` | Genera video del proyecto completo |
| POST | `/generate-simple-video` | Genera video simple |
| POST | `/generate-separate-videos` | Genera videos separados por sección |
| GET | `/video-progress/:sessionId` | Progreso de generación de video |
| GET | `/clip-progress/:sessionId` | Progreso de clips |

### 📂 Gestión de Proyectos
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/projects` | Lista todos los proyectos |
| GET | `/api/projects/:folderName` | Obtiene datos de un proyecto |
| GET | `/api/projects/:folderName/diagnose` | Diagnostica problemas |
| POST | `/api/projects/:folderName/reconstruct` | Reconstruye proyecto |
| POST | `/api/projects/:folderName/duplicate` | Duplica proyecto |
| DELETE | `/api/projects/:folderName` | Elimina proyecto |
| GET | `/api/project-images/:folderName/:sectionNumber` | Imágenes de sección |
| GET | `/api/section-media-summary/:folderName` | Resumen de media |

### 🌍 Traducción
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/translate-project` | Traduce un proyecto |
| POST | `/translate-project-all` | Traduce proyecto completo |
| POST | `/translate-title` | Traduce título |
| POST | `/generate-translated-audios` | Genera audios traducidos |
| POST | `/api/translate-video` | Traduce video |

### 🎙️ Transcripción
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/transcribe-audio` | Transcribe audio (OpenAI) |
| POST | `/transcribe-audio-local` | Transcribe audio (local) |
| POST | `/upload-audio` | Sube archivo de audio |
| POST | `/get-audio-tracks` | Obtiene pistas de audio |
| GET | `/whisper-local-info` | Info de Whisper local |

### ⚙️ Configuración
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/custom-styles` | Obtiene estilos personalizados |
| POST | `/api/custom-styles` | Guarda estilos personalizados |
| GET | `/api/google-image-apis` | APIs de imagen disponibles |
| GET | `/comfyui-status` | Estado de ComfyUI |
| POST | `/test-comfyui-auto` | Test automático ComfyUI |
| POST | `/test-applio-auto` | Test automático Applio |
| POST | `/api/open-folder` | Abre carpeta en explorador |

### 🔍 Estado y Progreso
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/progress/:projectKey` | Progreso de generación |
| GET | `/get-project-state/:projectKey` | Estado del proyecto |
| GET | `/read-script-file/:projectKey/:sectionNumber` | Lee script de sección |
| GET | `/api/check-section-images` | Verifica imágenes de sección |

### 📺 YouTube
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/generate-youtube-metadata` | Genera metadata para YouTube |
| POST | `/generate-youtube-metadata-for-project` | Metadata para proyecto específico |

---

## 🔧 Variables de Entorno (.env)

```env
# API Keys de Google (sistema de fallback)
GOOGLE_API_KEY=tu_api_principal
GOOGLE_API_KEY_GRATIS=api_gratuita_1
GOOGLE_API_KEY_GRATIS2=api_gratuita_2
GOOGLE_API_KEY_GRATIS3=api_gratuita_3
GOOGLE_API_KEY_GRATIS4=api_gratuita_4
GOOGLE_API_KEY_GRATIS5=api_gratuita_5

# OpenAI (para Whisper)
OPENAI_API_KEY=tu_openai_key

# ComfyUI (generación de imágenes)
COMFY_RESOLUTION_16_9=800x400
COMFY_RESOLUTION_9_16=400x800
COMFY_RESOLUTION_1_1=800x800
COMFY_DEFAULT_STEPS=20
COMFY_DEFAULT_CFG=2.0
COMFY_DEFAULT_GUIDANCE=3.5

# Applio (voces IA)
APPLIO_ROOT=C:\ruta\a\Applio
```

---

## 🎯 Modelos de IA Utilizados

### Generación de Texto (LLM)
- `gemini-3-flash-preview` - Modelo principal
- `gemini-2.0-flash` - Fallback
- `gemini-2.5-flash` - Alternativa

### Generación de Imágenes
- `gemini2` - Gemini 2.0 Flash (nativo)
- `gemini25` - Gemini 2.5 Flash
- `gemini3` - Gemini 3 Flash Preview
- `imagen40` - Imagen 4.0
- ComfyUI con Flux models

### Text-to-Speech
- Google TTS (múltiples voces)
- Applio (voces IA personalizadas con RVC)

### Transcripción
- OpenAI Whisper API
- Whisper local (faster-whisper)

---

## 📂 Estructura de Proyectos Generados

Cada proyecto se guarda en `public/outputs/{nombre_proyecto}/`:

```
nombre_proyecto/
├── section_1_script.txt      # Guión de sección 1
├── section_1_audio.mp3       # Audio de sección 1
├── section_1_audio_applio.mp3 # Audio Applio de sección 1
├── section_1/
│   ├── image_1.png           # Imágenes generadas
│   ├── image_2.png
│   └── ...
├── section_2_script.txt
├── section_2_audio.mp3
├── section_2/
│   └── ...
├── project_config.json       # Configuración del proyecto
├── video_final.mp4           # Video generado (si existe)
└── ...
```

---

## 🔄 Flujo de Trabajo Típico

1. **Usuario introduce tema** → Frontend (`script.js`)
2. **Genera estructura** → `POST /generate` → Gemini API
3. **Genera imágenes** → `POST /generate-batch-images` → Gemini/ComfyUI
4. **Genera audio** → `POST /generate-audio` → Google TTS/Applio
5. **Genera video** → `POST /generate-project-video` → FFmpeg
6. **Guarda proyecto** → `public/outputs/{proyecto}/`

---

## 🐛 Patrones Comunes de Código

### Manejo de API con Fallback
```javascript
// En index.js - Sistema de API keys múltiples
async function getGoogleAI(model, options) {
  // Intenta APIs gratuitas primero
  // Si fallan, usa API principal
  // Maneja rate limits (429)
}
```

### Cola de Ejecución Secuencial (Applio)
```javascript
// En applio-client.js
this.queue = Promise.resolve();
async textToSpeech(text, outputPath, options) {
  const task = this.queue.then(() => this._executeTextToSpeech(...));
  this.queue = task.catch(err => console.error(err));
  return task;
}
```

### Generación de Imágenes con Gemini
```javascript
// Buscar en index.js: generateImageWithGemini
// Usa @google/genai para generar imágenes nativas
```

---

## 💡 Tips para Copilot

1. **Para buscar endpoints:** Usa `app.post('/` o `app.get('/` en index.js
2. **Para funciones de frontend:** Busca en `public/script.js`
3. **Para clientes externos:** Revisa `applio-client.js`, `comfyui-client.js`
4. **Para configuración:** Revisa `.env.example` y `package.json`
5. **Para estilos:** Revisa `styles.json` y `public/styles.css`

---

## 🔍 Búsquedas Rápidas

| Qué buscar | Dónde | Patrón |
|------------|-------|--------|
| Endpoints API | index.js | `app.post\|app.get\|app.delete` |
| Funciones async | *.js | `async function` |
| Generación contenido | index.js | `generateContent\|generateText` |
| Generación imágenes | index.js | `generateImage\|generateBatchImages` |
| Generación audio | index.js | `generateAudio\|textToSpeech\|applio` |
| Manejo errores | index.js | `catch\|try\|error` |
| Variables env | .env | Todas las configuraciones |
| Estilos UI | public/styles.css | Clases CSS |

---

## ⚠️ Consideraciones Importantes

1. **ES Modules:** El proyecto usa `"type": "module"` - usar `import`/`export`
2. **Async/Await:** Casi todas las funciones son asíncronas
3. **Error Handling:** Global handlers en `process.on('unhandledRejection')`
4. **Rate Limits:** Sistema de fallback para APIs de Google
5. **Archivos grandes:** `index.js` tiene 18K+ líneas, `script.js` tiene 16K+ líneas
6. **Dependencias externas:** ComfyUI y Applio son servicios externos

---

*Última actualización: Enero 2026*
