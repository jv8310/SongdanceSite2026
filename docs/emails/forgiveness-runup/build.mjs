// The Forgiveness Course run-up: emails 2–6 (site broadcasts #18–#22).
// Email 1 is "Forgiveness is a paradox" (docs/emails/forgiveness-paradox.broadcast.html).
//
//   node docs/emails/forgiveness-runup/build.mjs
//
// writes <n>-<slug>.html (the broadcast body, format "html") and .txt (its
// plain-text part) next to this file. The drafts on songdance.co are saved from
// those files (Claude's broadcast_save), so change the words HERE, run it, and
// save the draft again. Same look as the paradox email: parchment card, Spectral
// headline with one Cormorant word in ember, a night band, a plum offer box.
// Copy book laws apply to every string (docs/svh-copy-book.md).
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const F = "font-family:Figtree,Helvetica,Arial,sans-serif;";
const S = "font-family:Spectral,Georgia,serif;";
const C = "font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;";
const PAGE = 'https://songdance.co/courses/forgiveness';
const link = (n, where, hash = 'register') =>
  `${PAGE}?utm_source=broadcast&amp;utm_medium=email&amp;utm_campaign=forgiveness_seq&amp;utm_content=e${n}_${where}&amp;{{prefill}}#${hash}`;
const textLink = (n) =>
  `${PAGE}?utm_source=broadcast&utm_medium=email&utm_campaign=forgiveness_seq&utm_content=e${n}_text&{{prefill}}#register`;
const HELLO = 'Hello {{ subscriber.first_name | default: "there" }},';

// ---- blocks (each returns one <tr>) ----
const em = (t) => `<em style="${C}font-weight:500;font-size:1.05em;color:#C9603A;">${t}</em>`;
const it = (t) => `<em style="${C}font-size:1.25em;color:#2A1B2A;">${t}</em>`;
const b = (t) => `<strong style="font-weight:600;">${t}</strong>`;
const row = (inner, pad = '0 44px') => `<tr><td class="pad" style="padding:${pad};">${inner}</td></tr>`;
const hero = (src, alt, n) =>
  `<tr><td style="padding:0;"><a href="${link(n, 'hero')}" style="display:block;"><img src="${src}" width="600" alt="${alt}" style="width:100%;height:auto;background-color:#4A3848;"></a></td></tr>`;
const eyebrow = (t) =>
  `<p style="margin:0 0 22px;${F}font-size:11px;letter-spacing:2.5px;color:#A14826;font-weight:600;text-transform:uppercase;"><span style="display:inline-block;width:26px;height:1px;background-color:#A14826;vertical-align:middle;margin-right:12px;"></span>${t}</p>`;
const h1 = (t) => `<h1 class="h1" style="${S}font-weight:400;font-size:44px;line-height:1.1;color:#2A1B2A;margin:0 0 28px;">${t}</h1>`;
const h2 = (t) => `<h2 class="h2" style="${S}font-weight:400;font-size:30px;line-height:1.2;color:#2A1B2A;margin:0 0 20px;">${t}</h2>`;
const p = (t, last = false) => `<p style="${F}font-size:16px;line-height:1.7;color:#2A1B2A;margin:0 0 ${last ? 0 : 16}px;">${t}</p>`;
const label = (t) => `<p style="margin:0 0 6px;${F}font-size:11px;letter-spacing:2.5px;color:#A14826;font-weight:600;text-transform:uppercase;">${t}</p>`;
// Lines set like a verse, with an ember rule down the left.
const verse = (lines) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 22px;"><tr><td style="border-left:2px solid #C9603A;padding:4px 0 4px 22px;"><p class="verse" style="${C}font-weight:500;font-size:25px;line-height:1.45;color:#2A1B2A;margin:0;">${lines.join('<br>')}</p></td></tr></table>`;
const night = (html) =>
  `<tr><td style="padding:34px 0 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#2A1B2A;"><tr><td class="pad" align="center" style="padding:44px 44px 46px;text-align:center;"><p class="lyric" style="${C}font-weight:400;font-size:32px;line-height:1.3;color:#F4ECDF;margin:0;">${html}</p></td></tr></table></td></tr>`;
