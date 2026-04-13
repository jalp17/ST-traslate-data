import {
  buildTranslatePrompt,
  buildJsonHeaders,
  fetchJson,
  parseOpenAIResponse,
  parseGenericCompletionResponse,
} from './utils.js';

export const DEFAULT_ENDPOINTS = {
  openai: 'https://api.openai.com/v1/chat/completions',
  local_koboldcpp: 'http://127.0.0.1:5000/api/v1/generate',
  llama_cpp: 'http://127.0.0.1:8080/v1/completions',
  ollama: 'http://127.0.0.1:11434/api/completions',
  llm_studio: 'http://127.0.0.1:8080/api/v1/generate',
  openrouter: 'https://openrouter.ai/v1/chat/completions',
  electron_hub: 'http://127.0.0.1:3000/generate',
  google_aistudio: 'https://generativelanguage.googleapis.com/v1beta2/models/text-bison-001:generateText',
  google_translate: 'https://translation.googleapis.com/language/translate/v2',
};

export const DEFAULT_TRANSLATION_PROVIDER = 'openai';
export const SUPPORTED_TRANSLATION_PROVIDERS = [
  'openai',
  'local_koboldcpp',
  'llama_cpp',
  'ollama',
  'llm_studio',
  'openrouter',
  'electron_hub',
  'google_aistudio',
  'google_translate',
];

export async function translateText(text, sourceLang, targetLang, providerConfig = { provider: DEFAULT_TRANSLATION_PROVIDER }) {
  const provider = providerConfig.provider || DEFAULT_TRANSLATION_PROVIDER;

  switch (provider) {
    case 'openai':
      return translateWithOpenAI(text, sourceLang, targetLang, providerConfig);
    case 'local_koboldcpp':
      return translateWithKoboldCPP(text, sourceLang, targetLang, providerConfig);
    case 'llama_cpp':
      return translateWithLlamaCpp(text, sourceLang, targetLang, providerConfig);
    case 'ollama':
      return translateWithOllama(text, sourceLang, targetLang, providerConfig);
    case 'llm_studio':
      return translateWithLLMStudio(text, sourceLang, targetLang, providerConfig);
    case 'openrouter':
      return translateWithOpenRouter(text, sourceLang, targetLang, providerConfig);
    case 'electron_hub':
      return translateWithElectronHub(text, sourceLang, targetLang, providerConfig);
    case 'google_aistudio':
      return translateWithGoogleAIStudio(text, sourceLang, targetLang, providerConfig);
    case 'google_translate':
      return translateWithGoogleTranslate(text, sourceLang, targetLang, providerConfig);
    default:
      console.warn(`Proveedor de traducción desconocido: ${provider}. Usando OpenAI por defecto.`);
      return translateWithOpenAI(text, sourceLang, targetLang, providerConfig);
  }
}

