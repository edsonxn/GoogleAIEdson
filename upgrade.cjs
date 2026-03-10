const fs = require('fs');

let code = fs.readFileSync('index.js', 'utf8');

const constants = `
const GEMINI_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || 'gemini-3.1-pro-preview';
const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
const GEMINI_TTS_MODEL_FLASH = process.env.GEMINI_TTS_MODEL_FLASH || 'gemini-2.5-flash-preview-tts';
const GEMINI_TTS_MODEL_PRO = process.env.GEMINI_TTS_MODEL_PRO || 'gemini-2.5-pro-preview-tts';
`;

code = code.replace(/import os from 'os';/, `import os from 'os';\n${constants}`);

// Replace standard models that act as fallbacks
code = code.replace(/'gemini-3-flash-preview'/g, 'GEMINI_TEXT_MODEL');
code = code.replace(/"gemini-3-flash-preview"/g, 'GEMINI_TEXT_MODEL');

code = code.replace(/'gemini-2.5-flash-preview-tts'/g, 'GEMINI_TTS_MODEL_FLASH');
code = code.replace(/"gemini-2.5-flash-preview-tts"/g, 'GEMINI_TTS_MODEL_FLASH');

code = code.replace(/'gemini-2.5-pro-preview-tts'/g, 'GEMINI_TTS_MODEL_PRO');
code = code.replace(/"gemini-2.5-pro-preview-tts"/g, 'GEMINI_TTS_MODEL_PRO');

code = code.replace(/return 'gemini-2.5-flash-image';/g, 'return GEMINI_IMAGE_MODEL;');

fs.writeFileSync('index.js', code);
console.log('Done!');