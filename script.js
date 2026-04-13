/* ST-Universal-Translator - script.js
 * Lógica de extensión para SillyTavern.
 * Incluye preservación de variables, parseo de PNG y esqueleto de traducción.
 */

const DEFAULT_BATCH_DELAY = 500;
const DEFAULT_TRANSLATION_PROVIDER = 'openai';
const SUPPORTED_TRANSLATION_PROVIDERS = [
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
const ST_PLACEHOLDER_REGEX = /{{\s*([^{\s][^{}]*?)\s*}}/g;
const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
let translatorSelectedFile = null;

function initializeExtensionPanel() {
  const tryRenderSettings = async () => {
    const ST = globalThis.SillyTavern;
    if (!ST?.getContext) {
      return false;
    }

    const context = ST.getContext();
    if (!context || typeof context.renderExtensionTemplateAsync !== 'function') {
      return false;
    }

    const target = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
    if (!target) {
      return false;
    }

    try {
      let settingsHtml = await context.renderExtensionTemplateAsync('third-party/ST-traslate-data', 'settings');
      if (!settingsHtml) {
        const currentScript = document.currentScript || document.querySelector('script[src*="script.js"]');
        const baseUrl = currentScript?.src ? currentScript.src.replace(/\/[^/]*$/, '/') : null;
        if (baseUrl) {
          const settingsResponse = await fetch(new URL('settings.html', baseUrl).href);
          if (settingsResponse.ok) {
            settingsHtml = await settingsResponse.text();
          }
        }
      }

      if (settingsHtml) {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = settingsHtml;
        while (wrapper.firstChild) {
          target.appendChild(wrapper.firstChild);
        }
        attachTranslatorSettingsEvents();
      }
    } catch (error) {
      console.warn('ST-Universal-Translator: error al cargar el panel de configuración', error);
    }

    return true;
  };

  const init = async () => {
    const ready = await tryRenderSettings();
    if (!ready) {
      setTimeout(init, 1000);
    }
  };

  init();
}

function preserveVariables(text) {
  if (typeof text !== 'string' || !text.length) {
    return { text, tokenMap: [] };
  }

  const tokenMap = [];
  const normalizedText = text.replace(ST_PLACEHOLDER_REGEX, (match) => {
    const token = `__VAR_${tokenMap.length}__`;
    tokenMap.push({ token, placeholder: match });
    return token;
  });

  return { text: normalizedText, tokenMap };
}

function restoreVariables(text, tokenMap) {
  if (typeof text !== 'string' || !tokenMap?.length) {
    return text;
  }

  return tokenMap.reduce((current, item) => current.replaceAll(item.token, item.placeholder), text);
}

function parsePNGChunks(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const signature = new Uint8Array(arrayBuffer.slice(0, 8));

  for (let i = 0; i < 8; i += 1) {
    if (signature[i] !== PNG_SIGNATURE[i]) {
      throw new Error('No es un PNG válido');
    }
  }

  const chunks = [];
  let offset = 8;

  while (offset < view.byteLength) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      view.getUint8(offset + 4),
      view.getUint8(offset + 5),
      view.getUint8(offset + 6),
      view.getUint8(offset + 7)
    );
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const dataBytes = new Uint8Array(arrayBuffer.slice(dataStart, dataEnd));
    const crc = view.getUint32(dataEnd);

    chunks.push({
      offset,
      length,
      type,
      dataBytes,
      crc,
    });

    offset = dataEnd + 4;
  }

  return chunks;
}

function findPNGChunk(chunks, chunkType) {
  return chunks.find((chunk) => chunk.type === chunkType) || null;
}

function utf8ToString(bytes) {
  return new TextDecoder('utf-8').decode(bytes);
}

