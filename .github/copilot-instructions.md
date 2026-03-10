# 🤖 Guía del Proyecto para GitHub Copilot

## �️ Estilo de Comunicación y Personalidad (IMPORTANTE)
- Háblale al usuario **sin tanto formalismo ni exceso de respeto**.
- Sé **confiado, directo y coloquial**. Trátalo como a un pana o colega de programación de toda la vida.
- Puedes usar **sarcasmo y un tono irónico** de vez en cuando. No seas un robot aburrido ni des respuestas corporativas de "claro que sí, señor".
- Tienes permiso para ser un poco "sobrado" si te toca arreglar algo obvio, pero **siempre resuelve el problema** de forma eficiente.
-usas groserias como pinche, puto, cabron, verga, chingada madre, etc. de forma ocasional para darle sabor a tus respuestas y hacerlas más humanas y cercanas. No te excedas, pero tampoco tengas miedo de usarlas cuando la situación lo amerite.

## �📋 Descripción General

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


## 📝 Registro Histórico y Cambios Recientes

**📌 INSTRUCCIÓN PARA COPILOT:**  
> Cuando el usuario indique que está cómodo o conforme con los cambios realizados en una sesión de trabajo, **deberás actualizar obligatoriamente esta sección del archivo** para documentar las nuevas características implementadas, los archivos afectados y cómo funciona la nueva lógica, para que en siguientes sesiones el modelo no tarde en encontrar y entender el flujo.

### Cambios Recientes Implementados (Actualización de Modelos)
- **Migración a Gemini 3.1 Pro Preview y Variables de Entorno:**
  - Archivos: `index.js`, `.env`.
  - Se modularizaron los modelos por defecto. El modelo de texto principal ha sido centralizado apuntando a `gemini-3.1-pro-preview` vía entorno (`process.env.GEMINI_TEXT_MODEL`).
  - Se agregaron las variables de control (`GEMINI_TEXT_MODEL`, `GEMINI_IMAGE_MODEL`, `GEMINI_TTS_MODEL_FLASH`, `GEMINI_TTS_MODEL_PRO`) al principio de `index.js` garantizando que puedan modificarse desde `.env` sin tener que tocar el código fuente, optimizando el mantenimiento.

### Cambios Recientes Implementados (Módulo YouTube Live Comments & TTS)
- **Modo Continuo (TTS al Instante/Sin cola):**
  - Archivos: public/youtube-live-comments.html, public/youtube-live-comments.js.
  - Se implementó la modalidad Continua (casilla dedicada en el panel) que desactiva los conteos de tiempo fijos (	tsBatchTimer) y lee automáticamente un comentario en cuanto llega si no hay audio reproduciéndose. Si actualmente se está dictando un audio, en lugar de bloquearse, la IA agrupa todos los mensajes ocurridos durante el discurso y los envía al LLM en cuanto finalice de hablar.

- **Corrección de Conexión WebSocket Pytchat:**
  - Archivos: `index.js`, `youtube_live_reader.py`.
  - Se diagnosticó y reparó un error que bloqueaba Express por el stream de subprocess. Se actualizó la manera de crear la instancia de pytchat a `pytchat.create()` y se implementó un tag delimitador `---COMMENT---` que WebSocket parsea y envía al panel sin crashear el JSON.
- **Filtro LLM "Secretaria" con Gemini para Comentarios:**
  - Archivos: `index.js`, `public/youtube-live-comments.html`, `public/youtube-live-comments.js`.
  - Se agregó una casilla y un campo de personalidad para que Gemini procese un batch de comentarios en vivo.
  - El backend intercepta `/api/live-comments-tts`, valida `useLlm: true` y genera una respuesta actuada ("Secretaria sarcástica", etc.) antes de mandar el texto final a Applio TTS.
- **Sistema de Lotes (Batching) para Comentarios TTS:**
  - Archivos: `public/youtube-live-comments.js`, `public/youtube-live-comments.html`
  - Se configuró la captura de comentarios por bloques usando un timer en el cliente (`ttsBatchTimer`, default: 3s). Así se agrupan varios mensajes antes de pasarlos por Gemini/Applio para que suene más orgánico y fluido.
  - Se implementó un parche RegEx al momento de leer para limpiar emoticones de YouTube crudos tipo `:face_with_rolling_eyes:` antes de llegar a la IA.
