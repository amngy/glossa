import { describe, expect, it } from 'vitest';
import { primeVideoSubtitles } from '../src';

describe('primeVideoSubtitles', () => {
  it('lists the subtitle files of a playback-resources response', () => {
    const response = {
      timedTextUrls: {
        result: {
          subtitleUrls: [
            { languageCode: 'ja-jp', displayName: '日本語', url: 'https://cdn/ja.ttml2' },
            { languageCode: 'en-us', url: 'https://cdn/en.ttml2' },
            { languageCode: 'de-de' },
          ],
        },
      },
    };
    expect(primeVideoSubtitles(response)).toEqual([
      { lang: 'ja-jp', label: '日本語', url: 'https://cdn/ja.ttml2' },
      { lang: 'en-us', label: 'en-us', url: 'https://cdn/en.ttml2' },
    ]);
    expect(primeVideoSubtitles({ timedTextUrls: { result: {} } })).toEqual([]);
    expect(primeVideoSubtitles({ playbackUrls: {} })).toBeNull();
  });
});
