// Authentiek Zingen — the Dutch edition of the Authentic Singing Journey, week
// by week: the words of the Dutch weekly email.
//
// Recovered from the Dutch Drip series "Authentiek Zingen Week N" (sent from
// info@songdance.be, signed "Met warme groeten, Yavin & Upala"), the twin of
// the English series in ./asj-weeks.ts. The session titles are the English
// titles that series always used. Same edits as the English file: "Jaartraject"
// → "reis", a button that opens the week in the CiRCLE, signed Jacob — and the
// same exception: the "Let Go – Let In" trilogy and week 31 keep their
// letting-go language (Jacob's call, October 2026).
//
// The Dutch series only goes out once every week 2–40 has its words here
// (ASJ_NL_COMPLETE): until then no Dutch-edition buyer is enrolled, so nobody
// receives a series with holes in it.

export type AsjWeekNl = {
  week: number;
  title: string;
  paragraphs: string[];
  // 'drip' = as the Dutch Drip email had it; 'drip-edited' = lightly edited
  // (see above); 'translated' = no Dutch copy survives, translated from the
  // English week.
  source: 'drip' | 'drip-edited' | 'translated';
};

export const ASJ_WEEKS_NL: AsjWeekNl[] = [
  {
    week: 11,
    title: 'Harmony 1: Acceptance Of Disharmony',
    source: 'drip',
    paragraphs: [
      'In week 1 lieten we jou luisteren naar jouw eigen stem.',
      'Deze week laten we jou andermaal luisteren naar jouw eigen stem, maar dan in harmonie met een ander instrument…',
    ],
  },
  {
    week: 31,
    title: 'Expectation & Disappointment',
    source: 'drip',
    paragraphs: [
      'De trilogie rond loslaten ligt achter ons. Nu is het afwachten wat het ‘resultaat’ zal zijn… Is het gelukt om iets ‘echt’ los te laten? Is het gelukt om iets fundamenteels in je leven te veranderen?',
      'Bij al die vragen ontstaan er als vanzelf dromen en verwachtingen. En dan loert teleurstelling om de hoek… Zou het dan niet een meerwaarde zijn om die teleurstelling te kunnen omarmen, als een wonderbaarlijk onderdeel van de menselijke ervaring…',
    ],
  },
  {
    week: 33,
    title: 'Cuban Style',
    source: 'drip',
    paragraphs: [
      'Ritme zit verscholen in alles. Wanneer we er ons van laten doordringen komen er stromen van energieën vrij waar we anders veelal van afgesneden zijn…',
    ],
  },
  {
    week: 35,
    title: 'Anger: It Is Time',
    source: 'drip-edited',
    paragraphs: [
      'Met nog slechts vijf sessies te gaan tot het einde van de reis kon onze vriend ‘kwaadheid’ toch niet ontbreken…',
      'Sta jij in verbinding met je boosheid, en wist je dat kwaadheid en liefde hand in hand kunnen gaan?',
    ],
  },
];

export function asjWeekNl(n: number): AsjWeekNl | null {
  return ASJ_WEEKS_NL.find((w) => w.week === n) ?? null;
}

// Every week the weekly series sends (2–40) has its Dutch words.
export const ASJ_NL_COMPLETE = Array.from({ length: 39 }, (_, i) => i + 2).every((n) => !!asjWeekNl(n));