async function translateWithOpenAI(text, sourceLang, targetLang, providerConfig) {
  const apiKey = providerConfig.apiKey;
  const apiUrl = providerConfig.apiUrl || DEFAULT_ENDPOINTS.openai;
  const model = providerConfig.model || 'gpt-3.5-turbo';
  const prompt = buildTranslatePrompt(text, sourceLang, targetLang);
  const body = {
    model,
    messages: [
      {
        role: 'system',
        content: 'Eres un traductor preciso. Conserva literales y placeholders sin cambiarlos.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
    temperature: providerConfig.temperature ?? 0.2,
    max_tokens: providerConfig.maxTokens || 1200,
  };

  const result = await fetchJson(apiUrl, {
    method: 'POST',
    headers: buildJsonHeaders(apiKey),
    body: JSON.stringify(body),
  });
  return parseOpenAIResponse(result);
}

async function translateWithKoboldCPP(text, sourceLang, targetLang, providerConfig) {
  const apiUrl = providerConfig.apiUrl || DEFAULT_ENDPOINTS.local_koboldcpp;
  const prompt = buildTranslatePrompt(text, sourceLang, targetLang);
  const body = {
    prompt,
    max_length: providerConfig.maxTokens || 1024,
    temperature: providerConfig.temperature ?? 0.2,
    top_p: providerConfig.top_p ?? 0.9,
    repetition_penalty: providerConfig.repetition_penalty ?? 1.1,
  };

  const result = await fetchJson(apiUrl, {
    method: 'POST',
    headers: buildJsonHeaders(providerConfig.apiKey),
    body: JSON.stringify(body),
  });

  if (typeof result.output === 'string') {
    return result.output.trim();
  }
  if (Array.isArray(result.output)) {
    return result.output.join('').trim();
  }
  if (result?.results?.length) {
    return result.results.join('').trim();
  }

  return parseGenericCompletionResponse(result);
}

async function translateWithLlamaCpp(text, sourceLang, targetLang, providerConfig) {
  const apiUrl = providerConfig.apiUrl || DEFAULT_ENDPOINTS.llama_cpp;
  const prompt = buildTranslatePrompt(text, sourceLang, targetLang);
  const body = {
    model: providerConfig.model || 'llama',
    prompt,
    max_tokens: providerConfig.maxTokens || 1024,
    temperature: providerConfig.temperature ?? 0.2,
  };

  const result = await fetchJson(apiUrl, {
    method: 'POST',
    headers: buildJsonHeaders(providerConfig.apiKey),
    body: JSON.stringify(body),
  });
  return parseGenericCompletionResponse(result);
}

async function translateWithOllama(text, sourceLang, targetLang, providerConfig) {
  const apiUrl = providerConfig.apiUrl || DEFAULT_ENDPOINTS.ollama;
  const prompt = buildTranslatePrompt(text, sourceLang, targetLang);
  const body = {
    model: providerConfig.model || 'llama2',
    prompt,
    max_tokens: providerConfig.maxTokens || 1024,
    temperature: providerConfig.temperature ?? 0.2,
    stream: false,
  };

  const result = await fetchJson(apiUrl, {
    method: 'POST',
    headers: buildJsonHeaders(providerConfig.apiKey),
    body: JSON.stringify(body),
  });

  if (result?.completion) {
    return result.completion.trim();
  }
  return parseGenericCompletionResponse(result);
}

async function translateWithLLMStudio(text, sourceLang, targetLang, providerConfig) {
  const apiUrl = providerConfig.apiUrl || DEFAULT_ENDPOINTS.llm_studio;
  const prompt = buildTranslatePrompt(text, sourceLang, targetLang);
  const body = {
    model: providerConfig.model || 'text-davinci-003',
    prompt,
    max_tokens: providerConfig.maxTokens || 1024,
    temperature: providerConfig.temperature ?? 0.2,
  };

  const result = await fetchJson(apiUrl, {
    method: 'POST',
    headers: buildJsonHeaders(providerConfig.apiKey),
    body: JSON.stringify(body),
  });
  return parseGenericCompletionResponse(result);
}

async function translateWithOpenRouter(text, sourceLang, targetLang, providerConfig) {
  const apiUrl = providerConfig.apiUrl || DEFAULT_ENDPOINTS.openrouter;
  const prompt = buildTranslatePrompt(text, sourceLang, targetLang);
  const body = {
    model: providerConfig.model || 'gpt-4',
    messages: [
      { role: 'system', content: 'Eres un traductor preciso.' },
      { role: 'user', content: prompt },
    ],
    temperature: providerConfig.temperature ?? 0.2,
    max_tokens: providerConfig.maxTokens || 1200,
  };

  const result = await fetchJson(apiUrl, {
    method: 'POST',
    headers: buildJsonHeaders(providerConfig.apiKey),
    body: JSON.stringify(body),
  });
  return parseOpenAIResponse(result);
}

async function translateWithElectronHub(text, sourceLang, targetLang, providerConfig) {
  const apiUrl = providerConfig.apiUrl || DEFAULT_ENDPOINTS.electron_hub;
  const prompt = buildTranslatePrompt(text, sourceLang, targetLang);
  const body = {
    prompt,
    model: providerConfig.model || 'default',
    max_tokens: providerConfig.maxTokens || 1024,
    temperature: providerConfig.temperature ?? 0.2,
  };

  const result = await fetchJson(apiUrl, {
    method: 'POST',
    headers: buildJsonHeaders(providerConfig.apiKey),
    body: JSON.stringify(body),
  });

  return parseGenericCompletionResponse(result);
}

async function translateWithGoogleAIStudio(text, sourceLang, targetLang, providerConfig) {
  const model = providerConfig.model || 'models/text-bison-001';
  const apiKey = providerConfig.apiKey;
  const baseUrl = providerConfig.apiUrl || DEFAULT_ENDPOINTS.google_aistudio;
  const apiUrl = apiKey && !baseUrl.includes('?') ? `${baseUrl}?key=${encodeURIComponent(apiKey)}` : baseUrl;
  const prompt = buildTranslatePrompt(text, sourceLang, targetLang);
  const body = {
    prompt: { text: prompt },
    temperature: providerConfig.temperature ?? 0.2,
    max_output_tokens: providerConfig.maxTokens || 1024,
  };

  const result = await fetchJson(apiUrl, {
    method: 'POST',
    headers: buildJsonHeaders(),
    body: JSON.stringify(body),
  });
  return parseGenericCompletionResponse(result);
}

async function translateWithGoogleTranslate(text, sourceLang, targetLang, providerConfig) {
  const apiKey = providerConfig.apiKey;
  const apiUrl = providerConfig.apiUrl || DEFAULT_ENDPOINTS.google_translate;

  if (!apiKey && !providerConfig.apiUrl) {
    throw new Error('Google Translate requiere apiKey o apiUrl personalizada');
  }

  const body = {
    q: text,
    target: targetLang,
    format: 'text',
  };

  if (sourceLang !== 'auto') {
    body.source = sourceLang;
  }

  const result = await fetchJson(apiUrl, {
    method: 'POST',
    headers: buildJsonHeaders(),
    body: JSON.stringify(body),
  });

  if (!result?.data?.translations?.length || !result.data.translations[0].translatedText) {
    throw new Error('Respuesta inválida de Google Translate');
  }

  return result.data.translations[0].translatedText.trim();
}
