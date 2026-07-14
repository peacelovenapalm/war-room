/**
 * Append a coalesced output payload without letting one append exceed the
 * producer-side chunk budget. The ring deliberately retains its newest
 * append even when oversized, so bounding producer appends prevents one
 * large batch from displacing the entire replay window as a single chunk.
 */

import { OUTPUT_CHUNK_APPEND_BYTE_BUDGET } from './constants.js';
import { outputRingStore, type OutputSource, type OutputStreamName } from './outputRingStore.js';

/**
 * Repartition `chunk` into sequential UTF-8-bounded ring appends. Splits
 * occur only between Unicode code points, so concatenating the emitted
 * payloads reproduces the exact input string and its UTF-8 bytes.
 */
export function appendOutputChunkInBoundedParts(
  source: OutputSource,
  id: string,
  stream: OutputStreamName,
  chunk: string,
): void {
  if (Buffer.byteLength(chunk, 'utf8') <= OUTPUT_CHUNK_APPEND_BYTE_BUDGET) {
    outputRingStore.append(source, id, stream, chunk);
    return;
  }

  let partStart = 0;
  let partEnd = 0;
  let partBytes = 0;

  for (const character of chunk) {
    const characterBytes = Buffer.byteLength(character, 'utf8');
    if (partBytes > 0 && partBytes + characterBytes > OUTPUT_CHUNK_APPEND_BYTE_BUDGET) {
      outputRingStore.append(source, id, stream, chunk.slice(partStart, partEnd));
      partStart = partEnd;
      partBytes = 0;
    }
    partEnd += character.length;
    partBytes += characterBytes;
  }

  if (partStart < chunk.length) {
    outputRingStore.append(source, id, stream, chunk.slice(partStart));
  }
}
