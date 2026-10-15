import { describe, expect, it } from 'vitest';
import { addNetflixWebVtt, netflixTextTracks } from '../src/subtitles/netflix';

describe('addNetflixWebVtt', () => {
  it('adds WebVTT to the profile list, wherever it is', () => {
    const request = { params: { renamed: ['heaac-2-dash', 'imsc1.1'] } };
    expect(addNetflixWebVtt(request)).toBe(true);
    expect(request.params.renamed).toEqual(['webvtt-lssdh-ios8', 'heaac-2-dash', 'imsc1.1']);
    expect(addNetflixWebVtt(request)).toBe(false);
    expect(addNetflixWebVtt({ a: [1, 2], b: 'x' })).toBe(false);
  });
});

describe('netflixTextTracks', () => {
  it('lists text tracks, WebVTT first, without forced, image or "off" tracks', () => {
    const vtt = (urls: unknown) => ({ 'webvtt-lssdh-ios8': { urls } });
    const manifest = {
      result: {
        movieId: 81234,
        textTracks: [
          { language: 'ja', rawTrackType: 'subtitles', downloadables: vtt([{ url: 'https://cdn/ja.vtt' }]) },
          { language: 'en', rawTrackType: 'closedcaptions', downloadables: vtt({ cdn1: 'https://cdn/en.vtt' }) },
          { language: 'ja', isForcedNarrative: true, downloadables: vtt([{ url: 'https://cdn/forced.vtt' }]) },
          { language: 'zh', isImageBased: true },
          { language: 'de', downloadables: {} },
          { language: 'es', downloadables: { 'imsc1.1': { urls: [{ url: 'https://cdn/es.xml' }] } } },
          { isNoneTrack: true },
        ],
      },
    };
    expect(netflixTextTracks(manifest)).toEqual({
      movie: '81234',
      tracks: [
        { lang: 'ja', url: 'https://cdn/ja.vtt', format: 'vtt', closedCaptions: false },
        { lang: 'en', url: 'https://cdn/en.vtt', format: 'vtt', closedCaptions: true },
        { lang: 'es', url: 'https://cdn/es.xml', format: 'ttml', closedCaptions: false },
      ],
    });
    expect(netflixTextTracks({ result: { id: 1 } })).toBeNull();
    expect(netflixTextTracks(null)).toBeNull();
  });
});
