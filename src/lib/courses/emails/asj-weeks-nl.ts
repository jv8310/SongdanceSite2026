// Authentiek Zingen — the Dutch edition of the Authentic Singing Journey, week
// by week: the words of the Dutch weekly email.
//
// Recovered from the Dutch Drip series "Authentiek Zingen Week N" (sent from
// info@songdance.be, Nov 2020 – Sep 2021, greeting "Dag <voornaam>,", signed
// "Met warme groeten, Yavin & Upala"), the twin of the English series in
// ./asj-weeks.ts — originals and customers' quoted replies in Jacob's Gmail.
// Session titles are the ones the Dutch emails used (the series' own overview,
// "Overzicht van de sessies"); most are the English titles, a few are Dutch
// ("Laat het los", "De Gouden Schaal", "Nieuwe Energie").
//
// What changed from the Dutch Drip copy, so it can be checked:
//   • "Jaartraject" → "reis", "Naar Mijn Account" → a button that opens the
//     week in the CiRCLE, signed Jacob (the "we" is Yavin & Upala, who made
//     the sessions).
//   • Twelve weeks survive nowhere in the mailbox — 2, 3, 4, 8, 10, 12, 14, 16,
//     21, 27, 28, 32 — so they are translated from the English series and
//     marked `translated`.
//   • Drip sent weeks 29 and 30 together in one mail and paused two weeks; here
//     every week has its own mail, like the English series, so both are
//     rewritten around one session each. The "Integratietijd" interlude after
//     week 37 (a four-week pause) is not part of the weekly rhythm here, and
//     week 38 no longer opens on it.
//   • Week 20's "share below the session" (the old site's comments) → "reply
//     to this email".
//   • The same copy-book edits as the English series: week 7 (an invitation,
//     not "the best remedy"), week 15 (the fire ritual), week 19 ("het bevrijden
//     van emoties"), week 17 ("een mantra aan", not "voor").
//   • And the same exception: the "Let go – Let in" trilogy and week 31 keep
//     their letting-go language (Jacob's call, October 2026).
//
// Markup in `paragraphs`: plain text, plus [link text](/path) for a link to the
// site. The series only enrols anyone once every week 2–40 is here
// (ASJ_NL_COMPLETE).

export type AsjWeekNl = {
  week: number;
  title: string;
  paragraphs: string[];
  // 'drip' = as the Dutch Drip email had it; 'drip-edited' = lightly edited
  // (see above); 'rewritten' = rewritten for the copy book; 'translated' = no
  // Dutch copy survives, translated from the English week.
  source: 'drip' | 'drip-edited' | 'rewritten' | 'translated';
};

