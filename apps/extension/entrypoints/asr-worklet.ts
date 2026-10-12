import { defineUnlistedScript } from '#imports';

/**
 * Runs in the audio thread (an AudioWorklet): hands the captured audio to the offscreen document in
 * blocks, with the audio clock's time of each block's first sample.
 */
export default defineUnlistedScript({
  exclude: ['firefox'],
  main() {
    const BLOCK = 4096;
    const scope = globalThis as unknown as {
      currentTime: number;
      AudioWorkletProcessor: new () => { port: MessagePort };
      registerProcessor(name: string, processor: unknown): void;
    };
    class CaptureProcessor extends scope.AudioWorkletProcessor {
      private block = new Float32Array(BLOCK);
      private filled = 0;
      private time = 0;

      process(inputs: Float32Array[][]): boolean {
        const input = inputs[0]?.[0];
        if (!input) return true;
        let offset = 0;
        while (offset < input.length) {
          if (this.filled === 0) this.time = scope.currentTime + offset / (scope as unknown as { sampleRate: number }).sampleRate;
          const take = Math.min(BLOCK - this.filled, input.length - offset);
          this.block.set(input.subarray(offset, offset + take), this.filled);
          this.filled += take;
          offset += take;
          if (this.filled === BLOCK) {
            this.port.postMessage({ samples: this.block, time: this.time }, [this.block.buffer]);
            this.block = new Float32Array(BLOCK);
            this.filled = 0;
          }
        }
        return true;
      }
    }
    scope.registerProcessor('glossa-capture', CaptureProcessor);
  },
});
