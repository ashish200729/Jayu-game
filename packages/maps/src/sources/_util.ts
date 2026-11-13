const SWAP: Record<string, string> = { '1': '2', '2': '1', R: 'U', U: 'R' };

/** Builds a left/right mirrored map from its left half. Team markers are swapped on the right side. */
export function mirror(half: string[]): string[] {
  return half.map((row) => row + [...row].reverse().map((c) => SWAP[c] ?? c).join(''));
}