const warm = (t) => `<span style="color:#EBC9B5;font-weight:500;">${t}</span>`;
const panel = (head, lyric, body) =>
  row(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FAF5EA;border:1px solid #E2D5C1;border-radius:4px;"><tr><td style="padding:26px 28px;">${label(head).replace('margin:0 0 6px', 'margin:0 0 12px')}${lyric ? `<p style="${C}font-weight:500;font-size:23px;line-height:1.4;color:#2A1B2A;margin:0 0 12px;">${lyric}</p>` : ''}<p style="${F}font-size:15px;line-height:1.7;color:#4A3848;margin:0;">${body}</p></td></tr></table>`,
    '26px 44px 6px',
  );
// Rows with a big Cormorant marker on the left (numerals, or a word).
const marked = (items, w = 56) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-bottom:1px solid #E2D5C1;">${items
    .map(
      ([mark, title, body]) =>
        `<tr><td class="num" style="width:${w}px;padding:20px 0 22px;border-top:1px solid #E2D5C1;vertical-align:top;${C}font-weight:500;font-size:36px;line-height:1;color:#C9603A;">${mark}</td><td style="padding:20px 0 22px;border-top:1px solid #E2D5C1;vertical-align:top;"><p style="${S}font-size:21px;line-height:1.3;color:#2A1B2A;margin:0 0 8px;">${title}</p><p style="${F}font-size:15px;line-height:1.7;color:#4A3848;margin:0;">${body}</p></td></tr>`,
    )
    .join('')}</table>`;
const SESSIONS = [
  ['Sun 6 Dec', 'The dynamics of forgiveness', 'why &ldquo;just let it go&rdquo; doesn&rsquo;t work, and what does'],
  ['Wed 9 Dec', 'Forgiving others', 'naming the pain without condoning the act'],
  ['Sun 13 Dec', 'Forgiving self', 'meeting the parts of you that were pushed away'],
  ['Wed 16 Dec', 'Living with forgiveness', 'tying it all together'],
];
const schedule = () =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-bottom:1px solid #E2D5C1;">${SESSIONS.map(
    ([d, t, s]) =>
      `<tr><td class="when" style="padding:13px 0;border-top:1px solid #E2D5C1;width:96px;vertical-align:top;"><p style="${F}font-size:11px;letter-spacing:1.6px;text-transform:uppercase;color:#A14826;font-weight:600;margin:4px 0 0;">${d}</p></td><td style="padding:13px 0;border-top:1px solid #E2D5C1;vertical-align:top;"><p style="${S}font-size:18px;line-height:1.3;color:#2A1B2A;margin:0;">${t}</p><p style="${F}font-size:14px;line-height:1.5;color:#6A5868;margin:3px 0 0;">${s}</p></td></tr>`,
  ).join('')}</table>`;
const offer = (n, head, body, cta, note = 'One payment. The page shows the price in your own currency.') =>
  `<tr><td class="pad" style="padding:36px 44px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#4A2540;border-radius:4px;"><tr><td class="pad" style="padding:40px 38px 38px;"><p style="margin:0 0 16px;${F}font-size:11px;letter-spacing:2.5px;color:#E7C9B8;font-weight:600;text-transform:uppercase;">The Forgiveness Course</p><h2 class="offer-h" style="${S}font-weight:400;font-size:32px;line-height:1.18;color:#F4ECDF;margin:0 0 20px;">${head}</h2><p style="${F}font-size:16px;line-height:1.7;color:#EADFCB;margin:0;">${body}</p><table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 14px;"><tr><td style="background-color:#F4ECDF;border-radius:32px;"><a href="${link(n, 'cta')}" style="display:inline-block;${F}font-size:15px;font-weight:600;letter-spacing:0.3px;color:#4A2540;padding:16px 34px;text-decoration:none;">${cta} &rarr;</a></td></tr></table><p style="${F}font-size:13px;line-height:1.6;color:#C9B4C3;margin:0;">${note}</p></td></tr></table></td></tr>`;
const paleEm = (t) => `<em style="${C}font-weight:500;font-size:1.05em;color:#F2DCC9;">${t}</em>`;
const FACTS = 'Four live sessions on Zoom with Daniela Hess and me: 6, 9, 13 and 16&nbsp;December 2026, 19:00&ndash;21:00 Brussels time. Lifetime access to the replays. &euro;147.';
const signoff = (n, ps, close = 'With love,') =>
  row(
    `<p style="${C}font-size:20px;line-height:1.5;color:#4A3848;margin:0 0 28px;">${close}<br>Jacob</p>${ps ? `<p style="${F}font-size:15px;line-height:1.7;color:#4A3848;margin:0;"><strong style="font-weight:600;color:#2A1B2A;">P.S.</strong> ${ps}</p>` : ''}`,
    '36px 44px 42px',
  );
