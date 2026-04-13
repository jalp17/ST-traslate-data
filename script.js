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
];const ST_PLACEHOLDER_REGEX = /{{\s*([^{\s][^{}]*?)\s*}}/g;
const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

function addExtension(extension) {
  if (typeof window?.addExtension === 'function') {
    window.addExtension(extension);
  } else if (typeof addExtension === 'function') {
    addExtension(extension);
  } else {
    console.warn('ST-Universal-Translator: no se encontró addExtension en el entorno.');
  }
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

async function translateWithOpenAI(text, sourceLang, targetLang, providerConfig) {
  // TODO: implementar la llamada a OpenAI completions/chat.
  // providerConfig.apiKey, providerConfig.model, providerConfig.apiUrl
  return text;
}

async function translateWithKoboldCPP(text, sourceLang, targetLang, providerConfig) {
  // TODO: implementar la llamada a KoboldCPP local.
  return text;
}

async function translateWithLlamaCpp(text, sourceLang, targetLang, providerConfig) {
  // TODO: implementar la llamada a llama.cpp.
  return text;
}

async function translateWithOllama(text, sourceLang, targetLang, providerConfig) {
  // TODO: implementar la llamada a Ollama.
  return text;
}

async function translateWithLLMStudio(text, sourceLang, targetLang, providerConfig) {
  // TODO: implementar la llamada a LLM Studio.
  return text;
}

async function translateWithOpenRouter(text, sourceLang, targetLang, providerConfig) {
  // TODO: implementar la llamada a OpenRouter.
  return text;
}

async function translateWithElectronHub(text, sourceLang, targetLang, providerConfig) {
  // TODO: implementar la llamada a Electron Hub.
  return text;
}

async function translateWithGoogleAIStudio(text, sourceLang, targetLang, providerConfig) {
  // TODO: implementar la llamada a Google AI Studio.
  return text;
}

async function translateWithGoogleTranslate(text, sourceLang, targetLang, providerConfig) {
  // TODO: implementar una llamada básica a Google Translate o un wrapper de traducción básica.
  return text;
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

addExtension({
  name: 'ST-Universal-Translator',
  version: '0.1.0',
  description: 'Traduce lorebooks y tarjetas de personaje en SillyTavern.',
  init() {
    console.log('ST-Universal-Translator cargado.');
  },
  actions: {
    translateCharacterCard,
    translateLorebook,
  },
});

window.STUniversalTranslator = {
  translateCharacterCard,
  translateLorebook,
  translateText,
  preserveVariables,
  restoreVariables,
  DEFAULT_TRANSLATION_PROVIDER,
  SUPPORTED_TRANSLATION_PROVIDERS,
};
