// How a person's name is written when we say it back to them.
//
// Checkout takes the name exactly as typed, and plenty of people type in one
// case — so "Dear felicia," went out in the seat confirmation. Fixing that is
// only safe if we never overwrite a name someone deliberately shaped: a name
// carrying BOTH cases has already told us how it is written ("McDonald",
// "de Vries", "van Rooyen"), and is passed through untouched. Only a name
// written in a single case throughout carries no such signal, and only that
// one is re-cased.
//
// Display-only: nothing here writes to the database, so a row keeps whatever
// the buyer typed and history reads correctly too.

const HAS_LOWER = /\p{Ll}/u;
const HAS_UPPER = /\p{Lu}/u;
// Runs of letters, so the separators between them (hyphen, apostrophe, dot)
// each start a new word: "mary-jane" → "Mary-Jane", "o'brien" → "O'Brien".
const WORD = /\p{L}[\p{L}\p{M}]*/gu;

export function tidyName(name?: string | null): string {
  const raw = (name ?? '').trim().replace(/\s+/g, ' ');
  if (!raw) return '';
  if (HAS_LOWER.test(raw) && HAS_UPPER.test(raw)) return raw;
  return raw.replace(WORD, (word) => {
    // "JD", "TJ" — two capitals are initials far more often than a shouted
    // name, and "Jd" would be plainly wrong. Left as typed; the worst case is
    // a name that stays loud, never one that is spelled incorrectly.
    if (word.length <= 2 && HAS_UPPER.test(word)) return word;
    return word.charAt(0).toLocaleUpperCase() + word.slice(1).toLocaleLowerCase();
  });
}

// The first word of a name, cased the same way. Splitting first means a
// half-typed "maria Voss" still yields "Maria" — the rule is applied to the
// word we actually print, not to the whole string it came from.
export function tidyFirstName(name?: string | null): string {
  return tidyName((name ?? '').trim().split(' ')[0]);
}
