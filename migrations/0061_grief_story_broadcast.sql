-- Seed the "Songdance Story · Part 3 — The Grief Course" broadcast as a DRAFT,
-- in the launch-email design (Spectral / Cormorant / Figtree). It appears in
-- /admin/broadcasts ready to review, test-send, set the audience on, and launch
-- — nothing sends until you launch it. This is the site-list (broadcast) twin of
-- docs/emails/grief-course-story.drip.html: same body, but the footer carries the
-- single {{ unsubscribe_url }} + the literal postal address, and links use
-- utm_source=broadcast. Blank audience = the whole sendable list (no owner split;
-- the grief email goes to everyone). Idempotent via the NOT EXISTS name guard.
--
-- format='html': body IS the full email. The renderer still substitutes
-- {{ subscriber.first_name | default: "there" }} and {{ unsubscribe_url }}.

INSERT INTO broadcasts (name, subject, preheader, heading, body, format, status)
SELECT 'Songdance Story · Part 3 — The Grief Course',
       'The part I’ve never told',
       'The chapter about Upala I’ve kept mostly to myself — and what grew from it.',
       'The part I’ve never told',
       '<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>The part I&rsquo;ve never told</title>
<link href="https://fonts.googleapis.com/css2?family=Spectral:ital,wght@0,400;0,500;1,400&family=Cormorant+Garamond:ital@1&family=Figtree:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  body { margin: 0; padding: 0; background-color: #EADFCB; }
  table { border-collapse: collapse; }
  img { display: block; border: 0; line-height: 100%; outline: none; text-decoration: none; }
  a { color: #A14826; text-decoration: none; }
  .preheader { display: none !important; visibility: hidden; opacity: 0; max-height: 0; overflow: hidden; mso-hide: all; }
  @media only screen and (max-width: 600px) {
    .wrapper { width: 100% !important; }
    .pad { padding-left: 26px !important; padding-right: 26px !important; }
    .h1 { font-size: 34px !important; line-height: 1.15 !important; }
    .offer-h { font-size: 29px !important; line-height: 1.2 !important; }
    .band img { width: 100% !important; }
  }
</style>
</head>
<body style="margin: 0; padding: 0; background-color: #EADFCB; -webkit-font-smoothing: antialiased;">

<span class="preheader">The chapter about Upala I&rsquo;ve kept mostly to myself &mdash; and what grew from it.</span>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #EADFCB;">
<tr><td align="center" style="padding: 24px 12px;">

<table role="presentation" class="wrapper" width="600" cellpadding="0" cellspacing="0" style="width: 600px; background-color: #F4ECDF; border-radius: 4px; overflow: hidden;">

<!-- HERO — Upala sounding by the river -->
<tr><td style="padding: 0;">
  <img src="https://songdance.co/email/upala-sounding.jpg" width="600" alt="Upala sounding, barefoot on a rock by a mountain river" style="width: 100%; height: auto; background-color: #2A1B2A;">
</td></tr>

<!-- INTRO -->
<tr><td class="pad" style="padding: 46px 44px 12px;">
  <p style="margin: 0 0 22px; font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 11px; letter-spacing: 2.5px; color: #A14826; font-weight: 600; text-transform: uppercase;"><span style="display: inline-block; width: 26px; height: 1px; background-color: #A14826; vertical-align: middle; margin-right: 12px;"></span>How it all began (part 3)</p>
  <h1 class="h1" style="font-family: ''Spectral'', Georgia, ''Times New Roman'', serif; font-weight: 400; font-size: 40px; line-height: 1.12; color: #2A1B2A; margin: 0 0 28px;">The part I&rsquo;ve never <em style="font-family: ''Cormorant Garamond'', Georgia, serif; font-style: italic; font-size: 1.05em; color: #C9603A;">told</em>.</h1>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.7; color: #2A1B2A; margin: 0 0 16px;">Hello {{ subscriber.first_name | default: "there" }},</p>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 15px; line-height: 1.7; color: #6A5868; margin: 0 0 20px;">This is the third part of a longer story. If you&rsquo;re just joining, you can read where it begins <a href="https://songdance.co/blog/before-there-was-upala/?utm_source=broadcast&amp;utm_medium=email&amp;utm_campaign=grief_story&amp;utm_content=blog_asj" style="color: #A14826; text-decoration: underline; text-underline-offset: 2px;">here</a>.</p>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.7; color: #2A1B2A; margin: 0 0 16px;">After the Inner Child and Magical Movement journeys, something had quietly grown around us: a real worldwide community. That&rsquo;s when we began the <strong style="font-weight: 600;">Songdance Circle</strong> &mdash; we returned to our old weekly rhythm and promised everyone a brand-new session every single week.</p>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.7; color: #2A1B2A; margin: 0 0 16px;">And we kept that promise. Thirty-minute dance flows, spoken stories set to music, meditations, visualisations, mantras &mdash; a whole stretch of wild, unhurried creation, most of it made while we were living in South Africa. We were even about to buy a house there. Everything was going well.</p>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.7; color: #4A3848; margin: 0;">&hellip;Until &mdash; and this is the part I&rsquo;ve never really told &mdash; something in Upala began to long for something else. Something even freer than anything we were making.</p>
</td></tr>

<!-- NARRATIVE -->
<tr><td class="pad" style="padding: 22px 44px 6px;">
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.7; color: #2A1B2A; margin: 0 0 16px;">It was as if she wanted to dance and sound among the stars &mdash; a kind of freedom I&rsquo;m not sure is possible here, on this earthly plane. Not that she wanted to die. Not at all. In her final months she began recording an album, and she still wanted to record a free dance ritual. But alongside that longing, something in her was simply tired.</p>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.7; color: #2A1B2A; margin: 0 0 16px;">So we stopped travelling and settled back in Belgium. Shortly after, the tumour returned &mdash; and an intense stretch of rapid decline followed.</p>
  <p style="font-family: ''Cormorant Garamond'', Georgia, serif; font-style: italic; font-size: 21px; line-height: 1.5; color: #4A3848; margin: 6px 0 16px;">And then she was gone.</p>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.7; color: #2A1B2A; margin: 0;">What came after was, for me, a full stop. For a long while I wanted to stop Songdance altogether and do something &mdash; anything &mdash; else. It was often simply too painful.</p>
</td></tr>

<tr><td class="pad" style="padding: 20px 44px 6px;">
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.7; color: #2A1B2A; margin: 0;">But two dear friends, Daniela and Christopher, stayed close. Gently, patiently, they helped me turn something almost unbearable into something that could carry me back toward my purpose &mdash; and toward my own life-energy again. That&rsquo;s where <strong style="font-weight: 600;">The Grief Course</strong> was born: out of Daniela&rsquo;s decades of counselling grief, and my own experience of meeting grief in the body, through sound.</p>
</td></tr>

<!-- BAND — Jacob sounding his grief in an open field -->
<tr><td style="padding: 26px 44px 4px;" class="pad band">
  <a href="https://songdance.co/courses/grief?utm_source=broadcast&amp;utm_medium=email&amp;utm_campaign=grief_story&amp;utm_content=band" style="text-decoration: none; display: block;"><img src="https://songdance.co/email/grief-jacob-sounding.jpg" width="512" alt="Jacob sounding with open arms in an open field" style="width: 100%; height: auto; border-radius: 4px; background-color: #2A1B2A;"></a>
</td></tr>

<!-- LYRIC PULL-QUOTE -->
<tr><td class="pad" style="padding: 28px 44px 16px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td style="border-left: 2px solid #C9603A; padding: 2px 0 2px 20px;"><p style="font-family: ''Cormorant Garamond'', Georgia, serif; font-style: italic; font-size: 23px; line-height: 1.4; color: #4A3848; margin: 0;">Grief is not the pain. It is the process that helps you move through it.</p></td>
  </tr></table>
</td></tr>

<tr><td class="pad" style="padding: 8px 44px 6px;">
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.7; color: #2A1B2A; margin: 0;">It&rsquo;s for anyone living through a big, irrevocable change &mdash; because where there is change, there is grief. Not to rush it, or to &ldquo;heal&rdquo; it away, but to be with it, and to let it move.</p>
</td></tr>

<!-- OFFER BOX (gentle) -->
<tr><td style="padding: 34px 44px 0;" class="pad">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #4A2540; border-radius: 4px;">
    <tr><td style="padding: 40px 38px;" class="pad">
      <p style="margin: 0 0 16px; font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 11px; letter-spacing: 2.5px; color: #E7C9B8; font-weight: 600; text-transform: uppercase;">The Grief Course</p>
      <h2 class="offer-h" style="font-family: ''Spectral'', Georgia, ''Times New Roman'', serif; font-weight: 400; font-size: 32px; line-height: 1.18; color: #F4ECDF; margin: 0 0 20px;">You don&rsquo;t have to cross <em style="font-family: ''Cormorant Garamond'', Georgia, serif; font-style: italic; font-size: 1.05em; color: #F2DCC9;">alone</em>.</h2>
      <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.7; color: #EADFCB; margin: 0 0 4px;">Four sessions with Daniela and me, to meet your grief &mdash; of any size &mdash; in a conscious, gentle way. Lifetime access, and you can begin whenever you&rsquo;re ready.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 28px 0 6px;"><tr>
        <td style="background-color: #F4ECDF; border-radius: 32px;"><a href="https://songdance.co/courses/grief?utm_source=broadcast&amp;utm_medium=email&amp;utm_campaign=grief_story&amp;utm_content=discover" style="display: inline-block; font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 14px; font-weight: 600; letter-spacing: 0.3px; color: #4A2540; padding: 15px 34px; text-decoration: none;">Discover The Grief Course &rarr;</a></td>
      </tr></table>
      <p style="font-family: ''Cormorant Garamond'', Georgia, serif; font-style: italic; font-size: 17px; line-height: 1.5; color: #F2DCC9; margin: 22px 0 0;">It&rsquo;s part of the sale too &mdash; half price until 15 July. But there&rsquo;s no rush; it will be here when you need it.</p>
    </td></tr>
  </table>
</td></tr>

<!-- SIGN-OFF -->
<tr><td class="pad" style="padding: 34px 44px 40px;">
  <p style="font-family: ''Cormorant Garamond'', Georgia, serif; font-style: italic; font-size: 18px; line-height: 1.5; color: #4A3848; margin: 0;">With love,<br>Jacob</p>
</td></tr>

<tr><td style="background-color: #EADFCB; padding: 32px 44px 34px;" class="pad">
  <img src="https://songdance.co/brand/logo-wordmark-dark.png" width="130" alt="Songdance" style="width: 130px; height: auto; margin: 0 0 18px;">
  <p style="font-family: ''Cormorant Garamond'', Georgia, serif; font-style: italic; font-size: 16px; line-height: 1.5; color: #7A6A78; margin: 0 0 18px;">Her sound is still here.</p>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 12px; line-height: 1.9; color: #A14826; margin: 0 0 16px;"><a href="https://songdance.co/what-is-svh" style="color: #A14826; text-decoration: none;">what is svh</a>&nbsp;&nbsp;&middot;&nbsp;&nbsp;<a href="https://songdance.co/courses" style="color: #A14826; text-decoration: none;">courses</a>&nbsp;&nbsp;&middot;&nbsp;&nbsp;<a href="https://songdance.co/events" style="color: #A14826; text-decoration: none;">events</a>&nbsp;&nbsp;&middot;&nbsp;&nbsp;<a href="https://songdance.co/about" style="color: #A14826; text-decoration: none;">about</a>&nbsp;&nbsp;&middot;&nbsp;&nbsp;<a href="https://songdance.co/reviews" style="color: #A14826; text-decoration: none;">reviews</a></p>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 11px; line-height: 1.7; color: #7A6A78; margin: 0 0 6px;">A quiet list &mdash; about one email a month. A little more during the launch: between now and 15 July you&rsquo;ll get a few emails about the new website and the courses.</p>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 11px; line-height: 1.7; color: #7A6A78; margin: 0 0 6px;">Not for you? <a href="{{ unsubscribe_url }}" style="color: #7A6A78; text-decoration: underline;">Unsubscribe</a> &mdash; you won&rsquo;t hear from this list again.</p>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 11px; line-height: 1.7; color: #9A8A78; margin: 0;">Songdance BV &middot; Beaupréstraat 13, 8310 Bruges, Belgium<br>BE0743575076</p>
</td></tr>

</table>

</td></tr>
</table>

</body>
</html>
',
       'html', 'draft'
WHERE NOT EXISTS (SELECT 1 FROM broadcasts WHERE name = 'Songdance Story · Part 3 — The Grief Course');
