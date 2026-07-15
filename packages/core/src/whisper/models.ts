// Whisper GGML model registry + on-disk management. The host injects the models
// directory (e.g. `{workspace}/models`); nothing here reads a host module.

import { createWriteStream, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { once } from "node:events";
import path from "node:path";
import { errorMessage, NOOP_LOGGER, ONE_MINUTE_MS, type WhisperLogger } from "./internal.ts";

export interface WhisperModelSpec {
  /** GGML filename — identical on disk and in the Hugging Face repo. */
  readonly file: string;
  /** Download URL (Hugging Face whisper.cpp model repo). */
  readonly url: string;
  /** Conservative lower bound on the finished file size, in bytes — guards
   *  against a truncated transfer or an HTML error page saved as the model
   *  without pinning an exact checksum. */
  readonly minBytes: number;
}

const HF_BASE = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";

// large-v3-turbo: strong accuracy, near-real-time on Apple Silicon with Metal.
// small/base are lighter fallbacks for low-RAM machines.
export const WHISPER_MODELS = {
  "large-v3-turbo": { file: "ggml-large-v3-turbo.bin", url: `${HF_BASE}/ggml-large-v3-turbo.bin`, minBytes: 1_000_000_000 },
  small: { file: "ggml-small.bin", url: `${HF_BASE}/ggml-small.bin`, minBytes: 300_000_000 },
  base: { file: "ggml-base.bin", url: `${HF_BASE}/ggml-base.bin`, minBytes: 100_000_000 },
} as const satisfies Record<string, WhisperModelSpec>;

export type WhisperModelName = keyof typeof WHISPER_MODELS;
export const DEFAULT_WHISPER_MODEL: WhisperModelName = "large-v3-turbo";

export function isWhisperModelName(value: unknown): value is WhisperModelName {
  // Own-property check — `in` would accept inherited keys like "toString",
  // which then crash the `WHISPER_MODELS[name]` lookups instead of falling
  // back to the default.
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(WHISPER_MODELS, value);
}

/** Resolve a possibly-unset / unknown model name to a valid one. */
export function resolveModelName(name: string | undefined): WhisperModelName {
  return isWhisperModelName(name) ? name : DEFAULT_WHISPER_MODEL;
}

export function modelFilePath(modelsDir: string, name: WhisperModelName): string {
  return path.join(modelsDir, WHISPER_MODELS[name].file);
}

/** A model is "ready" when its file exists and meets the size floor. */
export function isModelReady(modelsDir: string, name: WhisperModelName): boolean {
  try {
    return statSync(modelFilePath(modelsDir, name)).size >= WHISPER_MODELS[name].minBytes;
  } catch {
    return false;
  }
}

export type ModelDownloadState = "idle" | "downloading" | "ready" | "error";

export interface ModelStatus {
  state: ModelDownloadState;
  /** 0..1 — present only while downloading and Content-Length is known. */
  progress?: number;
  /** Present only in the "error" state. */
  error?: string;
}

/** Report status precedence: an in-flight download wins, then an on-disk ready
 *  file, then the last transient state (idle if none). Pure so the precedence
 *  is unit-testable without touching the filesystem. */
export function pickModelStatus(live: ModelStatus | undefined, isReady: boolean): ModelStatus {
  if (live?.state === "downloading") return live;
  if (isReady) return { state: "ready" };
  return live ?? { state: "idle" };
}

/** Parse a `Content-Length` header to a byte count; unknown / malformed → 0. */
export function parseContentLength(header: string | null): number {
  return Number(header) || 0;
}

// Abort a download if no bytes arrive for this long (stalled connection).
const DOWNLOAD_STALL_TIMEOUT_MS = ONE_MINUTE_MS;

export interface ModelDownloader {
  getStatus: (name: WhisperModelName) => ModelStatus;
  ensure: (name: WhisperModelName) => Promise<void>;
}

interface StreamToFileDeps {
  downloadStatus: Map<WhisperModelName, ModelStatus>;
  onProgress: () => void;
}

/** Drain the response stream into the `.partial` file, resetting the stall
 *  timer on every chunk and publishing progress once the total size is known. */
async function streamToFile(
  body: ReadableStream<Uint8Array>,
  partialPath: string,
  total: number,
  name: WhisperModelName,
  deps: StreamToFileDeps,
): Promise<void> {
  const reader = body.getReader();
  const fileStream = createWriteStream(partialPath);
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      deps.onProgress();
      received += value.byteLength;
      if (!fileStream.write(value)) await once(fileStream, "drain");
      if (total > 0) deps.downloadStatus.set(name, { state: "downloading", progress: received / total });
    }
    fileStream.end();
    await once(fileStream, "finish");
  } catch (err) {
    // `createWriteStream` opens lazily. Destroying it while that open is still
    // in flight lets the open's own failure land later as an `error` event with
    // no listener — an uncaughtException that kills the process. `err` already
    // carries the real cause, so absorb the late one.
    fileStream.on("error", () => {});
    fileStream.destroy();
    throw err;
  }
}

/** Fetch a model into a `.partial` file, reject a truncated transfer via the
 *  size floor, then atomically rename it into place. */
async function downloadModel(name: WhisperModelName, modelsDir: string, downloadStatus: Map<WhisperModelName, ModelStatus>): Promise<void> {
  const spec = WHISPER_MODELS[name];
  mkdirSync(modelsDir, { recursive: true });
  const dest = modelFilePath(modelsDir, name);
  const partial = `${dest}.partial`;
  const controller = new AbortController();
  let stallTimer: ReturnType<typeof setTimeout> | null = null;
  const resetStall = () => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => controller.abort(), DOWNLOAD_STALL_TIMEOUT_MS);
  };
  try {
    const response = await fetch(spec.url, { signal: controller.signal });
    if (!response.ok || !response.body) {
      throw new Error(`download failed: HTTP ${response.status}`);
    }
    const total = parseContentLength(response.headers.get("content-length"));
    resetStall();
    await streamToFile(response.body, partial, total, name, { downloadStatus, onProgress: resetStall });
    if (statSync(partial).size < spec.minBytes) {
      unlinkSync(partial);
      throw new Error("downloaded file is smaller than expected — likely truncated");
    }
    renameSync(partial, dest);
  } finally {
    if (stallTimer) clearTimeout(stallTimer);
  }
}

export function createModelDownloader(modelsDir: string, logger: WhisperLogger = NOOP_LOGGER): ModelDownloader {
  // A finished file on disk is the source of truth for "ready"; this map tracks
  // transient progress + the last error.
  const downloadStatus = new Map<WhisperModelName, ModelStatus>();

  function getStatus(name: WhisperModelName): ModelStatus {
    return pickModelStatus(downloadStatus.get(name), isModelReady(modelsDir, name));
  }

  // Fire-and-forget friendly: errors land in the status map, never thrown.
  // Idempotent — a second call while a download is in flight does nothing.
  async function ensure(name: WhisperModelName): Promise<void> {
    if (isModelReady(modelsDir, name)) {
      downloadStatus.set(name, { state: "ready" });
      return;
    }
    if (downloadStatus.get(name)?.state === "downloading") return;
    downloadStatus.set(name, { state: "downloading", progress: 0 });
    logger.info("model download: start", { model: name });
    try {
      await downloadModel(name, modelsDir, downloadStatus);
      downloadStatus.set(name, { state: "ready" });
      logger.info("model download: ok", { model: name });
    } catch (err) {
      const error = errorMessage(err);
      downloadStatus.set(name, { state: "error", error });
      logger.error("model download: failed", { model: name, error });
    }
  }

  return { getStatus, ensure };
}
