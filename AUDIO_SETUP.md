# 🎙️ Sistema Dual de TTS

## Configuración de Audio

Tu proyecto ahora tiene **2 sistemas de TTS separados**:

### 🟢 **Botón "Generar Audio" (Arriba)**
- **Método**: Google Gemini TTS
- **Ubicación**: Panel principal de controles
- **Uso**: Audio general del proyecto completo
- **Estado**: Puede tener límites de cuota (como viste)

### 🟠 **Botón Micrófono (En cada sección)**
- **Método**: Servidor Applio (exclusivo)
- **Ubicación**: Junto al botón de copiar en cada sección
- **Uso**: Audio específico de la sección actual
- **Ventaja**: Sin límites de cuota, mayor control

---

## 🚀 Cómo Usar el Sistema Applio

### **1. Ejecutar el Servidor Applio**
```bash
# En una terminal separada, navega a donde tengas applio_server.py
python applio_server.py
```

El servidor debe correrse en el puerto **5004** (configurado en .env)

### **2. Generar Audio de Sección**
1. Genera una sección normalmente
2. Haz clic en el **botón micrófono** 🎤 (naranja)
3. El audio se genera usando Applio
4. Se guarda automáticamente en la carpeta de la sección

### **3. Estructura de Archivos**
```
public/outputs/
└── [proyecto]/
    └── seccion_[numero]/
        ├── [proyecto]_seccion_[numero]_guion.txt
        ├── [proyecto]_seccion_[numero]_applio_[timestamp].wav  ← Applio
        └── [imagenes]
```

---

## 🔧 Configuración Técnica

### **Variables de Entorno (.env)**
```
GOOGLE_API_KEY=tu_api_key_de_google
APPLIO_SERVER_URL=http://localhost:5004
```

### **Puertos**
- **Proyecto Principal**: http://localhost:3000
- **Servidor Applio**: http://localhost:5004

---

## 🛠️ Resolución de Problemas

### **Error: "Servidor Applio no disponible"**
✅ **Solución**: 
```bash
python applio_server.py
```

### **Error: "No se puede conectar al servidor Applio"**
✅ **Verificar**:
- Que `applio_server.py` esté corriendo
- Que el puerto 5004 esté libre
- Que `applio_tts.py` esté en la misma carpeta

### **Error: "503 Service Unavailable"**
✅ **Causa**: El servidor Applio no responde
✅ **Solución**: Reiniciar el servidor Applio

---

## 💡 Recomendaciones de Uso

### **Usa Google Gemini TTS cuando:**
- Quieras una voz muy natural
- Tengas cuota disponible
- Hagas pruebas ocasionales

### **Usa Applio TTS cuando:**
- Generes audio constantemente
- Quieras evitar límites de cuota
- Necesites consistencia en la voz
- Quieras control total del audio

---

## 🎯 Estado Actual

✅ **Configurado**: Sistema dual de TTS  
✅ **Separado**: Google vs Applio  
✅ **Fallback**: Applio como principal para secciones  
✅ **Rutas**: `/generate-audio` (Google) vs `/generate-section-audio` (Applio)  

¡Ahora tienes lo mejor de ambos mundos! 🎉
