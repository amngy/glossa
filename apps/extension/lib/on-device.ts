/** Messages between the background worker and the offscreen document that runs the on-device model. */

export interface OnDeviceStatus {
  /** Whether this browser and GPU can run the model; `reason` explains why not. */
  supported: boolean;
  reason?: string;
  downloaded: boolean;
  /** Present while the model downloads or loads into GPU memory. */
  loading?: { progress: number; phase: 'download' | 'load' };
  /** Loaded into GPU memory, so answers start right away. */
  ready: boolean;
  /** Why the last download or load failed. */
  error?: string;
}

export type OffscreenRequest =
  | { type: 'status'; model: string }
  /** Starts downloading and loading the model; doesn't wait for it to finish. */
  | { type: 'download'; model: string }
  | { type: 'complete'; model: string; system: string; prompt: string }
  | { type: 'delete'; model: string };

/** Japanese readings come from the same offscreen document but not from the model worker. */
export interface ReadingsRequest {
  type: 'readings';
  text: string;
}

export interface OffscreenEnvelope {
  glossaOffscreen: true;
  request: OffscreenRequest | ReadingsRequest;
}

export type OffscreenReply = { ok: true; data: unknown } | { ok: false; error: string };

export function isOffscreenEnvelope(message: unknown): message is OffscreenEnvelope {
  return typeof message === 'object' && message !== null && (message as OffscreenEnvelope).glossaOffscreen === true;
}

/** Between the offscreen document and the worker running the model. */
export interface WorkerRequest {
  id: number;
  request: OffscreenRequest;
}

export interface WorkerReply {
  id: number;
  reply: OffscreenReply;
}
