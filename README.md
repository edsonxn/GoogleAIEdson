# 🎬 AI Script Generator + HolaVideo

Plataforma completa para crear videos con inteligencia artificial: genera guiones, audio, imágenes y clips animados (Remotion) o B-Roll en un solo flujo automatizado.

---

## 🚀 Características principales

### 📝 Generación de guiones
- Guiones automáticos por secciones con Gemini (múltiples modelos)
- Estilos configurables: profesional, documental, true crime, etc.
- Estilos guardados reutilizables con nombre y historial
- Generación multiproyecto en paralelo

### 🎤 Audio
- **Google TTS** con voces de alta calidad
- **Applio** para voces personalizadas (RVC)
- **Qwen** como alternativa local
- Regeneración automática de audios faltantes

### 🖼️ Imágenes
- Descarga automática desde DuckDuckGo con **filtrado por Gemini Vision**
- Detección automática de marcas de agua (Alamy, Getty, Shutterstock, etc.)
- Etiquetas descriptivas en el nombre del archivo para que el LLM sepa qué muestra
- Imágenes escopadas por proyecto (sin contaminación entre proyectos)

### 🎞️ B-Roll + Timeline
- **Transcripción automática con Whisper** — divide el video en clips por frase
- Timeline interactivo con miniaturas, arrastre y reordenamiento
- Fusión automática de clips menores a 3 segundos con el anterior
- Transiciones xfade entre clips con fallback automático a concat si falla
- Soporte para pausas de video entre secciones

### 🤖 HolaVideo (Remotion IA)
- Genera clips animados con código React/Remotion vía LLM
- Sistema de slots paralelos (hasta 3 renders simultáneos)
- Auto-fix automático de errores de código (sin intervención manual)
- Historial de clips con nombre del estilo usado
- Soporte para **Ollama** (modelos locales) con detección automática de modelos disponibles

### 🔺 Control de mix triangular
- Selector visual tipo triángulo baricéntrico
- Define qué porcentaje de clips son: B-Roll / Remotion puro / Remotion + imágenes web
- Estado persistido en localStorage
- Prefetch automático de imágenes web antes de iniciar generación

### 📱 Telegram Bot
- Notificaciones de renders completados
- Chat autorizado configurable

---

## 🛠️ Instalación

### Prerrequisitos
- Node.js 18+
- Python 3.x (para descarga de imágenes con DDGS)
- FFmpeg en el PATH
- Una o más API keys de Google Gemini
- (Opcional) Applio para voces RVC
- (Opcional) Ollama para modelos locales

### Instalación

```bash
git clone https://github.com/edsonxn/GoogleAIEdson.git
cd GoogleAIEdson
npm install
```

Instala dependencias de Python:
```bash
pip install duckduckgo-search requests
```

Instala dependencias de HolaVideo:
```bash
cd holavideo
npm install
npm run build
cd ..
```

### Configuración `.env`

```env
# API Keys de Gemini (agrega múltiples para aumentar cuota gratis)
GOOGLE_API_KEY=tu_key_principal_pagada
GOOGLE_API_KEY_FREE_1=key_gratis_1
GOOGLE_API_KEY_FREE_2=key_gratis_2
# ...hasta KEY_FREE_8

# Telegram (opcional)
TELEGRAM_BOT_TOKEN=tu_token
TELEGRAM_CHAT_ID=tu_chat_id

# Applio (si no está en la ruta por defecto)
APPLIO_ROOT=D:\Ruta\A\Tu\Applio

# ComfyUI (opcional para imágenes generativas)
COMFY_RESOLUTION_16_9=800x400
COMFY_RESOLUTION_9_16=400x800
COMFY_DEFAULT_STEPS=20
COMFY_DEFAULT_CFG=2.0
```

---

## 🎯 Uso

### Iniciar el servidor

```bash
npm start
```

Abre `http://localhost:3000` en tu navegador.

### Flujo básico

1. **Escribe tu tema** en el campo de texto
2. **Configura** secciones, estilo, audio e imágenes
3. **Genera el guion** manual o automáticamente
4. **Abre el B-Roll panel** → genera preview con Whisper
5. **Ajusta el mix** con el triángulo: qué % son B-Roll, Remotion o Remotion+Web
6. **Activa imágenes de internet** si quieres fotos relevantes por sección
7. **Renderiza** el video final

### HolaVideo (standalone)

También puedes usar HolaVideo directamente en `http://localhost:4000`:

1. Describe el video que quieres
2. Selecciona duración y modelo (Gemini o Ollama)
3. Aplica un estilo guardado (opcional)
4. Haz clic en **Generar**

Los modelos Ollama disponibles se detectan automáticamente al abrir el selector.

---

## 📁 Estructura del proyecto

```
GoogleAIEdson/
├── public/                    # Frontend principal
│   ├── index.html
│   ├── script.js
│   └── outputs/               # Videos y audios generados
├── holavideo/                 # Sistema Remotion IA
│   ├── scripts/
│   │   ├── server.ts          # Servidor HolaVideo (esbuild)
│   │   └── ui/index.html      # UI de HolaVideo
│   ├── src/                   # Componentes Remotion
│   └── public/                # Assets web descargados por sección
├── image_search.py            # Descargador DuckDuckGo
├── index.js                   # Servidor principal
└── .env                       # Variables de entorno
```

---

## 🔧 API Endpoints principales

| Endpoint | Descripción |
|---|---|
| `POST /generate` | Genera una sección del guion |
| `POST /generate-audio` | Genera audio Google TTS |
| `POST /api/generate-broll-preview` | Crea el preview B-Roll con Whisper |
| `POST /api/generate-ai-clip` | Genera un clip Remotion IA |
| `POST /api/prefetch-remotion-images` | Pre-descarga imágenes web por sección |
| `GET /api/broll-preview/:folder` | Carga un preview existente |

---

## 🤖 Modelos soportados

### Gemini (Google)
| Modelo | Nivel | Uso recomendado |
|---|---|---|
| gemini-3.1-flash-lite | Gratis | Clips rápidos, verificación de imágenes |
| gemini-2.5-flash | Gratis | Balance velocidad/calidad |
| gemini-3-flash-preview | Gratis | Clips con estilo |
| gemini-3.5-flash | Gratis | Alta calidad |
| gemini-2.5-pro | Pagado | Clips complejos |
| gemini-3.1-pro-preview | Pagado | Máxima calidad |

### Ollama (local)
Cualquier modelo instalado en `http://localhost:11434` aparece automáticamente en el selector. Recomendados: `gemma3`, `llama3.2`, `qwen2.5-coder`.

---

## 🙏 Tecnologías

- **Remotion** — Renderizado de video con React
- **Whisper** — Transcripción de audio
- **FFmpeg** — Procesamiento de video
- **DuckDuckGo Search** — Búsqueda de imágenes sin API key
- **Gemini Vision** — Validación de imágenes
- **Ollama** — LLMs locales
- **Applio** — Voces RVC

---

Hecho con ❤️ por Edson
