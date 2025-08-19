# Funcionalidad TTS (Text-to-Speech) Integrada

## ¿Qué hace?
Se ha integrado la funcionalidad de generación de audio TTS al proyecto principal de generación de contenido gaming. Ahora cada sección generada puede convertirse automáticamente en audio.

## ¿Cómo funciona?

### 1. **Interfaz de Usuario**
- Al generar una sección, aparecen **2 botones** en la esquina superior derecha:
  - 🟢 **Botón de Copiar** (verde): Copia el texto del guión al portapapeles
  - 🟠 **Botón de Audio** (naranja): Genera un archivo de audio WAV del guión

### 2. **Proceso de Audio**
1. Haz clic en el botón de micrófono 🎤
2. El botón muestra un spinner de carga
3. Se envía el texto a la API de Gemini TTS
4. Se genera un archivo WAV con voz natural
5. El archivo se guarda en la carpeta de la sección correspondiente

### 3. **Estructura de Archivos**
```
public/outputs/
└── [nombre_del_proyecto]/
    └── seccion_[numero]/
        ├── [proyecto]_seccion_[numero]_guion.txt
        ├── [proyecto]_seccion_[numero]_[timestamp].wav  ← ¡NUEVO!
        └── [imagenes generadas]
```

## Características Técnicas

### **Rutas del Servidor**
- `POST /applio_tts`: Genera audio simple y lo devuelve como stream
- `POST /generate-section-audio`: Genera audio y lo guarda en la carpeta de la sección

### **Configuración de Voz**
- **Voz por defecto**: Orus (voz masculina natural)
- **Calidad**: 24kHz, WAV
- **Motor**: Gemini 2.5 Pro TTS

### **Estados del Botón**
- 🟠 **Normal**: Listo para generar audio
- 🔄 **Cargando**: Generando audio (spinner)
- ✅ **Éxito**: Audio generado exitosamente (3 segundos)
- ❌ **Error**: Error en la generación (3 segundos)

## Integración con Applio

Esta funcionalidad utiliza la misma lógica que el proyecto de `applio_tts.py` y `applio_server.py`, pero integrada directamente en el proyecto principal usando la API de Gemini.

### **Ventajas**
- ✅ **Integración directa**: No necesita servidores externos
- ✅ **Automático**: Se guarda en la carpeta correcta automáticamente
- ✅ **Eficiente**: Usa la misma API que ya está configurada
- ✅ **Consistente**: Mantiene la estructura de carpetas del proyecto

## Uso Recomendado

1. **Genera tu sección** normalmente con el tema y configuraciones
2. **Revisa el texto** generado en la sección
3. **Genera el audio** haciendo clic en el botón de micrófono
4. **Espera** a que se complete (verás la confirmación)
5. **Encuentra el archivo** en la carpeta `outputs/[proyecto]/seccion_[numero]/`

## Resolución de Problemas

### **Si el audio no se genera:**
- Verifica que la API key de Google esté configurada
- Asegúrate de que hay texto en la sección
- Revisa la consola del navegador para errores específicos

### **Si el botón no responde:**
- Asegúrate de haber generado una sección primero
- Verifica que el servidor esté corriendo
- Revisa que tengas conexión a internet

¡La funcionalidad ya está lista para usar! 🎉
