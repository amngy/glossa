import { storage } from '#imports';
import { baseLanguage, normalizeWord, type SavedWord } from '@glossa/core';

const vocabItem = storage.defineItem<SavedWord[]>('local:vocab', { fallback: [] });

/** Identity of a saved word: the same word in the same language is stored once. */
export function vocabKey(word: string, lang: string): string {
  return `${baseLanguage(lang)}|${normalizeWord(word, lang)}`;
}

export function getVocab(): Promise<SavedWord[]> {
  return vocabItem.getValue();
}

export function watchVocab(callback: (words: SavedWord[]) => void): () => void {
  return vocabItem.watch((words) => callback(words ?? []));
}

/** Saves a word, or refreshes it (keeping its id and date) if it was saved before. */
export async function saveWord(word: Omit<SavedWord, 'id' | 'createdAt'>): Promise<SavedWord> {
  const words = await vocabItem.getValue();
  const key = vocabKey(word.word, word.lang);
  const index = words.findIndex((w) => vocabKey(w.word, w.lang) === key);
  const existing = index === -1 ? undefined : words[index];
  const saved: SavedWord = {
    ...existing,
    ...word,
    id: existing?.id ?? crypto.randomUUID(),
    createdAt: existing?.createdAt ?? Date.now(),
  };
  if (index === -1) words.push(saved);
  else words[index] = saved;
  await vocabItem.setValue(words);
  return saved;
}

export async function removeWord(id: string): Promise<void> {
  const words = await vocabItem.getValue();
  await vocabItem.setValue(words.filter((w) => w.id !== id));
}

export async function clearVocab(): Promise<void> {
  await vocabItem.setValue([]);
}
