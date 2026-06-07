// ==============================
// OLLAMA LOCAL LLM CLIENT
// ==============================
// Lightweight client for Ollama API (OpenAI-compatible endpoint)
// Supports text generation via local models like Gemma 3/4

const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';

class OllamaClient {
    constructor(baseUrl = DEFAULT_OLLAMA_URL) {
        this.baseUrl = baseUrl.replace(/\/$/, '');
    }

    /**
     * Check if Ollama is running and reachable
     */
    async checkConnection() {
        try {
            const resp = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
            return resp.ok;
        } catch {
            return false;
        }
    }

    /**
     * List available models
     */
    async listModels() {
        const resp = await fetch(`${this.baseUrl}/api/tags`);
        if (!resp.ok) throw new Error(`Ollama API error: ${resp.status}`);
        const data = await resp.json();
        return (data.models || []).map(m => ({
            name: m.name,
            size: m.size,
            sizeGB: (m.size / (1024 ** 3)).toFixed(1),
            modified: m.modified_at,
            family: m.details?.family || 'unknown',
            parameterSize: m.details?.parameter_size || 'unknown',
            quantization: m.details?.quantization_level || 'unknown',
        }));
    }

    /**
     * Generate text completion (non-streaming)
     * @param {string} prompt - The user prompt
     * @param {object} options
     * @param {string} options.model - Model name (e.g. 'gemma3:4b')
     * @param {string} [options.system] - System instruction
     * @param {number} [options.temperature] - Temperature (0-2)
     * @param {number} [options.maxTokens] - Max tokens in response
     * @returns {Promise<{text: string, model: string, totalDuration: number, tokensPerSecond: number}>}
     */
    async generateText(prompt, options = {}) {
        const {
            model = 'gemma3:4b',
            system = null,
            temperature = 0.7,
            maxTokens = 8192,
        } = options;

        const body = {
            model,
            prompt,
            stream: false,
            options: {
                temperature,
                num_predict: maxTokens,
                num_ctx: 32768,
            },
        };

        if (system) {
            body.system = system;
        }

        const resp = await fetch(`${this.baseUrl}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        if (!resp.ok) {
            const errText = await resp.text().catch(() => '');
            throw new Error(`Ollama error ${resp.status}: ${errText.slice(0, 300)}`);
        }

        const data = await resp.json();

        return {
            text: data.response || '',
            model: data.model,
            totalDuration: data.total_duration ? data.total_duration / 1e9 : null,
            tokensPerSecond: data.eval_count && data.eval_duration
                ? data.eval_count / (data.eval_duration / 1e9)
                : null,
        };
    }

    /** 
     * Chat-style completion (multi-turn)
     * @param {Array<{role: string, content: string}>} messages
     * @param {object} options
     * @returns {Promise<{text: string, model: string}>}
     */
    async chat(messages, options = {}) {
        const {
            model = 'gemma3:4b',
            temperature = 0.7,
            maxTokens = 8192,
        } = options;

        const resp = await fetch(`${this.baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                messages,
                stream: false,
                options: {
                    temperature,
                    num_predict: maxTokens,
                    num_ctx: 32768,
                },
            }),
        });

        if (!resp.ok) {
            const errText = await resp.text().catch(() => '');
            throw new Error(`Ollama chat error ${resp.status}: ${errText.slice(0, 300)}`);
        }

        const data = await resp.json();

        return {
            text: data.message?.content || '',
            model: data.model,
            totalDuration: data.total_duration ? data.total_duration / 1e9 : null,
            tokensPerSecond: data.eval_count && data.eval_duration
                ? data.eval_count / (data.eval_duration / 1e9)
                : null,
        };
    }

    /**
     * Pull (download) a model
     * @param {string} modelName - e.g. 'gemma3:4b'
     * @param {function} [onProgress] - callback(status, completed, total)
     */
    async pullModel(modelName, onProgress = null) {
        const resp = await fetch(`${this.baseUrl}/api/pull`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: modelName, stream: !!onProgress }),
        });

        if (!resp.ok) throw new Error(`Pull failed: ${resp.status}`);

        if (!onProgress) {
            await resp.json();
            return;
        }

        // Streaming progress
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();
            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const obj = JSON.parse(line);
                    onProgress(obj.status, obj.completed || 0, obj.total || 0);
                } catch {}
            }
        }
    }
}

export default OllamaClient;