const a = (n, where, t, hash) => `<a href="${link(n, where, hash)}" style="color:#A14826;text-decoration:underline;">${t}</a>`;
const FOOT = `<tr><td class="pad" style="background-color:#EADFCB;padding:32px 44px 34px;"><img src="https://songdance.co/brand/logo-wordmark-dark.png" width="130" alt="Songdance" style="width:130px;height:auto;margin:0 0 18px;"><p style="${C}font-size:16px;line-height:1.5;color:#7A6A78;margin:0 0 18px;">Honoring what the words alone never reached.</p><p style="${F}font-size:11px;line-height:1.7;color:#7A6A78;margin:0 0 6px;">Not for you? <a href="{{ unsubscribe_url }}" style="color:#7A6A78;text-decoration:underline;">Unsubscribe</a> &mdash; you won&rsquo;t hear from this list again.</p><p style="${F}font-size:11px;line-height:1.7;color:#9A8A78;margin:0;">Songdance BV &middot; Beaupréstraat 13, 8310 Bruges, Belgium<br>BE0743575076</p></td></tr>`;

const page = (title, preheader, rows) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${title}</title>
<link href="https://fonts.googleapis.com/css2?family=Spectral:ital,wght@0,400;0,500;1,400&family=Cormorant+Garamond:ital,wght@1,400;1,500&family=Figtree:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
body{margin:0;padding:0;background-color:#EADFCB;}
table{border-collapse:collapse;}
img{display:block;border:0;outline:none;text-decoration:none;}
a{color:#A14826;text-decoration:none;}
.preheader{display:none!important;visibility:hidden;opacity:0;max-height:0;overflow:hidden;mso-hide:all;}
@media only screen and (max-width:600px){
.wrapper{width:100%!important;}
.pad{padding-left:26px!important;padding-right:26px!important;}
.h1{font-size:36px!important;line-height:1.12!important;}
.h2{font-size:27px!important;}
.lyric{font-size:27px!important;}
.verse{font-size:22px!important;}
.offer-h{font-size:29px!important;}
.num{width:44px!important;font-size:30px!important;}
.said{width:auto!important;display:block!important;padding-bottom:0!important;}
.sounded{display:block!important;border-top:0!important;padding-top:6px!important;}
.when{width:78px!important;}
.clock{display:block!important;width:auto!important;padding:10px 0!important;}
}
</style>
</head>
<body style="margin:0;padding:0;background-color:#EADFCB;-webkit-font-smoothing:antialiased;">
<span class="preheader">${preheader}&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#EADFCB;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" class="wrapper" width="600" cellpadding="0" cellspacing="0" style="width:600px;background-color:#F4ECDF;border-radius:4px;overflow:hidden;">
${rows.join('\n')}
${FOOT}
</table>
</td></tr>
</table>
</body>
</html>
`;
const TEXT_FOOT = `--
Not for you? Unsubscribe: {{ unsubscribe_url }}
Songdance BV, Beaupréstraat 13, 8310 Bruges, Belgium
`;
const TEXT_FACTS = 'The Forgiveness Course: four live sessions on Zoom with Daniela Hess and me, 6, 9, 13 and 16 December 2026, 19:00-21:00 Brussels time. Lifetime access to the replays. EUR 147 (the page shows it in your own currency).';

const EYE = 'The Forgiveness Course&nbsp;&middot; 6&ndash;16&nbsp;December';

// =====================================================================
const emails = [
  // ---------------------------------------------------------------- 2
  {
    n: 2,
    slug: 'the-conversation',
    subject: 'The conversation you never had',
    preheader: 'You&rsquo;ve rehearsed it a hundred times. It never ends differently.',
    rows: (n) => [
      hero('https://songdance.co/media/library/forgiveness-foryou-twilight.webp', 'A woman at dusk, looking out over still water', n),
      row(
        eyebrow(EYE) +
          h1(`You know every line of it ${em('by heart.')}`) +
          p(HELLO) +
          p('It usually starts at the sink. Or at three in the morning.') +
          verse(['What you should have said.', 'What they would say back.', 'What you&rsquo;d say then.']) +
          p('You&rsquo;ve had this conversation a hundred times, and you win it every time. And in the morning, nothing has moved.') +
          p('For one of us it&rsquo;s the sister who stopped speaking after the funeral. For another, the father who left when she was nine and never called. The husband who had the affair and then told your friends a different story. The boss, in front of the whole team. The doctor who didn&rsquo;t listen for years.', true),
        '46px 44px 8px',
      ),
      row(
        h2(`The conversation was never ${em('the missing part.')}`) +
          p('We keep rehearsing because we believe the right words, finally said, would finish it. But words invite an answer. They defend themselves, you answer back, and round it goes. Even inside your own head.') +
          p('A tone is different.', true),
        '40px 44px 0',
      ),
      night(`There are no rebuttals<br>${warm('in a tone.')}`),
      row(
        p(`In the second session of the Forgiveness Course, you don&rsquo;t say it to them. You ${b('sound')} it. The anger that has been polite for years. The hurt underneath the anger. Not screamed: one honest tone, as soft as you like, with your microphone off if you want.`) +
          p('They don&rsquo;t need to be in the room. They don&rsquo;t even need to be alive. And nobody asks you to excuse what was done. Naming the pain is not condoning the act.') +
          p('What was never said is heard at last, by the one person who was there for all of it. You. And acknowledged things tend to leave on their own.', true),
        '40px 44px 0',
      ),
      offer(n, `Not ready to forgive? ${paleEm('Come anyway.')}`, FACTS, 'Join the four sessions'),
      signoff(n, `Can&rsquo;t be there live? Every session is recorded, the replay is up within a day, and the replays are yours for life. ${a(n, 'ps', 'See the four dates in your own time', 'schedule')}.`),
    ],
    text: (n) => `${HELLO}

It usually starts at the sink. Or at three in the morning.

  What you should have said.
  What they would say back.
  What you'd say then.

You've had this conversation a hundred times, and you win it every time. And in the morning, nothing has moved.

For one of us it's the sister who stopped speaking after the funeral. For another, the father who left when she was nine and never called. The husband who had the affair and then told your friends a different story. The boss, in front of the whole team. The doctor who didn't listen for years.


THE CONVERSATION WAS NEVER THE MISSING PART

We keep rehearsing because we believe the right words, finally said, would finish it. But words invite an answer. They defend themselves, you answer back, and round it goes. Even inside your own head.

A tone is different. There are no rebuttals in a tone.

In the second session of the Forgiveness Course, you don't say it to them. You sound it. The anger that has been polite for years. The hurt underneath the anger. Not screamed: one honest tone, as soft as you like, with your microphone off if you want.

They don't need to be in the room. They don't even need to be alive. And nobody asks you to excuse what was done. Naming the pain is not condoning the act.

What was never said is heard at last, by the one person who was there for all of it. You. And acknowledged things tend to leave on their own.


Not ready to forgive? Come anyway.

${TEXT_FACTS}

Join the four sessions:
${textLink(n)}

With love,
Jacob

P.S. Can't be there live? Every session is recorded, the replay is up within a day, and the replays are yours for life.

${TEXT_FOOT}`,
  },
  // ---------------------------------------------------------------- 3
  {
    n: 3,
    slug: 'the-one-you-cant-forgive-is-you',
    subject: 'When the one you can’t forgive is you',
    preheader: 'The gate you left open. The room you weren&rsquo;t in. The last thing you said.',
    rows: (n) => [
      hero('https://songdance.co/media/library/forgiveness-heart-candle-email.jpeg', 'A candle burning behind a heart-shaped window in an old door', n),
      row(
        eyebrow(EYE) +
          h1(`The hardest person to forgive ${em('is you.')}`) +
          p(HELLO) +
          p('Last time I wrote about the people who hurt us. This is the other door. It&rsquo;s quieter, because almost nobody talks about it.') +
          verse(['The gate you left open.', 'The room you weren&rsquo;t in when she died.', 'The last thing you said, which was an argument.']) +
          p('You have your own list. And you know the voice that reads it back to you.', true),
        '46px 44px 0',
      ),
      night(`I&rsquo;m not good enough.<br>I&rsquo;m unforgivable.<br>${warm('I&rsquo;m a bad person.')}`),
      row(
        h2(`An inner court that ${em('never adjourns.')}`) +
          p('In there you are the accused, the prosecutor and the judge. The trial has run for years, and it has never reached a verdict you can live with.') +
          p('People tell you to be kinder to yourself. You&rsquo;ve tried. But a kind phrase repeated until it sounds true doesn&rsquo;t reach the place where guilt lives. Guilt isn&rsquo;t an opinion you hold. It&rsquo;s something the body carries: in the chest, in the throat, in the photograph you can&rsquo;t quite look at.') +
          p(`So in the third session we don&rsquo;t argue with the inner critic, and we don&rsquo;t hand out absolution. It isn&rsquo;t ours to give. We let the guilt have ${it('its own sound.')} And the critic too: it has a tone as well, and it has waited a long time to be heard.`, true),
        '40px 44px 0',
      ),
      panel('Ho&rsquo;oponopono, sounded', 'I&rsquo;m sorry.', 'The first of four old Hawaiian phrases. Said, it&rsquo;s an apology. Sounded, it becomes something else: the grief that was never allowed to flow.'),
      row(
        p('You don&rsquo;t have to tell anyone what it was. Not us, not the group. You can stay muted the whole time. Soft counts, and a hum is a complete practice.', true),
        '26px 44px 0',
      ),
      offer(n, `Feel unforgivable? ${paleEm('Come anyway.')}`, FACTS, 'Join the four sessions'),
      signoff(n, 'If you&rsquo;re thinking <em>yes, but what I did really is unforgivable</em>: that is the sentence the third session is given to. It isn&rsquo;t a reason to stay away. It&rsquo;s where we begin.'),
    ],
    text: (n) => `${HELLO}

Last time I wrote about the people who hurt us. This is the other door. It's quieter, because almost nobody talks about it.

  The gate you left open.
  The room you weren't in when she died.
  The last thing you said, which was an argument.

You have your own list. And you know the voice that reads it back to you: I'm not good enough. I'm unforgivable. I'm a bad person.


AN INNER COURT THAT NEVER ADJOURNS

In there you are the accused, the prosecutor and the judge. The trial has run for years, and it has never reached a verdict you can live with.

People tell you to be kinder to yourself. You've tried. But a kind phrase repeated until it sounds true doesn't reach the place where guilt lives. Guilt isn't an opinion you hold. It's something the body carries: in the chest, in the throat, in the photograph you can't quite look at.

So in the third session we don't argue with the inner critic, and we don't hand out absolution. It isn't ours to give. We let the guilt have its own sound. And the critic too: it has a tone as well, and it has waited a long time to be heard.

"I'm sorry." The first of four old Hawaiian phrases. Said, it's an apology. Sounded, it becomes something else: the grief that was never allowed to flow.

You don't have to tell anyone what it was. Not us, not the group. You can stay muted the whole time. Soft counts, and a hum is a complete practice.


Feel unforgivable? Come anyway.

${TEXT_FACTS}

Join the four sessions:
${textLink(n)}

With love,
Jacob

P.S. If you're thinking "yes, but what I did really is unforgivable": that is the sentence the third session is given to. It isn't a reason to stay away. It's where we begin.

${TEXT_FOOT}`,
  },
  // ---------------------------------------------------------------- 4
  {
    n: 4,
    slug: 'four-sentences',
    subject: 'Four sentences your body already knows',
    preheader: 'I&rsquo;m sorry. Please forgive me. Thank you. I love you. One week until we begin.',
    rows: (n) => [
      `<tr><td style="padding:0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#2A1B2A;"><tr><td class="pad" align="center" style="padding:56px 44px 58px;text-align:center;"><p style="margin:0 0 26px;${F}font-size:11px;letter-spacing:2.5px;color:#E7C9B8;font-weight:600;text-transform:uppercase;">One week from today</p><p class="lyric" style="${C}font-weight:400;font-size:34px;line-height:1.35;color:#F4ECDF;margin:0;">I&rsquo;m sorry.<br>Please forgive me.<br>Thank you.<br>${warm('I love you.')}</p></td></tr></table></td></tr>`,
      row(
        eyebrow(EYE) +
          h1(`Four sentences your body ${em('already knows.')}`) +
          p(HELLO) +
          p('These four sentences come from Hawai&#699;i. The practice is called ho&rsquo;oponopono, and millions of people repeat them every day, like a mantra.') +
          p('I love them. And I&rsquo;ve noticed something, in myself first: you can say all four with a perfectly straight face while your body says something else entirely.') +
          p(`So in the Forgiveness Course we don&rsquo;t only say them. We ${b('sound')} them. Because the body has its own version of each.`, true),
        '46px 44px 6px',
      ),
      row(
        label('Said &rarr; sounded') +
          `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-bottom:1px solid #E2D5C1;">${[
            ['I&rsquo;m sorry', 'The grief that was never allowed to flow.'],
            ['Please forgive me', 'The surrender of being right.'],
            ['Thank you', 'The gratefulness that arises when the system has finally been heard.'],
            ['I love you', 'The love under everything, met as experience and not as belief, in its own time.'],
          ]
            .map(
              ([said, sounded]) =>
                `<tr><td class="said" style="width:200px;padding:18px 16px 18px 0;border-top:1px solid #E2D5C1;vertical-align:top;${C}font-weight:500;font-size:25px;line-height:1.2;color:#C9603A;">${said}</td><td class="sounded" style="padding:20px 0 18px;border-top:1px solid #E2D5C1;vertical-align:top;${F}font-size:15px;line-height:1.6;color:#4A3848;">${sounded}</td></tr>`,
            )
            .join('')}</table>`,
        '30px 44px 0',
      ),
      panel('Try it tonight', null, `Say &ldquo;I&rsquo;m sorry&rdquo; out loud, once. Then don&rsquo;t say it: hum it. One low, soft tone that carries what the words carry. And listen to the three seconds of quiet afterwards. The difference between those two is the whole course.`),
      row(
        h2(`One week from today, ${em('we begin.')}`) +
          schedule() +
          `<p style="${F}font-size:15px;line-height:1.7;color:#4A3848;margin:16px 0 0;">Each session runs 19:00&ndash;21:00 Brussels time, and ${a(n, 'times', 'the course page shows it in your own time', 'schedule')}. Can&rsquo;t be there live? Every session is recorded, the replay is up within a day, and the replays are yours for life.</p>`,
        '40px 44px 0',
      ),
      row(
        p('Daniela has guided forgiveness work for twenty-five years, in groups and one to one. I bring the voice. Between us we hold the space; what happens in it is yours, in its own time.', true),
        '26px 44px 0',
      ),
      offer(n, `Four sessions. ${paleEm('Four sentences.')}`, FACTS, 'Save your place'),
      signoff(n, 'You don&rsquo;t need a good voice for any of this, or any experience with sounding. You can stay muted the whole time.'),
    ],
    text: (n) => `${HELLO}

