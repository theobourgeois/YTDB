export type FuzzyHit<T> = {
  item: T;
  score: number;
};

function isBoundary(text: string, index: number): boolean {
  if (index === 0) return true;
  const prev = text[index - 1];
  return prev === "_" || prev === "-" || prev === " " || prev === ".";
}

function initials(text: string): string {
  return text
    .split(/[_\-\s.]+/)
    .map((part) => part[0] ?? "")
    .join("")
    .toLocaleLowerCase();
}

export function fuzzyScore(query: string, text: string): number | null {
  const needle = query.trim().toLocaleLowerCase();
  const haystack = text.toLocaleLowerCase();
  if (!needle) return 0;
  if (haystack.length === 0) return null;

  if (haystack === needle) return 10_000;
  if (haystack.startsWith(needle)) return 5_000 - haystack.length;

  const substring = haystack.indexOf(needle);
  if (substring !== -1) {
    const boundary = isBoundary(text, substring) ? 1_200 : 0;
    return 2_400 + boundary - substring - haystack.length;
  }

  let queryIndex = 0;
  let score = 0;
  let consecutive = 0;
  for (let index = 0; index < haystack.length && queryIndex < needle.length; index += 1) {
    if (haystack[index] !== needle[queryIndex]) {
      consecutive = 0;
      continue;
    }
    consecutive += 1;
    score += 12;
    if (consecutive > 1) score += 18 * consecutive;
    if (isBoundary(text, index)) score += 40;
    queryIndex += 1;
  }
  if (queryIndex < needle.length) return null;

  const acronym = initials(text);
  if (acronym.startsWith(needle)) score += 2_200;
  else if (acronym.includes(needle)) score += 700;

  return score - (haystack.length - needle.length);
}

export function rankFuzzy<T>(
  query: string,
  items: T[],
  getText: (item: T) => string,
): FuzzyHit<T>[] {
  return rankFuzzyMulti(query, items, (item) => [getText(item)]);
}

export function rankFuzzyMulti<T>(
  query: string,
  items: T[],
  getTexts: (item: T) => string[],
): FuzzyHit<T>[] {
  if (!query.trim()) return [];

  const hits: FuzzyHit<T>[] = [];
  for (const item of items) {
    const texts = getTexts(item);
    let best: number | null = null;
    for (const text of texts) {
      const score = fuzzyScore(query, text);
      if (score !== null && (best === null || score > best)) best = score;
    }
    if (best !== null) hits.push({ item, score: best });
  }

  return hits.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return getTexts(left.item)[0]?.localeCompare(getTexts(right.item)[0] ?? "") ?? 0;
  });
}
