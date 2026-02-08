# 🤖 AI Script Generator - Generador de Guiones con IA

Un generador automático de guiones que utiliza inteligencia artificial para crear contenido, imágenes y audio de alta calidad para cualquier tema o nicho.

## 🚀 Características

### 📝 Generación de Contenido
- **Guiones automáticos**: Genera guiones detallados sobre cualquier tema
- **Generación por secciones**: Divide el contenido en secciones manejables
- **Estilos personalizables**: Profesional, casual, humorístico, educativo y más
- **Navegación entre secciones**: Navega fácilmente entre las secciones generadas

### 🎨 Generación de Imágenes
- **Imágenes temáticas**: Genera imágenes relacionadas con cualquier contenido
- **Múltiples modelos**: Soporte para diferentes modelos de IA
- **Regeneración individual**: Regenera imágenes específicas si no te gustan

### 🎤 Generación de Audio
- **Google TTS**: Audio con voces de Google de alta calidad
- **Integración con Applio**: Soporte para voces personalizadas con Applio
- **Audio automático**: Genera audio para todas las secciones automáticamente
- **Múltiples voces**: Elige entre diferentes voces y estilos

### ⚙️ Opciones Avanzadas
- **Solo guión**: Genera únicamente texto sin imágenes
- **Generación automática**: Genera todas las secciones de una vez
- **Audio automático**: Incluye generación de audio en el proceso automático
- **Organización de archivos**: Estructura automática de carpetas por proyecto
- **Gestión multiproyecto**: Lanza varios temas en paralelo reutilizando la misma configuración

## 🛠️ Instalación

### Prerrequisitos
- Node.js 16+ instalado
- Una API key de Google AI (Gemini)
- (Opcional) Applio instalado para voces personalizadas

### Pasos de instalación

1. **Clona el repositorio**
```bash
git clone https://github.com/edsonxn/GoogleAIEdson.git
cd GoogleAIEdson
```

2. **Instala las dependencias**
```bash
npm install
```

3. **Configura las variables de entorno**
```bash
# Copia el archivo de ejemplo
cp .env.example .env

# Edita el archivo .env y agrega tu API key de Google AI
```

4. **Configura tu API key**
Edita el archivo `.env` y reemplaza:
```env
GOOGLE_API_KEY=tu_google_api_key_aqui
```

#### Parámetros opcionales para ComfyUI

Puedes personalizar la resolución predeterminada, los pasos de muestreo y el valor de CFG directamente desde tu archivo `.env` sin tocar el código. Los valores aceptan los siguientes formatos:

```env
# Resoluciones base (ancho x alto)
COMFY_RESOLUTION_16_9=800x400
COMFY_RESOLUTION_9_16=400x800
COMFY_RESOLUTION_1_1=800x800

# Parámetros numéricos
COMFY_DEFAULT_STEPS=20
COMFY_DEFAULT_CFG=2.0
# (Opcional) ajustar guidance si lo necesitas
COMFY_DEFAULT_GUIDANCE=3.5
```

- Las resoluciones deben expresarse como `ANCHOxALTO`.
- Si omites alguna variable, el sistema utilizará los valores recomendados (`800x400`, `400x800`, `800x800`, `15` pasos y `1.8` de CFG).
- Los valores definidos en el `.env` se reflejan automáticamente en el backend y en los controles del frontend cada vez que recargas la página.

#### Configuración de Applio

Si utilizas Applio para la generación de audio y no está instalado en la ruta por defecto (`C:\applio2\Applio`), debes especificar su ubicación en el archivo `.env`:

```env
APPLIO_ROOT=D:\Ruta\A\Tu\Applio
```

### Obtener API Key de Google AI