I'm sorry. Please forgive me. Thank you. I love you.

These four sentences come from Hawai'i. The practice is called ho'oponopono, and millions of people repeat them every day, like a mantra.

I love them. And I've noticed something, in myself first: you can say all four with a perfectly straight face while your body says something else entirely.

So in the Forgiveness Course we don't only say them. We sound them. Because the body has its own version of each.

  I'm sorry: the grief that was never allowed to flow.
  Please forgive me: the surrender of being right.
  Thank you: the gratefulness that arises when the system has finally been heard.
  I love you: the love under everything, met as experience and not as belief, in its own time.

TRY IT TONIGHT
Say "I'm sorry" out loud, once. Then don't say it: hum it. One low, soft tone that carries what the words carry. And listen to the three seconds of quiet afterwards. The difference between those two is the whole course.


ONE WEEK FROM TODAY, WE BEGIN

  Sun 6 Dec   The dynamics of forgiveness: why "just let it go" doesn't work, and what does
  Wed 9 Dec   Forgiving others: naming the pain without condoning the act
  Sun 13 Dec  Forgiving self: meeting the parts of you that were pushed away
  Wed 16 Dec  Living with forgiveness: tying it all together

Each session runs 19:00-21:00 Brussels time; the course page shows it in your own time. Can't be there live? Every session is recorded, the replay is up within a day, and the replays are yours for life.

