/** Display-name sanitising and a small profanity filter (English + Hindi/Hinglish transliterations). */
const BLOCKED = [
  'fuck', 'shit', 'bitch', 'cunt', 'dick', 'cock', 'pussy', 'whore', 'slut', 'nigg', 'fag', 'rape', 'nazi', 'hitler',
  'bastard', 'asshole', 'retard', 'porn', 'sex', 'penis', 'vagina',
  'chutiya', 'chutia', 'madarchod', 'behenchod', 'bhenchod', 'bhosdi', 'gandu', 'randi', 'lauda', 'lavda', 'loda', 'harami', 'kamina', 'saala', 'chod',
];

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's', '!': 'i' };

function normalise(s: string): string {
  return s
    .toLowerCase()
    .split('')
    .map((c) => LEET[c] ?? c)
    .join('')
    .replace(/[^a-z]/g, '');
}

export function isProfane(name: string): boolean {
  const n = normalise(name);
  return BLOCKED.some((w) => n.includes(w));
}

const ADJ = ['Swift', 'Brave', 'Lucky', 'Rapid', 'Sly', 'Bold', 'Zippy', 'Stormy', 'Sunny', 'Mighty', 'Nimble', 'Fuzzy'];
const NOUN = ['Falcon', 'Otter', 'Comet', 'Tiger', 'Panda', 'Rocket', 'Mango', 'Cobra', 'Koala', 'Pixel', 'Yak', 'Badger'];

export function randomName(rand: () => number = Math.random): string {
  return ADJ[Math.floor(rand() * ADJ.length)] + NOUN[Math.floor(rand() * NOUN.length)];
}

/** Trim, strip control/markup characters, cap length, and replace profane names. */
export function sanitizeName(raw: unknown, rand: () => number = Math.random): string {
  let s = typeof raw === 'string' ? raw : '';
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  s = s.replace(/[\u0000-\u001f\u007f<>{}[\]\\`"]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  if (s.length < 2 || isProfane(s)) return randomName(rand);
  return s;
}

const BOT_NAMES = [
  'Pip', 'Rivet', 'Juno', 'Bolt', 'Mochi', 'Ziggy', 'Nova', 'Tango', 'Echo', 'Bramble', 'Kiwi', 'Dash',
  'Pepper', 'Gizmo', 'Sprocket', 'Wren', 'Biscuit', 'Comet', 'Noodle', 'Quill', 'Rumble', 'Sable', 'Tofu', 'Vex',
];

export function botName(i: number): string {
  return `${BOT_NAMES[i % BOT_NAMES.length]}${i >= BOT_NAMES.length ? Math.floor(i / BOT_NAMES.length) + 1 : ''}`;
}
