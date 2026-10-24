export const inboxResearchPhrases = [
  "Exploring the angles",
  "Connecting the dots",
  "Weighing the options",
  "Thinking it through",
  "Digging a bit deeper",
  "Testing a theory",
  "Untangling the knot",
  "Herding loose ends",
  "Poking the puzzle",
  "Talking to chaos",
] as const;

/** Shuffle a full cycle, including its seam, rather than repeating random labels. */
export function nextResearchPhrase(current: { phrase: string; remaining: ReadonlyArray<string> }) {
  const remaining: string[] = current.remaining.length
    ? [...current.remaining]
    : [...inboxResearchPhrases];
  if (!current.remaining.length) {
    for (let index = remaining.length - 1; index > 0; index--) {
      const other = Math.floor(Math.random() * (index + 1));
      [remaining[index], remaining[other]] = [remaining[other]!, remaining[index]!];
    }
    if (remaining.at(-1) === current.phrase)
      [remaining[0], remaining[remaining.length - 1]] = [remaining.at(-1)!, remaining[0]!];
  }
  return { phrase: remaining.pop()!, remaining };
}
