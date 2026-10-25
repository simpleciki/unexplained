// The home outbox's sample day (docs/value-metrics-amendment-1.md section 5): 10 documents, 2 from the designed
// problem list and 8 from the designed clean list (the builder's estimate: about 2 in 10 quotes have a problem).
// Uniform draw without replacement, seed 20261027, each list sorted by document id (code-unit order), with the
// seeded PRNG below. The rule was fixed before the draw ran; the picks are not swapped afterwards.

export const SAMPLE_SEED = 20261027;
export const SAMPLE_PROBLEMS = 2;
export const SAMPLE_CLEAN = 8;

// mulberry32: a small, well-known 32-bit PRNG; floats in [0, 1).
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// k items without replacement: a partial Fisher–Yates shuffle over the sorted list, taking positions 0..k-1.
export function drawWithoutReplacement(ids: string[], k: number, rand: () => number): string[] {
  const a = [...ids].sort();
  if (k > a.length) throw new Error(`cannot draw ${k} from ${a.length}`);
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(rand() * (a.length - i));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, k);
}

// One PRNG stream for the day: the problem draw first, then the clean draw.
export function sampleDay(problemIds: string[], cleanIds: string[], seed = SAMPLE_SEED): { problems: string[]; clean: string[] } {
  const rand = mulberry32(seed);
  const problems = drawWithoutReplacement(problemIds, SAMPLE_PROBLEMS, rand);
  const clean = drawWithoutReplacement(cleanIds, SAMPLE_CLEAN, rand);
  return { problems, clean };
}
