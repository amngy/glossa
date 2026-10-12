import { browser } from '#imports';
import {
  browserLanguageModelAvailability,
  downloadBrowserLanguageModel,
  isBrowserLanguageModelSupported,
  languageName,
  type BrowserModelAvailability,
} from '@glossa/core';
import { useEffect, useState } from 'preact/hooks';
import { sendMessage } from '@/lib/messages';
import type { OnDeviceStatus } from '@/lib/on-device';
import { DEFAULT_ON_DEVICE_MODEL, findOnDeviceModel, ON_DEVICE_MODELS } from '@/lib/on-device-models';

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function Progress({ label, fraction }: { label: string; fraction: number }) {
  const percent = Math.round(fraction * 100);
  return (
    <div class="progress">
      <progress max={100} value={percent} />
      <span class="muted">
        {label} {percent}%
      </span>
    </div>
  );
}

/** Setup for the browser's own model (Gemini Nano in Chrome). */
export function BuiltInModelSetup({ language }: { language: string }) {
  const [availability, setAvailability] = useState<BrowserModelAvailability | 'checking'>('checking');
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const languages = { input: [], output: language };

  useEffect(() => {
    let active = true;
    const check = () => void browserLanguageModelAvailability(languages).then((value) => active && setAvailability(value));
    check();
    // Chrome may be downloading the model already, for this or another site.
    const timer = setInterval(check, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [language]);

  if (!isBrowserLanguageModelSupported()) {
    return <p class="error">This browser has no built-in model. It needs Chrome 138 or newer on a computer.</p>;
  }

  const download = () => {
    setError(null);
    setProgress(0);
    // Called straight from the click: Chrome only starts the download during a user gesture.
    downloadBrowserLanguageModel(languages, setProgress).then(
      () => {
        setProgress(null);
        setAvailability('available');
      },
      (reason: unknown) => {
        setProgress(null);
        setError(errorText(reason));
      },
    );
  };

  return (
    <>
      {availability === 'checking' && <p class="muted">Checking…</p>}
      {availability === 'available' && <p class="ok">Ready. Runs on this device.</p>}
      {availability === 'unavailable' && (
        <p class="error">
          Not available: Chrome’s model can’t write {languageName(language)} yet, or this computer doesn’t meet its
          requirements (22 GB of free disk space, and a graphics card with more than 4 GB of memory or 16 GB of RAM).
        </p>
      )}
      {(availability === 'downloadable' || availability === 'downloading') &&
        (progress !== null ? (
          <Progress label="Downloading…" fraction={progress} />
        ) : availability === 'downloading' ? (
          <p class="muted">Chrome is downloading its model. This can take a while.</p>
        ) : (
          <div class="row">
            <button class="button" onClick={download}>
              Download the model
            </button>
            <span class="muted small">Chrome downloads it once (a few GB) and keeps it for all sites.</span>
          </div>
        ))}
      {error && <p class="error">{error}</p>}
    </>
  );
}

/** Size picker, download and removal for Glossa's on-device model. */
export function OnDeviceModelSetup({ value, onChange }: { value: string; onChange: (model: string) => void }) {
  const [status, setStatus] = useState<OnDeviceStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const model = findOnDeviceModel(value);
  const supported = !!browser.offscreen;

  useEffect(() => {
    if (!supported) return;
    let active = true;
    setStatus(null);
    const check = () =>
      sendMessage('onDeviceStatus', { model: model.id }).then(
        (value) => {
          if (!active) return;
          setStatus(value);
          setError(null);
        },
        (reason: unknown) => active && setError(errorText(reason)),
      );
    void check();
    const timer = setInterval(() => void check(), 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [model.id]);

  if (!supported) return <p class="error">Glossa’s on-device model needs Chrome or Edge for now.</p>;

  const download = () => {
    setError(null);
    sendMessage('onDeviceDownload', { model: model.id }).catch((reason: unknown) => setError(errorText(reason)));
  };
  const remove = () => {
    if (!confirm(`Delete the downloaded ${model.name} model from this computer?`)) return;
    setError(null);
    sendMessage('onDeviceDelete', { model: model.id }).catch((reason: unknown) => setError(errorText(reason)));
  };

  return (
    <>
      <div class="model-sizes" role="radiogroup" aria-label="Model size">
        {ON_DEVICE_MODELS.map((option) => (
          <label key={option.id} class="model-size">
            <input type="radio" name="on-device-model" checked={option.id === model.id} onChange={() => onChange(option.id)} />
            <span>
              <strong>
                {option.label}
                {option.id === DEFAULT_ON_DEVICE_MODEL && ' (recommended)'}
              </strong>{' '}
              <span class="muted">
                · {option.name} · {option.size} GB
              </span>
              <span class="muted small block">{option.description}</span>
            </span>
          </label>
        ))}
      </div>

      {!status && !error && <p class="muted">Checking…</p>}
      {status && !status.supported && <p class="error">{status.reason}</p>}
      {status?.supported &&
        (status.loading ? (
          <Progress
            label={status.loading.phase === 'download' ? 'Downloading…' : 'Loading onto the graphics card…'}
            fraction={status.loading.progress}
          />
        ) : status.downloaded ? (
          <div class="row">
            <span class="ok">{status.ready ? 'Downloaded and ready.' : 'Downloaded. It loads when you first use it.'}</span>
            <button class="button danger small-button" onClick={remove}>
              Delete
            </button>
          </div>
        ) : (
          <div class="row">
            <button class="button" onClick={download}>
              Download {model.name} ({model.size} GB)
            </button>
            <span class="muted small">Downloads once from Hugging Face, then works offline.</span>
          </div>
        ))}
      {status?.error && !status.loading && <p class="error">{status.error}</p>}
      {error && <p class="error">{error}</p>}
    </>
  );
}
