# /// script
# requires-python = ">=3.10,<3.14"
# dependencies = ["faster-whisper==1.2.1", "numpy", "nvidia-cublas-cu12", "nvidia-cudnn-cu12==9.*"]
# ///
"""Glossa desktop companion: speech recognition on your own GPU, for the Glossa browser extension.

Speaks Chrome native messaging on stdin/stdout (4-byte length + JSON). Nothing here uses the network,
except `--download`, which fetches the model once. Protocol: packages/core/src/asr/companion.ts.
Live (stream-*) jobs use Nemotron 3.5 streaming through NVIDIA's NeMo-Speech.cpp, which
install-windows.ps1 -Download puts in ./nemotron.
"""
import base64
import ctypes
import importlib.util
import json
import os
import struct
import sys

MODEL = os.environ.get("GLOSSA_MODEL", "large-v3")
NEMOTRON = os.path.join(os.path.dirname(os.path.abspath(__file__)), "nemotron")
NEMOTRON_BIN = os.path.join(NEMOTRON, "nemo-speech-0.2.0-windows-x86_64-cuda", "bin")
NEMOTRON_MODEL = os.path.join(NEMOTRON, "nemotron-3.5-asr-streaming-0.6b.q8_0.gguf")
LIVE = "Nemotron 3.5 streaming" if os.path.isfile(NEMOTRON_MODEL) else None
# Its language prompts have no bare "ja" or "zh", and an unknown tag silently falls back to detection.
NEMOTRON_LOCALES = {"ja": "ja-JP", "zh": "zh-CN"}


def add_cuda_dll_dirs():
    # CTranslate2 can't find cublas64_12.dll / cudnn until the nvidia wheels' bin folders are registered.
    spec = importlib.util.find_spec("nvidia")
    for root in (spec.submodule_search_locations if spec else None) or []:
        for lib in ("cublas", "cudnn"):
            path = os.path.join(root, lib, "bin")
            if os.path.isdir(path):
                os.add_dll_directory(path)
                os.environ["PATH"] = path + os.pathsep + os.environ["PATH"]  # CTranslate2 loads with plain LoadLibrary


def load_model(download):
    from faster_whisper import WhisperModel

    local = not download  # never reach Hugging Face unless the user ran --download
    try:
        return WhisperModel(MODEL, device="cuda", compute_type="float16", local_files_only=local), f"faster-whisper {MODEL} (GPU)"
    except Exception as error:  # no usable GPU: slower but works
        print(f"GPU unavailable ({error}); using the CPU", file=sys.stderr)
        return WhisperModel("small", device="cpu", compute_type="int8", local_files_only=local), "faster-whisper small (CPU)"


def read_message(stream):
    head = stream.read(4)
    if len(head) < 4:
        return None
    (size,) = struct.unpack("=I", head)
    return json.loads(stream.read(size))


def write_message(stream, message):
    data = json.dumps(message, ensure_ascii=False).encode("utf-8")
    stream.write(struct.pack("=I", len(data)) + data)
    stream.flush()


def read_pcm(message):
    import numpy as np

    # Raw 16 kHz f32 PCM: faster_whisper.decode_audio breaks with the current PyAV.
    return np.frombuffer(base64.b64decode(message["pcm"]), dtype="<f4")


def transcribe(model, message):
    pcm = read_pcm(message)
    # Over music and noise, Whisper writes subtitle credits ("Altyazı M.K."); the VAD removes non-speech first.
    segments, info = model.transcribe(
        pcm,
        language=message.get("language") or None,
        beam_size=5,
        condition_on_previous_text=False,
        vad_filter=True,
    )
    # A last segment can run past the clip (a credit line got 14.6-44.6 s on a 15 s clip); the extension then
    # drops every real line that overlaps that phantom span.
    length = round(len(pcm) / 16000, 2)
    return {
        "language": info.language,
        "segments": [
            {"start": round(min(s.start, length), 2), "end": round(min(s.end, length), 2), "text": s.text.strip()} for s in segments
        ],
    }


# NeMo-Speech.cpp's C API (include/nemo_speech/asr.h in its release). Config structs start with their
# size, and a null pointer means the library's defaults.
_P = ctypes.c_void_p