function stringToUtf8(str) {
  return new TextEncoder().encode(str);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const buffer = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    buffer[i] = binary.charCodeAt(i);
  }
  return buffer;
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function crc32(bytes) {
  const table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let j = 0; j < 8; j += 1) {
        c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
      }
      t[i] = c >>> 0;
    }
    return t;
  })());

  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = table[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function buildPNG(chunks) {
  const chunksBuffers = [PNG_SIGNATURE];
  let totalLength = PNG_SIGNATURE.length;

  chunks.forEach((chunk) => {
    const lengthBuffer = new Uint8Array(4);
    const lengthView = new DataView(lengthBuffer.buffer);
    lengthView.setUint32(0, chunk.dataBytes.length);

    const typeBuffer = new Uint8Array([
      chunk.type.charCodeAt(0),
      chunk.type.charCodeAt(1),
      chunk.type.charCodeAt(2),
      chunk.type.charCodeAt(3),
    ]);

    const crcBuffer = new Uint8Array(4);
    const crcView = new DataView(crcBuffer.buffer);
    const crcValue = crc32(new Uint8Array([...typeBuffer, ...chunk.dataBytes]));
    crcView.setUint32(0, crcValue);

    chunksBuffers.push(lengthBuffer, typeBuffer, chunk.dataBytes, crcBuffer);
    totalLength += 4 + 4 + chunk.dataBytes.length + 4;
  });

  const output = new Uint8Array(totalLength);
  let position = 0;
  chunksBuffers.forEach((bufferPart) => {
    output.set(bufferPart, position);
    position += bufferPart.length;
  });

  return output.buffer;
}

async function translateCharacterCard(file, sourceLang = 'auto', targetLang = 'es', providerConfig = { provider: DEFAULT_TRANSLATION_PROVIDER }) {
  if (!(file instanceof File || file instanceof Blob)) {
    throw new Error('Se requiere un File o Blob de PNG');
  }

  const arrayBuffer = await file.arrayBuffer();
  const chunks = parsePNGChunks(arrayBuffer);
  const charaChunk = findPNGChunk(chunks, 'chara');

  if (!charaChunk) {
    throw new Error('No se encontró el chunk chara en el PNG');
  }

  const base64Text = utf8ToString(charaChunk.dataBytes);
  const jsonText = atob(base64Text);
  const metadata = JSON.parse(jsonText);

  const keysToTranslate = ['description', 'personality', 'scenario', 'mes_example'];
  for (const key of keysToTranslate) {
    if (typeof metadata[key] === 'string') {
      const { text: protectedText, tokenMap } = preserveVariables(metadata[key]);
      const translatedText = await translateText(protectedText, sourceLang, targetLang, providerConfig);
      metadata[key] = restoreVariables(translatedText, tokenMap);
    }
  }

  const newPayload = JSON.stringify(metadata);
  const newBase64 = btoa(newPayload);
  const newDataBytes = stringToUtf8(newBase64);
  const updatedChunks = chunks.map((chunk) => {
    if (chunk.type === 'chara') {
      return { ...chunk, dataBytes: newDataBytes };
    }
    return chunk;
  });

  const translatedArrayBuffer = buildPNG(updatedChunks);
  return new Blob([translatedArrayBuffer], { type: 'image/png' });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function translateText(text, sourceLang, targetLang, providerConfig = { provider: DEFAULT_TRANSLATION_PROVIDER }) {
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
      console.warn(`Proveedor de traducción desconocido: ${provider}. Usando openAI por defecto.`);
      return translateWithOpenAI(text, sourceLang, targetLang, providerConfig);
  }
}

const CHARACTER_TRANSLATION_KEYS = new Set([
  'name',
  'description',
  'personality',
  'scenario',
  'mes_example',
  'example',
  'note',
  'notes',
  'comment',
  'bio',
  'long_description',
  'summary',
]);

const CHARACTER_TRANSLATION_PATTERNS = [
  /name/i,
  /description/i,
  /personality/i,
  /scenario/i,
  /example/i,
  /note/i,
  /comment/i,
  /bio/i,
];

function shouldTranslateCharacterField(key) {
  if (typeof key !== 'string') {
    return false;
  }

  const normalized = key.toLowerCase();
  return CHARACTER_TRANSLATION_KEYS.has(normalized) || CHARACTER_TRANSLATION_PATTERNS.some((pattern) => pattern.test(normalized));
}

async function translateCharacterData(character, sourceLang = 'auto', targetLang = 'es', providerConfig = { provider: DEFAULT_TRANSLATION_PROVIDER }) {
  if (Array.isArray(character)) {
    return Promise.all(character.map((item) => translateCharacterData(item, sourceLang, targetLang, providerConfig)));
  }

  if (!character || typeof character !== 'object') {
    return character;
  }

  const translated = Array.isArray(character) ? [...character] : { ...character };

  for (const [key, value] of Object.entries(translated)) {
    if (typeof value === 'string' && shouldTranslateCharacterField(key)) {
      const { text: protectedText, tokenMap } = preserveVariables(value);
      const translatedText = await translateText(protectedText, sourceLang, targetLang, providerConfig);
      translated[key] = restoreVariables(translatedText, tokenMap);
      continue;
    }

    if (Array.isArray(value)) {
      translated[key] = await Promise.all(value.map(async (item) => {
        if (typeof item === 'string' && shouldTranslateCharacterField(key)) {
          const { text: protectedText, tokenMap } = preserveVariables(item);
          const translatedText = await translateText(protectedText, sourceLang, targetLang, providerConfig);
          return restoreVariables(translatedText, tokenMap);
        }
        if (item && typeof item === 'object') {
          return translateCharacterData(item, sourceLang, targetLang, providerConfig);
        }
        return item;
      }));
      continue;
    }

    if (value && typeof value === 'object') {
      translated[key] = await translateCharacterData(value, sourceLang, targetLang, providerConfig);
    }
  }

  return translated;
}

async function translateCharacters(characters, sourceLang = 'auto', targetLang = 'es', batchDelay = DEFAULT_BATCH_DELAY, providerConfig = { provider: DEFAULT_TRANSLATION_PROVIDER }) {
  if (!characters) {
    return characters;
  }

  if (Array.isArray(characters)) {
    const result = [];
    for (const character of characters) {
      result.push(await translateCharacterData(character, sourceLang, targetLang, providerConfig));
      await sleep(batchDelay);
    }
    return result;
  }

  return translateCharacterData(characters, sourceLang, targetLang, providerConfig);
}

function getFileName(file) {
  if (!file) {
    return `translated-${Date.now()}.png`;
  }
  return file.name || `translated-${Date.now()}.png`;
}

async function saveBlobToDisk(blob, filename, folderPath) {
  const normalizedFolder = folderPath?.toString().trim();
  const normalizedFilename = filename.replace(/[/\\]/g, '_');

  if (normalizedFolder && typeof window.saveBlobToPath === 'function') {
    const filePath = `${normalizedFolder.replace(/[/\\]$/, '')}/${normalizedFilename}`;
    await window.saveBlobToPath(blob, filePath);
    return { saved: true, path: filePath };
  }

  if (normalizedFolder && typeof window.saveBlob === 'function') {
    await window.saveBlob(blob, normalizedFilename, normalizedFolder);
    return { saved: true, path: `${normalizedFolder.replace(/[/\\]$/, '')}/${normalizedFilename}` };
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = normalizedFilename;
  link.click();
  URL.revokeObjectURL(url);
  return { saved: false, path: normalizedFilename };
}

function normalizeCharacterSource(source) {
  if (!source) {
    return [];
  }

  if (Array.isArray(source)) {
    return source;
  }

  if (typeof source === 'object') {
    return Object.values(source);
  }

  return [];
}

function getAvailableCharacters() {
  const sources = [
    window.getCurrentCharacters?.(),
    window.getCurrentCharacter?.(),
    window.getCharacters?.(),
    window.characters,
    window.currentCharacters,
    window.characterList,
    window.allCharacters,
  ];

  for (const source of sources) {
    const items = normalizeCharacterSource(source);
    if (items.length) {
      return items.map((item, index) => ({
        id: item?.id ?? item?.uuid ?? `char-${index}`,
        name: item?.name ?? item?.characterName ?? item?.title ?? `Personaje ${index + 1}`,
        data: item,
      }));
    }
  }

  return [];
}

async function translateImageBatch(files, sourceLang = 'auto', targetLang = 'es', outputFolder = '', providerConfig = { provider: DEFAULT_TRANSLATION_PROVIDER }, batchDelay = DEFAULT_BATCH_DELAY) {
  if (!files || !files.length) {
    return [];
  }

  const results = [];
  for (const file of files) {
    const translatedBlob = await translateCharacterCard(file, sourceLang, targetLang, providerConfig);
    const filename = getFileName(file);
    const saveInfo = await saveBlobToDisk(translatedBlob, filename, outputFolder);
    results.push({ file: filename, saved: saveInfo.saved, path: saveInfo.path });
    await sleep(batchDelay);
  }

  return results;
}

function buildTranslatePrompt(text, sourceLang, targetLang) {
  const fromLabel = sourceLang === 'auto' ? 'el idioma original' : `de ${sourceLang}`;
  return `Traduce el siguiente texto ${fromLabel} a ${targetLang}. Conserva exactamente todas las variables y tokens internos como __VAR_0__, __VAR_1__, {{char}}, {{user}}, {{worldinfo}}, {{roleplay}} y similares sin alterarlos. Solo devuelve el texto traducido y no agregues explicaciones.

Texto:
${text}`;
}

function buildJsonHeaders(apiKey, extra = {}) {
  const headers = { 'Content-Type': 'application/json', ...extra };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  const contentType = response.headers.get('content-type') || '';
  const bodyText = await response.text();

  if (!response.ok) {
    let message = bodyText;
    try {
      const bodyJson = JSON.parse(bodyText);
      message = bodyJson.error?.message || JSON.stringify(bodyJson);
    } catch (e) {
      // Body is plain text.
    }
    throw new Error(`Error en la llamada a ${url}: ${response.status} ${response.statusText} - ${message}`);
  }

  if (contentType.includes('application/json')) {
    return JSON.parse(bodyText);
  }

  return bodyText;
}

function parseOpenAIResponse(result) {
  if (!result?.choices?.length) {
    throw new Error('Respuesta de OpenAI inválida');
  }
  const choice = result.choices[0];
  if (choice.message?.content) {
    return choice.message.content.trim();
  }
  if (typeof choice.text === 'string') {
    return choice.text.trim();
  }
  throw new Error('No se pudo leer la respuesta de OpenAI');
}

function parseGenericCompletionResponse(result) {
  if (result?.output) {
    if (Array.isArray(result.output)) {
      return result.output.map((item) => (typeof item === 'string' ? item : item.text)).join('');
    }
    if (typeof result.output === 'string') {
      return result.output.trim();
    }
  }

  if (result?.choices?.length) {
    const choice = result.choices[0];
    if (choice.message?.content) {
      return choice.message.content.trim();
    }
    if (typeof choice.text === 'string') {
      return choice.text.trim();
    }
  }

  if (result?.completion) {
    return result.completion.trim();
  }

  if (result?.results?.length && result.results[0]?.content?.length) {
    return result.results[0].content.map((item) => item.text || '').join('').trim();
  }

  if (result?.candidates?.length && typeof result.candidates[0].output === 'string') {
    return result.candidates[0].output.trim();
  }

  throw new Error('No se pudo analizar la respuesta del modelo');
}

async function translateWithOpenAI(text, sourceLang, targetLang, providerConfig) {
  const apiKey = providerConfig.apiKey;
  const apiUrl = providerConfig.apiUrl || 'https://api.openai.com/v1/chat/completions';
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
  const apiUrl = providerConfig.apiUrl || 'http://127.0.0.1:5000/api/v1/generate';
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
  const apiUrl = providerConfig.apiUrl || 'http://127.0.0.1:8080/v1/completions';
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
  const apiUrl = providerConfig.apiUrl || 'http://127.0.0.1:11434/api/completions';
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
  const apiUrl = providerConfig.apiUrl || 'http://127.0.0.1:8080/api/v1/generate';
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
  const apiUrl = providerConfig.apiUrl || 'https://openrouter.ai/v1/chat/completions';
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
  const apiUrl = providerConfig.apiUrl || 'http://127.0.0.1:3000/generate';
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
  const baseUrl = providerConfig.apiUrl || `https://generativelanguage.googleapis.com/v1beta2/${model}:generateText`;
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
  const apiUrl = providerConfig.apiUrl || `https://translation.googleapis.com/language/translate/v2${apiKey ? `?key=${encodeURIComponent(apiKey)}` : ''}`;

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

async function translateLorebook(lorebook, sourceLang = 'auto', targetLang = 'es', batchDelay = DEFAULT_BATCH_DELAY, providerConfig = { provider: DEFAULT_TRANSLATION_PROVIDER }) {
  if (!lorebook?.world_info?.entries) {
    return lorebook;
  }

  const translated = { ...lorebook };
  translated.world_info = { ...translated.world_info };
  translated.world_info.entries = [];

  for (const entry of lorebook.world_info.entries) {
    const copy = { ...entry };
    for (const field of ['content', 'key', 'comment']) {
      if (typeof copy[field] === 'string') {
        const { text: protectedText, tokenMap } = preserveVariables(copy[field]);
        const translatedText = await translateText(protectedText, sourceLang, targetLang, providerConfig);
        copy[field] = restoreVariables(translatedText, tokenMap);
      }
    }
    translated.world_info.entries.push(copy);
    await sleep(batchDelay);
  }

  return translated;
}

function attachTranslatorSettingsEvents() {
  if (window.STTranslatorSettingsAttached) {
    return;
  }

  const pngInput = document.getElementById('pngInput');
  const translatePngButton = document.getElementById('translatePngButton');
  const translateImageBatchButton = document.getElementById('translateImageBatchButton');
  const translateLorebookButton = document.getElementById('translateLorebookButton');
  const translateSelectedCharactersButton = document.getElementById('translateSelectedCharactersButton');
  const refreshCharacterListButton = document.getElementById('refreshCharacterListButton');
  const pngBatchInput = document.getElementById('pngBatchInput');
  const outputFolderInput = document.getElementById('outputFolder');
  const characterBatchSelect = document.getElementById('characterBatchSelect');
  const sourceLangSelect = document.getElementById('sourceLang');
  const targetLangSelect = document.getElementById('targetLang');
  const providerSelect = document.getElementById('providerSelect');
  const apiUrlInput = document.getElementById('apiUrl');
  const apiKeyInput = document.getElementById('apiKey');
  const progressBar = document.getElementById('translationProgress');
  const statusText = document.getElementById('statusText');
  const batchDelayInput = document.getElementById('batchDelay');

  if (!pngInput || !translatePngButton || !translateImageBatchButton || !translateLorebookButton || !translateSelectedCharactersButton || !refreshCharacterListButton || !characterBatchSelect || !sourceLangSelect || !targetLangSelect || !providerSelect || !apiUrlInput || !apiKeyInput || !progressBar || !statusText || !batchDelayInput) {
    return;
  }

  window.STTranslatorSettingsAttached = true;

  function setCharacterList(characters) {
    characterBatchSelect.innerHTML = '';
    if (!characters?.length) {
      const option = document.createElement('option');
      option.textContent = 'No se encontraron personajes disponibles';
      option.disabled = true;
      characterBatchSelect.appendChild(option);
      return;
    }

    characters.forEach((item) => {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.name;
      characterBatchSelect.appendChild(option);
    });
  }

  async function refreshCharacterList() {
    const characters = window.STUniversalTranslator?.getAvailableCharacters?.() || [];
    setCharacterList(characters);
    statusText.textContent = characters.length
      ? `${characters.length} personajes disponibles` : 'No hay personajes disponibles';
  }

  function updateProgress(value, message) {
    progressBar.style.width = `${value}%`;
    if (message) {
      statusText.textContent = message;
    }
  }

  pngInput.addEventListener('change', (event) => {
    translatorSelectedFile = event.target.files?.[0] || null;
    statusText.textContent = translatorSelectedFile ? `Archivo seleccionado: ${translatorSelectedFile.name}` : 'Listo';
  });

  translatePngButton.addEventListener('click', async () => {
    if (!translatorSelectedFile) {
      statusText.textContent = 'Seleccione primero un PNG válido.';
      return;
    }

    updateProgress(10, 'Preparando traducción del PNG...');

    try {
      const translatedBlob = await window.STUniversalTranslator.translateCharacterCard(
        translatorSelectedFile,
        sourceLangSelect.value,
        targetLangSelect.value,
        {
          provider: providerSelect.value,
          apiUrl: apiUrlInput.value.trim() || undefined,
          apiKey: apiKeyInput.value.trim() || undefined,
        }
      );

      updateProgress(100, 'Traducción completada. Descargando archivo.');
      const url = URL.createObjectURL(translatedBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `translated-${translatorSelectedFile.name}`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      statusText.textContent = `Error: ${error.message}`;
    }
  });

  translateImageBatchButton.addEventListener('click', async () => {
    const files = Array.from(pngBatchInput.files || []);
    if (!files.length) {
      statusText.textContent = 'Seleccione al menos una imagen PNG para el lote.';
      return;
    }

    updateProgress(10, 'Iniciando traducción de lote de imágenes...');

    try {
      const results = await window.STUniversalTranslator.translateImageBatch(
        files,
        sourceLangSelect.value,
        targetLangSelect.value,
        outputFolderInput.value.trim(),
        {
          provider: providerSelect.value,
          apiUrl: apiUrlInput.value.trim() || undefined,
          apiKey: apiKeyInput.value.trim() || undefined,
        },
        Number(batchDelayInput.value || 500)
      );

      statusText.textContent = `Traducción de lote completada (${results.length} imágenes).`;
      console.log('Image batch results:', results);
      updateProgress(100);
    } catch (error) {
      statusText.textContent = `Error: ${error.message}`;
      updateProgress(0);
    }
  });

  translateLorebookButton.addEventListener('click', async () => {
    updateProgress(5, 'Iniciando traducción de lorebook...');
    const currentLorebook = window.getCurrentLorebook?.();

    if (!currentLorebook) {
      statusText.textContent = 'No se encontró el lorebook actual en el entorno.';
      updateProgress(0);
      return;
    }

    try {
      const translatedLorebook = await window.STUniversalTranslator.translateLorebook(
        currentLorebook,
        sourceLangSelect.value,
        targetLangSelect.value,
        Number(batchDelayInput.value || 500),
        {
          provider: providerSelect.value,
          apiUrl: apiUrlInput.value.trim() || undefined,
          apiKey: apiKeyInput.value.trim() || undefined,
        }
      );

      statusText.textContent = 'Lorebook traducido correctamente.';
      console.log('Translated lorebook:', translatedLorebook);
      updateProgress(100);
    } catch (error) {
      statusText.textContent = `Error: ${error.message}`;
      updateProgress(0);
    }
  });

  translateSelectedCharactersButton.addEventListener('click', async () => {
    updateProgress(5, 'Iniciando traducción de personajes seleccionados...');

    const selectedIds = Array.from(characterBatchSelect.selectedOptions).map((option) => option.value);
    if (!selectedIds.length) {
      statusText.textContent = 'Seleccione al menos un personaje de la lista.';
      updateProgress(0);
      return;
    }

    const availableCharacters = window.STUniversalTranslator?.getAvailableCharacters?.() || [];
    const selectedItems = availableCharacters
      .filter((item) => selectedIds.includes(item.id))
      .map((item) => item.data);

    if (!selectedItems.length) {
      statusText.textContent = 'No se encontraron los personajes seleccionados.';
      updateProgress(0);
      return;
    }

    try {
      const translatedCharacters = await window.STUniversalTranslator.translateCharacters(
        selectedItems,
        sourceLangSelect.value,
        targetLangSelect.value,
        Number(batchDelayInput.value || 500),
        {
          provider: providerSelect.value,
          apiUrl: apiUrlInput.value.trim() || undefined,
          apiKey: apiKeyInput.value.trim() || undefined,
        }
      );

      if (window.setCurrentCharacters) {
        window.setCurrentCharacters(translatedCharacters);
      } else if (window.setCurrentCharacter) {
        window.setCurrentCharacter(translatedCharacters);
      }

      statusText.textContent = 'Personajes seleccionados traducidos correctamente.';
      console.log('Translated characters:', translatedCharacters);
      updateProgress(100);
    } catch (error) {
      statusText.textContent = `Error: ${error.message}`;
      updateProgress(0);
    }
  });

  if (typeof window.STUniversalTranslator?.getAvailableCharacters === 'function') {
    refreshCharacterList();
  } else {
    statusText.textContent = 'Listo';
  }
}

export async function onActivate() {
  const context = globalThis.SillyTavern?.getContext?.();
  if (!context) {
    console.warn('ST-Universal-Translator: SillyTavern context no disponible en activate.');
    return;
  }

  const { renderExtensionTemplateAsync } = context;
  const target = document.querySelector('#extensions_settings2');
  if (!target) {
    return;
  }

  try {
    let settingsHtml = null;
    if (typeof renderExtensionTemplateAsync === 'function') {
      settingsHtml = await renderExtensionTemplateAsync('third-party/ST-traslate-data', 'settings');
    }

    if (!settingsHtml) {
      const currentScript = document.currentScript || document.querySelector('script[src*="script.js"]');
      const baseUrl = currentScript?.src ? currentScript.src.replace(/\/[^/]*$/, '/') : null;
      if (baseUrl) {
        const settingsResponse = await fetch(new URL('settings.html', baseUrl).href);
        settingsHtml = await settingsResponse.text();
      }
    }

    if (settingsHtml) {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = settingsHtml;
      while (wrapper.firstChild) {
        target.appendChild(wrapper.firstChild);
      }
      attachTranslatorSettingsEvents();
    }
  } catch (error) {
    console.warn('ST-Universal-Translator: error al cargar el panel de configuración', error);
  }
}

initializeExtensionPanel();

window.STUniversalTranslator = {
  translateCharacterCard,
  translateCharacterData,
  translateCharacters,
  translateImageBatch,
  getAvailableCharacters,
  translateLorebook,
  translateText,
  preserveVariables,
  restoreVariables,
  saveBlobToDisk,
  DEFAULT_TRANSLATION_PROVIDER,
  SUPPORTED_TRANSLATION_PROVIDERS,
};
