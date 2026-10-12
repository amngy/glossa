/** Chrome's on-device language detector (Chrome 138+). */
interface LanguageDetectorApi {
  availability(): Promise<string>;
  create(): Promise<{
    detect(text: string): Promise<{ detectedLanguage: string; confidence: number }[]>;
    destroy?(): void;
  }>;
}

/**
 * Guesses the language of some text with the browser's built-in detector. Returns null when the browser
 * has none, when its model would first have to be downloaded, or when it isn't confident.
 */
export async function detectLanguage(text: string): Promise<string | null> {
  const api = (globalThis as { LanguageDetector?: LanguageDetectorApi }).LanguageDetector;
  if (!api || !text.trim()) return null;
  try {
    if ((await api.availability()) !== 'available') return null;
    const detector = await api.create();
    const [best] = await detector.detect(text);
    detector.destroy?.();
    return best && best.detectedLanguage !== 'und' && best.confidence >= 0.6 ? best.detectedLanguage : null;
  } catch {
    return null;
  }
}
