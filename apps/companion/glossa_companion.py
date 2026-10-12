# /// script
# requires-python = ">=3.10,<3.14"
# dependencies = ["faster-whisper==1.2.1", "numpy", "nvidia-cublas-cu12", "nvidia-cudnn-cu12==9.*"]
# ///
"""Glossa desktop companion: speech recognition on your own GPU, for the Glossa browser extension.

Speaks Chrome native messaging on stdin/stdout (4-byte length + JSON). Nothing here uses the network,
except `--download`, which fetches the model once. Protocol: packages/core/src/asr/companion.ts.
"""
import base64
import importlib.util
import json
import os
import struct
import sys

MODEL = os.environ.get("GLOSSA_MODEL", "large-v3")


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


def transcribe(model, message):
    import numpy as np

    # Raw 16 kHz f32 PCM: faster_whisper.decode_audio breaks with the current PyAV.
    audio = np.frombuffer(base64.b64decode(message["pcm"]), dtype="<f4")
    segments, info = model.transcribe(
        audio, language=message.get("language") or None, beam_size=5, condition_on_previous_text=False
    )
    return {
        "language": info.language,
        "segments": [{"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()} for s in segments],
    }


def main():
    stdin, stdout = sys.stdin.buffer, sys.stdout.buffer
    sys.stdout = sys.stderr  # stray prints must not corrupt the message stream
    add_cuda_dll_dirs()
    model, engine = load_model("--download" in sys.argv)
    if "--download" in sys.argv:
        print(f"Model ready: {engine}")
        return
    write_message(stdout, {"type": "ready", "engine": engine})
    while (message := read_message(stdin)) is not None:
        reply = {"id": message.get("id")}
        try:
            if message.get("type") == "ping":
                reply.update(type="pong", engine=engine)
            elif message.get("type") == "transcribe":
                reply.update(type="segments", **transcribe(model, message))
            else:
                raise ValueError(f"unknown message type {message.get('type')!r}")
        except Exception as error:
            reply.update(type="error", message=str(error))
        write_message(stdout, reply)


if __name__ == "__main__":
    main()
