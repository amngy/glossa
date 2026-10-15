import { pinyin } from 'pinyin-pro';
import type { ReadingToken } from './ruby';

/**
 * Pinyin with tone marks for each Chinese character of `text`, from pinyin-pro's bundled dictionary,
 * which picks a character's reading by the word it's in (银行 yínháng, 行走 xíngzǒu). Runs offline.
 */
export function chineseReadings(text: string): ReadingToken[] {
  return pinyin(text, { type: 'all' }).map((char) => ({ surface: char.origin, reading: char.isZh && char.pinyin ? char.pinyin : undefined }));
}