Daniela has guided forgiveness work for twenty-five years, in groups and one to one. I bring the voice. Between us we hold the space; what happens in it is yours, in its own time.

${TEXT_FACTS}

Save your place:
${textLink(n)}

With love,
Jacob

P.S. You don't need a good voice for any of this, or any experience with sounding. You can stay muted the whole time.

${TEXT_FOOT}`,
  },
  // ---------------------------------------------------------------- 5
  {
    n: 5,
    slug: 'five-good-reasons-not-to-come',
    subject: 'Five good reasons not to come',
    preheader: 'And why each one is the reason to. We begin on Sunday.',
    rows: (n) => [
      hero('https://songdance.co/email/forgiveness-daniela-and-jacob.jpg', 'Daniela Hess and Jacob, smiling side by side', n),
      row(
        eyebrow('The Forgiveness Course&nbsp;&middot; begins Sunday') +
          h1(`Five good reasons ${em('not to come.')}`) +
          p(HELLO) +
          p('On Sunday, Daniela and I begin the Forgiveness Course. If you&rsquo;ve read these emails and haven&rsquo;t joined, I&rsquo;d guess there&rsquo;s a reason. These are the five I&rsquo;d put my money on.', true),
        '46px 44px 6px',
      ),
      row(
        marked([
          ['1', '&ldquo;I&rsquo;m not ready to forgive.&rdquo;', 'Good. Don&rsquo;t be. We don&rsquo;t begin with forgiving. We begin with the resentment, the rage, the <em>never</em>. Nobody will ask you to forgive anyone, at any point.'],
          ['2', '&ldquo;I can&rsquo;t sing.&rdquo;', 'It isn&rsquo;t singing. It&rsquo;s sounding: one honest tone, the sound of what is there. Camera off and microphone off if you like. Half of this practice happens in parked cars.'],
          ['3', '&ldquo;What happened to me is too big for this.&rdquo;', 'It may be too big to forgive. It isn&rsquo;t too big to be heard. You set the volume and the distance, and the voice only brings up what you can be with. If it&rsquo;s raw right now, reply to this email first and we&rsquo;ll think it through with you honestly.'],
          ['4', '&ldquo;I&rsquo;m the one who did the harm.&rdquo;', 'Then the third session is yours. It is given to exactly this: the belief of being unforgivable. And you won&rsquo;t have to say out loud what it was.'],
          ['5', '&ldquo;I can&rsquo;t make the dates.&rdquo;', 'Every session is recorded, the replay is up within a day, and the replays are yours for life. You can do the whole course that way.'],
        ]),
        '26px 44px 0',
      ),
      night(`&ldquo;I came skeptical and left with my chest open. Sounding sounds strange until you do it. ${warm('Then it sounds like the only thing that ever made sense.')}&rdquo;<br><span style="${F}font-style:normal;font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#C9B4C3;line-height:3;">Simone Pugh &middot; Great Britain</span>`),
      offer(n, `Still not ready? ${paleEm('Come anyway.')}`, 'We begin this Sunday, 6&nbsp;December, at 19:00 Brussels time. Four live sessions on Zoom with Daniela Hess and me, and lifetime access to the replays. &euro;147.', 'Join us on Sunday'),
      signoff(n, `Sunday at 19:00 in Brussels is 18:00 in London, 1:00 PM in New York and 10:00 AM in Los Angeles. ${a(n, 'ps', 'The course page shows all four sessions in your own time', 'schedule')}.`),
    ],
    text: (n) => `${HELLO}

