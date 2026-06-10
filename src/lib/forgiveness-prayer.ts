// Forgiveness prayer — composition engine.
// The prayer has a four-movement spine (Acknowledgment → Release → Honoring → Return)
// that is never named on the surface. Visitors see a single flowing prayer.

export type Center = 'body' | 'heart' | 'head';

export type Q2 = 'body' | 'heart' | 'head' | 'mix';
export type Q3 = 'body' | 'heart' | 'head';
export type Q4 = 'hurt_by' | 'hurt_them' | 'mutual' | 'self' | 'life';
export type Q5 = 'resistant' | 'head_not_body' | 'returns' | 'ready' | 'numb';

export interface QuizAnswers {
  q1: string;
  q2: Q2;
  q3: Q3;
  q4: Q4;
  q5: Q5;
}

export interface ComposedPrayer {
  center: Center;
  prayer: string;
  segments: {
    opening: string;
    naming: string;
    acknowledgment: string;
    release: string;
    honoring: string;
    return: string;
    closing: string;
  };
}

// ----------------------------------------------------------------------
// Center detection
// ----------------------------------------------------------------------

export function detectCenter(q2: Q2, q3: Q3): Center {
  const score: Record<Center, number> = { body: 0, heart: 0, head: 0 };
  if (q2 !== 'mix') score[q2] += 2;
  score[q3] += 1;
  const max = Math.max(score.body, score.heart, score.head);
  // Tie → Q3 wins (Q3 was last weighted, so it acts as the natural tiebreak).
  if (score[q3] === max) return q3;
  if (score.body === max) return 'body';
  if (score.heart === max) return 'heart';
  return 'head';
}

// ----------------------------------------------------------------------
// Library
// ----------------------------------------------------------------------

type ByCenter = Record<Center, string[]>;

export const OPENINGS: Record<Q5, ByCenter> = {
  resistant: {
    body: [
      "Something in me is still braced.\nI don't have to force it open.\nI'm just here, with what's still tight.",
    ],
    heart: [
      "I am not yet where I want to be.\nThere is still something that aches when I turn toward this.\nLet me begin anyway, gently.",
    ],
    head: [
      "I notice I'm not ready.\nThat's information, not failure.\nI can begin without pretending I've arrived.",
    ],
  },
  head_not_body: {
    body: [
      "My mind has said the words.\nMy body hasn't heard them yet.\nThis is for my body.",
    ],
    heart: [
      "I have spoken forgiveness, but something deeper hasn't yet been touched.\nLet these words go where the others didn't reach.",
    ],
    head: [
      "I understand what happened. I've made my peace with it intellectually.\nNow I'm asking something else of myself — to feel what I've already concluded.",
    ],
  },
  returns: {
    body: [
      "It returns.\nI don't have to be surprised by that.\nEach return is another chance to put it down.",
    ],
    heart: [
      "This wound has come back to me again.\nNot because I failed — because it still has something to say.\nI will listen one more time.",
    ],
    head: [
      "The fact that this returns doesn't mean the work hasn't worked.\nSome things release in layers. This is a layer.",
    ],
  },
  ready: {
    body: [
      "I'm ready.\nMy body knows.\nI just need to speak it.",
    ],
    heart: [
      "Something in me has already begun to release.\nThese words are the form it has been waiting for.",
    ],
    head: [
      "I've thought it through. I've arrived.\nWhat remains is to name it.",
    ],
  },
  numb: {
    body: [
      "I can't feel much right now. That's okay.\nThe body has its own timing.\nI'll begin with what's here, even if what's here is not much.",
    ],
    heart: [
      "There's a quiet where the feeling used to be.\nI won't try to manufacture what isn't there.\nI'll speak these words into the quiet, and trust that something hears.",
    ],
    head: [
      "The numbness is also information.\nI don't have to feel ready to begin.\nThe words can do their work without my full participation.",
    ],
  },
};

export const NAMING_PATTERNS: Record<Q4, string> = {
  hurt_by: 'This is about them, and the part of me that is still tied to this.',
  hurt_them:
    "This is about them, and the part of me that acted from pain — who didn't know better at the time.",
  mutual:
    "This is about what passed between us. About my share in it. About what neither of us knew how to do differently.",
  self: 'This is about me — about the one I have been hardest on.',
  life:
    'This is about what happened. About the part of me that has been at war with it ever since.',
};

export const Q4_LABEL: Record<Q4, string> = {
  hurt_by: 'I was hurt by someone else',
  hurt_them: 'I hurt someone else',
  mutual: 'We hurt each other',
  self: "I'm forgiving myself",
  life: "I'm forgiving life, or something I can't quite name",
};

export const ACKNOWLEDGMENT: ByCenter = {
  body: [
    "I see what I've been holding.\nThe grip I didn't know I was clenching.\nThe way my shoulders learned to brace.",
    "I notice the weight of this.\nI have been carrying it longer than I realized,\nand in places I didn't choose.",
    "My body has been holding this on my behalf.\nThe tightness, the heaviness, the charge —\nall of it has been doing its work.",
  ],
  heart: [
    "I see the part of me that closed when it should have stayed open,\nor stayed open when it should have closed.\nI see what I couldn't see at the time.",
    "I acknowledge what I have been carrying —\nthe ache, the longing,\nthe love I had no language for.",
    "I see how I turned the hurt inward,\nhow I made it mean something\nabout me, about you, about us.",
  ],
  head: [
    "I see the story I have been telling myself about this.\nThe meaning I made when I didn't yet have all of it.",
    "I notice the loops, the rehearsals, the imagined conversations.\nI have been trying to think my way to peace.",
    "I acknowledge how tightly I've held the need to understand —\nas if peace could only come after the answer.",
  ],
};

