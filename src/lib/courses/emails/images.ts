// The header pictures of the course emails. Every confirmation opens on the
// picture of the course's own sales page (so the email looks like the page the
// buyer just bought from), and every 12-week / certification note opens on one
// of the retreat photographs, a different one per note. The weekly Authentic
// Singing Journey emails carry that week's session picture instead
// (asjWeekImagePath in ./asj-weeks.ts), and so does the ASJ welcome, which
// opens Week 1.
//
// All of them live in the R2 library (/media/library/…) and were checked by
// eye at the shell's 558×260 crop; `pos` moves the crop where the default
// centre would cut a face. Alt text follows the copy book like any other
// string (the grief picture's file name says "letting go"; its alt does not).

export type HeroImage = { src: string; alt: string; objectPosition?: string };

type Pic = { file: string; alt: string; pos?: string };

const PICS = {
  twelveWeek: { file: 'svh-retreat-circle-sunset-group-jacob-central.webp', alt: 'A Songdance circle sounding together outdoors' },
  certification: { file: 'svh-retreat-facilitator-jacob-seated.webp', alt: 'Jacob at the microphone, holding space for a circle', pos: 'center 30%' },
  path: { file: 'jacob-holding-space.webp', alt: 'Jacob facilitating a circle' },
  grief: { file: 'grief-jacob-letting-go-sounding.webp', alt: 'Jacob sounding on an open hillside, arms wide', pos: 'center 40%' },
  asjWeek1: { file: 'asj-week1.webp', alt: 'Week 1 of the Authentic Singing Journey' },
  mmj: { file: 'movement.webp', alt: 'A dancer at the water’s edge at sunset', pos: 'center 35%' },
  innerChild: { file: 'inner-child-glow.webp', alt: 'A child crouched in warm evening light' },
  journeys: { file: 'singing-lights-woman.webp', alt: 'A woman holding a string of small lights' },
  qa: { file: 'svh-retreat-teaching-jacob-laughing.webp', alt: 'Jacob laughing at the keyboard during a live session', pos: 'center 48%' },
  oneBreath: { file: 'svhgpt-01-hero-in-one-breath.webp', alt: 'One breath in, one tone out' },
  cupReceiving: { file: 'svhgpt-05-the-cup-receiving.webp', alt: 'Two open hands, held like a cup' },
  soundingBlue: { file: 'svh-retreat-sounding-blue.webp', alt: 'A participant sounding, hand on her chest', pos: 'center 30%' },
  circleTrees: { file: 'svh-retreat-circle-trees-sunset.webp', alt: 'A circle sounding among the trees at sunset' },
  walkEmbrace: { file: 'svh-retreat-walk-embrace-sunset.webp', alt: 'Two participants walking arm in arm at sunset', pos: 'center 30%' },
} satisfies Record<string, Pic>;

export type CourseImageKey = keyof typeof PICS;

export function courseImage(base: string, key: CourseImageKey): HeroImage {
  const p: Pic = PICS[key];
  return {
    src: `${base.replace(/\/+$/, '')}/media/library/${p.file}`,
    alt: p.alt,
    ...(p.pos ? { objectPosition: p.pos } : {}),
  };
}
