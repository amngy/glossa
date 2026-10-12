/**
 * Translation quality check against a real model server. Not part of `pnpm test`: it needs a running
 * OpenAI-compatible server (Ollama by default) and takes minutes.
 *
 *   pnpm --filter @glossa/core eval qwen3:8b gemma3:4b
 *   EVAL_SUITE=es-en.json pnpm --filter @glossa/core eval gemma4:e4b      # another case file in eval/
 *   EVAL_BASE_URL=https://api.deepseek.com EVAL_API_KEY=… pnpm --filter @glossa/core eval deepseek-chat
 *
 * Each case lists phrases a good translation contains (any of `good`) and mistakes to avoid (`bad`).
 * The check is rough, so read the written results file too.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { LlmTranslator, OpenAICompatibleChatModel, type TranslationRequest } from '../src';

interface Case {
  id: string;
  text: string;
  sentence?: string;
  before?: string[];
  after?: string[];
  good: string[];
  bad: string[];
}

const suite = JSON.parse(readFileSync(new URL(process.env.EVAL_SUITE ?? 'ja-en.json', import.meta.url), 'utf8')) as {
  from: string;
  to: string;
  lines: Case[];
  words: Case[];
};
const baseUrl = process.env.EVAL_BASE_URL ?? 'http://localhost:11434/v1';
const apiKey = process.env.EVAL_API_KEY;
const models = process.argv.slice(2);
if (models.length === 0) throw new Error('Name at least one model.');

const matches = (text: string, patterns: string[]) => patterns.some((p) => new RegExp(p, 'i').test(text));

const results: Record<string, unknown[]> = {};
for (const model of models) {
  const translator = new LlmTranslator(new OpenAICompatibleChatModel({ baseUrl, apiKey, model }));
  const rows: { id: string; kind: string; output: string; pass: boolean; ms: number }[] = [];
  // One warm-up call, so loading the model into memory doesn't count as latency.
  await translator.translate({ text: suite.lines[0]!.text, from: suite.from, to: suite.to }).catch(() => {});

  for (const [kind, cases] of [['line', suite.lines], ['word', suite.words]] as const) {
    for (const c of cases) {
      const request: TranslationRequest = {
        text: c.text,
        from: suite.from,
        to: suite.to,
        sentence: c.sentence,
        context: c.before || c.after ? { before: c.before ?? [], after: c.after ?? [] } : undefined,
      };
      const started = performance.now();
      let output: string;
      try {
        output = await translator.translate(request, AbortSignal.timeout(120_000));
      } catch (error) {
        output = `ERROR: ${error instanceof Error ? error.message : String(error)}`;
      }
      const ms = Math.round(performance.now() - started);
      const pass = matches(output, c.good) && !matches(output, c.bad) && !output.startsWith('ERROR');
      rows.push({ id: c.id, kind, output, pass, ms });
      console.log(`${pass ? 'ok  ' : 'FAIL'} ${model} ${kind} ${c.id} (${ms} ms): ${output.replace(/\n/g, ' ⏎ ')}`);
    }
  }
  results[model] = rows;
  const passed = rows.filter((r) => r.pass).length;
  const median = rows.map((r) => r.ms).sort((a, b) => a - b)[Math.floor(rows.length / 2)];
  console.log(`\n== ${model}: ${passed}/${rows.length} passed, median ${median} ms\n`);
}

const out = process.env.EVAL_OUT ?? `eval-results-${Date.now()}.json`;
writeFileSync(out, JSON.stringify(results, null, 2));
console.log(`Wrote ${out}`);
