import { describe, expect, it } from 'vitest';
import { parseAssSubtitles } from '../src';

const ASS = String.raw`[Script Info]
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize
Style: Default,Arial,20

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.50,0:00:03.20,Default,,0,0,0,,{\i1}Wait,{\i0} where are you going?
Dialogue: 0,0:00:04.00,0:00:06.00,Default,,0,0,0,,First line\NSecond\hline
Dialogue: 0,0:00:05.00,0:00:07.00,Signs,,0,0,0,,{\an8\pos(320,40)}SCHOOL GATE
Dialogue: 0,0:00:05.00,0:00:07.00,EpTitle,,0,0,0,,Episode 3
Dialogue: 0,0:00:08.00,0:00:09.00,Default,,0,0,0,,{\p1}m 0 0 l 10 10{\p0}
Comment: 0,0:00:10.00,0:00:11.00,Default,,0,0,0,,a note
Dialogue: 0,0:01:02.05,0:01:03.00,Default,,0,0,0,,  
`;

describe('parseAssSubtitles', () => {
  it('reads dialogue, drops tags, signs, drawings and comments', () => {
    expect(parseAssSubtitles(ASS)).toEqual([
      { start: 1.5, end: 3.2, text: 'Wait, where are you going?' },
      { start: 4, end: 6, text: 'First line\nSecond line' },
    ]);
  });

  it('follows the Format line and handles CRLF', () => {
    const file = '[Events]\r\nFormat: Start, End, Text\r\nDialogue: 0:00:00.00,0:00:02.00,Hi, you\r\n';
    expect(parseAssSubtitles(file)).toEqual([{ start: 0, end: 2, text: 'Hi, you' }]);
  });
});