On Sunday, Daniela and I begin the Forgiveness Course. If you've read these emails and haven't joined, I'd guess there's a reason. These are the five I'd put my money on.

1. "I'm not ready to forgive."
Good. Don't be. We don't begin with forgiving. We begin with the resentment, the rage, the never. Nobody will ask you to forgive anyone, at any point.

2. "I can't sing."
It isn't singing. It's sounding: one honest tone, the sound of what is there. Camera off and microphone off if you like. Half of this practice happens in parked cars.

3. "What happened to me is too big for this."
It may be too big to forgive. It isn't too big to be heard. You set the volume and the distance, and the voice only brings up what you can be with. If it's raw right now, reply to this email first and we'll think it through with you honestly.

4. "I'm the one who did the harm."
Then the third session is yours. It is given to exactly this: the belief of being unforgivable. And you won't have to say out loud what it was.

5. "I can't make the dates."
Every session is recorded, the replay is up within a day, and the replays are yours for life. You can do the whole course that way.


"I came skeptical and left with my chest open. Sounding sounds strange until you do it. Then it sounds like the only thing that ever made sense."
Simone Pugh, Great Britain


Still not ready? Come anyway.

We begin this Sunday, 6 December, at 19:00 Brussels time (18:00 in London, 1:00 PM in New York, 10:00 AM in Los Angeles). Four live sessions on Zoom with Daniela Hess and me, and lifetime access to the replays. EUR 147 (the page shows it in your own currency).

