import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import wav from 'wav';
import fs from 'fs';
import { writeFile } from 'fs/promises';
import path from 'path';
import fetch from 'node-fetch';
import ApplioClient from "./applio-client.js";
import { transcribeAudio, getAudioTracks } from "./transcriber.js";
import multer from 'multer';
import axios from 'axios';
import os from 'os';

const GEMINI_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || 'gemini-3.1-pro-preview';
const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
const GEMINI_TTS_MODEL_FLASH = process.env.GEMINI_TTS_MODEL_FLASH || 'gemini-2.5-flash-preview-tts';
const GEMINI_TTS_MODEL_PRO = process.env.GEMINI_TTS_MODEL_PRO || 'gemini-2.5-pro-preview-tts';


// Helper para detectar el comando de Python correcto (Python 3.13 preferido sobre 3.14 preview)
let cachedPythonCommand = null;
async function detectPythonCommand() {
  if (cachedPythonCommand) return cachedPythonCommand;
  
  const { exec } = await import('child_process');
  const execPromise = (cmd) => new Promise((resolve, reject) => {
    exec(cmd, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });

  // 1. Intentar 'py -3.13' (Prioridad absoluta para evitar conflictos con 3.14)
  try {
    await execPromise('py -3.13 --version');
    console.log('✅ Usando Python 3.13 via py launcher');
    cachedPythonCommand = { cmd: 'py', args: ['-3.13'] };
    return cachedPythonCommand;
  } catch (e) {}

  // 2. Intentar 'python' (Estándar)
  try {
    await execPromise('python --version');
    cachedPythonCommand = { cmd: 'python', args: [] };
    return cachedPythonCommand;
  } catch (e) {}

  // 3. Intentar 'py' (Fallback a la última versión)
  try {
    await execPromise('py --version');
    console.log('⚠️ Usando Python default via py launcher (puede ser inestable si es 3.14)');
    cachedPythonCommand = { cmd: 'py', args: [] };
    return cachedPythonCommand;
  } catch (e) {}

  throw new Error('No se encontró ninguna instalación de Python válida.');
}


// Global error handlers to prevent application crashes
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Promise Rejection:', reason);
  console.error('Promise:', promise);
  // Don't exit the process, just log the error
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  // Don't exit the process, just log the error
});

// Función para obtener una instancia de GoogleGenerativeAI con fallback controlado
async function getGoogleAI(model = GEMINI_TEXT_MODEL, options = {}) {
  const { context = 'general', forcePrimary = false } = options;
  const usageState = getTrackedUsageState(context);
  const skipFreeApis = forcePrimary || usageState?.preferPrimary;

  const freeApiEntries = skipFreeApis ? [] : getFreeGoogleAPIKeys();
  const primaryApiEntry = process.env.GOOGLE_API_KEY
    ? { key: process.env.GOOGLE_API_KEY, name: GOOGLE_PRIMARY_API_NAME }
    : null;

  if (!freeApiEntries.length && !primaryApiEntry) {
    throw new Error('No hay API keys de Google configuradas en las variables de entorno');
  }

  let lastError = null;

  const attemptWithEntry = async (entry, keyType) => {
    if (!entry?.key) {
      throw new Error('API key de Google no configurada');
    }

    const isPrimary = keyType === 'primary';
    const emoji = isPrimary ? '💰' : '🆓';
    const contextLabel = context || 'general';
    const apiName = entry.name || (isPrimary ? GOOGLE_PRIMARY_API_NAME : 'API gratuita');

    console.log(`${emoji} Intentando con API ${apiName} (${contextLabel})...`);

    const genAI = new GoogleGenerativeAI(entry.key);
    const aiModel = genAI.getGenerativeModel({ model });

    // Usar countTokens en lugar de generateContent para ahorrar cuota
    // Esto valida que la key funciona y el modelo es accesible sin gastar una generación
    await aiModel.countTokens("test");

    console.log(`✅ API ${apiName} lista para usarse (${contextLabel})`);

    return { genAI, model: aiModel, apiKeyName: apiName, keyType };
  };

  if (freeApiEntries.length) {
    for (const entry of freeApiEntries) {
      try {
        return await attemptWithEntry(entry, 'free');
      } catch (error) {
        lastError = error;
        
        // Detectar error de cuota (429)
        const isRateLimit = error.message.includes('429') || (error.status === 429) || error.message.includes('Too Many Requests') || error.message.includes('Quota exceeded');
        
        if (isRateLimit) {
          console.warn(`⚠️ API gratuita ${entry.name} saturada (429). Probando siguiente llave...`);
          // NO marcamos fallo permanente, solo pasamos a la siguiente
        } else {
          markFreeApiFailure(context, error);
          console.warn(`⚠️ API gratuita ${entry.name} falló. Motivo: ${error.message}`);
        }
        
        // NO hacemos break, intentamos con la siguiente llave gratuita
      }
    }
  }

  if (!primaryApiEntry) {
    throw new Error(`Las APIs gratuitas fallaron y no hay API principal disponible. Último error: ${lastError?.message || 'desconocido'}`);
  }

  try {
    return await attemptWithEntry(primaryApiEntry, 'primary');
  } catch (error) {
    lastError = error;
    try {
      markPrimaryFailure(context, error);
    } catch (criticalError) {
      throw criticalError;
    }
    throw error;
  }
}

// Función auxiliar para obtener todas las API keys de Google en orden de prioridad
function getGoogleAPIKeys() {
  return [
    { key: process.env.GOOGLE_API_KEY_GRATIS, name: 'GRATIS' },
    { key: process.env.GOOGLE_API_KEY_GRATIS2, name: 'GRATIS2' },
    { key: process.env.GOOGLE_API_KEY_GRATIS3, name: 'GRATIS3' },
    { key: process.env.GOOGLE_API_KEY_GRATIS4, name: 'GRATIS4' },
    { key: process.env.GOOGLE_API_KEY_GRATIS5, name: 'GRATIS5' },
    { key: process.env.GOOGLE_API_KEY, name: 'NORMAL' }
  ].filter(apiKey => apiKey.key); // Solo retornar las que estén configuradas
}

// Función auxiliar para obtener solo las API keys gratuitas
function getFreeGoogleAPIKeys() {
  return [
    { key: process.env.GOOGLE_API_KEY_GRATIS, name: 'GRATIS' },
    { key: process.env.GOOGLE_API_KEY_GRATIS2, name: 'GRATIS2' },
    { key: process.env.GOOGLE_API_KEY_GRATIS3, name: 'GRATIS3' },
    { key: process.env.GOOGLE_API_KEY_GRATIS4, name: 'GRATIS4' },
    { key: process.env.GOOGLE_API_KEY_GRATIS5, name: 'GRATIS5' }
  ].filter(apiKey => apiKey.key); // Solo retornar las que estén configuradas
}

const GOOGLE_PRIMARY_API_NAME = 'PRINCIPAL';
const MAX_CONSECUTIVE_PRIMARY_FAILURES = 5;

const googleServiceUsageState = {
  llm: {
    preferPrimary: false,
    consecutivePrimaryFailures: 0,
    lastFailureReason: null,
    lastFailureTimestamp: null
  },
  tts: {
    preferPrimary: false,
    consecutivePrimaryFailures: 0,
    lastFailureReason: null,
    lastFailureTimestamp: null
  }
};

const IMAGE_MODEL_DEFAULT = 'gemini2';
const VALID_IMAGE_MODELS = new Set(['gemini2', 'gemini25', 'imagen40']);
const IMAGE_MODEL_LABELS = {
  gemini2: 'Gemini 2.0 Flash',
  gemini25: 'Gemini 2.5 Flash',
  imagen40: 'Imagen 4.0'
};

const VALID_ASPECT_RATIOS = new Set(['9:16', '16:9', '1:1']);
const ASPECT_RATIO_ALIASES = {
  portrait: '9:16',
  vertical: '9:16',
  reels: '9:16',
  tiktok: '9:16',
  shorts: '9:16',
  landscape: '16:9',
  horizontal: '16:9',
  widescreen: '16:9',
  square: '1:1',
  instagram: '1:1',
  '9x16': '9:16',
  '16x9': '16:9',
  '1x1': '1:1'
};

function normalizeAspectRatio(value, fallback = '9:16') {
  if (typeof fallback !== 'string' || !fallback.trim()) {
    fallback = '9:16';
  }

  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value === 'number') {
    return fallback;
  }

  const raw = String(value).trim();
  if (!raw) {
    return fallback;
  }

  const lower = raw.toLowerCase();
  if (ASPECT_RATIO_ALIASES[lower]) {
    return ASPECT_RATIO_ALIASES[lower];
  }

  const colonForm = lower
    .replace(/[x×]/g, ':')
    .replace(/\s+/g, '');

  const sanitized = colonForm.replace(/[^0-9:]/g, '');
  if (VALID_ASPECT_RATIOS.has(sanitized)) {
    return sanitized;
  }

  return fallback;
}

function describeAspectRatio(value, fallback = '9:16') {
  const ratio = normalizeAspectRatio(value, fallback);

  switch (ratio) {
    case '16:9':
      return {
        ratio,
        label: 'Aspecto 16:9 (widescreen)',
        promptLine: 'Formato: Aspecto 16:9 (widescreen)',
        googleFormatDescription: '16:9 aspect ratio image (widescreen format, landscape orientation, 1920x1080 or similar proportions)',
        googleOrientation: 'landscape orientation with 16:9 aspect ratio'
      };
    case '1:1':
      return {
        ratio,
        label: 'Aspecto 1:1 (cuadrado)',
        promptLine: 'Formato: Aspecto 1:1 (cuadrado)',
        googleFormatDescription: '1:1 aspect ratio image (square format, 1024x1024 or similar proportions)',
        googleOrientation: 'square format with 1:1 aspect ratio'
      };
    case '9:16':
    default:
      return {
        ratio: '9:16',
        label: 'Aspecto 9:16 (vertical)',
        promptLine: 'Formato: Aspecto 9:16 (vertical)',
        googleFormatDescription: '9:16 aspect ratio image (vertical format, portrait orientation, 720x1280 or similar proportions)',
        googleOrientation: 'portrait orientation with 9:16 aspect ratio'
      };
  }
}

function geminiModelSupportsAspectRatio(modelId) {
  return typeof modelId === 'string' && modelId.includes('2.5');
}

async function collectGeminiStreamData(streamSource) {
  const inlineImages = [];
  const textSegments = [];

  try {
    const asyncIterable = (() => {
      if (streamSource && typeof streamSource[Symbol.asyncIterator] === 'function') {
        return streamSource;
      }

      const nestedStream = streamSource?.stream;
      if (nestedStream && typeof nestedStream[Symbol.asyncIterator] === 'function') {
        return nestedStream;
      }

      return null;
    })();

    if (!asyncIterable) {
      throw new Error('Gemini stream source is not async iterable');
    }

    for await (const chunk of asyncIterable) {
      const candidates = chunk?.candidates || [];
      for (const candidate of candidates) {
        const parts = candidate?.content?.parts || [];
        for (const part of parts) {
          if (part?.inlineData?.data) {
            inlineImages.push(part.inlineData);
          } else if (typeof part?.text === 'string' && part.text.trim()) {
            textSegments.push(part.text.trim());
          }
        }
      }
    }
  } catch (streamError) {
    // Log the stream parsing error but don't re-throw it immediately
    console.error('❌ Error parsing Gemini stream:', streamError.message);

    // Check if this is a "Failed to parse stream" error from Google
    if (streamError.message && streamError.message.includes('Failed to parse stream')) {
      console.log('🔄 Detected Google Gemini stream parsing error - this is a known API issue');
      // Return empty results instead of throwing
      return {
        inlineImages: [],
        supplementalText: null
      };
    }

    // Re-throw other types of errors
    throw streamError;
  }

  return {
    inlineImages,
    supplementalText: textSegments.join('\n').trim() || null
  };
}

function normalizeImageModel(model) {
  if (!model) {
    return IMAGE_MODEL_DEFAULT;
  }

  const value = String(model).trim().toLowerCase();

  if (
    value === 'gemini' ||
    value === 'gemini2' ||
    value === 'gemini-2' ||
    value === 'gemini-2.0' ||
    value === 'gemini-2.0-flash' ||
    value === 'gemini-2.0-flash-preview-image-generation'
  ) {
    return 'gemini2';
  }

  if (
    value === 'gemini25' ||
    value === 'gemini-2.5' ||
    value === 'gemini-2.5-flash' ||
    value === 'gemini-2.5-flash-image'
  ) {
    return 'gemini25';
  }

  if (
    value === 'imagen' ||
    value === 'imagen40' ||
    value === 'imagen-4' ||
    value === 'imagen-4.0' ||
    value === 'imagen-4.0-generate-preview-06-06'
  ) {
    return 'imagen40';
  }

  if (VALID_IMAGE_MODELS.has(value)) {
    return value;
  }

  return IMAGE_MODEL_DEFAULT;
}

function getImageModelLabel(model) {
  const normalized = normalizeImageModel(model);
  return IMAGE_MODEL_LABELS[normalized] || IMAGE_MODEL_LABELS[IMAGE_MODEL_DEFAULT];
}

function isGeminiImageModel(model) {
  const normalized = normalizeImageModel(model);
  return normalized === 'gemini2' || normalized === 'gemini25';
}

function resolveGoogleImageModelId(model) {
  const normalized = normalizeImageModel(model);

  switch (normalized) {
    case 'gemini25':
      return GEMINI_IMAGE_MODEL;
    case 'imagen40':
      return 'imagen-4.0-generate-preview-06-06';
    case 'gemini2':
    default:
      return 'gemini-2.0-flash-preview-image-generation';
  }
}

function getTrackedUsageState(context) {
  return googleServiceUsageState[context] || null;
}

function markFreeApiFailure(context, error) {
  const state = getTrackedUsageState(context);
  if (!state) {
    return;
  }

  state.preferPrimary = true;
  state.lastFailureReason = error?.message || String(error || 'Error desconocido');
  state.lastFailureTimestamp = Date.now();
  state.consecutivePrimaryFailures = 0;

  console.warn(`⚠️ [${context}] API gratuita falló. Se usará la API principal en adelante. Motivo: ${state.lastFailureReason}`);
}

function markPrimarySuccess(context) {
  const state = getTrackedUsageState(context);
  if (!state) {
    return;
  }

  if (state.consecutivePrimaryFailures > 0) {
    console.log(`✅ [${context}] API principal respondió correctamente. Reiniciando contador de fallos consecutivos.`);
  }

  state.consecutivePrimaryFailures = 0;
  state.lastFailureReason = null;
  state.lastFailureTimestamp = null;
}

function markPrimaryFailure(context, error) {
  const state = getTrackedUsageState(context);
  if (!state) {
    return;
  }

  state.consecutivePrimaryFailures += 1;
  state.lastFailureReason = error?.message || String(error || 'Error desconocido');
  state.lastFailureTimestamp = Date.now();

  console.warn(`❌ [${context}] API principal falló (${state.consecutivePrimaryFailures}/${MAX_CONSECUTIVE_PRIMARY_FAILURES}). Motivo: ${state.lastFailureReason}`);

  if (state.consecutivePrimaryFailures >= MAX_CONSECUTIVE_PRIMARY_FAILURES) {
    const failureError = new Error(`API principal falló ${state.consecutivePrimaryFailures} veces seguidas: ${state.lastFailureReason}`);
    failureError.code = 'PRIMARY_API_FAILURE';
    throw failureError;
  }
}

const GOOGLE_IMAGE_API_DEFINITIONS = [
  { id: 'GRATIS', envKey: 'GOOGLE_API_KEY_GRATIS', label: 'API Gratis 1', shortName: 'GRATIS', type: 'free', defaultSelected: true },
  { id: 'GRATIS2', envKey: 'GOOGLE_API_KEY_GRATIS2', label: 'API Gratis 2', shortName: 'GRATIS2', type: 'free', defaultSelected: true },
  { id: 'GRATIS3', envKey: 'GOOGLE_API_KEY_GRATIS3', label: 'API Gratis 3', shortName: 'GRATIS3', type: 'free', defaultSelected: true },
  { id: 'GRATIS4', envKey: 'GOOGLE_API_KEY_GRATIS4', label: 'API Gratis 4', shortName: 'GRATIS4', type: 'free', defaultSelected: true },
  { id: 'GRATIS5', envKey: 'GOOGLE_API_KEY_GRATIS5', label: 'API Gratis 5', shortName: 'GRATIS5', type: 'free', defaultSelected: true },
  { id: 'PRINCIPAL', envKey: 'GOOGLE_API_KEY', label: 'API Principal', shortName: 'PRINCIPAL', type: 'primary', defaultSelected: false }
];

function getGoogleImageApiStatus() {
  const hasAvailableFreeApis = GOOGLE_IMAGE_API_DEFINITIONS.some(
    (definition) => definition.type === 'free' && process.env[definition.envKey]
  );

  return GOOGLE_IMAGE_API_DEFINITIONS.map((definition) => {
    const available = Boolean(process.env[definition.envKey]);
    const defaultSelected = available && (definition.defaultSelected || (!hasAvailableFreeApis && definition.id === 'PRINCIPAL'));

    return {
      id: definition.id,
      label: definition.label,
      type: definition.type,
      available,
      defaultSelected
    };
  });
}

function resolveGoogleImageApiSelection(preferredIds = []) {
  const normalizedPreferences = Array.isArray(preferredIds)
    ? preferredIds.map((id) => String(id).trim().toUpperCase()).filter(Boolean)
    : [];

  const hasExplicitPreferences = normalizedPreferences.length > 0;
  const selectedApis = [];
  const seenIds = new Set();

  const appendIfAvailable = (definition) => {
    if (!definition || seenIds.has(definition.id)) {
      return;
    }

    const apiKeyValue = process.env[definition.envKey];
    if (!apiKeyValue) {
      return;
    }

    seenIds.add(definition.id);
    selectedApis.push({
      id: definition.id,
      label: definition.label,
      shortName: definition.shortName,
      type: definition.type,
      key: apiKeyValue
    });
  };

  if (hasExplicitPreferences) {
    normalizedPreferences.forEach((preferenceId) => {
      const definition = GOOGLE_IMAGE_API_DEFINITIONS.find((item) => item.id === preferenceId);
      appendIfAvailable(definition);
    });

    if (!selectedApis.length) {
      return [];
    }

    return selectedApis;
  }

  GOOGLE_IMAGE_API_DEFINITIONS.forEach((definition) => {
    if (definition.type === 'free') {
      appendIfAvailable(definition);
    }
  });

  if (!selectedApis.length) {
    const primaryDefinition = GOOGLE_IMAGE_API_DEFINITIONS.find((definition) => definition.id === 'PRINCIPAL');
    appendIfAvailable(primaryDefinition);
  }

  return selectedApis;
}

const GOOGLE_API_MAX_ROUNDS = 2;
const GOOGLE_API_ROUND_DELAY_MS = 10_000;

const imageGenerationController = {
  activeSessionId: null,
  cancelRequested: false
};

function startImageGenerationSession() {
  const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  imageGenerationController.activeSessionId = sessionId;
  imageGenerationController.cancelRequested = false;
  console.log(`🆔 Sesión de generación de imágenes iniciada: ${sessionId}`);
  return sessionId;
}

function finishImageGenerationSession(sessionId) {
  if (imageGenerationController.activeSessionId === sessionId) {
    imageGenerationController.activeSessionId = null;
    imageGenerationController.cancelRequested = false;
    console.log(`🆔 Sesión de generación de imágenes finalizada: ${sessionId}`);
  }
}

function checkImageGenerationCancellation(sessionId) {
  if (
    sessionId &&
    imageGenerationController.activeSessionId === sessionId &&
    imageGenerationController.cancelRequested
  ) {
    const cancelError = new Error('Proceso de generación de imágenes cancelado por el usuario.');
    cancelError.code = 'CANCELLED_BY_USER';
    throw cancelError;
  }
}

import * as cheerio from 'cheerio';
import ffmpeg from 'fluent-ffmpeg';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import { createCanvas, loadImage } from 'canvas';
import ComfyUIClient from './comfyui-client.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Promisify exec for async/await usage
const execPromise = promisify(exec);

// Obtener __dirname equivalente en módulos ES6
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = 3000;

// Configurar cliente Applio
const applioClient = new ApplioClient();

// Variables para control de proceso ComfyUI
let comfyUIProcess = null;
const COMFYUI_PATH = 'C:\\comfy\\ComfyUI';
const COMFYUI_START_BAT = path.join(COMFYUI_PATH, 'start.bat');

// Variables para control de proceso Applio
let applioProcess = null;
let applioStarted = false; // Nueva variable para rastrear si ya se inició
const APPLIO_PATH = 'C:\\applio2\\Applio';
const APPLIO_START_BAT = path.join(APPLIO_PATH, 'run-applio.bat');

// Variable para rastrear progreso de proyectos
const projectProgressTracker = {};

// Variable para rastrear progreso de generación de clips separados
const clipProgressTracker = Object.create(null);

const applioAudioQueueState = {
  currentRunId: null,
  nextOrder: 0,
  pending: new Map(),
  processing: false
};

function resetApplioAudioQueue(runId = null) {
  applioAudioQueueState.currentRunId = runId;
  applioAudioQueueState.nextOrder = 0;
  applioAudioQueueState.pending.clear();
  applioAudioQueueState.processing = false;
}

function enqueueApplioAudioTask({ runId, order, label, task }) {
  return new Promise((resolve, reject) => {
    if (runId === undefined || runId === null) {
      reject(new Error('applioQueueRunId requerido para la cola de Applio'));
      return;
    }

    const normalizedOrder = Number.parseInt(order, 10);
    if (!Number.isFinite(normalizedOrder) || normalizedOrder < 0) {
      reject(new Error('applioQueueOrder inválido para la cola de Applio'));
      return;
    }

    if (typeof task !== 'function') {
      reject(new Error('La tarea de audio de Applio debe ser una función'));
      return;
    }

    if (applioAudioQueueState.currentRunId && applioAudioQueueState.currentRunId !== runId) {
      if (applioAudioQueueState.processing || applioAudioQueueState.pending.size > 0) {
        const warning = '⚠️ Cola de Applio ocupada con otra ejecución. Espera a que termine antes de iniciar una nueva.';
        console.warn(warning);
        reject(new Error('COLA_APPLIO_OCUPADA'));
        return;
      }
      resetApplioAudioQueue(runId);
    }

    if (!applioAudioQueueState.currentRunId) {
      resetApplioAudioQueue(runId);
    }

    if (applioAudioQueueState.pending.has(normalizedOrder)) {
      reject(new Error(`Ya existe una tarea en la cola de Applio con el orden ${normalizedOrder}`));
      return;
    }

    applioAudioQueueState.pending.set(normalizedOrder, {
      label: label || `orden_${normalizedOrder}`,
      task,
      resolve,
      reject
    });

    console.log(`🎧 Tarea de Applio encolada (runId=${runId}, orden=${normalizedOrder}, label=${label || 'sin etiqueta'})`);
    processApplioAudioQueue();
  });
}

async function processApplioAudioQueue() {
  if (applioAudioQueueState.processing) {
    return;
  }

  const nextTask = applioAudioQueueState.pending.get(applioAudioQueueState.nextOrder);
  if (!nextTask) {
    return;
  }

  applioAudioQueueState.processing = true;
  const currentOrder = applioAudioQueueState.nextOrder;
  console.log(`🎧 Procesando cola de Applio -> orden ${currentOrder} (${nextTask.label})`);

  try {
    const result = await nextTask.task();
    nextTask.resolve(result);
  } catch (error) {
    console.error(`❌ Error en cola de Applio (orden ${currentOrder}):`, error);
    nextTask.reject(error);
  } finally {
    applioAudioQueueState.pending.delete(currentOrder);
    applioAudioQueueState.nextOrder += 1;
    applioAudioQueueState.processing = false;
    setTimeout(processApplioAudioQueue, 0);
  }
}

// Sistema de cola para Google TTS (procesamiento secuencial)
const googleAudioQueueState = {
  currentRunId: null,
  nextOrder: 0,
  pending: new Map(),
  processing: false
};

function resetGoogleAudioQueue(runId = null) {
  googleAudioQueueState.currentRunId = runId;
  googleAudioQueueState.nextOrder = 0;
  googleAudioQueueState.pending.clear();
  googleAudioQueueState.processing = false;
}

function enqueueGoogleAudioTask({ runId, order, label, task }) {
  return new Promise((resolve, reject) => {
    if (runId === undefined || runId === null) {
      reject(new Error('googleQueueRunId requerido para la cola de Google TTS'));
      return;
    }

    const normalizedOrder = Number.parseInt(order, 10);
    if (!Number.isFinite(normalizedOrder) || normalizedOrder < 0) {
      reject(new Error('googleQueueOrder inválido para la cola de Google TTS'));
      return;
    }

    if (typeof task !== 'function') {
      reject(new Error('La tarea de audio de Google TTS debe ser una función'));
      return;
    }

    if (googleAudioQueueState.currentRunId && googleAudioQueueState.currentRunId !== runId) {
      if (googleAudioQueueState.processing || googleAudioQueueState.pending.size > 0) {
        const warning = '⚠️ Cola de Google TTS ocupada con otra ejecución. Espera a que termine antes de iniciar una nueva.';
        console.warn(warning);
        reject(new Error('COLA_GOOGLE_OCUPADA'));
        return;
      }
      resetGoogleAudioQueue(runId);
    }

    if (!googleAudioQueueState.currentRunId) {
      resetGoogleAudioQueue(runId);
    }

    if (googleAudioQueueState.pending.has(normalizedOrder)) {
      reject(new Error(`Ya existe una tarea en la cola de Google TTS con el orden ${normalizedOrder}`));
      return;
    }

    googleAudioQueueState.pending.set(normalizedOrder, {
      label: label || `orden_${normalizedOrder}`,
      task,
      resolve,
      reject
    });

    console.log(`🔊 Tarea de Google TTS encolada (runId=${runId}, orden=${normalizedOrder}, label=${label || 'sin etiqueta'})`);
    processGoogleAudioQueue();
  });
}

async function processGoogleAudioQueue() {
  if (googleAudioQueueState.processing) {
    console.log(`🔊 [COLA GOOGLE] Cola ya procesando, esperando...`);
    return;
  }

  const nextTask = googleAudioQueueState.pending.get(googleAudioQueueState.nextOrder);
  if (!nextTask) {
    console.log(`🔊 [COLA GOOGLE] No hay tareas pendientes en orden ${googleAudioQueueState.nextOrder}`);
    console.log(`🔊 [COLA GOOGLE] Tareas pendientes actuales:`, Array.from(googleAudioQueueState.pending.keys()));
    return;
  }

  googleAudioQueueState.processing = true;
  const currentOrder = googleAudioQueueState.nextOrder;
  console.log(`🔊 [COLA GOOGLE] Procesando cola -> orden ${currentOrder} (${nextTask.label})`);
  console.log(`🔊 [COLA GOOGLE] Tareas pendientes restantes:`, googleAudioQueueState.pending.size - 1);

  try {
    const result = await nextTask.task();
    console.log(`🔊 [COLA GOOGLE] Tarea ${currentOrder} completada exitosamente`);
    nextTask.resolve(result);
  } catch (error) {
    console.error(`❌ [COLA GOOGLE] Error en cola (orden ${currentOrder}):`, error);
    nextTask.reject(error);
  } finally {
    googleAudioQueueState.pending.delete(currentOrder);
    googleAudioQueueState.nextOrder += 1;
    googleAudioQueueState.processing = false;
    console.log(`🔊 [COLA GOOGLE] Procesamiento de orden ${currentOrder} finalizado, programando siguiente...`);
    setTimeout(processGoogleAudioQueue, 0);
  }
}

const comfyDefaultConfig = (() => {
  const parseResolution = (envVar, fallbackWidth, fallbackHeight) => {
    const rawValue = process.env[envVar];
    if (typeof rawValue !== 'string' || rawValue.trim() === '') {
      return { width: fallbackWidth, height: fallbackHeight };
    }

    const cleaned = rawValue.toLowerCase().replace(/[^0-9x]/g, '');
    const [widthStr, heightStr] = cleaned.split('x');
    const width = Number.parseInt(widthStr, 10);
    const height = Number.parseInt(heightStr, 10);

    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      console.warn(`⚠️ Valor de resolución inválido en ${envVar}: ${rawValue}. Usando fallback ${fallbackWidth}x${fallbackHeight}.`);
      return { width: fallbackWidth, height: fallbackHeight };
    }

    return { width, height };
  };

  const parseNumber = (envVar, fallback, { float = false, min } = {}) => {
    const rawValue = process.env[envVar];
    if (rawValue === undefined) {
      return fallback;
    }

    const parsed = float ? Number.parseFloat(rawValue) : Number.parseInt(rawValue, 10);
    if (!Number.isFinite(parsed) || (min !== undefined && parsed < min)) {
      console.warn(`⚠️ Valor inválido para ${envVar}: ${rawValue}. Usando fallback ${fallback}.`);
      return fallback;
    }

    return parsed;
  };

  return {
    steps: parseNumber('COMFY_DEFAULT_STEPS', 15, { min: 1 }),
    cfg: parseNumber('COMFY_DEFAULT_CFG', 1.8, { float: true, min: 0.1 }),
    guidance: parseNumber('COMFY_DEFAULT_GUIDANCE', 3.5, { float: true, min: 0 }),
    resolutions: {
      '16:9': parseResolution('COMFY_RESOLUTION_16_9', 800, 400),
      '9:16': parseResolution('COMFY_RESOLUTION_9_16', 400, 800),
      '1:1': parseResolution('COMFY_RESOLUTION_1_1', 800, 800)
    }
  };
})();

function resolveComfyDefaultResolution(aspectRatio = '16:9') {
  return (
    comfyDefaultConfig.resolutions[aspectRatio] ||
    comfyDefaultConfig.resolutions['16:9'] ||
    { width: 800, height: 400 }
  );
}

/**
 * Extrae solo el contenido del guión de un archivo TXT completo
 * @param {string} fullContent - Contenido completo del archivo TXT con metadatos
 * @returns {object} - Objeto con el contenido del guión y información adicional
 */
function extractScriptContent(fullContent) {
  try {
    if (!fullContent || typeof fullContent !== 'string') {
      return { content: '', isEmpty: true, hasStructure: false };
    }
    
    // Verificar si tiene la estructura esperada de metadatos
    const hasStructure = fullContent.includes('CONTENIDO DEL GUIÓN:') || 
                        fullContent.includes('===============================');
    
    // Buscar el marcador de inicio del contenido
    const contentStart = fullContent.indexOf('CONTENIDO DEL GUIÓN:');
    if (contentStart === -1) {
      // Si no encuentra el marcador, intentar buscar patrones alternativos
      const altPatterns = [
        'CONTENIDO:',
        'GUIÓN:',
        'SCRIPT:',
        'TEXTO:'
      ];
      
      let startIndex = -1;
      for (const pattern of altPatterns) {
        const index = fullContent.indexOf(pattern);
        if (index !== -1) {
          startIndex = index + pattern.length;
          break;
        }
      }
      
      if (startIndex === -1) {
        // Si no encuentra ningún patrón, devolver todo el contenido limpio
        // console.log('ℹ️ No se encontró marcador de inicio del guión, usando contenido completo');
        const cleanContent = fullContent.trim();
        return { 
          content: cleanContent, 
          isEmpty: cleanContent.length === 0, 
          hasStructure: hasStructure 
        };
      }
      
      const textAfterMarker = fullContent.substring(startIndex);
      const endMarker = textAfterMarker.indexOf('===============================');
      
      const extractedContent = endMarker !== -1 
        ? textAfterMarker.substring(0, endMarker).trim()
        : textAfterMarker.trim();
        
      return { 
        content: extractedContent, 
        isEmpty: extractedContent.length === 0, 
        hasStructure: hasStructure 
      };
    }
    
    // Extraer texto después del marcador "CONTENIDO DEL GUIÓN:"
    const startIndex = contentStart + 'CONTENIDO DEL GUIÓN:'.length;
    const textAfterMarker = fullContent.substring(startIndex);
    
    // Buscar el marcador de fin (línea de separación)
    const endMarker = textAfterMarker.indexOf('===============================');
    
    let scriptContent;
    if (endMarker !== -1) {
      // Extraer solo hasta el marcador de fin
      scriptContent = textAfterMarker.substring(0, endMarker);
    } else {
      // Si no hay marcador de fin, tomar todo después del inicio
      scriptContent = textAfterMarker;
    }
    
    // Limpiar el contenido
    scriptContent = scriptContent
      .replace(/Guión generado automáticamente por IA.*$/g, '') // Remover pie de página si quedó
      .replace(/^\s*\n+/, '') // Remover líneas vacías al inicio
      .replace(/\n+\s*$/, '') // Remover líneas vacías al final
      .trim();
    
    const isEmpty = scriptContent.length === 0;
    
    console.log(`📝 Script extraído: ${scriptContent.length} caracteres (de ${fullContent.length} originales)${isEmpty ? ' - CONTENIDO VACÍO' : ''}`);
    
    return { 
      content: scriptContent, 
      isEmpty: isEmpty, 
      hasStructure: hasStructure 
    };
    
  } catch (error) {
    console.error('❌ Error extrayendo contenido del script:', error);
    return { 
      content: fullContent.trim(), 
      isEmpty: fullContent.trim().length === 0, 
      hasStructure: false 
    }; // Devolver contenido original como fallback
  }
}

// Función para limpiar contenido de script y extraer solo el guion
function cleanScriptContent(rawContent) {
  if (!rawContent || typeof rawContent !== 'string') {
    return '';
  }
  
  let cleanScript = rawContent.trim();
  
  // Buscar el marcador "CONTENIDO DEL GUIÓN:"
  const contentMarker = "CONTENIDO DEL GUIÓN:";
  const contentIndex = cleanScript.indexOf(contentMarker);
  
  if (contentIndex !== -1) {
    // Extraer desde después del marcador hasta el final
    cleanScript = cleanScript.substring(contentIndex + contentMarker.length).trim();
    
    // Remover el footer si existe
    const footerMarker = "===============================";
    const footerIndex = cleanScript.lastIndexOf(footerMarker);
    if (footerIndex !== -1) {
      cleanScript = cleanScript.substring(0, footerIndex).trim();
    }
    
    // Remover "Guión generado automáticamente por IA" si existe
    const aiMarker = "Guión generado automáticamente por IA";
    const aiIndex = cleanScript.indexOf(aiMarker);
    if (aiIndex !== -1) {
      cleanScript = cleanScript.substring(0, aiIndex).trim();
    }
  }
  
  return cleanScript;
}

/**
 * Genera un guión faltante para una sección específica usando IA
 * @param {string} topic - Tema del proyecto
 * @param {number} sectionNumber - Número de la sección
 * @param {number} totalSections - Total de secciones del proyecto
 * @param {string} chapterTitle - Título del capítulo si está disponible
 * @param {Array} previousSections - Secciones anteriores para contexto
 * @param {string} scriptStyle - Estilo del script ('professional', 'comedy', 'custom')
 * @param {string} customStyleInstructions - Instrucciones personalizadas si es estilo custom
 * @param {number} wordsMin - Mínimo de palabras
 * @param {number} wordsMax - Máximo de palabras
 * @returns {Promise<object>} - Resultado de la generación
 */
async function generateMissingScript(topic, sectionNumber, totalSections, chapterTitle = null, previousSections = [], scriptStyle = 'professional', customStyleInstructions = '', wordsMin = 800, wordsMax = 1100) {
  try {
    console.log(`📝 Generando guión faltante para sección ${sectionNumber}/${totalSections}:`);
    console.log(`🎯 Tema: ${topic}`);
    console.log(`📖 Capítulo: ${chapterTitle || 'Sin título específico'}`);
    console.log(`🎨 Estilo: ${scriptStyle}`);
    
    // Preparar contexto de secciones anteriores en el formato correcto
    let previousChapterContent = [];
    if (previousSections && previousSections.length > 0) {
      previousChapterContent = previousSections.map(section => {
        const content = typeof section.script === 'string' ? section.script : section.script?.content || '';
        return content;
      });
    }
    
    // Preparar estructura de capítulos si hay título
    let chapterStructure = null;
    if (chapterTitle) {
      // Crear una estructura simple con el título actual
      chapterStructure = Array(totalSections).fill().map((_, index) => {
        if (index + 1 === sectionNumber) {
          return chapterTitle;
        }
        return `Capítulo ${index + 1}`;
      });
    }

    // Generar prompt usando las funciones existentes según el estilo
    let prompt;
    switch (scriptStyle) {
      case 'comedy':
        prompt = generateComedyPrompt(topic, totalSections, sectionNumber, chapterStructure, previousChapterContent, wordsMin, wordsMax);
        break;
      case 'custom':
        prompt = generateCustomPrompt(topic, totalSections, sectionNumber, chapterStructure, previousChapterContent, wordsMin, wordsMax, customStyleInstructions);
        break;
      case 'professional':
      default:
        prompt = generateProfessionalPrompt(topic, totalSections, sectionNumber, chapterStructure, previousChapterContent, wordsMin, wordsMax);
        break;
    }

    // Usar el cliente de IA con fallback automático
  const { model } = await getGoogleAI("gemini-3.1-flash-lite-preview", { context: 'llm' });
    
    console.log('🤖 Enviando prompt al modelo de IA...');
    const result = await model.generateContent({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        thinkingConfig: {
          thinkingBudget: 0, // Disables thinking
        }
      }
    });
    const response = await result.response;
    const generatedScript = response.text();
    
    if (!generatedScript || generatedScript.trim().length < 200) {
      throw new Error('El guión generado es demasiado corto o está vacío');
    }
    
    console.log(`✅ Guión generado: ${generatedScript.length} caracteres`);
    
    return {
      success: true,
      script: generatedScript.trim(),
      length: generatedScript.trim().length,
      sectionNumber: sectionNumber,
      topic: topic
    };
    
  } catch (error) {
    console.error(`❌ Error generando guión para sección ${sectionNumber}:`, error);
    return {
      success: false,
      error: error.message,
      sectionNumber: sectionNumber,
      topic: topic
    };
  }
}

// Funciones para controlar ComfyUI automáticamente
async function startComfyUI() {
  try {
    console.log('🚀 Iniciando ComfyUI en nueva ventana CMD...');
    
    // Verificar si ya está ejecutándose
    const client = new ComfyUIClient('http://127.0.0.1:8188');
    const connectionCheck = await client.checkConnection();
    if (connectionCheck.success) {
      console.log('✅ ComfyUI ya está ejecutándose');
      return true;
    }
    
    // Cerrar Applio antes de iniciar ComfyUI para evitar conflictos de recursos
    console.log('🛑 Cerrando Applio antes de iniciar ComfyUI para liberar recursos...');
    await stopApplio();
    console.log('✅ Applio cerrado, iniciando ComfyUI...');
    
    // Verificar que el archivo start.bat existe
    if (!fs.existsSync(COMFYUI_START_BAT)) {
      throw new Error(`No se encontró start.bat en: ${COMFYUI_START_BAT}`);
    }
    
    console.log(`📂 Abriendo nueva ventana CMD para ComfyUI...`);
    
    // Crear un archivo temporal .bat para evitar problemas con comillas
    const tempBatPath = path.join(__dirname, 'temp_start_comfyui.bat');
    const batContent = `@echo off
title ComfyUI Server - AutoRestart
cd /d "${COMFYUI_PATH}"
start.bat`;
    
    fs.writeFileSync(tempBatPath, batContent);
    
    // Ejecutar el archivo .bat en una nueva ventana
    comfyUIProcess = spawn('cmd', ['/c', 'start', tempBatPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    });
    
    // Desacoplar el proceso del proceso padre
    comfyUIProcess.unref();
    
    console.log(`🪟 Nueva ventana CMD abierta para ComfyUI`);
    
    // Limpiar el archivo temporal después de un momento
    setTimeout(() => {
      try {
        if (fs.existsSync(tempBatPath)) {
          fs.unlinkSync(tempBatPath);
        }
      } catch (error) {
        console.log('ℹ️ No se pudo eliminar archivo temporal:', tempBatPath);
      }
    }, 10000);
    
    // Esperar a que ComfyUI esté listo (máximo 90 segundos para dar tiempo al inicio)
    console.log('⏳ Esperando a que ComfyUI esté listo en la nueva ventana...');
    const maxAttempts = 360;
    let attempt = 0;
    
    while (attempt < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempt++;
      
      try {
        const check = await client.checkConnection();
        if (check.success) {
          console.log(`✅ ComfyUI listo después de ${attempt} segundos en nueva ventana`);
          return true;
        }
      } catch (error) {
        // Continuar intentando
      }
      
      if (attempt % 15 === 0) {
        console.log(`⏳ Intento ${attempt}/${maxAttempts}... (ComfyUI iniciándose en ventana separada)`);
      }
    }
    
    throw new Error('Timeout: ComfyUI no respondió después de 90 segundos');
    
  } catch (error) {
    console.error('❌ Error iniciando ComfyUI:', error.message);
    return false;
  }
}

async function stopComfyUI() {
  try {
    console.log('🛑 Cerrando ventana CMD de ComfyUI...');
    
    // Buscar y cerrar todos los procesos relacionados con ComfyUI
    // Esto cerrará tanto el proceso Python como la ventana CMD
    const killCommand = spawn('taskkill', [
      '/F',  // Forzar cierre
      '/IM', 'python.exe',  // Cerrar procesos Python (ComfyUI)
      '/T'   // Terminar árbol de procesos
    ], {
      stdio: 'ignore'
    });
    
    // También cerrar cualquier proceso CMD que tenga "ComfyUI" en el título
    const killCmdCommand = spawn('taskkill', [
      '/F',
      '/FI', 'WINDOWTITLE eq ComfyUI Server*'
    ], {
      stdio: 'ignore'
    });
    
    // Esperar a que los comandos de cierre terminen
    await Promise.all([
      new Promise(resolve => killCommand.on('close', resolve)),
      new Promise(resolve => killCmdCommand.on('close', resolve))
    ]);
    
    console.log('✅ Ventana CMD de ComfyUI cerrada');
    
    // Limpiar referencia del proceso
    comfyUIProcess = null;
    
    // Esperar un momento para que el proceso se cierre completamente
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    return true;
  } catch (error) {
    console.error('❌ Error cerrando ComfyUI:', error.message);
    return false;
  }
}

// Función para generar imagen con reinicio automático en caso de timeout
async function generateImageWithAutoRestart(prompt, options = {}, maxRetries = 2) {
  let attempt = 1;
  
  while (attempt <= maxRetries) {
    try {
      console.log(`🎨 [ATTEMPT ${attempt}/${maxRetries}] Generando imagen: "${prompt}"`);
      
      // Verificar si ComfyUI está disponible
      const client = new ComfyUIClient('http://127.0.0.1:8188');
      const connectionCheck = await client.checkConnection();
      
      if (!connectionCheck.success) {
        console.log(`⚠️ ComfyUI no disponible en intento ${attempt}, iniciando...`);
        const started = await startComfyUI();
        if (!started) {
          throw new Error('No se pudo iniciar ComfyUI');
        }
      }
      
      // Intentar generar imagen
      const result = await client.generateImage(prompt, options);
      console.log(`✅ Imagen generada exitosamente en intento ${attempt}`);
      return result;
      
    } catch (error) {
      console.error(`❌ Error en intento ${attempt}:`, error.message);
      
      // Si es timeout de ComfyUI y no es el último intento
      if (error.message.includes('COMFYUI_TIMEOUT') && attempt < maxRetries) {
        console.log(`⏱️ Timeout detectado (>90s), reiniciando ComfyUI...`);
        
        // Cerrar Applio y ComfyUI para liberar todos los recursos
        console.log('🛑 Cerrando Applio para liberar recursos GPU/VRAM...');
        await stopApplio();
        console.log('🛑 Cerrando ComfyUI que se colgó...');
        await stopComfyUI();
        
        // Esperar un momento antes de reiniciar
        console.log('⏳ Esperando 5 segundos antes de reiniciar...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Reiniciar ComfyUI
        console.log('🔄 Reiniciando ComfyUI en nueva ventana...');
        const restarted = await startComfyUI();
        
        if (!restarted) {
          console.error('❌ No se pudo reiniciar ComfyUI');
          if (attempt === maxRetries) {
            throw new Error('No se pudo reiniciar ComfyUI después del timeout');
          }
        } else {
          console.log('✅ ComfyUI reiniciado exitosamente, reintentando generación...');
        }
        
        attempt++;
        continue;
      }
      
      // Si no es timeout o es el último intento, lanzar error
      if (attempt === maxRetries) {
        throw error;
      }
      
      attempt++;
    }
  }
  
  throw new Error('Se agotaron los intentos de generación');
}

// Funciones para controlar Applio automáticamente
async function startApplio() {
  try {
    // Si ya está marcado como iniciado, solo verificar conexión
    if (applioStarted) {
      console.log('ℹ️ Applio ya fue iniciado anteriormente, verificando conexión...');
      const connectionCheck = await applioClient.checkConnection();
      if (connectionCheck) {
        console.log('✅ Applio sigue ejecutándose y listo');
        return true;
      } else {
        console.log('⚠️ Applio fue iniciado pero no responde, intentando reiniciar...');
        console.log('🔍 [DEBUG] Reseteando estado de Applio...');
        applioStarted = false; // Reset para permitir reinicio
      }
    }
    
    console.log('🚀 Iniciando Applio en nueva ventana CMD (primera vez)...');
    
    // Verificar si ya está ejecutándose
    const connectionCheck = await applioClient.checkConnection();
    if (connectionCheck) {
      console.log('✅ Applio ya está ejecutándose');
      applioStarted = true;
      return true;
    }
    
    // Verificar que el archivo run-applio.bat existe
    if (!fs.existsSync(APPLIO_START_BAT)) {
      throw new Error(`No se encontró run-applio.bat en: ${APPLIO_START_BAT}`);
    }
    
    console.log(`📂 Abriendo nueva ventana CMD para Applio...`);
    
    // Crear un archivo temporal .bat para evitar problemas con comillas
    const tempBatPath = path.join(__dirname, 'temp_start_applio.bat');
    const batContent = `@echo off
title Applio Server - PERMANENTE
cd /d "${APPLIO_PATH}"
run-applio.bat`;
    
    fs.writeFileSync(tempBatPath, batContent);
    
    // Ejecutar el archivo .bat en una nueva ventana
    applioProcess = spawn('cmd', ['/c', 'start', tempBatPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    });
    
    // Desacoplar el proceso del proceso padre
    applioProcess.unref();
    
    console.log(`🪟 Nueva ventana CMD abierta para Applio - PERMANENTE`);
    
    // Limpiar el archivo temporal después de un momento
    setTimeout(() => {
      try {
        if (fs.existsSync(tempBatPath)) {
          fs.unlinkSync(tempBatPath);
        }
      } catch (error) {
        console.log('ℹ️ No se pudo eliminar archivo temporal:', tempBatPath);
      }
    }, 10000);
    
    // Esperar a que Applio esté listo (máximo 120 segundos para dar tiempo al inicio)
    console.log('⏳ Esperando a que Applio esté listo en la nueva ventana...');
    const maxAttempts = 120;
    let attempt = 0;
    
    while (attempt < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempt++;
      
      try {
        const check = await applioClient.checkConnection();
        if (check) {
          console.log(`✅ Applio listo después de ${attempt} segundos en nueva ventana`);
          applioStarted = true; // Marcar como iniciado
          return true;
        }
      } catch (error) {
        // Continuar intentando
      }
      
      if (attempt % 20 === 0) {
        console.log(`⏳ Intento ${attempt}/${maxAttempts}... (Applio iniciándose en ventana separada)`);
      }
    }
    
    throw new Error('Timeout: Applio no respondió después de 120 segundos');
    
  } catch (error) {
    console.error('❌ Error iniciando Applio:', error.message);
    console.log('🔍 [DEBUG] Reseteando estado debido a error');
    applioStarted = false;
    return false;
  }
}

async function stopApplio() {
  try {
    console.log('🛑 Cerrando ventana CMD de Applio...');
    
    // Buscar y cerrar todos los procesos relacionados con Applio
    // Esto cerrará tanto el proceso Python como la ventana CMD
    const killCommand = spawn('taskkill', [
      '/F',  // Forzar cierre
      '/IM', 'python.exe',  // Cerrar procesos Python (Applio)
      '/T'   // Terminar árbol de procesos
    ], {
      stdio: 'ignore'
    });
    
    // También cerrar cualquier proceso CMD que tenga "Applio" en el título
    const killCmdCommand = spawn('taskkill', [
      '/F',
      '/FI', 'WINDOWTITLE eq Applio Server*'
    ], {
      stdio: 'ignore'
    });
    
    // Esperar a que los comandos de cierre terminen
    await Promise.all([
      new Promise(resolve => killCommand.on('close', resolve)),
      new Promise(resolve => killCmdCommand.on('close', resolve))
    ]);
    
    console.log('✅ Ventana CMD de Applio cerrada');
    
    // Limpiar referencia del proceso y estado
    applioProcess = null;
    applioStarted = false; // Reset del estado
    
    // Esperar un momento para que el proceso se cierre completamente
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    return true;
  } catch (error) {
    console.error('❌ Error cerrando Applio:', error.message);
    return false;
  }
}

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' })); // Aumentar límite para payloads grandes
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true })); // Para formularios grandes

// --- RUTAS DE ESTILOS PERSONALIZADOS ---
const STYLES_FILE_PATH = path.join(__dirname, 'styles.json');

// Obtener estilos personalizados
app.get('/api/custom-styles', async (req, res) => {
  try {
    if (!fs.existsSync(STYLES_FILE_PATH)) {
        await writeFile(STYLES_FILE_PATH, JSON.stringify({ scriptStyles: [], thumbnailStyles: [] }, null, 2));
    }
    const data = await fs.promises.readFile(STYLES_FILE_PATH, 'utf8');
    res.json(JSON.parse(data));
  } catch (error) {
    console.error('Error al leer estilos:', error);
    res.status(500).json({ error: 'Error al leer estilos' });
  }
});

// Guardar estilos personalizados
app.post('/api/custom-styles', async (req, res) => {
  try {
    const { scriptStyles, thumbnailStyles } = req.body;
    
    // Leer archivo actual para preservar datos si solo se envía uno
    let currentData = { scriptStyles: [], thumbnailStyles: [] };
    if (fs.existsSync(STYLES_FILE_PATH)) {
        const fileContent = await fs.promises.readFile(STYLES_FILE_PATH, 'utf8');
        try {
            currentData = JSON.parse(fileContent);
        } catch (e) {
            console.error('Error parseando estilos existentes, sobrescribiendo', e);
        }
    }

    if (scriptStyles !== undefined) currentData.scriptStyles = scriptStyles;
    if (thumbnailStyles !== undefined) currentData.thumbnailStyles = thumbnailStyles;

    await writeFile(STYLES_FILE_PATH, JSON.stringify(currentData, null, 2));
    res.json({ success: true, message: 'Estilos guardados correctamente' });
  } catch (error) {
    console.error('Error al guardar estilos:', error);
    res.status(500).json({ error: 'Error al guardar estilos' });
  }
});


// --- CONFIGURACIÓN DE DIRECTORIO DE OUTPUTS ---
let globalOutputDir = process.env.OUTPUTS_DIR || path.join(process.cwd(), 'public', 'outputs');
const settingsPath = path.join(process.cwd(), 'settings.json');

try {
  if (fs.existsSync(settingsPath)) {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    if (settings.outputsDir) {
      globalOutputDir = settings.outputsDir;
    }
  }
} catch (e) {
  console.error("Error cargando settings.json:", e);
}

// Endpoint para obtener o guardar la ruta base de proyectos
app.get('/api/settings/output-dir', (req, res) => {
  res.json({ outputsDir: globalOutputDir });
});

app.post('/api/settings/output-dir', (req, res) => {
  try {
    const newDir = req.body.outputsDir;
    if (newDir) {
      globalOutputDir = newDir;
      if (!fs.existsSync(globalOutputDir)) {
        fs.mkdirSync(globalOutputDir, { recursive: true });
      }
      fs.writeFileSync(settingsPath, JSON.stringify({ outputsDir: globalOutputDir }, null, 2));
      console.log('✅ Directorio de outputs actualizado:', globalOutputDir);
      res.json({ success: true, message: 'Directorio actualizado', outputsDir: globalOutputDir });
    } else {
      res.status(400).json({ error: 'Falta outputsDir' });
    }
  } catch (err) {
    console.error('Error guardando directorio:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- ENDPOINTS PARA CONFIGURACIÓN DE API KEYS Y PATHS ---
const envFilePath = path.join(__dirname, '.env');

// Leer configuración actual del .env
app.get('/api/settings/env-config', (req, res) => {
  try {
    let envVars = {};
    if (fs.existsSync(envFilePath)) {
      const content = fs.readFileSync(envFilePath, 'utf8');
      const lines = content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex === -1) continue;
        const key = trimmed.substring(0, eqIndex).trim();
        const value = trimmed.substring(eqIndex + 1).trim();
        envVars[key] = value;
      }
    }
    // Devolver solo las keys relevantes (sin exponer valores completos por seguridad - solo si existen)
    res.json({
      GOOGLE_API_KEY: envVars.GOOGLE_API_KEY || '',
      GOOGLE_API_KEY_GRATIS: envVars.GOOGLE_API_KEY_GRATIS || '',
      GOOGLE_API_KEY_GRATIS2: envVars.GOOGLE_API_KEY_GRATIS2 || '',
      GOOGLE_API_KEY_GRATIS3: envVars.GOOGLE_API_KEY_GRATIS3 || '',
      GOOGLE_API_KEY_GRATIS4: envVars.GOOGLE_API_KEY_GRATIS4 || '',
      GOOGLE_API_KEY_GRATIS5: envVars.GOOGLE_API_KEY_GRATIS5 || '',
      OPENAI_API_KEY: envVars.OPENAI_API_KEY || '',
      APPLIO_SERVER_URL: envVars.APPLIO_SERVER_URL || 'http://localhost:6969',
      APPLIO_PATH: envVars.APPLIO_PATH || 'C:\\applio2\\Applio',
    });
  } catch (err) {
    console.error('Error leyendo .env:', err);
    res.status(500).json({ error: err.message });
  }
});

// Guardar configuración en el .env
app.post('/api/settings/env-config', (req, res) => {
  try {
    const updates = req.body;
    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({ error: 'Body inválido' });
    }

    // Leer .env actual o crear uno vacío
    let existingLines = [];
    if (fs.existsSync(envFilePath)) {
      existingLines = fs.readFileSync(envFilePath, 'utf8').split('\n');
    }

    // Para cada key que viene del frontend, actualizar o agregar
    const allowedKeys = [
      'GOOGLE_API_KEY', 'GOOGLE_API_KEY_GRATIS', 'GOOGLE_API_KEY_GRATIS2',
      'GOOGLE_API_KEY_GRATIS3', 'GOOGLE_API_KEY_GRATIS4', 'GOOGLE_API_KEY_GRATIS5',
      'OPENAI_API_KEY', 'APPLIO_SERVER_URL', 'APPLIO_PATH'
    ];

    for (const key of allowedKeys) {
      if (!(key in updates)) continue;
      const newValue = String(updates[key]).trim();
      let found = false;

      for (let i = 0; i < existingLines.length; i++) {
        const line = existingLines[i].trim();
        if (line.startsWith(key + '=') || line.startsWith('#' + key + '=')) {
          existingLines[i] = newValue ? `${key}=${newValue}` : `# ${key}=`;
          found = true;
          break;
        }
      }

      if (!found && newValue) {
        existingLines.push(`${key}=${newValue}`);
      }

      // Actualizar process.env en caliente
      if (newValue) {
        process.env[key] = newValue;
      } else {
        delete process.env[key];
      }
    }

    fs.writeFileSync(envFilePath, existingLines.join('\n'), 'utf8');
    console.log('✅ Configuración .env actualizada');
    res.json({ success: true, message: 'Configuración guardada. Algunas cambios requieren reiniciar el servidor.' });
  } catch (err) {
    console.error('Error guardando .env:', err);
    res.status(500).json({ error: err.message });
  }
});
// ----------------------------------------------


app.use('/outputs', (req, res, next) => express.static(globalOutputDir)(req, res, next));
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
    fileSize: 50 * 1024 * 1024 * 1024, // 50GB máximo (aumentado para evitar errores)
    fieldSize: 100 * 1024 * 1024 // 100MB para campos de texto grandes
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

// Caché de clientes para Google GenAI TTS
const googleTTSClients = new Map();

// La instancia de AI genérica se inicializará dinámicamente cuando sea necesaria
let ai = null;

const DEFAULT_TTS_VOICE = 'Kore';

function getGoogleTTSClient(apiKey) {
  if (!apiKey) {
    throw new Error('No hay API key de Google configurada para TTS');
  }

  if (!googleTTSClients.has(apiKey)) {
    googleTTSClients.set(apiKey, new GoogleGenAI({ apiKey }));
  }

  return googleTTSClients.get(apiKey);
}

// Configurar cliente OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Almacén de conversaciones en memoria (historial por proyecto)
const conversationStore = new Map();

// Función helper para retry automático con Google AI
async function generateContentWithRetry(ai, params, maxRetries = 3, delay = 2000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🤖 Intento ${attempt}/${maxRetries} de generar contenido...`);
      const response = await ai.models.generateContent(params);
      console.log(`✅ Contenido generado exitosamente en el intento ${attempt}`);
      return response;
    } catch (error) {
      console.error(`❌ Error en intento ${attempt}/${maxRetries}:`, error.message);
      
      if (error.status === 503 && attempt < maxRetries) {
        console.log(`⏳ Esperando ${delay}ms antes del siguiente intento...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 1.5; // Incrementar delay exponencialmente
      } else {
        throw error; // Si no es error 503 o es el último intento, lanzar error
      }
    }
  }
}

// Función universal para generar contenido con múltiples proveedores LLM
// Función auxiliar para limpiar respuestas del LLM (eliminar bloques de pensamiento)
function cleanLlmResponse(text) {
  if (!text || typeof text !== 'string') return text;
  
  // Eliminar bloques <thought>...</thought>
  let cleaned = text.replace(/<thought>[\s\S]*?<\/thought>/gi, '');
  
  // Eliminar bloques "thought\nThinking Process:..." hasta el final del bloque de pensamiento
  // Asumimos que el pensamiento termina cuando empieza el texto real o hay un salto de línea doble significativo
  // Pero el formato mostrado por el usuario es complejo.
  // "thought\nThinking Process:\n...\n\n    Si el equipo..."
  
  // Estrategia: Si detectamos "Thinking Process:", buscamos dónde termina.
  // A menudo termina cuando empieza el contenido real, que suele estar marcado por el inicio del script o simplemente texto normal.
  
  if (cleaned.includes('Thinking Process:')) {
    // Intentar encontrar el final del proceso de pensamiento
    // A veces el modelo pone el output final después de una línea separadora o simplemente al final
    
    // Si hay un patrón claro de inicio de script (e.g. "Si el equipo...")
    // Es difícil predecir.
    
    // Opción segura: Si el texto empieza con "thought" o "Thinking Process", intentar cortar hasta el primer párrafo que parezca contenido final.
    // O buscar marcadores comunes como "Text:", "Script:", "Output:", "Draft:", "Final Text:"
    
    const markers = ['Final Text:', 'Output:', 'Script:', 'Here is the script:', 'Here is the text:'];
    let bestIndex = -1;
    
    for (const marker of markers) {
      const idx = cleaned.lastIndexOf(marker);
      if (idx !== -1) {
        // Verificar si lo que sigue es sustancial
        if (idx > bestIndex) bestIndex = idx;
      }
    }
    
    if (bestIndex !== -1) {
      // Encontramos un marcador, devolvemos lo que sigue
      // Buscar el salto de línea después del marcador
      const contentStart = cleaned.indexOf('\n', bestIndex);
      if (contentStart !== -1) {
        return cleaned.substring(contentStart).trim();
      }
    }
    
    // Si no hay marcadores claros, intentar eliminar el bloque inicial si es muy obvio
    // El ejemplo del usuario muestra "thought\nThinking Process:..." al principio.
    // Y luego mucho texto indentado.
    // Y luego el texto final.
    
    // Regex para eliminar el bloque inicial de pensamiento si existe
    cleaned = cleaned.replace(/^thought\s*Thinking Process:[\s\S]*?(?=\n\s*[A-Z¡¿])/i, '').trim();
    
    // Si sigue teniendo "Thinking Process:", intentar otra estrategia agresiva
    if (cleaned.includes('Thinking Process:')) {
       // Buscar el último bloque de texto que parezca el resultado final
       // A menudo el modelo repite el texto final al final.
       // Pero es arriesgado cortar demasiado.
    }
  }
  
  return cleaned.trim();
}

async function generateUniversalContent(model, promptOrHistory, systemInstruction = null, maxRetries = 3) {
  console.log(`🤖 Generando contenido con modelo: ${model}`);
  
  // Determinar el proveedor basado en el modelo
  const isOpenAI = model.includes('gpt') || model.includes('openai');
  const isGoogle = model.includes('gemini') || model.includes('google');
  
  console.log(`🔍 Proveedor detectado: ${isOpenAI ? 'OpenAI' : 'Google AI'} para modelo "${model}"`);
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
  let currentApiKeyType = null;

    try {
      console.log(`🔄 Intento ${attempt}/${maxRetries} con ${isOpenAI ? 'OpenAI' : 'Google AI'}...`);
      
      if (isOpenAI) {
        // Usar OpenAI
        const messages = [];
        
        if (systemInstruction) {
          messages.push({
            role: "system",
            content: systemInstruction
          });
        }
        
        // Si promptOrHistory es un array (historial de conversación)
        if (Array.isArray(promptOrHistory)) {
          // OPTIMIZACIÓN PARA OPENAI: Solo usar los últimos 2 mensajes para ahorrar tokens
          const recentHistory = promptOrHistory.slice(-2);
          console.log(`🔄 OPTIMIZACIÓN OpenAI - Usando solo los últimos ${recentHistory.length} mensajes de ${promptOrHistory.length} total`);
          
          recentHistory.forEach(h => {
            if (h.role === 'user') {
              messages.push({
                role: "user",
                content: h.parts[0].text
              });
            } else if (h.role === 'model') {
              messages.push({
                role: "assistant", 
                content: h.parts[0].text
              });
            }
          });
        } else {
          // Si es un string simple
          messages.push({
            role: "user", 
            content: promptOrHistory
          });
        }
        
        // Configurar parámetros según el modelo
        const requestConfig = {
          model: model,
          messages: messages
        };
        
        // NO configurar max_completion_tokens - usar límites por defecto como Gemini
        // Esto permite máxima memoria disponible para cada modelo
        
        // Solo agregar temperature si NO es un modelo GPT-5 (todos los GPT-5 solo soportan valor por defecto)
        if (!model.startsWith('gpt-5')) {
          requestConfig.temperature = 0.7;
        }
        
        const response = await openai.chat.completions.create(requestConfig);
        
        console.log(`✅ Contenido generado exitosamente con OpenAI en intento ${attempt}`);
        
        const result = {
          text: response.choices[0].message.content
        };
        
        return result;
        
      } else {
        // Usar Google AI con sistema de fallback
  const { model: model_instance, keyType } = await getGoogleAI(model, { context: 'llm' });
  currentApiKeyType = keyType || null;

        // Si promptOrHistory es un array (historial de conversación)
        if (Array.isArray(promptOrHistory)) {
          const result = await model_instance.generateContent({
            contents: promptOrHistory,
            systemInstruction: systemInstruction
          });
          const response = await result.response;
          console.log(`✅ Contenido generado exitosamente con Google AI en intento ${attempt}`);
          if (currentApiKeyType === 'primary') {
            markPrimarySuccess('llm');
          }
          return cleanLlmResponse(await response.text());
        } else {
          const result = await model_instance.generateContent(promptOrHistory);
          const response = await result.response;
          console.log(`✅ Contenido generado exitosamente con Google AI en intento ${attempt}`);
          if (currentApiKeyType === 'primary') {
            markPrimarySuccess('llm');
          }
          return cleanLlmResponse(await response.text());
        }
      }
      
    } catch (error) {
      console.error(`❌ Error en intento ${attempt}/${maxRetries}:`, error.message);

      if (isGoogle) {
        if (currentApiKeyType === 'free') {
          markFreeApiFailure('llm', error);
        } else if (currentApiKeyType === 'primary') {
          try {
            markPrimaryFailure('llm', error);
          } catch (criticalError) {
            throw criticalError;
          }
        }
      }
      
      let isRetryableError = (isOpenAI && error.status >= 500) || 
                             (!isOpenAI && error.status === 503);

      if (isGoogle && currentApiKeyType === 'free') {
        isRetryableError = true;
      }
      
      if (isRetryableError && attempt < maxRetries) {
        const baseDelay = 2000 * Math.pow(1.5, attempt - 1);
        const delay = (isGoogle && currentApiKeyType === 'free') ? 250 : baseDelay;
        console.log(`⏳ Esperando ${delay}ms antes del siguiente intento...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }
  
  // Si llegamos aquí, todos los intentos fallaron
  throw new Error(`No se pudo generar contenido después de ${maxRetries} intentos`);
}

// Función para optimizar historial manteniendo continuidad narrativa
function optimizeConversationHistory(conversation) {
  const historialAntes = conversation.history.length;
  
  // No optimizar si el historial es pequeño
  if (historialAntes <= 6) {
    return;
  }
  
  console.log(`🧠 OPTIMIZACIÓN INTELIGENTE - Manteniendo continuidad narrativa...`);
  
  if (historialAntes > 8) {
    // Para series largas: mantener contexto inicial + contexto reciente
    const contextoInicial = conversation.history.slice(0, 2); // Primer capítulo
    const contextoReciente = conversation.history.slice(-6);   // Últimos 3 capítulos
    
    conversation.history = [...contextoInicial, ...contextoReciente];
    
    console.log(`🔄 OPTIMIZACIÓN - Historial reestructurado de ${historialAntes} a ${conversation.history.length} mensajes`);
    console.log(`📚 ESTRATEGIA - Manteniendo: capítulo inicial (contexto base) + últimos 3 capítulos (continuidad)`);
  } else {
    // Para series medianas: mantener últimos 3 capítulos
    conversation.history = conversation.history.slice(-6);
    console.log(`🔄 OPTIMIZACIÓN - Historial reducido de ${historialAntes} a ${conversation.history.length} mensajes (últimos 3 capítulos)`);
  }
  
  console.log(`💰 AHORRO DE TOKENS - Eliminados ${historialAntes - conversation.history.length} mensajes intermedios`);
}

// Función para estimar tokens aproximadamente (1 token ≈ 4 caracteres en español)
function estimateTokens(text) {
  if (!text || typeof text !== 'string') return 0;
  return Math.ceil(text.length / 4);
}

// Función para obtener o crear una conversación
function getOrCreateConversation(projectKey) {
  if (!conversationStore.has(projectKey)) {
    conversationStore.set(projectKey, {
      history: [],
      topic: '',
      totalSections: 0,
      currentSection: 0,
      chapterStructure: [],
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

// Función para obtener las voces disponibles de Applio
function getAvailableVoices() {
  try {
    const voicesPath = path.join('C:', 'applio2', 'Applio', 'logs', 'VOCES');
    console.log(`🔍 Buscando voces en: ${voicesPath}`);
    
    if (!fs.existsSync(voicesPath)) {
      console.warn(`⚠️ Carpeta de voces no encontrada: ${voicesPath}`);
      return [{
        name: 'RemyOriginal (Default)',
        path: 'logs\\VOCES\\RemyOriginal.pth',
        displayName: 'RemyOriginal'
      }];
    }
    
    const files = fs.readdirSync(voicesPath);
    const voiceFiles = files.filter(file => file.endsWith('.pth'));
    
    console.log(`📂 Archivos .pth encontrados: ${voiceFiles.length}`);
    
    const voices = voiceFiles.map(file => {
      const baseName = path.basename(file, '.pth');
      return {
        name: baseName,
        path: `logs\\VOCES\\${file}`,
        displayName: baseName
      };
    });
    
    // Si no hay voces, agregar la por defecto
    if (voices.length === 0) {
      voices.push({
        name: 'RemyOriginal (Default)',
        path: 'logs\\VOCES\\RemyOriginal.pth',
        displayName: 'RemyOriginal'
      });
    }
    
    console.log(`✅ Voces disponibles: ${voices.map(v => v.displayName).join(', ')}`);
    return voices;
    
  } catch (error) {
    console.error('❌ Error leyendo voces:', error);
    return [{
      name: 'RemyOriginal (Default)',
      path: 'logs\\VOCES\\RemyOriginal.pth',
      displayName: 'RemyOriginal'
    }];
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
  // Si es un estilo personalizado (enviado desde el frontend)
  if (typeof styleId === 'object' && styleId) {
    // Construir instrucciones completas usando los colores específicos
    const primaryColor = styleId.primaryColor || 'amarillo';
    const secondaryColor = styleId.secondaryColor || 'blanco';
    const customInstructions = styleId.instructions || '';
    
    const fullInstructions = `El texto debe tener la frase principal en color ${primaryColor} brillante y la frase secundaria en color ${secondaryColor}, ambas con contorno negro grueso, letras brillosas con efecto luminoso y resplandor. Estilo visual: ${customInstructions}`;
    
    return fullInstructions;
  }
  
  // Si es un estilo predeterminado
  if (typeof styleId === 'string' && defaultThumbnailStyles[styleId]) {
    return defaultThumbnailStyles[styleId].instructions;
  }
  
  // Fallback al estilo predeterminado
  return defaultThumbnailStyles.default.instructions;
}

// Limpiar conversaciones antiguas cada hora
setInterval(cleanOldConversations, 60 * 60 * 1000);

// ================================
// SISTEMA DE GUARDADO Y CARGA DE PROYECTOS
// ================================

// Función para guardar el estado completo del proyecto
function saveProjectState(projectData) {
  try {
    const { 
      topic, 
      folderName, 
      totalSections, 
      currentSection, 
      voice, 
      imageModel, 
      scriptStyle, 
      customStyleInstructions,
      promptModifier,
      imageCount,
      minWords,
      maxWords,
      skipImages,
      googleImages,
      applioVoice
    } = projectData;
    
    const safeFolderName = folderName && folderName.trim() 
      ? createSafeFolderName(folderName.trim())
      : createSafeFolderName(topic);
    
    const outputsDir = globalOutputDir;
    const projectDir = path.join(outputsDir, safeFolderName);
    
    // Crear carpetas si no existen
    if (!fs.existsSync(outputsDir)) {
      fs.mkdirSync(outputsDir, { recursive: true });
    }
    if (!fs.existsSync(projectDir)) {
      fs.mkdirSync(projectDir, { recursive: true });
    }
    
    const projectStateFile = path.join(projectDir, 'project_state.json');
    
    const projectState = {
      topic,
      folderName: safeFolderName,
      originalFolderName: folderName,
      totalSections,
      currentSection,
      voice,
      imageModel,
      scriptStyle,
      customStyleInstructions,
      promptModifier: promptModifier || '',
      imageCount: imageCount || 3,
      minWords: minWords || 800,
      maxWords: maxWords || 1100,
      skipImages: skipImages || false,
      googleImages: googleImages || false,
      applioVoice: applioVoice || 'logs\\VOCES\\RemyOriginal.pth',
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      completedSections: []
    };
    
    // Si ya existe un archivo de estado, preservar secciones completadas
    if (fs.existsSync(projectStateFile)) {
      const existingState = JSON.parse(fs.readFileSync(projectStateFile, 'utf8'));
      projectState.completedSections = existingState.completedSections || [];
      projectState.createdAt = existingState.createdAt || projectState.createdAt;
    }
    
    fs.writeFileSync(projectStateFile, JSON.stringify(projectState, null, 2), 'utf8');
    console.log(`💾 Estado del proyecto guardado: ${projectStateFile}`);
    
    return projectState;
  } catch (error) {
    console.error('❌ Error guardando estado del proyecto:', error);
    return null;
  }
}

// Función para generar metadatos de YouTube automáticamente para un proyecto completo
async function generateYouTubeMetadataForProject(projectState) {
  try {
    console.log(`🎬 Iniciando generación automática de metadatos para: ${projectState.topic}`);
    
    const safeFolderName = projectState.folderName;
    const projectDir = path.join(globalOutputDir, safeFolderName);
    const projectStateFile = path.join(projectDir, 'project_state.json');
    
    // Recopilar todos los scripts de las secciones completadas
    const allSections = [];
    for (const section of projectState.completedSections.sort((a, b) => a.section - b.section)) {
      if (section.script) {
        allSections.push(section.script);
      }
    }
    
    if (allSections.length === 0) {
      console.log(`⚠️ No hay secciones con script para generar metadatos`);
      return;
    }
    
    console.log(`📝 Generando metadatos con ${allSections.length} secciones`);
    
    // Combinar todas las secciones
    const fullScript = allSections.join('\n\n--- SECCIÓN ---\n\n');
    
    // Obtener instrucciones de estilo de miniatura (usar default si no está especificado)
    const thumbnailStyle = projectState.thumbnailStyle || 'default';
    const thumbnailInstructions = getThumbnailStyleInstructions(thumbnailStyle);
    
    console.log(`🎨 Usando estilo de miniatura: ${thumbnailStyle}`);
    
    // Generar prompt para metadatos
    const prompt = `
Basándote en el siguiente tema y guión completo del video, genera metadata optimizada para YouTube:

**TEMA:** ${projectState.topic}

**GUIÓN COMPLETO:**
${fullScript}

Por favor genera:

1. **10 TÍTULOS CLICKBAIT** (cada uno en una línea, numerados):
   - Usa palabras que generen curiosidad.
   - Si el contenido es una lista, incluye el número y sigue la estructura: "Las [Número] [Adjetivo] [Sujeto] en [Tema]".
   - Ejemplo: "Las 5 Armas Más Raras de Conseguir en Skyrim".
   - Máximo 15 palabras, mínimo 8.

2. **DESCRIPCIÓN PARA VIDEO** (optimizada para SEO):
   - Entre 150-300 palabras
   - Incluye palabras clave relevantes del tema
   - Menciona el contenido principal del video
   - Incluye call-to-action para suscribirse
   - Formato atractivo con emojis

3. **CAPÍTULOS / LÍNEA DE TIEMPO** (timestamps):
   - Genera una lista de tiempos estimados y títulos para los capítulos del video.
   - IMPORTANTE: Los títulos deben ser MUY CORTOS (máximo 6 palabras).
   - Usa el formato "00:00 Título".

4. **25 ETIQUETAS** (separadas por comas):
   - Palabras clave relacionadas al tema
   - Tags populares del nicho correspondiente
   - Términos de búsqueda relevantes

5. **5 PROMPTS PARA MINIATURAS DE YOUTUBE** (cada uno en una línea, numerados):
   
   FORMATO OBLIGATORIO - DEBES SEGUIR ESTA ESTRUCTURA EXACTA PARA CADA UNO DE LOS 5 PROMPTS:
   
   "Miniatura de YouTube 16:9 mostrando [descripción visual muy detallada del contenido relacionado al tema, mínimo 15 palabras] con texto superpuesto '[frase clickbait específica relacionada al contenido]' con el texto aplicando el siguiente estilo: ${thumbnailInstructions}"
   
   REGLAS ESTRICTAS - NO GENERAR PROMPTS CORTOS O INCOMPLETOS:
   - CADA prompt debe tener mínimo 25 palabras de descripción visual
   - CADA prompt debe incluir una frase clickbait específica entre comillas
   - CADA prompt debe terminar con la frase completa del estilo
   - NO generar prompts como "el texto con contorno negro" - ESO ESTÁ PROHIBIDO
   - TODOS los prompts deben seguir el formato completo

REGLAS ESTRICTAS:
- EXACTAMENTE 5 prompts numerados del 1 al 5
- Cada prompt debe incluir la frase completa del estilo al final
- NO hacer referencias a estilos anteriores
`;

    // Llamar a la IA para generar metadatos
  const { model } = await getGoogleAI('gemini-3.1-flash-lite-preview', { context: 'llm' });
    
    console.log(`🤖 Enviando request a Gemini para generar metadatos...`);
    const result = await model.generateContent([{ text: prompt }]);
    const generatedMetadata = result.response.text();
    
    console.log(`✅ Metadatos generados exitosamente`);
    
    // Guardar metadatos en archivo separado
    const metadataFile = path.join(projectDir, `${safeFolderName}_youtube_metadata.txt`);
    const metadataContent = `METADATA DE YOUTUBE PARA: ${projectState.topic}
Generado automáticamente: ${new Date().toLocaleString()}
Proyecto: ${projectState.originalFolderName || projectState.topic}
Secciones: ${projectState.completedSections.length}/${projectState.totalSections}

====================================

${generatedMetadata}

====================================
GUIÓN COMPLETO UTILIZADO:
====================================

${fullScript}`;
    
    fs.writeFileSync(metadataFile, metadataContent, 'utf8');
    console.log(`💾 Metadatos guardados en: ${metadataFile}`);
    
    // Actualizar estado del proyecto con los metadatos
    const updatedProjectState = JSON.parse(fs.readFileSync(projectStateFile, 'utf8'));
    updatedProjectState.youtubeMetadata = {
      generatedAt: new Date().toISOString(),
      content: generatedMetadata,
      thumbnailStyle: thumbnailStyle,
      filename: `${safeFolderName}_youtube_metadata.txt`
    };
    updatedProjectState.lastModified = new Date().toISOString();
    
    fs.writeFileSync(projectStateFile, JSON.stringify(updatedProjectState, null, 2), 'utf8');
    
    console.log(`🎬 ¡Metadatos de YouTube generados automáticamente para el proyecto completado!`);
    
    return updatedProjectState;
    
  } catch (error) {
    console.error(`❌ Error generando metadatos automáticos:`, error);
    throw error;
  }
}

// Función para actualizar sección completada
function updateCompletedSection(projectData, sectionNumber, sectionData) {
  try {
    const { topic, folderName } = projectData;
    
    const safeFolderName = folderName && folderName.trim() 
      ? createSafeFolderName(folderName.trim())
      : createSafeFolderName(topic);
    
    const projectStateFile = path.join(globalOutputDir, safeFolderName, 'project_state.json');
    
    if (fs.existsSync(projectStateFile)) {
      const projectState = JSON.parse(fs.readFileSync(projectStateFile, 'utf8'));
      
      // Actualizar o agregar sección completada
      const existingSectionIndex = projectState.completedSections.findIndex(s => s.section === sectionNumber);
      
      const sectionInfo = {
        section: sectionNumber,
        script: sectionData.script,
        imageCount: sectionData.images ? sectionData.images.length : 0,
        hasImages: !sectionData.imagesSkipped && !sectionData.googleImagesMode,
        googleImagesMode: sectionData.googleImagesMode || false,
        imagesSkipped: sectionData.imagesSkipped || false,
        imagePrompts: sectionData.imagePrompts || [],
        completedAt: new Date().toISOString(),
        scriptFile: sectionData.scriptFile,
        promptsFile: sectionData.promptsFile
      };
      
      if (existingSectionIndex >= 0) {
        projectState.completedSections[existingSectionIndex] = sectionInfo;
      } else {
        projectState.completedSections.push(sectionInfo);
      }
      
      // Ordenar secciones por número
      projectState.completedSections.sort((a, b) => a.section - b.section);
      
      projectState.lastModified = new Date().toISOString();
      projectState.currentSection = Math.max(projectState.currentSection, sectionNumber);
      
      fs.writeFileSync(projectStateFile, JSON.stringify(projectState, null, 2), 'utf8');
      console.log(`✅ Sección ${sectionNumber} marcada como completada en el proyecto`);
      
      // 🎬 VERIFICAR SI EL PROYECTO ESTÁ COMPLETO Y GENERAR METADATOS DE YOUTUBE
      const isProjectComplete = projectState.completedSections.length >= projectState.totalSections;
      console.log(`📊 Progreso del proyecto: ${projectState.completedSections.length}/${projectState.totalSections} - Completo: ${isProjectComplete}`);
      
      if (isProjectComplete && !projectState.youtubeMetadata) {
        console.log(`🎬 ¡Proyecto completo! Generando metadatos de YouTube automáticamente...`);
        
        // Generar metadatos automáticamente en background
        setTimeout(() => {
          generateYouTubeMetadataForProject(projectState).catch(error => {
            console.error('❌ Error generando metadatos automáticos:', error);
          });
        }, 1000); // Pequeño delay para que la respuesta HTTP se complete primero
      }
      
      return projectState;
    }
    
    return null;
  } catch (error) {
    console.error('❌ Error actualizando sección completada:', error);
    return null;
  }
}

// Función para reconstruir el estado de un proyecto desde las carpetas existentes
function reconstructProjectState(folderName) {
  try {
    console.log(`🔧 Reconstruyendo estado del proyecto: ${folderName}`);
    
    const projectDir = path.join(globalOutputDir, folderName);
    
    if (!fs.existsSync(projectDir)) {
      console.error(`❌ Directorio del proyecto no existe: ${projectDir}`);
      return null;
    }
    
    // Buscar carpetas de secciones
    const sectionDirs = fs.readdirSync(projectDir)
      .filter(item => {
        const itemPath = path.join(projectDir, item);
        return fs.statSync(itemPath).isDirectory() && item.startsWith('seccion_');
      })
      .sort((a, b) => {
        const numA = parseInt(a.replace('seccion_', ''));
        const numB = parseInt(b.replace('seccion_', ''));
        return numA - numB;
      });
    
    console.log(`📁 Carpetas de secciones encontradas: ${sectionDirs.join(', ')}`);
    
    if (sectionDirs.length === 0) {
      console.error(`❌ No se encontraron carpetas de secciones en ${projectDir}`);
      return null;
    }
    
    const completedSections = [];
    let totalSections = 0;
    let projectTopic = folderName; // Usar el nombre de la carpeta como fallback
    
    // Analizar cada sección
    for (const sectionDir of sectionDirs) {
      const sectionNumber = parseInt(sectionDir.replace('seccion_', ''));
      totalSections = Math.max(totalSections, sectionNumber);
      
      const sectionPath = path.join(projectDir, sectionDir);
      const files = fs.readdirSync(sectionPath);
      
      console.log(`🔍 Analizando sección ${sectionNumber}: ${files.length} archivos`);
      
      // Buscar archivos de texto (script)
      const scriptFiles = files.filter(file => 
        file.endsWith('.txt') && !file.includes('metadata') && !file.includes('keywords')
      );
      
      // Buscar archivos de audio
      const audioFiles = files.filter(file => 
        file.endsWith('.wav') || file.endsWith('.mp3') || 
        file.endsWith('.m4a') || file.endsWith('.ogg')
      );
      
      // Buscar archivos de imágenes
      const imageFiles = files.filter(file => 
        file.endsWith('.png') || file.endsWith('.jpg') || 
        file.endsWith('.jpeg') || file.endsWith('.webp')
      );
      
      // Buscar archivo de keywords
      const keywordFiles = files.filter(file => 
        file.includes('keywords') && file.endsWith('.txt')
      );
      
      let sectionScript = '';
      let sectionTitle = `Sección ${sectionNumber}`;
      
      // Leer el script si existe
      if (scriptFiles.length > 0) {
        try {
          const scriptFilePath = path.join(sectionPath, scriptFiles[0]);
          const fullScriptContent = fs.readFileSync(scriptFilePath, 'utf8');
          
          // Limpiar el contenido del script usando la función centralizada
          sectionScript = cleanScriptContent(fullScriptContent);
          
          // Verificar si el script está vacío después de la limpieza
          const isEmpty = sectionScript.trim().length === 0;
          
          // Si el script está vacío, marcarlo para regeneración posterior
          if (isEmpty) {
            console.warn(`⚠️ Sección ${sectionNumber} tiene contenido vacío después de limpieza - necesita regeneración`);
            sectionScript = ''; // Marcar como vacío para regenerar después
          }
          
          // Para el título, usar el contenido del archivo completo para extraer metadatos
          const firstLine = fullScriptContent.split('\n')[0];
          if (firstLine && firstLine.length > 0 && firstLine.length < 200) {
            sectionTitle = firstLine.trim();
          } else {
            // Usar las primeras 50 caracteres del script limpio como título (si no está vacío)
            if (sectionScript.length > 0) {
              sectionTitle = sectionScript.substring(0, 50).trim() + '...';
            } else {
              sectionTitle = `Sección ${sectionNumber} (sin contenido)`;
            }
          }
          
          console.log(`📝 Script encontrado para sección ${sectionNumber}: ${sectionScript.length} caracteres (limpio), ${fullScriptContent.length} caracteres (completo)${isEmpty ? ' - VACÍO' : ''}`);
        } catch (readError) {
          console.warn(`⚠️ Error leyendo script de sección ${sectionNumber}:`, readError.message);
        }
      }
      
      // Si es la primera sección, intentar inferir el tema del proyecto
      if (sectionNumber === 1 && sectionScript) {
        // Usar las primeras palabras del script como tema del proyecto
        const words = sectionScript.split(' ').slice(0, 10).join(' ');
        if (words.length > 10) {
          projectTopic = words.trim();
        }
      }
      
      const sectionData = {
        section: sectionNumber,
        title: sectionTitle,
        script: sectionScript,
        hasScript: scriptFiles.length > 0,
        hasAudio: audioFiles.length > 0,
        hasImages: imageFiles.length > 0,
        hasKeywords: keywordFiles.length > 0,
        scriptFile: scriptFiles[0] || null,
        audioFiles: audioFiles,
        imageFiles: imageFiles.map(file => `outputs/${folderName}/${sectionDir}/${file}`),
        keywordFile: keywordFiles[0] || null,
        fileCount: files.length
      };
      
      completedSections.push(sectionData);
      console.log(`✅ Sección ${sectionNumber} reconstruida: script=${sectionData.hasScript}, audio=${sectionData.hasAudio}, imágenes=${sectionData.hasImages}`);
    }
    
    // Construir el estado del proyecto
    const reconstructedState = {
      topic: projectTopic,
      originalFolderName: folderName,
      folderName: folderName,
      totalSections: totalSections,
      completedSections: completedSections,
      sectionsCompleted: completedSections.length,
      lastModified: new Date().toISOString(),
      reconstructed: true,
      reconstructedAt: new Date().toISOString(),
      voice: 'shimmer', // Valor por defecto
      imageModel: 'gemini3', // Valor por defecto
      llmModel: GEMINI_TEXT_MODEL, // Valor por defecto (Flash más rápido)
      scriptStyle: 'professional', // Valor por defecto
      imageCount: 5, // Valor por defecto
      minWords: 800,
      maxWords: 1100,
      skipImages: false,
      googleImages: false,
      localAIImages: false
    };
    
    console.log(`🔧 Estado del proyecto reconstruido:`, {
      topic: reconstructedState.topic,
      totalSections: reconstructedState.totalSections,
      sectionsCompleted: reconstructedState.sectionsCompleted,
      carpetasAnalizadas: sectionDirs.length
    });
    
    return reconstructedState;
    
  } catch (error) {
    console.error(`❌ Error reconstruyendo estado del proyecto ${folderName}:`, error);
    return null;
  }
}

// Función para analizar archivos de un proyecto (imágenes por sección y total de audios)
function analyzeProjectFiles(folderName) {
  try {
    const projectDir = path.join(globalOutputDir, folderName);
    const sections = [];
    let totalAudios = 0;

    // Obtener todas las carpetas de secciones
    const items = fs.readdirSync(projectDir);
    const sectionDirs = items.filter(item => {
      const itemPath = path.join(projectDir, item);
      return fs.statSync(itemPath).isDirectory() && item.startsWith('seccion_');
    }).sort();

    // Para cada sección, contar imágenes y verificar prompts
    for (const sectionDir of sectionDirs) {
      const sectionPath = path.join(projectDir, sectionDir);
      const sectionFiles = fs.readdirSync(sectionPath);
      const imageCount = sectionFiles.filter(file => file.endsWith('.png')).length;
      
      // Buscar archivo de prompts
      const promptsFile = sectionFiles.find(file => file.includes('prompts_imagenes.txt'));
      let promptsCount = 0;
      let status = 'red'; // default: red
      
      if (promptsFile) {
        try {
          const promptsPath = path.join(sectionPath, promptsFile);
          const promptsContent = fs.readFileSync(promptsPath, 'utf8');
          // Contar líneas que empiezan con "=== PROMPT" como prompts
          promptsCount = promptsContent.split('\n').filter(line => line.trim().startsWith('=== PROMPT')).length;
          
          if (promptsCount === imageCount) {
            status = 'green';
          } else if (imageCount === 0) {
            status = 'red';
          } else if (imageCount > 0 && imageCount < promptsCount) {
            status = 'yellow';
          }
        } catch (error) {
          console.warn(`⚠️ Error leyendo archivo de prompts para ${sectionDir}:`, error);
          status = 'red';
        }
      } else {
        // No hay archivo de prompts, todo rojo
        status = 'red';
      }
      
      sections.push({
        section: sectionDir,
        images: imageCount,
        prompts: promptsCount,
        status: status
      });
    }

    // Contar total de audios en todo el proyecto
    const allFiles = [];
    function getAllFiles(dirPath) {
      const files = fs.readdirSync(dirPath);
      for (const file of files) {
        const filePath = path.join(dirPath, file);
        if (fs.statSync(filePath).isDirectory()) {
          getAllFiles(filePath);
        } else {
          allFiles.push(file);
        }
      }
    }
    getAllFiles(projectDir);
    totalAudios = allFiles.filter(file => file.endsWith('.wav')).length;

    // Calcular estado de audios
    let audioStatus = 'red';
    const totalSections = sections.length;
    if (totalAudios === totalSections) {
      audioStatus = 'green';
    } else if (totalAudios > 0) {
      audioStatus = 'yellow';
    }
    // Si totalAudios === 0, permanece 'red'

    return {
      imagesPerSection: sections,
      totalAudios: totalAudios,
      audioStatus: audioStatus
    };
  } catch (error) {
    console.error(`❌ Error analizando archivos del proyecto ${folderName}:`, error);
    return {
      imagesPerSection: [],
      totalAudios: 0
    };
  }
}

// Función para obtener lista de proyectos disponibles
function getAvailableProjects() {
  try {
    const outputsDir = globalOutputDir;
    
    if (!fs.existsSync(outputsDir)) {
      return [];
    }
    
    const projects = [];
    const folders = fs.readdirSync(outputsDir);
    
    for (const folder of folders) {
      const projectDir = path.join(outputsDir, folder);
      const projectStateFile = path.join(projectDir, 'project_state.json');
      
      if (fs.existsSync(projectStateFile) && fs.statSync(projectDir).isDirectory()) {
        try {
          const fileContent = fs.readFileSync(projectStateFile, 'utf8');
          
          // Verificar si el archivo está vacío o incompleto
          if (!fileContent.trim()) {
            console.warn(`⚠️ Archivo JSON vacío para proyecto ${folder}, intentando reconstruir...`);
            
            // Intentar reconstruir el estado del proyecto
            const reconstructedState = reconstructProjectState(folder);
            
            if (reconstructedState) {
              // Guardar el estado reconstruido
              fs.writeFileSync(projectStateFile, JSON.stringify(reconstructedState, null, 2), 'utf8');
              console.log(`✅ Estado del proyecto ${folder} reconstruido y guardado`);
              
              const fileAnalysis = analyzeProjectFiles(folder);
              projects.push({
                ...reconstructedState,
                folderName: folder, // Nombre real de la carpeta (con guiones bajos)
                folderPath: folder, // Alias para compatibilidad
                sectionsCompleted: reconstructedState.completedSections?.length || 0,
                lastModifiedDate: new Date(reconstructedState.lastModified || Date.now()).toLocaleString(),
                ...fileAnalysis
              });
              continue;
            } else {
              console.error(`❌ No se pudo reconstruir el proyecto ${folder}`);
              continue;
            }
          }
          
          // Verificar si el JSON parece estar incompleto
          if (!fileContent.trim().endsWith('}') && !fileContent.trim().endsWith(']')) {
            console.warn(`⚠️ Archivo JSON parece incompleto para proyecto ${folder}: termina con '${fileContent.slice(-10)}'`);
            console.warn(`📋 Intentando reparar archivo JSON para proyecto ${folder}...`);
            
            // Intentar agregar llaves faltantes si es necesario
            let repairedContent = fileContent.trim();
            
            // Contar llaves abiertas vs cerradas
            const openBraces = (repairedContent.match(/\{/g) || []).length;
            const closeBraces = (repairedContent.match(/\}/g) || []).length;
            
            if (openBraces > closeBraces) {
              // Agregar llaves faltantes
              for (let i = 0; i < openBraces - closeBraces; i++) {
                repairedContent += '}';
              }
              console.log(`🔧 Agregadas ${openBraces - closeBraces} llaves faltantes para proyecto ${folder}`);
            }
            
            try {
              const projectState = JSON.parse(repairedContent);
              
              // Si la reparación fue exitosa, guardar el archivo corregido
              fs.writeFileSync(projectStateFile, JSON.stringify(projectState, null, 2), 'utf8');
              console.log(`✅ Archivo JSON reparado y guardado para proyecto ${folder}`);
              
              const fileAnalysis = analyzeProjectFiles(folder);
              projects.push({
                ...projectState,
                folderName: folder, // Nombre real de la carpeta (con guiones bajos)
                folderPath: folder, // Alias para compatibilidad
                sectionsCompleted: projectState.completedSections?.length || 0,
                lastModifiedDate: new Date(projectState.lastModified || Date.now()).toLocaleString(),
                ...fileAnalysis
              });
              continue;
            } catch (repairError) {
              console.error(`❌ No se pudo reparar JSON para proyecto ${folder}:`, repairError.message);
              console.log(`📄 Contenido problemático (primeros 200 chars): ${fileContent.substring(0, 200)}...`);
              continue;
            }
          }
          
          const projectState = JSON.parse(fileContent);
          const fileAnalysis = analyzeProjectFiles(folder);
          projects.push({
            ...projectState,
            folderName: folder, // Nombre real de la carpeta (con guiones bajos)
            folderPath: folder, // Alias para compatibilidad
            sectionsCompleted: projectState.completedSections?.length || 0,
            lastModifiedDate: new Date(projectState.lastModified || Date.now()).toLocaleString(),
            ...fileAnalysis
          });
        } catch (parseError) {
          console.warn(`⚠️ Error leyendo proyecto ${folder}:`, parseError);
          
          // Intentar crear un backup del archivo corrupto
          try {
            const backupPath = projectStateFile + '.corrupted.' + Date.now();
            fs.copyFileSync(projectStateFile, backupPath);
            console.log(`🗃️ Backup del archivo corrupto creado: ${backupPath}`);
          } catch (backupError) {
            console.warn(`⚠️ No se pudo crear backup para ${folder}:`, backupError.message);
          }
        }
      }
    }
    
    console.log(`📊 Total proyectos válidos: ${projects.length}`);
    
    // Ordenar por última modificación (más recientes primero)
    projects.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
    
    return projects;
  } catch (error) {
    console.error('❌ Error obteniendo proyectos disponibles:', error);
    return [];
  }
}

// Función para cargar estado completo de un proyecto
function loadProjectState(folderName) {
  try {
    // Convertir el nombre del proyecto a formato seguro (espacios a guiones bajos)
    const safeFolderName = createSafeFolderName(folderName);
    let projectStateFile = path.join(globalOutputDir, safeFolderName, 'project_state.json');
    console.log(`🔍 Buscando archivo de estado: ${projectStateFile}`);
    
    // Si no existe con el nombre convertido, probar con el nombre original
    if (!fs.existsSync(projectStateFile)) {
      console.log(`❌ Archivo no encontrado con nombre convertido "${safeFolderName}"`);
      console.log(`🔍 Intentando con nombre original: "${folderName}"`);
      
      projectStateFile = path.join(globalOutputDir, folderName, 'project_state.json');
      console.log(`🔍 Buscando archivo de estado: ${projectStateFile}`);
      
      if (!fs.existsSync(projectStateFile)) {
        console.log(`❌ Archivo project_state.json no existe para proyecto "${folderName}" (probado como "${safeFolderName}" y "${folderName}")`);
        return null;
      }
    }
    
    console.log(`✅ Archivo de estado encontrado, leyendo contenido...`);
    
    let projectState;
    try {
      const fileContent = fs.readFileSync(projectStateFile, 'utf8');
      
      // Verificar si el archivo está vacío o incompleto
      if (!fileContent.trim()) {
        console.warn(`⚠️ Archivo JSON vacío para proyecto "${folderName}", intentando reconstruir...`);
        
        // Intentar reconstruir el estado del proyecto
        const reconstructedState = reconstructProjectState(folderName);
        
        if (reconstructedState) {
          // Guardar el estado reconstruido
          fs.writeFileSync(projectStateFile, JSON.stringify(reconstructedState, null, 2), 'utf8');
          console.log(`✅ Estado del proyecto "${folderName}" reconstruido y guardado`);
          projectState = reconstructedState;
        } else {
          console.error(`❌ No se pudo reconstruir el proyecto "${folderName}"`);
          return null;
        }
      }
      
      // Intentar parsear directamente primero
      try {
        projectState = JSON.parse(fileContent);
      } catch (initialParseError) {
        console.warn(`⚠️ Error inicial parseando JSON, intentando reparar...`);
        
        // Verificar si el JSON parece estar incompleto
        if (!fileContent.trim().endsWith('}') && !fileContent.trim().endsWith(']')) {
          console.warn(`⚠️ Archivo JSON parece incompleto para proyecto "${folderName}": termina con '${fileContent.slice(-10)}'`);
          
          // Intentar agregar llaves faltantes si es necesario
          let repairedContent = fileContent.trim();
          
          // Contar llaves abiertas vs cerradas
          const openBraces = (repairedContent.match(/\{/g) || []).length;
          const closeBraces = (repairedContent.match(/\}/g) || []).length;
          
          if (openBraces > closeBraces) {
            // Agregar llaves faltantes
            for (let i = 0; i < openBraces - closeBraces; i++) {
              repairedContent += '}';
            }
            console.log(`🔧 Agregadas ${openBraces - closeBraces} llaves faltantes para proyecto "${folderName}"`);
            
            try {
              projectState = JSON.parse(repairedContent);
              
              // Si la reparación fue exitosa, guardar el archivo corregido
              fs.writeFileSync(projectStateFile, JSON.stringify(projectState, null, 2), 'utf8');
              console.log(`✅ Archivo JSON reparado y guardado para proyecto "${folderName}"`);
            } catch (repairError) {
              console.error(`❌ No se pudo reparar JSON para proyecto "${folderName}":`, repairError.message);
              
              // Crear backup del archivo corrupto
              try {
                const backupPath = projectStateFile + '.corrupted.' + Date.now();
                fs.copyFileSync(projectStateFile, backupPath);
                console.log(`🗃️ Backup del archivo corrupto creado: ${backupPath}`);
              } catch (backupError) {
                console.warn(`⚠️ No se pudo crear backup: ${backupError.message}`);
              }
              
              return null;
            }
          } else {
            // No se pudo determinar cómo reparar
            console.error(`❌ No se pudo reparar JSON para proyecto "${folderName}"`);
            console.log(`📄 Contenido problemático (primeros 200 chars): ${fileContent.substring(0, 200)}...`);
            return null;
          }
        } else {
          // El archivo parece completo pero aún no se puede parsear
          throw initialParseError;
        }
      }
      
      console.log(`📊 Estado del proyecto "${folderName}" cargado:`, {
        topic: projectState.topic,
        totalSections: projectState.totalSections,
        completedSections: projectState.completedSections?.length || 0
      });
    } catch (parseError) {
      console.error(`❌ Error parseando JSON del proyecto "${folderName}":`, parseError.message);
      console.log(`📄 Contenido del archivo (primeros 500 chars):`);
      console.log(fs.readFileSync(projectStateFile, 'utf8').substring(0, 500) + '...');
      return null;
    }
    
    // Cargar datos adicionales de cada sección completada
    // Usar 'sections' si existe, o 'completedSections' si es un array
    let sectionsToProcess = [];
    
    if (projectState.sections && Array.isArray(projectState.sections)) {
      console.log(`📚 Proyecto "${folderName}" tiene ${projectState.sections.length} secciones en formato nuevo`);
      sectionsToProcess = projectState.sections;
      // Asegurar que completedSections apunte a las secciones reales
      projectState.completedSections = projectState.sections;
    } else if (projectState.completedSections && Array.isArray(projectState.completedSections)) {
      console.log(`📚 Proyecto "${folderName}" tiene ${projectState.completedSections.length} secciones en formato legacy`);
      sectionsToProcess = projectState.completedSections;
    } else {
      console.log(`⚠️ Proyecto "${folderName}" no tiene secciones completadas o completedSections no es un array`);
      // Asegurar que completedSections sea un array vacío si no existe o no es válido
      projectState.completedSections = [];
      sectionsToProcess = [];
    }
    
    // Procesar cada sección para agregar información de archivos
    for (const section of sectionsToProcess) {
      const sectionDir = path.join(globalOutputDir, folderName, `seccion_${section.section}`);
      
      // 📝 CARGAR SCRIPT DESDE ARCHIVO
      const scriptFileName = `${folderName}_seccion_${section.section}_guion.txt`;
      const scriptFilePath = path.join(sectionDir, scriptFileName);
      
      if (fs.existsSync(scriptFilePath)) {
        try {
          const rawScriptContent = fs.readFileSync(scriptFilePath, 'utf8');
          
          // Limpiar el script usando la función centralizada
          const scriptContent = cleanScriptContent(rawScriptContent);
          
          section.script = scriptContent.trim();
          //console.log(`📝 Script cargado y limpiado para sección ${section.section}: ${scriptContent.length} caracteres`);
        } catch (error) {
          console.error(`❌ Error leyendo script de sección ${section.section}:`, error);
        }
      } else {
        //console.log(`📝 Archivo de script no encontrado para sección ${section.section}: ${scriptFilePath}`);
        // Verificar si el script está guardado en el project_state.json (formato legacy)
        if (section.script) {
          //console.log(`📝 Script encontrado en project_state.json para sección ${section.section}`);
        }
      }
      
      // 🎨 CARGAR PROMPTS DE IMAGEN DESDE ARCHIVO
      const promptsFileName = `${folderName}_seccion_${section.section}_prompts_imagenes.txt`;
      const promptsFilePath = path.join(sectionDir, promptsFileName);
      
      if (fs.existsSync(promptsFilePath)) {
        try {
          const promptsContent = fs.readFileSync(promptsFilePath, 'utf8');
          
          // Parsear el archivo de prompts que tiene formato específico
          const lines = promptsContent.split('\n');
          const prompts = [];
          let isInPromptsSection = false;
          
          lines.forEach(line => {
            const trimmedLine = line.trim();
            
            // Comenzar a leer prompts después de "PROMPTS GENERADOS:"
            if (trimmedLine === 'PROMPTS GENERADOS:') {
              isInPromptsSection = true;
              return;
            }
            
            // Si estamos en la sección de prompts y la línea no está vacía
            if (isInPromptsSection && trimmedLine.length > 0) {
              // Filtrar líneas que no son prompts (líneas separadoras, etc.)
              if (!trimmedLine.startsWith('=') && !trimmedLine.startsWith('Prompts generados automáticamente')) {
                // Remover numeración (ej: "1. ") del inicio del prompt
                const prompt = trimmedLine.replace(/^\d+\.\s*/, '').trim();
                if (prompt.length > 0) {
                  prompts.push(prompt);
                }
              }
            }
          });
          
          if (prompts.length > 0) {
            section.imagePrompts = prompts;
            //console.log(`🎨 Prompts cargados para sección ${section.section}: ${prompts.length} prompts`);
          } else {
            //console.log(`⚠️ Archivo de prompts encontrado pero no se pudieron extraer prompts válidos para sección ${section.section}`);
          }
        } catch (error) {
          console.error(`❌ Error leyendo prompts de sección ${section.section}:`, error);
        }
      } else {
        //console.log(`🎨 Archivo de prompts no encontrado para sección ${section.section}: ${promptsFilePath}`);
        // Verificar si los prompts están en el project_state.json (formato legacy)
        if (section.imagePrompts && section.imagePrompts.length > 0) {
          //console.log(`🎨 Prompts encontrados en project_state.json para sección ${section.section}: ${section.imagePrompts.length} prompts`);
        }
      }
      
      // Verificar si existen archivos de audio
      if (fs.existsSync(sectionDir)) {
        const audioFiles = fs.readdirSync(sectionDir).filter(file => 
          file.endsWith('.wav') || file.endsWith('.mp3')
        );
        if (audioFiles.length > 0) {
          section.hasAudio = true;
          section.audioFiles = audioFiles.map(file => `outputs/${folderName}/seccion_${section.section}/${file}`);
          //console.log(`🎵 Sección ${section.section}: ${audioFiles.length} archivo(s) de audio encontrado(s)`);
        }
        
        // Verificar si existen las imágenes
        const imageFiles = fs.readdirSync(sectionDir).filter(file => 
          file.endsWith('.png') || file.endsWith('.jpg') || file.endsWith('.jpeg')
        );
        if (imageFiles.length > 0) {
          section.hasImages = true;
          section.imageFiles = imageFiles.map(file => `outputs/${folderName}/seccion_${section.section}/${file}`);
          //console.log(`🖼️ Sección ${section.section}: ${imageFiles.length} archivo(s) de imagen encontrado(s)`);
        }
        
        // Verificar archivos de texto (guiones y prompts)
        const textFiles = fs.readdirSync(sectionDir).filter(file => 
          file.endsWith('.txt')
        );
        if (textFiles.length > 0) {
          section.textFiles = textFiles.map(file => `outputs/${folderName}/seccion_${section.section}/${file}`);
          //console.log(`📝 Sección ${section.section}: ${textFiles.length} archivo(s) de texto encontrado(s)`);
        }
      } else {
        //console.log(`📁 Directorio de sección ${section.section} no encontrado: ${sectionDir}`);
      }
    }
    
    // 🎬 CARGAR METADATOS DE YOUTUBE SI EXISTEN
    // Intentar ambos formatos de nombre de archivo para compatibilidad
    const metadataFile1 = path.join(globalOutputDir, folderName, `${folderName}_metadata_youtube.txt`);
    const metadataFile2 = path.join(globalOutputDir, folderName, `${folderName}_youtube_metadata.txt`);
    
    let metadataFile = null;
    if (fs.existsSync(metadataFile1)) {
      metadataFile = metadataFile1;
      console.log(`📽️ Metadatos de YouTube encontrados (formato 1): ${metadataFile1}`);
    } else if (fs.existsSync(metadataFile2)) {
      metadataFile = metadataFile2;
      console.log(`📽️ Metadatos de YouTube encontrados (formato 2): ${metadataFile2}`);
    } else {
      console.log(`📽️ No se encontraron metadatos de YouTube para ${folderName}`);
    }
    
    if (metadataFile) {
      try {
        const metadataContent = fs.readFileSync(metadataFile, 'utf8');
        const metadataFileName = path.basename(metadataFile);
        console.log(`📽️ Metadatos de YouTube encontrados para ${folderName}`);
        
        // Si no hay metadatos en el estado pero sí en archivo, agregarlos
        if (!projectState.youtubeMetadata) {
          projectState.youtubeMetadata = {
            generatedAt: fs.statSync(metadataFile).mtime.toISOString(),
            content: metadataContent,
            filename: metadataFileName,
            fileExists: true
          };
          
          console.log(`✅ Metadatos cargados desde archivo para proyecto ${folderName}`);
        } else {
          // Asegurar que el flag de archivo existe esté presente
          projectState.youtubeMetadata.fileExists = true;
          projectState.youtubeMetadata.filename = metadataFileName;
        }
      } catch (error) {
        console.error(`❌ Error cargando metadatos de YouTube:`, error);
      }
    }
    
    // 📁 Agregar el nombre de la carpeta al estado del proyecto
    projectState.folderName = folderName;
    
    return projectState;
  } catch (error) {
    console.error('❌ Error cargando estado del proyecto:', error);
    return null;
  }
}

// Función para crear nombre de carpeta seguro basado en el tema
function createSafeFolderName(topic) {
  if (!topic || typeof topic !== 'string') {
    console.warn('⚠️ createSafeFolderName recibió valor inválido:', topic);
    return 'proyecto_sin_nombre';
  }
  
  const safeName = topic
    .toLowerCase()
    .replace(/[^a-z0-9\s_]/g, '') // Remover caracteres especiales, mantener guiones bajos
    .replace(/\s+/g, '_') // Reemplazar espacios con guiones bajos
    .substring(0, 50); // Limitar longitud
    
  console.log(`📁 createSafeFolderName: "${topic}" → "${safeName}"`);
  return safeName;
}

// Función para limpiar el texto del guión de contenido no deseado
function cleanScriptText(text) {
  // Validar que text sea una string
  if (!text || typeof text !== 'string') {
    console.log(`⚠️ WARNING - cleanScriptText recibió:`, typeof text, text);
    return String(text || '').trim();
  }
  
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
  // Si hay customFolderName, usarlo directamente (ya viene normalizado del projectKey)
  // Sino, normalizar el topic
  const folderName = customFolderName && customFolderName.trim() 
    ? customFolderName.trim()  // Ya viene normalizado, no aplicar createSafeFolderName otra vez
    : createSafeFolderName(topic);
    
  const outputsDir = globalOutputDir;
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
    safeTopicName: folderName, // Este es el nombre real de la carpeta que se está usando
    folderName: folderName     // Agregar también como folderName para consistencia
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

// Función para generar audio del guión utilizando Google GenAI TTS con fallback inteligente
async function generateStoryAudio(script, voiceName = DEFAULT_TTS_VOICE, sectionDir, topic, section, customNarrationStyle = null) {
  try {
    if (!script || typeof script !== 'string') {
      throw new Error('Script no válido para generar audio');
    }

    let workingScript = script.trim();
    console.log(`🎵 Generando narración del guión con voz solicitada: ${voiceName || 'no especificada'}...`);
    console.log(`📝 Script a narrar (primeros 120 caracteres): ${workingScript.substring(0, 120)}...`);
    console.log(`📏 Longitud original del script: ${workingScript.length} caracteres`);

    if (workingScript.length > 3800) {
      console.log(`⚠️ Script muy largo (${workingScript.length} caracteres), truncando a 3800 para TTS...`);
      workingScript = workingScript.substring(0, 3800) + '...';
    }

    // Limpiar caracteres problemáticos y espacios excesivos
    workingScript = workingScript
      .replace(/[^\w\sáéíóúñüÁÉÍÓÚÑÜ.,;:!?¿¡()"'\-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (workingScript.length < 10) {
      throw new Error('Script demasiado corto después de la limpieza');
    }

    const narrationPrompt = customNarrationStyle && customNarrationStyle.trim()
      ? `Lee el siguiente guion con una entonación ${customNarrationStyle.trim()}. Mantén una voz natural y humana.\n\n${workingScript}`
      : workingScript;

    if (customNarrationStyle && customNarrationStyle.trim()) {
      console.log(`🎭 Estilo de narración personalizado solicitado: "${customNarrationStyle.trim()}"`);
    }

    const voiceCandidates = Array.from(new Set([
      (voiceName && typeof voiceName === 'string' && voiceName.trim()) ? voiceName.trim() : DEFAULT_TTS_VOICE,
      DEFAULT_TTS_VOICE
    ]));

    console.log(`🎙️ Voces a intentar para TTS: ${voiceCandidates.join(', ')}`);

    const ttsState = getTrackedUsageState('tts');
    const shouldUsePrimaryOnly = ttsState?.preferPrimary;
    const freeApiEntries = shouldUsePrimaryOnly ? [] : getFreeGoogleAPIKeys();
    const primaryApiEntry = process.env.GOOGLE_API_KEY
      ? { key: process.env.GOOGLE_API_KEY, name: GOOGLE_PRIMARY_API_NAME }
      : null;

    if (!freeApiEntries.length && !primaryApiEntry) {
      throw new Error('No hay API keys de Google configuradas para Text-to-Speech');
    }

    let lastError = null;

    const attemptWithEntry = async (entry, keyType) => {
      if (!entry?.key) {
        throw new Error('API key de Google TTS no configurada');
      }

      const isPrimary = keyType === 'primary';
      const emoji = isPrimary ? '💰' : '🆓';
      const apiName = entry.name || (isPrimary ? GOOGLE_PRIMARY_API_NAME : 'API gratuita');

      console.log(`${emoji} Solicitando audio TTS con ${apiName} (${voiceCandidates.join(', ')})...`);

      let client;
      try {
        client = getGoogleTTSClient(entry.key);
      } catch (clientError) {
        throw clientError;
      }

      let lastVoiceError = null;

      for (const candidateVoice of voiceCandidates) {
        try {
          console.log(`🔊 Generando audio con voz ${candidateVoice} usando ${apiName}...`);
          const response = await client.models.generateContent({
            model: GEMINI_TTS_MODEL_FLASH, // Keep TTS model as is for now unless there is a v3 TTS
            contents: [
              {
                role: 'user',
                parts: [{ text: narrationPrompt }]
              }
            ],
            config: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: candidateVoice
                  }
                }
              }
            }
          });

          const audioPart = response?.candidates?.[0]?.content?.parts?.find(part => part.inlineData?.data);
          if (!audioPart?.inlineData?.data) {
            console.log('❌ Respuesta TTS sin datos de audio. Detalle completo:', JSON.stringify(response, null, 2));
            throw new Error('La respuesta de Google TTS no incluye datos de audio');
          }

          const audioData = audioPart.inlineData.data;
          const mimeType = audioPart.inlineData.mimeType || '';

          if (audioData.length < 1000) {
            console.log(`⚠️ Datos de audio sospechosos (${audioData.length} caracteres).`);
            throw new Error('Datos de audio inválidos o incompletos');
          }

          const audioBuffer = Buffer.from(audioData, 'base64');
          const safeTopicName = createSafeFolderName(topic);
          const fileName = `${safeTopicName}_seccion_${section}_${Date.now()}.wav`;
          const filePath = path.join(sectionDir, fileName);

          if (mimeType.includes('pcm')) {
            const rateMatch = mimeType.match(/rate=(\d+)/i);
            const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;
            await saveWaveFile(filePath, audioBuffer, 1, sampleRate);
          } else {
            await writeFile(filePath, audioBuffer);
          }

          console.log(`✅ Audio generado exitosamente con voz ${candidateVoice} (${apiName}) en: ${filePath}`);

          if (isPrimary) {
            markPrimarySuccess('tts');
          }

          return path.relative('./public', filePath).replace(/\\/g, '/');
        } catch (voiceError) {
          console.error(`⚠️ Error generando audio con voz ${candidateVoice} usando ${apiName}: ${voiceError.message}`);
          lastVoiceError = voiceError;
        }
      }

      throw lastVoiceError || new Error(`No se pudo generar audio con ${apiName}`);
    };

    if (freeApiEntries.length) {
      for (const entry of freeApiEntries) {
        try {
          return await attemptWithEntry(entry, 'free');
        } catch (freeError) {
          lastError = freeError;
          markFreeApiFailure('tts', freeError);
          console.warn(`⚠️ API TTS gratuita ${entry.name} falló. Intentando con la siguiente... Motivo: ${freeError.message}`);
          // Continuar con la siguiente API gratuita
        }
      }
    }

    if (!primaryApiEntry) {
      throw lastError || new Error('Las APIs gratuitas fallaron y no hay API principal configurada para TTS');
    }

    try {
      return await attemptWithEntry(primaryApiEntry, 'primary');
    } catch (primaryError) {
      lastError = primaryError;
      try {
        markPrimaryFailure('tts', primaryError);
      } catch (criticalError) {
        throw criticalError;
      }
      throw primaryError;
    }
  } catch (error) {
    console.error('❌ Error generando audio:', error.message);
    console.error('❌ Detalle del error:', error);

    const safeTopicName = createSafeFolderName(topic);
    const textFileName = `${safeTopicName}_seccion_${section}_guion_audio_fallback.txt`;
    const textFilePath = path.join(sectionDir, textFileName);

    console.log('📝 Generando archivo de texto como fallback para la narración...');

    const textContent = `GUIÓN PARA AUDIO - SECCIÓN ${section}
===============================
Tema: ${topic}
Voz solicitada: ${voiceName}
Estilo solicitado: ${customNarrationStyle || 'No especificado'}
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
      console.error('❌ Error creando archivo de texto fallback:', writeError);
    }

    throw new Error(`Error al generar audio: ${error.message}. El servicio TTS puede estar temporalmente no disponible.`);
  }
}

// Función para generar imágenes con diferentes modelos
async function generateImageWithModel(ai, prompt, modelType, aspectRatio = '9:16') {
  const normalizedModel = normalizeImageModel(modelType);
  const modelLabel = getImageModelLabel(normalizedModel);
  const aspectInfo = describeAspectRatio(aspectRatio);
  const safeAspectRatio = aspectInfo.ratio;

  if (normalizedModel === 'gemini2' || normalizedModel === 'gemini25') {
    const modelId = normalizedModel === 'gemini25'
      ? 'gemini-2.5-flash-image'
      : 'gemini-2.0-flash-preview-image-generation';

    const supportsAspectRatio = geminiModelSupportsAspectRatio(modelId);
    if (!supportsAspectRatio && aspectInfo.ratio !== '9:16') {
      console.log(`ℹ️ ${modelLabel} (${modelId}) no admite aspect ratios personalizados. Se usará el formato predeterminado del modelo.`);
    } else {
      console.log(`🤖 Usando ${modelLabel} (${modelId}) con ${aspectInfo.label}...`);
    }

    const config = {
      responseModalities: ["IMAGE", "TEXT"],
      thinkingConfig: {
        thinkingBudget: 0, // Disables thinking
      }
    };

    if (supportsAspectRatio) {
      config.imageConfig = {
        aspectRatio: safeAspectRatio
      };
    }

    const contents = Array.isArray(prompt)
      ? prompt
      : [{ role: 'user', parts: [{ text: String(prompt) }] }];

    const stream = await ai.models.generateContentStream({
      model: modelId,
      contents,
      config
    });

    const { inlineImages } = await collectGeminiStreamData(stream);

    const images = inlineImages.map((inlineData) => ({
      image: {
        imageBytes: inlineData.data
      }
    }));

    return {
      generatedImages: images
    };
  }

  console.log(`🤖 Usando Imagen 4.0 tradicional (${getImageModelLabel('imagen40')}) con ${aspectInfo.label}...`);
  return await ai.models.generateImages({
    model: 'imagen-4.0-generate-preview-06-06',
    prompt: prompt,
    config: {
      numberOfImages: 1,
      aspectRatio: safeAspectRatio,
    },
  });
}

// =====================================
// FUNCIONES PARA IA LOCAL (COMFYUI + FLUX)
// =====================================

// Inicializar cliente ComfyUI
const comfyUIClient = new ComfyUIClient('http://127.0.0.1:8188');

// Función para generar imágenes usando IA Local (ComfyUI + Flux)
async function generateLocalAIImages(imagePrompts, additionalInstructions, sectionDir, sectionNumber, customSettings = null, keepAlive = false, aspectRatio = '9:16') {
  const generatedImages = [];
  const aspectInfo = describeAspectRatio(aspectRatio);
  const safeAspectRatio = aspectInfo.ratio;
  
  try {
    console.log(`🤖 Iniciando generación de ${imagePrompts.length} imágenes con ComfyUI + Flux (${aspectInfo.label})...`);
    
    // 1. Iniciar ComfyUI automáticamente
    console.log('🚀 Iniciando ComfyUI para la sección...');
    const comfyUIStarted = await startComfyUI();
    if (!comfyUIStarted) {
      throw new Error('No se pudo iniciar ComfyUI automáticamente');
    }
    
    // 2. Verificar conexión con ComfyUI (ya debería estar listo por startComfyUI)
    const connectionCheck = await comfyUIClient.checkConnection();
    if (!connectionCheck.success) {
      throw new Error(`No se puede conectar a ComfyUI: ${connectionCheck.error}`);
    }
    
    console.log('✅ ComfyUI iniciado y listo para generar imágenes');
    
    for (let index = 0; index < imagePrompts.length; index++) {
      const basePrompt = imagePrompts[index].trim();
      
      // Usar el prompt directamente ya que las instrucciones adicionales están integradas desde el LLM
      const finalPrompt = basePrompt;
      console.log(`✅ Las instrucciones adicionales ya están integradas en el prompt desde el LLM`);
      
      console.log(`🎨 Generando imagen ${index + 1}/${imagePrompts.length} con ComfyUI + Flux...`);
      console.log(`📝 Prompt final: ${finalPrompt.substring(0, 100)}...`);
      
      try {
        // Configurar opciones (usar configuración personalizada si está disponible)
    const resolvedDefaults = resolveComfyDefaultResolution(safeAspectRatio);
        const options = customSettings ? {
          width: parseInt(customSettings.width) || resolvedDefaults.width,
          height: parseInt(customSettings.height) || resolvedDefaults.height,
          steps: Number.parseInt(customSettings.steps, 10) || comfyDefaultConfig.steps,
          cfg: Number.isFinite(Number.parseFloat(customSettings.cfg)) ? Number.parseFloat(customSettings.cfg) : comfyDefaultConfig.cfg,
          guidance: Number.isFinite(Number.parseFloat(customSettings.guidance)) ? Number.parseFloat(customSettings.guidance) : comfyDefaultConfig.guidance,
          sampler: customSettings.sampler || "euler",
          scheduler: customSettings.scheduler || "simple",
          model: "flux1-dev-fp8.safetensors", // Modelo Flux optimizado
          negativePrompt: customSettings.negativePrompt || "low quality, blurry, distorted",
          timeout: Math.max(180, (Number.parseInt(customSettings.steps, 10) || comfyDefaultConfig.steps) * 6)
        } : {
          width: resolvedDefaults.width,
          height: resolvedDefaults.height,
          steps: comfyDefaultConfig.steps,
          cfg: comfyDefaultConfig.cfg,
          guidance: comfyDefaultConfig.guidance,
          sampler: "euler",
          scheduler: "simple",
          model: "flux1-dev-fp8.safetensors", // Modelo Flux optimizado
          negativePrompt: "low quality, blurry, distorted",
          timeout: Math.max(180, comfyDefaultConfig.steps * 6)
        };
        
        console.log(`⚙️ Usando configuración ComfyUI:`, {
          resolution: `${options.width}x${options.height}`,
          steps: options.steps,
          cfg: options.cfg,
          guidance: options.guidance,
          sampler: options.sampler,
          scheduler: options.scheduler
        });
        
        // Generar imagen con ComfyUI usando reinicio automático en caso de timeout
        const result = await generateImageWithAutoRestart(finalPrompt, options);
        
        if (result.success && result.localPath) {
          // Copiar imagen a la carpeta de la sección
          const imageFileName = `comfyui_seccion_${sectionNumber}_imagen_${index + 1}_${Date.now()}.png`;
          const imageFilePath = path.join(sectionDir, imageFileName);
          
          // Copiar archivo de la ubicación temporal a la carpeta de la sección
          fs.copyFileSync(result.localPath, imageFilePath);
          console.log(`💾 Imagen ComfyUI ${index + 1} guardada en: ${imageFilePath}`);
          
          // Eliminar la copia temporal de la carpeta outputs general
          try {
            if (fs.existsSync(result.localPath)) {
              fs.unlinkSync(result.localPath);
              console.log(`🗑️ Copia temporal eliminada de: ${result.localPath}`);
            }
          } catch (error) {
            console.log(`⚠️ No se pudo eliminar copia temporal: ${error.message}`);
          }
          
          // Retornar ruta relativa para acceso web
          const relativePath = path.relative('./public', imageFilePath).replace(/\\/g, '/');
          
          generatedImages.push({
            path: relativePath,
            prompt: finalPrompt,
            filename: imageFileName,
            source: 'IA Local (ComfyUI + Flux)',
            index: index + 1,
            promptId: result.promptId
          });
          
          console.log(`✅ Imagen ${index + 1} generada exitosamente con ComfyUI + Flux`);
        } else {
          throw new Error(`Error en generación de ComfyUI: ${result.error || 'Respuesta inválida'}`);
        }
        
        // Pequeña pausa entre generaciones para no sobrecargar el servidor
        if (index < imagePrompts.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
      } catch (imageError) {
        console.error(`❌ Error generando imagen ${index + 1} con ComfyUI:`, imageError.message);
        
        // Mensaje específico para conexión rechazada
        let errorMessage = imageError.message;
        if (imageError.message.includes('ECONNREFUSED') || imageError.message.includes('connect')) {
          errorMessage = 'Servidor ComfyUI no disponible en localhost:8188. Asegúrate de que ComfyUI esté ejecutándose.';
          console.error(`🔌 CONEXIÓN: ${errorMessage}`);
        }
        
        // Continuar con la siguiente imagen en caso de error
        generatedImages.push({
          path: null,
          prompt: finalPrompt,
          filename: null,
          source: 'IA Local (ComfyUI Error)',
          index: index + 1,
          error: errorMessage
        });
      }
    }
    
    console.log(`🎨 Generación de ComfyUI completada: ${generatedImages.filter(img => img.path).length}/${imagePrompts.length} exitosas`);
    
    // 3. Cerrar ComfyUI solo si no se debe mantener vivo
    if (!keepAlive) {
      console.log('🛑 Cerrando ComfyUI para liberar GPU...');
      await stopComfyUI();
      console.log('✅ ComfyUI cerrado, GPU liberada');
    } else {
      console.log('🔄 Manteniendo ComfyUI activo para próximas secciones...');
    }
    
    return generatedImages;
    
  } catch (error) {
    console.error(`❌ Error general en generación de ComfyUI:`, error.message);
    
    // Cerrar ComfyUI solo si no se debe mantener vivo, incluso si hay errores
    if (!keepAlive) {
      console.log('🛑 Cerrando ComfyUI debido a error...');
      await stopComfyUI();
      console.log('✅ ComfyUI cerrado después del error');
    } else {
      console.log('⚠️ Error en ComfyUI pero manteniéndolo activo para próximas secciones...');
    }
    
    throw error;
  }
}

// Función para generar archivo project_state.json
function generateProjectStateFile(projectData, requestData) {
  try {
    const { sections, imagePrompts, chapterStructure } = projectData;
    const { 
      topic, folderName, voice, imageModel, scriptStyle, customStyleInstructions, 
      promptModifier, imageCount, skipImages, googleImages, applioVoice, applioModel, applioPitch, applioSpeed 
    } = requestData;
    
    const projectState = {
      topic: folderName, // Usar el nombre de carpeta elegido por el usuario
      folderName: folderName,
      originalFolderName: folderName,
      generatedTopic: topic, // Guardar el topic generado por IA como campo separado
      totalSections: sections.length,
      currentSection: sections.length,
      voice: voice || 'Orus',
  imageModel: normalizeImageModel(imageModel),
      scriptStyle: scriptStyle || 'professional',
      customStyleInstructions: customStyleInstructions || null,
      promptModifier: promptModifier || '',
      imageCount: imageCount || 5,
      skipImages: skipImages || false,
  googleImages: googleImages || false,
  applioVoice: applioVoice || null,
  applioModel: applioModel || null,
  applioPitch: Number.isFinite(Number(applioPitch)) ? Number(applioPitch) : 0,
  applioSpeed: Number.isFinite(Number(applioSpeed)) ? Number(applioSpeed) : 0,
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      completedSections: sections.map((section, index) => ({
        section: section.section,
        script: section.script,
        imageCount: 0,
        hasImages: !skipImages,
        googleImagesMode: googleImages || false,
        imagesSkipped: skipImages || false,
        imagePrompts: imagePrompts[index]?.prompts || [],
        completedAt: new Date().toISOString(),
        scriptFile: {
          path: `outputs/${folderName}/seccion_${section.section}/${folderName}_seccion_${section.section}_guion.txt`,
          filename: `${folderName}_seccion_${section.section}_guion.txt`,
          saved: true
        },
        promptsFile: {
          path: `outputs/${folderName}/seccion_${section.section}/${folderName}_seccion_${section.section}_prompts_imagenes.txt`,
          filename: `${folderName}_seccion_${section.section}_prompts_imagenes.txt`,
          saved: true
        }
      }))
    };
    
    // Guardar el archivo en la carpeta del proyecto
    const baseTopic = topic.split(' ')[0] || 'Proyecto';
    const folderStructure = createProjectStructure(baseTopic, 1, folderName);
    const projectStateFilePath = path.join(folderStructure.projectDir, 'project_state.json');
    
    fs.writeFileSync(projectStateFilePath, JSON.stringify(projectState, null, 2), 'utf8');
    console.log(`📄 Archivo project_state.json guardado: ${projectStateFilePath}`);
    
    return projectStateFilePath;
    
  } catch (error) {
    console.error('❌ Error generando project_state.json:', error);
    return null;
  }
}

// =====================================
// FUNCIONES DE MEMORIA DE PROMPTS PARA CONSISTENCIA
// =====================================

// Función para obtener prompts anteriores de un proyecto para mantener consistencia
function getPreviousImagePrompts(projectKey, currentSection) {
  try {
    const projectStateFile = path.join(globalOutputDir, projectKey, 'project_state.json');
    
    if (!fs.existsSync(projectStateFile)) {
      console.log(`📝 No hay estado previo del proyecto para ${projectKey}`);
      return { previousPrompts: [], contextInfo: null };
    }
    
    const projectState = JSON.parse(fs.readFileSync(projectStateFile, 'utf8'));
    const completedSections = projectState.completedSections || [];
    
    // Verificar que completedSections sea un array
    if (!Array.isArray(completedSections)) {
      console.log(`⚠️ completedSections no es un array, iniciando como array vacío`);
      return { previousPrompts: [], contextInfo: null };
    }
    
    // Obtener los últimos 2 prompts de secciones anteriores
    const previousSections = completedSections
      .filter(section => section.section < currentSection)
      .sort((a, b) => b.section - a.section) // Ordenar por sección más reciente primero
      .slice(0, 2); // Tomar las 2 más recientes
    
    const previousPrompts = [];
    let contextInfo = null;
    
    if (previousSections.length > 0) {
      // Extraer prompts de secciones anteriores
      for (const section of previousSections) {
        const sectionPrompts = section.imagePrompts || [];
        if (sectionPrompts.length > 0) {
          // Tomar los primeros 2 prompts de cada sección para mantener consistencia
          const selectedPrompts = sectionPrompts.slice(0, 2);
          previousPrompts.push(...selectedPrompts.map(prompt => ({
            sectionNumber: section.section,
            prompt: prompt
          })));
        }
      }
      
      // Crear información de contexto para consistencia
      contextInfo = {
        lastSection: previousSections[0].section,
        totalPreviousPrompts: previousPrompts.length,
        projectTopic: projectState.topic,
        projectStyle: projectState.scriptStyle || 'professional'
      };
      
      console.log(`🧠 Recuperados ${previousPrompts.length} prompts de ${previousSections.length} secciones anteriores para consistencia`);
    } else {
      console.log(`📝 No hay secciones anteriores para la sección ${currentSection}`);
    }
    
    return { previousPrompts, contextInfo };
    
  } catch (error) {
    console.error('❌ Error obteniendo prompts anteriores:', error);
    return { previousPrompts: [], contextInfo: null };
  }
}

// Función para construir contexto de consistencia para el LLM
function buildConsistencyContext(previousPrompts, contextInfo) {
  if (!previousPrompts || previousPrompts.length === 0) {
    return '';
  }
  
  let consistencyContext = `\n\nPARA MANTENER CONSISTENCIA VISUAL:
Basándote en las imágenes generadas anteriormente en este proyecto, mantén consistencia en la descripción de personajes, lugares y estilo visual.

PROMPTS DE IMÁGENES ANTERIORES (úsalos como referencia para personajes y lugares):`;
  
  previousPrompts.forEach((item, index) => {
    consistencyContext += `\n${index + 1}. [Sección ${item.sectionNumber}]: ${item.prompt}`;
  });
  
  consistencyContext += `\n\nREQUISITOS DE CONSISTENCIA:
- Si aparecen los mismos personajes, mantén sus características físicas y vestimenta
- Si aparecen los mismos lugares, mantén su arquitectura y ambiente
- Mantén el mismo estilo artístico y paleta de colores
- Si introduces nuevos elementos, que sean coherentes con lo ya establecido`;
  
  return consistencyContext;
}

// Función para integrar instrucciones adicionales en el prompt del LLM
function integrateAdditionalInstructions(basePrompt, additionalInstructions) {
  if (!additionalInstructions || !additionalInstructions.trim()) {
    return basePrompt;
  }
  
  // Encontrar donde insertar las instrucciones adicionales en el prompt del LLM
  const additionalSection = `\n\nINSTRUCCIONES ADICIONALES DEL USUARIO:
${additionalInstructions.trim()}

IMPORTANTE: Integra estas instrucciones adicionales de manera natural en todos los prompts que generes. No las agregues literalmente al final, sino incorpóralas como parte orgánica de la descripción de cada imagen.`;

  // Insertar las instrucciones antes de los requisitos obligatorios
  const insertionPoint = basePrompt.indexOf('REQUISITOS OBLIGATORIOS para cada prompt:');
  if (insertionPoint !== -1) {
    return basePrompt.substring(0, insertionPoint) + additionalSection + '\n\n' + basePrompt.substring(insertionPoint);
  } else {
    // Si no encuentra el punto de inserción, agregar antes del formato de respuesta
    const formatPoint = basePrompt.indexOf('FORMATO DE RESPUESTA OBLIGATORIO:');
    if (formatPoint !== -1) {
      return basePrompt.substring(0, formatPoint) + additionalSection + '\n\n' + basePrompt.substring(formatPoint);
    } else {
      // Como fallback, agregar al final antes del último párrafo
      return basePrompt + additionalSection;
    }
  }
}

// =====================================
// FUNCIONES DE PROGRESO Y GUARDADO AUTOMÁTICO
// =====================================

// Función para calcular y actualizar el progreso del proyecto
function updateProjectProgress(projectKey, phase, completedItems, totalItems, itemType = 'elemento', estimatedTimePerItem = null) {
  try {
    // Obtener o crear datos de progreso existentes
    if (!projectProgressTracker[projectKey]) {
      projectProgressTracker[projectKey] = {
        projectKey: projectKey,
        currentPhase: phase,
        startTime: Date.now(),
        phases: {
          script: { total: 0, completed: 0, timePerItem: 0 },
          audio: { total: 0, completed: 0, timePerItem: 0 },
          images: { total: 0, completed: 0, timePerItem: 0 }
        },
        lastUpdate: Date.now()
      };
    }
    
    const progressData = projectProgressTracker[projectKey];
    
    // Actualizar datos de la fase actual
    progressData.currentPhase = phase;
    progressData.phases[phase].total = totalItems;
    progressData.phases[phase].completed = completedItems;
    progressData.lastUpdate = Date.now();
    
    // Actualizar tiempo promedio por elemento si se proporciona
    if (estimatedTimePerItem && completedItems > 0) {
      progressData.phases[phase].timePerItem = estimatedTimePerItem / completedItems;
    }
    
    // Calcular progreso general
    const totalPhases = Object.keys(progressData.phases).length;
    let overallProgress = 0;
    
    for (const [phaseName, phaseData] of Object.entries(progressData.phases)) {
      if (phaseData.total > 0) {
        const phaseProgress = (phaseData.completed / phaseData.total) * 100;
        overallProgress += phaseProgress / totalPhases;
      }
    }
    
    progressData.percentage = Math.min(Math.round(overallProgress), 100);
    progressData.currentStep = completedItems;
    progressData.totalSteps = totalItems;
    
    // Calcular tiempo estimado restante
    const elapsed = Date.now() - progressData.startTime;
    const currentPhaseData = progressData.phases[phase];
    
    if (completedItems > 0 && currentPhaseData.timePerItem > 0) {
      const remainingItems = totalItems - completedItems;
      const estimatedRemainingMs = remainingItems * currentPhaseData.timePerItem;
      
      const minutes = Math.floor(estimatedRemainingMs / 60000);
      const seconds = Math.floor((estimatedRemainingMs % 60000) / 1000);
      progressData.estimatedTimeRemaining = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    } else {
      progressData.estimatedTimeRemaining = 'Calculando...';
    }
    
    console.log(`📊 Progreso actualizado - ${phase}: ${completedItems}/${totalItems} (${progressData.percentage}%)`);
    
    return progressData;
    
  } catch (error) {
    console.error('❌ Error actualizando progreso:', error);
    return null;
  }
}

function initializeClipProgressSession(sessionId, sections = []) {
  if (!sessionId) {
    return null;
  }

  const normalizedSections = (Array.isArray(sections) ? sections : [])
    .map((section) => {
      const sectionNumberRaw = section?.numero ?? section?.sectionNumber ?? section?.id ?? section?.section;
      const sectionNumber = Number.parseInt(sectionNumberRaw, 10);

      if (!Number.isInteger(sectionNumber) || sectionNumber <= 0) {
        return null;
      }

      const totalClipsRaw = Array.isArray(section?.imagenes)
        ? section.imagenes.length
        : section?.totalClips ?? section?.totalImages ?? section?.imageCount ?? 0;
      const totalClips = Number.parseInt(totalClipsRaw, 10);

      if (!Number.isFinite(totalClips) || totalClips <= 0) {
        return null;
      }

      const audioCountRaw = Array.isArray(section?.audios)
        ? section.audios.length
        : section?.totalAudios ?? section?.audioCount ?? 0;
      const audioCount = Number.isFinite(Number(audioCountRaw)) ? Number(audioCountRaw) : 0;

      return {
        sectionNumber,
        name: section?.nombre || `Sección ${sectionNumber}`,
        totalClips,
        audioCount: audioCount > 0 ? audioCount : 0,
        completedClips: 0,
        generatedClips: 0,
        skippedClips: 0,
        errorClips: 0,
        clips: Array.from({ length: totalClips }, (_, index) => ({
          index: index + 1,
          status: 'pending'
        }))
      };
    })
    .filter(Boolean);

  const totalClips = normalizedSections.reduce((sum, section) => sum + section.totalClips, 0);

  const tracker = {
    sessionId,
    status: 'running',
    startedAt: Date.now(),
    lastUpdate: Date.now(),
    sections: normalizedSections,
    total: totalClips,
    completed: 0,
    generated: 0,
    skipped: 0,
    errors: 0,
    progress: 0,
    message: null,
    data: null,
    error: null,
    finishedAt: null
  };

  clipProgressTracker[sessionId] = tracker;
  return tracker;
}

function updateClipProgressSession(sessionId, sectionNumber, update = {}) {
  const tracker = clipProgressTracker[sessionId];

  if (!tracker) {
    return null;
  }

  const section = tracker.sections.find((entry) => Number(entry.sectionNumber) === Number(sectionNumber));

  if (!section) {
    return tracker;
  }

  const clipIndexRaw = update?.index ?? update?.imageIndex ?? update?.clipIndex;
  const clipIndex = Number.parseInt(clipIndexRaw, 10);

  if (!Number.isInteger(clipIndex) || clipIndex <= 0 || clipIndex > section.totalClips) {
    return tracker;
  }

  const clip = section.clips[clipIndex - 1];
  if (!clip) {
    return tracker;
  }

  const updateType = update?.type || 'generated';
  const statusMap = {
    generated: 'generated',
    complete: 'generated',
    completed: 'generated',
    skipped: 'skipped',
    omitido: 'skipped',
    error: 'error',
    failed: 'error'
  };

  const newStatus = statusMap[updateType] || 'generated';

  if (clip.status !== 'pending') {
    clip.status = newStatus;
    clip.detail = update?.detail || clip.detail || null;
    tracker.lastUpdate = Date.now();
    return tracker;
  }

  clip.status = newStatus;
  clip.detail = update?.detail || null;

  section.completedClips += 1;
  tracker.completed += 1;

  if (newStatus === 'generated') {
    section.generatedClips += 1;
    tracker.generated += 1;
  } else if (newStatus === 'skipped') {
    section.skippedClips += 1;
    tracker.skipped += 1;
  } else if (newStatus === 'error') {
    section.errorClips += 1;
    tracker.errors += 1;
  }

  tracker.progress = tracker.total > 0
    ? Math.min(100, Math.round((tracker.completed / tracker.total) * 100))
    : 0;
  tracker.lastUpdate = Date.now();

  return tracker;
}

function finalizeClipProgressSession(sessionId, status = 'completed', extra = {}) {
  const tracker = clipProgressTracker[sessionId];

  if (!tracker) {
    return null;
  }

  tracker.status = status;
  tracker.lastUpdate = Date.now();
  tracker.finishedAt = Date.now();

  if (extra?.message) {
    tracker.message = extra.message;
  }

  if (extra?.generatedVideos) {
    tracker.data = {
      ...(tracker.data || {}),
      generatedVideos: extra.generatedVideos
    };
  }

  if (extra?.skippedVideos) {
    tracker.data = {
      ...(tracker.data || {}),
      skippedVideos: extra.skippedVideos
    };
  }

  if (extra?.error) {
    tracker.error = extra.error;
  }

  tracker.completed = tracker.sections.reduce((sum, section) => sum + section.completedClips, 0);
  tracker.generated = tracker.sections.reduce((sum, section) => sum + section.generatedClips, 0);
  tracker.skipped = tracker.sections.reduce((sum, section) => sum + section.skippedClips, 0);
  tracker.errors = tracker.sections.reduce((sum, section) => sum + section.errorClips, 0);
  tracker.progress = tracker.total > 0 ? Math.min(100, Math.round((tracker.completed / tracker.total) * 100)) : 0;

  scheduleClipProgressCleanup(sessionId);

  return tracker;
}

function getClipProgressSession(sessionId) {
  const tracker = clipProgressTracker[sessionId];

  if (!tracker) {
    return null;
  }

  const serializedSections = tracker.sections.map((section) => ({
    sectionNumber: section.sectionNumber,
    name: section.name,
    totalClips: section.totalClips,
    audioCount: section.audioCount,
    completedClips: section.completedClips,
    generatedClips: section.generatedClips,
    skippedClips: section.skippedClips,
    errorClips: section.errorClips,
    clips: section.clips.map((clip) => ({
      index: clip.index,
      status: clip.status,
      detail: clip.detail || null
    }))
  }));

  return {
    sessionId: tracker.sessionId,
    status: tracker.status,
    startedAt: tracker.startedAt,
    lastUpdate: tracker.lastUpdate,
    finishedAt: tracker.finishedAt,
    total: tracker.total,
    completed: tracker.completed,
    generated: tracker.generated,
    skipped: tracker.skipped,
    errors: tracker.errors,
    progress: tracker.progress,
    message: tracker.message,
    sections: serializedSections,
    data: tracker.data,
    error: tracker.error
  };
}

function scheduleClipProgressCleanup(sessionId, delay = 15 * 60 * 1000) {
  setTimeout(() => {
    const tracker = clipProgressTracker[sessionId];
    if (!tracker) {
      return;
    }

    const isCompleted = tracker.status === 'completed' || tracker.status === 'failed';
    const inactivityTime = tracker.lastUpdate ? Date.now() - tracker.lastUpdate : Infinity;

    if (isCompleted && inactivityTime >= delay) {
      delete clipProgressTracker[sessionId];
    }
  }, delay).unref?.();
}

// Función para guardar el estado progresivo del proyecto
function saveProgressiveProjectState(projectKey, projectData, completedSections = [], completedAudio = [], completedImages = []) {
  try {
    const projectStateFile = path.join(globalOutputDir, projectKey, 'project_state.json');
    
    // Cargar estado existente si existe
    let existingState = {};
    if (fs.existsSync(projectStateFile)) {
      existingState = JSON.parse(fs.readFileSync(projectStateFile, 'utf8'));
    }
    
    // Crear estructura actualizada
    const updatedState = {
      ...existingState,
      ...projectData,
      lastModified: new Date().toISOString(),
      completedSections: completedSections,
      completedAudio: completedAudio,
      completedImages: completedImages,
      resumableState: {
        canResumeScripts: completedSections.length < (projectData.totalSections || 0),
        canResumeAudio: completedSections.length > 0 && completedAudio.length < completedSections.length,
        canResumeImages: completedSections.length > 0 && completedImages.length < completedSections.length,
        nextPhase: getNextPhase(completedSections, completedAudio, completedImages, projectData.totalSections || 0)
      }
    };
    
    // Asegurar que el directorio existe
    const stateDir = path.dirname(projectStateFile);
    if (!fs.existsSync(stateDir)) {
      fs.mkdirSync(stateDir, { recursive: true });
    }
    
    // Guardar estado
    fs.writeFileSync(projectStateFile, JSON.stringify(updatedState, null, 2), 'utf8');
    
    return updatedState;
    
  } catch (error) {
    console.error('❌ Error guardando estado progresivo:', error);
    return null;
  }
}

// Función auxiliar para determinar la siguiente fase
function getNextPhase(completedSections, completedAudio, completedImages, totalSections) {
  if (completedSections.length < totalSections) {
    return 'scripts';
  } else if (completedAudio.length < completedSections.length) {
    return 'audio';
  } else if (completedImages.length < completedSections.length) {
    return 'images';
  } else {
    return 'completed';
  }
}

// Función para obtener el progreso actual del proyecto
function getProjectProgress(projectKey) {
  try {
    const progressFile = path.join(globalOutputDir, projectKey, 'progress.json');
    if (fs.existsSync(progressFile)) {
      return JSON.parse(fs.readFileSync(progressFile, 'utf8'));
    }
    return null;
  } catch (error) {
    console.error('❌ Error obteniendo progreso:', error);
    return null;
  }
}

// =====================================
// FUNCIONES DE BÚSQUEDA Y DESCARGA DE IMÁGENES DE BING
// =====================================

// Función para generar palabras clave específicas para cada imagen usando LLM
async function generateImageKeywords(script, topic, imageCount) {
  try {
    console.log(`🧠 Generando ${imageCount} conjuntos de palabras clave para imágenes...`);
    
    const prompt = `Analiza el siguiente guión de YouTube y genera palabras clave específicas en inglés para buscar imágenes que complementen el contenido.

TEMA: ${topic}

GUIÓN:
${script}

INSTRUCCIONES:
1. PRIMERO detecta el universo/contexto principal del contenido (ej: World of Warcraft, League of Legends, Nintendo, Historia Medieval, etc.)
2. Genera exactamente ${imageCount} conjuntos de palabras clave para búsqueda de imágenes
3. CADA conjunto DEBE incluir el contexto detectado para evitar imágenes irrelevantes
4. Cada conjunto debe tener 3-4 palabras simples en inglés
5. Usa términos CONCRETOS y VISUALES que describan objetos, personajes, escenas

REGLAS DE CONTEXTO AUTOMÁTICO:
- Si mencionas "Alianza", "Horda", "Azeroth", "Stormwind", personajes como "Arthas", "Jaina", "Thrall": USA "World of Warcraft" 
- Si mencionas "Champions", "Rift", "Summoner", personajes como "Jinx", "Yasuo", "Garen": USA "League of Legends"
- Si mencionas "Mario", "Nintendo", "Mushroom Kingdom", "Bowser": USA "Nintendo Super Mario"
- Si mencionas "Roma", "Imperio Romano", "Gladiadores", "César": USA "Ancient Rome"
- Si mencionas "Medieval", "Caballeros", "Castillos", "Rey Arturo": USA "Medieval history"
- Si mencionas "Zelda", "Hyrule", "Link", "Ganondorf": USA "Nintendo Legend of Zelda"
- Para CUALQUIER videojuego: SIEMPRE incluye el nombre del juego específico

FORMATO DE RESPUESTA (exactamente ${imageCount} líneas):
[contexto específico + descripción visual]
[contexto específico + descripción visual]
[contexto específico + descripción visual]
...

EJEMPLOS CORRECTOS para diferentes universos:

Para guión sobre "Líderes de la Alianza en World of Warcraft":
World of Warcraft Alliance leaders meeting
WoW Stormwind City throne room
World of Warcraft King Anduin Wrynn
WoW Alliance army banner blue
World of Warcraft Ironforge council

Para guión sobre "La Horda en World of Warcraft":
World of Warcraft Horde leaders
WoW Orgrimmar city red banners
World of Warcraft Thrall shaman
WoW Horde warriors battle
World of Warcraft orc chieftain

Para guión sobre "Historia de Roma":
Ancient Rome senate meeting
Roman Empire emperor statue
Ancient Roman gladiator arena
Roman legion soldiers march
Classical Rome architecture

Para guión sobre "Nintendo Mario":
Nintendo Super Mario character
Mario Bros mushroom kingdom
Nintendo platformer game screenshot
Super Mario vintage console

IMPORTANTE: 
- NUNCA generes keywords genéricas sin contexto
- SIEMPRE incluye el universo/juego/contexto en cada keyword
- USA palabras que describan cosas VISIBLES (personajes, objetos, escenas)
- EVITA conceptos abstractos como "innovation", "challenge", "concept"

Responde SOLO con las ${imageCount} líneas de palabras clave, sin explicaciones adicionales.`;

    console.log(`🤖 Enviando prompt a LLM para generar keywords...`);
    
    const response = await generateUniversalContent(GEMINI_TEXT_MODEL, prompt);
    const keywordsText = response ? response.trim() : '';
    
    console.log(`📝 Respuesta del LLM:`, keywordsText);
    
    // Procesar la respuesta para extraer las palabras clave
    const lines = keywordsText.split('\n').filter(line => line.trim().length > 0);
    const keywords = [];
    
    for (let i = 0; i < imageCount; i++) {
      if (i < lines.length) {
        // Limpiar la línea de corchetes y caracteres especiales
        const cleanLine = lines[i].replace(/[\[\]]/g, '').trim();
        keywords.push(cleanLine);
      } else {
        // Fallback si no hay suficientes líneas
        keywords.push(`${topic} ${i + 1}`);
      }
    }
    
    console.log(`✅ Palabras clave generadas:`, keywords);
    return keywords;
    
  } catch (error) {
    console.error('❌ Error generando palabras clave:', error.message);
    
    // Fallback: generar palabras clave básicas
    const fallbackKeywords = [];
    for (let i = 0; i < imageCount; i++) {
      fallbackKeywords.push(`${topic} part ${i + 1}`);
    }
    
    console.log(`🔄 Usando keywords de fallback:`, fallbackKeywords);
    return fallbackKeywords;
  }
}

// Función para buscar y descargar imágenes de Bing
async function searchAndDownloadBingImages(keywords, sectionDir) {
  //console.log(`🔍 Buscando imágenes en Bing con ${keywords.length} conjuntos de palabras clave`);
  
  try {
    const downloadedImages = [];
    const maxRetries = 3; // Máximo 3 intentos por imagen
    
    // Buscar y descargar una imagen para cada conjunto de palabras clave
    for (let i = 0; i < keywords.length; i++) {
      const query = keywords[i];
      console.log(`📸 Buscando imagen ${i + 1}/${keywords.length} con: "${query}"`);
      
      let imageDownloaded = false;
      let retryCount = 0;
      
      // Intentar descargar la imagen con reintentos
      while (!imageDownloaded && retryCount < maxRetries) {
        try {
          // Buscar URLs de imágenes en Bing para este query específico
          const imageUrls = await searchBingImages(query, 20); // Buscar 20 opciones para más variedad
          
          if (imageUrls.length > 0) {
            // Intentar con diferentes URLs si la primera falla - usar más opciones
            for (let urlIndex = 0; urlIndex < Math.min(imageUrls.length, 10); urlIndex++) {
              try {
                const imageUrl = imageUrls[urlIndex];
                const filename = `bing_image_${i + 1}.jpg`;
                const filepath = path.join(sectionDir, filename);
                
                console.log(`📥 Descargando imagen ${i + 1} (intento ${retryCount + 1}/${maxRetries}, URL ${urlIndex + 1}): ${imageUrl.substring(0, 80)}...`);
                
                await downloadImageFromUrl(imageUrl, filepath);
                
                downloadedImages.push({
                  filename: filename,
                  path: filepath,
                  url: imageUrl,
                  source: 'bing',
                  keywords: query,
                  caption: `Imagen ${i + 1}: ${query}`
                });
                
                console.log(`✅ Descargada imagen ${i + 1}: ${filename} (${query})`);
                imageDownloaded = true;
                break; // Salir del loop de URLs
                
              } catch (urlError) {
                console.log(`⚠️ Error con URL ${urlIndex + 1}: ${urlError.message}`);
                continue; // Intentar con la siguiente URL
              }
            }
            
            if (!imageDownloaded) {
              retryCount++;
              if (retryCount < maxRetries) {
                console.log(`🔄 Reintentando imagen ${i + 1} (intento ${retryCount + 1}/${maxRetries})...`);
                await new Promise(resolve => setTimeout(resolve, 2000)); // Pausa antes de reintentar
              }
            }
            
          } else {
            console.log(`⚠️ No se encontraron imágenes para: "${query}"`);
            retryCount++;
            if (retryCount < maxRetries) {
              console.log(`🔄 Reintentando búsqueda para "${query}" (intento ${retryCount + 1}/${maxRetries})...`);
              await new Promise(resolve => setTimeout(resolve, 2000));
            }
          }
          
        } catch (error) {
          retryCount++;
          console.error(`❌ Error en intento ${retryCount} para imagen ${i + 1} (${query}):`, error.message);
          if (retryCount < maxRetries) {
            console.log(`🔄 Reintentando imagen ${i + 1} en 3 segundos...`);
            await new Promise(resolve => setTimeout(resolve, 3000));
          }
        }
      }
      
      // Si no se pudo descargar la imagen después de todos los intentos
      if (!imageDownloaded) {
        console.log(`❌ FALLO DEFINITIVO: No se pudo descargar imagen ${i + 1} con keywords "${query}" después de ${maxRetries} intentos`);
        
        // Crear placeholder o imagen vacía para mantener la secuencia
        const filename = `bing_image_${i + 1}.jpg`;
        downloadedImages.push({
          filename: filename,
          path: null, // Sin archivo físico
          url: null,
          source: 'bing',
          keywords: query,
          caption: `Imagen ${i + 1}: ${query}`,
          failed: true // Marcar como fallida
        });
      }
      
      // Pequeña pausa entre descargas para no sobrecargar Bing
      if (i < keywords.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    const successfulDownloads = downloadedImages.filter(img => !img.failed).length;
    console.log(`🎉 Descarga completada: ${successfulDownloads}/${keywords.length} imágenes exitosas`);
    
    if (successfulDownloads < keywords.length) {
      console.log(`⚠️ ADVERTENCIA: ${keywords.length - successfulDownloads} imágenes fallaron. Los keywords seguirán alineados.`);
    }
    
    return downloadedImages;
    
  } catch (error) {
    console.error('❌ Error en búsqueda y descarga de Bing:', error.message);
    return [];
  }
}

// Función para buscar imágenes en Bing Images usando web scraping
async function searchBingImages(query, count = 5) {
  try {
    const encodedQuery = encodeURIComponent(query);
    const searchUrl = `https://www.bing.com/images/search?q=${encodedQuery}&form=HDRSC2&first=1&cw=1177&ch=778`;
    
    console.log(`🌐 Buscando en Bing Images: ${query}`);
    
    const response = await axios.get(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Cache-Control': 'max-age=0'
      },
      timeout: 15000
    });

    const $ = cheerio.load(response.data);
    const imageUrls = [];

    // Buscar imágenes en diferentes selectores de Bing
    const selectors = [
      'a.iusc',
      '.imgpt img',
      '.img_cont img',
      'img.mimg'
    ];

    for (const selector of selectors) {
      $(selector).each((i, elem) => {
        try {
          let imageUrl = null;
          
          if (selector === 'a.iusc') {
            // Para enlaces con metadatos JSON
            const metadata = $(elem).attr('m');
            if (metadata) {
              const parsed = JSON.parse(metadata);
              imageUrl = parsed.murl || parsed.turl;
            }
          } else {
            // Para elementos img directos
            imageUrl = $(elem).attr('src') || $(elem).attr('data-src') || $(elem).attr('data-img');
          }
          
          if (imageUrl && 
              imageUrl.startsWith('http') && 
              !imageUrl.includes('bing.com') &&
              !imageUrl.includes('microsoft.com') &&
              !imageUrl.includes('data:image') &&
              imageUrl.length > 50 &&
              imageUrls.length < count) {
            
            imageUrls.push(imageUrl);
          }
        } catch (parseError) {
          // Continuar con la siguiente imagen si hay error de parsing
        }
      });
      
      if (imageUrls.length >= count) break;
    }

    console.log(`📸 Bing encontró: ${imageUrls.length} URLs de imágenes`);
    return imageUrls;
    
  } catch (error) {
    console.error('❌ Error en búsqueda de Bing Images:', error.message);
    return [];
  }
}

// Función para descargar una imagen desde URL
async function downloadImageFromUrl(url, filepath) {
  try {
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream',
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Fetch-Dest': 'image',
        'Sec-Fetch-Mode': 'no-cors',
        'Sec-Fetch-Site': 'cross-site'
      },
      maxRedirects: 5
    });

    const writer = fs.createWriteStream(filepath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        // Verificar que el archivo se escribió correctamente
        if (fs.existsSync(filepath)) {
          const stats = fs.statSync(filepath);
          if (stats.size > 1000) { // Al menos 1KB
            resolve(filepath);
          } else {
            fs.unlinkSync(filepath); // Eliminar archivo corrupto
            reject(new Error('Archivo muy pequeño, posiblemente corrupto'));
          }
        } else {
          reject(new Error('El archivo no se creó correctamente'));
        }
      });
      writer.on('error', reject);
      
      // Timeout adicional
      setTimeout(() => {
        writer.destroy();
        reject(new Error('Timeout en descarga de imagen'));
      }, 20000);
    });
  } catch (error) {
    throw new Error(`Error descargando imagen: ${error.message}`);
  }
}

const MAX_PREVIOUS_SECTIONS_CONTEXT = 5;

function truncateForSummary(text, maxLength = 320) {
  if (!text || typeof text !== 'string') {
    return '';
  }

  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLength) {
    return clean;
  }

  const truncated = clean.slice(0, maxLength);
  const lastSentenceBreak = Math.max(
    truncated.lastIndexOf('.'),
    truncated.lastIndexOf('?'),
    truncated.lastIndexOf('!')
  );

  if (lastSentenceBreak > maxLength * 0.5) {
    return truncated.slice(0, lastSentenceBreak + 1).trim() + '…';
  }

  return truncated.trim() + '…';
}

function normalizePreviousSectionsContext(previousChapterContent, chapterStructure = null) {
  const rawEntries = Array.isArray(previousChapterContent)
    ? previousChapterContent
    : previousChapterContent
      ? [previousChapterContent]
      : [];

  const normalized = rawEntries
    .map((entry, index) => {
      let text = '';

      if (typeof entry === 'string') {
        text = entry;
      } else if (entry && typeof entry === 'object') {
        if (typeof entry.content === 'string') {
          text = entry.content;
        } else if (typeof entry.script === 'string') {
          text = entry.script;
        } else if (typeof entry.text === 'string') {
          text = entry.text;
        }
      }

      const cleanText = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
      if (!cleanText) {
        return null;
      }

      const sectionIndex = index + 1;
      const title = Array.isArray(chapterStructure) && chapterStructure[sectionIndex - 1]
        ? chapterStructure[sectionIndex - 1].trim() || `Sección ${sectionIndex}`
        : `Sección ${sectionIndex}`;

      return {
        sectionIndex,
        title,
        content: cleanText,
        summary: truncateForSummary(cleanText)
      };
    })
    .filter(Boolean);

  if (!normalized.length) {
    return [];
  }

  return normalized.slice(-MAX_PREVIOUS_SECTIONS_CONTEXT);
}

function buildPreviousContextBlock(normalizedPreviousContext) {
  if (!Array.isArray(normalizedPreviousContext) || normalizedPreviousContext.length === 0) {
    return '';
  }

  const lines = normalizedPreviousContext.map((context) => `• Sección ${context.sectionIndex} (${context.title}): ${context.summary}`);

  return `

📚 CONTEXTO DE LAS ÚLTIMAS ${normalizedPreviousContext.length} SECCIONES YA DESARROLLADAS:
${lines.join('\n')}

IMPORTANTE: Usa este contexto para mantener continuidad, hacer referencias naturales y evitar repeticiones literales.`;
}

function buildSectionFocusBlock(topic, currentSection, totalSections, chapterStructure = null, normalizedPreviousContext = []) {
  const globalTopic = typeof topic === 'string' ? topic.trim() : '';
  const sectionTitle = Array.isArray(chapterStructure) && chapterStructure[currentSection - 1]
    ? chapterStructure[currentSection - 1].trim()
    : null;

  const coveredTitles = normalizedPreviousContext
    .slice(-3)
    .map((context) => `${context.sectionIndex}. ${context.title}`)
    .join(', ');

  let block = `

🎯 OBJETIVOS PARA LA SECCIÓN ${currentSection}/${totalSections}:
- Tema global del proyecto: "${globalTopic || 'Sin especificar'}"`;

  if (sectionTitle) {
    block += `
- Foco específico de esta sección: "${sectionTitle}"`;
  }

  if (coveredTitles) {
    block += `
- Ya se cubrió previamente: ${coveredTitles}`;
  }

  block += `
- Expande la narrativa con material nuevo, consecuencias y detalles inéditos.
- Conecta con la última sección para mantener continuidad orgánica.`;

  return block;
}

// Función para generar prompts según el estilo seleccionado
function generateScriptPrompt(style, topic, sections, section, customStyleInstructions = null, chapterStructure = null, previousChapterContent = null, wordsMin = 800, wordsMax = 1100) {
  if (style === 'comedy') {
    return generateComedyPrompt(topic, sections, section, chapterStructure, previousChapterContent, wordsMin, wordsMax);
  } else if (style && style.startsWith('custom_') && customStyleInstructions) {
    return generateCustomPrompt(topic, sections, section, customStyleInstructions, chapterStructure, previousChapterContent, wordsMin, wordsMax);
  } else {
    return generateProfessionalPrompt(topic, sections, section, chapterStructure, previousChapterContent, wordsMin, wordsMax);
  }
    }

function generateCustomPrompt(topic, sections, section, customInstructions, chapterStructure = null, previousChapterContent = null, wordsMin = 800, wordsMax = 1100) {
  const currentSection = Number(section);
  const totalSections = Number(sections);

  const normalizedPreviousContext = normalizePreviousSectionsContext(previousChapterContent, chapterStructure);
  const previousContextBlock = buildPreviousContextBlock(normalizedPreviousContext);
  const sectionFocusBlock = buildSectionFocusBlock(topic, currentSection, totalSections, chapterStructure, normalizedPreviousContext);

  let chapterContext = '';
  if (chapterStructure && chapterStructure.length > 0) {
    chapterContext = `

ESTRUCTURA COMPLETA DE CAPÍTULOS:
${chapterStructure.map((title, index) => `${index + 1}. ${title}`).join('\n')}

CAPÍTULO ACTUAL: ${chapterStructure[currentSection - 1] || `Capítulo ${currentSection}`}`;
  }

  if (currentSection === 1) {
    return `${customInstructions}

TEMA SOLICITADO: "${topic}"
TOTAL DE SECCIONES: ${totalSections}${chapterContext}${sectionFocusBlock}

Vamos a crear un guión de YouTube dividido en ${totalSections} secciones sobre el tema que el usuario ha solicitado.

POR FAVOR, DAME SOLO LA SECCIÓN 1 DE ${totalSections}.

INSTRUCCIONES GENERALES:
- Crea contenido basado exactamente en lo que el usuario ha pedido en el tema
- Adapta tu estilo narrativo al tipo de contenido solicitado
- APLICA ESTRICTAMENTE el estilo personalizado especificado arriba
- Introduce el tema con fuerza y establece el tono general que seguirá el resto de secciones
- Si puedes, anticipa tensiones o preguntas que resolverás más adelante sin revelar todavía las respuestas

ESTRUCTURA REQUERIDA PARA LA SECCIÓN 1:
- Exactamente 3 párrafos detallados
- MUY IMPORTANTE O ME MUERO TIENE QUE SER Entre ${wordsMin} y ${wordsMax} palabras en total para esta sección
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
- Esta es la PRIMERA sección, establece los fundamentos del tema con una bienvenida al canal
- NO incluyas despedida ya que habrá más secciones
- Basa tu contenido completamente en lo que el usuario solicita en el tema
- RESPONDE SOLO CON EL TEXTO DEL GUIÓN, NADA MÁS`;
  }

  return `Ahora dame la sección ${currentSection} de ${totalSections} del mismo tema.${chapterContext}${sectionFocusBlock}${previousContextBlock}

MANTÉN EXACTAMENTE EL MISMO ESTILO PERSONALIZADO: ${customInstructions}

INSTRUCCIONES CRÍTICAS PARA CONTINUIDAD NARRATIVA:
- Esta es la CONTINUACIÓN de un video que ya comenzó, NO hagas nueva introducción ni saludo, todo es parte del mismo video.
- Integra de forma natural el contexto provisto arriba y evita repetir datos o situaciones
- Usa transiciones naturales apropiadas para tu estilo personalizado
- Refuerza conexiones con los capítulos anteriores y deja ganchos para los siguientes
- Si necesitas mencionar algo ya dicho, hazlo como referencia rápida y expande con material nuevo

ESTRUCTURA REQUERIDA PARA LA SECCIÓN ${currentSection}:
- Exactamente 3 párrafos detallados
- MUY IMPORTANTE O ME MUERO TIENE QUE SER Entre ${wordsMin} y ${wordsMax} palabras en total para esta sección
- Mantén continuidad narrativa fluida con las secciones anteriores
- Progresa de manera lógica en el desarrollo del tema y agrega información fresca
- Sigue el mismo estilo y enfoque que estableciste en las secciones anteriores
- Explora nuevos aspectos sin repetir contenido ya cubierto

FORMATO DE RESPUESTA OBLIGATORIO:
- Responde ÚNICAMENTE con el texto del guión
- NO incluyas explicaciones, comentarios, ni texto adicional
- NO incluyas etiquetas como "Sección ${currentSection}:", "Guión:", etc.
- NO incluyas notas, aclaraciones o pensamientos
- El texto debe estar listo para ser usado directamente en TTS
- Comienza directamente con el contenido del guión
- INICIA con una transición natural, NO con bienvenida

${currentSection === totalSections ? `IMPORTANTE: Como esta es la ÚLTIMA sección (${currentSection}/${totalSections}), DEBES incluir una despedida profesional al final que invite a:
- Comentar sus opiniones sobre el tema presentado
- Suscribirse al canal para más contenido  
- Dar like si disfrutaron el contenido
- Sugerir futuros temas que les gustaría ver

Ejemplo de despedida: "Y así concluye este episodio sobre [tema]... Si este contenido te ha resultado interesante, déjanos un like y suscríbete al canal para más contenido. Compártenos en los comentarios qué otros temas te gustaría que cubramos..."` : 'NO incluyas despedida ya que esta no es la última sección.'}

🎯 RECORDATORIO CRÍTICO: Debes seguir fielmente este estilo: ${customInstructions}

RECUERDA: RESPONDE SOLO CON EL TEXTO DEL GUIÓN, SIN COMENTARIOS NI EXPLICACIONES ADICIONALES.`;
}

// Función para generar prompt estilo profesional (original)
function generateProfessionalPrompt(topic, sections, section, chapterStructure = null, previousChapterContent = null, wordsMin = 800, wordsMax = 1100) {
  const currentSection = Number(section);
  const totalSections = Number(sections);

  const normalizedPreviousContext = normalizePreviousSectionsContext(previousChapterContent, chapterStructure);
  const previousContextBlock = buildPreviousContextBlock(normalizedPreviousContext);
  const sectionFocusBlock = buildSectionFocusBlock(topic, currentSection, totalSections, chapterStructure, normalizedPreviousContext);

  let chapterContext = '';
  if (chapterStructure && chapterStructure.length > 0) {
    chapterContext = `

ESTRUCTURA COMPLETA DE CAPÍTULOS:
${chapterStructure.map((title, index) => `${index + 1}. ${title}`).join('\n')}

CAPÍTULO ACTUAL: ${chapterStructure[currentSection - 1] || `Capítulo ${currentSection}`}`;
  }

  if (currentSection === 1) {
    return `Eres un escritor profesional especializado en guiones para YouTube.

TEMA SOLICITADO: "${topic}"
TOTAL DE CAPÍTULOS: ${totalSections}${chapterContext}${sectionFocusBlock}

Vamos a crear un guión de YouTube dividido en ${totalSections} capítulos sobre el tema que el usuario ha solicitado.

POR FAVOR, DAME SOLO EL CAPÍTULO 1 DE ${totalSections}.
Al ser este el primer capítulo, da una bienvenida al canal y presenta el tema de manera atractiva.
INSTRUCCIONES GENERALES:
- Crea contenido basado exactamente en lo que el usuario ha pedido en el tema
- Si es sobre ficción, enfócate en los elementos narrativos y creativos
- Si es sobre desarrollo/creación, enfócate en los aspectos reales de producción
- Si es sobre historia, enfócate en hechos históricos y datos
- Adapta tu estilo narrativo al tipo de contenido solicitado
${chapterStructure ? `- ENFÓCATE en el contenido específico del CAPÍTULO 1: "${chapterStructure[0] || 'Sin título'}"` : ''}

ESTRUCTURA REQUERIDA PARA EL CAPÍTULO 1:
- Exactamente 3 párrafos detallados
- Entre ${wordsMin} y ${wordsMax} palabras en total para este capítulo
- Mantén un tono profesional y enganchante
- Establece las bases del tema para los siguientes capítulos
${chapterStructure ? `- Desarrolla el tema específico del capítulo: "${chapterStructure[0] || 'Sin título'}"` : ''}

FORMATO DE RESPUESTA OBLIGATORIO:
- Responde ÚNICAMENTE con el texto del guión
- NO incluyas explicaciones, comentarios, ni texto adicional
- NO incluyas etiquetas como "Capítulo 1:", "Guión:", etc.
- NO incluyas notas, aclaraciones o pensamientos
- El texto debe estar listo para ser usado directamente en TTS
- Comienza directamente con el contenido del guión

IMPORTANTE:
- Este es el PRIMER capítulo, establece los fundamentos del tema
- NO incluyas despedida ya que habrá más capítulos
- Basa tu contenido completamente en lo que el usuario solicita en el tema
- RESPONDE SOLO CON EL TEXTO DEL GUIÓN, NADA MÁS`;
  }

  return `Ahora dame el capítulo ${currentSection} de ${totalSections} del mismo tema.${chapterContext}${sectionFocusBlock}${previousContextBlock}

INSTRUCCIONES CRÍTICAS PARA CONTINUIDAD NARRATIVA:
- Esta es la CONTINUACIÓN de un video que ya comenzó, NO hagas nueva introducción o bienvenida
- NO repitas conceptos, datos o anécdotas ya mencionados en capítulos anteriores
- CONTINÚA directamente desde donde se quedó la narrativa anterior
- Usa transiciones naturales como "Ahora bien...", "Continuando con...", "Además de esto...", "Por otro lado..."
- Haz referencias sutiles al contenido previo cuando sea relevante (ej: "Como vimos anteriormente...", "Retomando ese punto...")
- EVITA frases como "Bienvenidos", "Hola", "En este video" - ya estamos dentro del video
- CONSTRUYE sobre la información ya presentada, no la repitas

ESTRUCTURA REQUERIDA PARA EL CAPÍTULO ${currentSection}:
- Exactamente 3 párrafos detallados
- Entre ${wordsMin} y ${wordsMax} palabras en total para este capítulo
- Mantén continuidad narrativa fluida con los capítulos anteriores
- Progresa de manera lógica en el desarrollo del tema
- CONECTA directamente con el contenido de los capítulos anteriores
- Explora nuevos aspectos del tema sin repetir información ya cubierta
- Si necesitas mencionar algo ya dicho, hazlo brevemente como referencia y expande con nueva información
${chapterStructure ? `- ENFÓCATE en el contenido específico del CAPÍTULO ${currentSection}: "${chapterStructure[currentSection - 1] || 'Sin título'}"` : ''}

FORMATO DE RESPUESTA OBLIGATORIO:
- Responde ÚNICAMENTE con el texto del guión
- NO incluyas explicaciones, comentarios, ni texto adicional
- NO incluyas etiquetas como "Capítulo ${currentSection}:", "Guión:", etc.
- NO incluyas notas, aclaraciones o pensamientos
- El texto debe estar listo para ser usado directamente en TTS
- Comienza directamente con el contenido del guión
- INICIA con una transición natural, NO con bienvenida

${currentSection === totalSections ? `IMPORTANTE: Como este es el ÚLTIMO capítulo (${currentSection}/${totalSections}), DEBES incluir una despedida profesional al final que invite a:
- Comentar sus opiniones sobre el tema presentado
- Suscribirse al canal para más contenido  
- Dar like si disfrutaron el contenido
- Sugerir futuros temas que les gustaría ver

Ejemplo de despedida: "Y así concluye este episodio sobre [tema]... Si este contenido te ha resultado interesante, déjanos un like y suscríbete al canal para más contenido. Compártenos en los comentarios qué otros temas te gustaría que cubramos..."` : 'NO incluyas despedida ya que este no es el último capítulo.'}

RECUERDA: ESTE ES UN CAPÍTULO INTERMEDIO DE UN VIDEO YA INICIADO - NO HAGAS BIENVENIDAS NI INTRODUCCIONES GENERALES.`;
}

// Función para generar prompt estilo cómico/sarcástico
function generateComedyPrompt(topic, sections, section, chapterStructure = null, previousChapterContent = null, wordsMin = 800, wordsMax = 1100) {
  const currentSection = Number(section);
  const totalSections = Number(sections);

  const normalizedPreviousContext = normalizePreviousSectionsContext(previousChapterContent, chapterStructure);
  const previousContextBlock = buildPreviousContextBlock(normalizedPreviousContext);
  const sectionFocusBlock = buildSectionFocusBlock(topic, currentSection, totalSections, chapterStructure, normalizedPreviousContext);

  let chapterContext = '';
  if (chapterStructure && chapterStructure.length > 0) {
    chapterContext = `

ESTRUCTURA COMPLETA DE CAPÍTULOS:
${chapterStructure.map((title, index) => `${index + 1}. ${title}`).join('\n')}

CAPÍTULO ACTUAL: ${chapterStructure[currentSection - 1] || `Capítulo ${currentSection}`}`;
  }

  if (currentSection === 1) {
    return `Eres un escritor de guiones creativo para contenido de YouTube.

Tu tarea es construir guiones con un tono sarcástico, irónico, con humor negro, muchas groserías y un chingo de humor absurdo.

TEMA SOLICITADO: "${topic}"
TOTAL DE CAPÍTULOS: ${totalSections}${chapterContext}${sectionFocusBlock}

Vamos a crear un guión de YouTube dividido en ${totalSections} capítulos sobre el tema que el usuario ha solicitado.

POR FAVOR, DAME SOLO EL CAPÍTULO 1 DE ${totalSections}.

🎭 FORMATO DEL GUION:

El guion debe leerse como una actuación, además de una narración cronológica.
como es el primer capítulo usa una introducción llamativa para captar la atención del espectador.
Usa múltiples voces indicadas con corchetes, por ejemplo:
[voz de narrador serio], [voz sarcástica], [grito desesperado], [voz de niña loca], [voz de viejita], etc.

Las escenas deben sentirse teatrales, exageradas, bizarras y alucinantes.
En algunas ocasiones interpreta lo que los personajes en el guion podrían decir o pensar.
${chapterStructure ? `
🎯 ENFOQUE DEL CAPÍTULO: Centra todo el contenido en desarrollar específicamente "${chapterStructure[0] || 'Sin título'}"` : ''}

ESTRUCTURA REQUERIDA PARA EL CAPÍTULO 1:
- Exactamente 3 párrafos detallados
- Entre ${wordsMin} y ${wordsMax} palabras en total para este capítulo
- Mantén un tono sarcástico, irónico y absurdo y muy ácido.
- Establece las bases del tema para los siguientes capítulos
${chapterStructure ? `- Desarrolla el tema específico del capítulo: "${chapterStructure[0] || 'Sin título'}"` : ''}

PALABRAS Y EXPRESIONES A USAR:
Usa algunas veces palabras como: pinche, wey, pendejo, cabrón, verga, chinga tu madre, me vale verga, come verga, hijo de la verga.

RESTRICCIONES:
- No se permite usar la palabra "show"
- No se permiten chistes sobre políticos ni ex parejas

FORMATO DE RESPUESTA OBLIGATORIO:
- Responde ÚNICAMENTE con el texto del guión
- NO incluyas explicaciones, comentarios, ni texto adicional
- NO incluyas etiquetas como "Capítulo 1:", "Guión:", etc.
- El texto debe estar listo para ser usado directamente en TTS
- Comienza directamente con el contenido del guión

IMPORTANTE:
- Este es el PRIMER capítulo, establece los fundamentos del tema
- NO incluyas despedida ya que habrá más capítulos
- Basa tu contenido completamente en lo que el usuario solicita en el tema
- RESPONDE SOLO CON EL TEXTO DEL GUIÓN, NADA MÁS`;
  }

  return `Ahora dame el capítulo ${currentSection} de ${totalSections} del mismo tema.${chapterContext}${sectionFocusBlock}${previousContextBlock}

Mantén el mismo estilo sarcástico, irónico, con humor negro y groserías.

INSTRUCCIONES CRÍTICAS PARA CONTINUIDAD NARRATIVA:
- Esta es la CONTINUACIÓN de un video que ya comenzó, NO hagas nueva introducción o bienvenida
- NO repitas chistes, groserías o referencias ya mencionadas en capítulos anteriores  
- CONTINÚA directamente desde donde se quedó la narrativa anterior
- Usa transiciones cómicas naturales apropiadas para el estilo sarcástico
- Haz referencias humorísticas al contenido previo cuando sea relevante
- EVITA reiniciar la narrativa - ya estamos dentro del video cómico
- CONSTRUYE sobre las situaciones ya presentadas, explora nuevos aspectos con humor ácido

ESTRUCTURA REQUERIDA PARA EL CAPÍTULO ${currentSection}:
- Exactamente 3 párrafos detallados
- Entre ${wordsMin} y ${wordsMax} palabras en total para este capítulo
- Mantén continuidad narrativa fluida con los capítulos anteriores
- Progresa de manera lógica en el desarrollo del tema
- Sigue el mismo estilo cómico y absurdo que estableciste
- CONECTA directamente con el contenido de los capítulos anteriores
- Haz referencias sutiles a información ya mencionada cuando sea relevante
- Explora nuevos aspectos del tema sin repetir contenido ya cubierto
${chapterStructure ? `- ENFÓCATE en el contenido específico del CAPÍTULO ${currentSection}: "${chapterStructure[currentSection - 1] || 'Sin título'}"` : ''}

🎭 FORMATO DEL GUION:
- Usa múltiples voces indicadas con corchetes al menos 4 en cada párrafo
- Usa onomatopeyas y efectos sonoros ridículos
- Las escenas deben sentirse teatrales y exageradas
- INICIA con una transición natural, NO con bienvenida

PALABRAS Y EXPRESIONES A USAR:
Usa muchas palabras como: pinche, wey, pendejo, cabrón, verga, chinga tu madre, me vale verga, come verga.

FORMATO DE RESPUESTA OBLIGATORIO:
- Responde ÚNICAMENTE con el texto del guión
- NO incluyas explicaciones, comentarios, ni texto adicional
- NO incluyas etiquetas como "Capítulo ${currentSection}:", "Guión:", etc.
- El texto debe estar listo para ser usado directamente en TTS
- Comienza directamente con el contenido del guión

${currentSection === totalSections ? `IMPORTANTE: Como este es el ÚLTIMO capítulo (${currentSection}/${totalSections}), DEBES incluir una despedida cómica al final que invite a:
- Comentar sus opiniones sobre el tema presentado
- Suscribirse al canal para más contenido  
- Dar like si disfrutaron el contenido
- Sugerir futuros temas que les gustaría ver

Ejemplo de despedida cómica: "Y así concluye este pinche episodio sobre [tema]... Si te cagaste de risa, déjanos un like y suscríbete al canal para más contenido cabrón. Compártenos en los comentarios qué otros temas te gustaría que cubramos, wey..."` : 'NO incluyas despedida ya que este no es el último capítulo.'}

RECUERDA: ESTE ES UN CAPÍTULO INTERMEDIO DE UN VIDEO YA INICIADO - CONTINÚA LA NARRATIVA SIN INTRODUCCIONES.`;
}

function normalizeMultiProjectEntries(projects = []) {
  const seenFolders = new Set();
  const normalized = [];

  projects.forEach((project, index) => {
    if (!project || typeof project.topic !== 'string') {
      return;
    }

    const topic = project.topic.trim();
    if (!topic) {
      return;
    }

    const requestedFolder = typeof project.folderName === 'string' ? project.folderName.trim() : '';
    const baseFolderName = requestedFolder || topic;
    let safeFolderName = createSafeFolderName(baseFolderName) || `proyecto_${index + 1}`;

    let uniqueFolderName = safeFolderName;
    let suffix = 2;
    while (seenFolders.has(uniqueFolderName)) {
      uniqueFolderName = `${safeFolderName}_${suffix}`;
      suffix += 1;
    }

    seenFolders.add(uniqueFolderName);

    const requestedVoice = typeof project.voice === 'string' ? project.voice.trim() : '';

    normalized.push({
      topic,
      folderName: uniqueFolderName,
      originalFolderName: requestedFolder || null,
      index,
      projectKey: project.projectKey || uniqueFolderName,
      voice: requestedVoice || null
    });
  });

  return normalized;
}

function findMostRecentScriptFile(sectionDir) {
  try {
    if (!fs.existsSync(sectionDir)) {
      return null;
    }

    const candidates = fs.readdirSync(sectionDir)
      .filter((file) => file.toLowerCase().includes('guion') && file.toLowerCase().endsWith('.txt'))
      .map((file) => ({
        file,
        stats: fs.statSync(path.join(sectionDir, file))
      }))
      .sort((a, b) => b.stats.mtimeMs - a.stats.mtimeMs);

    return candidates.length ? path.join(sectionDir, candidates[0].file) : null;
  } catch (error) {
    console.warn('⚠️ No se pudo determinar el archivo de guión más reciente:', error.message);
    return null;
  }
}

function buildScriptFileContent({
  topic,
  totalSections,
  sectionNumber,
  chapterTitle,
  projectKey,
  scriptText
}) {
  // Truncar el tema a las primeras 10 palabras
  const truncatedTopic = topic ? topic.split(/\s+/).slice(0, 10).join(' ') + (topic.split(/\s+/).length > 10 ? '...' : '') : '';

  const headerLines = [
    `GUIÓN DE SECCIÓN ${sectionNumber}`,
    '===============================',
    `Tema: ${truncatedTopic}`,
    `Sección: ${sectionNumber} de ${totalSections}`,
    `Capítulo: ${chapterTitle || `Sección ${sectionNumber}`}`,
    `Proyecto: ${projectKey}`,
    `Longitud: ${scriptText.length} caracteres`,
    `Fecha de actualización: ${new Date().toLocaleString()}`,
    '',
    'CONTENIDO DEL GUIÓN:'
  ];

  const footerLines = [
    '',
    '===============================',
    'Guión verificado automáticamente por el sistema'
  ];

  return `${headerLines.join('\n')}\n${scriptText}\n${footerLines.join('\n')}`;
}

function isScriptContentValid(scriptText) {
  if (!scriptText || typeof scriptText !== 'string') {
    return false;
  }

  const normalized = scriptText.trim();
  if (!normalized) {
    return false;
  }

  const errorIndicators = [
    'error generando contenido',
    '[googlegenerativeai error]',
    'you exceeded your current quota',
    'quota exceeded',
    'please retry in',
    'error fetching from',
    'http 4',
    'http 5',
    'rate limit',
    'request blocked',
    'error code',
    'api key invalid'
  ];

  const lower = normalized.toLowerCase();
  return !errorIndicators.some((indicator) => lower.includes(indicator));
}

async function ensureProjectScriptsReady({
  projectData,
  scriptStyle = 'professional',
  customStyleInstructions = '',
  wordsMin = 800,
  wordsMax = 1100
}) {
  if (!projectData || !Array.isArray(projectData.sections) || !projectData.sections.length) {
    throw new Error('projectData inválido para verificar guiones');
  }

  const topic = projectData.topic || projectData.sections[0]?.title?.split(':')[0] || 'Proyecto';
  const projectKey = projectData.projectKey || createSafeFolderName(topic);
  const totalSections = projectData.totalSections || projectData.sections.length;
  const chapterStructure = Array.isArray(projectData.chapterStructure)
    ? projectData.chapterStructure
    : projectData.sections.map((section) => section.title || `Sección ${section.section}`);

  const normalizedStyle = scriptStyle === 'default' ? 'professional' : scriptStyle;

  const stats = {
    checked: 0,
    regenerated: [],
    restoredFromMemory: [],
    reusedExisting: []
  };

  const verifiedSections = [];

  for (let index = 0; index < projectData.sections.length; index += 1) {
    const sectionData = projectData.sections[index];
    const sectionNumber = Number.parseInt(sectionData.section, 10) || index + 1;

    const { sectionDir } = createProjectStructure(topic, sectionNumber, projectKey);
    const existingScriptPath = findMostRecentScriptFile(sectionDir);
    const defaultScriptPath = path.join(sectionDir, `${projectKey}_seccion_${sectionNumber}_guion.txt`);
    let targetScriptPath = existingScriptPath || defaultScriptPath;

    let scriptText = typeof sectionData.cleanScript === 'string' && sectionData.cleanScript.trim()
      ? sectionData.cleanScript.trim()
      : typeof sectionData.script === 'string' && sectionData.script.trim()
        ? cleanScriptText(sectionData.script)
        : '';

    if (scriptText && !isScriptContentValid(scriptText)) {
      console.log(`⚠️ Script en memoria inválido para sección ${sectionNumber}, será regenerado.`);
      scriptText = '';
    }

    let needsGeneration = false;

    if (existingScriptPath && fs.existsSync(existingScriptPath)) {
      try {
        const rawContent = fs.readFileSync(existingScriptPath, 'utf8');
        const extractedContent = cleanScriptContent(rawContent);

        if (extractedContent && extractedContent.trim().length > 0 && isScriptContentValid(extractedContent)) {
          scriptText = extractedContent.trim();
          stats.reusedExisting.push(sectionNumber);
        } else if (scriptText.length > 0) {
          console.log(`🛠️ Reescribiendo guión vacío para sección ${sectionNumber} usando contenido en memoria.`);
          const newContent = buildScriptFileContent({
            topic,
            totalSections,
            sectionNumber,
            chapterTitle: chapterStructure[sectionNumber - 1],
            projectKey,
            scriptText
          });
          fs.writeFileSync(existingScriptPath, newContent, 'utf8');
          stats.restoredFromMemory.push(sectionNumber);
        } else {
          needsGeneration = true;
        }
      } catch (error) {
        console.warn(`⚠️ No se pudo leer guión existente de la sección ${sectionNumber}: ${error.message}`);
        needsGeneration = scriptText.length === 0;
      }
    } else if (scriptText.length > 0) {
      const newContent = buildScriptFileContent({
        topic,
        totalSections,
        sectionNumber,
        chapterTitle: chapterStructure[sectionNumber - 1],
        projectKey,
        scriptText
      });
      fs.writeFileSync(targetScriptPath, newContent, 'utf8');
      stats.restoredFromMemory.push(sectionNumber);
    } else {
      needsGeneration = true;
    }

    if (needsGeneration) {
      console.log(`📝 Guión faltante para sección ${sectionNumber}. Generando con IA...`);

      const previousSections = verifiedSections
        .filter((item) => item.section < sectionNumber)
        .map((item) => ({
          section: item.section,
          script: item.script
        }));

      const generation = await generateMissingScript(
        topic,
        sectionNumber,
        totalSections,
        chapterStructure[sectionNumber - 1] || null,
        previousSections,
        normalizedStyle,
        customStyleInstructions,
        wordsMin,
        wordsMax
      );

      if (!generation?.success || !generation.script) {
        throw new Error(`No se pudo generar el guión faltante de la sección ${sectionNumber}: ${generation?.error || 'Error desconocido'}`);
      }

      scriptText = generation.script.trim();
      if (!isScriptContentValid(scriptText)) {
        throw new Error(`El guión generado para la sección ${sectionNumber} no es válido (contiene mensaje de error)`);
      }
      const fileContent = buildScriptFileContent({
        topic,
        totalSections,
        sectionNumber,
        chapterTitle: chapterStructure[sectionNumber - 1],
        projectKey,
        scriptText
      });

      fs.writeFileSync(targetScriptPath, fileContent, 'utf8');
      stats.regenerated.push(sectionNumber);
    }

    const cleanedScript = cleanScriptText(scriptText);
    sectionData.script = scriptText;
    sectionData.cleanScript = cleanedScript;
    sectionData.scriptFile = path.relative('./public', targetScriptPath).replace(/\\/g, '/');

    verifiedSections.push({ section: sectionNumber, script: scriptText });
    stats.checked += 1;
  }

  console.log(`🔍 Verificación de guiones completada para ${projectKey}: ${stats.checked} secciones revisadas, ${stats.regenerated.length} regeneradas, ${stats.restoredFromMemory.length} restauradas.`);

  projectData.totalSections = totalSections;
  projectData.scriptStyle = normalizedStyle;
  projectData.customStyleInstructions = customStyleInstructions;
  projectData.wordsMin = wordsMin;
  projectData.wordsMax = wordsMax;

  return stats;
}

async function performBatchAudioGeneration(params = {}) {
  const {
    projectData,
    useApplio,
    voice,
    applioVoice,
    applioModel,
  applioPitch,
  applioSpeed,
    folderName,
    narrationStyle,
    scriptStyle,
    customStyleInstructions,
    wordsMin,
    wordsMax
  } = params;

  if (!projectData || !Array.isArray(projectData.sections) || !projectData.sections.length) {
    throw new Error('projectData inválido: se requieren secciones para generar audio');
  }

  const { sections, projectKey } = projectData;
  const audioMethod = useApplio ? 'Applio' : 'Google TTS';
  const requestedNarrationStyle = narrationStyle || projectData?.audioConfig?.narrationStyle || null;
  const baseTopic = projectData.sections[0]?.title?.split(':')[0] || projectData.topic || 'Proyecto';

  console.log(`🎤 Preparando generación de audio (${audioMethod}) para ${sections.length} secciones del proyecto ${projectKey}`);

  const normalizedWordsMin = Number.isFinite(Number(wordsMin)) ? Number(wordsMin) : Number.isFinite(Number(projectData?.wordsMin)) ? Number(projectData.wordsMin) : 800;
  const normalizedWordsMax = Number.isFinite(Number(wordsMax)) ? Number(wordsMax) : Number.isFinite(Number(projectData?.wordsMax)) ? Number(projectData.wordsMax) : 1100;
  const effectiveScriptStyle = scriptStyle || projectData?.scriptStyle || 'professional';
  const effectiveCustomStyleInstructions = typeof customStyleInstructions === 'string'
    ? customStyleInstructions
    : projectData?.customStyleInstructions || '';

  await ensureProjectScriptsReady({
    projectData,
    scriptStyle: effectiveScriptStyle,
    customStyleInstructions: effectiveCustomStyleInstructions,
    wordsMin: normalizedWordsMin,
    wordsMax: normalizedWordsMax
  });

  if (useApplio) {
    console.log('🔄 Verificando disponibilidad de Applio para la cola actual...');
    const applioStarted = await startApplio();
    if (!applioStarted) {
      throw new Error('No se pudo iniciar Applio');
    }
  }

  const audioResults = [];

  for (let i = 0; i < sections.length; i += 1) {
    const section = sections[i];
    console.log(`🎵 [${projectKey}] Generando audio ${i + 1}/${sections.length}: ${section.title}`);

    const sectionFolderStructure = createProjectStructure(baseTopic, section.section, folderName || projectData.projectKey || projectKey);

    try {
      let audioPath;

      // Verificar si ya existe un audio generado previamente para evitar duplicados
      if (section.audioPath) {
        const existingAudioPath = path.join('./public', section.audioPath);
        if (fs.existsSync(existingAudioPath)) {
          console.log(`⏭️ [${projectKey}] Audio ya existe para sección ${section.section}, saltando generación: ${section.audioPath}`);
          audioResults.push({
            section: section.section,
            title: section.title,
            audioPath: section.audioPath,
            success: true,
            skipped: true
          });
          
          // Actualizar progreso aunque se salte
          try {
            const progressData = updateProjectProgress(projectKey, 'audio', i + 1, sections.length);
          } catch (e) {
            // Ignorar error de progreso
          }
          
          continue;
        }
      }

      if (useApplio) {
        const selectedApplioVoice = applioVoice || 'es-ES-ElviraNeural.pth';
        const selectedApplioModel = applioModel || 'rmvpe';
  const selectedPitch = Number.isFinite(Number(applioPitch)) ? Number(applioPitch) : 0;
  const selectedSpeed = Number.isFinite(Number(applioSpeed)) ? Number(applioSpeed) : 0;

        // USAR projectKey PARA EL NOMBRE DEL ARCHIVO (CONSISTENCIA CON FRONTEND)
        const fileName = `${projectKey}_seccion_${section.section}_applio_${Date.now()}.wav`;
        const filePath = path.join(sectionFolderStructure.sectionDir, fileName);

        console.log(`📁 [${projectKey}] Guardando audio Applio en: ${filePath}`);
  console.log(`🚀 [${projectKey}] Velocidad Applio: ${selectedSpeed}`);
  console.log(`🎵 [${projectKey}] Pitch Applio: ${selectedPitch}`);

        const result = await applioClient.textToSpeech(section.cleanScript, filePath, {
          model: selectedApplioModel,
          speed: selectedSpeed,
          pitch: selectedPitch,
          voicePath: selectedApplioVoice
        });

        if (!result.success) {
          throw new Error('Applio no generó el audio correctamente');
        }

        audioPath = path.relative('./public', filePath).replace(/\\/g, '/');
        console.log(`✅ [${projectKey}] Audio Applio generado: ${audioPath}`);
      } else {
        try {
          // USAR projectKey COMO TOPIC PARA EL NOMBRE DEL ARCHIVO (CONSISTENCIA CON FRONTEND)
          audioPath = await generateStoryAudio(
            section.cleanScript,
            voice || DEFAULT_TTS_VOICE,
            sectionFolderStructure.sectionDir,
            projectKey, // Usar projectKey en lugar de section.title
            section.section,
            requestedNarrationStyle
          );
          console.log(`✅ [${projectKey}] Audio Google TTS generado: ${audioPath}`);
        } catch (ttsError) {
          console.log(`⚠️ [${projectKey}] Google TTS falló, usando Applio como fallback: ${ttsError.message}`);

          await applioClient.checkConnection();
          const audioResponse = await applioClient.generateTTS(
            section.cleanScript,
            applioVoice || 'RemyOriginal',
            applioModel || 'fr-FR-RemyMultilingualNeural',
            applioPitch || 0
          );

          if (!audioResponse.success || !audioResponse.audioPath) {
            throw new Error('Tanto Google TTS como Applio fallaron');
          }

          const sourceFile = audioResponse.audioPath;
          // USAR projectKey PARA EL NOMBRE DEL ARCHIVO (CONSISTENCIA CON FRONTEND)
          const fileName = `${projectKey}_seccion_${section.section}_applio_${Date.now()}.wav`;
          const filePath = path.join(sectionFolderStructure.sectionDir, fileName);

          fs.copyFileSync(sourceFile, filePath);
          audioPath = path.relative('./public', filePath).replace(/\\/g, '/');
          console.log(`✅ [${projectKey}] Audio Applio (fallback) generado: ${audioPath}`);
        }
      }

      audioResults.push({
        section: section.section,
        title: section.title,
        audioPath,
        success: true
      });

      try {
        const progressData = updateProjectProgress(projectKey, 'audio', i + 1, sections.length);
        const updatedProjectData = {
          ...projectData,
          audioResults,
          audioMethod,
          audioConfig: useApplio
            ? { voice: applioVoice, model: applioModel, pitch: applioPitch, speed: applioSpeed }
            : { voice, narrationStyle: requestedNarrationStyle },
          phase: 'audio',
          lastUpdate: new Date().toISOString()
        };

        await saveProgressiveProjectState(projectKey, updatedProjectData, progressData);
      } catch (progressError) {
        console.error('⚠️ Error guardando progreso de audio:', progressError.message);
      }
    } catch (error) {
      console.error(`❌ [${projectKey}] Error generando audio para sección ${section.section}:`, error);
      audioResults.push({
        section: section.section,
        title: section.title,
        audioPath: null,
        success: false,
        error: error.message
      });

      try {
        const progressData = updateProjectProgress(projectKey, 'audio', i + 1, sections.length);
        const updatedProjectData = {
          ...projectData,
          audioResults,
          audioMethod,
          audioConfig: useApplio
            ? { voice: applioVoice, model: applioModel, pitch: applioPitch, speed: applioSpeed }
            : { voice, narrationStyle: requestedNarrationStyle },
          phase: 'audio',
          lastUpdate: new Date().toISOString()
        };

        await saveProgressiveProjectState(projectKey, updatedProjectData, progressData);
      } catch (progressError) {
        console.error('⚠️ Error guardando progreso de audio (con error):', progressError.message);
      }
    }
  }

  const successfulAudio = audioResults.filter((r) => r.success).length;

  console.log(`🎵 [${projectKey}] Generación de audio completada (${successfulAudio}/${sections.length} con ${audioMethod})`);

  return {
    message: `Fase 2 completada: ${successfulAudio}/${sections.length} audios generados con ${audioMethod}`,
    audioResults,
    projectKey,
    audioMethod,
    successfulAudio,
    totalAudios: sections.length,
    phase: 'audio_completed'
  };
}

async function scheduleBatchAudioGeneration(params = {}) {
  const { useApplio, applioQueueRunId, applioQueueOrder, applioQueueLabel } = params;

  const shouldQueueApplio = Boolean(useApplio) && applioQueueRunId !== undefined && applioQueueRunId !== null && applioQueueOrder !== undefined && applioQueueOrder !== null;

  const task = () => performBatchAudioGeneration(params);

  if (shouldQueueApplio) {
    return enqueueApplioAudioTask({
      runId: applioQueueRunId,
      order: Number.parseInt(applioQueueOrder, 10),
      label: applioQueueLabel || params?.projectData?.projectKey || `orden_${applioQueueOrder}`,
      task
    });
  }

  return task();
}

function launchParallelBatchGenerationTask(entry, sharedConfig = {}) {
  const baseUrl = `http://127.0.0.1:${PORT}`;
  const totalSections = Number.parseInt(sharedConfig.totalSections, 10) || 3;
  const minWords = Number.parseInt(sharedConfig.minWords, 10) || 800;
  const maxWords = Number.parseInt(sharedConfig.maxWords, 10) || 1100;
  const imageCount = Number.parseInt(sharedConfig.imageCount, 10) || 5;
  const aspectRatio = typeof sharedConfig.aspectRatio === 'string' && sharedConfig.aspectRatio.trim()
    ? sharedConfig.aspectRatio.trim()
    : '16:9';
  const promptModifier = typeof sharedConfig.promptModifier === 'string' ? sharedConfig.promptModifier : '';
  const imageModel = normalizeImageModel(sharedConfig.imageModel);
  const imageModelLabel = getImageModelLabel(imageModel);
  const llmModel = sharedConfig.llmModel || 'gemini';
  const googleImages = Boolean(sharedConfig.googleImages);
  const localAIImages = Boolean(sharedConfig.localAIImages);
  const comfyOnlyMode = Boolean(sharedConfig.comfyOnlyMode);
  const allowComfyFallback = sharedConfig.allowComfyFallback !== undefined
    ? Boolean(sharedConfig.allowComfyFallback)
    : comfyOnlyMode;
  const skipImagesFlag = sharedConfig.skipImages === true;
  const effectiveSkipImages = skipImagesFlag || (!googleImages && !localAIImages);
  const selectedGoogleApis = Array.isArray(sharedConfig.selectedGoogleApis)
    ? sharedConfig.selectedGoogleApis
    : [];
  const applioQueueRunId = sharedConfig.applioQueueRunId || null;
  const applioQueueOffset = Number.parseInt(sharedConfig.applioQueueOffset ?? 0, 10);
  const queueOrder = Number.isFinite(applioQueueOffset) ? applioQueueOffset + entry.index : entry.index;

  const entryVoice = typeof entry.voice === 'string' ? entry.voice.trim() : '';
  const assignedVoice = sharedConfig?.voiceAssignments?.[entry.folderName];
  const fallbackVoice = sharedConfig.voice || sharedConfig.selectedVoice || 'Orus';
  const effectiveVoice = entryVoice || assignedVoice || fallbackVoice;

  const payload = {
    topic: entry.topic,
    folderName: entry.folderName,
    voice: effectiveVoice,
    totalSections,
    minWords,
    maxWords,
    imageCount,
    aspectRatio,
    promptModifier,
    imageModel,
    llmModel,
    skipImages: effectiveSkipImages,
    googleImages,
    localAIImages,
    comfyUISettings: sharedConfig.comfyUISettings || {},
    scriptStyle: sharedConfig.scriptStyle || 'default',
    customStyleInstructions: sharedConfig.customStyleInstructions || null,
    applioVoice: sharedConfig.applioVoice,
    applioModel: sharedConfig.applioModel,
    applioPitch: sharedConfig.applioPitch,
    applioSpeed: sharedConfig.applioSpeed,
    useApplio: Boolean(sharedConfig.generateApplioAudio || sharedConfig.useApplio)
  };

  const shouldGenerateGoogleAudio = Boolean(sharedConfig.generateAudio);
  const shouldGenerateApplioAudio = Boolean(sharedConfig.generateApplioAudio || sharedConfig.useApplio);
  const shouldGenerateAudio = shouldGenerateGoogleAudio || shouldGenerateApplioAudio;

  console.log(`🎙️ [${entry.folderName}] Voz seleccionada para proyecto paralelo: ${payload.voice}`);
  console.log(`🖼️ [${entry.folderName}] Modelo de imágenes seleccionado: ${imageModelLabel} (${imageModel})`);

  (async () => {
    try {
      console.log(`\n${'⚡'.repeat(20)}`);
      console.log(`⚡ Iniciando proyecto paralelo "${entry.topic}" (carpeta: ${entry.folderName})`);
      console.log(`${'⚡'.repeat(20)}\n`);

      const phase1Response = await fetch(`${baseUrl}/generate-batch-automatic`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const phase1Data = await phase1Response.json();
      if (!phase1Response.ok || !phase1Data?.success) {
        throw new Error(phase1Data?.error || 'Fase 1 falló');
      }

      const projectData = phase1Data.data;

      if (shouldGenerateAudio) {
        const audioPayload = {
          projectData,
          useApplio: shouldGenerateApplioAudio,
          voice: payload.voice,
          narrationStyle: sharedConfig.narrationStyle || null,
          applioVoice: sharedConfig.applioVoice,
          applioModel: sharedConfig.applioModel,
          applioPitch: sharedConfig.applioPitch,
          applioSpeed: sharedConfig.applioSpeed,
          folderName: projectData.projectKey,
          applioQueueRunId: shouldGenerateApplioAudio ? applioQueueRunId : null,
          applioQueueOrder: shouldGenerateApplioAudio ? queueOrder : null,
          applioQueueLabel: `${entry.topic} (${entry.folderName})`,
          scriptStyle: sharedConfig.scriptStyle || projectData.scriptStyle || 'professional',
          customStyleInstructions: sharedConfig.customStyleInstructions || projectData.customStyleInstructions || '',
          wordsMin: minWords,
          wordsMax: maxWords
        };

        try {
          const audioResult = await scheduleBatchAudioGeneration(audioPayload);
          console.log(`🎵 Proyecto paralelo ${entry.folderName}: ${audioResult.message}`);
        } catch (audioError) {
          throw new Error(audioError?.message || 'Fase 2 falló');
        }
      }

      if (!effectiveSkipImages) {
        const imagePayload = {
          folderName: projectData.projectKey,
          imageInstructions: sharedConfig.imageInstructions || sharedConfig.promptModifier || '',
          imageCount,
          aspectRatio,
          useLocalAI: localAIImages,
          comfyUIConfig: sharedConfig.comfyUISettings || {},
          allowComfyFallback,
          comfyOnlyMode,
          selectedApis: comfyOnlyMode ? [] : selectedGoogleApis,
          imageModel
        };

        const imageResponse = await fetch(`${baseUrl}/api/generate-missing-images`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(imagePayload)
        });

        const imageData = await imageResponse.json();
        if (!imageResponse.ok || !imageData?.success) {
          throw new Error(imageData?.error || 'Fase 3 falló');
        }
      }

      console.log(`✅ Proyecto paralelo completado: ${entry.folderName}`);
    } catch (error) {
      console.error(`❌ Error en proyecto paralelo "${entry.folderName}":`, error);
    }
  })();
}

app.post('/generate-batch-automatic/multi', async (req, res) => {
  try {
    const { projects, sharedConfig = {} } = req.body || {};

    if (!Array.isArray(projects) || !projects.length) {
      return res.status(400).json({ success: false, error: 'Debes enviar al menos un proyecto para procesar.' });
    }

    const normalizedProjects = normalizeMultiProjectEntries(projects);

    if (!normalizedProjects.length) {
      return res.status(400).json({ success: false, error: 'No se encontraron proyectos válidos para procesar.' });
    }

    normalizedProjects.forEach((entry) => {
      launchParallelBatchGenerationTask(entry, sharedConfig);
    });

    const responseProjects = normalizedProjects.map((entry) => ({
      folderName: entry.folderName,
      projectKey: entry.projectKey,
      topic: entry.topic,
      index: entry.index,
      voice: entry.voice || sharedConfig?.voiceAssignments?.[entry.folderName] || sharedConfig?.voice || null
    }));

    res.json({
      success: true,
      message: `Se iniciaron ${responseProjects.length} proyecto(s) en paralelo.`,
      projects: responseProjects
    });
  } catch (error) {
    console.error('❌ Error iniciando generación paralela:', error);
    res.status(500).json({ success: false, error: error.message || 'Error iniciando generación paralela' });
  }
});

// NUEVO ENDPOINT PARA GENERACIÓN AUTOMÁTICA POR LOTES
app.post('/generate-batch-automatic', async (req, res) => {
  try {
  const { topic, folderName, voice, totalSections, minWords, maxWords, imageCount, aspectRatio, promptModifier, imageModel, llmModel, skipImages, googleImages, localAIImages, geminiGeneratedImages, comfyUISettings, scriptStyle, customStyleInstructions, applioVoice, applioModel, applioPitch, applioSpeed, useApplio } = req.body;
    
    console.log('\n' + '='.repeat(80));
    console.log('🚀 INICIANDO GENERACIÓN AUTOMÁTICA POR LOTES');
    console.log('='.repeat(80));
    console.log(`🎯 Tema: "${topic}"`);
    console.log(`📊 Total de secciones: ${totalSections}`);
    console.log(`🎤 Sistema de audio: ${useApplio ? 'Applio' : 'Google TTS'}`);
    const selectedImageModel = normalizeImageModel(imageModel);
    const selectedImageModelLabel = getImageModelLabel(selectedImageModel);
    console.log(`🖼️ Sistema de imágenes: ${localAIImages ? 'IA Local (ComfyUI)' : googleImages ? 'Google Images' : skipImages ? 'Sin imágenes' : `IA en la nube (${selectedImageModelLabel})`}`);
    console.log('='.repeat(80) + '\n');
    
    const selectedVoice = voice || 'Orus';
    const sections = totalSections || 3;
    const selectedStyle = scriptStyle || 'professional';
    const numImages = imageCount || 5;
    const wordsMin = minWords || 800;
    const wordsMax = maxWords || 1100;
  const additionalInstructions = promptModifier || '';
  const selectedLlmModel = llmModel || GEMINI_TEXT_MODEL;
    let shouldSkipImages = skipImages === true;
    let shouldUseGoogleImages = googleImages === true;
    let shouldUseLocalAI = localAIImages === true;
    
    if (!topic) {
      return res.status(400).json({ error: 'Tema requerido' });
    }

    const allSections = [];
    const allImagePrompts = [];
    
    // Crear clave única para la conversación primero
    // Si hay folderName personalizado, usarlo; sino usar el topic
    const baseNameForKey = folderName && folderName.trim() 
      ? folderName.trim() 
      : topic;
    const projectKey = createSafeFolderName(baseNameForKey);
    console.log(`🔑 PROJECT KEY GENERADO: "${projectKey}" (de: "${baseNameForKey}")`);

    // Función interna para procesar audio asíncronamente
    const processSectionAudioAsync = async (
      section,
      scriptText,
      topic,
      projectKey,
      chapterStructure,
      useApplio,
      applioVoice,
      applioModel,
      applioPitch,
      applioSpeed,
      selectedVoice,
      selectedStyle,
      totalSections
    ) => {
      try {
        console.log(`🎵 [PARALELO] Iniciando generación de audio para sección ${section}...`);
        const sectionFolderStructure = createProjectStructure(topic, section, projectKey);
        const cleanScript = scriptText.replace(/[*_#]/g, '').trim();
        let generatedAudioPath = null;
        
        const startTime = Date.now();

        if (useApplio) {
          const selectedApplioVoice = applioVoice || 'es-ES-ElviraNeural.pth';
          const selectedApplioModel = applioModel || 'rmvpe';
          const selectedPitch = Number.isFinite(Number(applioPitch)) ? Number(applioPitch) : 0;
          const selectedSpeed = Number.isFinite(Number(applioSpeed)) ? Number(applioSpeed) : 0;

          // USAR projectKey PARA EL NOMBRE DEL ARCHIVO (CONSISTENCIA CON FRONTEND)
          const fileName = `${projectKey}_seccion_${section}_applio_${Date.now()}.wav`;
          const filePath = path.join(sectionFolderStructure.sectionDir, fileName);

          // Asegurar conexión
          const isConnected = await applioClient.checkConnection();
          if (!isConnected) {
            console.warn('⚠️ Applio no responde al check de conexión, intentando generar de todas formas...');
          }
          
          const result = await applioClient.textToSpeech(cleanScript, filePath, {
            voice: selectedApplioVoice,
            model: selectedApplioModel,
            pitch: selectedPitch,
            speed: selectedSpeed
          });
          
          if (result.success) {
            generatedAudioPath = path.relative('./public', filePath).replace(/\\/g, '/');
            console.log(`✅ [PARALELO] Audio Applio generado para sección ${section}: ${generatedAudioPath}`);
          } else {
            console.error(`❌ [PARALELO] Falló generación Applio sección ${section}:`, result.error);
          }
        } else {
          // Google TTS
          // USAR projectKey PARA EL NOMBRE DEL ARCHIVO (CONSISTENCIA CON FRONTEND)
          const fileName = `${projectKey}_seccion_${section}_${Date.now()}.mp3`;
          const filePath = path.join(sectionFolderStructure.sectionDir, fileName);
          
          generatedAudioPath = await generateStoryAudio(
            cleanScript,
            selectedVoice,
            sectionFolderStructure.sectionDir,
            chapterStructure[section - 1] || `Sección ${section}`,
            section,
            selectedStyle
          );
          console.log(`✅ [PARALELO] Audio Google TTS generado para sección ${section}: ${generatedAudioPath}`);
        }

        if (generatedAudioPath) {
          // Actualizar estado del proyecto en disco
          updateSectionAudioInState(projectKey, section, generatedAudioPath);
          
          // Actualizar tracker de progreso en memoria
          const duration = Date.now() - startTime;
          
          if (projectProgressTracker[projectKey]) {
             projectProgressTracker[projectKey].phases.audio.completed++;
             updateProjectProgress(projectKey, 'audio', projectProgressTracker[projectKey].phases.audio.completed, totalSections, 'audio', duration);
          } else {
             updateProjectProgress(projectKey, 'audio', 1, totalSections, 'audio', duration);
          }
        }

      } catch (error) {
        console.error(`❌ [PARALELO] Error generando audio para sección ${section}:`, error);
      }
    };

    // Crear estructura de carpetas usando el mismo projectKey
    const folderStructure = createProjectStructure(topic, 1, projectKey);
    console.log(`📁 Estructura de proyecto creada: ${folderStructure.projectDir}`);

    // =======================================================================
    // FASE 1: GENERAR TODOS LOS GUIONES + PROMPTS DE IMÁGENES
    // =======================================================================
    console.log('\n' + '📝'.repeat(20));
    console.log('📝 FASE 1: GENERANDO TODOS LOS GUIONES Y PROMPTS');
    console.log('📝'.repeat(20));
    
    const conversation = getOrCreateConversation(projectKey);
    conversation.topic = topic;
    conversation.totalSections = sections;
    conversation.history = [];
    
    // Generar estructura de capítulos primero
    console.log(`📋 Generando estructura de ${sections} capítulos...`);
    
    // Inicializar Applio si se va a usar para audio inmediato
    if (useApplio) {
      console.log('🔄 Iniciando Applio para generación de audio en tiempo real...');
      try {
        const applioStarted = await startApplio();
        if (!applioStarted) {
          console.warn('⚠️ No se pudo iniciar Applio, se intentará durante la generación');
        } else {
          console.log('✅ Applio iniciado correctamente');
        }
      } catch (applioError) {
        console.error('❌ Error iniciando Applio:', applioError);
      }
    }
    
    let chapterPrompt;
    if (selectedStyle && selectedStyle.startsWith('custom_') && customStyleInstructions) {
      chapterPrompt = `Eres un experto en crear estructuras narrativas personalizadas.

TEMA SOLICITADO: "${topic}"
TOTAL DE CAPÍTULOS: ${sections}
ESTILO PERSONALIZADO: ${customStyleInstructions}

Tu tarea es crear una ESTRUCTURA NARRATIVA que respete completamente el estilo personalizado definido.

INSTRUCCIONES ESPECÍFICAS PARA ESTE ESTILO:
- Analiza cuidadosamente las instrucciones del estilo personalizado
- Crea títulos que reflejen EXACTAMENTE lo que pide el estilo
- Si el estilo menciona "situaciones cotidianas", crea capítulos sobre actividades diarias del personaje
- Si el estilo habla de "progresión del día", organiza los capítulos cronológicamente  
- Si pide "técnicas de hipnotización", enfócate en momentos relajantes del personaje
- IGNORA formatos educativos genéricos, sigue SOLO el estilo personalizado

PARA "${topic}" CON ESTE ESTILO ESPECÍFICO:
Genera títulos que narren momentos, actividades y situaciones del personaje, no información educativa sobre la serie.

FORMATO DE RESPUESTA OBLIGATORIO:
Debes responder ÚNICAMENTE con los títulos separados por "||CAPITULO||"

VERIFICACIÓN: Tu respuesta debe tener exactamente ${sections - 1} delimitadores "||CAPITULO||" para generar ${sections} títulos.

RESPONDE SOLO CON LOS TÍTULOS SEPARADOS POR "||CAPITULO||", NADA MÁS.`;
    } else {
      chapterPrompt = `Eres un experto en narrativa para YouTube especializado en contenido educativo y entretenimiento.

TEMA SOLICITADO: "${topic}"
TOTAL DE CAPÍTULOS: ${sections}

Tu tarea es crear una ESTRUCTURA NARRATIVA completa dividiendo el tema en ${sections} capítulos/secciones coherentes y bien organizadas.

INSTRUCCIONES:
- Crea EXACTAMENTE ${sections} títulos de capítulos
- Cada capítulo debe tener un título descriptivo y atractivo
- Los capítulos deben seguir un hilo narrativo lógico
- Progresión natural del tema de inicio a conclusión
- Títulos que generen curiosidad y mantengan el interés

FORMATO DE RESPUESTA OBLIGATORIO:
Debes responder ÚNICAMENTE con los títulos separados por "||CAPITULO||"

EJEMPLO PARA 3 CAPÍTULOS:
Capítulo 1: El Origen de la Leyenda||CAPITULO||Capítulo 2: Los Secretos Revelados||CAPITULO||Capítulo 3: El Legado Eterno

VERIFICACIÓN: Tu respuesta debe tener exactamente ${sections - 1} delimitadores "||CAPITULO||" para generar ${sections} títulos.

RESPONDE SOLO CON LOS TÍTULOS SEPARADOS POR "||CAPITULO||", NADA MÁS.`;
    }
    
    let chapterStructure = [];
    try {
      const chapterResponse = await generateUniversalContent(
        selectedLlmModel,
        chapterPrompt,
        "Eres un experto en estructura narrativa. Tu ÚNICA tarea es crear títulos de capítulos separados por '||CAPITULO||'. NUNCA generes texto adicional fuera de los títulos."
      );

      const chaptersText = chapterResponse || '';
      chapterStructure = chaptersText.split('||CAPITULO||').filter(title => title.trim()).slice(0, sections);
      
      console.log('📖 ESTRUCTURA DE CAPÍTULOS GENERADA:');
      chapterStructure.forEach((title, index) => {
        console.log(`📚 Capítulo ${index + 1}: ${title.trim()}`);
      });
      
      conversation.chapterStructure = chapterStructure;
    } catch (error) {
      console.error('❌ Error generando estructura de capítulos:', error);
      chapterStructure = [];
    }
    
    // Generar todos los guiones
    console.log(`\n📝 Generando guiones para ${sections} secciones...`);
    
    for (let section = 1; section <= sections; section++) {
      console.log(`📝 Generando guión de la sección ${section}/${sections}...`);
      
      try {
        const promptContent = generateScriptPrompt(selectedStyle, topic, sections, section, customStyleInstructions, chapterStructure, section === 1 ? null : allSections, wordsMin, wordsMax);
        
        if (section === 1) {
          conversation.history = [{ role: 'user', parts: [{ text: promptContent }] }];
        } else {
          conversation.history.push({ role: 'user', parts: [{ text: promptContent }] });
        }
        
        const scriptResponse = await generateUniversalContent(
          selectedLlmModel,
          conversation.history,  // Pasar el historial completo como segundo parámetro
          null  // No system instruction adicional
        );
        
        console.log(`🔍 DEBUG: scriptResponse tipo:`, typeof scriptResponse);
        console.log(`🔍 DEBUG: scriptResponse contenido:`, scriptResponse);
        console.log(`🔍 DEBUG: scriptResponse longitud:`, scriptResponse ? scriptResponse.length : 'NULL');
        
        const scriptText = scriptResponse || '';
        conversation.history.push({ role: 'model', parts: [{ text: scriptText }] });
        
        allSections.push({
          section: section,
          title: chapterStructure[section - 1] || `Sección ${section}`,
          script: scriptText,
          cleanScript: scriptText.replace(/[*_#]/g, '').trim()
        });
        
        console.log(`✅ Guión ${section} generado (${scriptText.length} caracteres)`);
        
        // Guardar el guión en archivo TXT
        try {
          const sectionFolderStructure = createProjectStructure(topic, section, projectKey);
          const scriptFileName = `${projectKey}_seccion_${section}_guion.txt`;
          const scriptFilePath = path.join(sectionFolderStructure.sectionDir, scriptFileName);
          
          const scriptContent = `GUIÓN DE SECCIÓN ${section}
===============================
Tema: ${topic ? topic.split(/\s+/).slice(0, 10).join(' ') + (topic.split(/\s+/).length > 10 ? '...' : '') : ''}
Sección: ${section} de ${sections}
Capítulo: ${chapterStructure[section - 1] || `Sección ${section}`}
Longitud: ${scriptText.length} caracteres
Fecha de generación: ${new Date().toLocaleString()}
${folderName ? `Nombre del proyecto: ${folderName}` : ''}

CONTENIDO DEL GUIÓN:
${scriptText}

===============================
Guión generado automáticamente por IA
`;
          
          fs.writeFileSync(scriptFilePath, scriptContent, 'utf8');
          console.log(`💾 Guión guardado: ${scriptFilePath}`);
          
        } catch (saveError) {
          console.error(`❌ Error guardando guión de sección ${section}:`, saveError);
        }
        
        // Generar prompts de imágenes para esta sección
        if (!shouldSkipImages) {
          console.log(`🎨 Generando prompts de imágenes para sección ${section}...`);
          
          if (shouldUseGoogleImages) {
            // Para Google Images (Bing): generar keywords de búsqueda simples
            console.log(`🔍 Generando keywords de búsqueda para Google Images/Bing...`);
            
            const keywordsPrompt = `Basándote en este guión de la sección ${section} sobre "${topic}": "${scriptText}", 
            
extrae EXACTAMENTE ${numImages} keywords o frases cortas de búsqueda para encontrar imágenes relacionadas con esta sección.

IMPORTANTE:
- Cada keyword debe ser de 1-4 palabras máximo
- Deben ser términos que se puedan buscar en Google Images
- Enfócate en elementos visuales específicos mencionados en esta sección
- DEBES separar cada keyword con "||PROMPT||" (sin espacios adicionales)
- NO incluyas descripciones largas, solo keywords de búsqueda

EJEMPLO de respuesta:
castillo medieval||PROMPT||espada dorada||PROMPT||batalla épica||PROMPT||dragón volando||PROMPT||héroe guerrero

FORMATO DE RESPUESTA OBLIGATORIO:
keyword1||PROMPT||keyword2||PROMPT||keyword3||PROMPT||... hasta keyword${numImages}`;

            const keywordsResponse = await generateUniversalContent(
              selectedLlmModel,
              keywordsPrompt,
              `Eres un experto en SEO y búsqueda de imágenes. Tu ÚNICA tarea es extraer keywords simples separados por "||PROMPT||". NO generes descripciones largas.`
            );
            
            const keywordsText = keywordsResponse || '';
            const sectionImagePrompts = keywordsText.split('||PROMPT||').filter(p => p.trim()).slice(0, numImages);
            
            allImagePrompts.push({
              section: section,
              prompts: sectionImagePrompts
            });
            
            console.log(`✅ ${sectionImagePrompts.length} keywords de búsqueda generados para sección ${section}`);
            
          } else {
            // Para IA generativa: generar prompts descriptivos detallados
            console.log(`🎨 Generando prompts descriptivos para IA generativa...`);
            
            // Obtener prompts anteriores para mantener consistencia
            console.log(`🧠 Recuperando contexto de prompts anteriores...`);
            const { previousPrompts, contextInfo } = getPreviousImagePrompts(projectKey, section);
            
            // Construir contexto de consistencia
            const consistencyContext = buildConsistencyContext(previousPrompts, contextInfo);
          
          // Construir prompt base para el LLM
          let basePrompt = `Basándote en este guión de la sección ${section} sobre "${topic}": "${scriptText}", crea EXACTAMENTE ${numImages} prompts detallados para generar ${numImages} imágenes que ilustren visualmente el contenido ESPECÍFICO de esta sección.

IMPORTANTE: Debes crear EXACTAMENTE ${numImages} prompts, ni más ni menos.

ENFOQUE ESPECÍFICO PARA ESTA SECCIÓN:
- Estas imágenes deben representar SOLO el contenido de la sección ${section}, no de todo el proyecto
- Cada imagen debe mostrar diferentes aspectos, momentos o elementos clave mencionados en esta sección específica
- NO dividas la sección en partes cronológicas - en su lugar, crea ${numImages} perspectivas diferentes del mismo contenido de la sección
- Enfócate en elementos específicos, personajes, lugares, objetos, emociones o conceptos mencionados en esta sección
- Mantén consistencia visual con las secciones anteriores${consistencyContext}

TIPOS DE PROMPTS PARA ESTA SECCIÓN:
- Imagen principal: La escena o momento central de la sección
- Detalles importantes: Objetos, elementos o características específicas mencionadas
- Perspectivas diferentes: Diferentes ángulos o enfoques del mismo contenido
- Atmósfera: Imágenes que capturen el mood o ambiente de la sección
- Elementos secundarios: Aspectos adicionales que complementen la narrativa de esta sección

INSTRUCCIONES CRÍTICAS PARA EL FORMATO:
- DEBES crear ${numImages} prompts independientes que representen la MISMA sección desde diferentes perspectivas
- NO dividas el contenido en secuencia cronológica - todas las imágenes son de la MISMA sección
- DEBES separar cada prompt con "||PROMPT||" (sin espacios adicionales)
- DEBES asegurarte de que haya exactamente ${numImages} prompts en tu respuesta
- Todas las imágenes deben estar relacionadas con el contenido específico de la sección ${section}
- Incluye detalles específicos mencionados en el texto del guión de esta sección

REQUISITOS OBLIGATORIOS para cada prompt:
- Formato: Aspecto 16:9 (widescreen)
- Estilo: Realista, alta calidad, 4K

FORMATO DE RESPUESTA OBLIGATORIO:
DEBES presentar EXACTAMENTE ${numImages} prompts separados por "||PROMPT||" (sin espacios antes o después del delimitador).

ESTRUCTURA REQUERIDA:
Prompt 1 aquí||PROMPT||Prompt 2 aquí||PROMPT||Prompt 3 aquí||PROMPT||... hasta el Prompt ${numImages}

VERIFICACIÓN FINAL: Tu respuesta debe contener exactamente ${numImages - 1} ocurrencias del delimitador "||PROMPT||" para generar ${numImages} prompts.`;
            
            // Integrar instrucciones adicionales en el prompt del LLM
            const finalPromptForLLM = integrateAdditionalInstructions(basePrompt, additionalInstructions);
            
            console.log(`🧠 Creando prompts para secuencia de ${numImages} imágenes con contexto de consistencia...`);
            if (previousPrompts.length > 0) {
              console.log(`🔗 Usando ${previousPrompts.length} prompts anteriores para mantener consistencia`);
            }
            if (additionalInstructions && additionalInstructions.trim()) {
              console.log(`📝 Integrando instrucciones adicionales en el LLM: "${additionalInstructions.trim()}"`);
            }
            
            const imagePromptsResponse = await generateUniversalContent(
              selectedLlmModel,
              finalPromptForLLM,
              `Eres un experto en arte conceptual y narrativa visual. Tu ÚNICA tarea es crear prompts separados por "||PROMPT||".`
            );
            
            const promptsText = imagePromptsResponse || '';
            const sectionImagePrompts = promptsText.split('||PROMPT||').filter(p => p.trim()).slice(0, numImages);
            
            allImagePrompts.push({
              section: section,
              prompts: sectionImagePrompts
            });
            
            console.log(`✅ ${sectionImagePrompts.length} keywords de búsqueda generados para sección ${section}`);
          }
        }

        // ===============================================================
        // GENERACIÓN DE AUDIO EN PARALELO (ASÍNCRONO) - DESACTIVADO
        // ===============================================================
        // Se ha movido a la FASE 2 para que inicie después de terminar todos los guiones
        // (Código eliminado para asegurar que no se ejecute)
        
        let audioPath = null; // Inicialmente null porque es asíncrono
        
        // ===============================================================
        // GUARDADO PROGRESIVO Y ACTUALIZACIÓN DE PROGRESO
        // ===============================================================
        
        console.log(`📊 ACTUALIZANDO PROGRESO: Sección ${section}/${sections} completada`);
        
        // Calcular tiempo de generación de esta sección
        const sectionStartTime = Date.now() - 30000; // Estimación aproximada
        const sectionEndTime = Date.now();
        const sectionDuration = sectionEndTime - sectionStartTime;
        
        // Actualizar progreso de la Fase 1 (Scripts)
        const progressData = updateProjectProgress(
          projectKey, 
          'script', 
          section,      // completedItems (actual)
          sections,     // totalItems 
          'sección', 
          sectionDuration
        );
        
        // Preparar datos del proyecto para guardado progresivo
        const projectDataForSave = {
          topic: topic,
          folderName: folderName,
          totalSections: sections,
          voice: selectedVoice,
          imageModel: selectedImageModel,
          llmModel: selectedLlmModel,
          scriptStyle: selectedStyle,
          customStyleInstructions: customStyleInstructions,
          promptModifier: additionalInstructions,
          imageCount: numImages,
          skipImages: shouldSkipImages,
          googleImages: shouldUseGoogleImages,
          localAIImages: shouldUseLocalAI,
          useApplio: useApplio || false,
          applioVoice: applioVoice,
          applioModel: applioModel,
          applioPitch: applioPitch,
          applioSpeed: applioSpeed,
          chapterStructure: chapterStructure,
          createdAt: new Date().toISOString()
        };
        
        // Crear información de la sección completada
        const completedSectionData = {
          section: section,
          title: chapterStructure[section - 1] || `Sección ${section}`,
          script: allSections[section - 1].script,
          imagePrompts: allImagePrompts.find(ip => ip.section === section)?.prompts || [],
          completedAt: new Date().toISOString(),
          audio: audioPath ? {
            path: audioPath,
            filename: path.basename(audioPath),
            saved: true
          } : null,
          scriptFile: {
            path: `outputs/${projectKey}/seccion_${section}/${projectKey}_seccion_${section}_guion.txt`,
            filename: `${projectKey}_seccion_${section}_guion.txt`,
            saved: true
          },
          promptsFile: shouldSkipImages ? null : {
            path: `outputs/${projectKey}/seccion_${section}/${projectKey}_seccion_${section}_prompts_imagenes.txt`,
            filename: `${projectKey}_seccion_${section}_prompts_imagenes.txt`,
            saved: true
          }
        };
        
        // Guardar estado progresivo
        const currentCompletedSections = allSections.map((sec, index) => {
          const sectionData = {
            section: sec.section,
            title: sec.title,
            script: sec.script,
            imagePrompts: allImagePrompts.find(ip => ip.section === sec.section)?.prompts || [],
            completedAt: new Date().toISOString(),
            audio: sec.audioPath ? {
              path: sec.audioPath,
              filename: path.basename(sec.audioPath),
              saved: true
            } : null,
            scriptFile: {
              path: `outputs/${projectKey}/seccion_${sec.section}/${projectKey}_seccion_${sec.section}_guion.txt`,
              filename: `${projectKey}_seccion_${sec.section}_guion.txt`,
              saved: true
            },
            promptsFile: shouldSkipImages ? null : {
              path: `outputs/${projectKey}/seccion_${sec.section}/${projectKey}_seccion_${sec.section}_prompts_imagenes.txt`,
              filename: `${projectKey}_seccion_${sec.section}_prompts_imagenes.txt`,
              saved: true
            }
          };
          return sectionData;
        });
        
        saveProgressiveProjectState(projectKey, projectDataForSave, currentCompletedSections, [], []);
        
      } catch (error) {
        console.error(`❌ Error generando sección ${section}:`, error);
        allSections.push({
          section: section,
          title: `Sección ${section}`,
          script: `Error generando contenido: ${error.message}`,
          cleanScript: `Error generando contenido: ${error.message}`
        });
      }
    }
    
    console.log(`\n✅ FASE 1 COMPLETADA:`);
    console.log(`📝 ${allSections.length} guiones generados`);

    // =======================================================================
    // GENERAR ARCHIVO DE GUIÓN COMBINADO (TODO UNIDO)
    // =======================================================================
    try {
        console.log(`📑 Generando archivo de guión combinado...`);
        const fullScriptPath = path.join(globalOutputDir, projectKey, `${projectKey}_guion_completo.txt`);
        
        // Unir todos los guiones limpios separados por saltos de línea dobles
        // Usamos 'script' original pero quitamos markdown básico para que quede lo más limpio posible si se desea, 
        // o usamos 'cleanScript' que ya tiene un replace hecho. El usuario pidió "unicamente el guion".
        const fullScriptContent = allSections
            .sort((a, b) => a.section - b.section) // Asegurar orden correcto
            .map(s => s.cleanScript)
            .join('\n\n');

        fs.writeFileSync(fullScriptPath, fullScriptContent, 'utf8');
        console.log(`✅ Guión completo guardado en: ${fullScriptPath}`);
    } catch (combineError) {
        console.error("❌ Error generando guión combinado:", combineError);
    }

    console.log(`🎨 ${allImagePrompts.length} sets de prompts de imágenes generados`);

    // =======================================================================
    // FASE 2: GENERAR AUDIOS (SECUENCIAL EN BACKGROUND) - DESACTIVADO
    // =======================================================================
    // Se desactiva para evitar doble generación, ya que el frontend (script.js)
    // se encarga de orquestar la generación de audio secuencialmente.
    // (Código eliminado para asegurar que no se ejecute)
    
    res.json({
      success: true,
      phase: 'scripts_completed',
      message: `Fase 1 completada: ${allSections.length} guiones y prompts generados`,
      data: {
        sections: allSections,
        imagePrompts: allImagePrompts,
        chapterStructure: chapterStructure,
        projectKey: projectKey,
        additionalInstructions: additionalInstructions, // Pasar las instrucciones adicionales
        topic: topic,
        folderName: folderName
      }
    });
    
  } catch (error) {
    console.error('❌ Error en generación automática por lotes:', error);
    res.status(500).json({ error: 'Error en generación automática: ' + error.message });
  }
});

// ENDPOINT PARA CONTINUAR CON FASE 2: GENERACIÓN DE AUDIO POR LOTES
app.post('/generate-batch-audio', async (req, res) => {
  try {
    console.log('\n' + '🎵'.repeat(20));
    console.log('🎵 FASE 2: GENERANDO TODOS LOS ARCHIVOS DE AUDIO');
    console.log('🎵'.repeat(20));

    const result = await scheduleBatchAudioGeneration(req.body || {});

    res.json({
      success: true,
      phase: result.phase,
      message: result.message,
      data: {
        audioResults: result.audioResults,
        projectKey: result.projectKey,
        audioMethod: result.audioMethod
      }
    });
  } catch (error) {
    console.error('❌ Error en generación de audio por lotes:', error);
    res.status(500).json({ error: 'Error en generación de audio: ' + error.message });
  }
});

// ENDPOINT PARA GENERAR SOLO AUDIOS FALTANTES CON APPLIO
app.post('/generate-missing-applio-audios', async (req, res) => {
  try {
    const { folderName, applioVoice, applioModel, applioPitch, applioSpeed, totalSections, scriptStyle = 'professional', customStyleInstructions = '', wordsMin = 800, wordsMax = 1100 } = req.body;
    
    console.log('\n' + '🔍'.repeat(20));
    console.log('🔍 VERIFICANDO Y GENERANDO AUDIOS FALTANTES CON APPLIO');
    console.log('🔍'.repeat(20));
    
    console.log('🎤 Configuración de generación:', {
      proyecto: folderName,
      voz: applioVoice,
      modelo: applioModel,
      pitch: applioPitch,
      speed: applioSpeed,
      secciones: totalSections
    });
    
    // Verificar que el proyecto existe
    const projectState = loadProjectState(folderName);
    if (!projectState) {
      return res.status(404).json({ error: 'Proyecto no encontrado' });
    }
    
    // Verificar qué audios faltan
    const missingAudioSections = [];
    const projectDir = path.join(globalOutputDir, folderName);
    
    for (let i = 0; i < projectState.completedSections.length; i++) {
      const section = projectState.completedSections[i];
      const sectionDir = path.join(projectDir, `seccion_${section.section}`);
      
      // Verificar si la carpeta de la sección existe
      if (!fs.existsSync(sectionDir)) {
        console.log(`📁 Creando carpeta faltante para sección ${section.section}: ${sectionDir}`);
        fs.mkdirSync(sectionDir, { recursive: true });
      }
      
      // Buscar archivos de audio en la carpeta de la sección
      let hasApplioAudio = false;
      
      if (fs.existsSync(sectionDir)) {
        const files = fs.readdirSync(sectionDir);
        const audioFiles = files.filter(file => 
          file.endsWith('.wav') || 
          file.endsWith('.mp3') || 
          file.endsWith('.m4a') ||
          file.endsWith('.ogg')
        );

        const applioAudioFiles = audioFiles.filter(file => file.includes('_applio'));
        const otherAudioFiles = audioFiles.filter(file => !file.includes('_applio'));
        
        hasApplioAudio = applioAudioFiles.length > 0;
        
        if (hasApplioAudio) {
          console.log(`✅ Sección ${section.section} ya tiene audio Applio: ${applioAudioFiles.join(', ')}`);
        } else if (otherAudioFiles.length > 0) {
          console.log(`ℹ️ Sección ${section.section} tiene audio de otro origen (${otherAudioFiles.join(', ')}), pero falta la versión Applio`);
        }
      }
      
      if (!hasApplioAudio) {
        console.log(`🎵 Sección ${section.section} necesita audio Applio`);
        missingAudioSections.push(section);
      }
    }
    
    console.log(`📊 Análisis completo: ${missingAudioSections.length}/${projectState.completedSections.length} secciones necesitan audio`);
    
    if (missingAudioSections.length === 0) {
      return res.json({
        success: true,
        message: 'Todos los audios ya existen, no se generó ninguno nuevo',
        data: {
          generatedCount: 0,
          totalSections: projectState.completedSections.length,
          skippedSections: projectState.completedSections.length,
          missingAudioSections: []
        }
      });
    }
    
    // Inicializar Applio solo si hay audios que generar
    console.log('🔄 Iniciando Applio para generación de audios faltantes...');
    const applioStarted = await startApplio();
    if (!applioStarted) {
      throw new Error('No se pudo iniciar Applio');
    }
    
    const generationResults = [];
    
    // Generar audio solo para las secciones que lo necesitan
    for (let i = 0; i < missingAudioSections.length; i++) {
      const section = missingAudioSections[i];
      console.log(`🎵 Generando audio faltante ${i + 1}/${missingAudioSections.length}: Sección ${section.section}`);
      
      try {
        // Obtener el directorio de la sección
        const sectionDir = path.join(projectDir, `seccion_${section.section}`);
        
        // Crear nombre de archivo único
        const fileName = `${folderName}_seccion_${section.section}_applio_${Date.now()}.wav`;
        const filePath = path.join(sectionDir, fileName);
        
        console.log(`📁 Generando audio en: ${filePath}`);
        console.log(`📝 Script completo: ${section.script.substring(0, 100)}...`);
        
        // Extraer solo el contenido del guión sin metadatos
        const scriptResult = extractScriptContent(section.script);
        let cleanScript = scriptResult.content;
        
        // Si el script está vacío, generar el contenido faltante
        if (scriptResult.isEmpty && scriptResult.hasStructure) {
          console.log(`🔧 Generando guión faltante para sección ${section.section}...`);
          
          // Obtener información adicional del proyecto para la generación
          const chapterTitle = section.title && section.title !== `Sección ${section.section}` 
            ? section.title 
            : null;
          
          // Obtener secciones anteriores para contexto
          const previousSections = projectState.completedSections
            .filter(s => s.section < section.section)
            .sort((a, b) => a.section - b.section);
          
          const generationResult = await generateMissingScript(
            projectState.topic || 'Proyecto de gaming',
            section.section,
            projectState.totalSections,
            chapterTitle,
            previousSections,
            scriptStyle,
            customStyleInstructions,
            wordsMin,
            wordsMax
          );
          
          if (generationResult.success) {
            cleanScript = generationResult.script;
            console.log(`✅ Guión generado: ${cleanScript.length} caracteres`);
            
            // Actualizar el archivo TXT con el nuevo contenido
            try {
              const sectionDir = path.join(projectDir, `seccion_${section.section}`);
              const scriptFiles = fs.readdirSync(sectionDir).filter(file => 
                file.endsWith('.txt') && !file.includes('metadata') && !file.includes('keywords')
              );
              
              if (scriptFiles.length > 0) {
                const scriptFilePath = path.join(sectionDir, scriptFiles[0]);
                const originalContent = fs.readFileSync(scriptFilePath, 'utf8');
                
                // Reconstruir el archivo con el nuevo contenido
                const updatedContent = originalContent.replace(
                  /(CONTENIDO DEL GUIÓN:\s*\n)(.*?)(===============================)/s,
                  `$1${cleanScript}\n\n$3`
                );
                
                fs.writeFileSync(scriptFilePath, updatedContent, 'utf8');
                console.log(`📝 Archivo TXT actualizado con el nuevo guión`);
              }
            } catch (updateError) {
              console.warn(`⚠️ No se pudo actualizar el archivo TXT:`, updateError.message);
            }
            
          } else {
            console.error(`❌ No se pudo generar el guión: ${generationResult.error}`);
            throw new Error(`No se pudo generar el guión faltante: ${generationResult.error}`);
          }
        } else if (scriptResult.isEmpty) {
          throw new Error('El script está vacío y no se puede generar audio');
        }
        
        console.log(`🧹 Script limpio: ${cleanScript.substring(0, 100)}...`);
        
        // Generar audio con Applio usando solo el contenido del guión
        const result = await applioClient.textToSpeech(cleanScript, filePath, {
          model: applioModel || 'rmvpe',
          speed: Number.isFinite(Number(applioSpeed)) ? Number(applioSpeed) : 0,
          pitch: Number.isFinite(Number(applioPitch)) ? Number(applioPitch) : 0,
          voicePath: applioVoice || 'es-ES-ElviraNeural.pth'
        });
        
        if (!result.success) {
          throw new Error('Applio no generó el audio correctamente');
        }
        
        // Retornar ruta relativa para acceso web
        const audioPath = path.relative('./public', filePath).replace(/\\/g, '/');
        
        generationResults.push({
          section: section.section,
          audioPath: audioPath,
          success: true,
          message: `Audio generado exitosamente`
        });
        
        console.log(`✅ Audio generado: ${audioPath}`);
        
      } catch (error) {
        console.error(`❌ Error generando audio para sección ${section.section}:`, error);
        generationResults.push({
          section: section.section,
          audioPath: null,
          success: false,
          error: error.message
        });
      }
    }
    
    const successfulGeneration = generationResults.filter(r => r.success).length;
    
    console.log(`\n✅ GENERACIÓN DE AUDIOS FALTANTES COMPLETADA:`);
    console.log(`🎵 ${successfulGeneration}/${missingAudioSections.length} audios faltantes generados con Applio`);
    console.log(`⏭️ ${projectState.completedSections.length - missingAudioSections.length} audios ya existían`);
    
    res.json({
      success: true,
      message: `${successfulGeneration}/${missingAudioSections.length} audios faltantes generados exitosamente`,
      data: {
        generationResults: generationResults,
        generatedCount: successfulGeneration,
        totalSections: projectState.completedSections.length,
        skippedSections: projectState.completedSections.length - missingAudioSections.length,
        missingAudioSections: missingAudioSections.map(s => s.section),
        applioConfig: {
          voice: applioVoice,
          model: applioModel,
          pitch: applioPitch,
          speed: applioSpeed
        }
      }
    });
    
  } catch (error) {
    console.error('❌ Error en generación de audios faltantes:', error);
    res.status(500).json({ error: 'Error generando audios faltantes: ' + error.message });
  }
});

// ENDPOINT PARA GENERAR AUDIOS FALTANTES CON GOOGLE TTS
app.post('/generate-missing-google-audios', async (req, res) => {
  try {
    const {
      folderName,
      voice = DEFAULT_TTS_VOICE,
      narrationStyle = null,
      scriptStyle = 'professional',
      customStyleInstructions = '',
      wordsMin = 800,
      wordsMax = 1100
    } = req.body;

    console.log('\n' + '🔍'.repeat(20));
    console.log('🔍 VERIFICANDO Y GENERANDO AUDIOS FALTANTES CON GOOGLE TTS');
    console.log('🔍'.repeat(20));

    console.log('🎤 Configuración de generación Google:', {
      proyecto: folderName,
      voz: voice,
      estiloNarracion: narrationStyle || 'default'
    });

    const projectState = loadProjectState(folderName);
    if (!projectState) {
      return res.status(404).json({ error: 'Proyecto no encontrado' });
    }

    const projectDir = path.join(globalOutputDir, folderName);
    const missingGoogleSections = [];

    for (let i = 0; i < projectState.completedSections.length; i++) {
      const section = projectState.completedSections[i];
      const sectionDir = path.join(projectDir, `seccion_${section.section}`);

      if (!fs.existsSync(sectionDir)) {
        console.log(`📁 Creando carpeta faltante para sección ${section.section}: ${sectionDir}`);
        fs.mkdirSync(sectionDir, { recursive: true });
      }

      let hasGoogleAudio = false;

      if (fs.existsSync(sectionDir)) {
        const files = fs.readdirSync(sectionDir);
        const audioFiles = files.filter(file =>
          (file.endsWith('.wav') || file.endsWith('.mp3') || file.endsWith('.m4a') || file.endsWith('.ogg'))
        );

        const googleAudioFiles = audioFiles.filter(file => !file.includes('_applio'));

        hasGoogleAudio = googleAudioFiles.length > 0;

        if (hasGoogleAudio) {
          console.log(`✅ Sección ${section.section} ya tiene audio Google: ${googleAudioFiles.join(', ')}`);
        }
      }

      if (!hasGoogleAudio) {
        console.log(`🎵 Sección ${section.section} necesita audio Google`);
        missingGoogleSections.push(section);
      }
    }

    console.log(`📊 Análisis completo: ${missingGoogleSections.length}/${projectState.completedSections.length} secciones necesitan audio Google`);

    if (missingGoogleSections.length === 0) {
      return res.json({
        success: true,
        message: 'Todos los audios de Google ya existen, no se generó ninguno nuevo',
        data: {
          generatedCount: 0,
          totalSections: projectState.completedSections.length,
          skippedSections: projectState.completedSections.length,
          missingAudioSections: []
        }
      });
    }

    const generationResults = [];

    for (let i = 0; i < missingGoogleSections.length; i++) {
      const section = missingGoogleSections[i];
      console.log(`🎵 Generando audio Google faltante ${i + 1}/${missingGoogleSections.length}: Sección ${section.section}`);

      try {
        const sectionDir = path.join(projectDir, `seccion_${section.section}`);

        const scriptResult = extractScriptContent(section.script);
        let cleanScript = scriptResult.content;

        if (scriptResult.isEmpty && scriptResult.hasStructure) {
          console.log(`🔧 Generando guión faltante para sección ${section.section} (Google)...`);

          const chapterTitle = section.title && section.title !== `Sección ${section.section}`
            ? section.title
            : null;

          const previousSections = projectState.completedSections
            .filter(s => s.section < section.section)
            .sort((a, b) => a.section - b.section);

          const generationResult = await generateMissingScript(
            projectState.topic || 'Proyecto de gaming',
            section.section,
            projectState.totalSections,
            chapterTitle,
            previousSections,
            scriptStyle,
            customStyleInstructions,
            wordsMin,
            wordsMax
          );

          if (generationResult.success) {
            cleanScript = generationResult.script;
            console.log(`✅ Guión generado para Google: ${cleanScript.length} caracteres`);

            try {
              const scriptFiles = fs.readdirSync(sectionDir).filter(file =>
                file.endsWith('.txt') && !file.includes('metadata') && !file.includes('keywords')
              );

              if (scriptFiles.length > 0) {
                const scriptFilePath = path.join(sectionDir, scriptFiles[0]);
                const originalContent = fs.readFileSync(scriptFilePath, 'utf8');

                const updatedContent = originalContent.replace(
                  /(CONTENIDO DEL GUIÓN:\s*\n)(.*?)(===============================)/s,
                  `$1${cleanScript}\n\n$3`
                );

                fs.writeFileSync(scriptFilePath, updatedContent, 'utf8');
                console.log('📝 Archivo TXT actualizado con el nuevo guión (Google)');
              }
            } catch (updateError) {
              console.warn('⚠️ No se pudo actualizar el archivo TXT (Google):', updateError.message);
            }

          } else {
            console.error(`❌ No se pudo generar el guión para Google: ${generationResult.error}`);
            throw new Error(`No se pudo generar el guión faltante: ${generationResult.error}`);
          }
        } else if (scriptResult.isEmpty) {
          throw new Error('El script está vacío y no se puede generar audio de Google');
        }

        console.log(`🧹 Script limpio (Google): ${cleanScript.substring(0, 100)}...`);

        const audioRelativePath = await generateStoryAudio(
          cleanScript,
          voice || DEFAULT_TTS_VOICE,
          sectionDir,
          section.title || projectState.topic || folderName,
          section.section,
          narrationStyle
        );

        generationResults.push({
          section: section.section,
          audioPath: audioRelativePath,
          success: true,
          message: 'Audio generado exitosamente con Google'
        });

        console.log(`✅ Audio Google generado: ${audioRelativePath}`);

      } catch (error) {
        console.error(`❌ Error generando audio Google para sección ${section.section}:`, error);
        generationResults.push({
          section: section.section,
          audioPath: null,
          success: false,
          error: error.message
        });
      }
    }

    const successfulGeneration = generationResults.filter(r => r.success).length;

    console.log(`\n✅ GENERACIÓN DE AUDIOS GOOGLE COMPLETADA:`);
    console.log(`🎵 ${successfulGeneration}/${missingGoogleSections.length} audios faltantes generados con Google TTS`);

    res.json({
      success: true,
      message: `${successfulGeneration}/${missingGoogleSections.length} audios faltantes generados exitosamente con Google TTS`,
      data: {
        generationResults,
        generatedCount: successfulGeneration,
        totalSections: projectState.completedSections.length,
        skippedSections: projectState.completedSections.length - missingGoogleSections.length,
        missingAudioSections: missingGoogleSections.map(s => s.section),
        googleConfig: {
          voice,
          narrationStyle: narrationStyle || 'default'
        }
      }
    });

  } catch (error) {
    console.error('❌ Error generando audios faltantes con Google:', error);
    res.status(500).json({ error: 'Error generando audios faltantes con Google: ' + error.message });
  }
});

// ENDPOINT PARA REGENERAR AUDIOS CON APPLIO (MANTENER PARA COMPATIBILIDAD)
app.post('/regenerate-applio-audios', async (req, res) => {
  try {
    const { folderName, applioVoice, applioModel, applioPitch, applioSpeed, totalSections, scriptStyle = 'professional', customStyleInstructions = '', wordsMin = 800, wordsMax = 1100 } = req.body;
    
    console.log('\n' + '🔄'.repeat(20));
    console.log('🔄 REGENERANDO AUDIOS CON APPLIO');
    console.log('🔄'.repeat(20));
    
    console.log('🎤 Configuración de regeneración:', {
      proyecto: folderName,
      voz: applioVoice,
      modelo: applioModel,
      pitch: applioPitch,
      speed: applioSpeed,
      secciones: totalSections
    });
    
    // Verificar que el proyecto existe
    const projectState = loadProjectState(folderName);
    if (!projectState) {
      return res.status(404).json({ error: 'Proyecto no encontrado' });
    }
    
    // Inicializar Applio
    console.log('🔄 Iniciando Applio para regeneración de audio...');
    const applioStarted = await startApplio();
    if (!applioStarted) {
      throw new Error('No se pudo iniciar Applio');
    }
    
    const regenerationResults = [];
    
    // Regenerar audio para todas las secciones completadas
    for (let i = 0; i < projectState.completedSections.length; i++) {
      const section = projectState.completedSections[i];
      console.log(`🎵 Regenerando audio ${i + 1}/${totalSections}: Sección ${section.section}`);
      
      try {
        // Obtener el directorio de la sección
        const projectDir = path.join(globalOutputDir, folderName);
        const sectionDir = path.join(projectDir, `seccion_${section.section}`);
        
        // Crear nombre de archivo único
        const fileName = `${folderName}_seccion_${section.section}_regenerado_${Date.now()}.wav`;
        const filePath = path.join(sectionDir, fileName);
        
        console.log(`📁 Regenerando audio en: ${filePath}`);
        console.log(`📝 Script completo: ${section.script.substring(0, 100)}...`);
        
        // Extraer solo el contenido del guión sin metadatos
        const scriptResult = extractScriptContent(section.script);
        let cleanScript = scriptResult.content;
        
        // Si el script está vacío, generar el contenido faltante
        if (scriptResult.isEmpty && scriptResult.hasStructure) {
          console.log(`🔧 Generando guión faltante para sección ${section.section}...`);
          
          // Obtener información adicional del proyecto para la generación
          const chapterTitle = section.title && section.title !== `Sección ${section.section}` 
            ? section.title 
            : null;
          
          // Obtener secciones anteriores para contexto
          const previousSections = projectState.completedSections
            .filter(s => s.section < section.section)
            .sort((a, b) => a.section - b.section);
          
          const generationResult = await generateMissingScript(
            projectState.topic || 'Proyecto de gaming',
            section.section,
            projectState.totalSections,
            chapterTitle,
            previousSections,
            scriptStyle,
            customStyleInstructions,
            wordsMin,
            wordsMax
          );
          
          if (generationResult.success) {
            cleanScript = generationResult.script;
            console.log(`✅ Guión generado: ${cleanScript.length} caracteres`);
            
            // Actualizar el archivo TXT con el nuevo contenido
            try {
              const projectDir = path.join(globalOutputDir, folderName);
              const sectionDir = path.join(projectDir, `seccion_${section.section}`);
              const scriptFiles = fs.readdirSync(sectionDir).filter(file => 
                file.endsWith('.txt') && !file.includes('metadata') && !file.includes('keywords')
              );
              
              if (scriptFiles.length > 0) {
                const scriptFilePath = path.join(sectionDir, scriptFiles[0]);
                const originalContent = fs.readFileSync(scriptFilePath, 'utf8');
                
                // Reconstruir el archivo con el nuevo contenido
                const updatedContent = originalContent.replace(
                  /(CONTENIDO DEL GUIÓN:\s*\n)(.*?)(===============================)/s,
                  `$1${cleanScript}\n\n$3`
                );
                
                fs.writeFileSync(scriptFilePath, updatedContent, 'utf8');
                console.log(`📝 Archivo TXT actualizado con el nuevo guión`);
              }
            } catch (updateError) {
              console.warn(`⚠️ No se pudo actualizar el archivo TXT:`, updateError.message);
            }
            
          } else {
            console.error(`❌ No se pudo generar el guión: ${generationResult.error}`);
            throw new Error(`No se pudo generar el guión faltante: ${generationResult.error}`);
          }
        } else if (scriptResult.isEmpty) {
          throw new Error('El script está vacío y no se puede generar audio');
        }
        
        console.log(`🧹 Script limpio: ${cleanScript.substring(0, 100)}...`);
        
        // Generar audio con Applio usando solo el contenido del guión
        const result = await applioClient.textToSpeech(cleanScript, filePath, {
          model: applioModel || 'rmvpe',
          speed: Number.isFinite(Number(applioSpeed)) ? Number(applioSpeed) : 0,
          pitch: Number.isFinite(Number(applioPitch)) ? Number(applioPitch) : 0,
          voicePath: applioVoice || 'es-ES-ElviraNeural.pth'
        });
        
        if (!result.success) {
          throw new Error('Applio no generó el audio correctamente');
        }
        
        // Retornar ruta relativa para acceso web
        const audioPath = path.relative('./public', filePath).replace(/\\/g, '/');
        
        regenerationResults.push({
          section: section.section,
          audioPath: audioPath,
          success: true,
          message: `Audio regenerado exitosamente`
        });
        
        console.log(`✅ Audio regenerado: ${audioPath}`);
        
      } catch (error) {
        console.error(`❌ Error regenerando audio para sección ${section.section}:`, error);
        regenerationResults.push({
          section: section.section,
          audioPath: null,
          success: false,
          error: error.message
        });
      }
    }
    
    const successfulRegeneration = regenerationResults.filter(r => r.success).length;
    
    console.log(`\n✅ REGENERACIÓN COMPLETADA:`);
    console.log(`🎵 ${successfulRegeneration}/${totalSections} audios regenerados con Applio`);
    
    res.json({
      success: true,
      message: `${successfulRegeneration}/${totalSections} audios regenerados exitosamente`,
      data: {
        regenerationResults: regenerationResults,
        successfulRegeneration: successfulRegeneration,
        totalSections: totalSections,
        applioConfig: {
          voice: applioVoice,
          model: applioModel,
          pitch: applioPitch,
          speed: applioSpeed
        }
      }
    });
    
  } catch (error) {
    console.error('❌ Error en regeneración de audios:', error);
    res.status(500).json({ error: 'Error regenerando audios: ' + error.message });
  }
});

// ENDPOINT PARA REGENERAR SOLO LOS GUIONES FALTANTES (SIN AUDIO)
app.post('/generate-missing-scripts', async (req, res) => {
  try {
    const { folderName, scriptStyle = 'professional', customStyleInstructions = '', wordsMin = 800, wordsMax = 1100 } = req.body;
    
    console.log('\n' + '📝'.repeat(20));
    console.log('📝 REGENERANDO GUIONES FALTANTES');
    console.log('📝'.repeat(20));
    
    // Verificar que el proyecto existe
    const projectState = loadProjectState(folderName);
    if (!projectState) {
      return res.status(404).json({ error: 'Proyecto no encontrado' });
    }
    
    console.log(`📝 Verificando guiones faltantes en proyecto: ${folderName}`);
    console.log(`📊 Total de secciones: ${projectState.completedSections.length}`);
    
  const missingSectionScripts = [];
  const scriptResults = [];
  const restoredFromMemory = [];
    const projectDir = path.join(globalOutputDir, folderName);
    const projectTopic = projectState.topic || folderName;
    const totalSections = projectState.totalSections || projectState.completedSections.length;
    
    // Iterate up to totalSections to catch sections that might be missing from completedSections array
    const loopLimit = Math.max(projectState.completedSections.length, totalSections);

    for (let i = 0; i < loopLimit; i++) {
      let section = projectState.completedSections[i];
      const sectionNumber = (section && section.section) ? Number.parseInt(section.section, 10) : i + 1;
      
      // If section entry is missing entirely from state, create a placeholder
      if (!section) {
          section = {
              section: sectionNumber,
              title: `Capítulo ${sectionNumber}`,
              script: '', // Empty script to force regeneration
              cleanScript: ''
          };
          console.log(`⚠️ Sección ${sectionNumber} no existe en el estado del proyecto. Se tratará como faltante.`);
      }

      const { sectionDir } = createProjectStructure(projectTopic, sectionNumber, folderName);
      const defaultScriptFileName = `${folderName}_seccion_${sectionNumber}_guion.txt`;
      const defaultScriptPath = path.join(sectionDir, defaultScriptFileName);

      let scriptFiles = [];
      try {
          if (!fs.existsSync(sectionDir)) {
             fs.mkdirSync(sectionDir, { recursive: true });
          }
        scriptFiles = fs.readdirSync(sectionDir).filter((file) =>
          file.endsWith('.txt') && !file.includes('metadata') && !file.includes('keywords')
        );
      } catch (dirError) {
        console.warn(`⚠️ No se pudo leer archivos de la sección ${sectionNumber}: ${dirError.message}`);
      }

      const preferredFile = scriptFiles.find((file) => file === defaultScriptFileName) || scriptFiles[0];
      const scriptFilePath = preferredFile ? path.join(sectionDir, preferredFile) : defaultScriptPath;

      if (!preferredFile) {
        console.log(`📄 Sección ${sectionNumber} no tiene archivo de guión. Creando uno nuevo...`);

        const fallbackScript = (() => {
          if (typeof section.cleanScript === 'string' && section.cleanScript.trim()) {
            return section.cleanScript.trim();
          }
          if (typeof section.script === 'string' && section.script.trim()) {
            const extraction = extractScriptContent(section.script);
            if (extraction && extraction.content.trim()) {
              return extraction.content.trim();
            }
            return cleanScriptText(section.script);
          }
          if (section.script && typeof section.script.content === 'string') {
            return section.script.content.trim();
          }
          return '';
        })();

        if (isScriptContentValid(fallbackScript)) {
          const fileContent = buildScriptFileContent({
            topic: projectTopic,
            totalSections,
            sectionNumber,
            chapterTitle: section.title || null,
            projectKey: folderName,
            scriptText: fallbackScript
          });

          fs.writeFileSync(scriptFilePath, fileContent, 'utf8');
          console.log(`✅ Guión reconstruido desde memoria para sección ${sectionNumber} (${fallbackScript.length} caracteres)`);

          scriptResults.push({
            section: sectionNumber,
            scriptLength: fallbackScript.length,
            success: true,
            message: 'Guión reconstruido desde memoria'
          });

          restoredFromMemory.push(sectionNumber);

          continue;
        } else if (fallbackScript.length > 0) {
          console.log(`⚠️ El guión en memoria para la sección ${sectionNumber} contiene un mensaje de error, se regenerará con IA.`);
        }

        missingSectionScripts.push({
          ...section,
          sectionNumber,
          scriptFilePath,
          originalContent: null,
          requiresNewFile: true
        });
        continue;
      }

      try {
        const fullContent = fs.readFileSync(scriptFilePath, 'utf8');
        const cleanContent = cleanScriptContent(fullContent);
        const hasValidContent = cleanContent && cleanContent.trim().length > 0 && isScriptContentValid(cleanContent);

        if (hasValidContent) {
          console.log(`✅ Sección ${sectionNumber} ya tiene guión (${cleanContent.length} caracteres)`);
        } else {
          console.log(`📝 Sección ${sectionNumber} necesita regeneración de guión (contenido inválido o vacío)`);
          missingSectionScripts.push({
            ...section,
            sectionNumber,
            scriptFilePath,
            originalContent: fullContent,
            requiresNewFile: false
          });
        }
      } catch (readError) {
        console.warn(`⚠️ No se pudo leer guión de la sección ${sectionNumber}: ${readError.message}`);
        missingSectionScripts.push({
          ...section,
          sectionNumber,
          scriptFilePath,
          originalContent: null,
          requiresNewFile: true
        });
      }
    }

    console.log(`📊 Análisis de guiones: ${missingSectionScripts.length}/${loopLimit} secciones requieren regeneración con IA`);

    // Generar guiones solo para las secciones que lo necesitan
    for (let i = 0; i < missingSectionScripts.length; i++) {
      const section = missingSectionScripts[i];
      console.log(`📝 Generando guión ${i + 1}/${missingSectionScripts.length}: Sección ${section.section}`);
      
      try {
        // Obtener información adicional del proyecto para la generación
        const chapterTitle = section.title && section.title !== `Sección ${section.section}` 
          ? section.title 
          : null;
        
        // Obtener secciones anteriores para contexto
        const previousSections = projectState.completedSections
          .filter(s => s.section < section.section)
          .sort((a, b) => a.section - b.section);
          
        // Extract style and length settings from project state
        const scriptStyle = projectState.scriptStyle || 'professional';
        const customStyleInstructions = projectState.customStyleInstructions || '';
        const wordsMin = projectState.wordsMin || 150; // Default to ~150 words
        const wordsMax = projectState.wordsMax || 250; // Default to ~250 words
        
        const generationResult = await generateMissingScript(
          projectState.topic || 'Proyecto de gaming',
          section.section,
          totalSections,
          chapterTitle,
          previousSections,
          scriptStyle,
          customStyleInstructions,
          wordsMin,
          wordsMax
        );
        
        if (generationResult.success) {
          if (!isScriptContentValid(generationResult.script)) {
            throw new Error('El contenido generado contiene un mensaje de error del proveedor de IA');
          }
          let fileContent;

          if (section.originalContent) {
            fileContent = section.originalContent.replace(
              /(CONTENIDO DEL GUIÓN:\s*\n)(.*?)(===============================)/s,
              `$1${generationResult.script}\n\n$3`
            );
          } else {
            fileContent = buildScriptFileContent({
              topic: projectTopic,
              totalSections,
              sectionNumber: section.sectionNumber || section.section,
              chapterTitle,
              projectKey: folderName,
              scriptText: generationResult.script
            });
          }

          fs.writeFileSync(section.scriptFilePath, fileContent, 'utf8');

          scriptResults.push({
            section: section.section,
            scriptLength: generationResult.script.length,
            success: true,
            message: section.originalContent ? 'Guión regenerado exitosamente' : 'Guión generado desde cero'
          });
          
          console.log(`✅ Guión generado para sección ${section.section}: ${generationResult.script.length} caracteres`);
          
        } else {
          scriptResults.push({
            section: section.section,
            success: false,
            error: generationResult.error
          });
          console.error(`❌ Error generando guión para sección ${section.section}: ${generationResult.error}`);
        }
        
      } catch (error) {
        console.error(`❌ Error procesando sección ${section.section}:`, error);
        scriptResults.push({
          section: section.section,
          success: false,
          error: error.message
        });
      }
    }
    
    const successfulGeneration = scriptResults.filter(r => r.success).length;
    
    console.log(`\n✅ REGENERACIÓN DE GUIONES COMPLETADA:`);
    console.log(`📝 ${successfulGeneration}/${projectState.completedSections.length} guiones corregidos o verificados`);
    console.log(`⏭️ ${projectState.completedSections.length - successfulGeneration} guiones ya estaban correctos`);
    
    if (scriptResults.length === 0) {
      return res.json({
        success: true,
        message: 'Todos los guiones ya existen, no se regeneró ninguno',
        data: {
          scriptResults: [],
          generatedCount: 0,
          totalSections: projectState.completedSections.length,
          skippedSections: projectState.completedSections.length,
          missingScripts: []
        }
      });
    }

    const affectedSections = Array.from(new Set([
      ...restoredFromMemory,
      ...missingSectionScripts.map((s) => s.section)
    ])).sort((a, b) => a - b);
    
    res.json({
      success: true,
      message: `${successfulGeneration} guion(es) reparados o regenerados exitosamente`,
      data: {
        scriptResults: scriptResults,
        generatedCount: successfulGeneration,
        totalSections: projectState.completedSections.length,
        skippedSections: projectState.completedSections.length - successfulGeneration,
        missingScripts: affectedSections
      }
    });
    
  } catch (error) {
    console.error('❌ Error en regeneración de guiones:', error);
    res.status(500).json({ error: 'Error regenerando guiones: ' + error.message });
  }
});

// ENDPOINT PARA GENERAR IMÁGENES FALTANTES
app.get('/api/google-image-apis', (req, res) => {
  try {
    const apis = getGoogleImageApiStatus();
    const availableCount = apis.filter((api) => api.available).length;

    res.json({
      success: true,
      apis,
      available: availableCount,
      message: availableCount ? undefined : 'No hay API keys de Google configuradas para imágenes.'
    });
  } catch (error) {
    console.error('❌ Error obteniendo estado de APIs de Google:', error);
    res.status(500).json({ success: false, error: 'No se pudo obtener el estado de las APIs de Google.' });
  }
});

app.get('/api/comfy-defaults', (req, res) => {
  res.json({
    success: true,
    steps: comfyDefaultConfig.steps,
    cfg: comfyDefaultConfig.cfg,
    guidance: comfyDefaultConfig.guidance,
    resolutions: comfyDefaultConfig.resolutions
  });
});

// Función auxiliar para generar imágenes faltantes de un proyecto (para uso interno)
async function generateMissingImagesForProject(data) {
  const { 
    folderName, 
    imageInstructions = '', 
    imageCount = 5, 
    useLocalAI = false, 
    comfyUIConfig = {},
    allowComfyFallback = true,
    selectedApis = [],
    aspectRatio = '9:16'
  } = data;

  console.log('🖼️ Iniciando generación automática de imágenes...');
  const aspectInfo = describeAspectRatio(aspectRatio);
  const safeAspectRatio = aspectInfo.ratio;
  console.log(`📐 Aspect ratio solicitado: ${aspectInfo.label}`);
  const googleApiPreferences = resolveGoogleImageApiSelection(Array.isArray(selectedApis) ? selectedApis : []);

  if (!googleApiPreferences.length) {
    throw new Error('No hay API keys de Google disponibles para generar imágenes.');
  }
  
  // Verificar que el proyecto existe
  const projectState = loadProjectState(folderName);
  if (!projectState) {
    throw new Error('Proyecto no encontrado');
  }
  
  console.log(`🖼️ Verificando imágenes faltantes en proyecto: ${folderName}`);
  console.log(`📊 Total de secciones: ${projectState.totalSections}`);
  console.log(`🎨 Instrucciones para imágenes: "${imageInstructions || 'Por defecto'}"`);
  console.log(`📱 Cantidad de imágenes por sección: ${imageCount}`);
  console.log(`🤖 Usar IA local (ComfyUI): ${useLocalAI}`);
  console.log(`🔁 Fallback con ComfyUI habilitado: ${allowComfyFallback}`);
  console.log(`🔐 APIs de Google seleccionadas: ${googleApiPreferences.map((api) => api.label).join(', ')}`);
  
  const sectionsToProcess = [];
  
  // Preparar las secciones que necesitan imágenes
  for (let sectionNum = 1; sectionNum <= projectState.totalSections; sectionNum++) {
    const sectionDir = path.join(globalOutputDir, folderName, `seccion_${sectionNum}`);
    
    if (!fs.existsSync(sectionDir)) {
      console.log(`⚠️ Sección ${sectionNum} no existe, saltando...`);
      continue;
    }
    
    // Cargar prompts para esta sección
    const promptsFilePath = path.join(sectionDir, `${folderName}_seccion_${sectionNum}_prompts_imagenes.txt`);
    
    if (!fs.existsSync(promptsFilePath)) {
      console.log(`🎨 Archivo de prompts no encontrado para sección ${sectionNum}: ${promptsFilePath}`);
      continue;
    }
    
    const promptsContent = fs.readFileSync(promptsFilePath, 'utf8');
    const prompts = promptsContent
      .split(/\d+\s*===/)
      .slice(1)
      .map(p => p.replace(/^\d+\s*===/, '').trim()).filter(p => p);
    
    if (prompts.length === 0) {
      console.log(`⚠️ No se pudieron extraer prompts de sección ${sectionNum}, saltando...`);
      continue;
    }
    
    // Verificar cuántas imágenes ya existen
    const existingImages = fs.readdirSync(sectionDir).filter(file => 
      file.match(/\.(jpg|jpeg|png|webp)$/i)
    );

    const imageNumberPattern = new RegExp(`^seccion_${sectionNum}_imagen_(\\d+)`, 'i');
    const existingImageNumbers = new Set();
    for (const file of existingImages) {
      const match = file.match(imageNumberPattern);
      if (match) {
        const num = parseInt(match[1], 10);
        if (!Number.isNaN(num)) {
          existingImageNumbers.add(num);
        }
      }
    }

  const maxImagesNeeded = prompts.length;
    const missingImageNumbers = [];
    for (let i = 1; i <= maxImagesNeeded; i += 1) {
      if (!existingImageNumbers.has(i)) {
        missingImageNumbers.push(i);
      }
    }

  console.log(`📊 Sección ${sectionNum}: ${existingImages.length} imágenes existentes, faltan ${missingImageNumbers.length} (de ${maxImagesNeeded} prompts)`);
    if (missingImageNumbers.length === 0) {
      console.log(`✅ Sección ${sectionNum} ya tiene todas las imágenes requeridas`);
      continue;
    }
    
    sectionsToProcess.push({
      section: sectionNum,
      sectionDir,
      prompts,
      existingImages,
      existingImageNumbers: Array.from(existingImageNumbers).sort((a, b) => a - b),
      missingImageNumbers
    });
  }
  
  if (sectionsToProcess.length === 0) {
    console.log(`✅ Todas las secciones tienen suficientes imágenes`);
    return { successful: 0, failed: 0, sections: [] };
  }
  
  let totalGenerated = 0;
  let totalFailed = 0;
  const generatedImages = [];
  
  // Procesar cada sección
  for (const section of sectionsToProcess) {
    console.log(`🖼️ Generando imágenes para sección ${section.section}...`);
    
    const missingNumbersList = section.missingImageNumbers.slice().sort((a, b) => a - b);
    console.log(`🔢 Prompts faltantes para sección ${section.section}: ${missingNumbersList.join(', ')}`);

    // Generar imágenes una por una solo para los números faltantes
    let generatedCount = 0;
    const promptTasks = missingNumbersList
      .map((imageNumber) => {
        const promptIndex = imageNumber - 1;
        if (promptIndex < 0 || promptIndex >= section.prompts.length) {
          console.log(`⚠️ Prompt ${imageNumber} fuera de rango para sección ${section.section}, saltando...`);
          return null;
        }

        const prompt = section.prompts[promptIndex];
        const imageName = `seccion_${section.section}_imagen_${imageNumber}`;

        return {
          sectionNumber: section.section,
          promptIndex,
          imageNumber,
          prompt,
          imageName,
          outputDir: section.sectionDir,
          imageModel: selectedImageModel
        };
      })
      .filter(Boolean);

    if (promptTasks.length === 0) {
      console.log(`⚠️ No se identificaron tareas válidas para la sección ${section.section}`);
      continue;
    }

    const fallbackConfigProvider = () => {
      if (!allowComfyFallback) {
        return false;
      }

      if (!useLocalAI) {
        return {};
      }

      const { width: defaultWidth, height: defaultHeight } = resolveComfyDefaultResolution(safeAspectRatio);
      return {
        width: comfyUIConfig.width || defaultWidth,
        height: comfyUIConfig.height || defaultHeight,
        steps: comfyUIConfig.steps || comfyDefaultConfig.steps,
        guidance: comfyUIConfig.guidance || comfyDefaultConfig.guidance,
        cfg: comfyUIConfig.cfg || comfyDefaultConfig.cfg,
        sampler: comfyUIConfig.sampler || 'euler',
        scheduler: comfyUIConfig.scheduler || 'simple',
        model: comfyUIConfig.model || 'flux1-dev-fp8.safetensors'
      };
    };

    const taskResults = await runPromptTasksInBatches(
      promptTasks,
      async (task) => {
        console.log(`🎨 Generando imagen para sección ${section.section} (prompt ${task.imageNumber})...`);
        console.log(`📝 Usando prompt: ${task.prompt.substring(0, 100)}...`);
        return await processPromptGenerationTask(task, {
          aspectRatio: safeAspectRatio,
          fallbackConfigProvider,
          allowComfyFallback,
          allowCooldownRetry: !allowComfyFallback,
          cooldownRetryMs: 60000,
          googleApiPreferences,
          imageModel: selectedImageModel
        });
      },
      {
        batchSize: IMAGE_BATCH_SIZE,
        delayBetweenBatchesMs: IMAGE_BATCH_DELAY_MS
      }
    );

    for (const result of taskResults) {
      if (result.success) {
        generatedCount++;
        totalGenerated++;
        console.log(`✅ Imagen generada exitosamente (${result.method}) para sección ${section.section} (prompt ${result.imageNumber})`);
        if (result.retries > 0) {
          console.log(`🔁 Reintentos usados para prompt ${result.imageNumber}: ${result.retries}`);
        }
        const resultModelLabel = result.model ? getImageModelLabel(result.model) : selectedImageModelLabel;
        generatedImages.push({
          section: section.section,
          filename: result.filename,
          method: result.method,
          attempt: result.generator === 'google' ? (result.googleAttempts || 1) : 1,
          model: resultModelLabel
        });
      } else {
        totalFailed++;
        const errorMessage = result.error?.message || result.error || 'Error desconocido';
        console.error(`❌ Error generando imagen para sección ${section.section} (prompt ${result.imageNumber})`);
      }
    }
    
    if (generatedCount > 0) {
      console.log(`✅ Sección ${section.section}: ${generatedCount} imágenes generadas exitosamente`);
    }
  }
  
  console.log(`🎯 Resumen final: ${totalGenerated} imágenes generadas, ${totalFailed} fallidas`);
  
  return {
    successful: totalGenerated,
    failed: totalFailed,
    generatedImages: generatedImages
  };
}

app.post('/api/generate-missing-images', async (req, res) => {
  let sessionId = null;

  try {
    console.log('📥 DATOS RECIBIDOS DEL FRONTEND:', JSON.stringify(req.body, null, 2));
    
    const { 
      folderName, 
      imageInstructions = '', 
      imageCount = 10, 
      aspectRatio = '9:16',
      useLocalAI = false, 
      comfyUIConfig = {},
      allowComfyFallback: allowComfyFallbackInput,
      comfyOnlyMode: comfyOnlyModeInput = false,
      sectionNumber: sectionNumberInput,
      selectedApis: selectedApisInput = [],
      imageModel: imageModelInput = null
    } = req.body;

    const comfyOnlyMode = Boolean(comfyOnlyModeInput);
    const allowComfyFallbackRaw = typeof allowComfyFallbackInput === 'boolean' ? allowComfyFallbackInput : true;
    const allowComfyFallback = comfyOnlyMode ? true : allowComfyFallbackRaw;
    const parsedSectionNumber = Number.parseInt(sectionNumberInput, 10);
    const sectionNumber = Number.isInteger(parsedSectionNumber) && parsedSectionNumber > 0 ? parsedSectionNumber : null;
    const selectedApisRaw = Array.isArray(selectedApisInput) ? selectedApisInput : [];
    const googleApiPreferences = comfyOnlyMode ? [] : resolveGoogleImageApiSelection(selectedApisRaw);
    const hasExplicitApiSelection = selectedApisRaw.length > 0;
    const effectiveUseLocalAI = comfyOnlyMode ? true : Boolean(useLocalAI);
    const aspectInfo = describeAspectRatio(aspectRatio);
    const safeAspectRatio = aspectInfo.ratio;

    if (!comfyOnlyMode && !googleApiPreferences.length) {
      if (hasExplicitApiSelection) {
        return res.status(400).json({ error: 'Las APIs seleccionadas no están disponibles o no tienen una key configurada.' });
      }

      return res.status(400).json({ error: 'No hay API keys de Google disponibles para generar imágenes.' });
    }
    
    console.log('\n' + '🖼️'.repeat(20));
    console.log('🖼️ GENERANDO IMÁGENES FALTANTES');
    console.log('🖼️'.repeat(20));
    
    // Verificar que el proyecto existe
    const projectState = loadProjectState(folderName);
    if (!projectState) {
      return res.status(404).json({ error: 'Proyecto no encontrado' });
    }

    const selectedImageModel = normalizeImageModel(imageModelInput || projectState.imageModel);
    const selectedImageModelLabel = getImageModelLabel(selectedImageModel);

    console.log(`🖼️ Verificando imágenes faltantes en proyecto: ${folderName}`);
    console.log(`🤖 Modelo de imágenes seleccionado: ${selectedImageModelLabel} (${selectedImageModel})`);

    sessionId = startImageGenerationSession();

    const completedSections = Array.isArray(projectState.completedSections)
      ? projectState.completedSections
      : [];
    const totalSections = completedSections.length;

    const normalizedSections = completedSections
      .map((section) => {
        const sectionNum = Number.parseInt(section.section ?? section.sectionNumber ?? section.id, 10);
        if (!Number.isInteger(sectionNum) || sectionNum <= 0) {
          return null;
        }
        if (section.section !== sectionNum) {
          return { ...section, section: sectionNum };
        }
        return section;
      })
      .filter((section) => section && (!sectionNumber || section.section === sectionNumber));

    if (sectionNumber && normalizedSections.length === 0) {
      return res.status(404).json({ error: `Sección ${sectionNumber} no encontrada en el proyecto` });
    }

    console.log(`📊 Total de secciones: ${totalSections}`);
    if (sectionNumber) {
      console.log(`🎯 Filtrando análisis para la sección ${sectionNumber}`);
    }

    console.log(`🎨 Instrucciones para imágenes: "${imageInstructions || 'Por defecto'}"`);
    console.log(`📱 Cantidad de imágenes por sección: ${imageCount}`);
    console.log(`📐 Aspect ratio solicitado: ${aspectInfo.label}`);
    console.log(`🤖 Usar IA local (ComfyUI): ${effectiveUseLocalAI}`);
    console.log(`🎯 Modo Comfy directo: ${comfyOnlyMode}`);
    console.log(`🔁 Fallback con ComfyUI habilitado: ${allowComfyFallback}`);
    if (!comfyOnlyMode) {
      console.log(`🔐 APIs de Google seleccionadas: ${googleApiPreferences.map((api) => api.label).join(', ')}`);
    } else {
      console.log('🔐 Modo Comfy directo: se omiten las APIs de Google.');
    }
    const googleApiLabel = comfyOnlyMode
      ? 'ComfyUI (modo directo)'
      : googleApiPreferences.some((api) => api.type === 'primary')
        ? 'Google Gemini (APIs seleccionadas)'
        : 'Google Gemini (APIs gratuitas)';
    
    if (effectiveUseLocalAI && (allowComfyFallback || comfyOnlyMode)) {
      const { width: defaultWidth, height: defaultHeight } = resolveComfyDefaultResolution(safeAspectRatio);
      console.log(`⚙️ Configuración ComfyUI:`, {
        steps: comfyUIConfig.steps || comfyDefaultConfig.steps,
        guidance: comfyUIConfig.guidance || comfyDefaultConfig.guidance,
        cfg: comfyUIConfig.cfg || comfyDefaultConfig.cfg,
        resolution: `${comfyUIConfig.width || defaultWidth}x${comfyUIConfig.height || defaultHeight}`,
        model: comfyUIConfig.model || 'flux1-dev-fp8.safetensors',
        sampler: comfyUIConfig.sampler || 'euler',
        scheduler: comfyUIConfig.scheduler || 'simple'
      });
    }
    
    checkImageGenerationCancellation(sessionId);

    const projectDir = path.join(globalOutputDir, folderName);
    const sectionsNeedingPrompts = [];
    const sectionsNeedingImages = [];
    const promptMetadataBySection = new Map();

    const extractPromptsFromContent = (content) => {
      if (!content || typeof content !== 'string') {
        return [];
      }
      return content
        .split(/===\s*PROMPT\s+\d+\s*===/i)
        .slice(1)
        .map((chunk) => chunk.trim())
        .filter(Boolean);
    };

    const evaluateImageStatus = (sectionDir, sectionNum, prompts = []) => {
      if (!Array.isArray(prompts) || prompts.length === 0) {
        return { missingImageNumbers: [], existingImages: [] };
      }

      if (!fs.existsSync(sectionDir)) {
        return {
          missingImageNumbers: prompts.map((_, index) => index + 1),
          existingImages: []
        };
      }

      const imageFiles = fs.readdirSync(sectionDir).filter((file) =>
        file.match(/\.(jpg|jpeg|png|webp)$/i)
      );

      const imageNumberPattern = new RegExp(`^seccion_${sectionNum}_imagen_(\\d+)`, 'i');
      const existingImageNumbers = new Set();
      for (const file of imageFiles) {
        const match = file.match(imageNumberPattern);
        if (match) {
          const num = Number.parseInt(match[1], 10);
          if (Number.isInteger(num) && num > 0) {
            existingImageNumbers.add(num);
          }
        }
      }

      const missingImageNumbers = [];
      for (let i = 1; i <= prompts.length; i += 1) {
        if (!existingImageNumbers.has(i)) {
          missingImageNumbers.push(i);
        }
      }

      return { missingImageNumbers, existingImages: imageFiles };
    };

    // PASO 1: Verificar qué secciones necesitan prompts o imágenes adicionales
    for (const section of normalizedSections) {
      const sectionDir = path.join(projectDir, `seccion_${section.section}`);

      if (!fs.existsSync(sectionDir)) {
        console.log(`⚠️ Carpeta de sección ${section.section} no encontrada. Marcando para regenerar prompts.`);
        sectionsNeedingPrompts.push(section);
        continue;
      }

      const promptFiles = fs.readdirSync(sectionDir).filter((file) =>
        file.includes('prompts') && file.includes('imagenes') && file.endsWith('.txt')
      );

      if (promptFiles.length === 0) {
        console.log(`🖼️ Sección ${section.section} necesita prompts de imágenes`);
        sectionsNeedingPrompts.push(section);
        continue;
      }

      const promptsFilePath = path.join(sectionDir, promptFiles[0]);
      const promptsContent = fs.readFileSync(promptsFilePath, 'utf8');
      const prompts = extractPromptsFromContent(promptsContent);

      if (!prompts.length) {
        console.log(`⚠️ Archivo de prompts vacío o inválido para sección ${section.section}. Regenerando.`);
        sectionsNeedingPrompts.push(section);
        continue;
      }

      promptMetadataBySection.set(section.section, {
        prompts,
        promptsFilePath,
        sectionDir
      });

      const { missingImageNumbers, existingImages } = evaluateImageStatus(sectionDir, section.section, prompts);

      if (missingImageNumbers.length > 0) {
        console.log(`🖼️ Sección ${section.section} tiene ${existingImages.length}/${prompts.length} imágenes. Faltan: ${missingImageNumbers.join(', ')}`);
        sectionsNeedingImages.push({
          ...section,
          sectionDir,
          prompts,
          promptsFilePath,
          missingImageNumbers
        });
      } else {
        console.log(`✅ Sección ${section.section} ya cuenta con todas las imágenes requeridas (${existingImages.length}/${prompts.length})`);
      }
    }
    
    const protagonistContext = await ensureProtagonistStyleGuide(projectDir, projectState, imageInstructions);
    const protagonistProfile = protagonistContext?.profile || null;
    const worldContextResult = await ensureStoryWorldGuide(projectDir, projectState, projectState.topic, imageInstructions);
    const storyWorldContext = worldContextResult?.context || null;

    if (protagonistContext?.filePath) {
      if (protagonistContext?.wasCreated) {
        console.log(`🧾 Guía de protagonista creada: ${protagonistContext.filePath}`);
      } else if (protagonistContext?.wasUpdated) {
        console.log(`🧾 Guía de protagonista actualizada: ${protagonistContext.filePath}`);
      } else {
        console.log(`🧾 Guía de protagonista existente utilizada: ${protagonistContext.filePath}`);
      }
    }

    if (worldContextResult?.filePath) {
      if (worldContextResult?.wasCreated) {
        console.log(`🌍 Guía de worldbuilding creada: ${worldContextResult.filePath}`);
      } else if (worldContextResult?.wasUpdated) {
        console.log(`🌍 Guía de worldbuilding actualizada: ${worldContextResult.filePath}`);
      } else {
        console.log(`🌍 Guía de worldbuilding existente utilizada: ${worldContextResult.filePath}`);
      }
    }

    const generatedPrompts = [];
    let totalImagesGenerated = 0;
    const generatedImages = [];
    const imagesGeneratedBySection = new Map();
    
    // PASO 2: Generar prompts faltantes
    if (sectionsNeedingPrompts.length > 0) {
      console.log(`🎨 Generando prompts para ${sectionsNeedingPrompts.length} secciones...`);
      
      for (const section of sectionsNeedingPrompts) {
        checkImageGenerationCancellation(sessionId);
        try {
          console.log(`🎨 Generando prompts para sección ${section.section}...`);
          
          // Leer el guión de la sección
          const sectionDir = path.join(projectDir, `seccion_${section.section}`);
          if (!fs.existsSync(sectionDir)) {
            console.log(`⚠️ Carpeta de sección ${section.section} no encontrada, saltando regeneración de prompts`);
            continue;
          }
          const scriptFiles = fs.readdirSync(sectionDir).filter(file => 
            file.endsWith('.txt') && !file.includes('metadata') && !file.includes('keywords') && !file.includes('prompts')
          );
          
          if (scriptFiles.length === 0) {
            console.log(`⚠️ No se encontró guión para sección ${section.section}, saltando...`);
            continue;
          }
          
          const scriptFilePath = path.join(sectionDir, scriptFiles[0]);
          const scriptContent = fs.readFileSync(scriptFilePath, 'utf8');
          const extractedScript = cleanScriptContent(scriptContent);
          
          if (!extractedScript || extractedScript.trim().length === 0) {
            console.log(`⚠️ Guión vacío en sección ${section.section}, saltando...`);
            continue;
          }
          
          // Generar prompts usando Gemini
          const promptsResult = await generateImagePrompts(
            extractedScript,
            imageInstructions,
            imageCount,
            protagonistProfile,
            storyWorldContext,
            projectState.topic
          );
          
          if (promptsResult && promptsResult.prompts && promptsResult.prompts.length > 0) {
            // Guardar prompts en archivo
            const promptsFileName = `seccion_${section.section}_prompts_imagenes.txt`;
            const promptsFilePath = path.join(sectionDir, promptsFileName);
            
            const promptsContent = promptsResult.prompts.map((prompt, index) => 
              `=== PROMPT ${index + 1} ===\n${prompt}\n`
            ).join('\n');
            
            fs.writeFileSync(promptsFilePath, promptsContent, 'utf8');
            console.log(`✅ Prompts guardados para sección ${section.section}`);
            
            generatedPrompts.push(section.section);

            promptMetadataBySection.set(section.section, {
              prompts: promptsResult.prompts,
              promptsFilePath,
              sectionDir
            });

            const { missingImageNumbers } = evaluateImageStatus(sectionDir, section.section, promptsResult.prompts);

            if (missingImageNumbers.length > 0) {
              const alreadyQueued = sectionsNeedingImages.some((item) => item.section === section.section);
              if (!alreadyQueued) {
                sectionsNeedingImages.push({
                  ...section,
                  sectionDir,
                  prompts: promptsResult.prompts,
                  promptsFilePath,
                  missingImageNumbers
                });
              }
              console.log(`🖼️ Tras generar prompts, sección ${section.section} requiere imágenes para índices: ${missingImageNumbers.join(', ')}`);
            } else {
              console.log(`✅ Tras generar prompts, sección ${section.section} ya cuenta con las imágenes requeridas`);
            }
          }
          
        } catch (error) {
          console.error(`❌ Error generando prompts para sección ${section.section}:`, error);
        }
      }
    }
    
    // PASO 3: Generar imágenes faltantes
    if (sectionsNeedingImages.length > 0) {
      // Actualizar fase del proyecto a imágenes
      if (projectProgressTracker[folderName]) {
        projectProgressTracker[folderName].currentPhase = 'images';
        projectProgressTracker[folderName].lastUpdate = Date.now();
      }
      
      const aiService = comfyOnlyMode
        ? 'ComfyUI (modo directo)'
        : allowComfyFallback
          ? (effectiveUseLocalAI ? `${googleApiLabel} → ComfyUI (IA Local)` : `${googleApiLabel} → ComfyUI (fallback)`)
          : `${googleApiLabel} (sin fallback de ComfyUI)`;
      console.log(`🖼️ Generando imágenes para ${sectionsNeedingImages.length} secciones usando ${aiService}...`);
      
      for (const section of sectionsNeedingImages) {
        checkImageGenerationCancellation(sessionId);
        const sectionNumberToProcess = Number.parseInt(section.section ?? section.sectionNumber ?? section.id, 10);
        if (!Number.isInteger(sectionNumberToProcess) || sectionNumberToProcess <= 0) {
          console.warn('⚠️ Número de sección inválido recibido en cola de imágenes:', section);
          continue;
        }

        try {
          checkImageGenerationCancellation(sessionId);
          const sectionDir = section.sectionDir || path.join(projectDir, `seccion_${sectionNumberToProcess}`);
          if (!fs.existsSync(sectionDir)) {
            console.log(`⚠️ Carpeta de sección ${sectionNumberToProcess} no encontrada. Saltando generación de imágenes.`);
            continue;
          }

          console.log(`🖼️ Generando imágenes para sección ${sectionNumberToProcess}...`);

          const metadata = promptMetadataBySection.get(sectionNumberToProcess) || {};
          let prompts = section.prompts || metadata.prompts;
          let promptsFilePath = section.promptsFilePath || metadata.promptsFilePath;

          if ((!prompts || !prompts.length) || !promptsFilePath) {
            const promptFiles = fs.readdirSync(sectionDir).filter((file) =>
              file.includes('prompts') && file.includes('imagenes') && file.endsWith('.txt')
            );

            if (!promptsFilePath && promptFiles.length > 0) {
              promptsFilePath = path.join(sectionDir, promptFiles[0]);
            }

            if ((!prompts || !prompts.length) && promptsFilePath && fs.existsSync(promptsFilePath)) {
              const promptsContent = fs.readFileSync(promptsFilePath, 'utf8');
              prompts = extractPromptsFromContent(promptsContent);
            }
          }

          if (!prompts || !prompts.length) {
            console.log(`⚠️ No se pudieron obtener prompts válidos para sección ${sectionNumberToProcess}, saltando...`);
            continue;
          }

          promptMetadataBySection.set(sectionNumberToProcess, {
            prompts,
            promptsFilePath,
            sectionDir
          });

          const { missingImageNumbers } = evaluateImageStatus(sectionDir, sectionNumberToProcess, prompts);

          if (missingImageNumbers.length === 0) {
            console.log(`✅ Sección ${sectionNumberToProcess} ya cuenta con todas las imágenes requeridas (${prompts.length}).`);
            continue;
          }

          const promptTasks = missingImageNumbers
            .map((imageNumber) => {
              const promptIndex = imageNumber - 1;
              if (promptIndex < 0 || promptIndex >= prompts.length) {
                console.log(`⚠️ Prompt ${imageNumber} fuera de rango para sección ${sectionNumberToProcess}, saltando...`);
                return null;
              }

              const prompt = prompts[promptIndex];
              const imageName = `seccion_${sectionNumberToProcess}_imagen_${imageNumber}`;

              return {
                sectionNumber: sectionNumberToProcess,
                promptIndex,
                imageNumber,
                prompt,
                imageName,
                outputDir: sectionDir,
                imageModel: selectedImageModel
              };
            })
            .filter(Boolean);

          if (promptTasks.length === 0) {
            console.log(`⚠️ No se identificaron tareas válidas para la sección ${sectionNumberToProcess}`);
            continue;
          }

          let generatedCount = 0;
          console.log(`🔄 BUCLE DE GENERACIÓN: ${promptTasks.length} iteraciones programadas (faltantes: ${missingImageNumbers.join(', ')})`);

          const fallbackConfigProvider = () => {
            if (!allowComfyFallback) {
              return false;
            }

            if (!effectiveUseLocalAI) {
              return {};
            }

            const { width: defaultWidth, height: defaultHeight } = resolveComfyDefaultResolution(safeAspectRatio);

            return {
              width: comfyUIConfig.width || defaultWidth,
              height: comfyUIConfig.height || defaultHeight,
              steps: comfyUIConfig.steps || comfyDefaultConfig.steps,
              guidance: comfyUIConfig.guidance || comfyDefaultConfig.guidance,
              cfg: comfyUIConfig.cfg || comfyDefaultConfig.cfg,
              sampler: comfyUIConfig.sampler || 'euler',
              scheduler: comfyUIConfig.scheduler || 'simple',
              model: comfyUIConfig.model || 'flux1-dev-fp8.safetensors'
            };
          };

          const taskResults = await runPromptTasksInBatches(
            promptTasks,
            async (task) => {
              checkImageGenerationCancellation(sessionId);
              console.log(`🎨 Generando imagen para sección ${sectionNumberToProcess} (prompt ${task.imageNumber})...`);
              console.log(`📝 Usando prompt: ${task.prompt.substring(0, 100)}...`);
              
              const result = await processPromptGenerationTask(task, {
                aspectRatio: safeAspectRatio,
                fallbackConfigProvider,
                allowComfyFallback,
                allowCooldownRetry: !allowComfyFallback,
                cooldownRetryMs: 60000,
                checkCancellation: () => checkImageGenerationCancellation(sessionId),
                googleApiPreferences,
                imageModel: selectedImageModel,
                forceComfyOnly: comfyOnlyMode
              });
              
              // Actualizar progreso de imágenes si fue exitoso
              if (result.success && folderName) {
                // Calcular progreso total de imágenes
                const totalImagesInProject = sectionsNeedingImages.reduce((total, section) => {
                  const metadata = promptMetadataBySection.get(section.section);
                  return total + (metadata?.prompts?.length || imageCount);
                }, 0);
                
                const completedImagesInProject = totalImagesGenerated;
                const imagesProgressPercentage = totalImagesInProject > 0 ? (completedImagesInProject / totalImagesInProject) * 100 : 0;
                
                // Actualizar progreso por sección
                const sectionImagesProgress = sectionsNeedingImages.map(section => {
                  const metadata = promptMetadataBySection.get(section.section);
                  const totalImagesInSection = metadata?.prompts?.length || imageCount;
                  const completedImagesInSection = imagesGeneratedBySection.get(section.section) || 0;
                  
                  return {
                    sectionIndex: section.section - 1,
                    completedImages: completedImagesInSection,
                    totalImages: totalImagesInSection
                  };
                });
                
                // Actualizar projectProgressTracker
                updateProjectProgress(folderName, 'images', completedImagesInProject, totalImagesInProject, 'imagen', null);
                
                // Enviar actualización de progreso detallada
                if (projectProgressTracker[folderName]) {
                  projectProgressTracker[folderName].imagesProgress = {
                    percentage: Math.round(imagesProgressPercentage),
                    currentTask: `Generando imagen ${task.imageNumber} de sección ${sectionNumberToProcess}`,
                    sections: sectionImagesProgress
                  };
                }
              }
              
              return result;
            },
            {
              batchSize: comfyOnlyMode ? 1 : IMAGE_BATCH_SIZE,
              delayBetweenBatchesMs: comfyOnlyMode ? 0 : IMAGE_BATCH_DELAY_MS
            }
          );

          for (const result of taskResults) {
            if (result.success) {
              generatedCount++;
              totalImagesGenerated++;
              
              // Actualizar contador por sección
              const currentCount = imagesGeneratedBySection.get(sectionNumberToProcess) || 0;
              imagesGeneratedBySection.set(sectionNumberToProcess, currentCount + 1);
              
              console.log(`✅ Imagen generada exitosamente (${result.method}) para sección ${sectionNumberToProcess} (prompt ${result.imageNumber})`);
            } else {
              const errorMessage = result.error?.message || result.error || 'Error desconocido';
              console.error(`❌ Error generando imagen para sección ${sectionNumberToProcess} (prompt ${result.imageNumber}):`);
            }
          }

          const allFailedDueToCredits = taskResults.length > 0 && taskResults.every((result) =>
            !result.success && (result.isApiCreditsExhausted || result.error?.code === 'NO_API_CREDITS' || result.error?.isApiCreditsExhausted)
          );
          if (allFailedDueToCredits) {
            console.error('🚫 Todas las APIs disponibles fallaron por falta de créditos. Abortando generación de imágenes.');
            const creditsError = new Error('Las APIs de generación de imágenes ya no tienen créditos disponibles.');
            creditsError.code = 'NO_API_CREDITS';
            throw creditsError;
          }

          console.log(`🏁 BUCLE DE GENERACIÓN TERMINADO. Generadas: ${generatedCount}/${promptTasks.length} imágenes`);

          if (generatedCount > 0) {
            generatedImages.push({
              section: sectionNumberToProcess,
              generated: generatedCount,
              total: missingImageNumbers.length,
              pending: Math.max(0, missingImageNumbers.length - generatedCount)
            });
          }

        } catch (error) {
          console.error(`❌ Error generando imágenes para sección ${sectionNumberToProcess}:`, error);
          if (error?.code === 'NO_API_CREDITS') {
            throw error;
          }
        }
      }
    }
    
    const aiServiceUsed = comfyOnlyMode
      ? 'ComfyUI (modo directo)'
      : allowComfyFallback
        ? (effectiveUseLocalAI ? `${googleApiLabel} → ComfyUI (IA Local)` : `${googleApiLabel} → ComfyUI (fallback)`)
        : `${googleApiLabel} (sin fallback de ComfyUI)`;
    const scopeLabel = sectionNumber
      ? `sección ${sectionNumber}`
      : `${normalizedSections.length} sección(es)`;

    console.log(`\n✅ GENERACIÓN DE IMÁGENES COMPLETADA (${aiServiceUsed}) para ${scopeLabel}:`);
    console.log(`🎨 ${generatedPrompts.length} secciones obtuvieron nuevos prompts`);
    console.log(`🖼️ ${generatedImages.length} secciones obtuvieron nuevas imágenes`);
    
    return res.json({
      success: true,
      message: `Generación completada para ${scopeLabel} usando ${aiServiceUsed}: ${generatedPrompts.length} prompt(s) y ${generatedImages.length} sección(es) con imágenes nuevas`,
      data: {
        generatedPrompts: generatedPrompts,
        generatedImages: generatedImages,
        totalSections,
        processedSections: normalizedSections.map((section) => section.section),
        requestedSection: sectionNumber,
        sectionsNeedingPrompts: sectionsNeedingPrompts.length,
        sectionsNeedingImages: sectionsNeedingImages.length,
        aiService: aiServiceUsed,
        useLocalAI: effectiveUseLocalAI,
        allowComfyFallback,
        comfyUIConfig: (effectiveUseLocalAI && allowComfyFallback) ? comfyUIConfig : null,
        comfyOnlyMode
      }
    });
  } catch (error) {
    console.error('❌ Error en generación de imágenes:', error);
    if (error?.code === 'CANCELLED_BY_USER') {
      return res.json({
        success: false,
        cancelled: true,
        message: error.message
      });
    }
    return res.status(500).json({ error: 'Error generando imágenes: ' + error.message });
  } finally {
    if (sessionId) {
      finishImageGenerationSession(sessionId);
    }
  }
});

app.post('/api/cancel-missing-images', (req, res) => {
  const { activeSessionId, cancelRequested } = imageGenerationController;

  if (!activeSessionId) {
    return res.json({
      success: false,
      message: 'No hay un proceso de generación de imágenes en curso.'
    });
  }

  if (cancelRequested) {
    return res.json({
      success: true,
      message: 'La cancelación ya fue solicitada. El proceso se detendrá en breve.',
      sessionId: activeSessionId
    });
  }

  imageGenerationController.cancelRequested = true;
  console.log(`🛑 Cancelación solicitada para la sesión de imágenes ${activeSessionId}`);

  return res.json({
    success: true,
    message: 'Cancelación solicitada. Las imágenes en proceso se detendrán en breve.',
    sessionId: activeSessionId
  });
});

// ENDPOINT PARA GENERAR SOLO PROMPTS DE IMÁGENES (SIN GENERAR IMÁGENES)
app.post('/api/generate-prompts-only', async (req, res) => {
  try {
    console.log('📥 DATOS RECIBIDOS DEL FRONTEND:', JSON.stringify(req.body, null, 2));
    
    const { 
      folderName, 
      imageInstructions = '', 
      imageCount = 5
    } = req.body;
    
    console.log('\n' + '📝'.repeat(20));
    console.log('📝 GENERANDO SOLO PROMPTS DE IMÁGENES');
    console.log('📝'.repeat(20));
    
    // Verificar que el proyecto existe
    const projectState = loadProjectState(folderName);
    if (!projectState) {
      return res.status(404).json({ error: 'Proyecto no encontrado' });
    }
    
  const selectedImageModel = normalizeImageModel(projectState?.imageModel);
  const selectedImageModelLabel = getImageModelLabel(selectedImageModel);

  console.log(`📝 Generando prompts para proyecto: ${folderName}`);
  console.log(`📊 Total de secciones: ${projectState.completedSections.length}`);
  console.log(`🎨 Instrucciones para imágenes: "${imageInstructions || 'Por defecto'}"`);
  console.log(`📱 Cantidad de imágenes por sección: ${imageCount}`);
  console.log(`🤖 Modelo de imágenes referencial: ${selectedImageModelLabel} (${selectedImageModel})`);
    
    const projectDir = path.join(globalOutputDir, folderName);
    const sectionsNeedingPrompts = [];
    
    // Verificar qué secciones necesitan prompts de imágenes
    for (let i = 0; i < projectState.completedSections.length; i++) {
      const section = projectState.completedSections[i];
      const sectionDir = path.join(projectDir, `seccion_${section.section}`);
      
      if (fs.existsSync(sectionDir)) {
        // Buscar archivo de prompts de imágenes
        const promptFiles = fs.readdirSync(sectionDir).filter(file => 
          file.includes('prompts') && file.includes('imagenes') && file.endsWith('.txt')
        );
        
        if (promptFiles.length === 0) {
          console.log(`📝 Sección ${section.section} necesita prompts de imágenes`);
          sectionsNeedingPrompts.push(section);
        } else {
          console.log(`✅ Sección ${section.section} ya tiene prompts de imágenes`);
        }
      }
    }
    
    if (sectionsNeedingPrompts.length === 0) {
      return res.json({
        success: true,
        message: 'Todas las secciones ya tienen prompts de imágenes',
        data: {
          generatedPrompts: [],
          totalSections: projectState.completedSections.length,
          sectionsNeedingPrompts: 0
        }
      });
    }
    
    const protagonistContext = await ensureProtagonistStyleGuide(projectDir, projectState, imageInstructions);
    const protagonistProfile = protagonistContext?.profile || null;
    const worldContextResult = await ensureStoryWorldGuide(projectDir, projectState, projectState.topic, imageInstructions);
    const storyWorldContext = worldContextResult?.context || null;

    if (protagonistContext?.filePath) {
      if (protagonistContext?.wasCreated) {
        console.log(`🧾 Guía de protagonista creada: ${protagonistContext.filePath}`);
      } else if (protagonistContext?.wasUpdated) {
        console.log(`🧾 Guía de protagonista actualizada: ${protagonistContext.filePath}`);
      } else {
        console.log(`🧾 Guía de protagonista existente utilizada: ${protagonistContext.filePath}`);
      }
    }

    if (worldContextResult?.filePath) {
      if (worldContextResult?.wasCreated) {
        console.log(`🌍 Guía de worldbuilding creada: ${worldContextResult.filePath}`);
      } else if (worldContextResult?.wasUpdated) {
        console.log(`🌍 Guía de worldbuilding actualizada: ${worldContextResult.filePath}`);
      } else {
        console.log(`🌍 Guía de worldbuilding existente utilizada: ${worldContextResult.filePath}`);
      }
    }

    const generatedPrompts = [];
    
    // Generar prompts faltantes
    console.log(`🎨 Generando prompts para ${sectionsNeedingPrompts.length} secciones...`);
    
    for (const section of sectionsNeedingPrompts) {
      try {
        console.log(`🎨 Generando prompts para sección ${section.section}...`);
        
        // Leer el guión de la sección
        const sectionDir = path.join(projectDir, `seccion_${section.section}`);
        const scriptFiles = fs.readdirSync(sectionDir).filter(file => 
          file.endsWith('.txt') && !file.includes('metadata') && !file.includes('keywords') && !file.includes('prompts')
        );
        
        if (scriptFiles.length === 0) {
          console.log(`⚠️ No se encontró guión para sección ${section.section}, saltando...`);
          continue;
        }
        
        const scriptFilePath = path.join(sectionDir, scriptFiles[0]);
        const scriptContent = fs.readFileSync(scriptFilePath, 'utf8');
        const extractedScript = extractScriptContent(scriptContent);
        
        if (extractedScript.isEmpty) {
          console.log(`⚠️ Guión vacío en sección ${section.section}, saltando...`);
          continue;
        }
        
        // Generar prompts usando Gemini
        const promptsResult = await generateImagePrompts(
          extractedScript.content,
          imageInstructions,
          imageCount,
          protagonistProfile,
          storyWorldContext,
          projectState.topic
        );
        
        if (promptsResult && promptsResult.prompts && promptsResult.prompts.length > 0) {
          // Guardar prompts en archivo
          const promptsFileName = `seccion_${section.section}_prompts_imagenes.txt`;
          const promptsFilePath = path.join(sectionDir, promptsFileName);
          
          const promptsFileContent = promptsResult.prompts
            .map((prompt, index) => `=== PROMPT ${index + 1} ===\n${prompt}`)
            .join('\n\n');
          
          fs.writeFileSync(promptsFilePath, promptsFileContent, 'utf8');
          console.log(`✅ Prompts guardados para sección ${section.section}: ${promptsFileName}`);
          
          generatedPrompts.push({
            section: section.section,
            promptsCount: promptsResult.prompts.length,
            filename: promptsFileName
          });
        } else {
          console.log(`❌ Error generando prompts para sección ${section.section}`);
        }
        
      } catch (sectionError) {
        console.error(`❌ Error procesando sección ${section.section}:`, sectionError);
      }
    }
    
    console.log(`\n✅ GENERACIÓN DE PROMPTS COMPLETADA:`);
    console.log(`📝 ${generatedPrompts.length} secciones obtuvieron nuevos prompts`);
    
    res.json({
      success: true,
      message: `Prompts generados para ${generatedPrompts.length} sección(es)`,
      data: {
        generatedPrompts: generatedPrompts,
        totalSections: projectState.completedSections.length,
        sectionsNeedingPrompts: sectionsNeedingPrompts.length,
        imageModel: selectedImageModel
      }
    });
    
  } catch (error) {
    console.error('❌ Error en generación de prompts:', error);
    res.status(500).json({ error: 'Error generando prompts: ' + error.message });
  }
});

// Función auxiliar para generar prompts de imágenes usando Gemini
async function generateImagePrompts(scriptContent, imageInstructions = '', imageCount = 10, protagonistProfile = null, storyWorldContext = null, storyTopic = '') {
  try {
    console.log(`🎨 Generando ${imageCount} prompts basados en el guión...`);
    
    if (imageInstructions && imageInstructions.trim()) {
      console.log(`🎯 Instrucciones personalizadas del usuario: "${imageInstructions}"`);
    } else {
      console.log(`📝 Usando instrucciones por defecto (no se especificaron instrucciones personalizadas)`);
    }

    if (protagonistProfile) {
      protagonistProfile.promptSnippet = protagonistProfile.promptSnippet || createProtagonistPromptSnippet(protagonistProfile);
    }

  const protagonistInstructionBlock = formatProtagonistInstructionBlock(protagonistProfile);
  const worldInstructionBlock = formatStoryWorldInstructionBlock(storyWorldContext);
  const storyTopicReference = storyTopic ? storyTopic.toString().trim() : '';
  const worldContextSection = worldInstructionBlock
    ? `
CONTINUIDAD HISTÓRICA Y WORLD-BUILDING:
${worldInstructionBlock}
• Usa estos datos como referencia canónica, pero integra solo los detalles que potencien la escena.
• En cada prompt menciona al menos un elemento que recuerde la época o localización, variando la redacción y sin repetir frases.
${storyTopicReference ? `• Refuerza el tema central del proyecto: "${storyTopicReference}" mediante símbolos, conflictos o emociones relacionados.` : ''}
• Prioriza narrar acciones, símbolos, emociones y consecuencias propias de cada segmento mientras mantienes coherencia con estas guías.
`
    : `
CONTINUIDAD HISTÓRICA Y WORLD-BUILDING:
${storyTopicReference ? `• El proyecto trata sobre "${storyTopicReference}". ` : '• '}Analiza el guion y deduce época, ambientación, arquitectura, culturas dominantes y rasgos étnicos o de especie.
• Usa esas inferencias para dar contexto cuando sea relevante, variando la manera de mencionarlas.
• Si falta información, realiza suposiciones coherentes, documenta la inferencia en el prompt y mantén la misma decisión en escenas posteriores sin repetir el mismo texto.
`;
    const protagonistPromptSnippet = protagonistProfile?.promptSnippet || '';
    const protagonistName = protagonistProfile?.name ? protagonistProfile.name.trim() : '';
    const maxProtagonistPrompts = determineMaxProtagonistPrompts(imageCount);
    const minNonProtagonistPrompts = Math.max(imageCount - maxProtagonistPrompts, imageCount > 1 ? 1 : 0);
    const protagonistLabel = protagonistName || 'the main protagonist';
    const nonProtagonistFocusInstruction = minNonProtagonistPrompts > 0
      ? `• Garantiza que al menos ${minNonProtagonistPrompts} ${minNonProtagonistPrompts === 1 ? 'prompt se enfoque' : 'prompts se enfoquen'} en escenarios, elementos ambientales, personajes secundarios o símbolos clave sin mostrar a ${protagonistLabel}.`
      : '• Describe escenarios, elementos ambientales, personajes secundarios o símbolos clave sin mostrar al protagonista, variando sujetos y encuadres en cada prompt.';
    
    console.log(`🎯 Distribución objetivo: máximo ${maxProtagonistPrompts} prompt(s) con ${protagonistLabel} de ${imageCount} totales.`);

    // NUEVA FUNCIONALIDAD: Dividir el script en segmentos secuenciales
    const words = scriptContent.split(/\s+/).filter(word => word.length > 0);
    const totalWords = words.length;
    const wordsPerImage = Math.ceil(totalWords / imageCount);
    
    console.log(`📊 Análisis secuencial del script:`);
    console.log(`   • Total de palabras: ${totalWords}`);
    console.log(`   • Palabras por imagen: ~${wordsPerImage}`);
    console.log(`   • Imágenes a generar: ${imageCount}`);
    
    // Dividir el script en segmentos iguales
    const scriptSegments = [];
    for (let i = 0; i < imageCount; i++) {
      const startIndex = i * wordsPerImage;
      const endIndex = Math.min(startIndex + wordsPerImage, totalWords);
      const segmentWords = words.slice(startIndex, endIndex);
      const segmentText = segmentWords.join(' ');
      
      const segmentInfo = {
        number: i + 1,
        startWord: startIndex + 1,
        endWord: endIndex,
        wordCount: segmentWords.length,
        text: segmentText
      };
      
      scriptSegments.push(segmentInfo);
      
      console.log(`   📝 Segmento ${i + 1}: palabras ${startIndex + 1}-${endIndex} (${segmentWords.length} palabras)`);
    }
    
  const { model } = await getGoogleAI(GEMINI_TEXT_MODEL, { context: 'llm' });

  const baseInstructions = `
Basándote en los siguientes segmentos secuenciales del guión/script, genera ${imageCount} prompts MUY DETALLADOS para generar imágenes que representen ESPECÍFICAMENTE cada segmento en orden cronológico.

IMPORTANTE: Cada prompt debe representar ÚNICAMENTE el contenido de su segmento correspondiente, manteniendo la secuencia temporal de la narrativa.

INSTRUCCIONES ESPECÍFICAS DEL USUARIO:
${imageInstructions || 'Crear imágenes cinematográficas que ilustren los conceptos principales del texto de manera visualmente impactante.'}

${worldContextSection}

VARIACIÓN NARRATIVA Y SENSORIAL:
• Extrae de cada segmento al menos dos elementos narrativos únicos (acciones, giros, emociones, símbolos, conflictos o consecuencias) e intégralos de forma explícita.
• Alterna el tipo de foco entre personajes, entornos, objetos clave, multitudes, clima, rituales o detalles simbólicos, evitando repetir el mismo sujeto central en prompts consecutivos.
• Cambia el punto de vista, la estructura verbal y el ritmo descriptivo entre prompts; no comiences múltiples prompts con la misma frase o fórmula.
• Añade detalles sensoriales (sonidos, temperaturas, aromas, texturas, iluminación) y referencias a cómo evoluciona la escena anterior para reforzar progresión.
• Introduce metáforas visuales, motivos o contraste emocional cuando el segmento lo permita, manteniendo coherencia con la historia.

CONSISTENCIA DE PERSONAJES Y ESCENAS:
• Identifica a los personajes principales del guión (o créalos si no se nombran) y define para cada uno: nombre consistente, edad aproximada, género, rasgos físicos, vestimenta característica y rol narrativo. No cambies estos atributos entre prompts.
• Siempre que un personaje reaparezca en prompts posteriores, menciona explícitamente su mismo nombre y atributos clave, actualizando solo los gestos o emociones del momento.
• Mantén continuidad espacial y temporal: reutiliza detalles establecidos (mobiliario, arquitectura, decoración, clima, hora del día, ambientación sonora/visual) y describe cómo evolucionan entre escenas.
• Si aparecen objetos relevantes (armas, dispositivos, reliquias, mascotas, vehículos, etc.), haz referencia a ellos en los prompts subsecuentes cuando sigan presentes o influyan en la acción.
• Utiliza frases que conecten con el segmento anterior para reforzar la progresión narrativa (por ejemplo, "continuing from", "after", "as the night deepens").
• Incluye al protagonista solo cuando el segmento lo requiera y describe únicamente sus rasgos físicos y vestimenta; deja que el contexto del guion defina emociones, gestos o ubicaciones.
${protagonistInstructionBlock
  ? `
DETALLES FIJOS DEL PROTAGONISTA:
${protagonistInstructionBlock}
`
  : `
Si identificas un protagonista principal, define un perfil consistente (nombre, edad, género, rasgos físicos, vestimenta distintiva) y reutilízalo en todos los prompts cuando aparezca en escena.
`}

REGLAS DE DISTRIBUCIÓN DE ESCENAS:
• Representa a ${protagonistLabel} en como máximo ${maxProtagonistPrompts} ${maxProtagonistPrompts === 1 ? 'prompt' : 'prompts'}.
${nonProtagonistFocusInstruction}
• Emplea encuadres medios, amplios o de detalle ambiental por defecto; usa close-ups o retratos solo si el segmento lo exige para un objeto o gesto clave que no sea el rostro del protagonista.
• Presenta al protagonista únicamente cuando el segmento pierde sentido sin su presencia directa; en los demás casos narra el momento a través del entorno, los secundarios, símbolos o huellas de sus acciones.
• Varía encuadres y sujetos para mostrar la amplitud del mundo, destacando ubicaciones, utilería importante, sensaciones atmosféricas y motivos visuales recurrentes.

REGLAS PARA LOS PROMPTS DETALLADOS:
1. Cada prompt debe ser EXTENSO y DESCRIPTIVO (mínimo 3-4 oraciones)
2. Describir ESCENAS COMPLETAS con múltiples elementos visuales
3. Incluir detalles específicos sobre:
  - Composición y encuadre (close-up, wide shot, bird's eye view, etc.)
  - Iluminación y atmósfera (dramatic lighting, golden hour, neon lights, etc.)
  - Colores dominantes y paleta cromática
  - Texturas y materiales (rough concrete, polished metal, soft fabric, etc.)
  - Elementos arquitectónicos o del entorno y cómo se mantienen o evolucionan entre segmentos
  - Gestos y posturas corporales de los personajes (manteniendo su identidad consistente)
  - Efectos visuales y detalles cinematográficos
4. Describe PERSONAJES usando nombres consistentes y manteniendo sus rasgos, edad, género y vestimenta previamente definidos. Si el guión ya provee nombres, respétalos; de lo contrario, crea nombres breves y memorables y reutilízalos siempre.
5. Incluye información contextual que refuerce la continuidad (hora del día, clima, sonidos, objetos relevantes, consecuencias de la escena anterior).
6. Los prompts deben estar en INGLÉS para mejor compatibilidad con IA
7. Evitar texto visible en las imágenes
8. Crear una progresión visual secuencial que cuente la historia cronológicamente, mencionando explícitamente continuidades o cambios relevantes.
9. Evitar repetir enfoque frontal del protagonista; alterna con planos que destaquen objetos, arquitectura, paisajes o acciones colectivas.
10. Usar vocabulario cinematográfico profesional
11. Asegurar que cada prompt esté claramente anclado en la era, ubicación y estética cultural correctas, pero variando la redacción y combinándolo con nuevos elementos narrativos relevantes al segmento
12. MANTENER CONTINUIDAD VISUAL Y NARRATIVA entre segmentos (personajes, vestuario, utilería, iluminación y estado emocional)

ESTILO DE PROMPT OBJETIVO:
En lugar de: "A man in a room"
Crear: "Wide establishing shot of a dimly lit underground bunker, rough concrete walls covered in moisture and shadow, dramatic chiaroscuro lighting from a single hanging bulb casting long shadows, a middle-aged man in worn military fatigues stands with his back turned, hands clasped behind him, studying detailed maps spread across a weathered wooden table, steam rising from a metal cup nearby, cold blue and amber color palette, cinematic composition with depth of field, film noir aesthetic"

SEGMENTOS DEL GUIÓN (en orden secuencial):
${scriptSegments.map(segment => 
  `\n--- SEGMENTO ${segment.number} (palabras ${segment.startWord}-${segment.endWord}) ---\n${segment.text}\n`
).join('')}

FORMATO DE RESPUESTA:
Devuelve exactamente ${imageCount} prompts extensos y detallados, uno por línea, sin numeración ni formato adicional. 
Cada prompt debe corresponder secuencialmente a su segmento respectivo (Prompt 1 = Segmento 1, Prompt 2 = Segmento 2, etc.).

PROMPTS CINEMATOGRÁFICOS DETALLADOS (en inglés, uno por segmento en orden):`;

    const result = await model.generateContent({
      contents: [{ parts: [{ text: baseInstructions }] }],
      generationConfig: {
        thinkingConfig: {
          thinkingBudget: 0, // Disables thinking
        }
      }
    });
    const response = result.response;
    const generatedText = response.text();

    if (!generatedText) {
      throw new Error('No se generó contenido');
    }

    // Procesar y limpiar los prompts
    let prompts = generatedText
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 10) // Filtrar líneas muy cortas
      .slice(0, imageCount); // Asegurar que no tengamos más prompts de los solicitados

    if (prompts.length === 0) {
      throw new Error('No se pudieron extraer prompts válidos de la respuesta');
    }

    const diversityResult = await enforcePromptDiversity({
      prompts,
      protagonistProfile,
      maxProtagonistPrompts,
      scriptSegments,
      imageInstructions,
      model,
      storyWorldContext,
      storyTopic: storyTopicReference
    });
    prompts = diversityResult.prompts;
    if (diversityResult.adjustedCount > 0) {
      console.log(`🎛️ Se ajustaron ${diversityResult.adjustedCount} prompt(s) para equilibrar el enfoque narrativo.`);
    }

    const varietyResult = await enforceNarrativeVariety({
      prompts,
      scriptSegments,
      model,
      protagonistProfile,
      imageInstructions,
      storyWorldContext,
      storyTopic: storyTopicReference
    });
    prompts = varietyResult.prompts;
    if (varietyResult.adjustedCount > 0) {
      console.log(`🎨 Se reescribieron ${varietyResult.adjustedCount} prompt(s) para diversificar escenas y motivos.`);
    }

    if (protagonistPromptSnippet && protagonistName) {
      const nameRegex = new RegExp(escapeRegExp(protagonistName), 'i');
      prompts = prompts.map((prompt) => {
        if (nameRegex.test(prompt) && !prompt.toLowerCase().includes(protagonistPromptSnippet.toLowerCase())) {
          const separator = prompt.match(/[.!?]$/) ? ' ' : '. ';
          return `${prompt}${separator}${protagonistPromptSnippet}`;
        }
        return prompt;
      });
    }

    // Agregar instrucciones personalizadas al final de cada prompt si existen
    if (imageInstructions && imageInstructions.trim()) {
      console.log(`🔧 Agregando instrucciones personalizadas al final de cada prompt: "${imageInstructions}"`);
      prompts = prompts.map(prompt => {
        // Asegurar que haya una coma antes de las instrucciones si el prompt no termina en puntuación
        const separator = prompt.match(/[.,;!?]$/) ? ' ' : ', ';
        return `${prompt}${separator}${imageInstructions.trim()}`;
      });
    }

    console.log(`✅ ${prompts.length} prompts detallados generados exitosamente`);
    prompts.forEach((prompt, index) => {
      const promptLength = prompt.length;
      const hasCustomInstructions = imageInstructions && imageInstructions.trim() ? '(+instrucciones personalizadas)' : '';
      console.log(`🎨 Prompt ${index + 1} (${promptLength} caracteres) ${hasCustomInstructions}: ${prompt.substring(0, 150)}...`);
    });

    return {
      success: true,
      prompts: prompts,
      count: prompts.length
    };

  } catch (error) {
    console.error('❌ Error generando prompts de imágenes:', error);
    throw error;
  }
}

const PROTAGONIST_GUIDE_FILENAME = 'protagonist_style.txt';
const PROTAGONIST_SCRIPT_CHARACTER_LIMIT = 15000;
const STORY_WORLD_GUIDE_FILENAME = 'worldbuilding_style.json';
const STORY_WORLD_CONTEXT_CHARACTER_LIMIT = 20000;

async function ensureProtagonistStyleGuide(projectDir, projectState, imageInstructions = '') {
  try {
    if (!projectDir || !projectState) {
      return { profile: null, filePath: null, wasCreated: false };
    }

    const guidePath = path.join(projectDir, PROTAGONIST_GUIDE_FILENAME);

    if (fs.existsSync(guidePath)) {
      const existingContent = fs.readFileSync(guidePath, 'utf8');
      const existingProfile = parseProtagonistFileContent(existingContent);
      if (existingProfile) {
        const rawSnippet = existingProfile._rawPromptSnippet || existingProfile.promptSnippet;
        const sanitizedSnippet = createProtagonistPromptSnippet(existingProfile);
        const needsUpdate = sanitizedSnippet && sanitizedSnippet !== rawSnippet;
        existingProfile.promptSnippet = sanitizedSnippet;

        if (needsUpdate) {
          const updatedContent = buildProtagonistStyleFile(existingProfile);
          fs.writeFileSync(guidePath, updatedContent, 'utf8');
          return {
            profile: existingProfile,
            filePath: guidePath,
            wasCreated: false,
            wasUpdated: true,
            rawText: updatedContent
          };
        }

        return {
          profile: existingProfile,
          filePath: guidePath,
          wasCreated: false,
          wasUpdated: false,
          rawText: existingContent
        };
      }

      console.warn('⚠️ No se pudo interpretar la guía de protagonista existente. Se generará una nueva.');
    }

    const aggregatedScript = aggregateProjectScripts(projectDir, projectState);

    if (!aggregatedScript) {
      console.warn('⚠️ No se encontró contenido suficiente para crear la guía del protagonista.');
      return { profile: null, filePath: null, wasCreated: false };
    }

    const generatedProfile = await generateProtagonistProfile(aggregatedScript, imageInstructions);

    if (!generatedProfile) {
      return { profile: null, filePath: null, wasCreated: false };
    }

  generatedProfile.promptSnippet = createProtagonistPromptSnippet(generatedProfile);

    const fileContent = buildProtagonistStyleFile(generatedProfile);
    fs.writeFileSync(guidePath, fileContent, 'utf8');

    return {
      profile: generatedProfile,
      filePath: guidePath,
      wasCreated: true,
      wasUpdated: false,
      rawText: fileContent
    };
  } catch (error) {
    console.error('⚠️ Error preparando la guía del protagonista:', error);
  return { profile: null, filePath: null, wasCreated: false, wasUpdated: false, error };
  }
}

async function ensureStoryWorldGuide(projectDir, projectState, fallbackTopic = '', imageInstructions = '') {
  try {
    if (!projectDir || !projectState) {
      return { context: null, filePath: null, wasCreated: false, wasUpdated: false };
    }

    const worldGuidePath = path.join(projectDir, STORY_WORLD_GUIDE_FILENAME);

    if (fs.existsSync(worldGuidePath)) {
      try {
        const existingContent = fs.readFileSync(worldGuidePath, 'utf8');
        const parsed = JSON.parse(existingContent);
        const normalized = normalizeStoryWorldContext(parsed);
        return {
          context: normalized,
          filePath: worldGuidePath,
          wasCreated: false,
          wasUpdated: false
        };
      } catch (parseError) {
        console.warn(`⚠️ No se pudo interpretar la guía de worldbuilding existente (${worldGuidePath}): ${parseError.message}. Se generará una nueva.`);
      }
    }

    const aggregatedScript = aggregateProjectScripts(projectDir, projectState);
    const trimmedScript = aggregatedScript
      ? aggregatedScript.slice(0, STORY_WORLD_CONTEXT_CHARACTER_LIMIT)
      : '';

    const topicReference = (fallbackTopic || projectState.topic || projectState.originalFolderName || '').toString();
    const summaryData = {
      topic: topicReference,
      style: projectState.scriptStyle || '',
      customInstructions: projectState.customStyleInstructions || '',
      promptModifier: projectState.promptModifier || '',
      imageInstructions: imageInstructions || ''
    };

    const contextPrompt = `You are a worldbuilding analyst ensuring strict visual continuity between narrative scripts and concept art. Examine the provided story materials and deduce the canonical historical context. Respond with STRICT JSON (no markdown, no extra text) using these keys:
{
  "timePeriod": "Concise description of the historical era or temporal framing (e.g., 'Late Edo period Japan')",
  "specificYearOrEra": "Exact year, range of years, or named era (e.g., '1868', '5th century BCE', 'Post-apocalyptic future 2150')",
  "primaryLocations": ["List of the main cities, regions, planets or settings"],
  "architecturalStyles": ["Dominant architectural or environmental aesthetics"],
  "dominantCivilizationsOrCultures": ["Relevant empires, cultures, factions or civilizations"],
  "characterEthnicitiesOrSpecies": ["Races, ethnicities, species or phenotypes that should appear"],
  "technologyLevel": "Summary of technological sophistication",
  "environmentalMood": "Short atmospheric description (climate, weather, tone)",
  "additionalKeywords": ["Recurring motifs, symbols, wardrobe elements or props to reinforce"],
  "consistencyNotes": "Instructions to maintain lore and historical consistency",
  "uncertaintyNotes": "If details are missing, note safe assumptions or mark 'unknown'"
}

If information is unstated, make the safest, story-aligned inference and document the assumption inside "uncertaintyNotes". Always write in English.

TOPIC / PROJECT SUMMARY:
${JSON.stringify(summaryData, null, 2)}

${trimmedScript
  ? `SCRIPT EXCERPTS (TRIMMED):\n"""${trimmedScript}"""`
  : 'SCRIPT EXCERPTS: Not available, rely on topic and summary.'}
`;

  const { model } = await getGoogleAI(GEMINI_TEXT_MODEL, { context: 'llm' });
    const result = await model.generateContent({
      contents: [{ parts: [{ text: contextPrompt }] }],
      generationConfig: {
        thinkingConfig: {
          thinkingBudget: 0, // Disables thinking
        }
      }
    });
    let responseText = result?.response?.text?.() ?? result?.response?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!responseText || typeof responseText !== 'string') {
      throw new Error('Respuesta vacía del modelo al generar la guía de worldbuilding');
    }

    responseText = responseText.replace(/```json/gi, '').replace(/```/g, '').trim();

    const parsed = JSON.parse(responseText);
    const normalized = normalizeStoryWorldContext(parsed);

    fs.writeFileSync(worldGuidePath, JSON.stringify(normalized, null, 2), 'utf8');

    return {
      context: normalized,
      filePath: worldGuidePath,
      wasCreated: true,
      wasUpdated: false
    };
  } catch (error) {
    console.error('⚠️ Error generando la guía de worldbuilding:', error);
    return { context: null, filePath: null, wasCreated: false, wasUpdated: false, error };
  }
}

function normalizeStoryWorldContext(rawContext) {
  if (!rawContext || typeof rawContext !== 'object') {
    return null;
  }

  const toArray = (value) => {
    if (Array.isArray(value)) {
      return value
        .map((item) => (item ?? '').toString().trim())
        .filter((item) => item.length > 0);
    }
    if (typeof value === 'string') {
      return value
        .split(/[,;\n]+/)
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
    }
    return [];
  };

  const normalized = {
    timePeriod: (rawContext.timePeriod || rawContext.era || '').toString().trim(),
    specificYearOrEra: (rawContext.specificYearOrEra || rawContext.year || rawContext.timeline || '').toString().trim(),
    primaryLocations: toArray(rawContext.primaryLocations || rawContext.locations),
    architecturalStyles: toArray(rawContext.architecturalStyles || rawContext.architecture || rawContext.environments),
    dominantCivilizationsOrCultures: toArray(rawContext.dominantCivilizationsOrCultures || rawContext.civilizations || rawContext.cultures || rawContext.factions),
    characterEthnicitiesOrSpecies: toArray(rawContext.characterEthnicitiesOrSpecies || rawContext.ethnicities || rawContext.species || rawContext.races),
    technologyLevel: (rawContext.technologyLevel || rawContext.techLevel || '').toString().trim(),
    environmentalMood: (rawContext.environmentalMood || rawContext.mood || '').toString().trim(),
    additionalKeywords: toArray(rawContext.additionalKeywords || rawContext.mustMention || rawContext.keyMotifs),
    consistencyNotes: (rawContext.consistencyNotes || rawContext.instructions || '').toString().trim(),
    uncertaintyNotes: (rawContext.uncertaintyNotes || rawContext.assumptions || '').toString().trim()
  };

  return normalized;
}

function formatStoryWorldInstructionBlock(context) {
  if (!context) {
    return '';
  }

  const lines = [];

  if (context.timePeriod || context.specificYearOrEra) {
    const era = [context.specificYearOrEra, context.timePeriod].filter(Boolean).join(' – ');
    lines.push(`• Era/Año canónico: ${era}`);
  }

  if (context.primaryLocations?.length) {
    lines.push(`• Ubicaciones principales: ${context.primaryLocations.join(', ')}`);
  }

  if (context.architecturalStyles?.length) {
    lines.push(`• Arquitectura y entorno: ${context.architecturalStyles.join(', ')}`);
  }

  if (context.dominantCivilizationsOrCultures?.length) {
    lines.push(`• Civilizaciones o culturas dominantes: ${context.dominantCivilizationsOrCultures.join(', ')}`);
  }

  if (context.characterEthnicitiesOrSpecies?.length) {
    lines.push(`• Raza/etnicidad o especies de los personajes: ${context.characterEthnicitiesOrSpecies.join(', ')}`);
  }

  if (context.technologyLevel) {
    lines.push(`• Nivel tecnológico: ${context.technologyLevel}`);
  }

  if (context.environmentalMood) {
    lines.push(`• Tono ambiental y clima: ${context.environmentalMood}`);
  }

  if (context.additionalKeywords?.length) {
    lines.push(`• Motivos visuales recurrentes: ${context.additionalKeywords.join(', ')}`);
  }

  if (context.consistencyNotes) {
    lines.push(`• Notas de consistencia: ${context.consistencyNotes}`);
  }

  if (context.uncertaintyNotes) {
    lines.push(`• Datos asumidos o inciertos: ${context.uncertaintyNotes}`);
  }

  return lines.join('\n');
}

function aggregateProjectScripts(projectDir, projectState) {
  if (!projectDir || !projectState || !Array.isArray(projectState.completedSections)) {
    return '';
  }

  const gathered = [];

  for (const section of projectState.completedSections) {
    const sectionNumber = Number.parseInt(section.section ?? section.sectionNumber ?? section.id, 10);
    if (!Number.isInteger(sectionNumber) || sectionNumber <= 0) {
      continue;
    }

    const sectionDir = path.join(projectDir, `seccion_${sectionNumber}`);
    if (!fs.existsSync(sectionDir)) {
      continue;
    }

    const scriptFiles = fs.readdirSync(sectionDir).filter((file) =>
      file.endsWith('.txt') && !file.includes('metadata') && !file.includes('keywords') && !file.includes('prompts')
    );

    if (scriptFiles.length === 0) {
      continue;
    }

    const scriptPath = path.join(sectionDir, scriptFiles[0]);
    try {
      const scriptContent = fs.readFileSync(scriptPath, 'utf8');
      const extracted = extractScriptContent(scriptContent);
      if (!extracted.isEmpty && extracted.content) {
        gathered.push(extracted.content.trim());
      }
    } catch (error) {
      console.warn(`⚠️ No se pudo leer el guión de la sección ${sectionNumber}: ${error.message}`);
    }
  }

  if (!gathered.length) {
    return '';
  }

  const aggregated = gathered.join('\n\n').trim();
  if (!aggregated) {
    return '';
  }

  if (aggregated.length > PROTAGONIST_SCRIPT_CHARACTER_LIMIT) {
    return aggregated.slice(0, PROTAGONIST_SCRIPT_CHARACTER_LIMIT);
  }

  return aggregated;
}

async function generateProtagonistProfile(scriptContent, imageInstructions = '') {
  if (!scriptContent || !scriptContent.trim()) {
    return null;
  }

  try {
    const trimmedScript = scriptContent.length > PROTAGONIST_SCRIPT_CHARACTER_LIMIT
      ? scriptContent.slice(0, PROTAGONIST_SCRIPT_CHARACTER_LIMIT)
      : scriptContent;

  const { model } = await getGoogleAI(GEMINI_TEXT_MODEL, { context: 'llm' });

    const profilePrompt = `You are designing a visual bible for a story's main protagonist. Analyze the script excerpts provided and infer the most consistent primary character. Return a strict JSON object (no extra text) with the following keys as strings: "name", "gender", "age", "skinTone", "hair", "eyes", "clothing", "personality", "uniqueFeatures", "role", "promptSnippet", "notes".\n- "promptSnippet" must be a 25-45 word English sentence describing how to depict the protagonist consistently in image prompts.\n- Use concise yet vivid language.\n- If information is missing, make creative but coherent choices.\n- Keep all values in English.\n- Consider the user visual style instructions: "${imageInstructions || 'none provided'}".\n\nSCRIPT EXCERPTS (TRIMMED):\n"""${trimmedScript}"""`;

    const result = await model.generateContent({
      contents: [{ parts: [{ text: profilePrompt }] }],
      generationConfig: {
        thinkingConfig: {
          thinkingBudget: 0, // Disables thinking
        }
      }
    });
    let responseText = result?.response?.text?.() ?? result?.response?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!responseText || typeof responseText !== 'string') {
      throw new Error('Respuesta vacía del modelo al generar perfil de protagonista');
    }

    responseText = responseText.replace(/```json/gi, '').replace(/```/g, '').trim();

    const parsed = JSON.parse(responseText);
    return normalizeProtagonistProfile(parsed);
  } catch (error) {
    console.error('⚠️ Error generando perfil del protagonista:', error);
    return null;
  }
}

function normalizeProtagonistProfile(rawProfile) {
  if (!rawProfile || typeof rawProfile !== 'object') {
    return null;
  }

  const profile = {
    name: (rawProfile.name || rawProfile.protagonist || 'Main Protagonist').toString().trim(),
    gender: (rawProfile.gender || rawProfile.sex || 'Unspecified gender').toString().trim(),
    age: (rawProfile.age || rawProfile.ageDescription || 'Unspecified age').toString().trim(),
    skinTone: (rawProfile.skinTone || rawProfile.skin || 'Neutral skin tone').toString().trim(),
    hair: (rawProfile.hair || rawProfile.hairDescription || rawProfile.hairStyle || 'Unspecified hair').toString().trim(),
    eyes: (rawProfile.eyes || rawProfile.eyeColor || 'Unspecified eye color').toString().trim(),
    clothing: (rawProfile.clothing || rawProfile.attire || 'Characteristic outfit').toString().trim(),
    personality: (rawProfile.personality || rawProfile.personalityTraits || rawProfile.traits || 'Consistent, memorable demeanor').toString().trim(),
    uniqueFeatures: (rawProfile.uniqueFeatures || rawProfile.distinctiveTraits || rawProfile.signatureDetails || 'Memorable distinguishing features').toString().trim(),
    role: (rawProfile.role || rawProfile.background || 'Central protagonist driving the narrative').toString().trim(),
    promptSnippet: rawProfile.promptSnippet ? rawProfile.promptSnippet.toString().trim() : '',
    notes: rawProfile.notes ? rawProfile.notes.toString().trim() : ''
  };

  profile.promptSnippet = createProtagonistPromptSnippet(profile);

  return profile;
}

function buildProtagonistStyleFile(profile) {
  const lines = [
    'PROTAGONIST_STYLE_GUIDE',
    '========================',
    `NAME: ${profile.name}`,
    `GENDER: ${profile.gender}`,
    `AGE: ${profile.age}`,
    `SKIN_TONE: ${profile.skinTone}`,
    `HAIR: ${profile.hair}`,
    `EYES: ${profile.eyes}`,
    `OUTFIT: ${profile.clothing}`,
    `PERSONALITY: ${profile.personality}`,
    `UNIQUE_FEATURES: ${profile.uniqueFeatures}`,
    `ROLE: ${profile.role}`
  ];

  if (profile.notes) {
    lines.push(`NOTES: ${profile.notes}`);
  }

  const snippet = profile.promptSnippet || createProtagonistPromptSnippet(profile);
  lines.push(`PROMPT_SNIPPET: ${snippet}`);
  lines.push('');
  lines.push('INSTRUCTIONS:');
  lines.push('- Use this style guide to keep the protagonist visually consistent in every scene.');
  lines.push('- When the protagonist appears, repeat these physical traits, wardrobe, and demeanor verbatim.');
  lines.push('- Maintain continuity across all prompts, even when the context or environment changes.');

  return `${lines.join('\n')}\n`;
}

function parseProtagonistFileContent(content) {
  if (!content || typeof content !== 'string') {
    return null;
  }

  const profile = {};
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const match = line.match(/^([A-Z_]+):\s*(.+)$/);
    if (!match) {
      continue;
    }

    const key = match[1];
    const value = match[2].trim();

    switch (key) {
      case 'NAME':
        profile.name = value;
        break;
      case 'GENDER':
        profile.gender = value;
        break;
      case 'AGE':
        profile.age = value;
        break;
      case 'SKIN_TONE':
        profile.skinTone = value;
        break;
      case 'HAIR':
        profile.hair = value;
        break;
      case 'EYES':
        profile.eyes = value;
        break;
      case 'OUTFIT':
        profile.clothing = value;
        break;
      case 'PERSONALITY':
        profile.personality = value;
        break;
      case 'UNIQUE_FEATURES':
        profile.uniqueFeatures = value;
        break;
      case 'ROLE':
        profile.role = value;
        break;
      case 'NOTES':
        profile.notes = value;
        break;
      case 'PROMPT_SNIPPET':
        profile.promptSnippet = value;
        profile._rawPromptSnippet = value;
        break;
      default:
        break;
    }
  }

  if (!Object.keys(profile).length) {
    return null;
  }

  const sanitizedSnippet = createProtagonistPromptSnippet(profile);
  profile.promptSnippet = sanitizedSnippet;
  if (!profile._rawPromptSnippet) {
    profile._rawPromptSnippet = sanitizedSnippet;
  }

  return profile;
}

const EMOTION_KEYWORDS = [
  'sorrowful', 'sorrow', 'sad', 'sadness', 'melancholic', 'melancholy', 'grief', 'grieving', 'anguish', 'anguished',
  'angry', 'anger', 'furious', 'furiousness', 'joyful', 'joy', 'excited', 'exciting', 'hopeful', 'hope', 'despair',
  'desperate', 'resigned', 'determined', 'worried', 'anxious', 'anxiety', 'fearful', 'fear', 'afraid', 'smiling',
  'smile', 'grinning', 'frowning', 'grim', 'stoic', 'serene', 'calm', 'gentle', 'resilient', 'burdened', 'lonely',
  'loss', 'lost', 'guilt', 'bitter', 'bitterness', 'despairing', 'uncertain', 'mourning', 'solemn', 'brooding',
  'introspective', 'pensive', 'contemplative', 'emotional', 'emotion', 'tired', 'weary', 'sadly', 'tearful', 'teary',
  'expressive'
];

function sanitizeDescriptorText(text) {
  if (!text) {
    return '';
  }

  let sanitized = text.toString();
  sanitized = sanitized.replace(/[.;]/g, ',');

  for (const word of EMOTION_KEYWORDS) {
    const regex = new RegExp(`\b${escapeRegExp(word)}\b`, 'gi');
    sanitized = sanitized.replace(regex, '');
  }

  sanitized = sanitized.replace(/\s*,\s*,+/g, ', ');
  sanitized = sanitized.replace(/\s+/g, ' ').trim();
  sanitized = sanitized.replace(/^,|,$/g, '');

  return sanitized;
}

function appendDescriptor(descriptors, value, fallbackSuffix = '') {
  const sanitized = sanitizeDescriptorText(value);
  if (!sanitized) {
    return;
  }

  const lower = sanitized.toLowerCase();
  if (fallbackSuffix && !lower.includes(fallbackSuffix.trim().toLowerCase())) {
    descriptors.push(`${sanitized} ${fallbackSuffix}`.trim());
  } else {
    descriptors.push(sanitized);
  }
}

function createProtagonistPromptSnippet(profile) {
  if (!profile) {
    return '';
  }

  const name = profile.name || 'the protagonist';
  const descriptors = [];

  const demographic = sanitizeDescriptorText([profile.age, profile.gender].filter(Boolean).join(' '));
  if (demographic) {
    descriptors.push(demographic);
  }

  appendDescriptor(descriptors, profile.skinTone, 'skin');
  appendDescriptor(descriptors, profile.hair, 'hair');
  appendDescriptor(descriptors, profile.eyes, 'eyes');
  appendDescriptor(descriptors, profile.uniqueFeatures);
  appendDescriptor(descriptors, profile.clothing);

  const uniqueDescriptors = Array.from(new Set(descriptors)).filter(Boolean);
  const descriptorSentence = uniqueDescriptors.join(', ');

  if (!descriptorSentence) {
    return `Maintain ${name}'s physical characteristics and wardrobe consistently in every appearance.`;
  }

  return `Maintain ${name}'s physical traits: ${descriptorSentence}. Keep these details identical in every appearance.`;
}

function formatProtagonistInstructionBlock(profile) {
  if (!profile) {
    return '';
  }

  const lines = [];

  if (profile.name) {
    lines.push(`• Name: ${profile.name}`);
  }
  if (profile.gender || profile.age) {
    const demo = sanitizeDescriptorText([profile.gender, profile.age].filter(Boolean).join(', '));
    if (demo) {
      lines.push(`• Demographics: ${demo}`);
    }
  }
  if (profile.skinTone) {
    const skin = sanitizeDescriptorText(profile.skinTone);
    if (skin) {
      lines.push(`• Skin tone: ${skin}`);
    }
  }
  if (profile.hair) {
    const hair = sanitizeDescriptorText(profile.hair);
    if (hair) {
      lines.push(`• Hair: ${hair}`);
    }
  }
  if (profile.eyes) {
    const eyes = sanitizeDescriptorText(profile.eyes);
    if (eyes) {
      lines.push(`• Eye color: ${eyes}`);
    }
  }
  if (profile.clothing) {
    const outfit = sanitizeDescriptorText(profile.clothing);
    if (outfit) {
      lines.push(`• Outfit: ${outfit}`);
    }
  }
  if (profile.uniqueFeatures) {
    const unique = sanitizeDescriptorText(profile.uniqueFeatures);
    if (unique) {
      lines.push(`• Unique features: ${unique}`);
    }
  }
  // Personality cues intentionally omitted to focus on physical traits only

  const snippet = profile.promptSnippet || createProtagonistPromptSnippet(profile);
  if (snippet) {
    lines.push(`• Prompt directive: ${snippet}`);
  }

  return lines.join('\n');
}

function determineMaxProtagonistPrompts(imageCount = 0) {
  if (!Number.isFinite(imageCount) || imageCount <= 0) {
    return 0;
  }

  if (imageCount <= 2) {
    return 1;
  }

  if (imageCount <= 4) {
    return Math.max(1, Math.ceil(imageCount * 0.5));
  }

  const calculated = Math.floor(imageCount * 0.3);
  return Math.max(1, calculated);
}

function extractStyleCuesFromPrompt(prompt = '') {
  if (!prompt) {
    return [];
  }

  const sentences = prompt
    .split(/(?<=[.!?])\s+/)
    .map(sentence => sentence.trim())
    .filter(Boolean);

  return sentences.filter(sentence =>
    /style|stylized|cartoon|dramatic|graphic|texture|lines|palette|lighting|hand-drawn|flat shading|pencil|chiaroscuro|cinematic|aesthetic|2d|3d|painted|illustrated|rendered|atmosphere|tone|color palette/i.test(sentence)
  );
}

const PROMPT_VARIETY_STOP_WORDS = new Set([
  'the', 'and', 'with', 'from', 'into', 'onto', 'over', 'under', 'near', 'into', 'through', 'about', 'como', 'con', 'para', 'entre', 'sobre', 'ante', 'tras', 'desde', 'sin', 'una', 'unas', 'los', 'las', 'del', 'por', 'into', 'around', 'toward', 'towards', 'during', 'while', 'cuando', 'donde', 'this', 'that', 'those', 'these', 'cada', 'cada', 'este', 'esta', 'estos', 'estas', 'hacia', 'entre', 'solo', 'solo', 'muy', 'más', 'menos', 'both', 'just', 'still', 'only', 'into', 'across', 'hasta', 'desde', 'luego', 'then', 'after', 'before', 'upon', 'amid', 'amidst', 'throughout', 'within'
]);

function tokenizeForNarrativeVariety(prompt = '') {
  if (!prompt) {
    return [];
  }

  return prompt
    .toLowerCase()
    .replace(/[^a-z0-9áéíóúüñ\s-]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token && token.length >= 4 && !PROMPT_VARIETY_STOP_WORDS.has(token));
}

function getLeadingPhrase(prompt = '', maxWords = 6) {
  if (!prompt) {
    return '';
  }

  const words = prompt.trim().split(/\s+/).slice(0, maxWords);
  return words.join(' ').toLowerCase();
}

function computeJaccardSimilarity(tokensA = [], tokensB = []) {
  if (!tokensA.length || !tokensB.length) {
    return 0;
  }

  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  let intersection = 0;

  for (const token of setA) {
    if (setB.has(token)) {
      intersection += 1;
    }
  }

  const union = setA.size + setB.size - intersection;
  if (union === 0) {
    return 0;
  }

  return intersection / union;
}

function identifyRepeatedMotifs(prompts = [], minFrequency = 3) {
  if (!Array.isArray(prompts) || prompts.length === 0) {
    return [];
  }

  const counts = new Map();

  for (const prompt of prompts) {
    const tokens = new Set(tokenizeForNarrativeVariety(prompt));
    for (const token of tokens) {
      counts.set(token, (counts.get(token) || 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .filter(([, count]) => count >= minFrequency)
    .sort((a, b) => b[1] - a[1])
    .map(([token]) => token)
    .slice(0, 12);
}

function evaluatePromptFocus(prompt, protagonistProfile, index = 0) {
  const text = (prompt || '').toString();
  const lower = text.toLowerCase();

  const altKeywords = ['protagonist', 'main character', 'main hero', 'heroine', 'lead character'];

  let nameMentions = 0;
  if (protagonistProfile?.name) {
    const nameRegex = new RegExp(`\\b${escapeRegExp(protagonistProfile.name)}\\b`, 'gi');
    const matches = text.match(nameRegex);
    nameMentions = matches ? matches.length : 0;
  }

  const snippetMention = protagonistProfile?.promptSnippet
    ? new RegExp(escapeRegExp(protagonistProfile.promptSnippet), 'i').test(text)
    : false;

  const keywordMention = altKeywords.some((keyword) => lower.includes(keyword));
  const mentionsProtagonist = nameMentions > 0 || snippetMention || keywordMention;

  const closeUpRegex = /\b(close[-\s]?up|closeup|portrait|headshot|tight shot|tight framing|profile shot)\b/i;
  const mentionsCloseUp = closeUpRegex.test(text);

  const faceFocusRegex = /\bface(s)?\b|\bprofile\b|\bfacial\b|\beyes\b|\bgaze\b|\bexpressions?\b/i;
  const focusIndicators = /\b(focus(?:es|ed)? on|camera (?:focus|lingers)|center(?:ed)? on|framed around|spotlight|staring at)\b/i;

  const weight =
    (nameMentions * 5) +
    (snippetMention ? 4 : 0) +
    (keywordMention ? 3 : 0) +
    (mentionsCloseUp ? 6 : 0) +
    (faceFocusRegex.test(text) ? 2 : 0) +
    (focusIndicators.test(text) ? 1 : 0);

  return {
    index,
    prompt: text,
    mentionsProtagonist,
    mentionsCloseUp,
    weight
  };
}

async function enforcePromptDiversity({
  prompts,
  protagonistProfile,
  maxProtagonistPrompts,
  scriptSegments = [],
  imageInstructions = '',
  model,
  storyWorldContext = null,
  storyTopic = ''
}) {
  if (!Array.isArray(prompts) || !prompts.length || !model) {
    return { prompts, adjustedCount: 0 };
  }

  const evaluations = prompts.map((prompt, index) => evaluatePromptFocus(prompt, protagonistProfile, index));

  let protagonistMentions = evaluations.filter((entry) => entry.mentionsProtagonist).length;
  const adjustments = new Set();

  const maxIterations = 2;
  let iteration = 0;

  while (protagonistMentions > maxProtagonistPrompts && iteration < maxIterations) {
    iteration += 1;
    const excess = protagonistMentions - maxProtagonistPrompts;

    const candidates = evaluations
      .filter((entry) => entry.mentionsProtagonist)
      .sort((a, b) => b.weight - a.weight);

    if (!candidates.length) {
      break;
    }

    let processed = 0;

    for (const candidate of candidates) {
      if (processed >= excess) {
        break;
      }

      const segment = Array.isArray(scriptSegments) ? scriptSegments[candidate.index] : null;
      const rewriteResult = await rewritePromptWithBroaderFocus({
        model,
        originalPrompt: prompts[candidate.index],
        segment,
        protagonistProfile,
        imageInstructions,
        storyWorldContext,
        storyTopic,
        noveltyTargets: prompts.filter((_, idx) => idx !== candidate.index)
      });

      if (rewriteResult && rewriteResult.prompt) {
        prompts[candidate.index] = rewriteResult.prompt.trim();
        evaluations[candidate.index] = evaluatePromptFocus(prompts[candidate.index], protagonistProfile, candidate.index);
        adjustments.add(candidate.index);
        processed += 1;
      }
    }

    const updatedMentions = evaluations.filter((entry) => entry.mentionsProtagonist).length;

    if (updatedMentions === protagonistMentions) {
      // No improvement, stop to avoid infinite loop
      break;
    }

    protagonistMentions = updatedMentions;
  }

  return {
    prompts,
    adjustedCount: adjustments.size
  };
}

async function enforceNarrativeVariety({
  prompts,
  scriptSegments = [],
  model,
  protagonistProfile = null,
  imageInstructions = '',
  storyWorldContext = null,
  storyTopic = ''
}) {
  if (!Array.isArray(prompts) || prompts.length < 2 || !model) {
    return { prompts, adjustedCount: 0 };
  }

  const analyses = prompts.map((prompt, index) => ({
    index,
    prompt,
    tokens: tokenizeForNarrativeVariety(prompt),
    leadingPhrase: getLeadingPhrase(prompt),
    segment: Array.isArray(scriptSegments) ? scriptSegments[index] : null
  }));

  const similarityThreshold = 0.62;
  const leadingPhraseWords = 4;
  const maxIterations = 2;
  const rewritten = new Set();
  let iteration = 0;
  let totalAdjustments = 0;

  const allPromptsSnapshot = () => analyses.map(({ prompt }) => prompt);

  while (iteration < maxIterations) {
    iteration += 1;
    let changesThisRound = 0;

    for (let i = 0; i < analyses.length; i += 1) {
      const a = analyses[i];
      for (let j = i + 1; j < analyses.length; j += 1) {
        const b = analyses[j];

        if (rewritten.has(b.index)) {
          continue;
        }

        const leadingMatch = a.leadingPhrase && b.leadingPhrase && a.leadingPhrase === b.leadingPhrase && a.leadingPhrase.split(' ').length >= leadingPhraseWords;
        const similarity = computeJaccardSimilarity(a.tokens, b.tokens);

        if (!leadingMatch && similarity < similarityThreshold) {
          continue;
        }

        const target = b.tokens.length >= a.tokens.length ? b : a;
        const segment = target.segment;
        const rewriteResult = await rewritePromptWithBroaderFocus({
          model,
          originalPrompt: target.prompt,
          segment,
          protagonistProfile,
          imageInstructions,
          storyWorldContext,
          storyTopic,
          noveltyTargets: allPromptsSnapshot().filter((_, idx) => idx !== target.index)
        });

        if (rewriteResult?.prompt) {
          prompts[target.index] = rewriteResult.prompt.trim();
          analyses[target.index] = {
            index: target.index,
            prompt: prompts[target.index],
            tokens: tokenizeForNarrativeVariety(prompts[target.index]),
            leadingPhrase: getLeadingPhrase(prompts[target.index]),
            segment
          };
          rewritten.add(target.index);
          changesThisRound += 1;
          totalAdjustments += 1;
        }

        if (changesThisRound >= prompts.length) {
          break;
        }
      }

      if (changesThisRound >= prompts.length) {
        break;
      }
    }

    if (changesThisRound === 0) {
      break;
    }
  }

  return {
    prompts,
    adjustedCount: totalAdjustments
  };
}

async function rewritePromptWithBroaderFocus({
  model,
  originalPrompt,
  segment,
  protagonistProfile,
  imageInstructions = '',
  storyWorldContext = null,
  storyTopic = '',
  noveltyTargets = []
}) {
  if (!model || !originalPrompt) {
    return null;
  }

  const protagonistName = protagonistProfile?.name || 'the protagonist';
  const segmentText = segment?.text ? segment.text.trim() : '';
  const styleCues = extractStyleCuesFromPrompt(originalPrompt);
  const styleGuidance = styleCues.length
    ? `Reuse these style descriptors verbatim when they remain coherent:\n${styleCues.map((cue) => `- ${cue}`).join('\n')}`
    : 'Preserve the same art style cues described in the original prompt.';

  const visualInstructions = imageInstructions && imageInstructions.trim()
    ? imageInstructions.trim()
    : 'Maintain the cinematic, atmospheric qualities already established.';

  const noveltyGuidance = (() => {
    if (!Array.isArray(noveltyTargets) || noveltyTargets.length === 0) {
      return 'Highlight fresh narrative elements from this segment that have not yet been emphasized (new props, actions, emotions, or symbolic details).';
    }

    const leadingPhrases = noveltyTargets
      .map((prompt) => getLeadingPhrase(prompt))
      .filter(Boolean)
      .slice(0, 5);

    const motifThreshold = Math.max(2, Math.ceil(noveltyTargets.length * 0.35));
    const repeatedMotifs = identifyRepeatedMotifs(noveltyTargets, motifThreshold);

    const lines = ['Highlight fresh narrative elements from this segment that earlier prompts did not foreground (new props, actions, emotions, or symbolic consequences).'];

    if (leadingPhrases.length) {
      lines.push(`Do not start with phrases similar to: ${leadingPhrases.map((phrase) => `"${phrase}"`).join(', ')}.`);
    }

    if (repeatedMotifs.length) {
      lines.push(`Avoid repeating overused motifs or nouns such as: ${repeatedMotifs.join(', ')}.`);
    }

    lines.push('Change the vantage point or composition compared to earlier prompts (e.g., shift from interior to exterior, macro to micro, or different character focus).');

    return lines.join('\n');
  })();

  const worldContextSummary = (() => {
    if (!storyWorldContext) {
      return storyTopic
        ? `Infer and explicitly state the most coherent era/year, location, architectural style and dominant cultures or species aligned with the topic "${storyTopic}". Keep those details consistent.`
        : 'Deduce and explicitly state the era/year, location, architectural style and dominant cultures or species implied by the script. Keep those choices consistent across prompts.';
    }

    const lines = [];
    const era = [storyWorldContext.specificYearOrEra, storyWorldContext.timePeriod]
      .filter(Boolean)
      .map((item) => item.trim())
      .join(' – ');
    if (era) {
      lines.push(`Era/Year: ${era}`);
    }
    if (storyWorldContext.primaryLocations?.length) {
      lines.push(`Primary locations: ${storyWorldContext.primaryLocations.join(', ')}`);
    }
    if (storyWorldContext.architecturalStyles?.length) {
      lines.push(`Architectural/environment styles: ${storyWorldContext.architecturalStyles.join(', ')}`);
    }
    if (storyWorldContext.dominantCivilizationsOrCultures?.length) {
      lines.push(`Civilizations/Cultures: ${storyWorldContext.dominantCivilizationsOrCultures.join(', ')}`);
    }
    if (storyWorldContext.characterEthnicitiesOrSpecies?.length) {
      lines.push(`Character ethnicities/species: ${storyWorldContext.characterEthnicitiesOrSpecies.join(', ')}`);
    }
    if (storyWorldContext.technologyLevel) {
      lines.push(`Technology level: ${storyWorldContext.technologyLevel}`);
    }
    if (storyWorldContext.environmentalMood) {
      lines.push(`Environmental mood: ${storyWorldContext.environmentalMood}`);
    }
    if (storyWorldContext.additionalKeywords?.length) {
      lines.push(`Recurring motifs: ${storyWorldContext.additionalKeywords.join(', ')}`);
    }
    if (storyWorldContext.consistencyNotes) {
      lines.push(`Consistency notes: ${storyWorldContext.consistencyNotes}`);
    }
    if (storyWorldContext.uncertaintyNotes) {
      lines.push(`Uncertainty notes: ${storyWorldContext.uncertaintyNotes}`);
    }

    const joined = lines.join('\n');
    const topicLine = storyTopic ? `Project/topic focus: "${storyTopic}".` : '';

    return `${topicLine}${topicLine ? '\n' : ''}Maintain these canonical world details:\n${joined}\nExplicitly reference the era/year, location, architecture and cultural or racial context when rewriting.`;
  })();

  const directive = `You are refining an image-generation prompt to reduce focus on ${protagonistName} while preserving the canonical historical and cultural context.

SCRIPT SEGMENT CONTEXT:
"""${segmentText}
"""

ORIGINAL PROMPT:
"""${originalPrompt}
"""

GOAL:
- Produce one new prompt in English (3-4 sentences) that emphasizes environment, props, symbolic elements, or supporting characters instead of centering ${protagonistName}.
- Mention ${protagonistName} only if absolutely necessary for comprehension, and never describe their face directly; prefer silhouettes, distant placement, or indirect traces of their presence.
- Avoid close-up or portrait framing unless it targets an object or secondary subject unrelated to ${protagonistName}'s face.
- Highlight spatial depth, atmosphere, and narrative continuity drawn from the script segment.
- ${styleGuidance}
- Honor the user's visual instructions: ${visualInstructions}
- ${worldContextSummary}
- Explicitly mention the relevant era/year, location, architecture, dominant civilizations or cultures, and character ethnicities/species in the revised prompt.
- ${noveltyGuidance.split('\n').join('\n- ')}
- Keep the tone cinematic, richly detailed, and consistent with the ongoing story. No bullet points or numbering.

Return only the rewritten prompt.`;

  try {
    const result = await model.generateContent({
      contents: [{ parts: [{ text: directive }] }],
      generationConfig: {
        thinkingConfig: {
          thinkingBudget: 0, // Disables thinking
        }
      }
    });
    const responseText = result?.response?.text?.()
      || result?.response?.candidates?.[0]?.content?.parts?.[0]?.text
      || '';

    const rewritten = responseText.trim();
    if (!rewritten) {
      return null;
    }

    return {
      prompt: rewritten
    };
  } catch (error) {
    console.error('⚠️ Error reescribiendo prompt para diversificar enfoque:', error.message || error);
    return null;
  }
}

function escapeRegExp(str = '') {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
const IMAGE_BATCH_SIZE = 10;
const IMAGE_BATCH_DELAY_MS = 10_000;

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function isQuotaError(error) {
  if (!error) return false;
  const message = String(error.message || error).toLowerCase();
  return message.includes('quota') || message.includes('quota_exceeded') || error.status === 429;
}

async function attemptGoogleGeneration({ prompt, imageName, outputDir, aspectRatio, checkCancellation, apiKeyPreferences = null, modelType = IMAGE_MODEL_DEFAULT }) {
  const hasCustomPreferences = Array.isArray(apiKeyPreferences) && apiKeyPreferences.length > 0;
  const apiKeys = hasCustomPreferences
    ? apiKeyPreferences.filter((api) => api && api.key)
    : resolveGoogleImageApiSelection();

  if (!apiKeys.length) {
    throw new Error('No hay API keys de Google configuradas para generar imágenes.');
  }

  let lastError = null;
  let totalAttempts = 0;

  for (let round = 1; round <= GOOGLE_API_MAX_ROUNDS; round += 1) {
    console.log(`🔁 Ronda ${round}/${GOOGLE_API_MAX_ROUNDS}: intentando con APIs de Google (${apiKeys.map((api) => api.shortName || api.id).join(', ')})`);

    for (const apiKeyInfo of apiKeys) {
      if (typeof checkCancellation === 'function') {
        checkCancellation();
      }

      totalAttempts += 1;
      const providerLabel = apiKeyInfo.shortName || apiKeyInfo.label || apiKeyInfo.id || 'DESCONOCIDA';
      console.log(`🔸 Intentando con Google Gemini ${providerLabel} (ronda ${round}, intento ${totalAttempts})...`);

      try {
        const imageResult = await generateImageWithGoogleApi({
          prompt,
          imageName,
          outputDir,
          apiInfo: apiKeyInfo,
          aspectRatio,
          modelType
        });

        if (imageResult && imageResult.success) {
          console.log(`✅ Google Gemini ${providerLabel} generó la imagen en la ronda ${round}.`);
          return {
            success: true,
            filename: imageResult.filename,
            filepath: imageResult.filepath,
            method: imageResult.method,
            provider: imageResult.provider,
            generator: 'google',
            googleAttempts: totalAttempts
          };
        }

        const warningMessage = imageResult?.error || 'Respuesta sin éxito del modelo';
        console.log(`⚠️ Google Gemini ${providerLabel} no generó imagen (ronda ${round}, intento ${totalAttempts}):`);
        lastError = new Error(`Google Gemini ${providerLabel} no generó imagen`);
      } catch (error) {
        lastError = error;
        const message = error?.message || 'Error desconocido';
        console.log(`⚠️ Google Gemini ${providerLabel} falló (ronda ${round}, intento ${totalAttempts}):`);
      }
    }

    if (round < GOOGLE_API_MAX_ROUNDS) {
      console.log(`⏳ Todas las APIs seleccionadas fallaron en la ronda ${round}. Esperando ${Math.round(GOOGLE_API_ROUND_DELAY_MS / 1000)} segundos antes de reintentar...`);
      if (typeof checkCancellation === 'function') {
        checkCancellation();
      }
      await delay(GOOGLE_API_ROUND_DELAY_MS);
      if (typeof checkCancellation === 'function') {
        checkCancellation();
      }
    }
  }

  const failureError = lastError || new Error('No se pudo generar imagen con Google Gemini.');
  failureError.googleAttempts = totalAttempts;
  if (!failureError.code && isQuotaError(failureError)) {
    failureError.code = 'NO_API_CREDITS';
  }
  throw failureError;
}

async function attemptComfyGeneration({ prompt, imageName, outputDir, aspectRatio, fallbackConfig }) {
  const aspectInfo = describeAspectRatio(aspectRatio);
  const safeAspectRatio = aspectInfo.ratio;
  console.log(`🔸 Fallback: Intentando generación con ComfyUI (${aspectInfo.label})...`);
  const comfyResult = await generateComfyUIImage(
    prompt,
    imageName,
    outputDir,
    fallbackConfig || {},
    safeAspectRatio
  );

  if (comfyResult && comfyResult.success) {
    return {
      success: true,
      filename: comfyResult.filename,
      filepath: comfyResult.path,
      method: 'ComfyUI (Fallback)',
      provider: 'ComfyUI',
      generator: 'comfy'
    };
  }

  const comfyError = comfyResult && comfyResult.error ? new Error(comfyResult.error) : null;
  throw comfyError || new Error('Error desconocido en ComfyUI');
}

async function processPromptGenerationTask(task, options) {
  const {
    aspectRatio,
    fallbackConfigProvider,
    allowComfyFallback = true,
    checkCancellation = null,
    googleApiPreferences = null,
    forceComfyOnly = false,
    imageModel = IMAGE_MODEL_DEFAULT
  } = options;

  const normalizedImageModel = normalizeImageModel(imageModel);

  let comfyEnabled = forceComfyOnly || !!allowComfyFallback;
  let fallbackConfig = {};

  if (!comfyEnabled) {
    fallbackConfig = false;
  } else if (typeof fallbackConfigProvider === 'function') {
    const providedConfig = fallbackConfigProvider(task);
    if (providedConfig === false) {
      comfyEnabled = false;
      fallbackConfig = false;
    } else {
      fallbackConfig = providedConfig || {};
    }
  }

  let lastError = null;
  let googleAttempts = 0;

  let googleResult = null;
  if (!forceComfyOnly) {
    try {
      if (typeof checkCancellation === 'function') {
        checkCancellation();
      }

      const result = await attemptGoogleGeneration({
        prompt: task.prompt,
        imageName: task.imageName,
        outputDir: task.outputDir,
        aspectRatio,
        checkCancellation,
        apiKeyPreferences: googleApiPreferences,
        modelType: normalizedImageModel
      });

      googleAttempts = result.googleAttempts || 0;
      googleResult = {
        success: true,
        promptIndex: task.promptIndex,
        imageNumber: task.imageNumber,
        filename: result.filename,
        filepath: result.filepath,
        method: result.method,
        provider: result.provider,
        generator: result.generator,
        googleAttempts,
        retries: Math.max(googleAttempts - 1, 0),
        model: normalizedImageModel
      };
    } catch (error) {
      lastError = error;
      googleAttempts = error?.googleAttempts || 0;
      const message = error?.message || 'Error desconocido';
      console.log(`⚠️ Error generando imagen (prompt ${task.imageNumber}) con APIs de Google:`);
    }
  }

  if (googleResult) {
    return googleResult;
  }

  if (!comfyEnabled) {
    const quotaError = lastError || new Error('Las APIs de generación de imágenes ya no tienen créditos disponibles.');
    if (!quotaError.code) {
      quotaError.code = isQuotaError(quotaError) ? 'NO_API_CREDITS' : 'GOOGLE_GENERATION_FAILED';
    }
    if (isQuotaError(quotaError)) {
      quotaError.isApiCreditsExhausted = true;
    }

    return {
      success: false,
      promptIndex: task.promptIndex,
      imageNumber: task.imageNumber,
      error: quotaError,
      googleAttempts,
      isApiCreditsExhausted: !!quotaError.isApiCreditsExhausted
    };
  }

  try {
    if (typeof checkCancellation === 'function') {
      checkCancellation();
    }
    const fallbackResult = await attemptComfyGeneration({
      prompt: task.prompt,
      imageName: task.imageName,
      outputDir: task.outputDir,
      aspectRatio,
      fallbackConfig
    });

    return {
      success: true,
      promptIndex: task.promptIndex,
      imageNumber: task.imageNumber,
      filename: fallbackResult.filename,
      filepath: fallbackResult.filepath,
      method: fallbackResult.method,
      provider: fallbackResult.provider,
      generator: fallbackResult.generator,
      googleAttempts,
      retries: googleAttempts,
      model: normalizedImageModel
    };
  } catch (fallbackError) {
    return {
      success: false,
      promptIndex: task.promptIndex,
      imageNumber: task.imageNumber,
      error: fallbackError,
      googleAttempts,
      model: normalizedImageModel
    };
  }
}

async function runPromptTasksInBatches(tasks, processor, options = {}) {
  let batchSize = IMAGE_BATCH_SIZE;
  let delayBetweenBatchesMs = 0;

  if (typeof options === 'number') {
    batchSize = Math.max(1, options);
  } else if (options && typeof options === 'object') {
    if (Number.isInteger(options.batchSize) && options.batchSize > 0) {
      batchSize = options.batchSize;
    }
    if (Number.isFinite(options.delayBetweenBatchesMs) && options.delayBetweenBatchesMs > 0) {
      delayBetweenBatchesMs = options.delayBetweenBatchesMs;
    }
  }

  const results = [];

  for (let i = 0; i < tasks.length; i += batchSize) {
    const batch = tasks.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(async (task) => {
      try {
        return await processor(task);
      } catch (error) {
        return {
          success: false,
          promptIndex: task.promptIndex,
          imageNumber: task.imageNumber,
          error
        };
      }
    }));

    results.push(...batchResults);

    if (delayBetweenBatchesMs > 0 && i + batchSize < tasks.length) {
      await delay(delayBetweenBatchesMs);
    }
  }

  return results;
}

// Función para generar imágenes con Google Gemini usando la API seleccionada
async function generateImageWithGoogleApi({ prompt, imageName, outputDir, apiInfo, aspectRatio = '9:16', modelType = IMAGE_MODEL_DEFAULT }) {
  if (!apiInfo || !apiInfo.key) {
    throw new Error('API key de Google no disponible para la generación solicitada.');
  }

  const providerLabel = apiInfo.shortName || apiInfo.label || apiInfo.id || 'DESCONOCIDA';
  const normalizedModel = normalizeImageModel(modelType);
  const modelId = resolveGoogleImageModelId(normalizedModel);
  const modelLabel = getImageModelLabel(normalizedModel);
  const aspectInfo = describeAspectRatio(aspectRatio);
  const safeAspectRatio = aspectInfo.ratio;

  try {
    console.log(`🔸 Generando imagen con Google Gemini (${providerLabel}) usando ${aspectInfo.label}: ${imageName}`);

    const genAI = new GoogleGenerativeAI(apiInfo.key);
    console.log(`🤖 Usando modelo ${modelLabel} (${modelId}) con API ${providerLabel}...`);
    const supportsAspectRatio = geminiModelSupportsAspectRatio(modelId);
    if (!supportsAspectRatio && aspectInfo.ratio !== '9:16') {
      console.log(`ℹ️ ${modelLabel} (${modelId}) no admite aspect ratios personalizados. Se usará el formato predeterminado del modelo.`);
    }

    const model = genAI.getGenerativeModel({
      model: modelId,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 1024,
        thinkingConfig: {
          thinkingBudget: 0, // Disables thinking
        }
      }
    });

    const generationConfig = {
      responseModalities: ['IMAGE', 'TEXT']
    };

    if (supportsAspectRatio) {
      generationConfig.imageConfig = {
        aspectRatio: safeAspectRatio
      };
      console.log(`📡 Enviando prompt para generación de imagen en formato ${safeAspectRatio}...`);
    } else {
      console.log('📡 Enviando prompt para generación de imagen con el formato predeterminado del modelo...');
    }

    const contents = [{
      role: 'user',
      parts: [{
        text: `Generate a ${aspectInfo.googleFormatDescription}: ${prompt}. The image should be in ${aspectInfo.googleOrientation}.`
      }]
    }];

    let stream;
    try {
      stream = await model.generateContentStream({
        contents,
        generationConfig
      });
    } catch (streamError) {
      console.log(`❌ Error creando stream de Google Gemini (${providerLabel})`);
      if (streamError.message && streamError.message.includes('Failed to parse stream')) {
        console.log(`🔄 Error de parsing de stream detectado durante creación - se considera como error recuperable`);
        const recoverableError = new Error(`Google Gemini stream creation error`);
        recoverableError.code = 'STREAM_PARSE_ERROR';
        recoverableError.isRecoverable = true;
        throw recoverableError;
      }
      throw streamError;
    }

    const { inlineImages } = await collectGeminiStreamData(stream);

    if (!inlineImages.length) {
      throw new Error('No se generaron imágenes en la respuesta');
    }

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    let savedFilePath = null;
    let savedFilename = null;

    inlineImages.forEach((inlineData, index) => {
      const mimeType = inlineData.mimeType || 'image/png';
      const buffer = Buffer.from(inlineData.data || '', 'base64');
      const fileExtension = mimeType.includes('png')
        ? 'png'
        : mimeType.includes('jpeg')
          ? 'jpg'
          : 'png';

      const timestamp = Date.now();
      const filename = `${imageName}_google_${timestamp}${index ? `_${index}` : ''}.${fileExtension}`;
      const filepath = path.join(outputDir, filename);

      fs.writeFileSync(filepath, buffer);

      console.log(`✅ Imagen generada con Google Gemini (${providerLabel}): ${filename}`);
      console.log(`📁 Guardada en: ${filepath}`);
      console.log(`📏 Tamaño: ${buffer.length} bytes`);

      if (!savedFilePath) {
        savedFilePath = filepath;
        savedFilename = filename;
      }
    });

    return {
      success: true,
      filename: savedFilename,
      filepath: savedFilePath,
      method: `Google Gemini (${providerLabel})`,
      model: modelId,
      provider: providerLabel
    };
  } catch (error) {
    console.log(`❌ Error generando imagen con Google Gemini (${providerLabel}):`);

    // Handle specific Google Gemini errors
    if (error.message.includes('Failed to parse stream') || error.message.includes('GoogleGenerativeAI')) {
      //console.log(`🔄 Error de parsing de stream de Google Gemini detectado - se considera como error recuperable`);
      // Create a specific error that will be caught by the retry logic
      const streamError = new Error(`Google Gemini stream parsing error: ${error.message}`);
      streamError.code = 'STREAM_PARSE_ERROR';
      streamError.isRecoverable = true;
      throw streamError;
    }

    if (error.message.includes('quota') || error.message.includes('QUOTA_EXCEEDED') || error.status === 429) {
      console.log(`🚫 Cuota de API ${providerLabel} agotada para imágenes`);
    }

    throw error;
  }
}// Función auxiliar para generar una imagen con ComfyUI y guardarla en una carpeta específica
async function generateComfyUIImage(prompt, imageName, outputDir, customConfig = {}, aspectRatio = '9:16') {
  try {
    console.log(`🎨 Generando imagen: ${imageName}`);
    console.log(`📁 Directorio de salida: ${outputDir}`);
    console.log(`🖼️ Prompt: ${prompt.substring(0, 100)}...`);
    const aspectInfo = describeAspectRatio(aspectRatio);
    const safeAspectRatio = aspectInfo.ratio;
    console.log(`📐 Resolución objetivo basada en ${aspectInfo.label}`);

    // Configuración dinámica basada en aspect ratio
    const defaultSteps = comfyDefaultConfig.steps || 25;
    const defaultCfg = comfyDefaultConfig.cfg || 1.8;
    const defaultGuidance = comfyDefaultConfig.guidance || 3.5;
    const resolvedDefaults = resolveComfyDefaultResolution(safeAspectRatio);
    const defaultOptions = {
      width: resolvedDefaults.width,
      height: resolvedDefaults.height,
      steps: defaultSteps,
      cfg: defaultCfg,
      guidance: defaultGuidance,
      sampler: "euler",
      scheduler: "simple",
      model: "flux1-dev-fp8.safetensors",
      negativePrompt: "low quality, blurry, distorted, text, watermark",
      timeout: 180
    };
    
    // Combinar configuración por defecto con configuración personalizada
    const options = {
      ...defaultOptions,
      ...customConfig,
      width: customConfig.width || defaultOptions.width,
      height: customConfig.height || defaultOptions.height,
      steps: customConfig.steps || defaultOptions.steps,
      guidance: customConfig.guidance || defaultOptions.guidance,
      cfg: customConfig.cfg ?? defaultOptions.cfg,
      sampler: customConfig.sampler || defaultOptions.sampler,
      scheduler: customConfig.scheduler || defaultOptions.scheduler,
      model: customConfig.model || defaultOptions.model
    };

    options.timeout = customConfig.timeout || Math.max(defaultOptions.timeout, options.steps * 6, 180);
    
    console.log(`⚙️ Configuración de generación:`, {
      resolution: `${options.width}x${options.height}`,
      steps: options.steps,
      guidance: options.guidance,
      model: options.model,
      sampler: options.sampler,
      scheduler: options.scheduler
    });
    
    // Usar la función existente de generación con auto-restart
  const result = await generateImageWithAutoRestart(prompt, options);
    
    if (result.success && result.filename) {
      // Mover la imagen generada al directorio de la sección
      const generatedImagePath = path.join(globalOutputDir, result.filename);
      const targetImageName = `${imageName}.png`;
      const targetImagePath = path.join(outputDir, targetImageName);
      
      if (fs.existsSync(generatedImagePath)) {
        // Asegurar que el directorio de destino existe
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }
        
        // Mover la imagen
        fs.renameSync(generatedImagePath, targetImagePath);
        
        console.log(`✅ Imagen movida a: ${targetImagePath}`);
        
        return {
          success: true,
          filename: targetImageName,
          path: targetImagePath,
          prompt: prompt
        };
      } else {
        console.log(`❌ No se encontró la imagen generada en: ${generatedImagePath}`);
        return {
          success: false,
          error: 'Imagen generada no encontrada'
        };
      }
    } else {
      console.log(`❌ Error en generación de imagen:`, result.error);
      return {
        success: false,
        error: result.error || 'Error desconocido en ComfyUI'
      };
    }
    
  } catch (error) {
    console.error(`❌ Error en generateComfyUIImage:`, error);
    return {
      success: false,
      error: error.message
    };
  }
}

// ENDPOINT PARA CONTINUAR CON FASE 3: GENERACIÓN DE IMÁGENES POR LOTES
app.post('/generate-batch-images', async (req, res) => {
  try {
    const {
      projectData,
      skipImages,
      googleImages,
      localAIImages,
      geminiGeneratedImages,
      imageModel,
      aspectRatio = '9:16',
      comfyUISettings,
      folderName,
      selectedApis: selectedApisInput = []
    } = req.body;
    
    console.log('\n' + '🎨'.repeat(20));
    console.log('🎨 FASE 3: GENERANDO TODAS LAS IMÁGENES');
    console.log('🎨'.repeat(20));
    
    const { sections, imagePrompts, projectKey, additionalInstructions, topic } = projectData;
    let shouldSkipImages = skipImages === true;
    let shouldUseGoogleImages = googleImages === true;
    let shouldUseLocalAI = localAIImages === true;
    let shouldUseGeminiImages = geminiGeneratedImages === true;
  const aspectInfo = describeAspectRatio(aspectRatio);
  const safeAspectRatio = aspectInfo.ratio;
  const selectedImageModel = normalizeImageModel(imageModel || projectData?.imageModel);
  const selectedImageModelLabel = getImageModelLabel(selectedImageModel);
  console.log(`🤖 Modelo de imágenes seleccionado para generación masiva: ${selectedImageModelLabel} (${selectedImageModel})`);
    const selectedApisRaw = Array.isArray(selectedApisInput) ? selectedApisInput : [];
    const googleApiPreferences = resolveGoogleImageApiSelection(selectedApisRaw);
    const hasExplicitApiSelection = selectedApisRaw.length > 0;
    
    console.log(`📝 Instrucciones adicionales recibidas: "${additionalInstructions || 'Ninguna'}"`);

    if (shouldUseGeminiImages) {
      if (!googleApiPreferences.length) {
        const errorMessage = hasExplicitApiSelection
          ? 'Las APIs seleccionadas no están disponibles o no tienen una key configurada.'
          : 'No hay API keys de Google disponibles para generar imágenes.';

        return res.status(400).json({ error: errorMessage });
      }

      console.log('🔐 APIs de Google seleccionadas para generación masiva:', googleApiPreferences.map((api) => api.label).join(', '));
    }
    
    // Crear estructura de carpetas base para este proyecto
    const baseTopic = topic || sections[0].title.split(':')[0] || 'Proyecto';
    console.log(`📐 Aspect ratio solicitado para generación masiva: ${aspectInfo.label}`);
    
    if (shouldSkipImages) {
      console.log('⏭️ Saltando generación de imágenes...');
      return res.json({
        success: true,
        phase: 'images_skipped',
        message: 'Fase 3: Generación de imágenes omitida',
        data: { projectKey: projectKey }
      });
    }

  const imageMethod = shouldUseLocalAI ? 'ComfyUI (IA Local)' : shouldUseGoogleImages ? 'Google Images' : `IA en la nube (${selectedImageModelLabel})`;
  console.log(`🖼️ Generando imágenes para ${sections.length} secciones con ${imageMethod}...`);

    const allImageResults = [];

    // Procesar cada sección
    for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
      const section = sections[sectionIndex];
      const sectionImagePrompts = imagePrompts[sectionIndex]?.prompts || [];

      if (sectionImagePrompts.length === 0) {
        console.log(`⚠️ No hay prompts de imágenes para sección ${section.section}`);
        continue;
      }

      console.log(`🎨 Generando ${sectionImagePrompts.length} imágenes para sección ${section.section}: ${section.title}`);

      // Crear estructura de carpetas individual para esta sección usando el folderName ya normalizado
      const sectionFolderStructure = createProjectStructure(baseTopic, section.section, folderName);      try {
        let sectionImages = [];
        
        if (shouldUseLocalAI) {
          // Determinar si esta es la última sección para cerrar ComfyUI
          const isLastSection = sectionIndex === sections.length - 1;
          
          // Generar con ComfyUI - los prompts ya tienen las instrucciones integradas desde Fase 1
          sectionImages = await generateLocalAIImages(
            sectionImagePrompts,
            '', // Los prompts ya vienen con instrucciones integradas desde Fase 1
            sectionFolderStructure.sectionDir,
            section.section,
            comfyUISettings,
            !isLastSection, // keepAlive = true para todas excepto la última
            safeAspectRatio
          );
          
        } else if (shouldUseGoogleImages) {
          // Buscar imágenes de Google
          console.log(`🔍 Buscando imágenes de Google para sección ${section.section}...`);
          
          // CORREGIDO: Pasar todos los keywords de una vez para generar nombres únicos
          const googleImages = await searchAndDownloadBingImages(sectionImagePrompts, sectionFolderStructure.sectionDir);
          
          if (googleImages && googleImages.length > 0) {
            googleImages.forEach((image, index) => {
              sectionImages.push({
                path: image.path,
                prompt: image.keywords,
                filename: image.filename,
                source: 'Google Images',
                index: index + 1
              });
            });
            
            // ✅ NUEVO: Crear images_metadata.json para cargar keywords posteriormente (batch)
            try {
              const metadataPath = path.join(sectionFolderStructure.sectionDir, 'images_metadata.json');
              const metadata = {};
              
              googleImages.forEach((img, index) => {
                metadata[img.filename] = {
                  originalUrl: img.url,
                  keywords: img.keywords || '',
                  timestamp: new Date().toISOString(),
                  source: 'bing',
                  section: section.section
                };
              });
              
              fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
              console.log(`📝 Metadata de imágenes guardada en: ${metadataPath} (batch section ${section.section})`);
            } catch (metadataError) {
              console.warn(`⚠️ Error guardando images_metadata.json (batch): ${metadataError.message}`);
            }
          }
          
        } else if (shouldUseGeminiImages) {
          // Generar con Google Gemini usando las APIs seleccionadas
          const availableKeys = getFreeGoogleAPIKeys();
          console.log(`🤖 Generando con Google Gemini (APIs seleccionadas: ${googleApiPreferences.map((api) => api.shortName || api.label).join(', ')})`);
          console.log(`📊 APIs gratuitas configuradas: ${availableKeys.length}`);

          const promptTasks = sectionImagePrompts.map((prompt, index) => ({
            sectionNumber: section.section,
            promptIndex: index,
            imageNumber: index + 1,
            prompt,
            imageName: `seccion_${section.section}_imagen_${index + 1}`,
            outputDir: sectionFolderStructure.sectionDir,
            imageModel: selectedImageModel
          }));

          const taskResults = await runPromptTasksInBatches(
            promptTasks,
            async (task) => {
              console.log(`🔑 Preparando generación con Google Gemini para imagen ${task.imageNumber}...`);
              return await processPromptGenerationTask(task, {
                aspectRatio: safeAspectRatio,
                fallbackConfigProvider: () => false,
                allowComfyFallback: false,
                allowCooldownRetry: true,
                cooldownRetryMs: 60000,
                googleApiPreferences,
                imageModel: selectedImageModel
              });
            }
          );

          const resultsByImage = new Map();
          taskResults.forEach(result => {
            resultsByImage.set(result.imageNumber, result);
          });

          for (const task of promptTasks) {
            const result = resultsByImage.get(task.imageNumber);

            if (result && result.success) {
              const relativePath = result.filepath
                ? path.relative('./public', result.filepath).replace(/\\/g, '/')
                : null;

              sectionImages.push({
                path: relativePath,
                prompt: task.prompt,
                filename: result.filename,
                source: result.method,
                index: task.imageNumber
              });

              if (result.retries > 0) {
                console.log(`🔁 Imagen ${task.imageNumber} generada tras ${result.retries} reintentos`);
              }
              console.log(`✅ Imagen ${task.imageNumber} generada con ${result.method}`);
            } else {
              const errorMessage = result?.error?.message || result?.error || 'Todas las API keys gratuitas fallaron';
              sectionImages.push({
                path: null,
                prompt: task.prompt,
                filename: null,
                source: 'Google Gemini Error (todas las API keys gratuitas fallaron)',
                index: task.imageNumber,
                error: errorMessage
              });
              console.error(`❌ Error generando imagen ${task.imageNumber}: ${errorMessage}`);
            }
          }
          
        } else {
          console.log(`⚠️ Método de generación de imágenes no reconocido, saltando sección ${section.section}...`);
        }
        
        // Guardar los prompts de esta sección en archivo TXT
        try {
          const promptsFileName = `${createSafeFolderName(baseTopic)}_seccion_${section.section}_prompts_imagenes.txt`;
          const promptsFilePath = path.join(sectionFolderStructure.sectionDir, promptsFileName);
          
          const promptsContent = `PROMPTS DE IMÁGENES - SECCIÓN ${section.section}
===============================
Tema: ${baseTopic}
Sección: ${section.section} de ${sections.length}
Título: ${section.title}
Cantidad de prompts: ${sectionImagePrompts.length}
Fecha de generación: ${new Date().toLocaleString()}
${folderName ? `Nombre del proyecto: ${folderName}` : ''}
Método de generación: ${imageMethod}

PROMPTS GENERADOS:
${sectionImagePrompts.map((prompt, index) => `
${index + 1}. ${prompt.trim()}
`).join('')}

===============================
ESTADÍSTICAS DE GENERACIÓN:
- Prompts totales: ${sectionImagePrompts.length}
- Imágenes exitosas: ${sectionImages.filter(img => img.path).length}
- Imágenes fallidas: ${sectionImages.filter(img => !img.path).length}

===============================
Generado automáticamente por el sistema de creación de contenido (Modo Batch)
`;
          
          fs.writeFileSync(promptsFilePath, promptsContent, 'utf8');
          console.log(`📝 Prompts de sección ${section.section} guardados en: ${promptsFilePath}`);
          
        } catch (saveError) {
          console.error(`❌ Error guardando prompts de sección ${section.section}:`, saveError);
          // No detener el proceso por este error, solo registrarlo
        }
        
        allImageResults.push({
          section: section.section,
          title: section.title,
          images: sectionImages,
          success: sectionImages.filter(img => img.path).length > 0
        });
        
        const successfulImages = sectionImages.filter(img => img.path).length;
        console.log(`✅ Sección ${section.section}: ${successfulImages}/${sectionImagePrompts.length} imágenes generadas`);

        // 📊 GUARDADO PROGRESIVO: Actualizar progreso después de cada sección de imágenes
        try {
          const progressData = updateProjectProgress(projectKey, 'images', sectionIndex + 1, sections.length);
          
          // Guardar estado del proyecto con imágenes completadas hasta ahora
          const updatedProjectData = {
            ...projectData,
            imageResults: allImageResults,
            imageMethod: imageMethod,
            imageConfig: shouldUseLocalAI ? { 
              method: 'localAI', 
              settings: comfyUISettings 
            } : shouldUseGoogleImages ? { 
              method: 'google' 
            } : { 
              method: 'cloud', 
              model: imageModel 
            },
            phase: 'images',
            lastUpdate: new Date().toISOString()
          };
          
          await saveProgressiveProjectState(projectKey, updatedProjectData, progressData);
          
          console.log(`📊 Progreso guardado: Sección ${sectionIndex + 1}/${sections.length} imágenes (${progressData.percentage}%) - Tiempo estimado restante: ${progressData.estimatedTimeRemaining}`);
          
        } catch (progressError) {
          console.error('⚠️ Error guardando progreso de imágenes:', progressError.message);
          // No interrumpir la generación por errores de guardado
        }
        
      } catch (error) {
        console.error(`❌ Error generando imágenes para sección ${section.section}:`, error);
        allImageResults.push({
          section: section.section,
          title: section.title,
          images: [],
          success: false,
          error: error.message
        });

        // 📊 GUARDADO PROGRESIVO: Actualizar progreso incluso en caso de error
        try {
          const progressData = updateProjectProgress(projectKey, 'images', sectionIndex + 1, sections.length);
          
          const updatedProjectData = {
            ...projectData,
            imageResults: allImageResults,
            imageMethod: imageMethod,
            imageConfig: shouldUseLocalAI ? { 
              method: 'localAI', 
              settings: comfyUISettings 
            } : shouldUseGoogleImages ? { 
              method: 'google' 
            } : { 
              method: 'cloud', 
              model: imageModel 
            },
            phase: 'images',
            lastUpdate: new Date().toISOString()
          };
          
          await saveProgressiveProjectState(projectKey, updatedProjectData, progressData);
          
          console.log(`📊 Progreso guardado (con error): Sección ${sectionIndex + 1}/${sections.length} imágenes (${progressData.percentage}%)`);
          
        } catch (progressError) {
          console.error('⚠️ Error guardando progreso de imágenes:', progressError.message);
        }
      }
    }
    
    const totalSuccessfulImages = allImageResults.reduce((total, section) => {
      return total + (section.images?.filter(img => img.path).length || 0);
    }, 0);
    
    const totalExpectedImages = imagePrompts.reduce((total, section) => {
      return total + (section.prompts?.length || 0);
    }, 0);
    
    console.log(`\n✅ FASE 3 COMPLETADA:`);
    console.log(`🖼️ ${totalSuccessfulImages}/${totalExpectedImages} imágenes generadas con ${imageMethod}`);
    
    // Asegurar que ComfyUI se cierre al final de la fase 3 (solo si se usó)
    if (shouldUseLocalAI) {
      console.log('🛑 Cerrando ComfyUI al finalizar Fase 3...');
      await stopComfyUI();
      console.log('✅ ComfyUI cerrado, GPU liberada');
    }
    
    // Generar archivo project_state.json para persistencia del proyecto
    try {
      await generateProjectStateFile(projectData, {
        topic,
        folderName,
        voice: selectedVoice,
        totalSections,
        imageCount,
        promptModifier,
        imageModel,
        llmModel,
        scriptStyle,
        customStyleInstructions,
        applioVoice,
        applioModel,
        applioPitch,
        applioSpeed
      });
      console.log('📄 Archivo project_state.json generado exitosamente');
    } catch (stateError) {
      console.error('❌ Error generando project_state.json:', stateError.message);
    }
    
    res.json({
      success: true,
      phase: 'images_completed',
      message: `Fase 3 completada: ${totalSuccessfulImages}/${totalExpectedImages} imágenes generadas con ${imageMethod}`,
      data: {
        imageResults: allImageResults,
        projectKey: projectKey,
        imageMethod: imageMethod,
        totalImages: totalSuccessfulImages
      }
    });
    
  } catch (error) {
    console.error('❌ Error en generación de imágenes por lotes:', error);
    
    // Asegurar que ComfyUI se cierre en caso de error
    try {
      console.log('🛑 Cerrando ComfyUI debido a error en batch...');
      await stopComfyUI();
      console.log('✅ ComfyUI cerrado después del error');
    } catch (closeError) {
      console.error('❌ Error cerrando ComfyUI:', closeError);
    }
    
    res.status(500).json({ error: 'Error en generación de imágenes: ' + error.message });
  }
});

// ENDPOINT PARA OBTENER PROGRESO EN TIEMPO REAL
app.get('/progress/:projectKey', (req, res) => {
  try {
    const { projectKey } = req.params;
    
    if (!projectProgressTracker[projectKey]) {
      return res.json({ 
        success: true, 
        progress: 0, 
        phase: 'starting', 
        message: 'Proyecto iniciándose...' 
      });
    }
    
    const progressData = projectProgressTracker[projectKey];
    
    res.json({
      success: true,
      progress: progressData
    });
    
  } catch (error) {
    console.error('❌ Error obteniendo progreso:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error obteniendo progreso: ' + error.message 
    });
  }
});

app.post('/generate', async (req, res) => {
  try {
  const { topic, folderName, voice, totalSections, currentSection, previousSections, minWords, maxWords, imageCount, aspectRatio, promptModifier, imageModel, llmModel, skipImages, googleImages, localAIImages, comfyUISettings, scriptStyle, customStyleInstructions, applioVoice, applioModel, applioPitch, applioSpeed } = req.body;
    
    const selectedVoice = voice || 'Orus';
    const sections = totalSections || 3;
    const section = currentSection || 1;
    const wordsMin = minWords || 800;
    const wordsMax = maxWords || 1100;
    const selectedStyle = scriptStyle || 'professional'; // Default al estilo profesional
    const numImages = imageCount || 5; // Default a 5 imágenes si no se especifica
  const additionalInstructions = promptModifier || ''; // Instrucciones adicionales para imágenes
  const selectedImageModel = normalizeImageModel(imageModel);
  const selectedImageModelLabel = getImageModelLabel(selectedImageModel);
  console.log(`🤖 Modelo de imágenes seleccionado para esta sección: ${selectedImageModelLabel} (${selectedImageModel})`);
    const selectedLlmModel = llmModel || GEMINI_TEXT_MODEL;
    let shouldSkipImages = skipImages === true;
    let shouldUseGoogleImages = googleImages === true;
    let shouldUseLocalAI = localAIImages === true;
  const aspectInfo = describeAspectRatio(aspectRatio);
  const safeAspectRatio = aspectInfo.ratio;
  console.log(`📐 Aspect ratio solicitado para la sección: ${aspectInfo.label}`);
    
    console.log(`🎯 Solicitud recibida: ${shouldUseLocalAI ? 'IA LOCAL' : shouldUseGoogleImages ? 'ENLACES GOOGLE' : shouldSkipImages ? 'SIN IMÁGENES' : numImages + ' imágenes'} para la sección ${section}`);
    
    if (!topic) {
      return res.status(400).json({ error: 'Tema requerido' });
    }

    // Crear clave única para la conversación (proyecto)
    // Usar el mismo folderName que se usa para la estructura de carpetas
    const actualFolderName = folderName && folderName.trim() 
      ? createSafeFolderName(folderName.trim())
      : createSafeFolderName(topic);
    const projectKey = actualFolderName;
    const conversation = getOrCreateConversation(projectKey);

    // Crear estructura de carpetas usando el actualFolderName ya normalizado
    const folderStructure = createProjectStructure(topic, section, actualFolderName);
    console.log(`📁 Estructura de carpetas creada: ${folderStructure.sectionDir}`);
    
    console.log(`💬 Usando conversación: ${projectKey} (folderName: "${actualFolderName}")`);
    console.log(`📝 Historial actual: ${conversation.history.length} mensajes`);

    // Paso 1: Generar guión usando conversación continua
    console.log(`📝 Generando guión de YouTube - Sección ${section}/${sections} para el tema: ${topic}...`);
    console.log(`🎭 Usando estilo: ${selectedStyle === 'comedy' ? 'Cómico/Sarcástico' : 'Profesional'}`);
    
    let promptContent;
    let chapterStructure = null;
    
    if (section === 1) {
      // Primera sección: Generar estructura completa de capítulos primero
      conversation.topic = topic;
      conversation.totalSections = sections;
      conversation.currentSection = 1;
      conversation.history = []; // Limpiar historial para nueva conversación

      console.log(`📋 PASO 1: Generando estructura de ${sections} capítulos para el tema: ${topic}...`);
      
      // Generar estructura de capítulos
      let chapterPrompt;
      
      // Detectar si se está usando un estilo personalizado
      if (selectedStyle && selectedStyle.startsWith('custom_') && customStyleInstructions) {
        // Prompt especializado para estilos personalizados
        chapterPrompt = `Eres un experto en crear estructuras narrativas personalizadas.

TEMA SOLICITADO: "${topic}"
TOTAL DE CAPÍTULOS: ${sections}
ESTILO PERSONALIZADO: ${customStyleInstructions}

Tu tarea es crear una ESTRUCTURA NARRATIVA que respete completamente el estilo personalizado definido.

INSTRUCCIONES ESPECÍFICAS PARA ESTE ESTILO:
- Analiza cuidadosamente las instrucciones del estilo personalizado
- Crea títulos que reflejen EXACTAMENTE lo que pide el estilo
- Si el estilo menciona "situaciones cotidianas", crea capítulos sobre actividades diarias del personaje
- Si el estilo habla de "progresión del día", organiza los capítulos cronológicamente  
- Si pide "técnicas de hipnotización", enfócate en momentos relajantes del personaje
- IGNORA formatos educativos genéricos, sigue SOLO el estilo personalizado

PARA "${topic}" CON ESTE ESTILO ESPECÍFICO:
Genera títulos que narren momentos, actividades y situaciones del personaje, no información educativa sobre la serie.

FORMATO DE RESPUESTA OBLIGATORIO:
Debes responder ÚNICAMENTE con los títulos separados por "||CAPITULO||"

VERIFICACIÓN: Tu respuesta debe tener exactamente ${sections - 1} delimitadores "||CAPITULO||" para generar ${sections} títulos.

RESPONDE SOLO CON LOS TÍTULOS SEPARADOS POR "||CAPITULO||", NADA MÁS.`;
      } else {
        // Prompt estándar para estilos no personalizados  
        chapterPrompt = `Eres un experto en narrativa para YouTube especializado en contenido educativo y entretenimiento.

TEMA SOLICITADO: "${topic}"
TOTAL DE CAPÍTULOS: ${sections}

Tu tarea es crear una ESTRUCTURA NARRATIVA completa dividiendo el tema en ${sections} capítulos/secciones coherentes y bien organizadas.

INSTRUCCIONES:
- Crea EXACTAMENTE ${sections} títulos de capítulos
- Cada capítulo debe tener un título descriptivo y atractivo
- Los capítulos deben seguir un hilo narrativo lógico
- Progresión natural del tema de inicio a conclusión
- Títulos que generen curiosidad y mantengan el interés

FORMATO DE RESPUESTA OBLIGATORIO:
Debes responder ÚNICAMENTE con los títulos separados por "||CAPITULO||"

EJEMPLO PARA 3 CAPÍTULOS:
Capítulo 1: El Origen de la Leyenda||CAPITULO||Capítulo 2: Los Secretos Revelados||CAPITULO||Capítulo 3: El Legado Eterno

VERIFICACIÓN: Tu respuesta debe tener exactamente ${sections - 1} delimitadores "||CAPITULO||" para generar ${sections} títulos.

RESPONDE SOLO CON LOS TÍTULOS SEPARADOS POR "||CAPITULO||", NADA MÁS.`;
      }

      console.log(`🔄 Enviando prompt de capítulos al modelo ${selectedLlmModel}...`);
      
      try {
        const chapterResponse = await generateUniversalContent(
          selectedLlmModel,
          chapterPrompt,
          "Eres un experto en estructura narrativa. Tu ÚNICA tarea es crear títulos de capítulos separados por '||CAPITULO||'. NUNCA generes texto adicional fuera de los títulos."
        );

        console.log(`✅ Respuesta de capítulos recibida exitosamente`);

        const chaptersText = chapterResponse || '';
        console.log(`📝 Respuesta de estructura: ${chaptersText ? chaptersText.substring(0, 200) + '...' : 'RESPUESTA VACÍA'}`);
        
        const chapterTitles = chaptersText.split('||CAPITULO||').filter(title => title.trim()).slice(0, sections);
        console.log(`📚 Capítulos generados: ${chapterTitles.length} de ${sections} solicitados`);
        console.log(`📖 Títulos: ${chapterTitles.join(', ')}`);
        
        // 📋 MOSTRAR ESTRUCTURA COMPLETA DE CAPÍTULOS
        console.log('\n' + '='.repeat(60));
        console.log('📖 ESTRUCTURA COMPLETA DE CAPÍTULOS GENERADA');
        console.log('='.repeat(60));
        console.log(`🎯 Tema: "${topic}"`);
        console.log(`📊 Total de capítulos: ${sections}`);
        console.log(`🧠 Modelo LLM usado: ${selectedLlmModel}`);
        console.log('─'.repeat(60));
        
        if (chapterTitles.length > 0) {
          chapterTitles.forEach((title, index) => {
            const chapterNumber = index + 1;
            const cleanTitle = title.trim();
            console.log(`📚 Capítulo ${chapterNumber}: ${cleanTitle}`);
          });
        } else {
          console.log('⚠️ No se generaron títulos de capítulos');
        }
        
        console.log('='.repeat(60) + '\n');
        
        // Guardar estructura en la conversación
        conversation.chapterStructure = chapterTitles;
        chapterStructure = chapterTitles;
        
      } catch (chapterError) {
        console.error('❌ ERROR generando estructura de capítulos:', chapterError);
        console.log('⚠️ Continuando sin estructura de capítulos...');
        chapterStructure = [];
        conversation.chapterStructure = [];
      }

      console.log(`📝 PASO 2: Generando contenido del Capítulo 1: ${chapterStructure[0] || 'Sin título'}...`);
      
      // Ahora generar el contenido de la primera sección con contexto de estructura
      promptContent = generateScriptPrompt(selectedStyle, topic, sections, section, customStyleInstructions, chapterStructure, null, wordsMin, wordsMax);

      // Limpiar historial y agregar mensaje inicial
      conversation.history = [
        { role: 'user', parts: [{ text: promptContent }] }
      ];
      
    } else {
      // Secciones posteriores: Usar estructura existente
      chapterStructure = conversation.chapterStructure || [];
      console.log(`📖 Usando estructura existente: ${chapterStructure.length} capítulos`);
      console.log(`📝 Generando Capítulo ${section}: ${chapterStructure[section - 1] || 'Sin título'}...`);
      
      // � EXTRAER CONTEXTO DE CAPÍTULOS ANTERIORES
      console.log(`🔗 Extrayendo contexto de ${section - 1} capítulos anteriores...`);
      const previousChapterContent = [];
      
      // Obtener el contenido de las respuestas anteriores del asistente
      conversation.history.forEach((message, index) => {
        if (message.role === 'model' && message.parts && message.parts[0] && message.parts[0].text) {
          const content = message.parts[0].text.trim();
          if (content.length > 50) { // Solo incluir respuestas con contenido sustancial
            previousChapterContent.push(content);
          }
        }
      });
      
      console.log(`📚 Capítulos anteriores encontrados: ${previousChapterContent.length}`);
      if (previousChapterContent.length > 0) {
        console.log(`📖 Último capítulo preview: ${previousChapterContent[previousChapterContent.length - 1].substring(0, 100)}...`);
      }
      
      // 📋 MOSTRAR PROGRESO DE CAPÍTULOS
      console.log('\n' + '─'.repeat(50));
      console.log(`📚 CAPÍTULO ${section} DE ${sections}`);
      console.log('─'.repeat(50));
      console.log(`🎯 Tema: "${topic}"`);
      console.log(`📖 Capítulo actual: ${chapterStructure[section - 1] || 'Sin título'}`);
      console.log(`🧠 Modelo LLM: ${selectedLlmModel}`);
      
      // Mostrar contexto de todos los capítulos
      console.log('\n📋 Estructura completa:');
      chapterStructure.forEach((title, index) => {
        const chapterNumber = index + 1;
        const isCurrentChapter = chapterNumber === section;
        const statusIcon = chapterNumber < section ? '✅' : isCurrentChapter ? '🔄' : '⏳';
        const cleanTitle = title.trim();
        console.log(`${statusIcon} Capítulo ${chapterNumber}: ${cleanTitle}`);
      });
      console.log('─'.repeat(50) + '\n');
      
      promptContent = generateScriptPrompt(selectedStyle, topic, sections, section, customStyleInstructions, chapterStructure, previousChapterContent, wordsMin, wordsMax);

      // Agregar nueva pregunta al historial
      conversation.history.push({ role: 'user', parts: [{ text: promptContent }] });
    }
    
    // Actualizar sección actual
    conversation.currentSection = section;

    // Generar respuesta usando el historial de conversación
    let systemInstruction;
    if (selectedStyle === 'comedy') {
      systemInstruction = `Eres un escritor de guiones cómicos para YouTube con tono sarcástico y humor negro. IMPORTANTE: Responde ÚNICAMENTE con el texto del guión, sin explicaciones, comentarios, etiquetas o texto adicional. El texto debe estar listo para TTS. Incluye groserías, humor absurdo y múltiples voces entre corchetes. ESTRUCTURA OBLIGATORIA: Exactamente 3 párrafos detallados, entre ${wordsMin} y ${wordsMax} palabras total. Solo el guión puro.`;
    } else if (selectedStyle && selectedStyle.startsWith('custom_') && customStyleInstructions) {
      systemInstruction = `Eres un escritor de guiones para YouTube especializado en el estilo personalizado que el usuario ha definido. IMPORTANTE: Responde ÚNICAMENTE con el texto del guión siguiendo exactamente estas instrucciones de estilo: ${customStyleInstructions}. Sin explicaciones, comentarios, etiquetas o texto adicional. El texto debe estar listo para TTS aplicando fielmente el estilo especificado. ESTRUCTURA OBLIGATORIA: Exactamente 3 párrafos detallados, entre ${wordsMin} y ${wordsMax} palabras total. Solo el guión puro.`;
    } else {
      systemInstruction = `Eres un escritor profesional de guiones para YouTube. IMPORTANTE: Responde ÚNICAMENTE con el texto del guión, sin explicaciones, comentarios, etiquetas o texto adicional. El texto debe estar listo para TTS. No incluyas pensamientos, notas o aclaraciones. ESTRUCTURA OBLIGATORIA: Exactamente 3 párrafos detallados, entre ${wordsMin} y ${wordsMax} palabras total. Solo el guión puro.`;
    }

    const scriptResponse = await generateUniversalContent(
      selectedLlmModel,
      conversation.history,
      systemInstruction
    );

    console.log(`🔍 scriptResponse:`, typeof scriptResponse, scriptResponse);
    const script = scriptResponse || '';
    console.log(`🔍 script extraído:`, typeof script);
    console.log(`🔍 script preview:`, script && typeof script === 'string' && script.length > 0 ? script.substring(0, 100) + '...' : 'VACÍO O INVÁLIDO');
    
    // Validar que tenemos contenido válido
    if (!script || typeof script !== 'string' || script.trim().length === 0) {
      throw new Error(`No se pudo extraer contenido válido de la respuesta. Response: ${JSON.stringify(scriptResponse)}`);
    }
    
    // Limpiar el script de cualquier texto adicional no deseado
    const cleanScript = cleanScriptText(script);
    
    // Calcular tokens de entrada y salida
    const inputTokens = estimateTokens(promptContent + (systemInstruction || ''));
    const outputTokens = estimateTokens(cleanScript);
    const totalTokens = inputTokens + outputTokens;
    
    console.log(`📊 TOKENS - Entrada: ${inputTokens}, Salida: ${outputTokens}, Total: ${totalTokens}`);
    
    // Agregar respuesta al historial
    conversation.history.push({ role: 'model', parts: [{ text: cleanScript }] });
    
    // Optimizar historial manteniendo continuidad narrativa
    optimizeConversationHistory(conversation);
    
    // OPTIMIZACIÓN: Mantener solo los últimos 4 mensajes (2 intercambios: pregunta+respuesta anteriores)
    // Esto ahorra tokens manteniendo solo el contexto del capítulo anterior
    const historialAntes = conversation.history.length;
    if (conversation.history.length > 10) { // Activar optimización más tarde
      conversation.history = conversation.history.slice(-8); // Mantener más contexto para continuidad
      console.log(`� OPTIMIZACIÓN - Historial reducido de ${historialAntes} a ${conversation.history.length} mensajes`);
      console.log(`💰 AHORRO DE TOKENS - Eliminados ${historialAntes - conversation.history.length} mensajes antiguos`);
    }
    
    console.log(`✅ Guión de la sección ${section} generado usando conversación continua`);
    console.log(`💾 Historial actualizado: ${conversation.history.length} mensajes`);
    
    // Mostrar información de ahorro de tokens
    if (historialAntes > 4) {
      const tokensActuales = conversation.history.reduce((total, msg) => {
        return total + estimateTokens(msg.parts[0].text);
      }, 0);
      console.log(`📊 MÉTRICAS - Tokens actuales en historial: ~${tokensActuales} (optimizado vs ~${tokensActuales * (historialAntes / 4)} sin optimización)`);
    }

    // Guardar el guión como archivo de texto en la carpeta de la sección
    try {
      const scriptFileName = `${actualFolderName}_seccion_${section}_guion.txt`;
      const scriptFilePath = path.join(folderStructure.sectionDir, scriptFileName);
      
      const scriptContent = `GUIÓN DE LA SECCIÓN ${section}
===============================
Tema: ${topic ? topic.split(/\s+/).slice(0, 10).join(' ') + (topic.split(/\s+/).length > 10 ? '...' : '') : ''}
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

    // Verificar si se deben omitir las imágenes, usar Google Images o usar IA Local
    if (shouldSkipImages || shouldUseGoogleImages || shouldUseLocalAI) {
      let modeDescription = 'Modo desconocido';
      if (shouldUseLocalAI) {
        modeDescription = 'Generando imágenes con IA Local (ComfyUI + Flux)';
      } else if (shouldUseGoogleImages) {
        modeDescription = 'Descargando imágenes específicas de Bing';
      } else {
        modeDescription = 'Omitiendo generación de imágenes, pero generando prompts para mostrar';
      }
      
      console.log(`🎨 ${modeDescription}`);
      console.log(`🔍 DEBUG SKIP - shouldSkipImages: ${shouldSkipImages}`);
      console.log(`🔍 DEBUG BING - shouldUseGoogleImages: ${shouldUseGoogleImages}`);
      console.log(`🔍 DEBUG AI LOCAL - shouldUseLocalAI: ${shouldUseLocalAI}`);
      console.log(`🔍 DEBUG - numImages: ${numImages}`);
      
      let enhancedPrompts = [];
      let downloadedImages = [];
      let localAIImages = []; // Declarar para imágenes de IA Local
      let imageKeywords = []; // Declarar aquí para uso posterior
      
      if (shouldUseGoogleImages) {
        console.log(`🔍 Generando palabras clave específicas y descargando ${numImages} imágenes de Bing...`);
        
        try {
          // Generar palabras clave específicas usando el LLM
          console.log(`🧠 Analizando guión para generar palabras clave específicas...`);
          imageKeywords = await generateImageKeywords(cleanScript, topic, numImages);
          
          console.log(`🎯 Palabras clave generadas para ${numImages} imágenes:`, imageKeywords);
          
          // Descargar imágenes usando las palabras clave específicas
          downloadedImages = await searchAndDownloadBingImages(imageKeywords, folderStructure.sectionDir);
          
          if (downloadedImages.length > 0) {
            console.log(`✅ ${downloadedImages.length} imágenes descargadas de Bing exitosamente con keywords específicas`);
            
            // Guardar keywords en archivo para cargarlas posteriormente
            try {
              const keywordsToSave = downloadedImages.map(img => img.keywords || '').filter(k => k.trim());
              if (keywordsToSave.length > 0) {
                const keywordsFilePath = path.join(folderStructure.sectionDir, `${actualFolderName}_seccion_${section}_keywords.txt`);
                fs.writeFileSync(keywordsFilePath, keywordsToSave.join('\n'), 'utf8');
                console.log(`💾 Keywords guardadas en: ${keywordsFilePath}`);
              }
            } catch (keywordSaveError) {
              console.warn(`⚠️ Error guardando keywords: ${keywordSaveError.message}`);
            }
            
            // ✅ NUEVO: Crear images_metadata.json para cargar keywords posteriormente
            try {
              const metadataPath = path.join(folderStructure.sectionDir, 'images_metadata.json');
              const metadata = {};
              
              downloadedImages.forEach((img, index) => {
                metadata[img.filename] = {
                  originalUrl: img.url,
                  keywords: img.keywords || '',
                  timestamp: new Date().toISOString(),
                  source: 'bing',
                  section: section
                };
              });
              
              fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
              console.log(`📝 Metadata de imágenes guardada en: ${metadataPath}`);
              console.log(`📊 Metadata guardado:`, metadata);
            } catch (metadataError) {
              console.warn(`⚠️ Error guardando images_metadata.json: ${metadataError.message}`);
            }
            
            // Crear "prompts" mostrando las palabras clave específicas que se usaron
            enhancedPrompts = downloadedImages.map((img, index) => 
              `Imagen ${index + 1}: ${img.keywords || img.caption || img.filename}`
            );
            
            console.log(`📋 Prompts generados con keywords:`, enhancedPrompts);
          } else {
            console.log(`⚠️ No se pudieron descargar imágenes de Bing, generando prompts como fallback`);
            // Fallback: mostrar las keywords que se intentaron usar
            enhancedPrompts = imageKeywords.map((keyword, index) => 
              `Keywords intentadas ${index + 1}: ${keyword}`
            );
          }
        } catch (error) {
          console.error(`❌ Error descargando imágenes de Bing:`, error.message);
          enhancedPrompts = [`Error generando keywords o descargando imágenes: ${error.message}`];
        }
      } else if (shouldUseLocalAI) {
        console.log(`🖼️ Modo "Generar imágenes con IA" activado - Iniciando proceso automático completo...`);
        
        try {
          // Paso 1: Generar prompts para las imágenes
          console.log(`📝 Generando prompts para ${numImages} imágenes...`);
          
          let basePrompt = `Analiza este guión y crea ${numImages} prompts detallados para generar imágenes que ilustren visualmente su contenido:

GUIÓN A ANALIZAR:
${cleanScript}

TEMA PRINCIPAL: ${topic}

CONTEXTO DEL PROYECTO:
- Sección ${section} de ${sections}
- Palabras del guión: ${wordsMin}-${wordsMax}

INSTRUCCIONES CRÍTICAS PARA EL FORMATO:
- DEBES crear ${numImages} prompts independientes que representen la MISMA sección desde diferentes perspectivas
- NO dividas el contenido en secuencia cronológica - todas las imágenes son de la MISMA sección`;
          
          // Integrar instrucciones adicionales en el prompt del LLM
          const finalPromptForLLM = integrateAdditionalInstructions(basePrompt, additionalInstructions);
          
          console.log(`🧠 Creando prompts para secuencia de ${numImages} imágenes...`);
          if (additionalInstructions && additionalInstructions.trim()) {
            console.log(`📝 Integrando instrucciones adicionales: "${additionalInstructions.trim()}"`);
          }
          
          const promptsResponse = await generateUniversalContent(
            selectedLlmModel,
            finalPromptForLLM + `
            - DEBES separar cada prompt con "||PROMPT||" (sin espacios adicionales)
            - DEBES asegurarte de que haya exactamente ${numImages} prompts en tu respuesta
            - Las imágenes deben contar la historia del guión de forma visual secuencial
            - Incluye detalles específicos mencionados en el texto del guión

            REQUISITOS OBLIGATORIOS para cada prompt:
            - Formato: Aspecto 16:9 (widescreen)
            - Estilo: Realista, alta calidad, 4K
            
            FORMATO DE RESPUESTA OBLIGATORIO:
            DEBES presentar EXACTAMENTE ${numImages} prompts separados por "||PROMPT||" (sin espacios antes o después del delimitador).
            
            ESTRUCTURA REQUERIDA:
            Prompt 1 aquí||PROMPT||Prompt 2 aquí||PROMPT||Prompt 3 aquí||PROMPT||... hasta el Prompt ${numImages}
            
            VERIFICACIÓN FINAL: Tu respuesta debe contener exactamente ${numImages - 1} ocurrencias del delimitador "||PROMPT||" para generar ${numImages} prompts.`,
            `Eres un experto en arte conceptual y narrativa visual. Tu ÚNICA tarea es crear prompts separados por "||PROMPT||". 

REGLAS CRÍTICAS:
1. SIEMPRE usa el delimitador exacto "||PROMPT||" (sin espacios adicionales)
2. NUNCA generes texto adicional fuera de los prompts
3. CUENTA cuidadosamente para generar el número exacto solicitado
4. DIVIDE el contenido equitativamente entre todos los prompts
5. Cada prompt debe ser independiente y descriptivo

Si te piden N prompts, tu respuesta debe tener exactamente (N-1) delimitadores "||PROMPT||".`
          );

          const promptsText = promptsResponse || '';
          console.log(`📝 Prompts generados exitosamente`);
          
          const imagePrompts = promptsText.split('||PROMPT||').filter(p => p.trim()).slice(0, numImages);
          console.log(`🎨 ${imagePrompts.length} prompts secuenciales generados`);
          
          // Guardar prompts en archivo
          const promptsFileName = `${folderStructure.safeTopicName}_seccion_${section}_prompts_imagenes.txt`;
          const promptsFilePath = path.join(folderStructure.sectionDir, promptsFileName);
          
          const promptsContent = `PROMPTS DE IMÁGENES - SECCIÓN ${section}
===============================
Tema: ${topic}
Sección: ${section}/${sections}
Fecha: ${new Date().toLocaleDateString('es-ES')}
${folderName ? `Nombre del proyecto: ${folderName}` : ''}
${additionalInstructions ? `Instrucciones adicionales: ${additionalInstructions}` : ''}

${imagePrompts.map((prompt, index) => `${index + 1} ===
${prompt.trim()}`).join('\n\n')}

===============================
Generado automáticamente
`;
          
          fs.writeFileSync(promptsFilePath, promptsContent, 'utf8');
          console.log(`📝 Prompts guardados en: ${promptsFilePath}`);

          // Paso 2: Usar la función existente de generación de imágenes (Google → ComfyUI)
          console.log(`🖼️ Iniciando generación automática de imágenes con proceso Google → ComfyUI...`);
          
          // Crear la estructura de datos necesaria para la función de generación
          const imageGenerationResult = await generateMissingImagesForProject({
            folderName: actualFolderName,
            imageInstructions: additionalInstructions || "",
            imageCount: numImages,
            useLocalAI: false, // Usar el proceso híbrido Google → ComfyUI
            comfyUIConfig: comfyUISettings || {},
            aspectRatio: safeAspectRatio
          });
          
          console.log(`✅ Generación de imágenes completada: ${imageGenerationResult.successful} imágenes generadas`);
          
          // Buscar las imágenes generadas en el directorio
          const generatedImageFiles = fs.readdirSync(folderStructure.sectionDir)
            .filter(file => file.match(/\.(jpg|jpeg|png|webp)$/i))
            .slice(0, numImages);
          
          // Configurar respuesta con las imágenes generadas
          enhancedPrompts = imagePrompts;
          localAIImages = generatedImageFiles.map((filename, index) => ({
            filename: filename,
            path: `outputs/${actualFolderName}/seccion_${section}/${filename}`,
            prompt: imagePrompts[index] || `Imagen ${index + 1}`,
            method: 'Google Gemini → ComfyUI (Automático)'
          }));
          
        } catch (error) {
          console.error(`❌ Error en proceso automático de generación de imágenes:`, error.message);
          // Fallback: solo generar prompts
          try {
            const promptsResponse = await generateUniversalContent(
              selectedLlmModel,
              `Crea ${numImages} prompts detallados para imágenes basados en este guión: ${cleanScript}. Separa cada prompt con "||PROMPT||".`
            );
            
            const imagePrompts = promptsResponse.split('||PROMPT||').filter(p => p.trim()).slice(0, numImages);
            enhancedPrompts = imagePrompts.map((prompt, index) => `Prompt ${index + 1}: ${prompt}`);
            localAIImages = [];
          } catch (fallbackError) {
            console.error(`❌ Error en fallback de prompts:`, fallbackError.message);
            enhancedPrompts = [`Error generando contenido: ${error.message}`];
            localAIImages = [];
          }
        }
          const consistencyContext = buildConsistencyContext(previousPrompts, contextInfo);
          
          // Paso 3: Construir prompt base para el LLM
          let basePrompt = `Basándote en este guión de la sección ${section} sobre "${topic}": "${cleanScript}", crea EXACTAMENTE ${numImages} prompts detallados para generar ${numImages} imágenes que ilustren visualmente el contenido ESPECÍFICO de esta sección.

            IMPORTANTE: Debes crear EXACTAMENTE ${numImages} prompts, ni más ni menos.

            ENFOQUE ESPECÍFICO PARA ESTA SECCIÓN:
            - Estas imágenes deben representar SOLO el contenido de la sección ${section}, no de todo el proyecto
            - Cada imagen debe mostrar diferentes aspectos, momentos o elementos clave mencionados en esta sección específica
            - NO dividas la sección en partes cronológicas - en su lugar, crea ${numImages} perspectivas diferentes del mismo contenido de la sección
            - Enfócate en elementos específicos, personajes, lugares, objetos, emociones o conceptos mencionados en esta sección
            - Mantén consistencia visual con las secciones anteriores${consistencyContext}

            TIPOS DE PROMPTS PARA ESTA SECCIÓN:
            - Imagen principal: La escena o momento central de la sección
            - Detalles importantes: Objetos, elementos o características específicas mencionadas
            - Perspectivas diferentes: Diferentes ángulos o enfoques del mismo contenido
            - Atmósfera: Imágenes que capturen el mood o ambiente de la sección
            - Elementos secundarios: Aspectos adicionales que complementen la narrativa de esta sección

            INSTRUCCIONES CRÍTICAS PARA EL FORMATO:
            - DEBES crear ${numImages} prompts independientes que representen la MISMA sección desde diferentes perspectivas
            - NO dividas el contenido en secuencia cronológica - todas las imágenes son de la MISMA sección`;
          
          // Paso 4: Integrar instrucciones adicionales en el prompt del LLM
          const finalPromptForLLM = integrateAdditionalInstructions(basePrompt, additionalInstructions);
          
          console.log(`🧠 Creando prompts para secuencia de ${numImages} imágenes con contexto de consistencia...`);
          if (previousPrompts.length > 0) {
            console.log(`🔗 Usando ${previousPrompts.length} prompts anteriores para mantener consistencia`);
          }
          if (additionalInstructions && additionalInstructions.trim()) {
            console.log(`📝 Integrando instrucciones adicionales en el LLM: "${additionalInstructions.trim()}"`);
          }
          
          const promptsResponse = await generateUniversalContent(
            selectedLlmModel,
            finalPromptForLLM + `
            - DEBES separar cada prompt con "||PROMPT||" (sin espacios adicionales)
            - DEBES asegurarte de que haya exactamente ${numImages} prompts en tu respuesta
            - Las imágenes deben contar la historia del guión de forma visual secuencial
            - Incluye detalles específicos mencionados en el texto del guión

            REQUISITOS OBLIGATORIOS para cada prompt:
            - Formato: Aspecto 16:9 (widescreen)
            - Estilo: Realista, alta calidad, 4K
            
            FORMATO DE RESPUESTA OBLIGATORIO:
            DEBES presentar EXACTAMENTE ${numImages} prompts separados por "||PROMPT||" (sin espacios antes o después del delimitador).
            
            ESTRUCTURA REQUERIDA:
            Prompt 1 aquí||PROMPT||Prompt 2 aquí||PROMPT||Prompt 3 aquí||PROMPT||... hasta el Prompt ${numImages}
            
            VERIFICACIÓN FINAL: Tu respuesta debe contener exactamente ${numImages - 1} ocurrencias del delimitador "||PROMPT||" para generar ${numImages} prompts.`,
            `Eres un experto en arte conceptual y narrativa visual. Tu ÚNICA tarea es crear prompts separados por "||PROMPT||". 

REGLAS CRÍTICAS:
1. SIEMPRE usa el delimitador exacto "||PROMPT||" (sin espacios adicionales)
2. NUNCA generes texto adicional fuera de los prompts
3. CUENTA cuidadosamente para generar el número exacto solicitado
4. DIVIDE el contenido equitativamente entre todos los prompts
5. Cada prompt debe ser independiente y descriptivo

Si te piden N prompts, tu respuesta debe tener exactamente (N-1) delimitadores "||PROMPT||".`
          );

          const promptsText = promptsResponse || '';
          console.log(`📝 Respuesta del modelo para IA Local: ${promptsText ? promptsText.substring(0, 200) + '...' : 'RESPUESTA VACÍA'}`);
          
          const imagePrompts = promptsText.split('||PROMPT||').filter(p => p.trim()).slice(0, numImages);
          console.log(`🎨 ${imagePrompts.length} prompts secuenciales generados para IA Local`);

          // Paso 2: Generar las imágenes usando ComfyUI + Flux
          console.log(`🖼️ Generando secuencia de ${numImages} imágenes con ComfyUI + Flux...`);
          
          // Registrar configuración recibida
          if (comfyUISettings) {
            console.log(`⚙️ Configuración ComfyUI recibida del frontend:`, comfyUISettings);
            console.log(`🔧 Pasos configurados en frontend: ${comfyUISettings.steps}`);
            console.log(`🎯 Guidance configurado en frontend: ${comfyUISettings.guidance}`);
            console.log(`📐 Resolución configurada: ${comfyUISettings.width}x${comfyUISettings.height}`);
          } else {
            console.log(`⚠️ No se recibió configuración ComfyUI, usando valores por defecto`);
          }
          
          localAIImages = await generateLocalAIImages(
            imagePrompts,
            additionalInstructions,
            folderStructure.sectionDir,
            section,
            comfyUISettings,
            false,
            safeAspectRatio
          );
          
          if (localAIImages.length > 0) {
            console.log(`✅ ${localAIImages.length} imágenes generadas con IA Local exitosamente`);
            
            // Usar los prompts originales como descripción de las imágenes generadas
            enhancedPrompts = localAIImages.map((img, index) => 
              `IA Local ${index + 1}: ${img.prompt || imagePrompts[index] || 'Imagen generada'}`
            );
            
            console.log(`📋 Prompts de IA Local generados:`, enhancedPrompts);
          } else {
            console.log(`⚠️ No se pudieron generar imágenes con IA Local, usando prompts como fallback`);
            enhancedPrompts = imagePrompts.map((prompt, index) => 
              `IA Local prompt ${index + 1}: ${prompt}`
            );
          }
      } else {
        console.log(`🎨 Generando prompts para secuencia de ${numImages} imágenes (solo texto)...`);
        
        // Paso 1: Obtener prompts anteriores para mantener consistencia
        console.log(`🧠 Recuperando contexto de prompts anteriores...`);
        const { previousPrompts, contextInfo } = getPreviousImagePrompts(projectKey, section);
        
        // Paso 2: Construir contexto de consistencia
        const consistencyContext = buildConsistencyContext(previousPrompts, contextInfo);
        
        // Paso 3: Construir prompt base para el LLM
        let basePrompt = `Basándote en este guión de la sección ${section} sobre "${topic}": "${cleanScript}", crea EXACTAMENTE ${numImages} prompts detallados para generar ${numImages} imágenes que ilustren visualmente el contenido ESPECÍFICO de esta sección.

          IMPORTANTE: Debes crear EXACTAMENTE ${numImages} prompts, ni más ni menos.

          ENFOQUE ESPECÍFICO PARA ESTA SECCIÓN:
          - Estas imágenes deben representar SOLO el contenido de la sección ${section}, no de todo el proyecto
          - Cada imagen debe mostrar diferentes aspectos, momentos o elementos clave mencionados en esta sección específica
          - NO dividas la sección en partes cronológicas - en su lugar, crea ${numImages} perspectivas diferentes del mismo contenido de la sección
          - Enfócate en elementos específicos, personajes, lugares, objetos, emociones o conceptos mencionados en esta sección
          - Mantén consistencia visual con las secciones anteriores${consistencyContext}

          TIPOS DE PROMPTS PARA ESTA SECCIÓN:
          - Imagen principal: La escena o momento central de la sección
          - Detalles importantes: Objetos, elementos o características específicas mencionadas
          - Perspectivas diferentes: Diferentes ángulos o enfoques del mismo contenido
          - Atmósfera: Imágenes que capturen el mood o ambiente de la sección
          - Elementos secundarios: Aspectos adicionales que complementen la narrativa de esta sección

          INSTRUCCIONES CRÍTICAS PARA EL FORMATO:
          - DEBES crear ${numImages} prompts independientes que representen la MISMA sección desde diferentes perspectivas
          - NO dividas el contenido en secuencia cronológica - todas las imágenes son de la MISMA sección
          - DEBES separar cada prompt con "||PROMPT||" (sin espacios adicionales)
          - DEBES asegurarte de que haya exactamente ${numImages} prompts en tu respuesta
          - Todas las imágenes deben estar relacionadas con el contenido específico de la sección ${section}
          - Incluye detalles específicos mencionados en el texto del guión

          REQUISITOS OBLIGATORIOS para cada prompt:
          - Formato: Aspecto 16:9 (widescreen)
          
          FORMATO DE RESPUESTA OBLIGATORIO:
          DEBES presentar EXACTAMENTE ${numImages} prompts separados por "||PROMPT||" (sin espacios antes o después del delimitador).
          
          ESTRUCTURA REQUERIDA:
          Prompt 1 aquí||PROMPT||Prompt 2 aquí||PROMPT||Prompt 3 aquí||PROMPT||... hasta el Prompt ${numImages}
          
          EJEMPLO PARA 3 PROMPTS (adaptar a ${numImages}):
          Un bosque oscuro con árboles ancianos||PROMPT||Una batalla épica entre guerreros||PROMPT||Un castillo en ruinas bajo la luna
          
          VERIFICACIÓN FINAL: Tu respuesta debe contener exactamente ${numImages - 1} ocurrencias del delimitador "||PROMPT||" para generar ${numImages} prompts.`;
        
        // Paso 4: Integrar instrucciones adicionales en el prompt del LLM
        const finalPromptForLLM = integrateAdditionalInstructions(basePrompt, additionalInstructions);
        
        console.log(`🧠 Creando prompts para secuencia de ${numImages} imágenes con contexto de consistencia...`);
        if (previousPrompts.length > 0) {
          console.log(`🔗 Usando ${previousPrompts.length} prompts anteriores para mantener consistencia`);
        }
        if (additionalInstructions && additionalInstructions.trim()) {
          console.log(`📝 Integrando instrucciones adicionales en el LLM: "${additionalInstructions.trim()}"`);
        }
        
        const promptsResponse = await generateUniversalContent(
          selectedLlmModel,
          finalPromptForLLM,
          `Eres un experto en arte conceptual y narrativa visual. Tu ÚNICA tarea es crear prompts separados por "||PROMPT||". 

REGLAS CRÍTICAS:
1. SIEMPRE usa el delimitador exacto "||PROMPT||" (sin espacios adicionales)
2. NUNCA generes texto adicional fuera de los prompts
3. CUENTA cuidadosamente para generar el número exacto solicitado
4. DIVIDE el contenido equitativamente entre todos los prompts
5. Cada prompt debe ser independiente y descriptivo

Si te piden N prompts, tu respuesta debe tener exactamente (N-1) delimitadores "||PROMPT||".`
        );

        const promptsText = promptsResponse || '';
        console.log(`📝 DEBUG SKIP - Respuesta del modelo: ${promptsText ? promptsText.substring(0, 200) + '...' : 'RESPUESTA VACÍA'}`);
        console.log(`🔍 DEBUG SKIP - Buscando delimitadores "||PROMPT||" en la respuesta...`);
        
        const imagePrompts = promptsText.split('||PROMPT||').filter(p => p.trim()).slice(0, numImages);
        console.log(`🔍 DEBUG SKIP - Delimitadores encontrados: ${promptsText.split('||PROMPT||').length - 1}`);
        console.log(`🔍 DEBUG SKIP - Prompts después del filtro: ${imagePrompts.length}`);
        console.log(`🔢 DEBUG SKIP - Se solicitaron ${numImages} prompts, se generaron ${imagePrompts.length} prompts válidos`);
        console.log(`🎨 DEBUG SKIP - Primeros 3 prompts:`, imagePrompts.slice(0, 3));
        
        // Ya no aplicamos instrucciones adicionales aquí - están integradas en el LLM
        enhancedPrompts = imagePrompts;
        console.log(`✅ Las instrucciones adicionales ya están integradas en los prompts por el LLM`);
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
${additionalInstructions ? `Instrucciones adicionales integradas en LLM: ${additionalInstructions}` : 'Sin instrucciones adicionales'}

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
      console.log(`🔍 DEBUG SKIP - imagesSkipped:`, shouldSkipImages && !shouldUseGoogleImages);
      console.log(`🔍 DEBUG BING - bingImagesMode:`, shouldUseGoogleImages);
      console.log(`🔍 DEBUG BING - downloadedImages.length:`, downloadedImages.length);

      // Construir respuesta según el modo
      const response = { 
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
        voice: selectedVoice,
        currentSection: section,
        totalSections: sections,
        topic: topic,
        isComplete: section >= sections,
        projectFolder: folderStructure.safeTopicName,
        sectionFolder: `seccion_${section}`,
        folderPath: path.relative('./public', folderStructure.sectionDir).replace(/\\/g, '/'),
        chapterStructure: chapterStructure,
        tokenUsage: {
          inputTokens: inputTokens,
          outputTokens: outputTokens,
          totalTokens: totalTokens,
          model: selectedLlmModel
        }
      };

      // Agregar datos específicos según el modo
      if (shouldUseLocalAI) {
        // Modo IA Local: incluir imágenes generadas
        const localImages = localAIImages ? localAIImages.filter(img => img.path) : []; // Solo imágenes exitosas
        
        response.localAIImages = localImages.map(img => ({
          url: `/${img.path}`,
          caption: `IA Local: ${img.filename ? img.filename.replace(/\.[^/.]+$/, '') : 'Imagen generada'}`,
          filename: img.filename,
          path: img.path,
          prompt: img.prompt
        }));
        response.localAIMode = true;
        response.imagesGenerated = localImages.length;
        response.mode = 'local_ai';
        response.imagePrompts = enhancedPrompts;
        console.log(`🤖 Respuesta configurada para modo IA Local con ${localImages.length} imágenes generadas`);
        
      } else if (shouldUseGoogleImages && downloadedImages.length > 0) {
        // Modo Bing Images: filtrar solo imágenes exitosas que realmente existen
        const existingImages = downloadedImages.filter(img => {
          // Si la imagen fue marcada como fallida, no incluirla
          if (img.failed) {
            console.log(`⚠️ Imagen marcada como fallida, excluyendo: ${img.filename} (${img.keywords})`);
            return false;
          }
          
          const imagePath = path.join(globalOutputDir, folderStructure.safeTopicName, `seccion_${section}`, img.filename);
          const exists = fs.existsSync(imagePath);
          if (!exists) {
            console.log(`⚠️ Archivo no encontrado, excluyendo de respuesta: ${img.filename}`);
          }
          return exists;
        });
        
        // Crear arrays de keywords solo para imágenes exitosas para mantener correspondencia
        const successfulKeywords = existingImages.map(img => img.keywords);
        
        response.downloadedImages = existingImages.map(img => ({
          url: `/outputs/${folderStructure.safeTopicName}/seccion_${section}/${img.filename}`,
          caption: `Imagen de Bing: ${img.filename.replace(/\.[^/.]+$/, '')}`,
          filename: img.filename,
          path: img.path
        }));
        response.bingImagesMode = true;
        response.imagesDownloaded = existingImages.length;
        response.mode = 'bing_images';
        console.log(`✅ Respuesta configurada para modo Bing con ${existingImages.length} imágenes (${downloadedImages.length} descargadas, ${existingImages.length} existentes)`);
        
        // Usar keywords directamente de las imágenes exitosas (ya filtradas)
        response.imageKeywords = successfulKeywords;
        console.log(`🎯 Keywords incluidas en respuesta (solo existentes):`, successfulKeywords);
        console.log(`🖼️ URLs de imágenes:`, response.downloadedImages.map(img => img.url));
      } else if (shouldUseGoogleImages) {
        // Fallback si no se descargaron imágenes de Bing
        response.imagePrompts = enhancedPrompts;
        response.bingImagesMode = true;
        response.bingImagesFailed = true;
        response.mode = 'bing_fallback';
        // Incluir las keywords para el botón de refresh
        if (imageKeywords && imageKeywords.length > 0) {
          response.imageKeywords = imageKeywords;
          console.log(`🎯 Keywords incluidas en respuesta fallback:`, imageKeywords);
        }
        console.log(`⚠️ Modo Bing falló, usando prompts como fallback`);
      } else {
        // Modo skip images normal
        response.imagePrompts = enhancedPrompts;
        response.imagesSkipped = shouldSkipImages;
        response.mode = 'skip_images';
        console.log(`📝 Modo skip images con ${enhancedPrompts.length} prompts`);
      }

      res.json(response);

      console.log(`🚨 RESPUESTA FINAL ENVIADA AL FRONTEND:`);
      console.log(`🚨 response.downloadedImages:`, response.downloadedImages);
      console.log(`🚨 response.bingImagesMode:`, response.bingImagesMode);
      console.log(`🚨 response.mode:`, response.mode);
      console.log(`🚨 Respuesta completa:`, JSON.stringify(response, null, 2));

      // Guardar estado del proyecto automáticamente
      try {
        const projectData = {
          topic: topic,
          folderName: folderName,
          totalSections: sections,
          currentSection: section,
          voice: selectedVoice,
          imageModel: selectedImageModel,
          llmModel: selectedLlmModel,
          scriptStyle: scriptStyle,
          customStyleInstructions: customStyleInstructions,
          promptModifier: promptModifier,
          imageCount: imageCount,
          skipImages: shouldSkipImages,
          googleImages: shouldUseGoogleImages,
          applioVoice: applioVoice,
          applioModel: applioModel || 'fr-FR-RemyMultilingualNeural',
          applioPitch: applioPitch || 0,
          applioSpeed: Number.isFinite(Number(applioSpeed)) ? Number(applioSpeed) : 0,
          chapterStructure: chapterStructure
        };
        
        const savedState = saveProjectState(projectData);
        
        if (savedState) {
          // Actualizar sección completada
          const sectionData = {
            script: cleanScript,
            images: [], // Sin imágenes en este modo
            imagesSkipped: shouldSkipImages && !shouldUseGoogleImages,
            googleImagesMode: shouldUseGoogleImages,
            imagePrompts: enhancedPrompts,
            scriptFile: {
              path: scriptFilePath,
              filename: scriptFileName,
              saved: true
            },
            promptsFile: {
              path: promptsFilePath,
              filename: promptsFileName,
              saved: true
            }
          };
          
          updateCompletedSection(projectData, section, sectionData);
          console.log(`💾 Estado del proyecto guardado automáticamente`);
        }
      } catch (saveError) {
        console.error('⚠️ Error guardando estado del proyecto:', saveError);
        // No detener el proceso por este error
      }
      return;
    }

    // Paso 2: Crear prompts para imágenes secuenciales basadas en el guión
    console.log(`🎨 Generando prompts para secuencia de ${numImages} imágenes...`);
    
    // Obtener prompts anteriores para mantener consistencia
    console.log(`🧠 Recuperando contexto de prompts anteriores...`);
    const { previousPrompts, contextInfo } = getPreviousImagePrompts(projectKey, section);
    
    // Construir contexto de consistencia
    const consistencyContext = buildConsistencyContext(previousPrompts, contextInfo);
    
    // Construir prompt base para el LLM
    let basePrompt = `Basándote en este guión de la sección ${section} sobre "${topic}" ": "${cleanScript}", crea EXACTAMENTE ${numImages} prompts detallados para generar ${numImages} imágenes que ilustren visualmente el contenido ESPECÍFICO de esta sección.

      IMPORTANTE: Debes crear EXACTAMENTE ${numImages} prompts, ni más ni menos.

      ENFOQUE ESPECÍFICO PARA ESTA SECCIÓN:
      - Estas imágenes deben representar SOLO el contenido de la sección ${section}, no de todo el proyecto
      - Cada imagen debe mostrar diferentes aspectos, momentos o elementos clave mencionados en esta sección específica
      - NO dividas la sección en partes cronológicas - en su lugar, crea ${numImages} perspectivas diferentes del mismo contenido de la sección
      - Enfócate en elementos específicos, personajes, lugares, objetos, emociones o conceptos mencionados en esta sección
      - Mantén consistencia visual con las secciones anteriores${consistencyContext}

      TIPOS DE PROMPTS PARA ESTA SECCIÓN:
      - Imagen principal: La escena o momento central de la sección
      - Detalles importantes: Objetos, elementos o características específicas mencionadas
      - Perspectivas diferentes: Diferentes ángulos o enfoques del mismo contenido
      - Atmósfera: Imágenes que capturen el mood o ambiente de la sección
      - Elementos secundarios: Aspectos adicionales que complementen la narrativa de esta sección

      INSTRUCCIONES CRÍTICAS PARA EL FORMATO:
      - DEBES crear ${numImages} prompts independientes que representen la MISMA sección desde diferentes perspectivas
      - NO dividas el contenido en secuencia cronológica - todas las imágenes son de la MISMA sección
      - DEBES separar cada prompt con "||PROMPT||" (sin espacios adicionales)
      - DEBES asegurarte de que haya exactamente ${numImages} prompts en tu respuesta
      - Todas las imágenes deben estar relacionadas con el contenido específico de la sección ${section}
      - Incluye detalles específicos mencionados en el texto del guión de esta sección

      REQUISITOS OBLIGATORIOS para cada prompt:
      - Formato: Aspecto 16:9 (widescreen)
      
      FORMATO DE RESPUESTA OBLIGATORIO:
      DEBES presentar EXACTAMENTE ${numImages} prompts separados por "||PROMPT||" (sin espacios antes o después del delimitador).
      
      ESTRUCTURA REQUERIDA:
      Prompt 1 aquí||PROMPT||Prompt 2 aquí||PROMPT||Prompt 3 aquí||PROMPT||... hasta el Prompt ${numImages}
      
      EJEMPLO PARA 3 PROMPTS (adaptar a ${numImages}):
      Un bosque oscuro con árboles ancianos||PROMPT||Una batalla épica entre guerreros||PROMPT||Un castillo en ruinas bajo la luna
      
      VERIFICACIÓN FINAL: Tu respuesta debe contener exactamente ${numImages - 1} ocurrencias del delimitador "||PROMPT||" para generar ${numImages} prompts.`;
    
    // Integrar instrucciones adicionales en el prompt del LLM
    const finalPromptForLLM = integrateAdditionalInstructions(basePrompt, additionalInstructions);
    
    console.log(`🧠 Creando prompts para secuencia de ${numImages} imágenes con contexto de consistencia...`);
    if (previousPrompts.length > 0) {
      console.log(`🔗 Usando ${previousPrompts.length} prompts anteriores para mantener consistencia`);
    }
    if (additionalInstructions && additionalInstructions.trim()) {
      console.log(`📝 Integrando instrucciones adicionales en el LLM: "${additionalInstructions.trim()}"`);
    }
    
    const promptsResponse = await ai.models.generateContent({
      model: `models/${selectedLlmModel}`,
      contents: [{ role: 'user', parts: [{ text: finalPromptForLLM }] }],
      config: {
        systemInstruction: `Eres un experto en arte conceptual y narrativa visual. Tu ÚNICA tarea es crear prompts separados por "||PROMPT||". 

REGLAS CRÍTICAS:
1. SIEMPRE usa el delimitador exacto "||PROMPT||" (sin espacios adicionales)
2. NUNCA generes texto adicional fuera de los prompts
3. CUENTA cuidadosamente para generar el número exacto solicitado
4. DIVIDE el contenido equitativamente entre todos los prompts
5. Cada prompt debe ser independiente y descriptivo

Si te piden N prompts, tu respuesta debe tener exactamente (N-1) delimitadores "||PROMPT||".`,
        thinkingConfig: {
          thinkingBudget: 0, // Disables thinking
        }
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
        console.log(`📋 Prompt para imagen ${index + 1}: ${prompt.trim().substring(0, 100)}...`);
        
        // Usar el prompt directamente ya que las instrucciones adicionales están integradas en el LLM
        const enhancedPrompt = prompt.trim();
        console.log(`✅ Las instrucciones adicionales ya están integradas en el prompt por el LLM`);
        
  console.log(`📝 Prompt completo para imagen ${index + 1}: ${enhancedPrompt}`);
  console.log(`🤖 Usando modelo: ${selectedImageModelLabel}`);

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
            console.log(`🤖 Generada con: ${selectedImageModelLabel}`);
            
            // Retornar ruta relativa para acceso web
            const relativePath = path.relative('./public', imageFilePath).replace(/\\/g, '/');
            
            results.push({ 
              index: index,
              originalPromptIndex: index,
              variationIndex: varIndex,
              image: imageData,
              imagePath: relativePath,
              prompt: enhancedPrompt,
              model: selectedImageModelLabel
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
      folderPath: path.relative('./public', folderStructure.sectionDir).replace(/\\/g, '/'),
      chapterStructure: chapterStructure
    });

    // Guardar estado del proyecto automáticamente
    try {
      const projectData = {
        topic: topic,
        folderName: folderName,
        totalSections: sections,
        currentSection: section,
        voice: selectedVoice,
        imageModel: selectedImageModel,
        llmModel: selectedLlmModel,
        scriptStyle: scriptStyle,
        customStyleInstructions: customStyleInstructions,
        promptModifier: promptModifier,
        imageCount: imageCount,
        skipImages: shouldSkipImages,
        googleImages: shouldUseGoogleImages,
        chapterStructure: chapterStructure
      };
      
      const savedState = saveProjectState(projectData);
      
      if (savedState) {
        // Actualizar sección completada
        const sectionData = {
          script: cleanScript,
          images: allImages,
          imagesSkipped: false,
          googleImagesMode: false,
          imagePrompts: imagePrompts,
          scriptFile: {
            path: scriptFilePath,
            filename: scriptFileName,
            saved: true
          }
        };
        
        updateCompletedSection(projectData, section, sectionData);
        console.log(`💾 Estado del proyecto guardado automáticamente`);
      }
    } catch (saveError) {
      console.error('⚠️ Error guardando estado del proyecto:', saveError);
      // No detener el proceso por este error
    }
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
    const APPLIO_URL = process.env.APPLIO_SERVER_URL || "http://localhost:6969";
    
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
      model: GEMINI_TTS_MODEL_PRO,
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
        },
        thinkingConfig: {
          thinkingBudget: 0, // Disables thinking
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
    const { script, voice, topic, folderName, currentSection, narrationStyle, runId, order } = req.body;
    
    console.log(`🔊 [GENERATE-AUDIO] Recibida solicitud:`, {
      topic,
      folderName,
      currentSection,
      hasScript: !!script,
      scriptLength: script ? script.length : 0,
      voice,
      runId,
      order,
      narrationStyle
    });
    
    if (!topic || !currentSection) {
      return res.status(400).json({ error: 'Tema y sección requeridos para organizar archivos' });
    }

    const selectedVoice = voice || 'Orus';
    const section = currentSection || 1;
    const customNarrationStyle = narrationStyle || null;
    
    // Crear nombre normalizado consistente
    const actualFolderName = folderName && folderName.trim() 
      ? createSafeFolderName(folderName.trim())
      : createSafeFolderName(topic);
    
    // Si se proporcionan parámetros de cola, usar el sistema de cola para procesamiento secuencial
    if (runId !== undefined && order !== undefined) {
      console.log(`🔊 [COLA GOOGLE] Procesando audio con cola (runId=${runId}, order=${order}) para ${topic} sección ${section}`);
      
      try {
        const result = await enqueueGoogleAudioTask({
          runId,
          order,
          label: `${topic}_seccion_${section}`,
          task: async () => {
            console.log(`🔊 [COLA GOOGLE] Ejecutando tarea ${order} para ${topic} sección ${section}`);
            return await processGoogleAudioGeneration(script, selectedVoice, topic, actualFolderName, section, customNarrationStyle);
          }
        });
        
        console.log(`🔊 [COLA GOOGLE] Tarea ${order} completada para ${topic} sección ${section}`);
        res.json(result);
        return;
      } catch (queueError) {
        if (queueError.message === 'COLA_GOOGLE_OCUPADA') {
          return res.status(409).json({ 
            error: 'Sistema de audio ocupado con otra generación. Espera a que termine.',
            code: 'QUEUE_BUSY'
          });
        }
        throw queueError;
      }
    }
    
    // Procesamiento normal sin cola
    console.log(`🔊 Procesando audio normalmente (sin cola) para ${topic} sección ${section}`);
    const result = await processGoogleAudioGeneration(script, selectedVoice, topic, actualFolderName, section, customNarrationStyle);
    res.json(result);
    
  } catch (error) {
    console.error('❌ Error general en endpoint de audio:', error);
    res.status(500).json({ error: 'Error procesando solicitud de audio' });
  }
});

// Función común para procesar generación de audio de Google TTS
async function processGoogleAudioGeneration(script, selectedVoice, topic, actualFolderName, section, customNarrationStyle) {
  // Si no se proporciona script, intentar leerlo del archivo guardado
  let scriptContent = script;
  if (!scriptContent) {
    console.log(`🔍 Script no proporcionado, intentando leer archivo de sección ${section}...`);
    
    try {
      const folderStructure = createProjectStructure(topic, section, actualFolderName);
      const scriptFileName = `${actualFolderName}_seccion_${section}_guion.txt`;
      const scriptFilePath = path.join(folderStructure.sectionDir, scriptFileName);
      
      if (fs.existsSync(scriptFilePath)) {
        scriptContent = fs.readFileSync(scriptFilePath, 'utf8');
        console.log(`✅ Script leído desde archivo: ${scriptFilePath}`);
        console.log(`📄 Contenido crudo del archivo:`, scriptContent.substring(0, 200) + '...');
        
        // Limpiar el script para extraer solo el contenido del guion
        const contentMarker = "CONTENIDO DEL GUIÓN:";
        const contentIndex = scriptContent.indexOf(contentMarker);
        
        if (contentIndex !== -1) {
          scriptContent = scriptContent.substring(contentIndex + contentMarker.length).trim();
          
          // Remover el footer si existe
          const footerMarker = "===============================";
          const footerIndex = scriptContent.lastIndexOf(footerMarker);
          if (footerIndex !== -1) {
            scriptContent = scriptContent.substring(0, footerIndex).trim();
          }
          
          // Remover "Guión generado automáticamente por IA" si existe
          const aiMarker = "Guión generado automáticamente por IA";
          const aiIndex = scriptContent.indexOf(aiMarker);
          if (aiIndex !== -1) {
            scriptContent = scriptContent.substring(0, aiIndex).trim();
          }
          
          console.log(`✅ Script limpiado exitosamente, nueva longitud: ${scriptContent.length} caracteres`);
        } else {
          console.warn(`⚠️ No se encontró el marcador "${contentMarker}" en el archivo, usando contenido completo`);
        }
      } else {
        throw new Error(`No se encontró el guión para la sección ${section}. Archivo esperado: ${scriptFilePath}`);
      }
    } catch (readError) {
      console.error('❌ Error leyendo archivo de script:', readError);
      throw new Error('No se pudo leer el guión de la sección. Asegúrate de que el guión se haya generado primero.');
    }
  }
  
  if (!scriptContent || scriptContent.trim() === '') {
    throw new Error('Guión vacío o no válido');
  }
  
  // Crear estructura de carpetas para el audio usando el nombre normalizado
  const folderStructure = createProjectStructure(topic, section, actualFolderName);
  
  console.log(`🎵 Generando audio del guión con voz ${selectedVoice}...`);
  if (customNarrationStyle) {
    console.log(`🎭 Estilo de narración personalizado recibido: "${customNarrationStyle}"`);
  }
  
  try {
    const audioFilePath = await generateStoryAudio(scriptContent, selectedVoice, folderStructure.sectionDir, topic, section, customNarrationStyle);
    
    return { 
      success: true,
      audio: audioFilePath,
      voice: selectedVoice,
      projectFolder: folderStructure.safeTopicName,
      sectionFolder: `seccion_${section}`
    };
  } catch (audioError) {
    console.error('❌ Error específico en generación de audio:', audioError.message);
    
    // Responder con información más específica sobre el error
    throw new Error(`Error generando audio: ${audioError.message}. El servicio de Text-to-Speech puede estar temporalmente no disponible. Intenta nuevamente en unos momentos.`);
  }
}

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

  const normalizedImageModel = normalizeImageModel(imageModel);
  const selectedImageModel = normalizedImageModel;
  const selectedImageModelLabel = getImageModelLabel(selectedImageModel);
  console.log(`🔄 Regenerando imagen ${imageIndex + 1} con nuevo prompt...`);
  console.log(`🔍 Modelo recibido del frontend: ${imageModel || 'no especificado'}`);
  console.log(`🔍 Modelo que se usará: ${selectedImageModelLabel} (${selectedImageModel})`);
    
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
          console.log(`🤖 Regenerada con: ${selectedImageModelLabel}`);
          
          // Retornar ruta relativa para acceso web
          const relativePath = path.relative('./public', imageFilePath).replace(/\\/g, '/');
          
          regeneratedImages.push({
            image: imageData,
            imagePath: relativePath,
            variationIndex: varIndex,
            model: selectedImageModelLabel
          });
        }
        
        res.json({ 
          success: true,
          images: regeneratedImages,
          prompt: enhancedPrompt,
          imageIndex: imageIndex,
          model: selectedImageModelLabel
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

// Nuevo endpoint para generar imagen con ComfyUI + Flux
app.post('/generate-comfyui-image', async (req, res) => {
  try {
    const { prompt, options = {} } = req.body;
    
    if (!prompt) {
      return res.status(400).json({ error: 'Prompt es requerido' });
    }

    console.log(`🎨 [PRUEBA COMFYUI] Generando imagen: "${prompt.substring(0, 50)}..."`);
    console.log(`📊 [PRUEBA COMFYUI] Opciones recibidas del frontend:`, options);
    
    try {
      // Configurar opciones (usar las del frontend si están disponibles)
    const aspectInfo = describeAspectRatio(options?.aspectRatio, '16:9');
    const safeAspectRatio = aspectInfo.ratio;
    console.log(`📐 [PRUEBA COMFYUI] Aspect ratio solicitado: ${aspectInfo.label}`);
      const { width: defaultWidth, height: defaultHeight } = resolveComfyDefaultResolution(safeAspectRatio);
      const parsedSteps = Number.parseInt(options.steps, 10);
      const steps = Number.isFinite(parsedSteps) && parsedSteps > 0
        ? parsedSteps
        : comfyDefaultConfig.steps;
      const cfg = Number.isFinite(Number.parseFloat(options.cfg))
        ? Number.parseFloat(options.cfg)
        : comfyDefaultConfig.cfg;
      const guidance = Number.isFinite(Number.parseFloat(options.guidance))
        ? Number.parseFloat(options.guidance)
        : comfyDefaultConfig.guidance;
      const comfyOptions = {
        width: parseInt(options.width) || defaultWidth,
        height: parseInt(options.height) || defaultHeight,
        steps,
        cfg,
        guidance,
        sampler: options.sampler || "euler",
        scheduler: options.scheduler || "simple",
        model: options.model || "flux1-dev-fp8.safetensors",
        negativePrompt: options.negativePrompt || "low quality, blurry, distorted",
        timeout: Math.max(180, steps * 6),
        aspectRatio: safeAspectRatio
      };
      
      console.log(`⚙️ [PRUEBA COMFYUI] Configuración final que se enviará a ComfyUI:`, {
        resolution: `${comfyOptions.width}x${comfyOptions.height}`,
        steps: comfyOptions.steps,
        guidance: comfyOptions.guidance,
        sampler: comfyOptions.sampler,
        scheduler: comfyOptions.scheduler,
        cfg: comfyOptions.cfg,
        aspectRatio: safeAspectRatio,
        timeout: comfyOptions.timeout
      });
      
      console.log(`🚀 [PRUEBA COMFYUI] Iniciando generación con ${comfyOptions.steps} pasos...`);
      
      // Generar imagen con ComfyUI usando reinicio automático
      const result = await generateImageWithAutoRestart(prompt, comfyOptions);
      
      if (result.success) {
        res.json({
          success: true,
          imageUrl: result.imageUrl,
          filename: result.filename,
          promptId: result.promptId,
          prompt: prompt,
          options: comfyOptions
        });
      } else {
        res.status(500).json({
          error: 'Error generando imagen con ComfyUI',
          details: result.error || 'Error desconocido'
        });
      }
      
    } catch (error) {
      console.error('❌ Error en generación ComfyUI:', error.message);
      res.status(500).json({
        error: 'Error interno generando imagen',
        details: error.message
      });
    }
  } catch (error) {
    console.error('❌ Error general en endpoint ComfyUI:', error);
    res.status(500).json({ error: 'Error procesando solicitud de ComfyUI' });
  }
});

// Endpoint para verificar estado de ComfyUI
app.get('/comfyui-status', async (req, res) => {
  try {
    const connectionCheck = await comfyUIClient.checkConnection();
    
    if (connectionCheck.success) {
      const modelsInfo = await comfyUIClient.getAvailableModels();
      res.json({
        success: true,
        connected: true,
        stats: connectionCheck.data,
        models: modelsInfo.success ? modelsInfo.models : [],
        fluxAvailable: modelsInfo.success ? modelsInfo.models.includes('flux1-dev-fp8.safetensors') : false
      });
    } else {
      res.json({
        success: false,
        connected: false,
        error: connectionCheck.error
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      connected: false,
      error: error.message
    });
  }
});

// Nueva ruta para generar audio de sección específica usando cliente Applio Node.js
app.post('/generate-section-audio', async (req, res) => {
  try {
    const { script, topic, folderName, currentSection, voice, applioVoice, applioModel, applioPitch, applioSpeed } = req.body;
    
    if (!script || !topic || !currentSection) {
      return res.status(400).json({ 
        error: 'Script, tema y número de sección son requeridos' 
      });
    }

    const section = parseInt(currentSection);
    const selectedApplioVoice = applioVoice || "logs\\VOCES\\RemyOriginal.pth";
    const selectedApplioModel = applioModel || "fr-FR-RemyMultilingualNeural";
  const selectedPitch = parseInt(applioPitch) || 0;
  const selectedSpeed = Number.isFinite(Number(applioSpeed)) ? Number(applioSpeed) : 0;
    
    // Crear nombre normalizado consistente
    const actualFolderName = folderName && folderName.trim() 
      ? createSafeFolderName(folderName.trim())
      : createSafeFolderName(topic);
    
    // Crear estructura de carpetas usando el nombre normalizado
    const folderStructure = createProjectStructure(topic, section, actualFolderName);
    
    console.log(`🎵 Generando audio con Applio para sección ${section}...`);
    console.log(`🎤 Voz de Applio seleccionada: ${selectedApplioVoice}`);
    console.log(`🎛️ Modelo TTS seleccionado: ${selectedApplioModel}`);
  console.log(`🎵 Pitch seleccionado: ${selectedPitch}`);
  console.log(`🚀 Velocidad seleccionada: ${selectedSpeed}`);
    
    try {
      // 1. Iniciar Applio automáticamente
      console.log('🚀 [DEBUG] Iniciando Applio para la sección...');
      console.log('🔍 [DEBUG] Estado antes de startApplio:', {
        applioStarted: applioStarted,
        section: section
      });
      
      const applioStartResult = await startApplio();
      if (!applioStartResult) {
        throw new Error('No se pudo iniciar Applio automáticamente');
      }
      
      console.log('🔍 [DEBUG] startApplio completado exitosamente');
      
      // 2. Verificar conexión con Applio (ya debería estar listo por startApplio)
      const isConnected = await applioClient.checkConnection();
      if (!isConnected) {
        throw new Error('Applio no está disponible en el puerto 6969');
      }
      
      console.log('✅ Applio iniciado y listo para generar audio');
      console.log('🔍 [DEBUG] Estado después de verificación:', {
        applioStarted: applioStarted,
        connected: isConnected
      });
      
      // Crear nombre del archivo usando el nombre normalizado consistente
      const fileName = `${actualFolderName}_seccion_${section}_applio_${Date.now()}.wav`;
      const filePath = path.join(folderStructure.sectionDir, fileName);
      
      console.log(`📁 Guardando audio en: ${filePath}`);
      
      // Generar audio con Applio
      const result = await applioClient.textToSpeech(script, filePath, {
        model: selectedApplioModel,
        speed: selectedSpeed,
        pitch: selectedPitch,
        voicePath: selectedApplioVoice
      });
      
      if (!result.success) {
        throw new Error('Applio no generó el audio correctamente');
      }
      
      console.log(`✅ Audio Applio generado exitosamente: ${filePath}`);
      console.log(`📊 Tamaño del archivo: ${(result.size / 1024).toFixed(1)} KB`);
      
      // Applio permanece abierto para futuras generaciones
      console.log('ℹ️ Applio permanece abierto para futuras generaciones de audio');
      console.log('🔍 [DEBUG] Audio generado, estado de Applio:', {
        applioStarted: applioStarted,
        section: section,
        timestamp: new Date().toISOString()
      });
      
      // Retornar la ruta relativa para acceso web
      const relativePath = path.relative('./public', filePath).replace(/\\/g, '/');
      
      res.json({ 
        success: true,
        audioFile: relativePath,
        method: 'Applio Node.js',
        section: section,
        size: result.size,
        message: `Audio generado con Applio para la sección ${section}`,
        applioStatus: 'permanece_abierto'
      });
      
      console.log('🔍 [DEBUG] Respuesta enviada, Applio sigue disponible');
      
    } catch (applioError) {
      console.error('❌ Error con cliente Applio:', applioError);
      console.log('🔍 [DEBUG] Error en generación, estado de Applio:', {
        applioStarted: applioStarted,
        error: applioError.message
      });
      
      // No cerrar Applio en caso de error, solo registrar el error
      console.log('⚠️ Error generando audio, pero Applio permanece abierto para reintentarlo');
      
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
    const { cmd, args } = await detectPythonCommand();
    const pythonProcess = spawn(cmd, [...args, tempScriptPath], {
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

// Ruta para obtener las voces disponibles de Applio
app.get('/api/applio-voices', (req, res) => {
  try {
    console.log('🎤 Solicitando lista de voces de Applio...');
    const voices = getAvailableVoices();
    
    res.json({
      success: true,
      voices: voices,
      count: voices.length
    });
    
    console.log(`✅ Enviadas ${voices.length} voces al cliente`);
  } catch (error) {
    console.error('❌ Error obteniendo voces:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener las voces disponibles',
      voices: [{
        name: 'RemyOriginal (Default)',
        path: 'logs\\VOCES\\RemyOriginal.pth',
        displayName: 'RemyOriginal'
      }]
    });
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

    const { cmd, args } = await detectPythonCommand();
    const pythonProcess = spawn(cmd, [...args, tempScriptPath], {
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

// Funciones auxiliares para generación de metadata de YouTube
function buildYouTubeMetadataPrompt({ topic, fullScript, thumbnailInstructions, targetLanguage, chaptersTimestamps }) {
  const chaptersSection = chaptersTimestamps ? `

**CHAPTERS (include at the end of the description):**
${chaptersTimestamps}
` : '';

  if (targetLanguage === 'en') {
   return `
Based on the following topic and complete video script, generate YouTube metadata in ENGLISH.

IMPORTANT:
- Write absolutely all metadata in ENGLISH (titles, description, tags, thumbnail prompts).
- Keep the exact output format provided below (headings remain in Spanish to match the client parser).${chaptersSection}

**TOPIC:** ${topic}

**FULL SCRIPT:**
${fullScript}

Please generate:

1. **10 CLICKBAIT TITLES** (one per line, numbered):
  - Use curiosity driven phrases.
  - If the content is a list (e.g. 5 items), the title MUST include the number.
  - Structure: "The [Number] [Adjective] [Subject] in [Topic/Game]". Example: "The 5 Hardest Weapons to Get in World of Warcraft".
  - Mention the specific game/topic explicitly.
  - Maximum 12 words, minimum 6.

2. **VIDEO DESCRIPTION** (SEO optimised):
  - Between 150-300 words
  - Include relevant keywords from the topic
  - Mention the main content of the video
  - Add a call-to-action to subscribe
  - Engaging format with emojis${chaptersTimestamps ? `
  - IMPORTANT: At the end of the description, add a blank line and then include the chapter timestamps. Use the provided times but REWRITE the titles to be VERY SHORT (max 6 words). Format: "MM:SS Short Title"` : ''}

3. **25 TAGS** (comma-separated):
  - Keywords related to the topic
  - Popular tags for the niche
  - Relevant search terms

4. **5 PROMPTS FOR YOUTUBE THUMBNAILS** (one per line, numbered):

  MANDATORY FORMAT - FOLLOW THIS EXACT STRUCTURE FOR EACH OF THE 5 PROMPTS:

  "YouTube thumbnail 16:9 showing [very detailed visual description of the content related to the topic, minimum 25 words]. High quality, 8k resolution, cinematic lighting. IMPORTANT: The image must NOT contain any text, letters, or words."

  STRICT RULES - DO NOT GENERATE SHORT OR INCOMPLETE PROMPTS:
  - EACH prompt must have at least 25 words of visual description
  - NO TEXT overlay in the image.
  - DO NOT include instructions for text styles.
  - ALL prompts must strictly follow the full format

OUTPUT FORMAT (use these exact Spanish headings):
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
  }

  return `
Basándote en el siguiente tema y guión completo del video, genera metadata optimizada para YouTube en ESPAÑOL.

IMPORTANTE:
- Usa español para absolutamente todo el contenido (títulos, descripción, etiquetas y prompts).
- Mantén el formato de salida exactamente como se indica a continuación.${chaptersSection}

**TEMA:** ${topic}

**GUIÓN COMPLETO:**
${fullScript}

Por favor genera:

1. **10 TÍTULOS CLICKBAIT** (cada uno en una línea, numerados):
  - Usa palabras que generen curiosidad.
  - Si el contenido es una lista (ej. 5 cosas), el título DEBE incluir el número.
  - Estructura: "Las [Número] [Adjetivo] [Sujeto] en [Tema/Juego]". Ej: "Las 5 Armas Más Difíciles de Conseguir en World of Warcraft".
  - Menciona el juego o tema específico explícitamente.
  - Máximo 12 palabras, mínimo 6.

2. **DESCRIPCIÓN PARA VIDEO** (optimizada para SEO):
  - Entre 150-300 palabras
  - Incluye palabras clave relevantes del tema
  - Menciona el contenido principal del video
  - Incluye call-to-action para suscribirse
  - Formato atractivo con emojis${chaptersTimestamps ? `
  - IMPORTANTE: Al final de la descripción, añade una línea en blanco y luego incluye los timestamps de capítulos. Usa los tiempos proporcionados pero REESCRIBE los títulos para que sean MUY CORTOS (máximo 6 palabras). Formato: "MM:SS Título Corto"` : ''}

3. **25 ETIQUETAS** (separadas por comas):
  - Palabras clave relacionadas al tema
  - Tags populares del nicho correspondiente
  - Términos de búsqueda relevantes

4. **5 PROMPTS PARA MINIATURAS DE YOUTUBE** (cada uno en una línea, numerados):
   
  FORMATO OBLIGATORIO - DEBES SEGUIR ESTA ESTRUCTURA EXACTA PARA CADA UNO DE LOS 5 PROMPTS:
   
  "Miniatura de YouTube 16:9 mostrando [descripción visual muy detallada del contenido relacionado al tema, mínimo 25 palabras]. Alta calidad, resolución 8k, iluminación cinematográfica. IMPORTANTE: La imagen NO debe contener ningún texto, letras ni palabras."
   
  REGLAS ESTRICTAS - NO GENERAR PROMPTS CORTOS O INCOMPLETOS:
  - CADA prompt debe tener mínimo 25 palabras de descripción visual
  - NO incluyas instrucciones de texto superpuesto.
  - La imagen debe ser totalmente limpia de texto.
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
}

function buildThumbnailRegenerationPrompt({ topic, thumbnailInstructions, targetLanguage }) {
  if (targetLanguage === 'en') {
   return `
Generate EXACTLY 5 complete YouTube thumbnail prompts in ENGLISH about: ${topic}

MANDATORY FORMAT for each prompt:
"YouTube thumbnail 16:9 showing [very detailed description, minimum 25 words] with overlaid text '[specific clickbait phrase]' with the text applying the following style: ${thumbnailInstructions}"

STRICT RULES:
- Each prompt must have at least 30 words
- NEVER generate "the text with black outline and very shiny text"
- ALL prompts must end with the complete style sentence above
- Number them from 1 to 5

1. [full prompt]
2. [full prompt]
3. [full prompt]
4. [full prompt]
5. [full prompt]
   `;
  }

  return `
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
}

// Endpoint para generar títulos, descripción y etiquetas para YouTube
// Función auxiliar para traducir una sección
async function translateSectionScript(folderName, sectionNum, targetLang, projectDir) {
  const sectionDir = path.join(projectDir, `seccion_${sectionNum}`);
  if (!fs.existsSync(sectionDir)) return null;

  // Verificar si ya existe la traducción antes de generar
  const translatedFileName = `${folderName}_seccion_${sectionNum}_guion_${targetLang}.txt`;
  const translatedFilePath = path.join(sectionDir, translatedFileName);
  
  if (fs.existsSync(translatedFilePath)) {
    console.log(`⏩ Traducción ya existe para sección ${sectionNum} (${targetLang}), omitiendo...`);
    return true;
  }

  const scriptFiles = fs.readdirSync(sectionDir).filter(f => f.endsWith('_guion.txt') && !f.includes('_translated_'));
  if (scriptFiles.length === 0) return null;

  const originalScriptPath = path.join(sectionDir, scriptFiles[0]);
  const originalContent = fs.readFileSync(originalScriptPath, 'utf8');
  
  // Extraer solo el contenido del guion
  const scriptContent = extractScriptContent(originalContent)?.content || originalContent;

  const langNames = {
    'en': 'English', 'fr': 'French', 'de': 'German', 
    'ko': 'Korean', 'ru': 'Russian', 'pt': 'Portuguese'
  };
  const targetLangName = langNames[targetLang] || targetLang;

  let additionalInstructions = "";
  if (targetLang === 'ko') {
    additionalInstructions = `
    IMPORTANT: Summarize and condense the content by approximately 30% while translating.
    Korean text tends to be longer or slower to read, so please be concise.
    Keep the core message and key details, but remove redundancy and shorten sentences where possible.
    `;
  } else if (targetLang === 'de') {
    additionalInstructions = `
    IMPORTANT: Summarize and condense the content by approximately 20% while translating.
    German text tends to be longer, so please be concise.
    Keep the core message and key details, but remove redundancy and shorten sentences where possible.
    `;
  }

  const prompt = `
    Translate the following video script content to ${targetLangName}.
    Maintain the tone, style, and formatting.
    Do NOT translate technical terms that should remain in English/Spanish if applicable.
    ${additionalInstructions}
    
    SCRIPT TO TRANSLATE:
    ${scriptContent}
    
    OUTPUT ONLY THE TRANSLATED TEXT.
  `;

  const { model } = await getGoogleAI(GEMINI_TEXT_MODEL, { context: 'llm' });
  const result = await model.generateContent(prompt);
  const translatedText = result.response.text();

  const translatedFileContent = `GUIÓN TRADUCIDO (${targetLangName.toUpperCase()}) - SECCIÓN ${sectionNum}
===============================
Original: ${scriptFiles[0]}
Idioma: ${targetLangName}
Fecha: ${new Date().toLocaleString()}

CONTENIDO DEL GUIÓN:
${translatedText}

===============================
Traducción generada por Gemini 2.5 Flash
`;

  fs.writeFileSync(translatedFilePath, translatedFileContent, 'utf8');
  return true;
}

app.post('/translate-project', async (req, res) => {
  const { folderName, targetLang, totalSections } = req.body;
  
  // Configurar headers para SSE (Server-Sent Events)
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const projectDir = path.join(globalOutputDir, folderName);
    const langNames = {
      'en': 'English', 'fr': 'French', 'de': 'German', 
      'ko': 'Korean', 'ru': 'Russian', 'pt': 'Portuguese'
    };
    const targetLangName = langNames[targetLang];

    console.log(`🌍 Iniciando traducción de proyecto ${folderName} a ${targetLangName}`);

    for (let i = 1; i <= totalSections; i++) {
      await translateSectionScript(folderName, i, targetLang, projectDir);
      
      // Enviar progreso al cliente
      res.write(`data: ${JSON.stringify({ progress: true, current: i, total: totalSections })}\n\n`);
    }

    res.write(`data: ${JSON.stringify({ complete: true })}\n\n`);
    res.end();

  } catch (error) {
    console.error('❌ Error en traducción:', error);
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
});

app.post('/translate-project-all', async (req, res) => {
  const { folderName, totalSections } = req.body;
  
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const projectDir = path.join(globalOutputDir, folderName);
    const languages = ['en', 'fr', 'de', 'ko', 'ru', 'pt', 'zh'];
    
    // Calcular total de tareas válidas (secciones que existen)
    let totalTasks = 0;
    for (let i = 1; i <= totalSections; i++) {
      const sectionDir = path.join(projectDir, `seccion_${i}`);
      if (fs.existsSync(sectionDir)) {
        const scriptFiles = fs.readdirSync(sectionDir).filter(f => f.endsWith('_guion.txt') && !f.includes('_translated_'));
        if (scriptFiles.length > 0) {
          totalTasks += languages.length;
        }
      }
    }

    console.log(`🌍 Iniciando traducción MASIVA de proyecto ${folderName} (${totalTasks} tareas estimadas)`);
    
    const MAX_RETRIES = 3;
    let currentSuccessCount = 0;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      // Identificar tareas pendientes (archivos que faltan)
      const tasks = [];
      currentSuccessCount = 0; // Recalcular éxito actual

      for (const lang of languages) {
        for (let i = 1; i <= totalSections; i++) {
          const sectionDir = path.join(projectDir, `seccion_${i}`);
          if (!fs.existsSync(sectionDir)) continue;

          const translatedFileName = `${folderName}_seccion_${i}_guion_${lang}.txt`;
          const translatedFilePath = path.join(sectionDir, translatedFileName);

          if (!fs.existsSync(translatedFilePath)) {
            // Verificar si existe el origen
            const scriptFiles = fs.readdirSync(sectionDir).filter(f => f.endsWith('_guion.txt') && !f.includes('_translated_'));
            if (scriptFiles.length > 0) {
              tasks.push({ lang, section: i });
            }
          } else {
            currentSuccessCount++;
          }
        }
      }

      if (tasks.length === 0) {
        console.log(`✅ Todas las traducciones completadas (Intento ${attempt}).`);
        break;
      }

      console.log(`🔄 Intento ${attempt}/${MAX_RETRIES}: Procesando ${tasks.length} traducciones pendientes...`);
      
      const CONCURRENCY_LIMIT = 8;
      const executing = new Set();
      const results = [];

      const processTask = async (task) => {
        try {
          const success = await translateSectionScript(folderName, task.section, task.lang, projectDir);
          if (success) {
            currentSuccessCount++;
          }
        } catch (err) {
          console.error(`❌ Error traduciendo sección ${task.section} a ${task.lang} (Intento ${attempt}):`, err.message);
        } finally {
          res.write(`data: ${JSON.stringify({ 
            progress: true, 
            completedTasks: currentSuccessCount, 
            totalTasks: totalTasks, 
            current: currentSuccessCount 
          })}\n\n`);
        }
      };

      for (const task of tasks) {
        const p = processTask(task).then(() => executing.delete(p));
        executing.add(p);
        results.push(p);

        if (executing.size >= CONCURRENCY_LIMIT) {
          await Promise.race(executing);
        }
      }

      await Promise.all(results);

      // Si aún faltan tareas y no es el último intento, esperar un poco
      if (attempt < MAX_RETRIES) {
        // Verificar si realmente fallaron cosas antes de esperar
        const remainingTasks = tasks.filter(t => {
           const p = path.join(projectDir, `seccion_${t.section}`, `${folderName}_seccion_${t.section}_guion_${t.lang}.txt`);
           return !fs.existsSync(p);
        });
        
        if (remainingTasks.length > 0) {
          console.log(`⏳ Esperando 2s antes del reintento... (${remainingTasks.length} fallos)`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        } else {
          break; // Todo se completó en este intento
        }
      }
    }

    res.write(`data: ${JSON.stringify({ complete: true })}\n\n`);
    res.end();

  } catch (error) {
    console.error('❌ Error en traducción masiva:', error);
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
});

// Función auxiliar para generar audio traducido
async function generateTranslatedAudioForSection(folderName, sectionNum, lang, projectDir, applioSettings) {
  const sectionDir = path.join(projectDir, `seccion_${sectionNum}`);
  const scriptFileName = `${folderName}_seccion_${sectionNum}_guion_${lang}.txt`;
  const scriptPath = path.join(sectionDir, scriptFileName);
  
  if (!fs.existsSync(scriptPath)) {
    console.log(`⚠️ No existe guion traducido para sección ${sectionNum} (${lang}), omitiendo...`);
    return false;
  }

  // Verificar si ya existe el audio
  const audioFileName = `${folderName}_seccion_${sectionNum}_audio_${lang}.wav`;
  const audioPath = path.join(sectionDir, audioFileName);
  
  if (fs.existsSync(audioPath)) {
    console.log(`⏩ Audio ya existe para sección ${sectionNum} (${lang}), omitiendo...`);
    return true;
  }

  const scriptContent = fs.readFileSync(scriptPath, 'utf8');
  const cleanScript = extractScriptContent(scriptContent)?.content || scriptContent;

  console.log(`📝 [${lang}] Contenido del guion (${cleanScript.length} chars): "${cleanScript.substring(0, 50).replace(/\n/g, ' ')}..."`);

  // Mapeo de voces TTS base por idioma (Edge TTS)
  const ttsVoices = {
    'en': 'en-US-ChristopherNeural', // Masculino neutral
    'fr': 'fr-FR-HenriNeural',       // Masculino neutral
    'de': 'de-DE-ConradNeural',      // Masculino neutral
    'ko': 'ko-KR-InJoonNeural',      // Masculino neutral
    'ru': 'ru-RU-DmitryNeural',      // Masculino neutral
    'pt': 'pt-BR-AntonioNeural',     // Masculino neutral
    'zh': 'zh-CN-YunxiNeural'        // Masculino neutral
  };
  
  const ttsVoice = ttsVoices[lang] || 'en-US-ChristopherNeural';
  
  console.log(`🎤 Generando audio traducido (${lang}) con voz base ${ttsVoice} y Applio ${applioSettings.voice}...`);
  
  try {
    // Asegurar que Applio esté conectado
    await applioClient.checkConnection();

    const result = await applioClient.textToSpeech(cleanScript, audioPath, {
      model: ttsVoice,
      voicePath: applioSettings.voice,
      pitch: applioSettings.pitch || 0,
      speed: applioSettings.speed || 0
    });

    return result.success;

  } catch (error) {
    console.error(`❌ Error generando audio traducido para sección ${sectionNum} (${lang}):`, error);
    return false;
  }
}

async function fitAudioToDuration(inputPath, outputPath, targetDurationSec) {
  const ffmpeg = (await import('fluent-ffmpeg')).default;
  const ffmpegPath = (await import('ffmpeg-static')).default;
  ffmpeg.setFfmpegPath(ffmpegPath);
  
  // 1. Obtener duración actual
  const currentDuration = await new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err) reject(err);
      else resolve(metadata.format.duration);
    });
  });

  // 2. Calcular el factor de velocidad (atempo)
  // Si dura 100s y queremos 80s: 100/80 = 1.25 (Acelerar)
  // Si dura 80s y queremos 100s: 80/100 = 0.8 (Ralentizar)
  let tempo = currentDuration / targetDurationSec;

  // Limitación de FFmpeg: atempo solo acepta valores entre 0.5 y 2.0
  // Si el cambio es muy drástico, hay que encadenar filtros (ej: atempo=2.0,atempo=1.5)
  // Para tu caso de uso (ajustes leves), un solo filtro suele bastar.
  
  if (tempo < 0.5 || tempo > 2.0) {
    console.warn(`⚠️ El cambio de velocidad (${tempo.toFixed(2)}x) es muy drástico y podría perder calidad.`);
    // Clamp tempo to avoid ffmpeg error
    tempo = Math.max(0.5, Math.min(2.0, tempo));
  }

  console.log(`⏱️ Ajustando audio: ${currentDuration.toFixed(1)}s -> ${targetDurationSec.toFixed(1)}s (Factor: ${tempo.toFixed(3)}x)`);

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .audioFilters(`atempo=${tempo}`)
      .on('error', (err) => reject(err))
      .on('end', () => resolve(true))
      .save(outputPath);
  });
}

async function concatenateTranslatedAudios(projectDir, folderName, totalSections, targetDuration = null, silencePadding = 0) {
  const ffmpeg = (await import('fluent-ffmpeg')).default;
  const ffmpegPath = (await import('ffmpeg-static')).default;
  ffmpeg.setFfmpegPath(ffmpegPath);

  const outputDir = path.join(projectDir, 'audios_completos');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const languages = ['en', 'fr', 'de', 'ko', 'ru', 'pt', 'zh'];
  const langMap = {
    'en': 'ingles',
    'fr': 'frances',
    'de': 'aleman',
    'ko': 'coreano',
    'ru': 'ruso',
    'pt': 'portugues',
    'zh': 'chino'
  };

  for (const lang of languages) {
    const audioFiles = [];
    for (let i = 1; i <= totalSections; i++) {
      const sectionDir = path.join(projectDir, `seccion_${i}`);
      const audioFileName = `${folderName}_seccion_${i}_audio_${lang}.wav`;
      const audioPath = path.join(sectionDir, audioFileName);
      
      if (fs.existsSync(audioPath)) {
        audioFiles.push(audioPath);
      }
    }

    if (audioFiles.length > 0) {
      const outputFileName = `${langMap[lang] || lang}.wav`;
      const outputPath = path.join(outputDir, outputFileName);
      
      console.log(`🔗 Uniendo ${audioFiles.length} audios para ${langMap[lang]}...`);
      
      // 1. Unir audios (y ajustar duración si es necesario)
      if (targetDuration) {
        // En este punto ya tenemos el WAV unido de las partes
        // Vamos a asegurarnos de que la salida final sea WAV de alta calidad (48kHz)
        
        const tempOutputPath = path.join(outputDir, `temp_${outputFileName}`);
        
        await new Promise((resolve, reject) => {
          const command = ffmpeg();
          audioFiles.forEach(file => command.input(file));
          command
            .on('error', (err) => reject(err))
            .on('end', () => resolve())
            .mergeToFile(tempOutputPath, os.tmpdir());
        });

        // Ajustar duración
        try {
          await fitAudioToDuration(tempOutputPath, outputPath, targetDuration);
          fs.unlinkSync(tempOutputPath); // Borrar temporal
        } catch (err) {
          console.error(`❌ Error ajustando duración para ${lang}:`, err);
          if (fs.existsSync(tempOutputPath)) {
             fs.renameSync(tempOutputPath, outputPath);
          }
        }

      } else {
        // Comportamiento normal sin ajuste de tiempo
        await new Promise((resolve, reject) => {
          const command = ffmpeg();
          audioFiles.forEach(file => command.input(file));
          command
            .on('error', (err) => {
              console.error(`❌ Error uniendo audios ${lang}:`, err);
              reject(err);
            })
            .on('end', () => {
              console.log(`✅ Audio unido creado: ${outputPath}`);
              resolve();
            })
            .mergeToFile(outputPath, os.tmpdir());
        });
      }

      // 2. Agregar silencio al final si se solicitó
      if (silencePadding > 0 && fs.existsSync(outputPath)) {
        console.log(`🔇 Agregando ${silencePadding}s de silencio a ${langMap[lang]}...`);
        const tempWithSilence = path.join(outputDir, `temp_silence_${outputFileName}`);
        
        try {
          // Obtener duración actual para calcular el total
          const currentDuration = await new Promise((resolve, reject) => {
            ffmpeg.ffprobe(outputPath, (err, metadata) => {
              if (err) reject(err);
              else resolve(metadata.format.duration);
            });
          });

          const totalDuration = currentDuration + parseFloat(silencePadding);

          await new Promise((resolve, reject) => {
            ffmpeg(outputPath)
              .audioFilters('apad')
              .duration(totalDuration)
              .on('error', reject)
              .on('end', resolve)
              .save(tempWithSilence);
          });

          // Reemplazar archivo original con el que tiene silencio
          fs.unlinkSync(outputPath);
          fs.renameSync(tempWithSilence, outputPath);
          console.log(`✅ Silencio agregado a: ${outputPath}`);

        } catch (silenceError) {
          console.error(`❌ Error agregando silencio a ${lang}:`, silenceError);
          if (fs.existsSync(tempWithSilence)) fs.unlinkSync(tempWithSilence);
        }
      }

      // 3. Mezclar con música de fondo si existe "musica.wav" en la raíz del proyecto
      const musicPath = path.join(projectDir, 'musica.wav');
      if (fs.existsSync(musicPath) && fs.existsSync(outputPath)) {
        console.log(`🎵 Mezclando música de fondo para ${langMap[lang]}...`);
        const tempWithMusic = path.join(outputDir, `temp_music_${outputFileName}`);
        
        try {
          // Obtener duración del audio de voz (ya con silencio si se aplicó)
          const voiceDuration = await new Promise((resolve, reject) => {
            ffmpeg.ffprobe(outputPath, (err, metadata) => {
              if (err) reject(err);
              else resolve(metadata.format.duration);
            });
          });

          await new Promise((resolve, reject) => {
            ffmpeg()
              .input(outputPath) // Input 0: Voz (WAV)
              .input(musicPath)  // Input 1: Música
              .complexFilter([
                // Ajustar volumen de la música (ej: 0.7 para que no tape la voz)
                `[1:a]volume=0.7,aloop=loop=-1:size=2e+09[music]`, 
                // Recortar música a la duración exacta de la voz
                `[music]atrim=duration=${voiceDuration}[music_trimmed]`,
                // Mezclar voz y música.
                // IMPORTANTE: aresample=48000 para evitar que el audio de 24kHz baje la calidad de todo
                `[0:a]aresample=48000[voice_resampled];[voice_resampled][music_trimmed]amix=inputs=2:duration=first:dropout_transition=2,volume=2[out]`
              ])
              .map('[out]')
              .audioFrequency(48000) // Forzar 48kHz en la salida final
              .on('error', reject)
              .on('end', resolve)
              .save(tempWithMusic);
          });

          // Reemplazar archivo original con el mezclado
          fs.unlinkSync(outputPath);
          fs.renameSync(tempWithMusic, outputPath);
          console.log(`✅ Música mezclada en: ${outputPath}`);

        } catch (musicError) {
          console.error(`❌ Error mezclando música para ${lang}:`, musicError);
          if (fs.existsSync(tempWithMusic)) fs.unlinkSync(tempWithMusic);
        }
      }
    }
  }
}

app.post('/generate-translated-audios', async (req, res) => {
  const { folderName, totalSections, applioVoice, applioModel, applioPitch, applioSpeed, silencePadding, targetDuration: requestedDuration } = req.body;
  
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const projectDir = path.join(globalOutputDir, folderName);
    
    // 1. Generar y medir audio en ESPAÑOL (Referencia de duración) - PRIMER PASO
    console.log('🔗 Procesando audio base (Español)...');
    res.write(`data: ${JSON.stringify({ progress: true, message: 'Procesando audio español...' })}\n\n`);
    
    let targetDuration = null;
    let finalSilencePadding = silencePadding;

    if (requestedDuration && requestedDuration > 20) {
        targetDuration = requestedDuration - 20;
        finalSilencePadding = 20;
        console.log(`🎯 Duración objetivo manual: ${requestedDuration}s (Audio: ${targetDuration}s + Silencio: 20s)`);
    }
    
    try {
      const ffmpeg = (await import('fluent-ffmpeg')).default;
      const ffmpegPath = (await import('ffmpeg-static')).default;
      ffmpeg.setFfmpegPath(ffmpegPath);

      const outputDir = path.join(projectDir, 'audios_completos');
      if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

      const spanishFiles = [];
      for (let i = 1; i <= totalSections; i++) {
        const sectionDir = path.join(projectDir, `seccion_${i}`);
        if (!fs.existsSync(sectionDir)) continue;

        // Buscar todos los archivos WAV
        const files = fs.readdirSync(sectionDir);
        const wavFiles = files.filter(f => f.toLowerCase().endsWith('.wav'));
        
        // Excluir los que sabemos que son traducciones (terminan en _en.wav, _fr.wav, etc.)
        const translationSuffixes = ['_en.wav', '_fr.wav', '_de.wav', '_ko.wav', '_ru.wav', '_pt.wav', '_zh.wav'];
        const candidates = wavFiles.filter(f => {
            return !translationSuffixes.some(suffix => f.toLowerCase().endsWith(suffix));
        });

        let selectedFile = null;

        if (candidates.length === 1) {
            selectedFile = candidates[0];
        } else if (candidates.length > 1) {
            // Si hay varios candidatos, elegir el más antiguo (el original en español)
            const candidatesWithStats = candidates.map(f => ({
                name: f,
                stat: fs.statSync(path.join(sectionDir, f))
            }));
            
            // Ordenar por fecha de modificación (el más viejo primero)
            candidatesWithStats.sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs);
            selectedFile = candidatesWithStats[0].name;
        }

        if (selectedFile) {
          const fullPath = path.join(sectionDir, selectedFile);
          console.log(`✅ Audio español detectado (Sección ${i}): ${selectedFile}`);
          spanishFiles.push(fullPath);
        } else {
          console.warn(`⚠️ No se encontró candidato para audio español en sección ${i}`);
        }
      }

      if (spanishFiles.length > 0) {
        const spanishOutputPath = path.join(outputDir, 'espanol.wav');
        
        // Verificar si ya existe el audio español unido para no regenerarlo innecesariamente
        if (!fs.existsSync(spanishOutputPath)) {
            console.log(`🔗 Uniendo ${spanishFiles.length} audios de Español...`);
            
            await new Promise((resolve, reject) => {
              const command = ffmpeg();
              spanishFiles.forEach(f => command.input(f));
              command
                .on('error', reject)
                .on('end', resolve)
                .mergeToFile(spanishOutputPath, os.tmpdir());
            });
        } else {
            console.log(`⏩ Audio español unido ya existe, omitiendo unión.`);
        }

        // Obtener duración del español unido (siempre necesario para referencia)
        const spanishDuration = await new Promise((resolve, reject) => {
          ffmpeg.ffprobe(spanishOutputPath, (err, metadata) => {
            if (err) reject(err);
            else resolve(metadata.format.duration);
          });
        });
        
        if (!targetDuration) {
            targetDuration = spanishDuration;
        }
        
        console.log(`⏱️ Duración objetivo (Español): ${spanishDuration.toFixed(2)}s -> Usando: ${targetDuration.toFixed(2)}s`);
      } else {
        console.warn('⚠️ No se encontraron audios en español para usar como referencia de tiempo.');
      }

    } catch (esError) {
      console.error('❌ Error procesando audio español:', esError);
    }

    const languages = ['en', 'fr', 'de', 'ko', 'ru', 'pt', 'zh'];
    const tasks = [];

    // Crear tareas ordenadas por SECCIÓN y luego por IDIOMA (1 por 1 de la sección 1, luego sección 2, etc.)
    for (let i = 1; i <= totalSections; i++) {
      for (const lang of languages) {
        const scriptPath = path.join(projectDir, `seccion_${i}`, `${folderName}_seccion_${i}_guion_${lang}.txt`);
        
        // Verificar si ya existe el audio para no agregarlo a la cola
        const audioFileName = `${folderName}_seccion_${i}_audio_${lang}.wav`;
        const audioPath = path.join(projectDir, `seccion_${i}`, audioFileName);

        if (fs.existsSync(scriptPath) && !fs.existsSync(audioPath)) {
          tasks.push({ lang, section: i });
        }
      }
    }

    const totalTasks = tasks.length;
    let completedTasks = 0;
    
    console.log(`🎤 Iniciando generación de AUDIOS traducidos para ${folderName} (${totalTasks} tareas pendientes)`);
    console.log(`📋 Orden de procesamiento: Sección por Sección`);
    
    if (totalTasks > 0) {
        // Iniciar Applio si no está iniciado
        if (!applioStarted) {
          await startApplio();
        }

        const applioSettings = {
          voice: applioVoice,
          model: applioModel,
          pitch: applioPitch,
          speed: applioSpeed
        };

        const processTask = async (task) => {
          try {
            await generateTranslatedAudioForSection(folderName, task.section, task.lang, projectDir, applioSettings);
          } catch (err) {
            console.error(`❌ Error generando audio sección ${task.section} (${task.lang}):`, err.message);
          } finally {
            completedTasks++;
            res.write(`data: ${JSON.stringify({ progress: true, completedTasks, totalTasks, current: completedTasks })}\n\n`);
          }
        };

        // Ejecución secuencial 1 por 1 para evitar sobrecarga en Applio
        for (const task of tasks) {
          await processTask(task);
          // Pausa de seguridad entre audios para evitar conflictos de archivos en Applio
          console.log('⏳ Esperando 5 segundos para enfriar Applio...');
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
    } else {
        console.log('✅ Todos los audios ya existen. Saltando generación.');
    }

    // Unir audios por idioma al finalizar (usando targetDuration si existe)
    console.log('🔗 Iniciando unión de audios traducidos...');
    res.write(`data: ${JSON.stringify({ progress: true, message: 'Uniendo audios...' })}\n\n`);
    
    try {
      await concatenateTranslatedAudios(projectDir, folderName, totalSections, targetDuration, finalSilencePadding);
      console.log('✅ Unión de audios completada');
    } catch (concatError) {
      console.error('❌ Error uniendo audios:', concatError);
      res.write(`data: ${JSON.stringify({ error: 'Error uniendo audios: ' + concatError.message })}\n\n`);
    }

    res.write(`data: ${JSON.stringify({ complete: true })}\n\n`);
    res.end();

  } catch (error) {
    console.error('❌ Error en generación de audios:', error);
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
});

app.post('/translate-title', async (req, res) => {
  try {
    const { title } = req.body;
    if (!title) return res.status(400).json({ error: 'Título requerido' });

    console.log(`🌍 Traduciendo título: "${title}"`);

    const prompt = `
      Translate the following YouTube video title into these languages: 
      English (en), French (fr), German (de), Korean (ko), Russian (ru), Portuguese (pt), and Chinese Simplified (zh).
      
      Title: "${title}"
      
      Return ONLY a valid JSON object with the language codes as keys and the translated titles as values. 
      Example format:
      {
        "en": "Title in English",
        "fr": "Title in French",
        ...
      }
      Do not include markdown formatting or explanations.
    `;

    const { model } = await getGoogleAI(GEMINI_TEXT_MODEL, { context: 'llm', forcePrimary: true });
    const result = await model.generateContent(prompt);
    const responseText = result.response.text().replace(/```json|```/g, '').trim();
    
    const translations = JSON.parse(responseText);
    res.json(translations);

  } catch (error) {
    console.error('❌ Error traduciendo título:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/generate-youtube-metadata', async (req, res) => {
  try {
    const { topic, allSections, folderName, thumbnailStyle, language } = req.body;
    const targetLanguage = language === 'en' ? 'en' : 'es';

    if (!topic || !allSections || allSections.length === 0) {
      return res.status(400).json({ error: 'Tema y secciones requeridos' });
    }

    console.log(`🎬 Generando metadata de YouTube para: ${topic}`);
    console.log(`📝 Número de secciones: ${allSections.length}`);
    console.log(`🖼️ Estilo de miniatura: ${thumbnailStyle || 'default'}`);
    console.log(`🌐 Idioma objetivo de metadata: ${targetLanguage}`);

    // Combinar todas las secciones en un resumen
    const fullScript = allSections.join('\n\n--- SECCIÓN ---\n\n');

    // Obtener instrucciones de estilo de miniatura
    const thumbnailInstructions = getThumbnailStyleInstructions(thumbnailStyle || 'default');
    
    console.log(`🎨 thumbnailStyle recibido:`, thumbnailStyle);
    console.log(`📝 thumbnailInstructions generadas:`, thumbnailInstructions);

    // Generar timestamps de capítulos si hay folderName
    let chaptersTimestamps = '';
    if (folderName) {
      try {
        const safeFolderName = createSafeFolderName(folderName.trim());
        const projectDir = path.join(globalOutputDir, safeFolderName);
        const projectStateFile = path.join(projectDir, 'project_state.json');
        
        if (fs.existsSync(projectStateFile)) {
          const projectState = JSON.parse(fs.readFileSync(projectStateFile, 'utf8'));
          
          if (projectState.chapterStructure && projectState.chapterStructure.length > 0) {
            console.log(`📑 Generando timestamps para ${projectState.chapterStructure.length} capítulos`);
            
            const timestamps = [];
            let cumulativeSeconds = 0;
            
            for (let i = 0; i < projectState.chapterStructure.length; i++) {
              const chapterTitle = projectState.chapterStructure[i];
              const timestamp = formatSecondsToTimestamp(cumulativeSeconds);
              timestamps.push(`${timestamp} ${chapterTitle}`);
              
              // Buscar el archivo de audio de esta sección para obtener su duración
              const sectionNum = i + 1;
              const sectionDir = path.join(projectDir, `seccion_${sectionNum}`);
              
              if (fs.existsSync(sectionDir)) {
                const audioFiles = fs.readdirSync(sectionDir).filter(file => 
                  file.endsWith('.wav') && file.includes(`seccion_${sectionNum}`)
                );
                
                if (audioFiles.length > 0) {
                  const audioPath = path.join(sectionDir, audioFiles[0]);
                  const audioDuration = await getAudioDuration(audioPath);
                  cumulativeSeconds += Math.floor(audioDuration);
                  console.log(`⏱️ Sección ${sectionNum}: ${formatSecondsToTimestamp(audioDuration)} (acumulado: ${formatSecondsToTimestamp(cumulativeSeconds)})`);
                }
              }
            }
            
            chaptersTimestamps = timestamps.join('\n');
            console.log(`✅ Timestamps generados:\n${chaptersTimestamps}`);
          }
        }
      } catch (error) {
        console.error('⚠️ Error generando timestamps:', error);
        // Continuar sin timestamps si hay error
      }
    }

    const prompt = buildYouTubeMetadataPrompt({
      topic,
      fullScript,
      thumbnailInstructions,
      targetLanguage,
      chaptersTimestamps
    });

  const { model } = await getGoogleAI("gemini-3.1-flash-lite-preview", { context: 'llm' });
    
    const response = await model.generateContent([{ text: prompt }]);
    const responseText = response.response.text();

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
        const regeneratePrompt = buildThumbnailRegenerationPrompt({
          topic,
          thumbnailInstructions,
          targetLanguage
        });
        
  const { model: regenerateModel } = await getGoogleAI(GEMINI_TEXT_MODEL, { context: 'llm', forcePrimary: true });
        const regenerateResponse = await regenerateModel.generateContent([
          { text: regeneratePrompt }
        ]);
        
        // Reemplazar la sección de prompts en la respuesta original
        const newThumbnailPrompts = regenerateResponse.response.text().trim();
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
            
          const outputsDir = globalOutputDir;
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
Idioma de metadata: ${targetLanguage === 'en' ? 'Inglés' : 'Español'}
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
          message: 'Metadata generada exitosamente (con prompts corregidos)',
          language: targetLanguage
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
        
      const outputsDir = globalOutputDir;
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
Idioma de metadata: ${targetLanguage === 'en' ? 'Inglés' : 'Español'}
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
      sectionsCount: allSections.length,
      language: targetLanguage
    });

  } catch (error) {
    console.error('❌ Error generando metadata de YouTube:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error generando metadata de YouTube: ' + error.message 
    });
  }
});

// ================================
// RUTAS PARA SISTEMA DE PROYECTOS
// ================================

// Ruta para obtener lista de proyectos disponibles
app.get('/api/projects', (req, res) => {
  try {
    console.log('📡 API /api/projects llamada');
    const projects = getAvailableProjects();
    console.log('📊 Proyectos encontrados:', projects.length);
    res.json({ success: true, projects });
  } catch (error) {
    console.error('❌ Error obteniendo proyectos:', error);
    res.status(500).json({ success: false, error: 'Error obteniendo proyectos: ' + error.message });
  }
});

// Ruta para cargar un proyecto específico
app.get('/api/projects/:folderName', (req, res) => {
  try {
    const { folderName } = req.params;
    const projectState = loadProjectState(folderName);
    
    if (!projectState) {
      return res.status(404).json({ success: false, error: 'Proyecto no encontrado' });
    }
    
    res.json({ success: true, project: projectState });
  } catch (error) {
    console.error('❌ Error cargando proyecto:', error);
    res.status(500).json({ success: false, error: 'Error cargando proyecto' });
  }
});

// Endpoint para diagnosticar y reparar un proyecto específico
app.get('/api/projects/:folderName/diagnose', (req, res) => {
  try {
    const { folderName } = req.params;
    const projectDir = path.join(globalOutputDir, folderName);
    const projectStateFile = path.join(projectDir, 'project_state.json');
    
    console.log(`🔍 Diagnosticando proyecto: ${folderName}`);
    
    const diagnosis = {
      projectName: folderName,
      projectDirExists: fs.existsSync(projectDir),
      projectStateFileExists: fs.existsSync(projectStateFile),
      errors: [],
      warnings: [],
      repairAttempted: false,
      repairSuccessful: false
    };
    
    if (!diagnosis.projectDirExists) {
      diagnosis.errors.push('El directorio del proyecto no existe');
      return res.json({ success: false, diagnosis });
    }
    
    if (!diagnosis.projectStateFileExists) {
      diagnosis.errors.push('El archivo project_state.json no existe');
      return res.json({ success: false, diagnosis });
    }
    
    // Leer y analizar el archivo
    try {
      const fileContent = fs.readFileSync(projectStateFile, 'utf8');
      diagnosis.fileSize = fileContent.length;
      diagnosis.filePreview = fileContent.substring(0, 200) + (fileContent.length > 200 ? '...' : '');
      
      if (!fileContent.trim()) {
        diagnosis.errors.push('El archivo JSON está vacío');
        return res.json({ success: false, diagnosis });
      }
      
      // Intentar parsear
      try {
        const projectState = JSON.parse(fileContent);
        diagnosis.parseSuccessful = true;
        diagnosis.projectData = {
          topic: projectState.topic,
          totalSections: projectState.totalSections,
          completedSections: projectState.completedSections?.length || 0,
          lastModified: projectState.lastModified
        };
      } catch (parseError) {
        diagnosis.errors.push(`Error de JSON: ${parseError.message}`);
        
        // Intentar reparar
        diagnosis.repairAttempted = true;
        
        if (!fileContent.trim().endsWith('}') && !fileContent.trim().endsWith(']')) {
          let repairedContent = fileContent.trim();
          
          // Contar llaves abiertas vs cerradas
          const openBraces = (repairedContent.match(/\{/g) || []).length;
          const closeBraces = (repairedContent.match(/\}/g) || []).length;
          
          if (openBraces > closeBraces) {
            // Agregar llaves faltantes
            for (let i = 0; i < openBraces - closeBraces; i++) {
              repairedContent += '}';
            }
            
            try {
              const repairedState = JSON.parse(repairedContent);
              
              // Crear backup del archivo original
              const backupPath = projectStateFile + '.backup.' + Date.now();
              fs.copyFileSync(projectStateFile, backupPath);
              
              // Guardar archivo reparado
              fs.writeFileSync(projectStateFile, JSON.stringify(repairedState, null, 2), 'utf8');
              
              diagnosis.repairSuccessful = true;
              diagnosis.repairDetails = `Agregadas ${openBraces - closeBraces} llaves faltantes`;
              diagnosis.backupPath = path.basename(backupPath);
              diagnosis.projectData = {
                topic: repairedState.topic,
                totalSections: repairedState.totalSections,
                completedSections: repairedState.completedSections?.length || 0,
                lastModified: repairedState.lastModified
              };
            } catch (repairError) {
              diagnosis.errors.push(`Error en reparación: ${repairError.message}`);
            }
          } else {
            diagnosis.warnings.push('El archivo parece completo pero no se puede parsear');
          }
        }
      }
      
    } catch (readError) {
      diagnosis.errors.push(`Error leyendo archivo: ${readError.message}`);
    }
    
    const isHealthy = diagnosis.errors.length === 0 && (diagnosis.parseSuccessful || diagnosis.repairSuccessful);
    
    res.json({ 
      success: isHealthy, 
      diagnosis,
      message: isHealthy ? 'Proyecto saludable' : 'Proyecto tiene problemas'
    });
    
  } catch (error) {
    console.error('❌ Error diagnosticando proyecto:', error);
    res.status(500).json({ success: false, error: 'Error diagnosticando proyecto: ' + error.message });
  }
});

// Endpoint para reconstruir manualmente un proyecto específico
app.post('/api/projects/:folderName/reconstruct', (req, res) => {
  try {
    const { folderName } = req.params;
    
    console.log(`🔧 Solicitud de reconstrucción manual para proyecto: ${folderName}`);
    
    const reconstructedState = reconstructProjectState(folderName);
    
    if (!reconstructedState) {
      return res.status(500).json({ 
        success: false, 
        error: 'No se pudo reconstruir el proyecto. Verifica que las carpetas existan.' 
      });
    }
    
    // Guardar el estado reconstruido
    const projectStateFile = path.join(globalOutputDir, folderName, 'project_state.json');
    
    // Crear backup del archivo existente si existe
    if (fs.existsSync(projectStateFile)) {
      const backupPath = projectStateFile + '.backup.' + Date.now();
      fs.copyFileSync(projectStateFile, backupPath);
      console.log(`🗃️ Backup creado: ${path.basename(backupPath)}`);
    }
    
    fs.writeFileSync(projectStateFile, JSON.stringify(reconstructedState, null, 2), 'utf8');
    
    res.json({ 
      success: true, 
      message: 'Proyecto reconstruido exitosamente',
      data: {
        projectName: folderName,
        totalSections: reconstructedState.totalSections,
        completedSections: reconstructedState.completedSections.length,
        reconstructedAt: reconstructedState.reconstructedAt,
        sectionsAnalyzed: reconstructedState.completedSections.map(s => ({
          section: s.section,
          hasScript: s.hasScript,
          hasAudio: s.hasAudio,
          hasImages: s.hasImages,
          fileCount: s.fileCount
        }))
      }
    });
    
  } catch (error) {
    console.error('❌ Error reconstruyendo proyecto:', error);
    res.status(500).json({ success: false, error: 'Error reconstruyendo proyecto: ' + error.message });
  }
});

// Endpoint para obtener imágenes de una sección específica
app.get('/api/project-images/:folderName/:sectionNumber', (req, res) => {
  try {
    const { folderName, sectionNumber } = req.params;
    const projectDir = path.join(globalOutputDir, folderName);
    const sectionDir = path.join(projectDir, `seccion_${sectionNumber}`);
    
    //console.log(`🖼️ Buscando imágenes en: ${sectionDir}`);
    
    if (!fs.existsSync(sectionDir)) {
      console.log(`📁 Directorio de sección no encontrado: ${sectionDir}`);
      return res.json({ success: true, images: [], keywords: [], prompts: [] });
    }
    
    // Buscar archivos de imagen
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
    const files = fs.readdirSync(sectionDir);
    const resolvePromptsFilePath = () => {
      const candidateNames = [
        `${folderName}_seccion_${sectionNumber}_prompts_imagenes.txt`,
        `seccion_${sectionNumber}_prompts_imagenes.txt`,
        `${folderName}-seccion-${sectionNumber}-prompts-imagenes.txt`,
        `${folderName}__seccion_${sectionNumber}_prompts_imagenes.txt`
      ];

      for (const candidateName of candidateNames) {
        const candidatePath = path.join(sectionDir, candidateName);
        if (fs.existsSync(candidatePath)) {
          if (candidateName !== candidateNames[0]) {
            //console.log(`🎨 Archivo de prompts alternativo detectado: ${candidateName}`);
          }
          return candidatePath;
        }
      }

      const fallbackCandidate = files.find(file => /_prompts_imagenes\.txt$/i.test(file));
      if (fallbackCandidate) {
        const fallbackPath = path.join(sectionDir, fallbackCandidate);
        //console.log(`🎨 Archivo de prompts encontrado por búsqueda genérica: ${fallbackCandidate}`);
        return fallbackPath;
      }

      return null;
    };

    const promptsFilePath = resolvePromptsFilePath();

    const extractPromptEntries = (content) => {
      if (!content || !content.trim()) {
        return [];
      }

      const normalized = content.replace(/\r\n/g, '\n');
      const promptSections = normalized
        .split(/===\s*PROMPT\s+\d+\s*===/gi)
        .map(section => section.trim())
        .filter(Boolean);

      if (promptSections.length) {
        return promptSections;
      }

      const doubleNewlineBlocks = normalized
        .split(/\n\s*\n+/)
        .map(block => block.trim())
        .filter(Boolean);

      if (doubleNewlineBlocks.length > 1) {
        return doubleNewlineBlocks;
      }

      const numberedLines = normalized
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && /^(\d+\.|Imagen\s+\d+|Prompt\s+\d+:)/i.test(line));

      if (numberedLines.length) {
        return numberedLines;
      }

      return normalized
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);
    };

    const imageFiles = files.filter(file => 
      imageExtensions.includes(path.extname(file).toLowerCase())
    );
    
    //console.log(`🖼️ Archivos de imagen encontrados: ${imageFiles.length}`);
    
    // Crear URLs para las imágenes
    const images = imageFiles.map(filename => {
      // Detectar si es imagen de Bing/Google por el nombre del archivo
      const isBingImage = filename.startsWith('bing_image_');
      
      return {
        url: `/outputs/${folderName}/seccion_${sectionNumber}/${filename}`,
        filename: filename,
        caption: `Imagen: ${filename}`,
        path: path.join(sectionDir, filename),
        source: isBingImage ? 'Google Images' : 'AI Generated'
      };
    });
    
    // Buscar archivo de keywords
    let keywords = [];
    const keywordsFile = path.join(sectionDir, `${folderName}_seccion_${sectionNumber}_keywords.txt`);
    if (fs.existsSync(keywordsFile)) {
      try {
        const keywordsContent = fs.readFileSync(keywordsFile, 'utf8');
        keywords = keywordsContent.split('\n').filter(line => line.trim());
        console.log(`📋 Keywords cargadas desde archivo keywords: ${keywords.length}`);
      } catch (error) {
        console.warn(`⚠️ Error leyendo keywords: ${error.message}`);
      }
    } else {
      // Intentar extraer keywords del archivo de prompts como fallback
      if (promptsFilePath && fs.existsSync(promptsFilePath)) {
        try {
          const promptsContent = fs.readFileSync(promptsFilePath, 'utf8');
          const lines = promptsContent.split('\n');
          
          // Buscar líneas que contengan "Imagen X: [keyword]"
          const keywordLines = lines.filter(line => {
            return line.match(/^\d+\.\s*Imagen\s+\d+:\s*(.+)$/);
          });
          
          keywords = keywordLines.map(line => {
            const match = line.match(/^\d+\.\s*Imagen\s+\d+:\s*(.+)$/);
            return match ? match[1].trim() : '';
          }).filter(keyword => keyword);
          
          //console.log(`📋 Keywords extraídas desde archivo de prompts: ${keywords.length}`);
        } catch (error) {
          //console.warn(`⚠️ Error extrayendo keywords desde prompts: ${error.message}`);
        }
      }
    }
    
    // 🔍 INTENTAR CARGAR KEYWORDS DESDE images_metadata.json
    if (keywords.length === 0) {
      const metadataFile = path.join(sectionDir, 'images_metadata.json');
      //console.log(`🔍 Buscando archivo de metadata: ${metadataFile}`);
      if (fs.existsSync(metadataFile)) {
        try {
          const metadataContent = fs.readFileSync(metadataFile, 'utf8');
          const metadata = JSON.parse(metadataContent);
          console.log(`📊 Metadata cargado:`, metadata);
          
          // Extraer keywords para cada imagen en orden
          const imageKeywords = [];
          for (const image of images) {
            const filename = image.filename;
            if (metadata[filename] && metadata[filename].keywords) {
              imageKeywords.push(metadata[filename].keywords);
              console.log(`🔑 Keyword para ${filename}: ${metadata[filename].keywords}`);
            } else {
              imageKeywords.push(''); // Placeholder vacío si no hay keyword
              console.log(`⚠️ No se encontró keyword para ${filename}`);
            }
          }
          
          if (imageKeywords.length > 0) {
            keywords = imageKeywords;
            console.log(`📋 Keywords finales cargadas desde images_metadata.json: ${keywords.length} items`);
            console.log(`📋 Keywords array:`, keywords);
          }
        } catch (error) {
          console.warn(`⚠️ Error leyendo images_metadata.json: ${error.message}`);
        }
      } else {
        //console.log(`❌ Archivo images_metadata.json no encontrado`);
      }
    }
    
    // Buscar archivo de prompts
    let prompts = [];
    if (promptsFilePath && fs.existsSync(promptsFilePath)) {
      try {
        const promptsContent = fs.readFileSync(promptsFilePath, 'utf8');
        prompts = extractPromptEntries(promptsContent);
        //console.log(`🎨 Prompts cargados: ${prompts.length}`);
      } catch (error) {
        //console.warn(`⚠️ Error leyendo prompts: ${error.message}`);
      }
    } else {
      //console.log(`🎨 Archivo de prompts no encontrado para sección ${sectionNumber}`);
    }
    
    //console.log(`✅ Respondiendo con ${images.length} imágenes, ${keywords.length} keywords, ${prompts.length} prompts`);
    
    // Si no hay keywords suficientes o hay keywords vacíos, llenar con keywords por defecto
    if (keywords.length < images.length) {
      //console.log(`⚠️ Hay ${images.length} imágenes pero solo ${keywords.length} keywords. Rellenando con valores por defecto.`);
      const defaultKeywords = [];
      for (let i = 0; i < images.length; i++) {
        if (keywords[i] && keywords[i].trim()) {
          defaultKeywords.push(keywords[i]);
        } else {
          // Generar keyword por defecto basado en el tema del proyecto
          const projectTopic = folderName.includes('guldan') ? 'guldan' : 'imagen';
          defaultKeywords.push(`${projectTopic} ${i + 1}`);
        }
      }
      keywords = defaultKeywords;
      //console.log(`📋 Keywords finales después del relleno:`, keywords);
    } else {
      // Verificar si hay keywords vacíos y rellenarlos
      const defaultKeywords = [];
      let hasEmptyKeywords = false;
      for (let i = 0; i < keywords.length; i++) {
        if (keywords[i] && keywords[i].trim()) {
          defaultKeywords.push(keywords[i]);
        } else {
          // Generar keyword por defecto basado en el tema del proyecto  
          const projectTopic = folderName.includes('guldan') ? 'guldan' : 'imagen';
          defaultKeywords.push(`${projectTopic} ${i + 1}`);
          hasEmptyKeywords = true;
        }
      }
      if (hasEmptyKeywords) {
        keywords = defaultKeywords;
        //console.log(`📋 Keywords rellenados (habían algunos vacíos):`, keywords);
      }
    }
    
    res.json({
      success: true, 
      images: images,
      keywords: keywords,
      prompts: prompts,
      sectionNumber: parseInt(sectionNumber)
    });  } catch (error) {
    console.error('❌ Error obteniendo imágenes del proyecto:', error);
    res.status(500).json({ success: false, error: 'Error obteniendo imágenes del proyecto' });
  }
});

// Endpoint para verificar si una sección tiene imágenes generadas
app.get('/api/check-section-images', (req, res) => {
  try {
    const { folderName, sectionNumber } = req.query;

    if (!folderName || !sectionNumber) {
      return res.status(400).json({
        success: false,
        error: 'Se requieren folderName y sectionNumber como parámetros de query'
      });
    }

    const projectDir = path.join(globalOutputDir, folderName);
    const sectionDir = path.join(projectDir, `seccion_${sectionNumber}`);

    console.log(`🔍 Verificando imágenes en: ${sectionDir}`);

    if (!fs.existsSync(sectionDir)) {
      console.log(`📁 Directorio de sección no encontrado: ${sectionDir}`);
      return res.json({ success: true, hasImages: false });
    }

    // Buscar archivos de imagen
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
    const files = fs.readdirSync(sectionDir);
    const imageFiles = files.filter(file =>
      imageExtensions.includes(path.extname(file).toLowerCase())
    );

    const hasImages = imageFiles.length > 0;
    //console.log(`🖼️ Sección ${sectionNumber} tiene ${imageFiles.length} imágenes: ${hasImages ? 'SÍ' : 'NO'}`);

    res.json({
      success: true,
      hasImages: hasImages,
      imageCount: imageFiles.length
    });

  } catch (error) {
    console.error('❌ Error verificando imágenes de sección:', error);
    res.status(500).json({
      success: false,
      error: 'Error verificando imágenes de sección',
      hasImages: false
    });
  }
});

// Ruta para eliminar un proyecto
app.delete('/api/projects/:folderName', (req, res) => {
  try {
    const { folderName } = req.params;
    const projectDir = path.join(globalOutputDir, folderName);
    
    if (fs.existsSync(projectDir)) {
      fs.rmSync(projectDir, { recursive: true, force: true });
      console.log(`🗑️ Proyecto eliminado: ${folderName}`);
      res.json({ success: true, message: 'Proyecto eliminado exitosamente' });
    } else {
      res.status(404).json({ success: false, error: 'Proyecto no encontrado' });
    }
  } catch (error) {
    console.error('❌ Error eliminando proyecto:', error);
    res.status(500).json({ success: false, error: 'Error eliminando proyecto' });
  }
});

// Ruta para duplicar un proyecto
app.post('/api/projects/:folderName/duplicate', (req, res) => {
  try {
    const { folderName } = req.params;
    const { newName } = req.body;
    
    const sourceDir = path.join(globalOutputDir, folderName);
    const newFolderName = createSafeFolderName(newName);
    const targetDir = path.join(globalOutputDir, newFolderName);
    
    if (!fs.existsSync(sourceDir)) {
      return res.status(404).json({ success: false, error: 'Proyecto fuente no encontrado' });
    }
    
    if (fs.existsSync(targetDir)) {
      return res.status(400).json({ success: false, error: 'Ya existe un proyecto con ese nombre' });
    }
    
    // Copiar directorio completo
    fs.cpSync(sourceDir, targetDir, { recursive: true });
    
    // Actualizar el archivo de estado del proyecto duplicado
    const projectStateFile = path.join(targetDir, 'project_state.json');
    if (fs.existsSync(projectStateFile)) {
      const projectState = JSON.parse(fs.readFileSync(projectStateFile, 'utf8'));
      projectState.originalFolderName = newName;
      projectState.folderName = newFolderName;
      projectState.createdAt = new Date().toISOString();
      projectState.lastModified = new Date().toISOString();
      
      fs.writeFileSync(projectStateFile, JSON.stringify(projectState, null, 2), 'utf8');
    }
    
    console.log(`📋 Proyecto duplicado: ${folderName} -> ${newFolderName}`);
    res.json({ 
      success: true, 
      message: 'Proyecto duplicado exitosamente',
      newFolderName: newFolderName
    });
  } catch (error) {
    console.error('❌ Error duplicando proyecto:', error);
    res.status(500).json({ success: false, error: 'Error duplicando proyecto' });
  }
});

// Ruta para abrir la carpeta del proyecto en el explorador de archivos
app.post('/api/open-folder', async (req, res) => {
  console.log('📂 ENDPOINT /api/open-folder llamado con body:', req.body);
  try {
    const { folderName } = req.body;
    
    if (!folderName) {
      return res.status(400).json({ 
        success: false, 
        error: 'Nombre de carpeta requerido' 
      });
    }
    
    const folderPath = path.join(globalOutputDir, folderName);
    
    // Verificar que la carpeta existe
    if (!fs.existsSync(folderPath)) {
      return res.status(404).json({ 
        success: false, 
        error: `La carpeta ${folderName} no existe` 
      });
    }
    
    console.log('📂 Abriendo carpeta:', folderPath);
    
    // Comando según el sistema operativo
    if (process.platform === 'win32') {
      // Windows - usar spawn para evitar problemas con rutas
      const child = spawn('explorer', [folderPath], { 
        detached: true,
        stdio: 'ignore'
      });
      child.unref();
      
      res.json({ 
        success: true, 
        message: 'Carpeta abierta exitosamente',
        path: folderPath
      });
      return;
    }
    
    // Para macOS y Linux
    let command;
    if (process.platform === 'darwin') {
      // macOS
      command = `open "${folderPath}"`;
    } else {
      // Linux
      command = `xdg-open "${folderPath}"`;
    }
    
    await execPromise(command);
    
    res.json({ 
      success: true, 
      message: 'Carpeta abierta exitosamente',
      path: folderPath
    });
    
  } catch (error) {
    console.error('❌ Error abriendo carpeta:', error);
    res.status(500).json({ 
      success: false, 
      error: `Error al abrir la carpeta: ${error.message}` 
    });
  }
});

// Ruta para refrescar una imagen específica
app.post('/api/refresh-image', async (req, res) => {
  console.log('🎯 ENDPOINT /api/refresh-image llamado con body:', req.body);
  try {
    const { folderName, imageIndex, sectionNum, keywords, currentImages } = req.body;
    
    console.log('📋 Parámetros recibidos:', { folderName, imageIndex, sectionNum, keywords: keywords.substring(0, 50) + '...' });
    
    if (!folderName || imageIndex === undefined || !sectionNum || !keywords) {
      console.log('❌ Faltan parámetros requeridos');
      return res.status(400).json({ error: 'Faltan parámetros requeridos' });
    }

    // Intentar extraer el folderName real desde las URLs de las imágenes actuales
    let actualFolderName = folderName;
    if (currentImages && currentImages.length > 0) {
      const firstImageUrl = currentImages[0].url;
      const urlMatch = firstImageUrl.match(/\/outputs\/([^\/]+)\//);
      if (urlMatch) {
        actualFolderName = urlMatch[1];
        console.log(`🔍 Folder name extraído de URL de imagen: "${actualFolderName}"`);
      }
    }
    
    // Usar la función estándar para normalización consistente
    const normalizedFolderName = createSafeFolderName(actualFolderName);
    console.log(`🔄 Carpeta normalizada: "${folderName}" → "${normalizedFolderName}"`);
    
    const imagesDir = path.join(globalOutputDir, normalizedFolderName, `seccion_${sectionNum}`);
    console.log('📁 Directorio de imágenes:', imagesDir);
    
    if (!fs.existsSync(imagesDir)) {
      console.log('❌ Carpeta no encontrada:', imagesDir);
      return res.status(404).json({ error: 'Carpeta no encontrada' });
    }

    console.log(`🔄 Refrescando imagen en posición visual ${imageIndex} con keywords: ${keywords}`);
    
    // Si tenemos el array de imágenes actuales del frontend, usarlo
    let targetFilename = null;
    
    if (currentImages && currentImages[imageIndex]) {
      // Extraer el nombre del archivo de la URL
      const imageUrl = currentImages[imageIndex].url || currentImages[imageIndex];
      targetFilename = imageUrl.split('/').pop().split('?')[0]; // Remover query params
      console.log(`🎯 Usando mapeo directo del frontend: posición ${imageIndex} → ${targetFilename}`);
    } else {
      // Fallback: usar orden alfabético (comportamiento anterior)
      const files = fs.readdirSync(imagesDir);
      const imageFiles = files.filter(file => 
        /\.(jpg|jpeg|png|gif|webp)$/i.test(file)
      ).sort();
      
      if (imageIndex >= imageFiles.length) {
        return res.status(400).json({ error: 'Índice de imagen inválido' });
      }
      
      targetFilename = imageFiles[imageIndex];
      console.log(`⚠️ Usando fallback alfabético: posición ${imageIndex} → ${targetFilename}`);
    }

    // Verificar que el archivo existe
    const currentImagePath = path.join(imagesDir, targetFilename);
    if (!fs.existsSync(currentImagePath)) {
      return res.status(404).json({ error: `Archivo no encontrado: ${targetFilename}` });
    }

    // Buscar y descargar una nueva imagen con las mismas keywords
    console.log(`🔄 Buscando nueva imagen con keywords: ${keywords}`);
    
    // Convertir keywords a string si es un array, o usarlo directamente si es string
    const searchQuery = Array.isArray(keywords) ? keywords.join(' ') : keywords;
    const imageUrls = await searchBingImages(searchQuery, 60); // Buscar 60 imágenes para máxima variación
    
    if (imageUrls && imageUrls.length > 0) {
      // Obtener URLs de imágenes existentes para evitar duplicados
      const existingFiles = fs.readdirSync(imagesDir);
      const existingImageUrls = new Set();
      
      // Leer metadata si existe para obtener URLs originales
      const metadataPath = path.join(imagesDir, 'images_metadata.json');
      if (fs.existsSync(metadataPath)) {
        try {
          const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
          Object.values(metadata).forEach(img => {
            if (img.originalUrl) existingImageUrls.add(img.originalUrl);
          });
        } catch (error) {
          console.log('⚠️ Error leyendo metadata, continuando sin filtro de duplicados');
        }
      }
      
      // Filtrar URLs que ya tenemos
      const filteredUrls = imageUrls.filter(url => !existingImageUrls.has(url));
      const urlsToUse = filteredUrls.length > 0 ? filteredUrls : imageUrls;
      
      // Seleccionar una imagen aleatoria para obtener variación
      const randomIndex = Math.floor(Math.random() * urlsToUse.length);
      const imageUrl = urlsToUse[randomIndex];
      console.log(`🎲 Seleccionando imagen ${randomIndex + 1} de ${urlsToUse.length} encontradas (${filteredUrls.length > 0 ? 'sin duplicados' : 'total'})`);
      
      // Mantener el mismo nombre base pero con timestamp para evitar cache
      const timestamp = Date.now();
      const extension = imageUrl.split('.').pop()?.split('?')[0] || 'jpg';
      
      // Crear nombre que mantenga la posición visual
      let newImageName;
      
      // Mejorar extracción de extensión para evitar extensiones corruptas
      let validExtension = 'jpg'; // Default seguro
      try {
        const urlParts = imageUrl.split('.');
        if (urlParts.length > 1) {
          const lastPart = urlParts[urlParts.length - 1];
          const cleanExtension = lastPart.split('?')[0].split('/')[0].split('#')[0].toLowerCase();
          // Validar que la extensión sea válida y no muy larga
          if (/^(jpg|jpeg|png|gif|webp)$/i.test(cleanExtension) && cleanExtension.length <= 5) {
            validExtension = cleanExtension;
          }
        }
      } catch (error) {
        console.log(`⚠️ Error extrayendo extensión de URL, usando jpg por defecto: ${error.message}`);
      }
      
      if (targetFilename.startsWith('bing_image_')) {
        // Mantener el formato bing_image_X para compatibilidad
        const imageNumber = targetFilename.match(/bing_image_(\d+)/)?.[1] || (imageIndex + 1);
        newImageName = `bing_image_${imageNumber}.jpg`;
      } else {
        // Para archivos con otros formatos, usar formato consistente
        newImageName = `image_${imageIndex}_${timestamp}.${validExtension}`;
      }
      
      const newImagePath = path.join(imagesDir, newImageName);
      
      // Descargar la nueva imagen con reintentos
      let downloadSuccess = false;
      let attemptCount = 0;
      const maxAttempts = Math.min(5, urlsToUse.length); // Máximo 5 intentos
      
      // Crear ruta temporal para la nueva imagen
      const tempImagePath = newImagePath.replace('.jpg', '_temp.jpg');
      
      while (!downloadSuccess && attemptCount < maxAttempts) {
        try {
          const attemptIndex = (randomIndex + attemptCount) % urlsToUse.length;
          const attemptUrl = urlsToUse[attemptIndex];
          console.log(`📥 Intento ${attemptCount + 1}/${maxAttempts} descargando desde: ${attemptUrl.substring(0, 80)}...`);
          
          // Descargar en archivo temporal primero
          await downloadImageFromUrl(attemptUrl, tempImagePath);
          downloadSuccess = true;
          console.log(`✅ Descarga exitosa en intento ${attemptCount + 1}`);
        } catch (error) {
          attemptCount++;
          console.log(`❌ Fallo en intento ${attemptCount}: ${error.message}`);
          if (attemptCount < maxAttempts) {
            console.log(`🔄 Reintentando con otra URL...`);
          }
        }
      }
      
      if (!downloadSuccess) {
        // Limpiar archivo temporal si falló la descarga
        if (fs.existsSync(tempImagePath)) {
          fs.unlinkSync(tempImagePath);
          console.log(`🗑️ Archivo temporal borrado tras fallo: ${tempImagePath}`);
        }
        console.log(`❌ No se pudo descargar ninguna imagen después de ${maxAttempts} intentos`);
        return res.status(500).json({ error: 'No se pudo descargar una nueva imagen después de varios intentos' });
      }

      // Solo borrar la imagen anterior DESPUÉS de confirmar que la nueva se descargó exitosamente
      if (fs.existsSync(currentImagePath)) {
        fs.unlinkSync(currentImagePath);
        console.log(`🗑️ Imagen anterior borrada: ${currentImagePath}`);
      }
      
      // Mover imagen temporal a ubicación final
      fs.renameSync(tempImagePath, newImagePath);
      console.log(`📁 Imagen temporal movida a ubicación final: ${newImagePath}`);
      
      // Actualizar metadata para rastrear URL original
      const metadataFilePath = path.join(imagesDir, 'images_metadata.json');
      let metadata = {};
      
      if (fs.existsSync(metadataFilePath)) {
        try {
          metadata = JSON.parse(fs.readFileSync(metadataFilePath, 'utf8'));
        } catch (error) {
          console.log('⚠️ Error leyendo metadata existente, creando nuevo');
        }
      }
      
      metadata[newImageName] = {
        originalUrl: imageUrl,
        keywords: searchQuery,
        timestamp: timestamp,
        refreshed: true
      };
      
      try {
        fs.writeFileSync(metadataFilePath, JSON.stringify(metadata, null, 2));
        console.log(`📝 Metadata actualizada para ${newImageName}`);
      } catch (error) {
        console.log('⚠️ Error guardando metadata:', error.message);
      }
      
      console.log(`✅ Nueva imagen descargada: ${newImagePath}`);
      console.log(`🎯 Mapeo mantenido: posición visual ${imageIndex} → ${newImageName}`);
      
      // Devolver la información de la nueva imagen
      res.json({ 
        success: true,
        message: `Imagen ${imageIndex + 1} refrescada exitosamente`,
        newImageUrl: `/outputs/${normalizedFolderName}/seccion_${sectionNum}/${newImageName}`,
        filename: newImageName,
        imageIndex: imageIndex
      });
    } else {
      res.status(404).json({ error: 'No se pudo encontrar una nueva imagen' });
    }

  } catch (error) {
    console.error('❌ Error al refrescar imagen:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ================================
// ENDPOINTS PARA GENERACIÓN DE VIDEO
// ================================

// Almacén de progreso en memoria para cada sesión de video
const videoProgressStore = new Map();

// Función helper para actualizar progreso de video
function updateVideoProgress(sessionId, percent, message) {
  videoProgressStore.set(sessionId, { percent, message, timestamp: Date.now() });
  console.log(`[VIDEO-${sessionId}] ${Math.round(percent)}% - ${message}`);
}

// Endpoint para progreso de video en tiempo real usando Server-Sent Events
app.get('/video-progress/:sessionId', (req, res) => {
  const sessionId = req.params.sessionId;
  
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control'
  });

  // Función para enviar progreso
  const sendProgress = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Enviar progreso inicial
  const initialProgress = videoProgressStore.get(sessionId) || { percent: 0, message: 'Iniciando generación de video...' };
  sendProgress(initialProgress);

  // Verificar progreso cada segundo
  const progressInterval = setInterval(() => {
    const progress = videoProgressStore.get(sessionId);
    if (progress) {
      sendProgress(progress);
      
      // Si está completo, limpiar después de un tiempo
      if (progress.percent >= 100) {
        setTimeout(() => {
          videoProgressStore.delete(sessionId);
          clearInterval(progressInterval);
        }, 30000); // Limpiar después de 30 segundos
      }
    }
  }, 1000);

  // Limpiar al cerrar conexión
  req.on('close', () => {
    clearInterval(progressInterval);
  });
});

// Endpoint para generar video desde el proyecto
app.post('/generate-project-video', async (req, res) => {
  const sessionId = Date.now().toString(); // ID único para esta sesión
  
  try {
    updateVideoProgress(sessionId, 0, 'Iniciando procesamiento de video...');
    
    const { 
      folderName, 
      duration = 3, 
      animationType = 'zoom-out', 
      quality = 'standard' 
    } = req.body;
    
    // Enviar sessionId al cliente para que pueda conectarse al progreso
    res.setHeader('X-Video-Session-ID', sessionId);
    
    if (!folderName) {
      if (progressSessionId) {
        finalizeClipProgressSession(progressSessionId, 'failed', { error: 'Nombre de carpeta requerido' });
      }
      return res.status(400).json({ error: 'Nombre de carpeta requerido' });
    }

    console.log(`🎬 Iniciando generación de video para proyecto: ${folderName}`);
    console.log(`🎬 Configuración: duración=${duration}s, animación=${animationType}, calidad=${quality}`);

    updateVideoProgress(sessionId, 5, 'Analizando estructura del proyecto...');
    
    // Normalizar nombre de la carpeta
    const normalizedFolderName = createSafeFolderName(folderName);
    const projectPath = path.join(globalOutputDir, normalizedFolderName);
    
    if (!fs.existsSync(projectPath)) {
      return res.status(404).json({ error: 'Proyecto no encontrado' });
    }

    // Organizar archivos por secciones
    updateVideoProgress(sessionId, 10, 'Organizando archivos por secciones...');
    const secciones = await organizarArchivosPorSecciones(projectPath);
    
    if (secciones.length === 0) {
      return res.status(404).json({ error: 'No se encontraron secciones con imágenes' });
    }

    console.log(`🎬 Encontradas ${secciones.length} secciones para procesar`);
    updateVideoProgress(sessionId, 15, `Encontradas ${secciones.length} secciones para procesar`);
    
    // Generar video
    const outputPath = await procesarVideoCompleto(secciones, normalizedFolderName, duration, animationType, quality, sessionId);
    
    // Verificar que el archivo existe antes de enviarlo
    if (!fs.existsSync(outputPath)) {
      throw new Error('El archivo de video no se generó correctamente');
    }
    
    console.log('🎬 Enviando video al cliente');
    updateVideoProgress(sessionId, 100, '¡Video completado y listo para descarga!');
    
    const filename = `${normalizedFolderName}_video_completo.mp4`;
    
    res.download(outputPath, filename, (err) => {
      if (err) {
        console.error('❌ Error enviando video:', err);
      } else {
        console.log('✅ Video enviado exitosamente');
        
        // Limpiar archivo temporal después de un tiempo
        setTimeout(() => {
          try {
            if (fs.existsSync(outputPath)) {
              fs.unlinkSync(outputPath);
              console.log('🗑️ Archivo temporal de video limpiado');
            }
          } catch (e) {
            console.log('⚠️ No se pudo limpiar archivo temporal:', e.message);
          }
        }, 60000); // Limpiar después de 1 minuto
      }
    });

  } catch (error) {
    console.error('❌ Error al procesar video:', error);
    updateVideoProgress(sessionId, 0, `Error: ${error.message}`);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Endpoint para generar video simple (sin animaciones)
app.post('/generate-simple-video', async (req, res) => {
  try {
    const { folderName } = req.body;
    
    if (!folderName) {
      return res.status(400).json({ error: 'Nombre de carpeta requerido' });
    }

    console.log(`🎬 Iniciando generación de video simple para proyecto: ${folderName}`);
    console.log(`🎬 Configuración: duración automática basada en audio (sin animaciones)`);
    
    // Normalizar nombre de la carpeta
    const normalizedFolderName = createSafeFolderName(folderName);
    const projectPath = path.join(globalOutputDir, normalizedFolderName);
    
    if (!fs.existsSync(projectPath)) {
      return res.status(404).json({ error: 'Proyecto no encontrado' });
    }

    // Organizar archivos por secciones
    const secciones = await organizarArchivosPorSecciones(projectPath);
    
    if (secciones.length === 0) {
      return res.status(404).json({ error: 'No se encontraron secciones con imágenes' });
    }

    console.log(`🎬 Encontradas ${secciones.length} secciones para procesar (modo simple)`);
    
    // Generar video simple (sin animaciones) - sin parámetro duration
    const outputPath = await procesarVideoSimple(secciones, normalizedFolderName);
    
    // Verificar que el archivo existe antes de enviarlo
    if (!fs.existsSync(outputPath)) {
      throw new Error('El archivo de video no se generó correctamente');
    }
    
    console.log('🎬 Enviando video simple al cliente');
    
    const filename = `${normalizedFolderName}_video_simple.mp4`;
    
    res.download(outputPath, filename, (err) => {
      if (err) {
        console.error('❌ Error enviando video simple:', err);
      } else {
        console.log('✅ Video simple enviado exitosamente');
        
        // Limpiar archivo temporal después de un tiempo
        setTimeout(() => {
          try {
            if (fs.existsSync(outputPath)) {
              fs.unlinkSync(outputPath);
              console.log('🗑️ Archivo temporal de video simple limpiado');
            }
          } catch (e) {
            console.log('⚠️ No se pudo limpiar archivo temporal:', e.message);
          }
        }, 60000); // Limpiar después de 1 minuto
      }
    });

  } catch (error) {
    console.error('❌ Error al procesar video simple:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Endpoint para generar clips separados por sección
app.post('/generate-separate-videos', async (req, res) => {
  try {
    const { folderName, sectionNumber, sectionNumbers, targetSections, progressSessionId } = req.body;
    
    if (!folderName) {
      return res.status(400).json({ error: 'Nombre de carpeta requerido' });
    }

    console.log(`🎬 Iniciando generación de clips separados para proyecto: ${folderName}`);

    const requestedSectionsRaw = [];

    if (typeof sectionNumber !== 'undefined' && sectionNumber !== null) {
      requestedSectionsRaw.push(sectionNumber);
    }

    if (Array.isArray(sectionNumbers)) {
      requestedSectionsRaw.push(...sectionNumbers);
    }

    if (Array.isArray(targetSections)) {
      requestedSectionsRaw.push(...targetSections);
    }

    const requestedSections = Array.from(new Set(
      requestedSectionsRaw
        .map((value) => parseInt(value, 10))
        .filter((value) => Number.isInteger(value) && value > 0)
    )).sort((a, b) => a - b);

    if (requestedSections.length) {
      console.log(`🎯 Secciones solicitadas: ${requestedSections.join(', ')}`);
    }
    
    // Intentar primero con el nombre normalizado
    const normalizedFolderName = createSafeFolderName(folderName);
    let projectPath = path.join(globalOutputDir, normalizedFolderName);
    
    if (!fs.existsSync(projectPath)) {
      console.log(`❌ Proyecto no encontrado con nombre normalizado: ${normalizedFolderName}`);
      console.log(`🔍 Intentando con nombre original: ${folderName}`);
      
      // Intentar con el nombre original
      projectPath = path.join(globalOutputDir, folderName);
      
      if (!fs.existsSync(projectPath)) {
        console.log(`❌ Proyecto no encontrado: ${folderName}`);
        if (progressSessionId) {
          finalizeClipProgressSession(progressSessionId, 'failed', { error: 'Proyecto no encontrado' });
        }
        return res.status(404).json({ error: 'Proyecto no encontrado' });
      }
    }

    console.log(`✅ Proyecto encontrado en: ${projectPath}`);

    // Organizar archivos por secciones
    let secciones = await organizarArchivosPorSecciones(projectPath);
    
    if (secciones.length === 0) {
      if (progressSessionId) {
        finalizeClipProgressSession(progressSessionId, 'failed', { error: 'No se encontraron secciones con imágenes' });
      }
      return res.status(404).json({ error: 'No se encontraron secciones con imágenes' });
    }

    console.log(`🎬 Encontradas ${secciones.length} secciones para procesar clips separados`);

    if (requestedSections.length) {
      const setRequested = new Set(requestedSections);
      const filteredSections = secciones.filter((seccion) => setRequested.has(seccion.numero));
      console.log(`🎯 Filtrando secciones solicitadas. Coincidencias encontradas: ${filteredSections.length}`);

      if (!filteredSections.length) {
        if (progressSessionId) {
          finalizeClipProgressSession(progressSessionId, 'failed', { error: 'No se encontraron secciones coincidentes para la generación solicitada' });
        }
        return res.status(404).json({ error: 'No se encontraron secciones coincidentes para la generación solicitada' });
      }

      secciones = filteredSections;
    }
    
    // Usar el nombre de carpeta que realmente funcionó
    const actualFolderName = fs.existsSync(path.join(globalOutputDir, normalizedFolderName)) 
      ? normalizedFolderName 
      : folderName;

    if (progressSessionId) {
      initializeClipProgressSession(progressSessionId, secciones);
    }
    
    // Generar clips separados (sin concatenar)
    const { generatedVideos, skippedVideos } = await procesarClipsSeparados(secciones, actualFolderName, {
      progressSessionId
    });

    const totalGenerados = generatedVideos.length;
    const totalOmitidos = skippedVideos.length;

    console.log('✅ Clips separados procesados', {
      generados: totalGenerados,
      omitidos: totalOmitidos,
      secciones: requestedSections.length ? requestedSections : 'todas'
    });

    let responseMessage;
    if (totalGenerados === 0 && totalOmitidos > 0) {
      responseMessage = 'Todos los clips solicitados ya estaban generados. No se crearon archivos nuevos.';
    } else if (totalGenerados > 0 && totalOmitidos > 0) {
      responseMessage = `Se generaron ${totalGenerados} clip(s) nuevo(s). ${totalOmitidos} ya existían y se omitieron.`;
    } else {
      responseMessage = requestedSections.length
        ? `Clips generados para ${requestedSections.length === 1 ? 'la sección' : 'las secciones'} ${requestedSections.join(', ')}`
        : 'Clips separados generados exitosamente';
    }

    if (progressSessionId) {
      finalizeClipProgressSession(progressSessionId, 'completed', {
        generatedVideos: generatedVideos,
        skippedVideos,
        message: responseMessage
      });
    }

    res.json({ 
      success: true,
      message: responseMessage,
      videosGenerated: totalGenerados,
      videosSkipped: totalOmitidos,
      videos: generatedVideos,
      skippedVideos,
      requestedSections: requestedSections.length ? requestedSections : undefined,
      progressSessionId: progressSessionId || null
    });

  } catch (error) {
    console.error('❌ Error al procesar clips separados:', error);
    if (req.body?.progressSessionId) {
      finalizeClipProgressSession(req.body.progressSessionId, 'failed', { error: error.message });
    }
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.get('/clip-progress/:sessionId', (req, res) => {
  try {
    const { sessionId } = req.params;

    if (!sessionId) {
      return res.status(400).json({ success: false, error: 'ID de sesión requerido' });
    }

    const progress = getClipProgressSession(sessionId);

    if (!progress) {
      return res.json({ success: false, error: 'Sesión no encontrada' });
    }

    res.json({ success: true, progress });
  } catch (error) {
    console.error('❌ Error obteniendo progreso de clips:', error);
    res.status(500).json({ success: false, error: 'Error obteniendo progreso de clips: ' + error.message });
  }
});

app.get('/api/section-media-summary/:folderName', async (req, res) => {
  try {
    const { folderName } = req.params;

    if (!folderName) {
      return res.status(400).json({ success: false, error: 'Nombre de proyecto requerido' });
    }

    const normalizedFolderName = createSafeFolderName(folderName);
    let projectPath = path.join(globalOutputDir, normalizedFolderName);
    let resolvedFolderName = normalizedFolderName;

    if (!fs.existsSync(projectPath)) {
      projectPath = path.join(globalOutputDir, folderName);
      resolvedFolderName = folderName;

      if (!fs.existsSync(projectPath)) {
        return res.status(404).json({ success: false, error: 'Proyecto no encontrado' });
      }
    }

    const secciones = await organizarArchivosPorSecciones(projectPath);

    const summary = secciones.map((seccion) => ({
      sectionNumber: seccion.numero,
      name: seccion.nombre,
      totalImages: Array.isArray(seccion.imagenes) ? seccion.imagenes.length : 0,
      totalAudios: Array.isArray(seccion.audios) ? seccion.audios.length : 0
    }));

    res.json({
      success: true,
      data: {
        folderName: resolvedFolderName,
        normalizedFolderName,
        sections: summary
      }
    });
  } catch (error) {
    console.error('❌ Error obteniendo resumen de secciones:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// Función para organizar archivos por secciones desde el proyecto
async function organizarArchivosPorSecciones(projectPath) {
  const secciones = [];
  
  try {
    console.log(`🔍 Explorando directorio del proyecto: ${projectPath}`);
    const items = fs.readdirSync(projectPath);
    console.log(`📁 Elementos encontrados en ${projectPath}:`, items);
    
    // Buscar carpetas de secciones
    for (const item of items) {
      const itemPath = path.join(projectPath, item);
      const stats = fs.statSync(itemPath);
      
      console.log(`🔍 Revisando elemento: ${item} (${stats.isDirectory() ? 'directorio' : 'archivo'})`);
      
      if (stats.isDirectory() && item.startsWith('seccion_')) {
        console.log(`🎯 Carpeta de sección encontrada: ${item}`);
        const numeroSeccion = parseInt(item.replace('seccion_', ''));
        const imagenes = [];
        const audios = [];
        
        // Buscar archivos en la carpeta de sección
        const sectionFiles = fs.readdirSync(itemPath);
        console.log(`📂 Archivos en ${item}:`, sectionFiles);
        
        for (const file of sectionFiles) {
          const filePath = path.join(itemPath, file);
          const fileStats = fs.statSync(filePath);
          
          if (fileStats.isFile()) {
            const ext = path.extname(file).toLowerCase();
            console.log(`📄 Archivo: ${file} - Extensión: ${ext}`);
            
            if (['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'].includes(ext)) {
              imagenes.push({
                path: filePath,
                name: file,
                mtime: fileStats.mtime
              });
              console.log(`🖼️ Imagen agregada: ${file}`);
            } else if (['.mp3', '.wav', '.m4a', '.aac', '.ogg'].includes(ext)) {
              audios.push({
                path: filePath,
                name: file
              });
              console.log(`🎵 Audio agregado: ${file}`);
            } else {
              console.log(`⚠️ Archivo ignorado (extensión no reconocida): ${file}`);
            }
          }
        }
        
        if (imagenes.length > 0) {
          console.log(`🔍 DEBUG: Ordenando ${imagenes.length} imágenes en sección ${numeroSeccion}`);
          console.log(`🔍 DEBUG: Antes de ordenar:`, imagenes.map(img => img.name));
          
          // Ordenar imágenes por nombre para mantener orden consistente
          imagenes.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
          
          console.log(`🔍 DEBUG: Después de ordenar:`, imagenes.map(img => img.name));
          
          console.log(`📁 Sección ${numeroSeccion} encontrada: ${imagenes.length} imágenes, ${audios.length} audios`);
          console.log(`🖼️ Imágenes en sección ${numeroSeccion}:`, imagenes.map(img => img.name));
          console.log(`🎵 Audios en sección ${numeroSeccion}:`, audios.map(aud => aud.name));
          
          secciones.push({
            numero: numeroSeccion,
            nombre: `Sección ${numeroSeccion}`,
            imagenes: imagenes,
            audios: audios,
            path: itemPath
          });
        } else {
          console.log(`⚠️ Sección ${numeroSeccion} no tiene imágenes válidas`);
        }
      } else if (stats.isDirectory()) {
        console.log(`📁 Directorio ignorado (no es sección): ${item}`);
      }
    }
    
    // Ordenar secciones por número
    secciones.sort((a, b) => a.numero - b.numero);
    
    console.log(`🎬 Secciones encontradas: ${secciones.length}`);
    secciones.forEach(seccion => {
      console.log(`  - ${seccion.nombre}: ${seccion.imagenes.length} imágenes, ${seccion.audios.length} audios`);
    });
    
    console.log(`📊 Total: ${secciones.length} secciones, ${secciones.reduce((total, s) => total + s.imagenes.length, 0)} imágenes totales`);
    
    return secciones;
    
  } catch (error) {
    console.error('❌ Error organizando archivos:', error);
    return [];
  }
}

// Función principal para procesar video completo
async function procesarVideoCompleto(secciones, projectName, duration, animationType, quality, sessionId) {
  const outputDir = path.join(process.cwd(), 'temp');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  const finalOutputPath = path.join(outputDir, `${projectName}_video_${Date.now()}.mp4`);
  const videosSeccionesTemp = [];
  
  try {
    // Procesar cada sección individualmente
    for (let i = 0; i < secciones.length; i++) {
      const seccion = secciones[i];
      const progresoBase = 20 + (i * 60 / secciones.length);
      
      updateVideoProgress(sessionId, progresoBase, `Procesando ${seccion.nombre}...`);
      
      const videoSeccionPath = await procesarSeccionVideo(seccion, duration, animationType, quality, sessionId, progresoBase, secciones.length);
      
      if (videoSeccionPath && fs.existsSync(videoSeccionPath)) {
        videosSeccionesTemp.push(videoSeccionPath);
        console.log(`✅ ${seccion.nombre} procesada: ${videoSeccionPath}`);
      }
    }
    
    if (videosSeccionesTemp.length === 0) {
      throw new Error('No se pudieron procesar las secciones');
    }
    
    // Combinar todas las secciones
    updateVideoProgress(sessionId, 85, 'Combinando todas las secciones...');
    await combinarSeccionesVideo(videosSeccionesTemp, finalOutputPath, sessionId);
    
    // Limpiar videos temporales de secciones
    videosSeccionesTemp.forEach(video => {
      try {
        if (fs.existsSync(video)) {
          fs.unlinkSync(video);
        }
      } catch (e) {
        console.log('⚠️ No se pudo limpiar video temporal:', e.message);
      }
    });
    
    return finalOutputPath;
    
  } catch (error) {
    // Limpiar videos temporales en caso de error
    videosSeccionesTemp.forEach(video => {
      try {
        if (fs.existsSync(video)) {
          fs.unlinkSync(video);
        }
      } catch (e) {
        console.log('⚠️ No se pudo limpiar video temporal:', e.message);
      }
    });
    throw error;
  }
}

// Función para procesar una sección individual
async function procesarSeccionVideo(seccion, duration, animationType, quality, sessionId, progresoBase, totalSecciones) {
  try {
    const outputPath = path.join(process.cwd(), 'temp', `seccion_${seccion.numero}_${Date.now()}.mp4`);
    
    // Validar que la sección tiene imágenes
    if (!seccion.imagenes || seccion.imagenes.length === 0) {
      throw new Error(`${seccion.nombre} no tiene imágenes para procesar`);
    }
    
    // Buscar archivo de audio para esta sección
    let audioPath = null;
    let finalDuration = duration; // Duración por defecto
    
    if (seccion.audios && seccion.audios.length > 0) {
      // Usar el primer archivo de audio encontrado
      audioPath = seccion.audios[0].path;
      if (fs.existsSync(audioPath)) {
        console.log(`🎵 Audio encontrado para ${seccion.nombre}: ${audioPath}`);
        
        // Obtener duración del audio usando ffprobe
        try {
          const audioDuration = await getAudioDuration(audioPath);
          if (audioDuration > 0) {
            // Calcular duración por imagen basándose en el audio
            finalDuration = audioDuration / seccion.imagenes.length;
            console.log(`� Duración del audio: ${audioDuration} segundos`);
            console.log(`📐 Duración calculada por imagen: ${finalDuration.toFixed(2)} segundos`);
          } else {
            console.warn(`⚠️ No se pudo obtener duración válida del audio, usando duración fija: ${duration}s`);
          }
        } catch (error) {
          console.warn(`⚠️ Error obteniendo duración del audio: ${error.message}, usando duración fija: ${duration}s`);
        }
      } else {
        console.warn(`⚠️ Archivo de audio no existe: ${audioPath}`);
        audioPath = null;
      }
    } else {
      console.log(`📢 No se encontró audio para ${seccion.nombre}`);
    }
    
    // Validar que todas las imágenes existen y obtener sus rutas absolutas
    const imagenesValidadas = [];
    for (const imagen of seccion.imagenes) {
      let imagePath = imagen.path;
      
      // Si la ruta no es absoluta, convertirla
      if (!path.isAbsolute(imagePath)) {
        imagePath = path.resolve(imagePath);
      }
      
      if (!fs.existsSync(imagePath)) {
        console.error(`❌ Imagen no encontrada: ${imagePath}`);
        throw new Error(`Imagen no encontrada: ${imagePath}`);
      }
      
      // Verificar que es un archivo de imagen válido
      const ext = path.extname(imagePath).toLowerCase();
      if (!['.jpg', '.jpeg', '.png', '.bmp', '.gif', '.webp'].includes(ext)) {
        console.error(`❌ Formato de imagen no soportado: ${ext}`);
        throw new Error(`Formato de imagen no soportado: ${ext}`);
      }
      
      imagenesValidadas.push(imagePath);
      console.log(`✅ Imagen validada: ${imagePath}`);
    }
    
    console.log(`🎬 Procesando ${seccion.nombre} con ${imagenesValidadas.length} imágenes validadas${audioPath ? ' y audio' : ''}`);
    console.log(`⏱️ Duración por imagen: ${finalDuration.toFixed(2)} segundos`);
    
    // Procesar cada imagen con transiciones usando Canvas
    const transitionTypes = ['zoom-in', 'zoom-out', 'pan-right', 'pan-left', 'fade-in', 'slide-in-left', 'slide-in-right', 'rotate-zoom'];
    const framesPorSegundo = 30;
    
    if (imagenesValidadas.length === 1) {
      // Una sola imagen - generar directamente al archivo final
      const imagePath = imagenesValidadas[0];
      const transitionType = 'zoom-out'; // Usar zoom-out para imagen única
      
      console.log(`🎬 Procesando imagen única con transición ${transitionType}`);
      
      // Generar video con transición
      await generateImageVideoWithTransitions(imagePath, outputPath, finalDuration, transitionType, framesPorSegundo);
      
      // Agregar audio si existe
      if (audioPath) {
        const tempVideo = path.join(path.dirname(outputPath), `temp_${path.basename(outputPath)}`);
        fs.renameSync(outputPath, tempVideo);
        
        const ffmpegArgs = ['-i', tempVideo, '-i', audioPath, '-c:v', 'copy', '-c:a', 'aac', '-shortest', outputPath];
        
        await new Promise((resolve, reject) => {
          const ffmpeg = spawn('ffmpeg', ffmpegArgs, { stdio: 'pipe' });
          ffmpeg.on('close', (code) => {
            if (code === 0) {
              // Limpiar archivo temporal
              if (fs.existsSync(tempVideo)) fs.unlinkSync(tempVideo);
              resolve();
            } else {
              reject(new Error(`FFmpeg falló con código ${code}`));
            }
          });
        });
      }
    } else {
      // Múltiples imágenes - generar videos temporales y concatenar
      const tempVideos = [];
      
      for (let i = 0; i < imagenesValidadas.length; i++) {
        const imagePath = imagenesValidadas[i];
        const transitionType = 'zoom-out'; // Usar siempre zoom-out
        const tempVideoPath = path.join(path.dirname(outputPath), `temp_${i}_${Date.now()}.mp4`);
        
        console.log(`🎬 Procesando imagen ${i + 1}/${imagenesValidadas.length} con transición ${transitionType}`);
        
        // Generar video con transición para esta imagen
        await generateImageVideoWithTransitions(imagePath, tempVideoPath, finalDuration, transitionType, framesPorSegundo);
        tempVideos.push(tempVideoPath);
      }
      
      // Concatenar videos con transiciones de desvanecimiento
      await concatenateVideosWithCrossfade(tempVideos, audioPath, outputPath);
      
      // Limpiar archivos temporales
      tempVideos.forEach(video => {
        if (fs.existsSync(video)) fs.unlinkSync(video);
      });
    }
    
    console.log(`✅ Video de sección ${seccion.nombre} generado con transiciones: ${outputPath}`);
    return outputPath; // Devolver la ruta del video generado
        
  } catch (error) {
    console.error(`❌ Error en procesarSeccionVideo:`, error);
    throw error;
  }
}

// Función auxiliar para obtener la duración del audio
function getAudioDuration(audioPath) {
  return new Promise((resolve, reject) => {
    const ffprobeProcess = spawn('ffprobe', [
      '-v', 'quiet',
      '-show_entries', 'format=duration',
      '-of', 'csv=p=0',
      audioPath
    ]);
    
    let ffprobeOutput = '';
    
    ffprobeProcess.stdout.on('data', (data) => {
      ffprobeOutput += data.toString();
    });
    
    ffprobeProcess.on('close', (code) => {
      if (code === 0) {
        const duration = parseFloat(ffprobeOutput.trim());
        resolve(duration);
      } else {
        reject(new Error(`ffprobe falló con código ${code}`));
      }
    });
    
    ffprobeProcess.on('error', (err) => {
      reject(err);
    });
  });
}

// Función para formatear segundos a timestamp de YouTube (HH:MM:SS o MM:SS)
function formatSecondsToTimestamp(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  } else {
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }
}

// Función para combinar todas las secciones
async function combinarSeccionesVideo(videosSeccionesTemp, finalOutputPath, sessionId) {
  return new Promise((resolve, reject) => {
    updateVideoProgress(sessionId, 90, 'Concatenando todas las secciones...');
    
    const listFile = path.join(process.cwd(), 'temp', `concat_list_${Date.now()}.txt`);
    const listContent = videosSeccionesTemp.map(video => `file '${video}'`).join('\n');
    
    fs.writeFileSync(listFile, listContent);
    
    const args = [
      '-f', 'concat',
      '-safe', '0',
      '-i', listFile,
      '-c', 'copy',
      '-y',
      finalOutputPath
    ];
    
    const ffmpegProcess = spawn('ffmpeg', args);
    
    let stderrData = '';
    
    ffmpegProcess.stderr.on('data', (data) => {
      stderrData += data.toString();
    });
    
    ffmpegProcess.on('close', (code) => {
      // Limpiar archivo de lista temporal
      try {
        if (fs.existsSync(listFile)) {
          fs.unlinkSync(listFile);
        }
      } catch (e) {
        console.log('⚠️ No se pudo limpiar archivo de lista:', e.message);
      }
      
      if (code === 0) {
        console.log('✅ Video final concatenado exitosamente');
        updateVideoProgress(sessionId, 95, 'Video final generado exitosamente');
        resolve(finalOutputPath);
      } else {
        console.error('❌ Error en concatenación FFmpeg:', stderrData);
        reject(new Error(`FFmpeg falló con código ${code}`));
      }
    });
    
    ffmpegProcess.on('error', (err) => {
      console.error('❌ Error ejecutando FFmpeg:', err);
      reject(err);
    });
  });
}

// Función para procesar video simple (sin animaciones)
async function procesarVideoSimple(secciones, projectName) {
  const outputDir = path.join(process.cwd(), 'temp');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  const finalOutputPath = path.join(outputDir, `${projectName}_video_simple_${Date.now()}.mp4`);
  const videosSeccionesTemp = [];
  
  try {
    console.log(`🎬 Procesando video simple con ${secciones.length} secciones`);
    
    // Procesar cada sección individualmente (sin parámetro duration)
    for (let i = 0; i < secciones.length; i++) {
      const seccion = secciones[i];
      
      console.log(`📹 Procesando sección ${i + 1}/${secciones.length}: ${seccion.nombre}`);
      
      const videoSeccionPath = await procesarSeccionVideoSimple(seccion);
      
      if (videoSeccionPath && fs.existsSync(videoSeccionPath)) {
        videosSeccionesTemp.push(videoSeccionPath);
        console.log(`✅ ${seccion.nombre} procesada (simple): ${videoSeccionPath}`);
      }
    }
    
    if (videosSeccionesTemp.length === 0) {
      throw new Error('No se pudieron procesar las secciones');
    }
    
    // Combinar todas las secciones
    console.log('🔗 Combinando todas las secciones (video simple)...');
    await combinarSeccionesVideoSimple(videosSeccionesTemp, finalOutputPath);
    
    // Limpiar videos temporales de secciones
    videosSeccionesTemp.forEach(video => {
      try {
        if (fs.existsSync(video)) {
          fs.unlinkSync(video);
          console.log(`🗑️ Video temporal limpiado: ${path.basename(video)}`);
        }
      } catch (e) {
        console.log('⚠️ No se pudo limpiar video temporal:', e.message);
      }
    });
    
    return finalOutputPath;
    
  } catch (error) {
    // Limpiar videos temporales en caso de error
    videosSeccionesTemp.forEach(video => {
      try {
        if (fs.existsSync(video)) {
          fs.unlinkSync(video);
        }
      } catch (e) {
        console.log('⚠️ No se pudo limpiar video temporal:', e.message);
      }
    });
    throw error;
  }
}

// Función para procesar una sección individual sin animaciones
async function procesarSeccionVideoSimple(seccion) {
  try {
    const outputPath = path.join(process.cwd(), 'temp', `seccion_simple_${seccion.numero}_${Date.now()}.mp4`);
    
    // Validar que la sección tiene imágenes
    if (!seccion.imagenes || seccion.imagenes.length === 0) {
      throw new Error(`${seccion.nombre} no tiene imágenes para procesar`);
    }
    
    // Buscar archivo de audio para esta sección
    let audioPath = null;
    let finalDuration = 3; // Duración por defecto si no hay audio (3 segundos por imagen)
    
    if (seccion.audios && seccion.audios.length > 0) {
      // Usar el primer archivo de audio encontrado
      audioPath = seccion.audios[0].path;
      if (fs.existsSync(audioPath)) {
        console.log(`🎵 Audio encontrado para ${seccion.nombre}: ${audioPath}`);
        
        // Obtener duración del audio usando ffprobe
        try {
          const audioDuration = await getAudioDuration(audioPath);
          if (audioDuration > 0) {
            // ✅ CORREGIDO: No dividir la duración, usar duración completa
            // Calcular duración por imagen para que el video dure lo mismo que el audio
            finalDuration = audioDuration / seccion.imagenes.length;
            console.log(`🎵 Duración del audio: ${audioDuration.toFixed(2)} segundos`);
            console.log(`📐 Duración calculada por imagen: ${finalDuration.toFixed(2)} segundos`);
            console.log(`📐 Duración total del video: ${(finalDuration * seccion.imagenes.length).toFixed(2)} segundos`);
          }
        } catch (error) {
          console.warn(`⚠️ No se pudo obtener duración del audio: ${error.message}`);
        }
      } else {
        console.warn(`⚠️ Archivo de audio no existe: ${audioPath}`);
        audioPath = null;
      }
    } else {
      console.log(`📢 No se encontró audio para ${seccion.nombre}, usando duración por defecto: ${finalDuration}s por imagen`);
    }
    
    // Validar que todas las imágenes existen
    const imagenesValidadas = [];
    console.log(`🔍 DEBUG: Procesando imágenes de ${seccion.nombre}:`);
    console.log(`🔍 DEBUG: seccion.imagenes array:`, seccion.imagenes.map(img => img.name));
    
    for (const imagen of seccion.imagenes) {
      let imagePath = imagen.path;
      
      console.log(`🔍 DEBUG: Procesando imagen: ${imagen.name} - Path: ${imagePath}`);
      
      // Si la ruta no es absoluta, convertirla
      if (!path.isAbsolute(imagePath)) {
        imagePath = path.resolve(imagePath);
      }
      
      if (!fs.existsSync(imagePath)) {
        console.error(`❌ Imagen no encontrada: ${imagePath}`);
        throw new Error(`Imagen no encontrada: ${imagePath}`);
      }
      
      // Verificar que es un archivo de imagen válido
      const ext = path.extname(imagePath).toLowerCase();
      if (!['.jpg', '.jpeg', '.png', '.bmp', '.gif', '.webp'].includes(ext)) {
        console.error(`❌ Formato de imagen no soportado: ${ext}`);
        throw new Error(`Formato de imagen no soportado: ${ext}`);
      }
      
      imagenesValidadas.push(imagePath);
      console.log(`✅ Imagen validada: ${path.basename(imagePath)} (${imagenesValidadas.length}/${seccion.imagenes.length})`);
    }
    
    console.log(`🔍 DEBUG: Orden final de imágenes para ${seccion.nombre}:`);
    imagenesValidadas.forEach((img, index) => {
      console.log(`  ${index + 1}. ${path.basename(img)}`);
    });
    
    console.log(`📹 Procesando ${seccion.nombre} con ${imagenesValidadas.length} imágenes validadas${audioPath ? ' y audio' : ''} (SIN ANIMACIONES)`);
    
    // Crear video simple usando solo imágenes estáticas
    await generarVideoSimpleConImagenesOptimizado(imagenesValidadas, audioPath, outputPath, finalDuration);
    
    console.log(`✅ Video simple de sección ${seccion.nombre} generado: ${outputPath}`);
    return outputPath;
        
  } catch (error) {
    console.error(`❌ Error en procesarSeccionVideoSimple:`, error);
    throw error;
  }
}

// Función para generar video simple con imágenes estáticas
async function generarVideoSimpleConImagenes(imagenes, audioPath, outputPath, duracionPorImagen) {
  return new Promise((resolve, reject) => {
    console.log(`📹 Generando video simple con ${imagenes.length} imágenes estáticas`);
    console.log(`⏱️ Duración por imagen: ${duracionPorImagen.toFixed(2)} segundos`);
    
    // ✅ NUEVO ENFOQUE: Crear lista de archivos para concat demuxer pero sin audio
    const listFile = path.join(path.dirname(outputPath), `imagelist_${Date.now()}.txt`);
    
    // Verificar que todas las imágenes existen
    console.log(`🔍 Verificando existencia de ${imagenes.length} imágenes:`);
    for (let i = 0; i < imagenes.length; i++) {
      const imagePath = imagenes[i];
      if (fs.existsSync(imagePath)) {
        console.log(`✅ Imagen ${i+1}: ${path.basename(imagePath)} - EXISTE`);
      } else {
        console.error(`❌ Imagen ${i+1}: ${path.basename(imagePath)} - NO EXISTE`);
        return reject(new Error(`Imagen no encontrada: ${imagePath}`));
      }
    }
    
    // Crear lista de concatenación con duraciones precisas
    const imageList = imagenes.map(imagePath => {
      return `file '${imagePath.replace(/\\/g, '/')}'
duration ${duracionPorImagen.toFixed(3)}`;
    }).join('\n');
    
    // Agregar la última imagen una vez más sin duración (requerimiento de concat demuxer)
    const finalImageList = imageList + `\nfile '${imagenes[imagenes.length - 1].replace(/\\/g, '/')}'`;
    
    fs.writeFileSync(listFile, finalImageList);
    console.log(`📝 Lista de imágenes creada: ${listFile}`);
    console.log(`� Contenido de la lista (${imagenes.length} imágenes):`);
    console.log(finalImageList);
    
    // Usar spawn directo como VideoCreator para máxima velocidad
    const args = [
      '-f', 'concat',
      '-safe', '0',
      '-i', listFile
    ];
    
    // Si hay audio, agregarlo
    if (audioPath) {
      args.push('-i', audioPath);
      console.log(`🎵 Audio agregado: ${path.basename(audioPath)}`);
    }
    
    // Configuración optimizada VideoCreator style
    args.push(
      '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black',
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '23',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart'
    );
    
    // Si hay audio, configurarlo
    if (audioPath) {
      args.push(
        '-c:a', 'aac',
        '-b:a', '128k',
        '-map', '0:v',  // Video del concat
        '-map', '1:a'   // Audio del segundo input
      );
    }
    
    args.push('-y', outputPath);
    
    console.log('📹 Comando FFmpeg (VideoCreator style):', `ffmpeg ${args.join(' ')}`);
    
    const ffmpegProcess = spawn('ffmpeg', args);
    
    let stderrData = '';
    
    ffmpegProcess.stderr.on('data', (data) => {
      stderrData += data.toString();
      
      // Extraer progreso del stderr
      const progressMatch = stderrData.match(/time=(\d{2}):(\d{2}):(\d{2})/);
      if (progressMatch) {
        const [, hours, minutes, seconds] = progressMatch;
        const currentTime = parseInt(hours) * 3600 + parseInt(minutes) * 60 + parseInt(seconds);
        const totalTime = duracionPorImagen * imagenes.length;
        const percent = Math.min((currentTime / totalTime) * 100, 100);
        
        if (percent > 0) {
          console.log(`⏳ Progreso video simple: ${Math.round(percent)}%`);
        }
      }
    });
    
    ffmpegProcess.on('close', (code) => {
      // Limpiar archivo de lista temporal
      try {
        if (fs.existsSync(listFile)) {
          fs.unlinkSync(listFile);
          console.log('🗑️ Archivo de lista temporal limpiado');
        }
      } catch (e) {
        console.log('⚠️ No se pudo limpiar archivo de lista:', e.message);
      }
      
      if (code === 0) {
        console.log('✅ Video simple generado exitosamente con método VideoCreator');
        
        // Verificar propiedades del video generado
        if (fs.existsSync(outputPath)) {
          const stats = fs.statSync(outputPath);
          console.log(`📊 Archivo generado: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
          
          // Verificar duración real
          exec(`ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${outputPath}"`, (error, stdout) => {
            if (!error && stdout.trim()) {
              const actualDuration = parseFloat(stdout.trim());
              console.log(`⏱️ Duración real del video: ${actualDuration.toFixed(2)} segundos`);
              console.log(`🎯 Duración esperada: ${(duracionPorImagen * imagenes.length).toFixed(2)} segundos`);
            }
          });
        }
        
        resolve(outputPath);
      } else {
        console.error('❌ Error en FFmpeg (VideoCreator method):', stderrData);
        reject(new Error(`FFmpeg exited with code ${code}: ${stderrData}`));
      }
    });
    
    ffmpegProcess.on('error', (err) => {
      console.error('❌ Error ejecutando FFmpeg:', err);
      
      // Limpiar archivo de lista temporal en caso de error
      try {
        if (fs.existsSync(listFile)) {
          fs.unlinkSync(listFile);
        }
      } catch (e) {
        console.log('⚠️ No se pudo limpiar archivo de lista:', e.message);
      }
      
      reject(err);
    });
  });
}

// Función optimizada para generar video simple con imágenes (método videos temporales)
async function generarVideoSimpleConImagenesOptimizado(imagenes, audioPath, outputPath, duracionPorImagen) {
  return new Promise(async (resolve, reject) => {
    console.log(`📹 Generando video simple con ${imagenes.length} imágenes estáticas (método videos temporales)`);
    console.log(`⏱️ Duración por imagen: ${duracionPorImagen.toFixed(2)} segundos`);
    
    // Verificar que todas las imágenes existen
    console.log(`🔍 Verificando existencia de ${imagenes.length} imágenes:`);
    for (let i = 0; i < imagenes.length; i++) {
      const imagePath = imagenes[i];
      if (fs.existsSync(imagePath)) {
        console.log(`✅ Imagen ${i+1}: ${path.basename(imagePath)} - EXISTE`);
      } else {
        console.error(`❌ Imagen ${i+1}: ${path.basename(imagePath)} - NO EXISTE`);
        return reject(new Error(`Imagen no encontrada: ${imagePath}`));
      }
    }
    
    const tempDir = path.join(process.cwd(), 'temp');
    const tempVideos = [];
    
    try {
      // Crear videos temporales de cada imagen
      console.log(`🎬 Creando ${imagenes.length} videos temporales...`);
      
      for (let i = 0; i < imagenes.length; i++) {
        const imagePath = imagenes[i];
        const tempVideoPath = path.join(tempDir, `temp_vid_${i}_${Date.now()}.mp4`);
        
        console.log(`📸 Procesando imagen ${i + 1}/${imagenes.length}: ${path.basename(imagePath)}`);
        
        await new Promise((resolveVid, rejectVid) => {
          ffmpeg()
            .input(imagePath)
            .inputOptions([
              '-loop', '1',
              '-t', duracionPorImagen.toString()
            ])
            .outputOptions([
              '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black',
              '-c:v', 'libx264',
              '-profile:v', 'main',
              '-level', '3.1',
              '-crf', '23',
              '-preset', 'fast',
              '-pix_fmt', 'yuv420p',
              '-r', '30'
            ])
            .output(tempVideoPath)
            .on('end', () => {
              console.log(`✅ Video temporal ${i + 1} creado`);
              tempVideos.push(tempVideoPath);
              resolveVid();
            })
            .on('error', (err) => {
              console.error(`❌ Error creando video temporal ${i + 1}:`, err);
              rejectVid(err);
            })
            .run();
        });
      }
      
      // Crear lista para concat demuxer
      const listFile = path.join(tempDir, `concat_list_${Date.now()}.txt`);
      const listContent = tempVideos.map(video => `file '${video.replace(/\\/g, '/')}'`).join('\n');
      
      fs.writeFileSync(listFile, listContent);
      console.log(`📝 Lista de concatenación creada con ${tempVideos.length} videos`);
      
      // Concatenar videos y agregar audio
      const command = ffmpeg();
      
      command.input(listFile)
        .inputOptions([
          '-f', 'concat',
          '-safe', '0'
        ]);
      
      if (audioPath) {
        command.input(audioPath);
        console.log(`🎵 Audio agregado: ${path.basename(audioPath)}`);
      }
      
      const outputOptions = [
        '-c:v', 'copy', // No recodificar video
        '-movflags', '+faststart'
      ];
      
      if (audioPath) {
        outputOptions.push('-c:a', 'aac');
        outputOptions.push('-b:a', '128k');
        outputOptions.push('-ar', '44100');
        outputOptions.push('-map', '0:v');
        outputOptions.push('-map', '1:a');
      }
      
      command
        .outputOptions(outputOptions)
        .output(outputPath)
        .on('start', (commandLine) => {
          console.log('📹 Comando FFmpeg (concatenación final):', commandLine);
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            console.log(`⏳ Progreso concatenación: ${Math.round(progress.percent)}%`);
          }
        })
        .on('end', () => {
          console.log('✅ Video simple generado exitosamente');
          
          // Limpiar archivos temporales
          tempVideos.forEach(tempVideo => {
            try {
              if (fs.existsSync(tempVideo)) {
                fs.unlinkSync(tempVideo);
                console.log(`🗑️ Video temporal limpiado: ${path.basename(tempVideo)}`);
              }
            } catch (e) {
              console.log('⚠️ No se pudo limpiar video temporal:', e.message);
            }
          });
          
          try {
            if (fs.existsSync(listFile)) {
              fs.unlinkSync(listFile);
              console.log('🗑️ Lista temporal limpiada');
            }
          } catch (e) {
            console.log('⚠️ No se pudo limpiar lista temporal:', e.message);
          }
          
          // Verificar duración final
          if (fs.existsSync(outputPath)) {
            const stats = fs.statSync(outputPath);
            console.log(`📊 Archivo generado: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
            
            exec(`ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${outputPath}"`, (error, stdout) => {
              if (!error && stdout.trim()) {
                const actualDuration = parseFloat(stdout.trim());
                console.log(`⏱️ Duración real del video: ${actualDuration.toFixed(2)} segundos`);
                console.log(`🎯 Duración esperada: ${(duracionPorImagen * imagenes.length).toFixed(2)} segundos`);
              }
            });
          }
          
          resolve(outputPath);
        })
        .on('error', (err) => {
          console.error('❌ Error en concatenación final:', err);
          
          // Limpiar archivos temporales en caso de error
          tempVideos.forEach(tempVideo => {
            try {
              if (fs.existsSync(tempVideo)) {
                fs.unlinkSync(tempVideo);
              }
            } catch (e) {
              // Ignorar errores de limpieza
            }
          });
          
          try {
            if (fs.existsSync(listFile)) {
              fs.unlinkSync(listFile);
            }
          } catch (e) {
            // Ignorar errores de limpieza
          }
          
          reject(err);
        })
        .run();
        
    } catch (error) {
      console.error('❌ Error en proceso de generación:', error);
      
      // Limpiar archivos temporales en caso de error
      tempVideos.forEach(tempVideo => {
        try {
          if (fs.existsSync(tempVideo)) {
            fs.unlinkSync(tempVideo);
          }
        } catch (e) {
          // Ignorar errores de limpieza
        }
      });
      
      reject(error);
    }
  });
}

// Función mejorada para generar video simple con imágenes estáticas
async function generarVideoSimpleConImagenesV2(imagenes, audioPath, outputPath, duracionPorImagen) {
  return new Promise((resolve, reject) => {
    console.log(`📹 Generando video simple con ${imagenes.length} imágenes estáticas`);
    console.log(`⏱️ Duración por imagen: ${duracionPorImagen.toFixed(2)} segundos`);
    
    // ✅ NUEVO ENFOQUE: Crear videos individuales y luego concatenarlos
    const tempVideos = [];
    const tempDir = path.join(process.cwd(), 'temp');
    
    // Función para crear video de una sola imagen
    const createSingleImageVideo = (imagePath, duration, index) => {
      return new Promise((resolveImg, rejectImg) => {
        const tempVideoPath = path.join(tempDir, `temp_img_${index}_${Date.now()}.mp4`);
        
        console.log(`🖼️ Creando video para imagen ${index + 1}: ${path.basename(imagePath)}`);
        
        const command = ffmpeg();
        command.input(imagePath)
          .inputOptions([
            '-loop', '1',
            '-t', duration.toString()
          ])
          .outputOptions([
            '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black',
            '-c:v', 'libx264',
            '-profile:v', 'high',
            '-level', '4.0',
            '-crf', '23',
            '-preset', 'fast',
            '-pix_fmt', 'yuv420p',
            '-r', '30',
            '-vsync', 'cfr'
          ])
          .output(tempVideoPath)
          .on('end', () => {
            console.log(`✅ Video temporal ${index + 1} creado: ${path.basename(tempVideoPath)}`);
            resolveImg(tempVideoPath);
          })
          .on('error', (err) => {
            console.error(`❌ Error creando video temporal ${index + 1}:`, err);
            rejectImg(err);
          })
          .run();
      });
    };
    
    // Crear videos temporales para cada imagen
    const createAllTempVideos = async () => {
      console.log(`🎬 Creando ${imagenes.length} videos temporales...`);
      
      for (let i = 0; i < imagenes.length; i++) {
        try {
          const tempVideo = await createSingleImageVideo(imagenes[i], duracionPorImagen, i);
          tempVideos.push(tempVideo);
        } catch (error) {
          throw new Error(`Error creando video temporal ${i + 1}: ${error.message}`);
        }
      }
      
      console.log(`✅ Todos los videos temporales creados: ${tempVideos.length}`);
    };
    
    // Concatenar todos los videos temporales
    const concatenateVideos = () => {
      return new Promise((resolveCat, rejectCat) => {
        console.log(`🔗 Concatenando ${tempVideos.length} videos temporales...`);
        
        // Crear lista de concatenación para videos
        const listFile = path.join(tempDir, `videolist_${Date.now()}.txt`);
        const videoList = tempVideos.map(video => `file '${video.replace(/\\/g, '/')}'`).join('\n');
        
        fs.writeFileSync(listFile, videoList);
        console.log(`📝 Lista de videos creada: ${listFile}`);
        console.log(`📝 Videos a concatenar:\n${videoList}`);
        
        const command = ffmpeg();
        
        // Concatenar videos
        command.input(listFile)
          .inputOptions([
            '-f', 'concat',
            '-safe', '0'
          ]);
        
        // Agregar audio si existe
        if (audioPath) {
          command.input(audioPath);
        }
        
        const outputOptions = [
          '-c:v', 'copy', // No recodificar video
          '-movflags', '+faststart',
          '-avoid_negative_ts', 'make_zero'
        ];
        
        // Si hay audio, configurarlo
        if (audioPath) {
          outputOptions.push('-c:a', 'aac');
          outputOptions.push('-b:a', '128k');
          outputOptions.push('-ar', '44100');
          outputOptions.push('-map', '0:v'); // Video concatenado
          outputOptions.push('-map', '1:a'); // Audio
        }
        
        command
          .outputOptions(outputOptions)
          .output(outputPath)
          .on('start', (commandLine) => {
            console.log('📹 Comando FFmpeg para concatenación final:', commandLine);
          })
          .on('progress', (progress) => {
            if (progress.percent) {
              console.log(`⏳ Progreso concatenación: ${Math.round(progress.percent)}%`);
            }
          })
          .on('end', () => {
            console.log('✅ Video final concatenado exitosamente');
            
            // Limpiar archivos temporales
            tempVideos.forEach(tempVideo => {
              try {
                if (fs.existsSync(tempVideo)) {
                  fs.unlinkSync(tempVideo);
                  console.log(`🗑️ Video temporal limpiado: ${path.basename(tempVideo)}`);
                }
              } catch (e) {
                console.log('⚠️ No se pudo limpiar video temporal:', e.message);
              }
            });
            
            try {
              if (fs.existsSync(listFile)) {
                fs.unlinkSync(listFile);
                console.log('🗑️ Lista temporal limpiada');
              }
            } catch (e) {
              console.log('⚠️ No se pudo limpiar lista temporal:', e.message);
            }
            
            resolveCat();
          })
          .on('error', (err) => {
            console.error('❌ Error en concatenación final:', err);
            rejectCat(err);
          })
          .run();
      });
    };
    
    // Ejecutar proceso completo
    createAllTempVideos()
      .then(() => concatenateVideos())
      .then(() => {
        console.log('✅ Video simple generado exitosamente con método de concatenación');
        
        // Verificar duración final
        if (fs.existsSync(outputPath)) {
          const stats = fs.statSync(outputPath);
          console.log(`📊 Archivo generado: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
          
          exec(`ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${outputPath}"`, (error, stdout) => {
            if (!error && stdout.trim()) {
              const actualDuration = parseFloat(stdout.trim());
              console.log(`⏱️ Duración real del video: ${actualDuration.toFixed(2)} segundos`);
              console.log(`🎯 Duración esperada: ${(duracionPorImagen * imagenes.length).toFixed(2)} segundos`);
            }
          });
        }
        
        resolve(outputPath);
      })
      .catch((error) => {
        console.error('❌ Error en proceso de generación:', error);
        
        // Limpiar archivos temporales en caso de error
        tempVideos.forEach(tempVideo => {
          try {
            if (fs.existsSync(tempVideo)) {
              fs.unlinkSync(tempVideo);
            }
          } catch (e) {
            // Ignorar errores de limpieza
          }
        });
        
        reject(error);
      });
  });
}

// Función para combinar secciones de video simple
async function combinarSeccionesVideoSimple(videosSeccionesTemp, finalOutputPath) {
  return new Promise((resolve, reject) => {
    console.log('🔗 Concatenando todas las secciones del video simple...');
    
    const listFile = path.join(process.cwd(), 'temp', `concat_list_simple_${Date.now()}.txt`);
    const listContent = videosSeccionesTemp.map(video => `file '${video}'`).join('\n');
    
    fs.writeFileSync(listFile, listContent);
    
    const args = [
      '-f', 'concat',
      '-safe', '0',
      '-i', listFile,
      '-c', 'copy',
      '-y',
      finalOutputPath
    ];
    
    const ffmpegProcess = spawn('ffmpeg', args);
    
    let stderrData = '';
    
    ffmpegProcess.stderr.on('data', (data) => {
      stderrData += data.toString();
    });
    
    ffmpegProcess.on('close', (code) => {
      // Limpiar archivo de lista temporal
      try {
        if (fs.existsSync(listFile)) {
          fs.unlinkSync(listFile);
        }
      } catch (e) {
        console.log('⚠️ No se pudo limpiar archivo de lista:', e.message);
      }
      
      if (code === 0) {
        console.log('✅ Video simple final concatenado exitosamente');
        resolve(finalOutputPath);
      } else {
        console.error('❌ Error en concatenación FFmpeg (video simple):', stderrData);
        reject(new Error(`FFmpeg falló con código ${code}`));
      }
    });
    
    ffmpegProcess.on('error', (err) => {
      console.error('❌ Error ejecutando FFmpeg (video simple):', err);
      reject(err);
    });
  });
}

// Función para procesar clips separados (guarda 1 video por cada imagen)
async function procesarClipsSeparados(secciones, projectName, options = {}) {
  const { progressSessionId = null } = options || {};
  const videosGenerados = [];
  const videosOmitidos = [];
  
  try {
    console.log(`🎬 Procesando clips separados - 1 video por imagen para ${secciones.length} secciones`);
    
    // Procesar cada sección para extraer videos individuales por imagen
    for (let i = 0; i < secciones.length; i++) {
      const seccion = secciones[i];
      
      console.log(`📹 Procesando sección ${i + 1}/${secciones.length}: ${seccion.nombre} con ${seccion.imagenes?.length || 0} imágenes`);
      
      if (!seccion.imagenes || seccion.imagenes.length === 0) {
        console.log(`⚠️ Sección ${seccion.nombre} no tiene imágenes, saltando...`);
        continue;
      }
      
      // Buscar archivo de audio para esta sección
      let audioPath = null;
      let finalDuration = 3; // Duración por defecto si no hay audio (3 segundos por imagen)
      let audioDuration = 0; // Duración total del audio
      
      if (seccion.audios && seccion.audios.length > 0) {
        audioPath = seccion.audios[0].path;
        if (fs.existsSync(audioPath)) {
          console.log(`🎵 Audio encontrado para ${seccion.nombre}: ${audioPath}`);
          
          // Obtener duración del audio
          try {
            audioDuration = await getAudioDuration(audioPath);
            if (audioDuration > 0) {
              // Calcular duración por imagen para que el video dure lo mismo que el audio
              finalDuration = audioDuration / seccion.imagenes.length;
              console.log(`🎵 Duración del audio: ${audioDuration.toFixed(2)} segundos`);
              console.log(`📐 Duración calculada por imagen: ${finalDuration.toFixed(2)} segundos`);
            }
          } catch (error) {
            console.warn(`⚠️ No se pudo obtener duración del audio: ${error.message}`);
            audioDuration = 0;
          }
        } else {
          console.warn(`⚠️ Archivo de audio no existe: ${audioPath}`);
          audioPath = null;
        }
      }
      
      // Generar un video por cada imagen
      for (let imgIndex = 0; imgIndex < seccion.imagenes.length; imgIndex++) {
        const imagen = seccion.imagenes[imgIndex];
        
        // Generar nombre del archivo de video para esta imagen específica
        const videoFileName = `${projectName}_seccion_${seccion.numero}_imagen_${imgIndex + 1}.mp4`;
        const videoOutputPath = path.join(seccion.path, videoFileName);
        
        if (fs.existsSync(videoOutputPath)) {
          console.log(`⏭️ Clip existente detectado, se omite: ${videoFileName}`);
          videosOmitidos.push({
            seccion: seccion.numero,
            imagen: imgIndex + 1,
            nombre: `${seccion.nombre} - Imagen ${imgIndex + 1}`,
            archivo: videoFileName,
            ruta: videoOutputPath,
            omitido: true,
            motivo: 'El clip ya existía'
          });
          if (progressSessionId) {
            updateClipProgressSession(progressSessionId, seccion.numero, {
              type: 'skipped',
              index: imgIndex + 1
            });
          }
          continue;
        }

        console.log(`🖼️ Generando video ${imgIndex + 1}/${seccion.imagenes.length} de ${seccion.nombre}: ${videoFileName}`);
        
        let videoPath;
        try {
          // Procesar imagen individual como video
          videoPath = await procesarImagenIndividualComoVideo(
            imagen,
            audioPath,
            videoOutputPath,
            finalDuration,
            audioDuration,
            imgIndex,
            seccion.imagenes.length
          );
        } catch (clipError) {
          if (progressSessionId) {
            updateClipProgressSession(progressSessionId, seccion.numero, {
              type: 'error',
              index: imgIndex + 1,
              detail: clipError?.message || 'Error generando clip'
            });
          }
          throw clipError;
        }
        
        if (videoPath && fs.existsSync(videoPath)) {
          videosGenerados.push({
            seccion: seccion.numero,
            imagen: imgIndex + 1,
            nombre: `${seccion.nombre} - Imagen ${imgIndex + 1}`,
            archivo: videoFileName,
            ruta: videoPath
          });
          console.log(`✅ Video generado: ${videoFileName}`);
          if (progressSessionId) {
            updateClipProgressSession(progressSessionId, seccion.numero, {
              type: 'generated',
              index: imgIndex + 1
            });
          }
        }
      }
    }
    
    console.log(`🎬 ✅ ${videosGenerados.length} clips individuales generados. ${videosOmitidos.length ? `${videosOmitidos.length} ya existían y se omitieron.` : 'Ningún clip previo encontrado.'}`);
    return {
      generatedVideos: videosGenerados,
      skippedVideos: videosOmitidos
    };
    
  } catch (error) {
    console.error('❌ Error procesando clips separados:', error);
    throw error;
  }
}

// Función para procesar una imagen individual como video con segmento de audio correspondiente
async function procesarImagenIndividualComoVideo(imagen, audioPath, outputPath, duracionPorImagen, duracionTotalAudio, indiceImagen, totalImagenes) {
  try {
    console.log(`🖼️ Procesando imagen individual: ${path.basename(imagen.path)} → ${outputPath}`);
    
    // Validar que la imagen existe
    let imagePath = imagen.path;
    if (!path.isAbsolute(imagePath)) {
      imagePath = path.resolve(imagePath);
    }
    
    if (!fs.existsSync(imagePath)) {
      throw new Error(`Imagen no encontrada: ${imagePath}`);
    }
    
    // Verificar formato de imagen
    const ext = path.extname(imagePath).toLowerCase();
    if (!['.jpg', '.jpeg', '.png', '.bmp', '.gif', '.webp'].includes(ext)) {
      throw new Error(`Formato de imagen no soportado: ${ext}`);
    }
    
    // Preparar argumentos de FFmpeg
    const ffmpegArgs = [
      '-y', // Sobrescribir archivo de salida
      '-loop', '1', // Loop de imagen
      '-i', imagePath, // Imagen de entrada
    ];
    
    // Si hay audio, agregar segmento correspondiente a esta imagen
    if (audioPath && fs.existsSync(audioPath) && duracionTotalAudio) {
      const inicioSegmentoAudio = indiceImagen * duracionPorImagen;
      const finSegmentoAudio = Math.min((indiceImagen + 1) * duracionPorImagen, duracionTotalAudio);
      
      console.log(`🎵 Usando segmento de audio: ${inicioSegmentoAudio.toFixed(2)}s - ${finSegmentoAudio.toFixed(2)}s`);
      
      ffmpegArgs.push(
        '-ss', inicioSegmentoAudio.toString(), // Inicio del segmento de audio
        '-i', audioPath, // Archivo de audio
        '-t', (finSegmentoAudio - inicioSegmentoAudio).toString(), // Duración del segmento
        '-c:a', 'aac', // Codec de audio
        '-b:a', '128k' // Bitrate de audio
      );
    }
    
    // Configuración de video
    ffmpegArgs.push(
      '-c:v', 'libx264', // Codec de video
      '-t', duracionPorImagen.toString(), // Duración del video
      '-pix_fmt', 'yuv420p', // Formato de pixel compatible
      '-r', '30', // Frame rate
      '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:-1:-1:black', // Escalar a 16:9
      outputPath
    );
    
    console.log(`📹 Generando video con FFmpeg: ${path.basename(outputPath)}`);
    
    // Ejecutar FFmpeg
    const ffmpegProcess = spawn('ffmpeg', ffmpegArgs, {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    return new Promise((resolve, reject) => {
      let stderr = '';
      
      ffmpegProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      ffmpegProcess.on('close', (code) => {
        if (code === 0) {
          console.log(`✅ Video generado exitosamente: ${outputPath}`);
          resolve(outputPath);
        } else {
          console.error(`❌ Error en FFmpeg (código ${code}):`);
          console.error(stderr);
          reject(new Error(`FFmpeg failed with code ${code}`));
        }
      });
      
      ffmpegProcess.on('error', (error) => {
        console.error(`❌ Error ejecutando FFmpeg:`, error);
        reject(error);
      });
    });
    
  } catch (error) {
    console.error(`❌ Error procesando imagen individual: ${error.message}`);
    throw error;
  }
}

// ================================
// FUNCIONES DE ANIMACIÓN AVANZADAS CON TRANSICIONES
// ================================

// Función para generar frames animados usando Canvas con transiciones avanzadas
async function generateAnimatedFrames(imagePath, outputPath, duration, animationType, smoothness = 'standard', useGPU = false) {
  // FPS optimizado según el nivel de suavidad seleccionado
  let fps = 25;
  
  if (smoothness === 'standard') {
    if (duration > 10) fps = 20;      // 20 FPS para videos de 10-30s
    if (duration > 30) fps = 15;      // 15 FPS para videos de 30-60s
    if (duration > 60) fps = 10;      // 10 FPS para videos de 1-2 minutos  
    if (duration > 120) fps = 8;      // 8 FPS para videos muy largos (>2 min)
  } else if (smoothness === 'smooth') {
    if (duration > 10) fps = 25;      // 25 FPS para videos de 10-30s
    if (duration > 30) fps = 20;      // 20 FPS para videos de 30-60s
    if (duration > 60) fps = 15;      // 15 FPS para videos de 1-2 minutos  
    if (duration > 120) fps = 12;     // 12 FPS para videos muy largos (>2 min)
  } else if (smoothness === 'ultra') {
    if (duration > 10) fps = 30;      // 30 FPS para videos de 10-30s
    if (duration > 30) fps = 25;      // 25 FPS para videos de 30-60s
    if (duration > 60) fps = 20;      // 20 FPS para videos de 1-2 minutos  
    if (duration > 120) fps = 15;     // 15 FPS para videos muy largos (>2 min)
  }
  
  const totalFrames = duration * fps;
  const tempDir = path.join(process.cwd(), 'temp_frames');
  
  console.log(`🎬 Generando ${totalFrames} frames a ${fps} FPS para duración de ${duration}s (calidad: ${smoothness})`);
  
  // Crear directorio temporal para los frames
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  
  try {
    // Verificar que es un archivo de imagen válido
    const validImageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
    const fileExtension = path.extname(imagePath).toLowerCase();
    
    console.log(`🖼️ Procesando archivo: ${imagePath}`);
    console.log(`📄 Extensión detectada: "${fileExtension}"`);
    
    if (!validImageExtensions.includes(fileExtension)) {
      throw new Error(`Tipo de imagen no soportado: "${fileExtension}" para archivo ${path.basename(imagePath)}`);
    }
    
    // Verificar que el archivo existe
    if (!fs.existsSync(imagePath)) {
      throw new Error(`Archivo no encontrado: ${imagePath}`);
    }
    
    console.log(`📂 Cargando imagen: ${path.basename(imagePath)} (${fileExtension})`);
    
    // Cargar la imagen original
    const image = await loadImage(imagePath);
    
    // Para videos muy largos, usar lotes más grandes para mejor rendimiento
    const batchSize = duration > 60 ? 20 : 50; // Lotes más pequeños para videos largos
    
    for (let batchStart = 0; batchStart < totalFrames; batchStart += batchSize) {
      const batchEnd = Math.min(batchStart + batchSize, totalFrames);
      
      console.log(`🎥 Procesando frames ${batchStart + 1}-${batchEnd} de ${totalFrames}`);
      
      // Generar frames del lote actual
      for (let frame = batchStart; frame < batchEnd; frame++) {
        const progress = frame / (totalFrames - 1); // 0 a 1
        
        // Función de easing para suavizar las transiciones (ease-in-out cubic)
        const easeInOutCubic = (t) => {
          return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        };
        
        // Función de easing suave (ease-out sine) para movimientos más naturales
        const easeOutSine = (t) => {
          return Math.sin((t * Math.PI) / 2);
        };
        
        // Aplicar easing al progreso para animaciones más fluidas
        const easedProgress = easeInOutCubic(progress);
        
        // Crear canvas de 1920x1080
        const canvas = createCanvas(1920, 1080);
        const ctx = canvas.getContext('2d');
        
        // Fondo negro
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, 1920, 1080);
        
        // Calcular aspect ratio de la imagen original y del canvas
        const imageAspectRatio = image.width / image.height;
        const canvasAspectRatio = 1920 / 1080;
        
        // Calcular dimensiones manteniendo aspect ratio
        let baseWidth, baseHeight;
        
        if (imageAspectRatio > canvasAspectRatio) {
          // Imagen más ancha: ajustar por ancho
          baseWidth = 1920;
          baseHeight = 1920 / imageAspectRatio;
        } else {
          // Imagen más alta: ajustar por alto
          baseHeight = 1080;
          baseWidth = 1080 * imageAspectRatio;
        }
        
        // Calcular posición centrada
        const baseCenterX = (1920 - baseWidth) / 2;
        const baseCenterY = (1080 - baseHeight) / 2;
        
        // Aplicar efectos de animación manteniendo aspect ratio
        let drawWidth, drawHeight, drawX, drawY;
        
        switch (animationType) {
          case 'zoom-in':
            // Zoom in: escala de 1.0 a 1.3 con easing suave
            const zoomInScale = 1 + (easedProgress * 0.3);
            drawWidth = baseWidth * zoomInScale;
            drawHeight = baseHeight * zoomInScale;
            drawX = baseCenterX - ((drawWidth - baseWidth) / 2);
            drawY = baseCenterY - ((drawHeight - baseHeight) / 2);
            break;
            
          case 'zoom-out':
            // Zoom out: escala de 1.3 a 1.0 con easing suave
            const zoomOutScale = 1.3 - (easedProgress * 0.3);
            drawWidth = baseWidth * zoomOutScale;
            drawHeight = baseHeight * zoomOutScale;
            drawX = baseCenterX - ((drawWidth - baseWidth) / 2);
            drawY = baseCenterY - ((drawHeight - baseHeight) / 2);
            break;
            
          case 'pan-right':
            // Pan derecha: imagen más grande que se mueve con easing suave
            const panScale = 1.2;
            drawWidth = baseWidth * panScale;
            drawHeight = baseHeight * panScale;
            const panOffsetX = ((drawWidth - baseWidth) / 2) + ((drawWidth - 1920) * easedProgress);
            drawX = baseCenterX - panOffsetX;
            drawY = baseCenterY - ((drawHeight - baseHeight) / 2);
            break;
            
          case 'pan-left':
            // Pan izquierda: imagen más grande que se mueve al revés con easing suave
            const leftPanScale = 1.2;
            drawWidth = baseWidth * leftPanScale;
            drawHeight = baseHeight * leftPanScale;
            const leftPanOffsetX = ((drawWidth - baseWidth) / 2) + ((drawWidth - 1920) * (1 - easedProgress));
            drawX = baseCenterX - leftPanOffsetX;
            drawY = baseCenterY - ((drawHeight - baseHeight) / 2);
            break;
            
          case 'fade-in':
            // Fade in: opacidad de 0 a 1
            drawWidth = baseWidth;
            drawHeight = baseHeight;
            drawX = baseCenterX;
            drawY = baseCenterY;
            ctx.globalAlpha = easedProgress;
            break;
            
          case 'slide-in-left':
            // Deslizar desde la izquierda
            drawWidth = baseWidth;
            drawHeight = baseHeight;
            drawX = baseCenterX - (1920 * (1 - easedProgress));
            drawY = baseCenterY;
            break;
            
          case 'slide-in-right':
            // Deslizar desde la derecha
            drawWidth = baseWidth;
            drawHeight = baseHeight;
            drawX = baseCenterX + (1920 * (1 - easedProgress));
            drawY = baseCenterY;
            break;
            
          case 'rotate-zoom':
            // Rotación con zoom
            const rotateZoomScale = 1 + (easedProgress * 0.2);
            const rotation = easedProgress * Math.PI * 2; // Una rotación completa
            drawWidth = baseWidth * rotateZoomScale;
            drawHeight = baseHeight * rotateZoomScale;
            
            ctx.save();
            ctx.translate(1920/2, 1080/2);
            ctx.rotate(rotation);
            ctx.translate(-drawWidth/2, -drawHeight/2);
            drawX = 0;
            drawY = 0;
            break;
            
          case 'none':
          default:
            // Sin animación: imagen estática centrada manteniendo aspect ratio
            drawWidth = baseWidth;
            drawHeight = baseHeight;
            drawX = baseCenterX;
            drawY = baseCenterY;
        }
        
        // Dibujar la imagen en el canvas manteniendo aspect ratio
        ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
        
        // Restaurar contexto si se usó transformación
        if (animationType === 'rotate-zoom') {
          ctx.restore();
        }
        
        // Resetear alpha si se usó
        if (animationType === 'fade-in') {
          ctx.globalAlpha = 1;
        }
        
        // Guardar el frame como imagen con calidad ajustada según duración
        const quality = duration > 60 ? 0.7 : 0.85; // Menor calidad para videos largos
        const framePath = path.join(tempDir, `frame_${String(frame).padStart(6, '0')}.jpg`);
        const buffer = canvas.toBuffer('image/jpeg', { quality });
        fs.writeFileSync(framePath, buffer);
      }
      
      // Forzar liberación de memoria entre lotes
      if (global.gc) {
        global.gc();
      }
    }
    
    // Convertir frames a video usando FFmpeg con aceleración GPU opcional
    await new Promise((resolve, reject) => {
      const videoCodec = useGPU ? 'h264_nvenc' : 'libx264';
      const outputOptions = [
        '-c:v', videoCodec,
        '-pix_fmt', 'yuv420p',
        '-t', duration.toString()
      ];
      
      if (useGPU) {
        // Opciones optimizadas para NVENC
        outputOptions.push(
          '-preset', 'fast',        // Preset rápido para NVENC
          '-rc', 'vbr',             // Variable bitrate
          '-cq', '23',              // Calidad constante
          '-b:v', '8M',             // Bitrate target
          '-maxrate', '15M',        // Bitrate máximo
          '-bufsize', '30M'         // Buffer size
        );
      } else {
        // Opciones para CPU
        outputOptions.push('-preset', duration > 60 ? 'ultrafast' : 'fast');
      }
      
      console.log(`🎬 Convirtiendo frames a video usando ${useGPU ? 'GPU (NVENC)' : 'CPU'}...`);
      
      ffmpeg()
        .input(path.join(tempDir, 'frame_%06d.jpg'))
        .inputOptions(['-framerate', fps.toString()])
        .outputOptions(outputOptions)
        .output(outputPath)
        .on('end', () => {
          console.log(`✅ Video generado exitosamente con ${useGPU ? 'aceleración GPU' : 'CPU'}`);
          resolve();
        })
        .on('error', reject)
        .run();
    });
    
    // Limpiar frames temporales
    const files = fs.readdirSync(tempDir);
    for (const file of files) {
      fs.unlinkSync(path.join(tempDir, file));
    }
    
  } catch (error) {
    throw error;
  }
}

// Función para generar video de una imagen con transiciones usando Canvas
async function generateImageVideoWithTransitions(imagePath, outputPath, duration, animationType = 'zoom-out', fps = 30) {
  return new Promise(async (resolve, reject) => {
    try {
      console.log(`🎬 Generando video con transición ${animationType} para ${path.basename(imagePath)}`);
      
      // Generar video completo con animación
      await generateAnimatedFrames(imagePath, outputPath, duration, animationType, 'standard', false);
      
      console.log(`✅ Video con transición generado: ${path.basename(outputPath)}`);
      resolve(outputPath);
      
    } catch (error) {
      console.error('Error en generateImageVideoWithTransitions:', error);
      reject(error);
    }
  });
}

// Función para concatenar videos con transición crossfade
async function concatenateVideosWithCrossfade(videoPaths, audioPath, outputPath) {
  return new Promise((resolve, reject) => {
    console.log(`🎬 Concatenando ${videoPaths.length} videos con transición crossfade...`);
    
    if (videoPaths.length === 0) {
      reject(new Error('No hay videos para concatenar'));
      return;
    }
    
    if (videoPaths.length === 1) {
      // Si solo hay un video, no necesitamos crossfade
      const command = ffmpeg(videoPaths[0]);
      if (audioPath) {
        command.input(audioPath);
      }
      command
        .outputOptions(['-c:v libx264', '-crf 23', '-preset medium'])
        .output(outputPath)
        .on('end', () => {
          console.log('✅ Video único procesado correctamente');
          resolve(outputPath);
        })
        .on('error', (err) => {
          console.error('Error procesando video único:', err);
          reject(err);
        })
        .run();
      return;
    }
    
    // Para múltiples videos, creamos filtros de crossfade
    const command = ffmpeg();
    
    // Agregar todos los videos como inputs
    videoPaths.forEach(videoPath => {
      command.input(videoPath);
    });
    
    // Agregar audio si existe
    if (audioPath) {
      command.input(audioPath);
    }
    
    // Construir el filtro complejo para crossfade
    const filterComplex = [];
    const crossfadeDuration = 0.5; // 0.5 segundos de crossfade
    
    // Para múltiples videos, usaremos un enfoque más simple: concatenar con fade
    // Primero, creamos un filtro que ajusta cada video para que tenga fade out al final
    for (let i = 0; i < videoPaths.length; i++) {
      if (i === 0) {
        // Primer video: solo fade out al final
        filterComplex.push(`[${i}:v]fade=t=out:st=9.5:d=0.5[v${i}]`);
      } else if (i === videoPaths.length - 1) {
        // Último video: solo fade in al inicio
        filterComplex.push(`[${i}:v]fade=t=in:st=0:d=0.5[v${i}]`);
      } else {
        // Videos del medio: fade in y fade out
        filterComplex.push(`[${i}:v]fade=t=in:st=0:d=0.5,fade=t=out:st=9.5:d=0.5[v${i}]`);
      }
    }
    
    // Ahora concatenamos todos los videos con fade
    const inputLabels = videoPaths.map((_, i) => `[v${i}]`).join('');
    filterComplex.push(`${inputLabels}concat=n=${videoPaths.length}:v=1:a=0[outv]`);
    
    const outputOptions = [
      '-filter_complex', filterComplex.join(';'),
      '-map', '[outv]',
      '-c:v', 'libx264',
      '-crf', '23',
      '-preset', 'medium',
      '-pix_fmt', 'yuv420p'
    ];
    
    // Si hay audio, mapearlo también
    if (audioPath) {
      outputOptions.push('-map', `${videoPaths.length}:a`);
      outputOptions.push('-c:a', 'aac');
      outputOptions.push('-b:a', '128k');
    }
    
    command
      .outputOptions(outputOptions)
      .output(outputPath)
      .on('start', (commandLine) => {
        console.log('🎬 Comando FFmpeg para crossfade:', commandLine);
      })
      .on('progress', (progress) => {
        if (progress.percent) {
          console.log(`⏳ Progreso crossfade: ${Math.round(progress.percent)}%`);
        }
      })
      .on('end', () => {
        console.log('✅ Videos concatenados con crossfade exitosamente');
        resolve(outputPath);
      })
      .on('error', (err) => {
        console.error('❌ Error en concatenación con crossfade:', err);
        reject(err);
      })
      .run();
  });
}

// Endpoint para probar el sistema automático de ComfyUI
app.post('/test-comfyui-auto', async (req, res) => {
  try {
    console.log('🧪 Iniciando prueba del sistema automático de ComfyUI...');
    
    // Probar iniciar ComfyUI
    const started = await startComfyUI();
    if (!started) {
      return res.status(500).json({ 
        success: false, 
        error: 'No se pudo iniciar ComfyUI automáticamente' 
      });
    }
    
    // Esperar un momento y luego cerrarlo
    console.log('⏳ Esperando 5 segundos antes de cerrar...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    const stopped = await stopComfyUI();
    
    res.json({ 
      success: true, 
      message: 'Sistema automático de ComfyUI probado exitosamente',
      started: started,
      stopped: stopped
    });
    
  } catch (error) {
    console.error('❌ Error en prueba automática:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Endpoint para probar el sistema automático de Applio
app.post('/test-applio-auto', async (req, res) => {
  try {
    console.log('🧪 Iniciando prueba del sistema automático de Applio...');
    
    // Probar iniciar Applio
    const started = await startApplio();
    if (!started) {
      return res.status(500).json({ 
        success: false, 
        error: 'No se pudo iniciar Applio automáticamente' 
      });
    }
    
    // Verificar conexión después del inicio
    console.log('✅ Verificando conexión con Applio...');
    const isConnected = await applioClient.checkConnection();
    
    res.json({ 
      success: true, 
      message: 'Sistema automático de Applio probado exitosamente - Applio permanece abierto',
      started: started,
      connected: isConnected,
      status: 'Applio permanece ejecutándose para futuras pruebas'
    });
    
  } catch (error) {
    console.error('❌ Error en prueba automática de Applio:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// Función auxiliar para actualizar el audio de una sección en el estado del proyecto
function updateSectionAudioInState(projectKey, sectionNumber, audioPath) {
  try {
    const projectStateFile = path.join(globalOutputDir, projectKey, 'project_state.json');
    if (!fs.existsSync(projectStateFile)) return false;

    const state = JSON.parse(fs.readFileSync(projectStateFile, 'utf8'));
    
    if (state.completedSections) {
      const sectionIndex = state.completedSections.findIndex(s => s.section === sectionNumber);
      if (sectionIndex !== -1) {
        state.completedSections[sectionIndex].audio = {
          path: audioPath,
          filename: path.basename(audioPath),
          saved: true
        };
        
        // También actualizar completedAudio
        if (!state.completedAudio) state.completedAudio = [];
        
        const audioEntry = {
          section: sectionNumber,
          path: audioPath,
          filename: path.basename(audioPath),
          completedAt: new Date().toISOString()
        };
        
        const audioIndex = state.completedAudio.findIndex(a => a.section === sectionNumber);
        if (audioIndex !== -1) {
          state.completedAudio[audioIndex] = audioEntry;
        } else {
          state.completedAudio.push(audioEntry);
        }
        
        state.lastModified = new Date().toISOString();
        
        // Actualizar resumableState
        if (state.resumableState) {
           state.resumableState.canResumeAudio = state.completedAudio.length < (state.totalSections || 0);
        }

        fs.writeFileSync(projectStateFile, JSON.stringify(state, null, 2), 'utf8');
        return true;
      }
    }
    return false;
  } catch (error) {
    console.error(`❌ Error actualizando audio en estado para sección ${sectionNumber}:`, error);
    return false;
  }
}

app.listen(PORT, '0.0.0.0', async () => {
  const localIP = getLocalIP();
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
  console.log(`📱 Para acceder desde tu celular en la misma red WiFi, usa: http://${localIP}:${PORT}`);
  
  // Verificar FFmpeg al inicio
  const { spawn } = await import('child_process');
  const checkFFmpeg = spawn('ffmpeg', ['-version']);
  checkFFmpeg.on('error', () => {
      console.error('\n❌❌❌ ERROR CRÍTICO ❌❌❌');
      console.error('FFmpeg NO está instalado o no se encuentra en el PATH del sistema.');
      console.error('La aplicación NO funcionará correctamente sin FFmpeg.');
      console.error('👉 Instala FFmpeg: https://ffmpeg.org/download.html\n');
  });
  checkFFmpeg.on('close', (code) => {
      if (code === 0) console.log('✅ FFmpeg detectado correctamente');
  });

  // Verificar Python al inicio
  try {
    const { cmd, args } = await detectPythonCommand();
    const checkPython = spawn(cmd, [...args, '--version']);
    checkPython.on('close', (code) => {
        if (code === 0) console.log(`✅ Python detectado correctamente (usando ${cmd} ${args.join(' ')})`);
    });
  } catch (e) {
      console.error('\n❌❌❌ ERROR CRÍTICO ❌❌❌');
      console.error('Python NO está instalado o no se encuentra en el PATH.');
      console.error('O Windows está intentando abrir la Microsoft Store (Alias de ejecución).');
      console.error('👉 Instala Python (marcando "Add to PATH"): https://www.python.org/downloads/');
      console.error('👉 O desactiva los "Alias de ejecución de aplicaciones" para Python en la configuración de Windows.\n');
  }

  // Verificar conexión con ComfyUI
  try {
    const connectionCheck = await comfyUIClient.checkConnection();
    if (connectionCheck.success) {
      console.log(`✅ Conectado exitosamente a ComfyUI en http://127.0.0.1:8188`);
      
      // Obtener modelos disponibles
      const modelsInfo = await comfyUIClient.getAvailableModels();
      if (modelsInfo.success) {
        console.log(`📦 Modelos disponibles en ComfyUI: ${modelsInfo.models.length}`);
        if (modelsInfo.models.includes('flux1-dev-fp8.safetensors')) {
          console.log(`🎯 Modelo Flux encontrado y listo para usar`);
        } else {
          console.warn(`⚠️ Modelo Flux no encontrado. Modelos disponibles:`, modelsInfo.models.slice(0, 3));
        }
      }
    } else {
      console.warn(`⚠️ No se pudo conectar a ComfyUI: ${connectionCheck.error}`);
      console.warn(`🔧 Asegúrate de que ComfyUI esté ejecutándose en http://127.0.0.1:8188`);
    }
  } catch (error) {
    console.warn(`⚠️ Error verificando ComfyUI: ${error.message}`);
    console.warn(`🔧 Las funciones de IA local requerirán que ComfyUI esté ejecutándose`);
  }
});

// Manejadores para cerrar ComfyUI y Applio cuando la aplicación se cierre
process.on('SIGINT', async () => {
  console.log('\n🛑 Cerrando aplicación...');
  // Comentado para mantener servicios activos
  // console.log('🔄 Cerrando ventana CMD de ComfyUI...');
  // await stopComfyUI();
  // console.log('🔄 Cerrando ventana CMD de Applio...');
  // await stopApplio();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Terminando aplicación...');
  // Comentado para mantener servicios activos
  // console.log('🔄 Cerrando ventana CMD de ComfyUI...');
  // await stopComfyUI();
  // console.log('🔄 Cerrando ventana CMD de Applio...');
  // await stopApplio();
  process.exit(0);
});

process.on('beforeExit', async () => {
  // console.log('🔄 Cerrando ventanas CMD antes de salir...');
  // await stopComfyUI();
  // await stopApplio();
});

// Endpoint para obtener el estado de un proyecto
app.get('/get-project-state/:projectKey', async (req, res) => {
  try {
    const { projectKey } = req.params;

    if (!projectKey) {
      return res.status(400).json({ error: 'projectKey es requerido' });
    }

    console.log(`🔍 Buscando estado del proyecto: ${projectKey}`);

    // Cargar el estado del proyecto
    const projectState = loadProjectState(projectKey);

    if (!projectState) {
      console.warn(`⚠️ Estado del proyecto no encontrado para: ${projectKey}`);
      return res.status(404).json({ error: `Proyecto no encontrado: ${projectKey}` });
    }

    console.log(`✅ Estado del proyecto "${projectKey}" cargado:`, projectState);

    res.json({
      success: true,
      projectState: projectState
    });

  } catch (error) {
    console.error('❌ Error obteniendo estado del proyecto:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Endpoint para leer archivos de script
app.get('/read-script-file/:projectKey/:sectionNumber', async (req, res) => {
  try {
    const { projectKey, sectionNumber } = req.params;
    const section = parseInt(sectionNumber);
    
    if (!projectKey || !section || isNaN(section)) {
      return res.status(400).json({ error: 'projectKey y sectionNumber son requeridos' });
    }
    
    // Cargar el estado del proyecto para obtener el topic real
    const projectState = loadProjectState(projectKey);
    const projectTopic = projectState ? projectState.topic : projectKey;
    
    // Crear estructura de carpetas CORRECTA (igual que donde se guardan los scripts)
    const folderStructure = createProjectStructure(projectTopic, section, projectKey);
    const scriptFileName = `${projectKey}_seccion_${section}_guion.txt`;
    const scriptFilePath = path.join(folderStructure.sectionDir, scriptFileName);
    
    console.log(`📄 Leyendo script desde: ${scriptFilePath}`);
    console.log(`📂 Estructura de carpetas:`, {
      projectDir: folderStructure.projectDir,
      sectionDir: folderStructure.sectionDir,
      topic: projectTopic,
      projectKey: projectKey
    });
    
    if (!fs.existsSync(scriptFilePath)) {
      console.warn(`⚠️ Archivo de script no encontrado: ${scriptFilePath}`);
      console.log(`📂 Archivos disponibles en el directorio:`, fs.existsSync(folderStructure.sectionDir) ? fs.readdirSync(folderStructure.sectionDir) : 'Directorio no existe');
      return res.status(404).json({ error: `Archivo de script no encontrado: ${scriptFilePath}` });
    }
    
    const scriptContent = fs.readFileSync(scriptFilePath, 'utf8');
    console.log(`✅ Script leído exitosamente, longitud: ${scriptContent.length} caracteres`);
    console.log(`📄 Contenido crudo del archivo:`, scriptContent.substring(0, 200) + '...');
    
    // Limpiar el contenido del script usando la función centralizada
    const cleanScript = cleanScriptContent(scriptContent);
    
    console.log(`✅ Script limpiado exitosamente, nueva longitud: ${cleanScript.length} caracteres`);
    console.log(`📄 Contenido limpio del guion:`, cleanScript.substring(0, 200) + '...');
    
    res.json({ 
      success: true,
      script: cleanScript,
      filePath: scriptFilePath
    });
    
  } catch (error) {
    console.error('❌ Error leyendo archivo de script:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ENDPOINT PARA GENERAR METADATOS DE YOUTUBE PARA UN PROYECTO EXISTENTE
app.post('/generate-youtube-metadata-for-project', async (req, res) => {
  try {
    const { folderName } = req.body;

    if (!folderName) {
      return res.status(400).json({ error: 'folderName requerido' });
    }

    console.log(`🎬 Generando metadatos de YouTube para proyecto: ${folderName}`);

    // Cargar el estado del proyecto
    const projectState = loadProjectState(folderName);
    if (!projectState) {
      return res.status(404).json({ error: 'Proyecto no encontrado' });
    }

    // Generar metadatos autom�ticamente
    await generateYouTubeMetadataForProject(projectState);

    // Recargar el estado para obtener los metadatos actualizados
    const updatedProjectState = loadProjectState(folderName);

    res.json({
      success: true,
      message: 'Metadatos de YouTube generados exitosamente',
      project: folderName,
      metadata: updatedProjectState.youtubeMetadata
    });

  } catch (error) {
    console.error('� Error generando metadatos para proyecto:', error);
    res.status(500).json({
      success: false,
      error: 'Error generando metadatos: ' + error.message
    });
  }
});

// Helper functions for Google TTS in Video Translation
async function generateSingleGoogleTTS(text, outputPath, lang, selectedVoice = 'Kore', modelName = GEMINI_TTS_MODEL_FLASH) {
    if (!text || !text.trim()) {
        throw new Error("Text is empty");
    }
    // Map language codes to Google TTS voices if needed, or use a default
    // Using 'Kore' as default as seen in other parts of the code
    const voiceName = selectedVoice || 'Kore'; 
    
    // Get API key (using free tier logic from existing code)
    const usageState = getTrackedUsageState('tts');
    const skipFreeApis = usageState?.preferPrimary;
    
    // Prepare list of keys to try
    let keysToTry = [];
    
    if (!skipFreeApis) {
        const freeApiEntries = getFreeGoogleAPIKeys();
        // Shuffle free keys to distribute load
        for (let i = freeApiEntries.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [freeApiEntries[i], freeApiEntries[j]] = [freeApiEntries[j], freeApiEntries[i]];
        }
        keysToTry = [...freeApiEntries];
    }
    
    // Add primary key at the end if available
    if (process.env.GOOGLE_API_KEY) {
        keysToTry.push({ key: process.env.GOOGLE_API_KEY, name: GOOGLE_PRIMARY_API_NAME, isPrimary: true });
    }

    if (keysToTry.length === 0) {
        throw new Error('No Google API keys available for TTS');
    }

    let lastError = null;

    for (const entry of keysToTry) {
        let keyRetries = 1; // Allow 1 retry per key for specific errors
        while (keyRetries >= 0) {
            try {
                const client = getGoogleTTSClient(entry.key);
                const apiName = entry.name;
                
                console.log(`🔊 Generating Google TTS for lang ${lang} using ${apiName} with model ${modelName}...`);

                const response = await client.models.generateContent({
                    model: modelName,
                    contents: [
                        {
                            role: 'user',
                            parts: [{ text: text }]
                        }
                    ],
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

                const audioPart = response?.candidates?.[0]?.content?.parts?.find(part => part.inlineData?.data);
                if (!audioPart?.inlineData?.data) {
                    // Log full response for debugging
                    console.log(`❌ Google TTS response missing audio data (${apiName}). Response:`, JSON.stringify(response, null, 2));
                    throw new Error('Google TTS response missing audio data');
                }

                const audioBuffer = Buffer.from(audioPart.inlineData.data, 'base64');
                
                if (audioBuffer.length < 100) {
                    throw new Error('Generated audio is too short/empty');
                }

                // Check mimeType to determine if it's PCM or WAV
                const mimeType = audioPart.inlineData.mimeType || '';
                
                // If it's PCM (or if we assume it is based on user feedback/docs), we need to wrap it in WAV container
                // The user snippet suggests it returns raw PCM data that needs wrapping.
                // We'll try to detect or just default to wrapping if it's not explicitly WAV.
                
                // Note: The API usually returns 'audio/wav' if it's WAV, or 'audio/pcm' if PCM.
                // However, the user's snippet implies we should use saveWaveFile.
                
                if (mimeType.includes('pcm') || !mimeType.includes('wav')) {
                     // Default to 24kHz as per user snippet
                     const rateMatch = mimeType.match(/rate=(\d+)/i);
                     const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;
                     await saveWaveFile(outputPath, audioBuffer, 1, sampleRate);
                } else {
                     // It claims to be WAV, write directly
                     await writeFile(outputPath, audioBuffer);
                }
                
                // Success!
                return; 

            } catch (error) {
                lastError = error;
                const isRateLimit = error.message.includes('429') || (error.status === 429) || error.message.includes('Too Many Requests') || error.message.includes('Quota exceeded') || error.message.includes('RESOURCE_EXHAUSTED');
                const isMissingAudio = error.message.includes('Google TTS response missing audio data');
                
                if (isRateLimit) {
                    console.warn(`⚠️ API ${entry.name} saturada (429). Intentando siguiente...`);
                    keyRetries = -1; // Don't retry this key, move to next
                    // Add a small delay before trying next key to avoid hammering
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } else if (isMissingAudio && keyRetries > 0) {
                    console.warn(`⚠️ Error con API ${entry.name}: ${error.message}. Reintentando con la misma clave en 2s...`);
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    keyRetries--;
                } else {
                    console.warn(`⚠️ Error con API ${entry.name}: ${error.message}. Intentando siguiente...`);
                    keyRetries = -1; // Move to next key
                }
            }
        }
    }

    // If we get here, all keys failed
    throw lastError || new Error('All API keys failed for TTS');
}

async function mergeAudioFiles(files, outputPath) {
    return new Promise((resolve, reject) => {
        // Verify files exist
        const missingFiles = files.filter(f => !fs.existsSync(f));
        if (missingFiles.length > 0) {
            return reject(new Error(`Missing files for merge: ${missingFiles.join(', ')}`));
        }

        // Create a list file for ffmpeg
        const listFilePath = outputPath + '.list.txt';
        
        // Use filenames only (relative paths) to avoid Windows path issues in concat demuxer
        // This works because list file is in the same directory as the audio files
        const fileContent = files.map(f => `file '${path.basename(f)}'`).join('\n');
        fs.writeFileSync(listFilePath, fileContent);

        console.log(`📝 Merging ${files.length} files. List file created at: ${listFilePath}`);

        const ffmpeg = spawn('ffmpeg', [
            '-y',
            '-f', 'concat',
            '-safe', '0',
            '-i', listFilePath,
            '-c', 'copy',
            outputPath
        ]);

        let stderr = '';

        ffmpeg.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        ffmpeg.on('close', (code) => {
            if (fs.existsSync(listFilePath)) {
                try { fs.unlinkSync(listFilePath); } catch (e) { console.error("Error deleting list file:", e); }
            }
            
            if (code === 0) {
                resolve();
            } else {
                console.error(`❌ FFmpeg merge failed. Stderr:\n${stderr}`);
                reject(new Error(`FFmpeg merge failed with code ${code}. Stderr: ${stderr.slice(-200)}`));
            }
        });
        
        ffmpeg.on('error', (err) => {
             if (fs.existsSync(listFilePath)) {
                 try { fs.unlinkSync(listFilePath); } catch (e) {}
             }
             console.error(`❌ FFmpeg spawn error:`, err);
             reject(err);
        });
    });
}

async function generateGoogleTTSWithSplitting(text, outputPath, lang, selectedVoice = 'Kore', modelName = GEMINI_TTS_MODEL_FLASH, randomVoice = false, disableParagraphSplitting = false, keepTempFiles = false, sectionUniqueId = '') {
    // Determine initial chunks based on splitting preference
    let rawParagraphs;
    
    if (disableParagraphSplitting) {
        // Try to keep it as one block, but we still might need to split if it's too huge later
        // But for the initial "logical" split, we keep it together
        rawParagraphs = [text];
    } else {
        // Split text into paragraphs based on double newlines
        rawParagraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
    }
    
    // Group paragraphs intelligently based on length limits (MAX: 1600 chars or 300 words)
    // If combining 2 paragraphs exceeds limit, keep separate. Otherwise combine.
    const MAX_CHARS = 1600;
    const MAX_WORDS = 300;

    let paragraphs = [];
    // We iterate manually
    for (let i = 0; i < rawParagraphs.length; i++) {
        const currentPara = rawParagraphs[i].trim();
        
        // If we are in disableParagraphSplitting mode, we try to process the whole text as one block.
        // However, if the text is excessively large (e.g. > 4000 chars), we MUST split it to avoid API errors.
        if (disableParagraphSplitting && (currentPara.length > 4000)) {
             console.log(`⚠️ Text section is too large (${currentPara.length} chars) even for forced-single-mode. Falling back to splitting.`);
             
             // Try splitting by double newlines first
             let subParts = currentPara.split(/\n\s*\n/).filter(p => p.trim().length > 0);
             
             // If no double newlines (single block), try single newlines
             if (subParts.length <= 1) {
                 subParts = currentPara.split(/\n/).filter(p => p.trim().length > 0);
             }
             
             // If still single block (no newlines at all), force character chunking
             if (subParts.length <= 1) {
                 subParts = currentPara.match(/.{1,4000}(?:\s|$)/g) || [currentPara];
             }

             // Append smaller parts to the end of the queue to be processed
             // This works because the loop condition checks rawParagraphs.length dynamically
             for(const sub of subParts) {
                 // Push only if it's actually smaller or different to avoid infinite loop
                 if (sub !== currentPara) {
                    rawParagraphs.push(sub);
                 } else {
                    // If we couldn't split it further, we just have to accept it and hope for the best
                    // (It will fall through to the logic below and be added as is)
                    break;
                 }
             }
             
             if (subParts.length > 1 || subParts[0] !== currentPara) {
                 continue; // Skip processing this large chunk, we'll handle the pieces later
             }
        }

        // Standard combination logic (works for both modes)
        // If disableParagraphSplitting is true, we likely have [ "Big Text" ] or maybe [ "Big Text", "Overflow" ]
        // The loop will just push them.
        
        if (i + 1 < rawParagraphs.length) {
            const nextPara = rawParagraphs[i+1].trim();
            const combined = currentPara + "\n\n" + nextPara;
            
            const combinedWordCount = combined.split(/\s+/).length;
            
            // Check limits. If SAFE OR if we disabled splitting, combine them and skip next iteration
            // Note: If disableParagraphSplitting is true, we want to combine everything unless it's huge (handled above).
            // But actually, rawParagraphs is already [text] if disableParagraphSplitting is true, so this loop runs once and i+1 is false.
            // So we don't need to change logic here. The loop naturally falls through to "Last paragraph alone" branch.
            
            if (combined.length <= MAX_CHARS && combinedWordCount <= MAX_WORDS) {
                paragraphs.push(combined);
                i++; // Skip next paragraph
            } else {
                // EXCEEDS LIMIT, process current paragraph alone
                // Next iteration will process the next paragraph
                if (!disableParagraphSplitting) {
                   // Only warn if we intended to split but couldn't combine
                   // console.log(`⚠️ Paragraph split enforced...`);
                }
                paragraphs.push(currentPara);
            }
        } else {
            // Last paragraph alone
            paragraphs.push(currentPara);
        }
    }
    
    // Fallback if no paragraphs found
    if (paragraphs.length === 0) paragraphs = [text];

    const tempFiles = [];
    const tempDir = path.dirname(outputPath);

    // List of Google TTS voices to choose from randomly
    // Mix of Male and Female voices for variety
    const googleVoicesList = [
        'Zephyr', 'Kore', 'Leda', 'Aoede', 'Callirrhoe', 'Autonoe', 'Algieba', 'Despina', 'Erinome', 'Algenib',
        'Rasalgethi', 'Laomedeia', 'Achernar', 'Gacrux', 'Pulcherrima', 'Achird', 'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat',
        'Puck', 'Charon', 'Fenrir', 'Orus', 'Enceladus', 'Iapetus', 'Umbriel', 'Alnilam', 'Schedar', 'Zubenelgenubi'
    ];

    try {
        // Filter paragraphs first
        const cleanParagraphs = paragraphs.map(p => p.trim()).filter(p => p.length > 0);
        
        // Pre-generate file paths to ensure order
        // Use deterministic names for resumption: temp_tts_{lang}_part_{index}.wav
        // A unique ID is critical when processing multiple sections in parallel to avoid collisions
        const safeUniqueId = sectionUniqueId ? `_${sectionUniqueId}` : '';
        const filePaths = cleanParagraphs.map((_, i) => path.join(tempDir, `temp_tts_${lang}${safeUniqueId}_part_${i}.wav`));
        
        // Add to tempFiles for cleanup
        filePaths.forEach(f => tempFiles.push(f));

        // Create tasks
        const tasks = cleanParagraphs.map((paragraph, i) => {
            return async () => {
                const filePath = filePaths[i];
                if (fs.existsSync(filePath)) {
                    // Check if file is valid (size > 100 bytes)
                    const stats = fs.statSync(filePath);
                    if (stats.size > 100) {
                        console.log(`⏩ Skipping existing part ${i} for ${lang}`);
                        return;
                    }
                }
                
                // Select voice: Random or Fixed (per paragraph)
                let voiceToUse = selectedVoice;
                if (randomVoice) {
                    voiceToUse = googleVoicesList[Math.floor(Math.random() * googleVoicesList.length)];
                    console.log(`🎲 Random Voice for part ${i}: ${voiceToUse}`);
                }
                
                await generateSingleGoogleTTS(paragraph, filePath, lang, voiceToUse, modelName);
            };
        });

        // Run in batches of 3 (Parallel execution)
        const BATCH_SIZE = 3;
        for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
            const batch = tasks.slice(i, i + BATCH_SIZE);
            console.log(`🚀 Processing batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(tasks.length/BATCH_SIZE)} for ${lang} (3 parallel)...`);
            
            try {
                await Promise.all(batch.map(task => task()));
            } catch (err) {
                console.error(`❌ Error in batch ${Math.floor(i/BATCH_SIZE) + 1} for ${lang}:`, err.message);
                throw err; // Stop process on error, but temp files remain
            }
            
            // Small delay between batches to avoid hitting rate limits too hard
            if (i + BATCH_SIZE < tasks.length) await new Promise(r => setTimeout(r, 1000));
        }

        if (tempFiles.length === 0) {
             throw new Error("No audio generated from text");
        }
        
        // Always use mergeAudioFiles to ensure consistent output format compatible with FFmpeg
        // This avoids issues where a direct copy might carry over weird header issues
        await mergeAudioFiles(tempFiles, outputPath);

        // Cleanup temp files ONLY on success AND if NOT keepTempFiles
        if (!keepTempFiles) {
            for (const file of tempFiles) {
                if (fs.existsSync(file)) {
                    try { fs.unlinkSync(file); } catch(e) { console.error("Error deleting temp file:", e); }
                }
            }
        } else {
            console.log(`💾 Keeping temp files for debugging: ${tempFiles.length} files`);
        }

    } catch (error) {
        console.error(`❌ Error in generateGoogleTTSWithSplitting for ${lang}:`, error);
        // Do NOT delete temp files here to allow resumption
        throw error;
    }
}


// Endpoint para verificar si un proyecto de video ya existe
app.get('/api/check-video-exists', (req, res) => {
    try {
        const { videoName } = req.query;
        if (!videoName) {
            return res.status(400).json({ exists: false, error: 'Nombre de video requerido' });
        }
        
        const name = path.parse(videoName).name;
        const outputDir = path.join(globalOutputDir, name);
        
        // Verificar existencia del directorio y del video original
        if (fs.existsSync(outputDir)) {
             const files = fs.readdirSync(outputDir);
             const hasOriginalVideo = files.some(f => f.startsWith('original_video'));
             
             if (hasOriginalVideo) {
                 return res.json({ exists: true, message: 'Proyecto encontrado con video original.' });
             }
        }
        
        res.json({ exists: false });
    } catch (error) {
        console.error('Error checking video existence:', error);
        res.status(500).json({ exists: false, error: error.message });
    }
});

// --- Endpoint para Traducir Videos ---
app.post('/api/translate-video', upload.fields([{ name: 'video', maxCount: 1 }, { name: 'music', maxCount: 1 }]), async (req, res) => {
    // Setup SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendStatus = (status, progress = null, completed = false, error = null) => {
        const data = JSON.stringify({ status, progress, completed, error });
        res.write(`data: ${data}\n\n`);
    };

    try {
        let videoPath;
        let videoName;
        let musicFile = req.files && req.files['music'] ? req.files['music'][0] : null;

        // Check if this is a retry with an existing video
        if (req.body.retryVideoName) {
            videoName = path.parse(req.body.retryVideoName).name;
            const outputDir = path.join(globalOutputDir, videoName);
            // Try to find the saved original video
            // We don't know the extension for sure, so we might need to look for it or assume mp4/original name
            // Let's assume we saved it as 'original_video.mp4' or similar. 
            // Better: look for any file starting with 'original_video' in the output dir
            
            if (fs.existsSync(outputDir)) {
                const files = fs.readdirSync(outputDir);
                const originalVideo = files.find(f => f.startsWith('original_video.'));
                if (originalVideo) {
                    videoPath = path.join(outputDir, originalVideo);
                    console.log(`🔄 Retrying with existing video: ${videoPath}`);
                }
            }
            
            if (!videoPath) {
                throw new Error('Could not find existing video for retry. Please upload the file again.');
            }
        } else {
            // Normal upload flow
            if (!req.files || !req.files['video']) {
                throw new Error('No video file uploaded');
            }
            const videoFile = req.files['video'][0];
            videoPath = videoFile.path;
            videoName = path.parse(videoFile.originalname).name;
        }

        // Limpiar carpeta temp de archivos viejos (excepto los actuales)
        try {
            const tempDir = './temp';
            if (fs.existsSync(tempDir)) {
                const files = fs.readdirSync(tempDir);
                const currentFiles = [
                    path.basename(videoPath),
                    musicFile ? path.basename(musicFile.path) : null
                ].filter(Boolean);

                console.log('🧹 Limpiando archivos temporales antiguos...');
                for (const file of files) {
                    if (!currentFiles.includes(file)) {
                        try {
                            const filePath = path.join(tempDir, file);
                            // Solo borrar si es un archivo (no directorios)
                            if (fs.lstatSync(filePath).isFile()) {
                                fs.unlinkSync(filePath);
                            }
                        } catch (err) {
                            console.error(`⚠️ No se pudo borrar ${file}:`, err.message);
                        }
                    }
                }
            }
        } catch (cleanupError) {
            console.error('Error durante la limpieza de temp:', cleanupError);
        }

        // Usar carpeta pública para outputs, con el nombre del video
        const outputDir = path.join(globalOutputDir, videoName);
        
        // Crear directorio si no existe (recursive: true asegura que cree outputs/ si falta)
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        
        // Save the video to outputDir if it's a new upload (not a retry)
        if (!req.body.retryVideoName) {
            const ext = path.extname(videoPath);
            const savedVideoPath = path.join(outputDir, `original_video${ext}`);
            // Copy instead of move to keep temp file logic simple (multer cleans up? actually we clean up manually above)
            // But we want to persist it.
            try {
                fs.copyFileSync(videoPath, savedVideoPath);
                console.log(`💾 Video saved for retry: ${savedVideoPath}`);
            } catch (e) {
                console.error("Error saving backup video:", e);
            }
        }
        
        console.log(`📂 Directorio de salida: ${outputDir}`);

        sendStatus('Video subido. Iniciando procesamiento...', 10);

        // 1. Extract Audio
        const audioPath = path.join(outputDir, 'original_audio.mp3');
        
        if (fs.existsSync(audioPath)) {
            console.log('✅ Audio original ya existe, saltando extracción.');
            sendStatus('Audio original encontrado, saltando extracción...', 20);
        } else {
            sendStatus('Extrayendo audio...', 20);
            await new Promise((resolve, reject) => {
                const ffmpeg = spawn('ffmpeg', ['-y', '-i', videoPath, '-vn', '-acodec', 'libmp3lame', audioPath]);
                
                ffmpeg.on('error', (err) => {
                    if (err.code === 'ENOENT') {
                        reject(new Error('CRÍTICO: FFmpeg no está instalado o no se encuentra en el PATH. Por favor instala FFmpeg.'));
                    } else {
                        reject(err);
                    }
                });

                ffmpeg.on('close', (code) => {
                    if (code === 0) resolve();
                    else reject(new Error('FFmpeg error extracting audio'));
                });
            });
        }

        // Get Video Duration
        let videoDuration = 0;
        await new Promise((resolve, reject) => {
             const ffprobe = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', videoPath]);
             let output = '';
             ffprobe.stdout.on('data', (data) => output += data.toString());
             ffprobe.on('close', (code) => {
                 if (code === 0) {
                     videoDuration = parseFloat(output);
                     resolve();
                 } else reject(new Error('FFprobe error'));
             });
        });

        // 2. Transcribe Audio (CON BYPASS MANUAL)
        let transcriptionResult = null;
        let sectionData = [];
        let isMultiSection = false;
        let markers = [];
        let transcriptionJsonPath = path.join(outputDir, 'transcription.json');
        let bypassSuccessful = false;
        let originalText = '';
        if (req.body.promoTexts && req.body.promoStartTimes) {
            console.log('? Textos manuales detectados. Omitiendo Whisper...');
            sendStatus('Textos manuales detectados. Preparando secciones...', 30);
            try {
                const manualTexts = JSON.parse(req.body.promoTexts);
                const times = JSON.parse(req.body.promoStartTimes);
                let tempMarkers = [];
                if (Array.isArray(times)) {
                     times.forEach(t => {
                         let val = 0;
                         const valStr = t.toString().trim();
                         if (valStr.includes(':')) {
                             const parts = valStr.split(':');
                             if (parts.length === 2) val = parseInt(parts[0]) * 60 + parseFloat(parts[1]);
                         } else {
                             val = parseFloat(valStr);
                         }
                         if (!isNaN(val) && val > 0 && val < videoDuration) tempMarkers.push(val);
                     });
                }
                tempMarkers = [...new Set(tempMarkers)].sort((a, b) => a - b);
                if (manualTexts.length > 0 && manualTexts.length === tempMarkers.length + 1) {
                    const intervals = [0, ...tempMarkers, videoDuration];
                    for (let i = 0; i < intervals.length - 1; i++) {
                        sectionData.push({
                            index: i,
                            start: intervals[i],
                            end: intervals[i+1],
                            duration: intervals[i+1] - intervals[i],
                            segments: [], // not used in bypass phase
                            text: (() => {
                                let raw = manualTexts[i];
                                let match = raw.match(/CONTENIDO DEL GUI[^\n]*\n/i);
                                if (match) {
                                    let cleanText = raw.substring(match.index + match[0].length).trim();
                                    let footerMatch = cleanText.match(/={10,}/);
                                    if (footerMatch) {
                                        return cleanText.substring(0, footerMatch.index).trim();
                                    }
                                    return cleanText;
                                }
                                return raw.trim();
                            })()
                        });
                    }
                    isMultiSection = true;
                    bypassSuccessful = true;
                    originalText = sectionData.map(s => s.text).join('\n\n');
                    transcriptionResult = { transcript: originalText, segments: [] };
                    markers = tempMarkers; // Set global markers
                    console.log('?? Secciones creadas desde textos manuales ('+sectionData.length+').');
                    sendStatus('Transcripci�n manual completada. Traduciendo...', 50);
                    try {
                      fs.writeFileSync(transcriptionJsonPath, JSON.stringify(transcriptionResult, null, 2));
                    } catch(jsonErr) {}
                } else {
                    console.warn('?? Fallo en pareo: ' + manualTexts.length + ' textos vs ' + tempMarkers.length + ' cortes. Volviendo a Whisper...');
                }
            } catch(e) {
                console.error('Error al parear textos manuales:', e);
            }
        }
        if (!bypassSuccessful) {
        // --- WHISPER ORIGINAL --- 
// (Whisper Fallback)
        /* let transcriptionResult = null; */
        /* const transcriptionJsonPath ... */

        if (fs.existsSync(transcriptionJsonPath)) {
            console.log('✅ Transcripción ya existe, cargando...');
            sendStatus('Transcripción encontrada, cargando...', 30);
            try {
                transcriptionResult = JSON.parse(fs.readFileSync(transcriptionJsonPath, 'utf8'));
            } catch (e) {
                console.error('Error leyendo transcripción existente, re-transcribiendo...');
            }
        }

        if (!transcriptionResult) {
            sendStatus('Transcribiendo audio...', 30);
            
            const transcriptionScript = `
# -*- coding: utf-8 -*-
import sys
import json
import os
sys.path.append('${process.cwd().replace(/\\/g, '/')}')
from whisper_local import whisper_local

# Configurar codificación UTF-8 para Windows
if sys.platform == 'win32':
    import codecs
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.detach())
    sys.stderr = codecs.getwriter('utf-8')(sys.stderr.detach())

def transcribe():
    try:
        if not whisper_local.is_loaded:
            whisper_local.load_model('medium')
        
        result = whisper_local.transcribe_audio(r'${audioPath.replace(/\\/g, '/')}')
        print("---JSON_START---")
        print(json.dumps(result))
        print("---JSON_END---")
    except Exception as e:
        print("---JSON_START---")
        print(json.dumps({'error': str(e)}))
        print("---JSON_END---")

if __name__ == "__main__":
    transcribe()
`;
            const scriptPath = path.join(outputDir, 'transcribe_temp.py');
            fs.writeFileSync(scriptPath, transcriptionScript);

            // Función auxiliar para ejecutar Python con reintentos (python -> py)
            const runPythonScript = async () => {
                let cmd, args;
                try {
                    const detected = await detectPythonCommand();
                    cmd = detected.cmd;
                    args = detected.args;
                } catch (e) {
                    // Fallback
                    cmd = process.platform === 'win32' ? 'py' : 'python3';
                    args = [];
                }

                return await new Promise((resolve, reject) => {
                    const proc = spawn(cmd, [...args, scriptPath]);
                    let out = '', err = '';
                    proc.stdout.on('data', d => out += d);
                    proc.stderr.on('data', d => err += d);
                    proc.on('error', e => reject(e));
                    proc.on('close', code => {
                        if (code === 0) resolve(out);
                        else reject(new Error(err || `Exit code ${code}`));
                    });
                });
            };

            transcriptionResult = await runPythonScript().then(output => {
                try {
                    const jsonStart = output.indexOf("---JSON_START---");
                    const jsonEnd = output.indexOf("---JSON_END---");
                    
                    if (jsonStart !== -1 && jsonEnd !== -1) {
                        const jsonStr = output.substring(jsonStart + 16, jsonEnd).trim();
                        const json = JSON.parse(jsonStr);
                        if (json.error) throw new Error(json.error);
                        return json;
                    } else {
                        // Fallback
                        const lines = output.trim().split('\n');
                        const lastLine = lines[lines.length - 1];
                        try {
                            const json = JSON.parse(lastLine);
                            if (json.error) throw new Error(json.error);
                            return json;
                        } catch (e) {
                            throw new Error('Invalid JSON from transcription: ' + output);
                        }
                    }
                } catch (e) {
                    throw new Error('Invalid JSON from transcription: ' + output);
                }
            });
            
            // Guardar transcripción para futuro uso
            fs.writeFileSync(transcriptionJsonPath, JSON.stringify(transcriptionResult, null, 2));
        }

        originalText = transcriptionResult.transcript;
        if (!originalText) {
            throw new Error('La transcripción del audio falló o devolvió texto vacío.');
        }

        // --- MULTI-SECTION SYNC LOGIC ---
        /* let sectionData = []; */ // Array objects: { text: "...", duration: 123, index: 0, segments: [] }
        /* let isMultiSection = false; */
        /* let markers = []; */

        // Parse markers
        if (req.body.promoStartTimes) {
            try {
                const times = JSON.parse(req.body.promoStartTimes);
                if (Array.isArray(times)) {
                     times.forEach(t => {
                         let val = 0;
                         const valStr = t.toString().trim();
                         if (valStr.includes(':')) {
                             const parts = valStr.split(':');
                             if (parts.length === 2) val = parseInt(parts[0]) * 60 + parseFloat(parts[1]);
                         } else {
                             val = parseFloat(valStr);
                         }
                         if (!isNaN(val) && val > 0 && val < videoDuration) markers.push(val);
                     });
                }
            } catch (e) {
                console.error("Error parsing promoStartTimes:", e);
            }
        } 
        // Backward compatibility
        else if (req.body.promoStartTime) {
             let val = 0;
             const valStr = req.body.promoStartTime.toString().trim();
             if (valStr.includes(':')) {
                 const parts = valStr.split(':');
                 if (parts.length === 2) val = parseInt(parts[0]) * 60 + parseFloat(parts[1]);
             } else {
                 val = parseFloat(valStr);
             }
             if (!isNaN(val) && val > 0 && val < videoDuration) markers.push(val);
        }
        
        // Sort and deduplicate
        markers = [...new Set(markers)].sort((a, b) => a - b);
        
        if (markers.length > 0 && transcriptionResult.segments && transcriptionResult.segments.length > 0) {
            console.log(`⏱️ Multi-Section Sync habilitado con ${markers.length} cortes: [${markers.join(', ')}] segs`);
            
            // Definir intervalos: [0, m1], [m1, m2], ..., [mk, duration]
            const intervals = [0, ...markers, videoDuration];
            
            // Crear secciones
            for (let i = 0; i < intervals.length - 1; i++) {
                sectionData.push({
                    index: i,
                    start: intervals[i],
                    end: intervals[i+1],
                    duration: intervals[i+1] - intervals[i],
                    segments: [],
                    text: ""
                });
            }
            
            // Asignar segmentos a secciones
            // Estrategia: Asignar segmento a la sección donde TENGA MAYOR SUPERPOSICIÓN o donde termine
            let currentSectionIndex = 0;
            
            for (const seg of transcriptionResult.segments) {
                // Encontrar a qué sección pertenece este segmento
                // Simple: Si seg.end <= section.end, pertenece a esta sección (o anteriores)
                // O check overlap logic
                
                // Avanzar currentSectionIndex si el segmento empieza después del final de la actual
                while (currentSectionIndex < sectionData.length - 1 && seg.start >= sectionData[currentSectionIndex].end) {
                    currentSectionIndex++;
                }
                
                // Caso borde: transiciones. Si el segmento cruza el límite.
                // Usamos el punto medio del segmento para decidir
                const segMid = (seg.start + seg.end) / 2;
                
                // Verificar si mid point está dentro del rango de la sección actual
                let assignedIndex = currentSectionIndex;
                
                // Refinamiento: Buscar la sección que contenga el midpoint
                for(let j=0; j<sectionData.length; j++) {
                     if (segMid >= sectionData[j].start && segMid < sectionData[j].end) {
                         assignedIndex = j;
                         break;
                     }
                }
                
                sectionData[assignedIndex].segments.push(seg);
            }
            
            // Construir texto y validar
            let validSections = 0;
            sectionData.forEach(sec => {
                sec.text = sec.segments.map(s => s.text).join(" ").trim();
                if (sec.text) validSections++;
            });
            
            if (validSections === sectionData.length) {
                isMultiSection = true;
                console.log(`✂️ Transcripción dividida en ${sectionData.length} secciones exitosamente.`);
                sectionData.forEach(s => console.log(`  - Sección ${s.index + 1}: ${s.duration.toFixed(2)}s (${s.segments.length} segmentos)`));
            } else {
                console.warn("⚠️ Alguna sección quedó vacía. Usando modo normal (sin cortes).");
                isMultiSection = false;
            }
        }

        sendStatus('Transcripción completada. Traduciendo...', 50);

        } // FIN DEL BYPASS MANUAL

        // 3. Translate and Generate Audio
        let languages = ['es', 'en', 'fr', 'de', 'pt', 'it', 'ru', 'zh', 'ko', 'ja']; 

        if (req.body.targetLanguages) {
            try {
                const userLangs = JSON.parse(req.body.targetLanguages);
                if (Array.isArray(userLangs)) {
                    languages = userLangs;
                }
            } catch (e) {
                console.error("Error parsing targetLanguages for video translation:", e);
            }
        }

        const langNames = {
            'es': 'Spanish', 'en': 'English', 'fr': 'French', 'de': 'German', 
            'pt': 'Portuguese', 'it': 'Italian', 'ru': 'Russian',
            'zh': 'Chinese', 'ko': 'Korean', 'ja': 'Japanese'
        };
        
        // Mapa de voces TTS para cada idioma (Edge TTS)
        const voiceMap = {
            'es': 'es-ES-AlvaroNeural',
            'en': 'en-US-ChristopherNeural',
            'fr': 'fr-FR-HenriNeural',
            'de': 'de-DE-ConradNeural',
            'pt': 'pt-BR-AntonioNeural',
            'it': 'it-IT-DiegoNeural',
            'ru': 'ru-RU-DmitryNeural',
            'zh': 'zh-CN-YunxiNeural',
            'ko': 'ko-KR-InJoonNeural',
            'ja': 'ja-JP-KeitaNeural'
        };

        let progress = 50;
        const progressStep = 40 / languages.length;

        for (const lang of languages) {
            const finalAudioPath = path.join(outputDir, `${langNames[lang]}.wav`);
            
            if (fs.existsSync(finalAudioPath)) {
                console.log(`✅ Audio final para ${langNames[lang]} ya existe, saltando.`);
                sendStatus(`Audio para ${langNames[lang]} ya existe, saltando...`, progress + progressStep);
                progress += progressStep;
                continue;
            }

            sendStatus(`Traduciendo a ${langNames[lang]}...`, progress);
            
            let translatedText = "";
            const scriptPath = path.join(outputDir, `script_${lang}.txt`);

            // --- MULTI-SECTION SYNC ENABLED ---
            let audioAlreadyGenerated = false;

            if (isMultiSection && sectionData.length > 0) {
                console.log(`🔀 Modo Multi-Section Sync para ${langNames[lang]}`);
                const sectionAudioPaths = [];
                const translatedSections = [];


                // Helper para TTS
                const ttsProvider = req.body.ttsProvider || 'applio';
                const googleVoice = req.body.googleVoice || 'Kore';
                const isGoogle = ttsProvider === 'google' || ttsProvider === 'google_pro';
                
                const generatePartTTS = async (txt, outPath, sectionIndex) => {
                         if (!txt || txt === 'undefined' || !txt.trim()) return false;
                         if (isGoogle) {
                             const isPro = ttsProvider === 'google_pro';
                             const ttsModelName = isPro ? GEMINI_TTS_MODEL_PRO : GEMINI_TTS_MODEL_FLASH;
                             // Usamos disableParagraphSplitting = true para que genere un solo audio por sección (marca)
                             const keepTemp = req.body.keepTempFiles === 'true';
                             // Add a unique ID for this section to prevent temp file collisions
                             const sectionUniqueId = `sec${sectionIndex}`;
                             await generateGoogleTTSWithSplitting(txt, outPath, lang, googleVoice, ttsModelName, req.body.randomVoice === 'true', true, keepTemp, sectionUniqueId);
                             return true;
                         } else {
                             // Applio en Modo Múltiples Secciones
                             let isConnected = false;
                             try { isConnected = await applioClient.checkConnection(); } catch(e) {}
                             if (!isConnected) {
                                 console.log("⚠️ Applio no está conectado, intentando iniciar...");
                                 try { await startApplio(); await new Promise(r => setTimeout(r, 5000)); } catch(e) {}
                             }
                             const ttsModel = voiceMap[lang] || 'en-US-ChristopherNeural';
                             const userApplioVoice = req.body.applioVoice || 'RemyOriginal.pth';
                             await applioClient.textToSpeech(txt, outPath, {
                                 model: ttsModel,
                                 voicePath: userApplioVoice,
                                 speed: 0,
                                 pitch:0
                             });
                             return true;
                         }
                };

                // Helper para Ajustar Velocidad
                const adjustSpeed = async (inPath, outPath, targetDuration) => {
                         let currentDur = 0;
                         // Get Duration
                         await new Promise(r => {
                            const p = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', inPath]);
                            let o = ''; p.stdout.on('data', d => o += d); p.on('close', () => { currentDur = parseFloat(o); r(); });
                         });
                         
                         if(currentDur <= 0 || isNaN(currentDur)) {
                             // Si falló el TTS o audio vacío, crear silencio
                             await new Promise(r => { spawn('ffmpeg', ['-y', '-f', 'lavfi', '-i', `anullsrc=r=24000:cl=mono`, '-t', targetDuration, outPath]).on('close', r); });
                             return;
                         }

                         const speedFactor = currentDur / targetDuration;
                         let filters = [];
                         let s = speedFactor;
                         // Split extreme speed changes
                         while (s > 2.0) { filters.push('atempo=2.0'); s /= 2.0; }
                         while (s < 0.5) { filters.push('atempo=0.5'); s /= 0.5; }
                         filters.push(`atempo=${s}`);
                         
                         // Aplicar filtro
                         await new Promise((resolve, reject) => {
                            const args = ['-y', '-i', inPath, '-af', filters.join(','), outPath];
                            const p = spawn('ffmpeg', args);
                            p.on('close', c => c===0?resolve():reject(new Error('FFmpeg speed adjust failed')));
                         });
                };

                try {
                    // FASE 1: Generar todos los Textos (Traducción)
                    console.log(`📝 Fase 1: Generando/Cargando textos para ${sectionData.length} secciones (${langNames[lang]})...`);
                    
                    for(let i=0; i<sectionData.length; i++) {
                        const sec = sectionData[i];
                        const secScriptPath = path.join(outputDir, `script_${lang}_part_${i}.txt`);
                        
                        let secText = "";
                        
                        if (fs.existsSync(secScriptPath)) {
                            secText = fs.readFileSync(secScriptPath, 'utf8');
                        } else if (sec.text && sec.text.trim()) {
                            
                            let specialInstruction = "";
                            // Lógica para estilo podcast/conversacional
                            const isPodcastStyle = req.body.podcastStyle === 'true';
                            if (isPodcastStyle) {
                                specialInstruction += `
                                STYLE AND TONE (CRITICAL):
                                - Conversational and casual, but informative.
                                - Include natural speech elements: "um", "uh", brief pauses.
                                - Use conversational fillers: "you know", "I mean", "it's like" (translated naturally to target language).
                                - Include some light laughter indicators where appropriate (e.g., "haha", "hehe") but don't overdo it.
                                - Make it sound like a REAL PODCAST TRANSCRIPT, not a read script.
                                
                                DISFLUENCIES AND NATURALNESS (VERY IMPORTANT):
                                - Include natural pauses indicated by "..."
                                - Add occasional filler words appropriate for ${langNames[lang]}.
                                - Allow sentences to have slight restarts or hesitation.
                                
                                LENGTH CONSTRAINT:
                                - Keep the total word count similar to the original. Do not make it significantly longer.
                                `;
                            }

                            // Prompt de traducción
                            const prompt = `
                            Translate the following video script content to ${langNames[lang]}.
                            ${specialInstruction}
                            Maintain the tone, style, and formatting.
                            OUTPUT ONLY THE TRANSLATED TEXT.
                            
                            SCRIPT PART ${i+1}/${sectionData.length}:
                            ${sec.text}
                            `;
                            
                            // Reintentos con backoff exponencial y cambio de estrategia
                            let retries = 3;
                            
                            while(retries > 0) {
                                try {
                                    // Determinar si debemos forzar el uso de la key primaria en el último intento
                                    const forcePrimary = (retries === 1); 
                                    
                                    const { model } = await getGoogleAI(GEMINI_TEXT_MODEL, { 
                                        context: 'llm',
                                        forcePrimary: forcePrimary
                                    });
                                    
                                    const result = await model.generateContent(prompt);
                                    let txt = result.response.text();
                                    txt = txt.replace(/```[\s\S]*?```/g, '').trim();
                                    if (!txt) txt = result.response.text();
                                    secText = txt;
                                    fs.writeFileSync(secScriptPath, secText);
                                    break;
                                } catch (err) {
                                    console.warn(`⚠️ Error en traducción sección ${i+1} (intento ${4-retries}/3): ${err.message}`);
                                    
                                    const isRateLimit = err.message.includes('429') || (err.status === 429) || 
                                                       err.message.includes('Too Many Requests') || 
                                                       err.message.includes('Quota exceeded');

                                    retries--;
                                    if(retries === 0) throw err;
                                    
                                    // Esperar antes de reintentar (backoff: 2s, 5s)
                                    const delay = (3 - retries) * 2000 + 1000;
                                    console.log(`⏳ Esperando ${delay}ms antes del reintento...`);
                                    await new Promise(r => setTimeout(r, delay));
                                }
                            }
                        }
                        
                        translatedSections.push(secText);
                        sendStatus(`Texto traducido sección ${i+1}/${sectionData.length} para ${langNames[lang]}...`, progress);
                    }

                    // FASE 2: Generación de Audio en Paralelo (Max 3)
                    console.log(`🔊 Fase 2: Generando audios en paralelo (Max 3 threads) para ${langNames[lang]}...`);
                    
                    // Preparamos array del tamaño correcto para mantener orden
                    const processedAudioPaths = new Array(sectionData.length);
                    
                    // Función constructora de tareas
                    const createTask = (index) => async () => {
                        const i = index;
                        const secText = translatedSections[i];
                        const sec = sectionData[i];
                        const secAudioPath = path.join(outputDir, `audio_${lang}_part_${i}.wav`);
                        const secAudioAdjPath = path.join(outputDir, `audio_${lang}_part_${i}_adj.wav`);
                        
                        try {
                            // SKIP IF EXISTS
                            if (fs.existsSync(secAudioAdjPath)) {
                                console.log(`⏩ Audio sección ${i+1}/${sectionData.length} ya existe (${secAudioAdjPath}). Saltando generación.`);
                                processedAudioPaths[i] = secAudioAdjPath;
                                sendStatus(`Audio ya existe para sección ${i+1}/${sectionData.length} (${langNames[lang]})...`, progress);
                                return;
                            }

                            // Generar Audio si hay texto
                            // Aplicamos reintentos también al audio
                            let audioRetries = 2;
                            let hasAudio = false;
                            

                            while(audioRetries > 0) {
                                try {
                                    hasAudio = await generatePartTTS(secText, secAudioPath, i);
                                    break;
                                } catch(e) {
                                    console.warn(`⚠️ Error generando audio para sección ${i+1}, reintentando...`);
                                    audioRetries--;
                                    if(audioRetries===0) throw e;
                                    await new Promise(r => setTimeout(r, 2000));
                                }
                            }
                            
                            // Ajustar Duración
                            let targetDuration = sec.duration;

                            const isShortVid = req.body.isShortVideo === 'true';
                            const silencePad = isShortVid ? 0 : 20;

                            // Corrección: Si distribuimos el silencio en TODAS las secciones, los cortes 
                            // que el usuario marcó manualmente se van recorriendo hacia atrás (desincronizando).
                            // Por lo tanto, SI hay silencio, y estamos en el modo de tiempos explícitos,
                            // o en general para mantener la sincronía, debemos descontar los 20s 
                            // ÚNICAMENTE de la ÚLTIMA sección (o si no cabe, ajustarla a un mínimo).
                            if (silencePad > 0 && i === sectionData.length - 1) {
                                targetDuration = Math.max(1, targetDuration - silencePad);
                            }

                            if (hasAudio && fs.existsSync(secAudioPath)) {
                                 await adjustSpeed(secAudioPath, secAudioAdjPath, targetDuration);
                                 processedAudioPaths[i] = secAudioAdjPath;
                            } else {
                                 // Generar silencio
                                 await new Promise(r => { spawn('ffmpeg', ['-y', '-f', 'lavfi', '-i', `anullsrc=r=24000:cl=mono`, '-t', targetDuration, secAudioAdjPath]).on('close', r); });
                                 processedAudioPaths[i] = secAudioAdjPath;
                            }
                            
                            sendStatus(`Audio generado sección ${i+1}/${sectionData.length} para ${langNames[lang]}...`, progress);
                        } catch (err) {
                            console.error(`Error generando audio sección ${i}:`, err);
                            throw err; 
                        }
                    };

                    // Ejecutar en lotes de 3
                    const audioTasks = sectionData.map((_, i) => createTask(i));
                    const BATCH_SIZE = 3;
                    
                    for (let i = 0; i < audioTasks.length; i += BATCH_SIZE) {
                        const batch = audioTasks.slice(i, i + BATCH_SIZE);
                        await Promise.all(batch.map(task => task()));
                    }
                    
                    // Asignar al array final en orden
                    processedAudioPaths.forEach(p => sectionAudioPaths.push(p));

                    // 4. Combinar Audio Final
                    translatedText = translatedSections.join("\n\n");
                    fs.writeFileSync(scriptPath, translatedText);
                    
                    const audioOutputPath = path.join(outputDir, `audio_${lang}.wav`);
                    
                    // ffmpeg concat filter
                    // inputs: sectionAudioPaths
                    const inputs = sectionAudioPaths.flatMap(p => ['-i', p]);
                    const filter = sectionAudioPaths.map((_, i) => `[${i}:a]`).join('') + `concat=n=${sectionAudioPaths.length}:v=0:a=1[out]`;
                      await new Promise((resolve, reject) => {
                           const args = ['-y', ...inputs, '-filter_complex', filter, '-map', '[out]', audioOutputPath];
                           const p = spawn('ffmpeg', args);
                           p.on('close', c=>c===0?resolve():reject(new Error('Concat failed')));
                      });

                      const isShortVideo = req.body.isShortVideo === 'true';
                      if (!isShortVideo) {
                           const tempOutputPath = audioOutputPath.replace('.wav', '_temp.wav');
                           await new Promise((resolve, reject) => {
                               console.log(`🔇 Agregando 20 segundos de silencio al final del audio concatenado (${lang})...`);
                               const silencePath = path.join(outputDir, `silence_${lang}.wav`);
                               const p1 = spawn('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', '20', silencePath]);
                               p1.on('close', (c1) => {
                                   if(c1!==0) { reject(new Error('Silence gen failed')); return; }
                                   const p2 = spawn('ffmpeg', ['-y', '-i', audioOutputPath, '-i', silencePath, '-filter_complex', '[0:a][1:a]concat=n=2:v=0:a=1', tempOutputPath]);
                                   p2.on('close', (c2) => {
                                       try { fs.unlinkSync(silencePath); } catch(e){}
                                       if (c2 === 0 && fs.existsSync(tempOutputPath)) {
                                           try { fs.unlinkSync(audioOutputPath); } catch(e){}
                                           fs.renameSync(tempOutputPath, audioOutputPath);
                                           resolve();
                                       } else {
                                           reject(new Error('Final padding concat failed'));
                                       }
                                   });
                               });
                           });
                      }


                    console.log(`✅ Audio multi-sección generado para ${lang}: ${audioOutputPath}`);
                    audioAlreadyGenerated = true; // Flag to skip legacy generation
                    



                } catch (errSpl) {
                    console.error("Error en Multi-Section Sync:", errSpl);
                    throw errSpl;
                }
            } else if (fs.existsSync(scriptPath)) {
                console.log(`✅ Guión traducido para ${langNames[lang]} ya existe, cargando.`);
                translatedText = fs.readFileSync(scriptPath, 'utf8');
            } else {
                let specialInstruction = "";

                // Ruso, Coreano y Alemán: Reducir 30% de los párrafos aleatoriamente (3 de cada 10)
                if (['de', 'ko', 'ru'].includes(lang)) {
                    specialInstruction = `
                    IMPORTANT DURATION CONTROL:
                    1. Analyze the paragraphs in the script.
                    2. Randomly select approximately 30% of the paragraphs (e.g., 3 out of every 10).
                    3. For these selected paragraphs ONLY, condense the translation by about 20% (remove filler words, be concise).
                    4. Translate the remaining paragraphs faithfully.
                    5. Maintain the exact same number of paragraphs as the original.
                    `;
                }
                

                // Lógica para estilo podcast/conversacional
                const isPodcastStyle = req.body.podcastStyle === 'true';
                if (isPodcastStyle) {
                    specialInstruction += `
                    STYLE AND TONE (CRITICAL):
                    - Conversational and casual, but informative.
                    - Include natural speech elements: "um", "uh", brief pauses.
                    - Use conversational fillers: "you know", "I mean", "it's like" (translated naturally to target language).
                    - Include some light laughter indicators where appropriate (e.g., "haha", "hehe") but don't overdo it.
                    - Make it sound like a REAL PODCAST TRANSCRIPT, not a read script.
                    
                    DISFLUENCIES AND NATURALNESS (VERY IMPORTANT):
                    - Include natural pauses indicated by "..."
                    - Add occasional filler words appropriate for ${langNames[lang]}.
                    - Allow sentences to have slight restarts or hesitation.
                    
                    LENGTH CONSTRAINT:
                    - Keep the total word count similar to the original. Do not make it significantly longer.
                    `;
                }

                // Translate
                const prompt = `
                Translate the following video script content to ${langNames[lang]}.
                ${specialInstruction}
                Maintain the tone, style, and formatting.
                OUTPUT ONLY THE TRANSLATED TEXT.
                
                SCRIPT:
                ${originalText}
                `;
                
                let result;
                try {
                    // Seleccionar modelo (default a 3.0 si no se especifica)
                    const selectedModel = req.body.translationModel || GEMINI_TEXT_MODEL;
                    console.log(`🤖 Usando modelo de traducción: ${selectedModel}`);
                    
                    const { model } = await getGoogleAI(selectedModel, { context: 'llm' });
                    result = await model.generateContent(prompt);
                } catch (error) {
                    const isRateLimit = error.message.includes('429') || (error.status === 429) || error.message.includes('Too Many Requests') || error.message.includes('Quota exceeded');
                    const isOverloaded = error.message.includes('503') || (error.status === 503) || error.message.includes('overloaded') || error.message.includes('Overloaded');
                    
                    if (isRateLimit || isOverloaded) {
                        console.warn(`⚠️ API gratuita ${isRateLimit ? 'saturada (429)' : 'sobrecargada (503)'} durante traducción. Reintentando con API PRINCIPAL...`);
                        
                        // Forzar uso de API principal con el modelo seleccionado (o fallback a 3.0)
                        const selectedModel = req.body.translationModel || GEMINI_TEXT_MODEL;
                        
                        try {
                            const { model } = await getGoogleAI(selectedModel, { context: 'llm', forcePrimary: true });
                            result = await model.generateContent(prompt);
                        } catch (primaryError) {
                            const isPrimaryOverloaded = primaryError.message.includes('503') || (primaryError.status === 503) || primaryError.message.includes('overloaded') || primaryError.message.includes('Overloaded');
                            
                            // Si falla la API principal con 503 y estabamos usando flash 3, intentar fallback a 2.5
                            if (isPrimaryOverloaded && selectedModel === GEMINI_TEXT_MODEL) {
                                console.warn(`⚠️ Gemini 3 Flash saturado incluso en API PRINCIPAL (503). Intentando fallback a Gemini 2.5 Flash...`);
                                const { model: fallbackModel } = await getGoogleAI("gemini-3.1-flash-lite-preview", { context: 'llm', forcePrimary: true });
                                result = await fallbackModel.generateContent(prompt);
                            } else {
                                throw primaryError;
                            }
                        }
                    } else {
                        throw error; // Re-lanzar si no es error de cuota
                    }
                }

                translatedText = result.response.text();
                
                // Limpiar posibles bloques de código markdown
                translatedText = translatedText.replace(/```[\s\S]*?```/g, '').trim();
                if (!translatedText) translatedText = result.response.text(); // Fallback si se borró todo

                // Save translated text
                fs.writeFileSync(scriptPath, translatedText);
            }

            // Check TTS Provider
            const ttsProvider = req.body.ttsProvider || 'applio';
            const googleVoice = req.body.googleVoice || 'Kore';

            if (ttsProvider === 'text_only') {
                progress += progressStep;
                sendStatus(`Texto traducido para ${langNames[lang]} guardado.`, progress);
                continue; // Skip audio generation logic
            }
            
            // Generate Audio logic (only if NOT promo split enabled, because promo split logic handles its own TTS)
            const audioOutputPath = path.join(outputDir, `audio_${lang}.wav`);

            if (!isMultiSection && !audioAlreadyGenerated) {
                // --- NORMAL TTS LOGIC ---
                sendStatus(`Generando audio para ${langNames[lang]}...`, progress + (progressStep / 2));

                if (ttsProvider === 'google' || ttsProvider === 'google_pro') {
                    const isPro = ttsProvider === 'google_pro';
                    const ttsModelName = isPro ? GEMINI_TTS_MODEL_PRO : GEMINI_TTS_MODEL_FLASH;
                    const randomVoice = req.body.randomVoice === 'true'; // Get flag from request
                    
                    if (!translatedText || translatedText === 'undefined') {
                        throw new Error(`Error en la traducción a ${langNames[lang]}: Texto vacío o inválido.`);
                    }
                    
                    sendStatus(`Generando audio con Google TTS (${randomVoice ? 'Voces Mixtas' : googleVoice} - ${ttsModelName}) para ${langNames[lang]}...`, progress + (progressStep / 2));
                    try {
                        // Siempre usar splitting, incluso para Pro (para mantener consistencia y evitar timeouts en textos muy largos)
                        await generateGoogleTTSWithSplitting(translatedText, audioOutputPath, lang, googleVoice, ttsModelName, randomVoice);
                    } catch (err) {
                        console.error(`Error Google TTS for ${lang}:`, err);
                        
                        // Check for Rate Limit Error
                        const isRateLimit = err.message.includes('429') || (err.status === 429) || err.message.includes('Quota exceeded') || err.message.includes('RESOURCE_EXHAUSTED');
                        
                        if (isRateLimit) {
                            sendStatus(`⚠️ Cuota de API agotada para ${langNames[lang]}. Esperando 5 minutos...`, progress, false, "RATE_LIMIT_EXCEEDED");
                            throw new Error(`RATE_LIMIT_EXCEEDED: Se han agotado las cuotas de API para ${langNames[lang]}. Por favor espera unos minutos y vuelve a intentar.`);
                        }
                        
                        throw new Error(`Error generando audio con Google TTS para ${lang}: ${err.message}`);
                    }
                } else {
                    // Applio Logic
                    const ttsModel = voiceMap[lang] || 'en-US-ChristopherNeural';
                    
                    let isConnected = false;
                    try {
                        isConnected = await applioClient.checkConnection();
                    } catch (e) {
                        isConnected = false;
                    }

                    if (!isConnected) {
                        console.log("⚠️ Applio no está conectado, intentando iniciar...");
                        sendStatus("Iniciando servidor Applio...", progress);
                        try {
                            await startApplio();
                            await new Promise(resolve => setTimeout(resolve, 5000));
                        } catch (startError) {
                            throw new Error("No se pudo iniciar Applio automáticamente: " + startError.message);
                        }
                    }

                    if (!translatedText || translatedText === 'undefined') {
                        throw new Error(`Error en la traducción a ${langNames[lang]}: Texto vacío o inválido.`);
                    }

                    const userApplioVoice = req.body.applioVoice || 'RemyOriginal.pth';

                    await applioClient.textToSpeech(translatedText, audioOutputPath, {
                        model: ttsModel,
                        voicePath: userApplioVoice,
                        speed: 0,
                        pitch: 0
                    });
                }
            } 

            // 4. Adjust Duration (Pad/Trim) with Time Stretching
            let filterString = `apad,atrim=0:${videoDuration}`; // Default fallback

            if (!isMultiSection && !audioAlreadyGenerated) {
                // --- NORMAL DURATION ADJUST MENT ---
                let ttsDuration = 0;
                try {
                    await new Promise((resolve) => {
                        const ffprobe = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', audioOutputPath]);
                        let output = '';
                        ffprobe.stdout.on('data', (data) => output += data.toString());
                        ffprobe.on('close', (code) => {
                            if (code === 0) ttsDuration = parseFloat(output);
                            resolve();
                        });
                    });
                } catch (e) {
                    console.error("Error getting TTS duration:", e);
                }

                if (ttsDuration > 0) {
                    const isShortVideo = req.body.isShortVideo === 'true';
                    const silenceDuration = isShortVideo ? 0 : 20;
                    const targetSpeechDuration = Math.max(1.0, videoDuration - silenceDuration);
                    const speedFactor = ttsDuration / targetSpeechDuration;
                    
                    let filters = [];
                    let currentSpeed = speedFactor;
                    
                    while (currentSpeed > 2.0) { filters.push('atempo=2.0'); currentSpeed /= 2.0; }
                    while (currentSpeed < 0.5) { filters.push('atempo=0.5'); currentSpeed /= 0.5; }
                    filters.push(`atempo=${currentSpeed}`);
                    
                    filterString = filters.join(',') + `,apad,atrim=0:${videoDuration}`;
                }
            } else {
                 filterString = `apad,atrim=0:${videoDuration}`;
            }
            
            await new Promise((resolve, reject) => {
                let ffmpegArgs = [];
                
                if (musicFile) {
                                        if (isMultiSection || audioAlreadyGenerated) {
                        ffmpegArgs = [
                            '-y',
                            '-i', audioOutputPath,
                            '-stream_loop', '-1', '-i', musicFile.path,
                            '-filter_complex', `[0:a]aresample=48000[speech];[1:a]aresample=48000,volume=0.7[bgm];[speech][bgm]amix=inputs=2:duration=first:dropout_transition=2:normalize=0,volume=2[out]`,
                            '-map', '[out]',
                            '-acodec', 'pcm_s16le',
                            finalAudioPath
                        ];
                    } else {
                        ffmpegArgs = [
                            '-y',
                            '-i', audioOutputPath,
                            '-stream_loop', '-1', '-i', musicFile.path,
                            '-filter_complex', `[0:a]aresample=48000${filterString}[speech];[1:a]aresample=48000,volume=0.7[bgm];[speech][bgm]amix=inputs=2:duration=first:dropout_transition=2:normalize=0,volume=2[out]`,
                            '-map', '[out]',
                            '-acodec', 'pcm_s16le',
                            finalAudioPath
                        ];
                    }
                } else {
                    if (isMultiSection || audioAlreadyGenerated) {
                         ffmpegArgs = [
                            '-y',
                            '-i', audioOutputPath,
                             '-af', 'aresample=48000',
                            '-acodec', 'pcm_s16le',
                            finalAudioPath
                        ];
                    } else {
                        ffmpegArgs = [
                            '-y',
                            '-i', audioOutputPath,
                            '-af', `aresample=48000,${filterString}`,
                            '-acodec', 'pcm_s16le',
                            finalAudioPath
                        ];
                    }
                }

                const ffmpegCmd = spawn('ffmpeg', ffmpegArgs);
                
                let stderr = '';
                ffmpegCmd.stderr.on('data', (data) => {
                    stderr += data.toString();
                });

                ffmpegCmd.on('close', (code) => {
                    if (code === 0) {
                        resolve();
                    }
                    else {
                        console.error(`❌ FFmpeg adjust duration failed. Args: ${ffmpegArgs.join(' ')}`);
                        console.error(`❌ Stderr: ${stderr}`);
                        reject(new Error(`FFmpeg error adjusting duration: ${stderr.slice(-200)}`));
                    }
                });
            });

            progress += progressStep;
        }

        sendStatus('Proceso completado', 100, true);
        res.end();

    } catch (error) {
        console.error(error);
        sendStatus('Error: ' + error.message, null, false, error.message);
        res.end();
    }
});

// Endpoint para traducción manual de video (mezcla de audios subidos)
const manualUploadFields = [
    { name: 'video', maxCount: 1 },
    { name: 'music', maxCount: 1 },
    ...['es', 'en', 'fr', 'de', 'it', 'pt', 'ru', 'zh', 'ko', 'ja'].map(lang => ({ name: `audio_${lang}`, maxCount: 1 }))
];

app.post('/api/manual-translate-video', upload.fields(manualUploadFields), async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendStatus = (status, progress = null, completed = false, error = null) => {
        const data = JSON.stringify({ status, progress, completed, error });
        res.write(`data: ${data}\n\n`);
    };

    try {
        if (!req.files || !req.files['video']) {
            throw new Error('No se ha subido el archivo de video.');
        }

        const videoFile = req.files['video'][0];
        const videoPath = videoFile.path;
        const videoName = path.parse(videoFile.originalname).name;
        const musicFile = req.files['music'] ? req.files['music'][0] : null;

        // Directorio de salida
        const outputDir = path.join(globalOutputDir, videoName);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        // Guardar video original
        const savedVideoPath = path.join(outputDir, `original_video${path.extname(videoPath)}`);
        try {
            fs.copyFileSync(videoPath, savedVideoPath);
        } catch (e) {
            console.error("Error guardando backup de video:", e);
        }

        sendStatus('Analizando duración del video...', 10);

        // Obtener duración del video
        let videoDuration = 0;
        await new Promise((resolve, reject) => {
            const ffprobe = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', videoPath]);
            let output = '';
            ffprobe.stdout.on('data', (data) => output += data.toString());
            ffprobe.on('close', (code) => {
                if (code === 0) {
                    videoDuration = parseFloat(output);
                    resolve();
                } else reject(new Error('Error al analizar duración del video (FFprobe)'));
            });
        });

        const langs = ['en', 'fr', 'de', 'it', 'pt', 'ru', 'zh', 'ko', 'ja'];
        const foundLangs = langs.filter(lang => req.files[`audio_${lang}`]);

        if (foundLangs.length === 0) {
            throw new Error('No se encontraron archivos de audio.');
        }

        sendStatus(`Encontrados audios para: ${foundLangs.join(', ')}`, 20);

        const progressStep = 80 / foundLangs.length;
        let currentProgress = 20;

        const langNames = {
            'en': 'English', 'fr': 'French', 'de': 'German', 'it': 'Italian',
            'pt': 'Portuguese', 'ru': 'Russian', 'zh': 'Chinese', 'ko': 'Korean', 'ja': 'Japanese'
        };

        for (const lang of foundLangs) {
            const langAudioFile = req.files[`audio_${lang}`][0];
            const langAudioPath = langAudioFile.path;
            const finalName = langNames[lang] || lang;
            const finalOutputPath = path.join(outputDir, `${finalName}.wav`);

            sendStatus(`Procesando audio: ${finalName}...`, currentProgress);

            // Analizar duración del audio subido
            let audioDuration = 0;
            await new Promise((resolve) => {
                const ffprobe = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', langAudioPath]);
                let output = '';
                ffprobe.stdout.on('data', (d) => output += d);
                ffprobe.on('close', () => {
                    audioDuration = parseFloat(output) || 0;
                    resolve();
                });
            });

            // Lógica de ajuste de tiempo (igual al auto)
            let filterString = `apad,atrim=0:${videoDuration}`;
            if (audioDuration > 0) {
                const isShortVideo = req.body.isShortVideo === 'true';
                const silenceDuration = isShortVideo ? 0 : 20;
                const targetSpeechDuration = Math.max(1.0, videoDuration - silenceDuration);
                const speedFactor = audioDuration / targetSpeechDuration;

                let filters = [];
                let currentSpeed = speedFactor;
                
                while (currentSpeed > 2.0) { filters.push('atempo=2.0'); currentSpeed /= 2.0; }
                while (currentSpeed < 0.5) { filters.push('atempo=0.5'); currentSpeed /= 0.5; }
                filters.push(`atempo=${currentSpeed}`);
                
                filterString = filters.join(',') + `,apad,atrim=0:${videoDuration}`;
            }

            // FFmpeg mix
            await new Promise((resolve, reject) => {
                let ffmpegArgs = [];
                if (musicFile) {
                    ffmpegArgs = [
                        '-y',
                            '-i', audioOutputPath,
                            '-stream_loop', '-1', '-i', musicFile.path,
                            // Fix: Set bgm volume to 70%, force 48kHz, disable amix normalization, compensate volume
                            '-filter_complex', `[0:a]aresample=48000${filterString}[speech];[1:a]aresample=48000,volume=0.7[bgm];[speech][bgm]amix=inputs=2:duration=first:dropout_transition=2:normalize=0,volume=2[out]`,
                            '-map', '[out]',
                             '-acodec', 'pcm_s16le',
                            finalOutputPath
                        ];
                    } else {
                        ffmpegArgs = [
                            '-y',
                            '-i', langAudioPath,
                            '-af', `aresample=48000,${filterString}`,
                             '-acodec', 'pcm_s16le',
                    ];
                }

                const ffmpeg = spawn('ffmpeg', ffmpegArgs);
                let errLog = '';
                ffmpeg.stderr.on('data', d => errLog += d);
                ffmpeg.on('close', code => {
                    if (code === 0) resolve();
                    else reject(new Error(`Error mezclando audio ${lang}: ${errLog}`));
                });
            });

            currentProgress += progressStep;
        }

        sendStatus('Proceso completado', 100, true);
        res.end();

    } catch (error) {
        console.error("Manual Translate Error:", error);
        sendStatus('Error: ' + error.message, null, false, error.message);
        res.end();
    }
});
