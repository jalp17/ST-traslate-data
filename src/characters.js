import { preserveVariables, restoreVariables, sleep } from './utils.js';
import { translateText } from './translateProviders.js';

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

export function shouldTranslateCharacterField(key) {
  if (typeof key !== 'string') {
    return false;
  }

  const normalized = key.toLowerCase();
  return CHARACTER_TRANSLATION_KEYS.has(normalized) || CHARACTER_TRANSLATION_PATTERNS.some((pattern) => pattern.test(normalized));
}

export async function translateCharacterData(character, sourceLang = 'auto', targetLang = 'es', providerConfig = { provider: 'openai' }) {
  if (Array.isArray(character)) {
    return Promise.all(character.map((item) => translateCharacterData(item, sourceLang, targetLang, providerConfig)));
  }

  if (!character || typeof character !== 'object') {
    return character;
  }

  const translated = { ...character };
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

export async function translateCharacters(characters, sourceLang = 'auto', targetLang = 'es', batchDelay = 500, providerConfig = { provider: 'openai' }) {
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

export function normalizeCharacterSource(source) {
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

export function getAvailableCharacters() {
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

export async function translateLorebook(lorebook, sourceLang = 'auto', targetLang = 'es', batchDelay = 500, providerConfig = { provider: 'openai' }) {
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