Join us on Sunday:
${textLink(n)}

With love,
Jacob

${TEXT_FOOT}`,
  },
  // ---------------------------------------------------------------- 6
  {
    n: 6,
    slug: 'today-we-begin',
    subject: 'Today we begin',
    preheader: 'The first session of the Forgiveness Course is today. There&rsquo;s still room for you.',
    rows: (n) => [
      hero('https://songdance.co/media/library/forgiveness-course-banner-email.jpeg', 'A woman with her eyes closed and her palms open, facing the morning light', n),
      row(
        eyebrow('The Forgiveness Course&nbsp;&middot; Sunday 6&nbsp;December') +
          h1(`Today, ${em('we begin.')}`) +
          p(HELLO) +
          p('Today Daniela and I open the Forgiveness Course, and there is still room for you.', true),
        '46px 44px 0',
      ),
      `<tr><td class="pad" style="padding:30px 44px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#2A1B2A;border-radius:4px;"><tr><td align="center" style="padding:30px 20px 10px;text-align:center;"><p style="margin:0;${F}font-size:11px;letter-spacing:2.5px;color:#E7C9B8;font-weight:600;text-transform:uppercase;">The first session &middot; two hours, live on Zoom</p></td></tr><tr><td align="center" style="padding:6px 14px 30px;text-align:center;font-size:0;">${[
        ['19:00', 'Brussels'],
        ['18:00', 'London'],
        ['1:00 PM', 'New York'],
        ['10:00 AM', 'Los Angeles'],
      ]
        .map(
          ([t, c]) =>
            `<span class="clock" style="display:inline-block;width:116px;padding:14px 0 0;vertical-align:top;"><span style="display:block;${S}font-size:25px;line-height:1.2;color:#F4ECDF;">${t}</span><span style="display:block;${F}font-size:11px;letter-spacing:1.6px;text-transform:uppercase;color:#C9B4C3;padding-top:5px;">${c}</span></span>`,
        )
        .join('')}</td></tr></table></td></tr>`,
      row(
        h2(`What to ${em('bring.')}`) +
          marked(
            [
              ['1', 'A room where you can make a sound.', 'Or one where you can&rsquo;t. A hum counts, and so does sounding it silently, fully imagined.'],
              ['2', 'Headphones, if others are home.', 'You can stay muted the whole two hours. Nobody will hear you unless you choose it.'],
              ['3', 'Nothing forgiven. Nothing decided.', 'No good voice, no experience, no readiness. Whatever you&rsquo;re carrying is the right thing to arrive with.'],
            ],
            44,
          ),
        '40px 44px 0',
      ),
      row(
        p(`${b('How to join today:')} register, then sign in to the Songdance app with the same email address. The session waits for you there, with its Zoom link.`) +
          p(`${b('Can&rsquo;t make today?')} Register anyway. The replay is up within a day, and you join us live on Wednesday.`, true),
        '30px 44px 0',
      ),
      night(`When forgiveness feels impossible&hellip;<br>${warm('come anyway.')}`),
      offer(n, `The door is ${paleEm('still open.')}`, FACTS, 'Join today'),
      signoff(n, null, 'See you there, I hope.'),
    ],
    text: (n) => `${HELLO}

