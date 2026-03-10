const fs = require('fs');
let code = fs.readFileSync('index.js', 'utf8');

code = code.replace(/const GEMINI_TTS_MODEL_FLASH = process\.env\.GEMINI_TTS_MODEL_FLASH \|\| GEMINI_TTS_MODEL_FLASH;/, "const GEMINI_TTS_MODEL_FLASH = process.env.GEMINI_TTS_MODEL_FLASH || 'gemini-2.5-flash-preview-tts';");

code = code.replace(/const GEMINI_TTS_MODEL_PRO = process\.env\.GEMINI_TTS_MODEL_PRO \|\| GEMINI_TTS_MODEL_PRO;/, "const GEMINI_TTS_MODEL_PRO = process.env.GEMINI_TTS_MODEL_PRO || 'gemini-2.5-pro-preview-tts';");

fs.writeFileSync('index.js', code);
console.log('Fixed');