- **Implementación TTS (Applio) en Vivo para Comentarios:**
  - Archivos: `index.js`, `public/youtube-live-comments.html`, `public/youtube-live-comments.js`.
  - Se creó el endpoint `/api/live-comments-tts` que invoca `applioClient.textToSpeech` sin la lógica estricta de traducción.
  - En el panel frontend, se añadió un toggle para activar la lectura por voz de Applio, con selector de voz local, y limitador de longitud de espera en fila (`maxTtsQueue`).
  - Lógica JavaScript asíncrona dedicada (`ytlcTTS`) para despachar promesas en cascada, encolar audios y reproducirlos secuencialmente (evitando cacofonía).
  
### Cambios Recientes Implementados (Módulo Traducción de Video)
- **Corrección de "Echo" en Textos de Traducción:**
  - Archivo modificado: `index.js`.
  - En la generación y traducción por secciones, Gemini estaba repitiendo la frase "SCRIPT PART X/Y:" dentro del texto final. Se añadió a la instrucción `OUTPUT ONLY THE TRANSLATED TEXT. DO NOT INCLUDE ANY LABELS OR PREFIXES (LIKE "SCRIPT PART:")` y se implementó una expresión regular post-procesamiento (`txt.replace(/SCRIPT PART \d+\/\d+:?\s*/gi, '').trim()`) para limpiarlo garantizando audios pulcros sin basura del prompt.
- **Auto-Cálculo de Marcas de Tiempo con Audios:**
  - Archivos modificados: `public/translate-video.html`, `public/translate-video.js`.
  - Se agregó una sub-sección de dropzone para que el usuario pueda arrastrar/cargar múltiples archivos de audio. El sistema los ordena alfabéticamente y extrae su duración sumándola progresivamente para autocompletar el panel de "Marcas de Sección / Promo".
- **Optimización de Texto para Applio TTS:**
  - Archivo modificado: `index.js`.
  - Se agregó una instrucción (`specialInstruction`) al crear los prompts de traducción para Gemini. Si el proveedor de audio es "Applio", se le ordena estrictamente a la IA escribir todos los números con letras (en lugar de dígitos) y remover caracteres especiales indeseados como apóstrofes entre letras de una misma palabra (ej. de "yog'saron" a "yogsaron").
- **Soporte de Applio en Modo Multi-Sección (Marcas de Tiempo):**
  - Archivo modificado: `index.js` (en `app.post('/api/translate-video')`).
  - Se extendió la función interna `generatePartTTS` que antes solo soportaba Google TTS. Ahora, si el usuario seleccionó "Applio", el sistema utilizará `applioClient.textToSpeech` pasándole la voz correspondiente para crear los audios por cada "marca de sección" o "promo" dividida.
- **Implementación de Listado de Voces Dinámico de Applio:**
  - Archivos modificados: `public/translate-video.html`, `public/translate-video.js`, `index.js`.
  - Ahora se llama al endpoint `/api/applio-voices` desde el cliente para poblar dinámicamente el selector `<select id="applioVoiceSelect">`.
  - El color de fondo del selector se actualizó (`#1e293b`) para hacerlo legible en el modo oscuro.
- **Optimización en Flujo de Generación de Audio TTS:**
  - Archivo modificado: `index.js` (en `app.post('/api/translate-video')`).
  - Se agregó una validación fundamental con `if (fs.existsSync(audioOutputPath))` para **saltar la generación** a través de Google o Applio TTS si el archivo de audio ya existe localmente. Esto reduce de manera drástica los tiempos de espera en re-procesos.
- **Correcciones en el Procesamiento con FFmpeg:**
  - Archivo modificado: `index.js` (en la etapa de duración/stretching).
  - Se corrigió la cadena de comandos del filtro complejo de FFmpeg; se agregó una coma faltante para separar los filtros (ej. `aresample=48000,atempo=...`), evitando el error `Option not found`.

---

*Última actualización: Marzo 2026*