Today Daniela and I open the Forgiveness Course, and there is still room for you.

THE FIRST SESSION: two hours, live on Zoom
  19:00 Brussels
  18:00 London
  1:00 PM New York
  10:00 AM Los Angeles


WHAT TO BRING

- A room where you can make a sound. Or one where you can't. A hum counts, and so does sounding it silently, fully imagined.
- Headphones, if others are home. You can stay muted the whole two hours. Nobody will hear you unless you choose it.
- Nothing forgiven. Nothing decided. No good voice, no experience, no readiness. Whatever you're carrying is the right thing to arrive with.

How to join today: register, then sign in to the Songdance app with the same email address. The session waits for you there, with its Zoom link.

Can't make today? Register anyway. The replay is up within a day, and you join us live on Wednesday.

When forgiveness feels impossible... come anyway.

${TEXT_FACTS}

Join today:
${textLink(n)}

See you there, I hope.
Jacob

${TEXT_FOOT}`,
  },
];

for (const e of emails) {
  const html = page(e.subject, e.preheader, e.rows(e.n));
  writeFileSync(join(here, `${e.n}-${e.slug}.html`), html);
  writeFileSync(join(here, `${e.n}-${e.slug}.txt`), e.text(e.n));
  console.log(`${e.n}  ${e.subject}  html ${html.length}  txt ${e.text(e.n).length}`);
}
