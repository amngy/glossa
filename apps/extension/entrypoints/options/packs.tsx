import { browser } from '#imports';
import { useEffect, useState } from 'preact/hooks';
import { chromeSpeechAvailability, installChromeSpeech } from '@/lib/chrome-speech';
import { installPack, isPackInstalled, PACKS, removePack, type Pack } from '@/lib/packs';

const CHANGED = 'glossa-packs';

/** Whether `pack` is installed; undefined while it's being checked. Follows installs and removals on the page. */
export function usePackInstalled(pack: Pack): boolean | undefined {
  const [installed, setInstalled] = useState<boolean>();
  useEffect(() => {
    const check = () => void isPackInstalled(pack).then(setInstalled);
    check();
    window.addEventListener(CHANGED, check);
    return () => window.removeEventListener(CHANGED, check);
  }, [pack.id]);
  return installed;
}

function PackRow({ pack }: { pack: Pack }) {
  const installed = usePackInstalled(pack);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The Japanese readings run in the offscreen document, which Firefox doesn't have.
  const supported = !!browser.offscreen;

  const install = () => {
    setError(null);
    setProgress(0);
    // Asked alongside the download; if declined, the popup asks again when it's needed.
    if (pack.permission) void browser.permissions.request({ permissions: [pack.permission] }).catch(() => {});
    installPack(pack, setProgress)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => {
        setProgress(null);
        window.dispatchEvent(new Event(CHANGED));
      });
  };
  const remove = () => {
    if (!confirm(`Remove ${pack.name} from this computer? You can install it again later.`)) return;
    void removePack(pack).then(() => window.dispatchEvent(new Event(CHANGED)));
  };

  return (
    <div class="pack">
      <div>
        <strong>{pack.name}</strong> <span class="muted">· {pack.sizeMB} MB</span>
        <span class="muted small block">
          {pack.description} Downloads once from {pack.host}, then works offline.
        </span>
      </div>
      {!supported && <p class="muted small">Needs Chrome or Edge for now.</p>}
      {supported && progress !== null && (
        <div class="progress">
          <progress max={100} value={Math.round(progress * 100)} />
          <span class="muted">Downloading… {Math.round(progress * 100)}%</span>
        </div>
      )}
      {supported && progress === null && installed === true && (
        <div class="row">
          <span class="ok">Installed.</span>
          <button class="button danger small-button" onClick={remove}>
            Remove
          </button>
        </div>
      )}
      {supported && progress === null && installed === false && (
        <div class="row">
          <button class="button" onClick={install}>
            Install ({pack.sizeMB} MB)
          </button>
        </div>
      )}
      {error && <p class="error">{error}</p>}
    </div>
  );
}

export function OptionalPacks() {
  return (
    <>
      {PACKS.map((pack) => (
        <PackRow key={pack.id} pack={pack} />
      ))}
    </>
  );
}

/** Opt-in switch for Chrome's on-device speech recognition, and the one-time language pack download. */
export function ChromeSpeechSetup({ enabled, language, onToggle }: { enabled: boolean; language: string; onToggle: (on: boolean) => void }) {
  const [status, setStatus] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const check = () => void chromeSpeechAvailability(language).then(setStatus);
  useEffect(check, [language]);

  const install = () => {
    setError(null);
    setBusy(true);
    installChromeSpeech(language)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => {
        setBusy(false);
        check();
      });
  };

  return (
    <div class="pack">
      <label class="switch">
        <input type="checkbox" checked={enabled} onChange={(event) => onToggle(event.currentTarget.checked)} />
        <span>
          Use Chrome’s built-in speech recognition <span class="muted">(Chrome 139 or newer)</span>
        </span>
      </label>
      <span class="muted small block">
        Recognises the video’s sound on your device with the engine behind Live Caption. Needs a language pack of about 60 MB, downloaded
        once from Google when you press the button. Glossa never uses Chrome’s cloud recognizer: if the pack is missing, it stops.
      </span>
      {enabled && !language && <p class="muted small">Pick a spoken language in the toolbar popup first.</p>}
      {enabled && language && status === 'unavailable' && <p class="muted small">Not available for this language or browser.</p>}
      {enabled && language && status === 'available' && <span class="ok">Language pack installed.</span>}
      {enabled && language && (status === 'downloadable' || status === 'downloading') && (
        <div class="row">
          <button class="button" disabled={busy} onClick={install}>
            {busy ? 'Downloading…' : 'Download the language pack (about 60 MB, from Google)'}
          </button>
        </div>
      )}
      {error && <p class="error">{error}</p>}
    </div>
  );
}