export const ASJ_WEEKS_NL: AsjWeekNl[] = [
  {
    week: 2,
    title: 'Enjoy Your Voice',
    source: 'translated',
    paragraphs: [
      'Heb je genoten van je eerste sessie — luisteren naar jezelf, je stem ontdekken? Doe ze gerust zo vaak als je wil: elke keer kan ze je iets nieuws brengen.',
      'Klaar voor Week 2? Sessie 2 heet Enjoy Your Voice en draait helemaal om de vreugde van het zingen. We leggen de focus op aarden en op de energie laten stromen doorheen je hele lichaam. Je merkt dat deze sessie totaal anders is dan sessie 1, en dat is ook de bedoeling: we willen je een grote variatie aan benaderingen, muziekgenres en oefeningen aanbieden. Deze week: een overvloed aan ritme en energie. Geniet ervan!',
    ],
  },
  {
    week: 3,
    title: 'Imitate: African Chill',
    source: 'translated',
    paragraphs: [
      'Hier zijn we dan, bij Week 3. In week 1 luisterde je naar je stem, in week 2 zong en swingde je mee op de muziek.',
      'Deze week draait het erom je stem nog wat meer vrijheid te geven, via de kracht van imitatie.',
    ],
  },
  {
    week: 4,
    title: 'I Am Restful - I Am Peace',
    source: 'translated',
    paragraphs: [
      'Je hebt nu drie sessies achter de rug onder het label Step By Step. Deze week doen we de eerste sessie onder het label Open Up.',
      'Deze sessie nodigt je uit om klank te geven aan nervositeit, stress en onrust. Keer er gerust naar terug wanneer die gevoelens in je leven opduiken.',
    ],
  },
  {
    week: 5,
    title: 'I Love My Body',
    source: 'drip',
    paragraphs: [
      'Vandaag zijn we toegekomen aan een eerste sessie rond lichaamsbewustwording.',
      'Ons lichaam is dan ook ons instrument. Hoe meer voeling we hebben met ons lichaam, hoe meer we in staat zijn om authentiek te zingen en om authentiek te zijn.',
    ],
  },
  {
    week: 6,
    title: 'Sing Your Love',
    source: 'drip',
    paragraphs: [
      'Voor week 6 hebben we een bijzondere sessie voor jou in petto. Een sessie die je niet alleen kunt doen…',
      'De kracht van Authentiek Zingen wordt pas echt voelbaar als er kan worden gedeeld. Daarom vragen we je voor deze sessie om iemand uit te nodigen die je liefhebt om naar jouw authentieke stem te luisteren. Dit kan een goede vriend of vriendin zijn, een partner, een kind, een ouder of iemand die je nog maar net kent.',
      'De sessie zal jullie beiden begeleiden om in een kwaliteit van aandacht te komen. Als je bij de gedachte alleen al angst voelt opkomen, denk dan hieraan: je bent geboren met een stem en die is gemaakt om gehoord te worden. Het gaat hier niet om mooi kunnen zingen voor iemand, maar simpelweg om jezelf te laten horen, zoals je bent in dat moment.',
      'En weet je wat? Iemand die je graag ziet en die bereid is om oordeelloos te luisteren zal hoe dan ook diep geraakt zijn door jouw moed en kwetsbaarheid.',
      'En dán kan liefde stromen… Sing Your Love…',
    ],
  },
  {
    week: 7,
    title: 'Rainforest Flow',
    source: 'rewritten',
    paragraphs: [
      'Iedereen heeft wel eens last van een laag energiepeil, van gestagneerde energie of een somber gevoel. Bij de pakken blijven zitten heeft dan geen zin: wat dan het meest helpt, is opnieuw in beweging komen.',
      'De sessie van Week 7 nodigt jouw energie uit om (opnieuw) vrij te stromen doorheen je lichaam, via beweging en klank. Voel je geen gestagneerde energie? Geen nood! Je zult vast en zeker ook kunnen genieten van deze ritmische en beweeglijke song.',
    ],
  },
  {
    week: 8,
    title: 'The Morning',
    source: 'translated',
    paragraphs: [
      'Voor Week 8 hebben we opnieuw een sessie onder het label Step By Step. We brengen je in een lichte meditatieve staat, zodat je open en ontvankelijk kunt luisteren en nieuwe manieren ontdekt om je geheugen te gebruiken.',
      'In deze sessie klinkt een teder lied — een lied voor jou en je innerlijke kind. Voel je de roep om daar dieper op in te gaan? Dan is de [Inner Child Healing Journey](/courses/inner-child) een hele reis op zich.',
    ],
  },
  {
    week: 9,
    title: 'Kyrie Eleison',
    source: 'drip',
    paragraphs: [
      'Als je rondreist door Europa hoef je niet ver te zoeken of je komt de meest prachtige kerkjes en kapelletjes tegen.',
      'Zo kwam de inspiratie voor de sessie van Week 9, in een idyllisch kerkje in Toscane…',
      'De eerste sessie onder het label Blossom.',
    ],
  },
  {
    week: 10,
    title: 'Feel Now',
    source: 'translated',
    paragraphs: [
      'Je hebt de eerste mijlpaal bereikt.',
      'Je bent een kwart van de reis Authentiek Zingen gevorderd. Dit is al de tiende week waarin je je stem laat weerklinken, terwijl je haar kwaliteiten observeert en verkent. We willen je daarmee feliciteren — en je groeiende zelfvertrouwen erkennen.',
      'Deze week nodigen we je uit om te verdiepen in gevoeligheid.',
    ],
  },
  {
    week: 11,
    title: 'Harmony',
    source: 'drip',
    paragraphs: [
      'In week 1 lieten we jou luisteren naar jouw eigen stem.',
      'Deze week laten we jou andermaal luisteren naar jouw eigen stem, maar dan in harmonie met een ander instrument…',
    ],
  },
  {
    week: 12,
    title: 'Russian Delight',
    source: 'translated',
    paragraphs: [
      'Deze week hebben we een bijzondere traktatie uit Rusland.',
      'Yavinsky en zijn band brengen een sessie vol ritme, energie en flink wat virtuositeit.',
    ],
  },
  {
    week: 13,
    title: 'Head meets Heart',
    source: 'drip',
    paragraphs: [
      'Heb jij het gevoel dat je eerder vanuit je hoofd leeft of eerder vanuit je hart? Deze week krijgen we de hulp van Lieselot om ons hoofd te verbinden met ons hart…',
    ],
  },
  {
    week: 14,
    title: 'The Elements: Water',
    source: 'translated',
    paragraphs: [
      'In de komende weken brengen we je enkele sessies onder het label Blossom. Je wordt begeleid om af te stemmen op de energie van de elementen die ons omringen en inspireren, en je eraan over te geven: water, vuur, lucht en aarde.',
    ],
  },
  {
    week: 15,
    title: 'The Elements: Fire',
    source: 'rewritten',
    paragraphs: [
      'Van water gaan we deze week over tot vuur!',
      'Wat in jou draagt de hitte van het vuur — en hoe klinkt het als je het laat zingen?',
    ],
  },
  {
    week: 16,
    title: 'The Elements: Air',
    source: 'translated',
    paragraphs: [
      'Verwen jezelf deze week met de derde sessie in de Blossom-reeks over de elementen. We richten ons op de lucht, en de wind zal ons leiden…',
    ],
  },
  {
    week: 17,
    title: 'The Elements: Earth',
    source: 'drip-edited',
    paragraphs: ['We besluiten de serie van de elementen met een mantra aan onze geliefde planeet, Moeder Aarde…'],
  },
  {
    week: 18,
    title: 'Harmony 2: The Sound of the Mirror',
    source: 'drip',
    paragraphs: [
      'Na vier krachtige Blossom-sessies zijn we opnieuw toe aan een sessie onder het label Step By Step. We ondersteunen jou om nieuwe hoogten en laagten te zingen en om jouw harmonisch gevoel te verruimen. En dit aan de hand van het ‘spiegelzingen’…',
    ],
  },
  {
    week: 19,
    title: 'Melancholy',
    source: 'rewritten',
    paragraphs: [
      'Open Up-sessies staan in het teken van onze emoties een stem geven. Deze week leggen we de focus op weemoed, ook bekend als melancholie.',
    ],
  },
  {
    week: 20,
    title: 'Calabash Freestyle',
    source: 'drip-edited',
    paragraphs: [
      'Deze sessie is ietwat bijzonder, want het is de 20ste week. Je zit dus aan de helft van de reis Authentiek Zingen.',
      'Merk je al meer vrijheid bij het zingen? Ben je al in een grotere aanvaarding gekomen met je stem zoals die is? Lukt het reeds om ‘authentiek’ te zingen?',
      'Laat gerust weten hoe het met je gaat — antwoord gewoon op deze mail. We lezen je graag…',
      'Op naar de volgende 20 weken!',
    ],
  },
  {
    week: 21,
    title: 'It’s Okay',
    source: 'translated',
    paragraphs: [
      'Wanneer vermoeidheid toeslaat, is het goed om te rusten. In deze Blossom-sessie verkennen we rust als een bron van inspiratie en energie.',
    ],
  },
  {
    week: 22,
    title: 'Atlantis',
    source: 'drip',
    paragraphs: [
      'Heb jij je ouders vaak horen zingen? En weet jij hoe je grootouders klonken? Welke liederen zongen je verre voorouders en zijn we in staat om die klanken opnieuw te laten klinken?',
    ],
  },
  {
    week: 23,
    title: 'My song to the whales',
    source: 'drip-edited',
    paragraphs: [
      'Veel deelnemers aan de reis Authentiek Zingen ervaren wel eens verdriet bij het zingen.',
      'Tijdens deze Open Up-sessie kun je dit verdriet helemaal toelaten, klank geven en laten stromen.',
    ],
  },
  {
    week: 24,
    title: 'Dance of the Dolphins',
    source: 'drip-edited',
    paragraphs: [
      'Hoewel deze reis in het teken staat van Authentiek Zingen, willen we jou alvast laten kennismaken met de kracht van Authentiek Bewegen…',
    ],
  },
  {
    week: 25,
    title: 'Perfect as You Are',
    source: 'drip-edited',
    paragraphs: [
      'Je kijkt dagelijks wel meermaals eens in de spiegel, al is het maar tijdens het poetsen van je tanden.',
      'Maar, kijk je ook soms bewust en met veel liefde naar je eigen spiegelbeeld?',
      'Als je worstelt met de thema’s van deze sessie of met een laag zelfbeeld, kan de Inner Child Healing Journey je verder op weg zetten. [Je vindt hier alle informatie](/courses/inner-child) over deze korte maar krachtige reis met je Innerlijke Kind, waarin je samen met je Innerlijke Kind zingt, danst en mediteert.',
    ],
  },
  {
    week: 26,
    title: 'The Gospel of Awareness',
    source: 'drip',
    paragraphs: [
      'Gospelmuziek draagt een bijzondere plek in ons hart. Ze bevat veel ingrediënten waar we van houden: de energieke drive van Afrikaanse ritmiek, harmonieën waarop je vrij kunt improviseren zonder je hoofd te breken en bovenal een devotie voor datgene wat ons eigen persoontje overstijgt.',
      'We gaven een eigen invulling aan het genre ‘gospel’. En dit resulteerde andermaal in een aparte en unieke sessie…',
    ],
  },
  {
    week: 27,
    title: 'The Echo of Silence',
    source: 'translated',
    paragraphs: [
      'Deze sessie ontstond in een heuvelachtige streek in Marokko, tussen Marrakech en Essaouira, omringd door de stilte en de schoonheid van het landschap. De mensen er leven eenvoudig en de kinderen spelen vrolijk op straat. Goederen gaan per muilezel van het ene dorp naar het andere.',
      'Het is er geen gemakkelijk leven… Er is veel armoede en werkloosheid, en toch is het inspirerend om te zien hoeveel mensen er een leven vol vreugde leiden, overgegeven aan de natuurlijke stroom ervan.',
      'Dat, samen met het adembenemende landschap, inspireerde ons tot de sessie ‘The Echo of Silence’…',
    ],
  },
  {
    week: 28,
    title: 'Let go - Let in: Laat het los',
    source: 'translated',
    paragraphs: [
      'De eerste sessie van de trilogie ‘Let go – Let in’.',
      'Tijdens deze sessie nodigen we je uit om klank te geven aan het fluisteren van je ziel, wanneer die je vertelt wat je mag loslaten, wat je niet langer dient…',
    ],
  },
  {
    week: 29,
    title: 'II. De Gouden Schaal',
    source: 'drip-edited',
    paragraphs: [
      'Vorige week ontving je de eerste sessie van de trilogie ‘Let go – Let in’. Deze week volgt de tweede: De Gouden Schaal.',
    ],
  },
  {
    week: 30,
    title: 'III. Nieuwe Energie',
    source: 'translated',
    paragraphs: [
      'In de eerste twee sessies van deze trilogie maakten we ruimte om los te laten. In deze derde en laatste sessie van de trilogie ‘Let go – Let in’ verwelkomen we nieuwe energie — we vullen ons met frisheid, nieuwe ideeën, nieuwe inspiratie en nieuwe kracht…',
      'Keer gerust terug naar deze sessies wanneer er iets is dat je wilt loslaten.',
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
    week: 32,
    title: 'My Fear',
    source: 'translated',
    paragraphs: ['Het moest er ooit van komen… een sessie over angst…', 'Ben je er klaar voor?'],
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
    week: 34,
    title: 'Harmony 3: The Sound of You',
    source: 'drip',
    paragraphs: [
      'Graag bieden we je nog een derde en laatste sessie aan in de Harmony-reeks. We bouwen verder op de vorige sessies en zoeken de grens op tussen harmonisch samen-klinken en jouw eigen melodie die ontstaat…',
    ],
  },
  {
    week: 35,
    title: 'Anger: It is Time',
    source: 'drip-edited',
    paragraphs: [
      'Met nog slechts vijf sessies te gaan tot het einde van de reis kon onze vriend ‘kwaadheid’ toch niet ontbreken…',
      'Sta jij in verbinding met je boosheid, en wist je dat kwaadheid en liefde hand in hand kunnen gaan?',
    ],
  },
  {
    week: 36,
    title: 'Dark Forest',
    source: 'drip',
    paragraphs: ['Een zingende trip door het donkere woud…', 'Dark forest, show me your light!'],
  },
  {
    week: 37,
    title: 'All you need is…',
    source: 'drip',
    paragraphs: [
      'Het leven geeft ons zoveel om dankbaar voor te zijn. Het is dan ook fijn om soms — al zingende — even stil te staan bij al die kleine dingen die ons gegeven worden…',
    ],
  },
  {
    week: 38,
    title: 'Therefore I Forgive',
    source: 'drip-edited',
    paragraphs: [
      'We naderen het einde van de reis, maar we zijn er nog niet helemaal. Met hernieuwde energie, inspiratie en goesting begin je aan de 38ste sessie van Authentiek Zingen: de krachtige daad van het vergeven.',
    ],
  },
  {
    week: 39,
    title: 'On our way',
    source: 'drip-edited',
    paragraphs: [
      'Een sessie over vertrouwen kon toch niet ontbreken?',
      'Voor deze voorlaatste sessie bieden we je graag een krachtig eerbetoon aan ‘het onderweg zijn’ dat we allen bewandelen. Vertrouwen zit hem niet zozeer in de afwezigheid van twijfel of angst, maar net in een dieper weten dat we, ondanks onze twijfel en angst, steeds op weg zijn…',
    ],
  },
  {
    week: 40,
    title: 'Here and Now',
    source: 'drip-edited',
    paragraphs: [
      'Een diepe buiging voor jou en een dikke merci voor het vertrouwen dat je hebt gesteld in deze reis Authentiek Zingen!',
      'You. Made. It.',
      'Geniet van deze feestelijke sessie van Week 40.',
      'Alle veertig sessies blijven voor altijd van jou — keer naar elk ervan terug, wanneer je stem erom vraagt.',
    ],
  },
];

export function asjWeekNl(n: number): AsjWeekNl | null {
  return ASJ_WEEKS_NL.find((w) => w.week === n) ?? null;
}

// Every week the weekly series sends (2–40) has its Dutch words.
export const ASJ_NL_COMPLETE = Array.from({ length: 39 }, (_, i) => i + 2).every((n) => !!asjWeekNl(n));