export const RELEASE: ByCenter = {
  body: [
    "It can loosen now.\nThe fist can open.\nMy body decides when, and how, and how much.",
    "I am setting this down.\nNot all at once — slowly, the way the body actually releases.\nSlower than I want, exactly as it needs.",
    "The bracing can stop now.\nI don't need to hold this any longer.\nMy hands can open.",
  ],
  heart: [
    "Let what was loved still be loved.\nLet what was real still be real.\nLet the rest pass through.",
    "This has been heard now.\nNot denied — heard.\nAnd heard things leave on their own.",
    "Let me be welcomed back to myself,\nand to whoever I have been distant from —\nincluding me.",
  ],
  head: [
    "I release the need to have it all figured out.\nI don't need the final version of the story to put this down.",
    "The certainty I held too tightly can soften now,\nand the doubt I held in place of peace.",
    "I give myself permission to stop searching.\nThe understanding I have is enough to release with.",
  ],
};

export const HONORING: ByCenter = {
  body: [
    "I honor the body that knew.\nThe anger that protected.\nThe bracing that kept me upright when I didn't know how else to be.",
    "I honor what this carried.\nThe signal. The holding.\nEverything my body knew before my mind caught up.",
    "I honor the part of me that didn't let this go too soon.\nIt was right to wait.",
  ],
  heart: [
    "I honor what was real.\nThe love that was there, even imperfectly.\nThe part of me that still knows how to feel.",
    "I honor the ache, which means I cared.\nThe grief, which is love with nowhere to go yet.\nEverything tender that survived.",
    "I honor what this showed me —\nwhat I value,\nby showing me what I lost.",
  ],
  head: [
    "I honor what this taught me.\nThe clarity that came, even slowly, even in pieces.",
    "I honor the questions this asked of me.\nThe parts of myself I met because of this.",
    "I honor the understanding that did arrive —\nand the peace I am making with what may never be fully understood.",
  ],
};

export const RETURN: ByCenter = {
  body: [
    "I come back to myself.\nTo my breath. To the ground beneath me.\nStill here. Still whole.",
    "I return to my body.\nIt is the only home I have,\nand it is enough.",
    "I am here. I am held.\nI am whole, even now, even like this.",
  ],
  heart: [
    "I return love to the part of me that was hurt,\nand to the part of me that did the hurting.\nBoth belong.",
    "I come home to what is still mine —\nthe tenderness, the care,\nthe capacity to love again.",
    "I return that love to myself first.\nThat is where it must live\nbefore it can go anywhere else.",
  ],
  head: [
    "I come back to trust.\nI don't need to know how this resolves.\nThe unfolding will continue without my supervision.",
    "I return to rest.\nThe mind has done its work.\nIt can sit down now.",
    "What I have is enough to begin again.",
  ],
};

export const CLOSINGS: ByCenter = {
  body: [
    "The weight is lighter.\nNot gone — lighter.\nThat's enough for today.",
    "Something has shifted.\nSomething has loosened.\nThe body knows.",
  ],
  heart: [
    "Whatever was loved, is still loved.\nWhatever was real, remains.\nThe rest can go.",
    "I am here.\nStill tender, still true, still mine.",
  ],
  head: [
    "The mind quiets.\nThe unfolding continues.\nI rest in what is.",
    "I don't need to know more than this.\nWhat I have is enough.",
  ],
};

// ----------------------------------------------------------------------
// Composition
// ----------------------------------------------------------------------

// Tiny string hash → integer; deterministic per Q1, but two different
// strings produce different selections so two visitors don't get the
// same prayer. Same person retaking → same selection (intentional).
function seedFromQ1(q1: string): number {
  let h = 2166136261;
  for (let i = 0; i < q1.length; i++) {
    h ^= q1.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const pick = <T,>(arr: T[], seed: number, salt: number): T =>
  arr[(seed + salt) % arr.length];

export function composePrayer(
  answers: QuizAnswers,
  enrichedNamingLine?: string,
): ComposedPrayer {
  const center = detectCenter(answers.q2, answers.q3);
  const seed = seedFromQ1(answers.q1 || answers.q4);

  const opening = pick(OPENINGS[answers.q5][center], seed, 0);
  const naming = (enrichedNamingLine && enrichedNamingLine.trim()) || NAMING_PATTERNS[answers.q4];
  const acknowledgment = pick(ACKNOWLEDGMENT[center], seed, 1);
  const release = pick(RELEASE[center], seed, 2);
  const honoring = pick(HONORING[center], seed, 3);
  const ret = pick(RETURN[center], seed, 4);
  const closing = pick(CLOSINGS[center], seed, 5);

  const prayer = [opening, naming, acknowledgment, release, honoring, ret, closing].join('\n\n');

  return {
    center,
    prayer,
    segments: {
      opening,
      naming,
      acknowledgment,
      release,
      honoring,
      return: ret,
      closing,
    },
  };
}
