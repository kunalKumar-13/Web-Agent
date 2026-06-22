/**
 * LLM transport layer — provider-agnostic.
 *
 * `LlmClient` is the single seam the AI planner depends on; it just turns a
 * prompt into raw model text. Two implementations are provided:
 *   - GroqClient   → OpenAI-compatible chat/completions (default; free)
 *   - GeminiClient → Google Generative Language REST (kept as an option)
 * Both use Node's built-in `fetch` — no provider SDKs.
 */
import { AgentConfig } from '../config';

export interface LlmClient {
  /** Short provider id, e.g. "groq" or "gemini". */
  readonly name: string;
  /** Model id in use. */
  readonly model: string;
  /** Send a prompt, return the raw text the model produced. */
  complete(prompt: string): Promise<string>;
}

/** Groq via the OpenAI-compatible Chat Completions endpoint. */
export class GroqClient implements LlmClient {
  readonly name = 'groq';
  private static URL = 'https://api.groq.com/openai/v1/chat/completions';

  constructor(private apiKey: string, readonly model: string) {}

  async complete(prompt: string): Promise<string> {
    const res = await fetch(GroqClient.URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
      }),
    });
    if (!res.ok) {
      throw new Error(`Groq HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const data = (await res.json()) as OpenAiChatResponse;
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error('Groq returned no message content');
    return text;
  }
}

/** Gemini via the Google Generative Language REST endpoint. */
export class GeminiClient implements LlmClient {
  readonly name = 'gemini';
  private static BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

  constructor(private apiKey: string, readonly model: string) {}

  async complete(prompt: string): Promise<string> {
    // Auth via the x-goog-api-key header (keeps the key out of the URL/logs).
    const url = `${GeminiClient.BASE}/${this.model}:generateContent`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0 },
      }),
    });
    if (!res.ok) {
      throw new Error(`Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const data = (await res.json()) as GeminiResponse;
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Gemini returned no text candidate');
    return text;
  }
}

/** Build the configured provider's client (throws clearly if its key is missing). */
export function createLlmClient(config: AgentConfig): LlmClient {
  if (config.provider === 'gemini') {
    if (!config.geminiApiKey) {
      throw new Error('Gemini provider requires GEMINI_API_KEY in .env (or set LLM_PROVIDER=groq).');
    }
    return new GeminiClient(config.geminiApiKey, config.geminiModel);
  }
  // default: groq
  if (!config.groqApiKey) {
    throw new Error('Groq provider requires GROQ_API_KEY in .env (get a free key at https://console.groq.com).');
  }
  return new GroqClient(config.groqApiKey, config.groqModel);
}

interface OpenAiChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}
