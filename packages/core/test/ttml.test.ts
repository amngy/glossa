import { describe, expect, it } from 'vitest';
import { parseTtmlSubtitles } from '../src';

describe('parseTtmlSubtitles', () => {
  it('reads ticks, <br/>, entities and drops ruby readings', () => {
    const file = `<?xml version="1.0" encoding="utf-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling"
    xmlns:ttp="http://www.w3.org/ns/ttml#parameter" ttp:tickRate="10000000">
  <body><div>
    <p begin="15000000t" end="32000000t" region="bottom">
      <span style="s1">Wait,</span>
      where are you going?<br/>Tom &amp; me
    </p>
    <p begin="40000000t" end="60000000t"><span tts:ruby="container"><span tts:ruby="base">漢字</span><span tts:ruby="text">かんじ</span></span>を読む</p>
    <p begin="70000000t" end="70000000t">zero length</p>
    <p xml:id="img" begin="80000000t" end="90000000t"></p>
  </div></body>
</tt>`;
    expect(parseTtmlSubtitles(file)).toEqual([
      { start: 1.5, end: 3.2, text: 'Wait, where are you going?\nTom & me' },
      { start: 4, end: 6, text: '漢字を読む' },
    ]);
  });

  it('reads clock times, frames, dur and prefixed tags', () => {
    const file = `<tt:tt xmlns:tt="http://www.w3.org/ns/ttml" ttp:frameRate="25">
<tt:body><tt:div>
<tt:p begin="00:00:01.250" end="00:00:02:12">Hola</tt:p>
<tt:p begin="3s" dur="1.5s">Adiós</tt:p>
</tt:div></tt:body></tt:tt>`;
    expect(parseTtmlSubtitles(file)).toEqual([
      { start: 1.25, end: 2.48, text: 'Hola' },
      { start: 3, end: 4.5, text: 'Adiós' },
    ]);
  });
});
