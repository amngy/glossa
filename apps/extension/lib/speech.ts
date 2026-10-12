import { pickVoice } from '@glossa/core';

/** Browsers fill in their voice list a moment after startup; wait briefly for it instead of guessing. */
function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  const voices = speechSynthesis.getVoices();
  if (voices.length > 0) return Promise.resolve(voices);
  return new Promise((resolve) => {
    const done = () => {
      speechSynthesis.removeEventListener('voiceschanged', done);
      resolve(speechSynthesis.getVoices());
    };
    speechSynthesis.addEventListener('voiceschanged', done);
    setTimeout(done, 1000);
  });
}

/** Reads `text` aloud with a voice for `lang`. Returns false when this device has none. */
export async function speak(text: string, lang: string): Promise<boolean> {
  if (!('speechSynthesis' in window)) return false;
  const voice = pickVoice(await loadVoices(), lang);
  if (!voice) return false;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.voice = voice;
  utterance.lang = voice.lang;
  utterance.rate = 0.9;
  speechSynthesis.speak(utterance);
  return true;
}