def _struct(name, fields):
    cls = type(name, (ctypes.Structure,), {"_fields_": [("size", ctypes.c_size_t)] + fields})
    return lambda **values: cls(size=ctypes.sizeof(cls), **values)


_Backend = _struct("Backend", [("gpu", ctypes.c_int32)])
_Model = _struct("Model", [("path", ctypes.c_char_p), ("name", ctypes.c_char_p)])
_Streaming = _struct("Streaming", [(name, ctypes.c_float) for name in ("chunk_size", "ctc_left_padding", "ctc_right_padding")] + [("rnnt_right_context", ctypes.c_int32)])
_Endpointing = _struct("Endpointing", [("enable", ctypes.c_bool), ("vad_based", ctypes.c_bool), ("stop_history_eou_ms", ctypes.c_int32)])
_Config = _struct("Config", [(name, _P) for name in ("backend", "model", "streaming", "decoder", "vad", "endpointing", "postproc", "diar", "batching")])


class _Options(ctypes.Structure):
    _fields_ = [
        ("size", ctypes.c_size_t), ("request_id", ctypes.c_char_p), ("language_code", ctypes.c_char_p),
        ("interim_results", ctypes.c_bool), ("enable_word_time_offsets", ctypes.c_bool),
        ("enable_automatic_punctuation", ctypes.c_bool), ("verbatim_transcripts", ctypes.c_bool),
        ("profanity_filter", ctypes.c_bool), ("stop_history_eou_ms", ctypes.c_int32), ("speech_contexts", _P),
        ("speech_context_count", ctypes.c_size_t), ("max_alternatives", ctypes.c_int32),
        ("enable_speaker_diarization", ctypes.c_bool), ("max_speaker_count", ctypes.c_int32),
    ]


def _load_nemotron():
    os.add_dll_directory(NEMOTRON_BIN)
    lib = ctypes.CDLL(os.path.join(NEMOTRON_BIN, "nemo_speech_asr_c.dll"))
    lib.nemo_speech_asr_recognition_options_default.restype = _Options
    lib.nemo_speech_asr_last_error.restype = ctypes.c_char_p
    lib.nemo_speech_asr_stream_push_f32.argtypes = [_P, ctypes.POINTER(ctypes.c_float), ctypes.c_size_t, ctypes.c_int32]
    for name, restype, extra in [
        ("transcript", ctypes.c_char_p, [ctypes.c_size_t]),
        ("is_final", ctypes.c_bool, []),
        ("audio_processed", ctypes.c_float, []),
        ("word_count", ctypes.c_size_t, [ctypes.c_size_t]),
        ("word_start_time", ctypes.c_int32, [ctypes.c_size_t, ctypes.c_size_t]),
        ("word_end_time", ctypes.c_int32, [ctypes.c_size_t, ctypes.c_size_t]),
        ("destroy", None, []),
    ]:
        function = getattr(lib, f"nemo_speech_asr_result_{name}")
        function.restype, function.argtypes = restype, [_P] + extra
    model = _Model(path=NEMOTRON_MODEL.encode())
    # 80 ms steps and a final after 500 ms without speech. On the ja clip: 7/8 sentences and finals 0.3-1.3 s
    # after the speech, against 4/8 at the default 160 ms step and 800 ms (#48).
    streaming = _Streaming(chunk_size=0.16, ctc_left_padding=1.92, ctc_right_padding=1.92, rnnt_right_context=0)
    endpointing = _Endpointing(enable=True, stop_history_eou_ms=500)
    recognizer = _P()
    for gpu in (0, -1):
        backend = _Backend(gpu=gpu)
        parts = {"backend": backend, "model": model, "streaming": streaming, "endpointing": endpointing}
        config = _Config(**{name: ctypes.addressof(part) for name, part in parts.items()})
        if lib.nemo_speech_asr_create(ctypes.byref(config), ctypes.byref(recognizer)) == 0:
            return lib, recognizer
        print(f"Nemotron on {'the GPU' if gpu == 0 else 'the CPU'} failed: {lib.nemo_speech_asr_last_error()}", file=sys.stderr)
    raise RuntimeError("Nemotron could not start; see the companion's log.")