1. Ve a [Google AI Studio](https://ai.google.dev/)
2. Inicia sesión con tu cuenta de Google
3. Crea un nuevo proyecto o selecciona uno existente
4. Genera una nueva API key
5. Copia la API key al archivo `.env`

## 🎯 Uso

### Inicio del servidor
```bash
npm start
# o
node index.js
```

El servidor estará disponible en `http://localhost:3000`

### Uso básico

1. **Describe tu tema**: Escribe sobre qué quieres crear contenido
2. **Configura opciones**:
   - Número de secciones
   - Estilo de narración
   - Número de imágenes
   - Opciones de audio
3. **Selecciona el modo**:
   - **Manual**: Genera una sección a la vez
   - **Automático**: Genera todas las secciones de una vez
4. **¡Genera!**: Haz clic en el botón de generar

### Opciones disponibles

- ✅ **Solo guión**: Genera únicamente texto, omite imágenes
- ✅ **Generación automática**: Genera todas las secciones automáticamente
- ✅ **Incluir audio Google**: Genera audio con voces de Google
- ✅ **Incluir audio Applio**: Usa voces personalizadas de Applio

### 🧵 Generación Multiproyecto

- Agrega proyectos adicionales desde el panel "Proyectos adicionales" en la parte superior del formulario.
- Cada entrada puede definir su propia carpeta de salida y tema del guion.
- Al iniciar la generación automática, el proyecto principal se muestra en la UI, mientras que los adicionales se procesan en paralelo en segundo plano.
- Todos los proyectos comparten la configuración actual (secciones, estilos, imágenes, audio) y generan sus archivos en `public/outputs/<carpeta>`.
- Recibirás notificaciones cuando la cola multiproyecto inicie y si alguna ejecución adicional falla.
- Si marcas **Incluir audio Applio**, los audios se generan uno por uno siguiendo el orden de los temas: primero el proyecto principal y luego cada tema adicional.

## 🎤 Configuración de Applio (Opcional)

Para usar voces personalizadas, necesitas tener Applio instalado:

1. Instala Applio desde su repositorio oficial
2. Configura tus modelos de voz
3. Asegúrate de que Applio esté corriendo en el puerto 6969
4. En el proyecto, marca la opción "Incluir audio Applio"

## 📁 Estructura del Proyecto

```
GoogleAIEdson/
├── public/                 # Archivos frontend
│   ├── index.html         # Página principal
│   ├── script.js          # Lógica del frontend
│   ├── styles.css         # Estilos
│   └── outputs/           # Archivos generados
├── applio-client.js       # Cliente para Applio
├── index.js               # Servidor principal
├── package.json           # Dependencias
├── .env.example           # Ejemplo de configuración
└── README.md              # Este archivo
```

## 🔧 API Endpoints

- `POST /generate` - Genera una sección individual
- `POST /continue` - Continúa con la siguiente sección
- `POST /generate-audio` - Genera audio con Google TTS
- `POST /generate-section-audio` - Genera audio con Applio
- `POST /regenerate-image` - Regenera una imagen específica
- `POST /generate-batch-automatic/multi` - Inicia la generación automática para múltiples proyectos en paralelo

## 🎮 Casos de Uso

### Para YouTubers de Gaming
- Crea guiones para reviews de juegos
- Genera contenido sobre lore de videojuegos
- Produce material para análisis de personajes

### Para Streamers
- Prepara contenido para streams temáticos
- Crea material educativo sobre gaming
- Genera scripts para videos informativos

### Para Creadores de Contenido
- Automatiza la creación de guiones
- Genera imágenes temáticas
- Produce audio profesional

## 🤝 Contribuciones

Las contribuciones son bienvenidas. Para contribuir:

1. Fork el proyecto
2. Crea una rama para tu feature (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abre un Pull Request

## 📄 Licencia

Este proyecto está bajo la Licencia MIT. Ver el archivo `LICENSE` para más detalles.

## 🙏 Agradecimientos

- Google AI por proporcionar las APIs de generación
- Applio por el sistema de TTS personalizable
- La comunidad de gaming por la inspiración

## 📞 Soporte

Si tienes problemas o preguntas:

1. Revisa la sección de issues en GitHub
2. Crea un nuevo issue con detalles del problema
3. Incluye logs y pasos para reproducir el error

---

Hecho con ❤️ para la comunidad gaming