class NemotronStream:
    """One live stream: push 16 kHz audio, get back the current hypothesis and settled lines."""

    def __init__(self, lib, recognizer, language):
        self.lib, self.handle, self.partial, self.line_end = lib, _P(), "", 0.0
        options = lib.nemo_speech_asr_recognition_options_default()
        options.interim_results = options.enable_word_time_offsets = True
        options.language_code = NEMOTRON_LOCALES.get(language, language).encode() if language else None
        self._check(lib.nemo_speech_asr_streaming_recognize(recognizer, ctypes.byref(options), ctypes.byref(self.handle)))

    def _check(self, status):
        if status != 0:
            raise RuntimeError(f"Nemotron: {(self.lib.nemo_speech_asr_last_error() or b'').decode(errors='replace')}")

    def push(self, samples):
        pointer = samples.ctypes.data_as(ctypes.POINTER(ctypes.c_float))
        self._check(self.lib.nemo_speech_asr_stream_push_f32(self.handle, pointer, len(samples), 16000))
        return self._drain()

    def stop(self):
        try:
            self._check(self.lib.nemo_speech_asr_stream_finish(self.handle))
            return self._drain()
        finally:
            self.lib.nemo_speech_asr_stream_close(self.handle)

    def _drain(self):
        lib, events = self.lib, []
        while True:
            result = _P()
            self._check(lib.nemo_speech_asr_stream_next(self.handle, ctypes.byref(result)))
            if not result:
                return events
            try:
                text = (lib.nemo_speech_asr_result_transcript(result, 0) or b"").decode("utf-8", "replace").strip()
                if lib.nemo_speech_asr_result_is_final(result):
                    words = lib.nemo_speech_asr_result_word_count(result, 0)
                    start, end = self.line_end, lib.nemo_speech_asr_result_audio_processed(result)
                    if words:  # word times are ms from the start of the stream
                        start = lib.nemo_speech_asr_result_word_start_time(result, 0, 0) / 1000
                        end = lib.nemo_speech_asr_result_word_end_time(result, 0, words - 1) / 1000
                    if text:
                        events.append({"type": "final", "start": round(start, 2), "end": round(end, 2), "text": text})
                        self.line_end = end
                    elif self.partial:  # nothing settled: an empty partial ends the grey line
                        events.append({"type": "partial", "text": ""})
                    self.partial = ""
                elif text != self.partial:
                    self.partial = text
                    events.append({"type": "partial", "text": text})
            finally:
                lib.nemo_speech_asr_result_destroy(result)


_nemotron = None


def open_live_stream(language):
    """The live engine, loaded on first use. Another streaming engine (e.g. Whisper re-decoding) can replace it here."""
    global _nemotron
    if not LIVE:
        raise RuntimeError("Live mode needs Nemotron: run install-windows.ps1 -Download again.")
    _nemotron = _nemotron or _load_nemotron()
    return NemotronStream(*_nemotron, language)


def handle(model, engine, streams, message):
    """The replies to one request, without their id."""
    kind, stream_id = message.get("type"), message.get("id")
    if kind == "ping":
        return [{"type": "pong", "engine": engine, "live": LIVE}]
    if kind == "transcribe":
        return [{"type": "segments", **transcribe(model, message)}]
    if kind == "stream-start":
        streams[stream_id] = open_live_stream(message.get("language"))
        return []
    if kind in ("stream-audio", "stream-stop") and stream_id not in streams:
        raise ValueError("this stream isn't open")
    if kind == "stream-audio":
        return streams[stream_id].push(read_pcm(message))
    if kind == "stream-stop":
        return streams.pop(stream_id).stop()
    raise ValueError(f"unknown message type {kind!r}")


def main():
    stdin, stdout = sys.stdin.buffer, sys.stdout.buffer
    sys.stdout = sys.stderr  # stray prints must not corrupt the message stream
    add_cuda_dll_dirs()
    model, engine = load_model("--download" in sys.argv)
    if "--download" in sys.argv:
        print(f"Model ready: {engine}")
        return
    write_message(stdout, {"type": "ready", "engine": engine})
    streams = {}  # live streams, by the id of their stream-start
    while (message := read_message(stdin)) is not None:
        try:
            replies = handle(model, engine, streams, message)
        except Exception as error:
            replies = [{"type": "error", "message": str(error)}]
        for reply in replies:
            write_message(stdout, {"id": message.get("id"), **reply})


if __name__ == "__main__":
    main()
