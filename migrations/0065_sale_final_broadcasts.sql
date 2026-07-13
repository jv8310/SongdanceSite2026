-- Seed the 5-email "sale ends 15 July" final sequence as DRAFT broadcasts.
-- One per send-day (Sun 12 -> Wed 15 Jul) plus a second on the last day:
--   12jul (heads-up) . 13jul (which course) . 14jul (ends tomorrow) .
--   15jul-am (last day) . 15jul-pm (final hours).
-- All format=html, status=draft, blank audience (whole sendable list). Launch one
-- per day from /admin/broadcasts; nothing sends until launched. Idempotent name guard.

-- Sale · 12 Jul — heads-up (3 days left): the whole sale in one practical note
-- Subject A/B alternatives: Everything is half price until this Wednesday | One quiet, honest note about the sale
INSERT INTO broadcasts (name, subject, preheader, heading, body, format, status)
SELECT 'Sale · 12 Jul — heads-up (3 days left): the whole sale in one practical note', 'The practical note at the end of the story', 'The whole story is told — here is the practical part. Every online course, half price until Wed 15 July.', 'That was the story. Here''s the practical part.',
       '<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>The practical note at the end of the story</title>
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
  }
</style>
</head>
<body style="margin: 0; padding: 0; background-color: #EADFCB; -webkit-font-smoothing: antialiased;">

<span class="preheader">The whole story is told &mdash; here is the practical part. Every online course, half price until Wed 15 July.</span>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #EADFCB;">
<tr><td align="center" style="padding: 24px 12px;">

<table role="presentation" class="wrapper" width="600" cellpadding="0" cellspacing="0" style="width: 600px; background-color: #F4ECDF; border-radius: 4px; overflow: hidden;">

<tr><td align="center" style="background-color: #A14826; padding: 11px 24px; font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 11px; letter-spacing: 1.3px; color: #F4ECDF; font-weight: 600; text-transform: uppercase;">&#10022;&nbsp;&nbsp;Half price ends this Wednesday, 15 July&nbsp;&nbsp;&#10022;</td></tr>

<tr><td class="pad" style="padding: 44px 44px 8px;">
  <p style="margin: 0 0 22px; font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 11px; letter-spacing: 2.5px; color: #A14826; font-weight: 600; text-transform: uppercase;"><span style="display: inline-block; width: 26px; height: 1px; background-color: #A14826; vertical-align: middle; margin-right: 12px;"></span>The launch sale</p>
  <h1 class="h1" style="font-family: ''Spectral'', Georgia, ''Times New Roman'', serif; font-weight: 400; font-size: 40px; line-height: 1.12; color: #2A1B2A; margin: 0 0 26px;">That was the story. <em style="font-family: ''Cormorant Garamond'', Georgia, serif; font-style: italic; font-size: 1.05em; color: #C9603A;">Here&rsquo;s the practical part.</em></h1>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.7; color: #2A1B2A; margin: 0 0 16px;">Hello {{ subscriber.first_name | default: "there" }},</p>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.7; color: #2A1B2A; margin: 0 0 16px;">So &mdash; that was the whole story: Upala, the journeys, the grief, and the practice that grew out of all of it. Thank you for reading to the end. Here&rsquo;s the simple note I promised at the start.</p>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.7; color: #2A1B2A; margin: 0 0 16px;">Until <strong style="font-weight: 600;">this Wednesday, 15 July</strong>, everything is half price &mdash; every online course and every journey. The <a href="https://songdance.co/courses/12-week?utm_source=broadcast&amp;utm_medium=email&amp;utm_campaign=sale_final_2026&amp;utm_content=12jul" style="color: #A14826; text-decoration: underline; text-underline-offset: 2px;">12-Week Course</a>, the <a href="https://songdance.co/courses/certification?utm_source=broadcast&amp;utm_medium=email&amp;utm_campaign=sale_final_2026&amp;utm_content=12jul" style="color: #A14826; text-decoration: underline; text-underline-offset: 2px;">Certification Course</a>, the <a href="https://songdance.co/courses/grief?utm_source=broadcast&amp;utm_medium=email&amp;utm_campaign=sale_final_2026&amp;utm_content=12jul" style="color: #A14826; text-decoration: underline; text-underline-offset: 2px;">Grief Course</a>, and the three self-paced journeys. On Thursday they all go back to full price. (Retreats aside &mdash; those are in-person.)</p>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.7; color: #2A1B2A; margin: 0 0 16px;">No rush and no pressure. Just have a wander while the door is open. It&rsquo;s all in one place.</p>
</td></tr>

<tr><td style="padding: 30px 44px 0;" class="pad">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #4A2540; border-radius: 4px;">
    <tr><td style="padding: 38px 38px;" class="pad">
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 0 0 20px;"><tr>
        <td style="background-color: #C9603A; border-radius: 30px; padding: 9px 18px;"><span style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 15px; font-weight: 700; letter-spacing: 0.5px; color: #F4ECDF;">50% OFF</span></td>
        <td style="padding-left: 14px; font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 11px; letter-spacing: 2.5px; color: #F2DCC9; font-weight: 600; text-transform: uppercase;">ends Wed 15 July</td>
      </tr></table>
      <h2 class="offer-h" style="font-family: ''Spectral'', Georgia, ''Times New Roman'', serif; font-weight: 400; font-size: 31px; line-height: 1.18; color: #F4ECDF; margin: 0 0 18px;"><em style="font-family: ''Cormorant Garamond'', Georgia, serif; font-style: italic; font-size: 1.05em; color: #F2DCC9;">Everything, half price</em></h2>
      <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.7; color: #EADFCB; margin: 0 0 4px;">Every online course and journey &mdash; half price until 23:59 Brussels time on <strong style="font-weight: 600;">Wednesday 15 July</strong>. Thousands of people across the world have done this work, and every Songdance review on Trustpilot is five stars. After Wednesday, full price returns.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 26px 0 6px;"><tr>
        <td style="background-color: #F4ECDF; border-radius: 32px;"><a href="https://songdance.co/courses?utm_source=broadcast&amp;utm_medium=email&amp;utm_campaign=sale_final_2026&amp;utm_content=12jul_cta" style="display: inline-block; font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 14px; font-weight: 600; letter-spacing: 0.3px; color: #4A2540; padding: 15px 34px; text-decoration: none;">Browse all the courses &rarr;</a></td>
      </tr></table>
      <p style="font-family: ''Cormorant Garamond'', Georgia, serif; font-style: italic; font-size: 16px; line-height: 1.5; color: #F2DCC9; margin: 20px 0 0;">Whichever one calls you, take your time inside it &mdash; it&rsquo;s yours for good.</p>
    </td></tr>
  </table>
</td></tr>

<tr><td class="pad" style="padding: 32px 44px 40px;">
  <p style="font-family: ''Cormorant Garamond'', Georgia, serif; font-style: italic; font-size: 18px; line-height: 1.5; color: #4A3848; margin: 0;">With love,<br>Jacob</p>
</td></tr>

<tr><td style="background-color: #EADFCB; padding: 32px 44px 34px;" class="pad">
  <img src="https://songdance.co/brand/logo-wordmark-dark.png" width="130" alt="Songdance" style="width: 130px; height: auto; margin: 0 0 18px;">
  <p style="font-family: ''Cormorant Garamond'', Georgia, serif; font-style: italic; font-size: 16px; line-height: 1.5; color: #7A6A78; margin: 0 0 18px;">The sound was always yours.</p>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 12px; line-height: 1.9; color: #A14826; margin: 0 0 16px;"><a href="https://songdance.co/what-is-svh" style="color: #A14826; text-decoration: none;">what is svh</a>&nbsp;&nbsp;&middot;&nbsp;&nbsp;<a href="https://songdance.co/courses" style="color: #A14826; text-decoration: none;">courses</a>&nbsp;&nbsp;&middot;&nbsp;&nbsp;<a href="https://songdance.co/events" style="color: #A14826; text-decoration: none;">events</a>&nbsp;&nbsp;&middot;&nbsp;&nbsp;<a href="https://songdance.co/about" style="color: #A14826; text-decoration: none;">about</a>&nbsp;&nbsp;&middot;&nbsp;&nbsp;<a href="https://songdance.co/reviews" style="color: #A14826; text-decoration: none;">reviews</a></p>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 11px; line-height: 1.7; color: #7A6A78; margin: 0 0 6px;">Not for you? <a href="{{ unsubscribe_url }}" style="color: #7A6A78; text-decoration: underline;">Unsubscribe</a> &mdash; you won&rsquo;t hear from this list again.</p>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 11px; line-height: 1.7; color: #9A8A78; margin: 0;">Songdance BV &middot; Beaupréstraat 13, 8310 Bruges, Belgium<br>BE0743575076</p>
</td></tr>

</table>

</td></tr>
</table>

</body>
</html>
', 'html', 'draft'
WHERE NOT EXISTS (SELECT 1 FROM broadcasts WHERE name = 'Sale · 12 Jul — heads-up (3 days left): the whole sale in one practical note');

-- Sale · 13 Jul — which course is for you? (2 days left)
-- Subject A/B alternatives: A one-line guide to picking your course | Which Songdance course is yours? (half price ends Wednesday)
INSERT INTO broadcasts (name, subject, preheader, heading, body, format, status)
SELECT 'Sale · 13 Jul — which course is for you? (2 days left)', 'Not sure which one is for you?', 'The voice, the body, a loss, the younger you, or the whole practice — matched in a line each. Half price until Wednesday.', 'Which one is yours?',
       '<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>Not sure which one is for you?</title>
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
  }
</style>
</head>
<body style="margin: 0; padding: 0; background-color: #EADFCB; -webkit-font-smoothing: antialiased;">

<span class="preheader">The voice, the body, a loss, the younger you, or the whole practice &mdash; matched in a line each. Half price until Wednesday.</span>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #EADFCB;">
<tr><td align="center" style="padding: 24px 12px;">

<table role="presentation" class="wrapper" width="600" cellpadding="0" cellspacing="0" style="width: 600px; background-color: #F4ECDF; border-radius: 4px; overflow: hidden;">

<tr><td align="center" style="background-color: #A14826; padding: 11px 24px; font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 11px; letter-spacing: 1.3px; color: #F4ECDF; font-weight: 600; text-transform: uppercase;">&#10022;&nbsp;&nbsp;Half price on every course &mdash; two days left, ends Wednesday 15 July&nbsp;&nbsp;&#10022;</td></tr>

<tr><td class="pad" style="padding: 44px 44px 8px;">
  <p style="margin: 0 0 22px; font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 11px; letter-spacing: 2.5px; color: #A14826; font-weight: 600; text-transform: uppercase;"><span style="display: inline-block; width: 26px; height: 1px; background-color: #A14826; vertical-align: middle; margin-right: 12px;"></span>Two days left</p>
  <h1 class="h1" style="font-family: ''Spectral'', Georgia, ''Times New Roman'', serif; font-weight: 400; font-size: 40px; line-height: 1.12; color: #2A1B2A; margin: 0 0 26px;"><em style="font-family: ''Cormorant Garamond'', Georgia, serif; font-style: italic; font-size: 1.05em; color: #C9603A;">Which one is yours?</em></h1>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.7; color: #2A1B2A; margin: 0 0 16px;">Hello {{ subscriber.first_name | default: "there" }},</p>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.7; color: #2A1B2A; margin: 0 0 16px;">Now that you&rsquo;ve heard the whole story, maybe one course has been quietly circling you. Here&rsquo;s the short version &mdash; matched to where you actually are right now.</p>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.7; color: #2A1B2A; margin: 0 0 16px;">Drawn to your <strong style="font-weight: 600;">voice</strong>, the sound that&rsquo;s already yours? That&rsquo;s the <a href="https://songdance.co/courses/authentic-singing?utm_source=broadcast&amp;utm_medium=email&amp;utm_campaign=sale_final_2026&amp;utm_content=13jul" style="color: #A14826; text-decoration: underline; text-underline-offset: 2px;">Authentic Singing Journey</a>. Want to <strong style="font-weight: 600;">move the body</strong> at home, standing or seated, nothing to learn? The <a href="https://songdance.co/courses/magical-movement?utm_source=broadcast&amp;utm_medium=email&amp;utm_campaign=sale_final_2026&amp;utm_content=13jul" style="color: #A14826; text-decoration: underline; text-underline-offset: 2px;">Magical Movement Journey</a>. Sitting with a <strong style="font-weight: 600;">loss or a big change</strong>? The <a href="https://songdance.co/courses/grief?utm_source=broadcast&amp;utm_medium=email&amp;utm_campaign=sale_final_2026&amp;utm_content=13jul" style="color: #A14826; text-decoration: underline; text-underline-offset: 2px;">Grief Course</a>, with Daniela. Wanting to meet the <strong style="font-weight: 600;">younger you</strong>? <a href="https://songdance.co/courses/inner-child?utm_source=broadcast&amp;utm_medium=email&amp;utm_campaign=sale_final_2026&amp;utm_content=13jul" style="color: #A14826; text-decoration: underline; text-underline-offset: 2px;">Inner Child Healing</a>. And if you want the <strong style="font-weight: 600;">whole practice</strong>, learned properly until you can hold it yourself &mdash; the <a href="https://songdance.co/courses/12-week?utm_source=broadcast&amp;utm_medium=email&amp;utm_campaign=sale_final_2026&amp;utm_content=13jul" style="color: #A14826; text-decoration: underline; text-underline-offset: 2px;">12-Week Course</a>.</p>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.7; color: #2A1B2A; margin: 0 0 16px;">Whichever one is calling, it&rsquo;s <strong style="font-weight: 600;">half price until Wednesday</strong> &mdash; two days left, and then everything returns to full price. Take your time choosing; just don&rsquo;t leave it past then.</p>
</td></tr>

<tr><td style="padding: 30px 44px 0;" class="pad">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #4A2540; border-radius: 4px;">
    <tr><td style="padding: 38px 38px;" class="pad">
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 0 0 20px;"><tr>
        <td style="background-color: #C9603A; border-radius: 30px; padding: 9px 18px;"><span style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 15px; font-weight: 700; letter-spacing: 0.5px; color: #F4ECDF;">50% OFF</span></td>
        <td style="padding-left: 14px; font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 11px; letter-spacing: 2.5px; color: #F2DCC9; font-weight: 600; text-transform: uppercase;">ends Wednesday</td>
      </tr></table>
      <h2 class="offer-h" style="font-family: ''Spectral'', Georgia, ''Times New Roman'', serif; font-weight: 400; font-size: 31px; line-height: 1.18; color: #F4ECDF; margin: 0 0 18px;"><em style="font-family: ''Cormorant Garamond'', Georgia, serif; font-style: italic; font-size: 1.05em; color: #F2DCC9;">Half price</em></h2>
      <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.7; color: #EADFCB; margin: 0 0 4px;">50% off every online course and journey &mdash; the whole library. Ends 23:59 Wednesday 15 July, Brussels time. (Retreats aren&rsquo;t included.)</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 26px 0 6px;"><tr>
        <td style="background-color: #F4ECDF; border-radius: 32px;"><a href="https://songdance.co/courses?utm_source=broadcast&amp;utm_medium=email&amp;utm_campaign=sale_final_2026&amp;utm_content=13jul_cta" style="display: inline-block; font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 14px; font-weight: 600; letter-spacing: 0.3px; color: #4A2540; padding: 15px 34px; text-decoration: none;">Browse all the courses &rarr;</a></td>
      </tr></table>
      <p style="font-family: ''Cormorant Garamond'', Georgia, serif; font-style: italic; font-size: 16px; line-height: 1.5; color: #F2DCC9; margin: 20px 0 0;">Choose the one that&rsquo;s calling &mdash; the price holds until Wednesday.</p>
    </td></tr>
  </table>
</td></tr>

<tr><td class="pad" style="padding: 32px 44px 40px;">
  <p style="font-family: ''Cormorant Garamond'', Georgia, serif; font-style: italic; font-size: 18px; line-height: 1.5; color: #4A3848; margin: 0;">With love,<br>Jacob</p>
</td></tr>

<tr><td style="background-color: #EADFCB; padding: 32px 44px 34px;" class="pad">
  <img src="https://songdance.co/brand/logo-wordmark-dark.png" width="130" alt="Songdance" style="width: 130px; height: auto; margin: 0 0 18px;">
  <p style="font-family: ''Cormorant Garamond'', Georgia, serif; font-style: italic; font-size: 16px; line-height: 1.5; color: #7A6A78; margin: 0 0 18px;">The sound was always yours.</p>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 12px; line-height: 1.9; color: #A14826; margin: 0 0 16px;"><a href="https://songdance.co/what-is-svh" style="color: #A14826; text-decoration: none;">what is svh</a>&nbsp;&nbsp;&middot;&nbsp;&nbsp;<a href="https://songdance.co/courses" style="color: #A14826; text-decoration: none;">courses</a>&nbsp;&nbsp;&middot;&nbsp;&nbsp;<a href="https://songdance.co/events" style="color: #A14826; text-decoration: none;">events</a>&nbsp;&nbsp;&middot;&nbsp;&nbsp;<a href="https://songdance.co/about" style="color: #A14826; text-decoration: none;">about</a>&nbsp;&nbsp;&middot;&nbsp;&nbsp;<a href="https://songdance.co/reviews" style="color: #A14826; text-decoration: none;">reviews</a></p>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 11px; line-height: 1.7; color: #7A6A78; margin: 0 0 6px;">Not for you? <a href="{{ unsubscribe_url }}" style="color: #7A6A78; text-decoration: underline;">Unsubscribe</a> &mdash; you won&rsquo;t hear from this list again.</p>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 11px; line-height: 1.7; color: #9A8A78; margin: 0;">Songdance BV &middot; Beaupréstraat 13, 8310 Bruges, Belgium<br>BE0743575076</p>
</td></tr>

</table>

</td></tr>
</table>

</body>
</html>
', 'html', 'draft'
WHERE NOT EXISTS (SELECT 1 FROM broadcasts WHERE name = 'Sale · 13 Jul — which course is for you? (2 days left)');

-- Sale · 14 Jul — ends tomorrow (half price locks now)
-- Subject A/B alternatives: Tomorrow, everything goes back to full price | One more day at half price — then it's gone | Lock the half price now, begin whenever you're ready
INSERT INTO broadcasts (name, subject, preheader, heading, body, format, status)
SELECT 'Sale · 14 Jul — ends tomorrow (half price locks now)', 'The half price ends tomorrow', 'Lifetime access, self-paced — buying now just holds the 50% for whenever you begin.', 'The price rises tomorrow',
       '<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>The half price ends tomorrow</title>
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
  }
</style>
</head>
<body style="margin: 0; padding: 0; background-color: #EADFCB; -webkit-font-smoothing: antialiased;">

<span class="preheader">Lifetime access, self-paced &mdash; buying now just holds the 50% for whenever you begin.</span>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #EADFCB;">
<tr><td align="center" style="padding: 24px 12px;">

<table role="presentation" class="wrapper" width="600" cellpadding="0" cellspacing="0" style="width: 600px; background-color: #F4ECDF; border-radius: 4px; overflow: hidden;">

<tr><td align="center" style="background-color: #A14826; padding: 11px 24px; font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 11px; letter-spacing: 1.3px; color: #F4ECDF; font-weight: 600; text-transform: uppercase;">&#10022;&nbsp;&nbsp;Half price ends tomorrow &mdash; Wednesday 15 July, at midnight (Brussels)&nbsp;&nbsp;&#10022;</td></tr>

<tr><td class="pad" style="padding: 44px 44px 8px;">
  <p style="margin: 0 0 22px; font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 11px; letter-spacing: 2.5px; color: #A14826; font-weight: 600; text-transform: uppercase;"><span style="display: inline-block; width: 26px; height: 1px; background-color: #A14826; vertical-align: middle; margin-right: 12px;"></span>One day left</p>
  <h1 class="h1" style="font-family: ''Spectral'', Georgia, ''Times New Roman'', serif; font-weight: 400; font-size: 40px; line-height: 1.12; color: #2A1B2A; margin: 0 0 26px;">The price rises <em style="font-family: ''Cormorant Garamond'', Georgia, serif; font-style: italic; font-size: 1.05em; color: #C9603A;">tomorrow</em></h1>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.7; color: #2A1B2A; margin: 0 0 16px;">Hello {{ subscriber.first_name | default: "there" }},</p>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.7; color: #2A1B2A; margin: 0 0 16px;">Here&rsquo;s the quiet part I want you to hear: there is no rush inside the work itself. Every course and journey is yours for life, and every one moves at your pace. So buying today doesn&rsquo;t mean beginning today &mdash; it simply holds the half price for whenever you&rsquo;re ready to begin.</p>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.7; color: #2A1B2A; margin: 0 0 16px;">If you&rsquo;re wondering whether it&rsquo;s real work: thousands of people across the world have done it, and every single Songdance review on Trustpilot is five stars. You&rsquo;d be in good, honest company.</p>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.7; color: #2A1B2A; margin: 0 0 16px;">The 50% ends tomorrow &mdash; <strong style="font-weight: 600;">Wednesday 15 July, at midnight</strong>. After that, everything returns to full price. If a course has been quietly calling you, this is the day to lock it in.</p>
</td></tr>

<tr><td style="padding: 30px 44px 0;" class="pad">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #4A2540; border-radius: 4px;">
    <tr><td style="padding: 38px 38px;" class="pad">
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 0 0 20px;"><tr>
        <td style="background-color: #C9603A; border-radius: 30px; padding: 9px 18px;"><span style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 15px; font-weight: 700; letter-spacing: 0.5px; color: #F4ECDF;">50% OFF</span></td>
        <td style="padding-left: 14px; font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 11px; letter-spacing: 2.5px; color: #F2DCC9; font-weight: 600; text-transform: uppercase;">ends tomorrow, midnight</td>
      </tr></table>
      <h2 class="offer-h" style="font-family: ''Spectral'', Georgia, ''Times New Roman'', serif; font-weight: 400; font-size: 31px; line-height: 1.18; color: #F4ECDF; margin: 0 0 18px;">Half price, held for <em style="font-family: ''Cormorant Garamond'', Georgia, serif; font-style: italic; font-size: 1.05em; color: #F2DCC9;">whenever</em></h2>
      <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.7; color: #EADFCB; margin: 0 0 4px;">Every online course and journey is <strong style="font-weight: 600;">half price</strong> until <strong style="font-weight: 600;">midnight on Wednesday 15 July</strong> (Brussels time). Lifetime access, fully self-paced &mdash; buy now, begin when you&rsquo;re ready. Retreats aren&rsquo;t included. Then it&rsquo;s back to full price.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 26px 0 6px;"><tr>
        <td style="background-color: #F4ECDF; border-radius: 32px;"><a href="https://songdance.co/courses?utm_source=broadcast&amp;utm_medium=email&amp;utm_campaign=sale_final_2026&amp;utm_content=14jul_cta" style="display: inline-block; font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 14px; font-weight: 600; letter-spacing: 0.3px; color: #4A2540; padding: 15px 34px; text-decoration: none;">Browse all the courses &rarr;</a></td>
      </tr></table>
      <p style="font-family: ''Cormorant Garamond'', Georgia, serif; font-style: italic; font-size: 16px; line-height: 1.5; color: #F2DCC9; margin: 20px 0 0;">There&rsquo;s no clock on the work &mdash; only on the price. One day left.</p>
    </td></tr>
  </table>
</td></tr>

<tr><td class="pad" style="padding: 32px 44px 40px;">
  <p style="font-family: ''Cormorant Garamond'', Georgia, serif; font-style: italic; font-size: 18px; line-height: 1.5; color: #4A3848; margin: 0;">With love,<br>Jacob</p>
</td></tr>

<tr><td style="background-color: #EADFCB; padding: 32px 44px 34px;" class="pad">
  <img src="https://songdance.co/brand/logo-wordmark-dark.png" width="130" alt="Songdance" style="width: 130px; height: auto; margin: 0 0 18px;">
  <p style="font-family: ''Cormorant Garamond'', Georgia, serif; font-style: italic; font-size: 16px; line-height: 1.5; color: #7A6A78; margin: 0 0 18px;">The sound was always yours.</p>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 12px; line-height: 1.9; color: #A14826; margin: 0 0 16px;"><a href="https://songdance.co/what-is-svh" style="color: #A14826; text-decoration: none;">what is svh</a>&nbsp;&nbsp;&middot;&nbsp;&nbsp;<a href="https://songdance.co/courses" style="color: #A14826; text-decoration: none;">courses</a>&nbsp;&nbsp;&middot;&nbsp;&nbsp;<a href="https://songdance.co/events" style="color: #A14826; text-decoration: none;">events</a>&nbsp;&nbsp;&middot;&nbsp;&nbsp;<a href="https://songdance.co/about" style="color: #A14826; text-decoration: none;">about</a>&nbsp;&nbsp;&middot;&nbsp;&nbsp;<a href="https://songdance.co/reviews" style="color: #A14826; text-decoration: none;">reviews</a></p>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 11px; line-height: 1.7; color: #7A6A78; margin: 0 0 6px;">Not for you? <a href="{{ unsubscribe_url }}" style="color: #7A6A78; text-decoration: underline;">Unsubscribe</a> &mdash; you won&rsquo;t hear from this list again.</p>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 11px; line-height: 1.7; color: #9A8A78; margin: 0;">Songdance BV &middot; Beaupréstraat 13, 8310 Bruges, Belgium<br>BE0743575076</p>
</td></tr>

</table>

</td></tr>
</table>

</body>
</html>
', 'html', 'draft'
WHERE NOT EXISTS (SELECT 1 FROM broadcasts WHERE name = 'Sale · 14 Jul — ends tomorrow (half price locks now)');

-- Sale · 15 Jul AM — last day, ends tonight at midnight
-- Subject A/B alternatives: Last day: half price ends at midnight | Tonight the price goes back up | This is the last of it — 50% off ends tonight
INSERT INTO broadcasts (name, subject, preheader, heading, body, format, status)
SELECT 'Sale · 15 Jul AM — last day, ends tonight at midnight', 'It ends tonight', 'Half price on every course and journey ends at 23:59 Brussels time tonight.', 'Ends tonight',
       '<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>It ends tonight</title>
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
  }
</style>
</head>
<body style="margin: 0; padding: 0; background-color: #EADFCB; -webkit-font-smoothing: antialiased;">

<span class="preheader">Half price on every course and journey ends at 23:59 Brussels time tonight.</span>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #EADFCB;">
<tr><td align="center" style="padding: 24px 12px;">

<table role="presentation" class="wrapper" width="600" cellpadding="0" cellspacing="0" style="width: 600px; background-color: #F4ECDF; border-radius: 4px; overflow: hidden;">

<tr><td align="center" style="background-color: #A14826; padding: 11px 24px; font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 11px; letter-spacing: 1.3px; color: #F4ECDF; font-weight: 600; text-transform: uppercase;">&#10022;&nbsp;&nbsp;Half price ends tonight at midnight &mdash; 23:59, Wednesday 15 July&nbsp;&nbsp;&#10022;</td></tr>

<tr><td class="pad" style="padding: 44px 44px 8px;">
  <p style="margin: 0 0 22px; font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 11px; letter-spacing: 2.5px; color: #A14826; font-weight: 600; text-transform: uppercase;"><span style="display: inline-block; width: 26px; height: 1px; background-color: #A14826; vertical-align: middle; margin-right: 12px;"></span>The last day</p>
  <h1 class="h1" style="font-family: ''Spectral'', Georgia, ''Times New Roman'', serif; font-weight: 400; font-size: 40px; line-height: 1.12; color: #2A1B2A; margin: 0 0 26px;">Ends <em style="font-family: ''Cormorant Garamond'', Georgia, serif; font-style: italic; font-size: 1.05em; color: #C9603A;">tonight</em></h1>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.7; color: #2A1B2A; margin: 0 0 16px;">Hello {{ subscriber.first_name | default: "there" }},</p>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.7; color: #2A1B2A; margin: 0 0 16px;">The week&rsquo;s story is told &mdash; where it began, what it cost, and what it became. This is one of my last notes about the sale, because the price changes tonight.</p>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.7; color: #2A1B2A; margin: 0 0 16px;">At <strong style="font-weight: 600;">23:59 Brussels time</strong> every course and journey goes back to full price. Which leaves one small question: which door do you keep standing in front of? The <a href="https://songdance.co/courses/12-week?utm_source=broadcast&amp;utm_medium=email&amp;utm_campaign=sale_final_2026&amp;utm_content=15jul-am" style="color: #A14826; text-decoration: underline; text-underline-offset: 2px;"><strong style="font-weight: 600;">12-week course</strong></a>, or the <a href="https://songdance.co/courses/grief?utm_source=broadcast&amp;utm_medium=email&amp;utm_campaign=sale_final_2026&amp;utm_content=15jul-am" style="color: #A14826; text-decoration: underline; text-underline-offset: 2px;"><strong style="font-weight: 600;">grief course</strong></a>, or one of the <a href="https://songdance.co/courses?utm_source=broadcast&amp;utm_medium=email&amp;utm_campaign=sale_final_2026&amp;utm_content=15jul-am" style="color: #A14826; text-decoration: underline; text-underline-offset: 2px;">journeys</a>. Follow the one you can&rsquo;t quite walk past.</p>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.7; color: #2A1B2A; margin: 0 0 16px;">Thousands of people around the world have already begun this work, and every review we&rsquo;ve ever had is five stars. Whenever you&rsquo;re ready, it&rsquo;s here.</p>
</td></tr>

<tr><td style="padding: 30px 44px 0;" class="pad">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #4A2540; border-radius: 4px;">
    <tr><td style="padding: 38px 38px;" class="pad">
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 0 0 20px;"><tr>
        <td style="background-color: #C9603A; border-radius: 30px; padding: 9px 18px;"><span style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 15px; font-weight: 700; letter-spacing: 0.5px; color: #F4ECDF;">LAST DAY</span></td>
        <td style="padding-left: 14px; font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 11px; letter-spacing: 2.5px; color: #F2DCC9; font-weight: 600; text-transform: uppercase;">ends tonight, 23:59</td>
      </tr></table>
      <h2 class="offer-h" style="font-family: ''Spectral'', Georgia, ''Times New Roman'', serif; font-weight: 400; font-size: 31px; line-height: 1.18; color: #F4ECDF; margin: 0 0 18px;">Last <em style="font-family: ''Cormorant Garamond'', Georgia, serif; font-style: italic; font-size: 1.05em; color: #F2DCC9;">day</em></h2>
      <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.7; color: #EADFCB; margin: 0 0 4px;"><strong style="font-weight: 600;">50% off</strong> every online course and journey &mdash; the 12-week course, certification, grief, and all three journeys. Ends <strong style="font-weight: 600;">tonight at midnight (23:59 Brussels)</strong>. Tomorrow it all returns to full price. <em style="font-style: italic;">(Retreats aren&rsquo;t included.)</em></p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 26px 0 6px;"><tr>
        <td style="background-color: #F4ECDF; border-radius: 32px;"><a href="https://songdance.co/courses?utm_source=broadcast&amp;utm_medium=email&amp;utm_campaign=sale_final_2026&amp;utm_content=15jul-am_cta" style="display: inline-block; font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 14px; font-weight: 600; letter-spacing: 0.3px; color: #4A2540; padding: 15px 34px; text-decoration: none;">Choose your course &rarr;</a></td>
      </tr></table>
      <p style="font-family: ''Cormorant Garamond'', Georgia, serif; font-style: italic; font-size: 16px; line-height: 1.5; color: #F2DCC9; margin: 20px 0 0;">Follow the pull tonight &mdash; and I&rsquo;ll see you inside.</p>
    </td></tr>
  </table>
</td></tr>

<tr><td class="pad" style="padding: 32px 44px 40px;">
  <p style="font-family: ''Cormorant Garamond'', Georgia, serif; font-style: italic; font-size: 18px; line-height: 1.5; color: #4A3848; margin: 0;">With love,<br>Jacob</p>
</td></tr>

<tr><td style="background-color: #EADFCB; padding: 32px 44px 34px;" class="pad">
  <img src="https://songdance.co/brand/logo-wordmark-dark.png" width="130" alt="Songdance" style="width: 130px; height: auto; margin: 0 0 18px;">
  <p style="font-family: ''Cormorant Garamond'', Georgia, serif; font-style: italic; font-size: 16px; line-height: 1.5; color: #7A6A78; margin: 0 0 18px;">The sound was always yours.</p>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 12px; line-height: 1.9; color: #A14826; margin: 0 0 16px;"><a href="https://songdance.co/what-is-svh" style="color: #A14826; text-decoration: none;">what is svh</a>&nbsp;&nbsp;&middot;&nbsp;&nbsp;<a href="https://songdance.co/courses" style="color: #A14826; text-decoration: none;">courses</a>&nbsp;&nbsp;&middot;&nbsp;&nbsp;<a href="https://songdance.co/events" style="color: #A14826; text-decoration: none;">events</a>&nbsp;&nbsp;&middot;&nbsp;&nbsp;<a href="https://songdance.co/about" style="color: #A14826; text-decoration: none;">about</a>&nbsp;&nbsp;&middot;&nbsp;&nbsp;<a href="https://songdance.co/reviews" style="color: #A14826; text-decoration: none;">reviews</a></p>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 11px; line-height: 1.7; color: #7A6A78; margin: 0 0 6px;">Not for you? <a href="{{ unsubscribe_url }}" style="color: #7A6A78; text-decoration: underline;">Unsubscribe</a> &mdash; you won&rsquo;t hear from this list again.</p>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 11px; line-height: 1.7; color: #9A8A78; margin: 0;">Songdance BV &middot; Beaupréstraat 13, 8310 Bruges, Belgium<br>BE0743575076</p>
</td></tr>

</table>

</td></tr>
</table>

</body>
</html>
', 'html', 'draft'
WHERE NOT EXISTS (SELECT 1 FROM broadcasts WHERE name = 'Sale · 15 Jul AM — last day, ends tonight at midnight');

-- Sale · 15 Jul PM — final hours, closes at midnight (email 5 of 5)
-- Subject A/B alternatives: The last word before midnight | Half price closes tonight
INSERT INTO broadcasts (name, subject, preheader, heading, body, format, status)
SELECT 'Sale · 15 Jul PM — final hours, closes at midnight (email 5 of 5)', 'A few hours left', 'Half price on every online course & journey — closes at midnight tonight, Brussels time.', 'The last few hours',
       '<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>A few hours left</title>
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
  }
</style>
</head>
<body style="margin: 0; padding: 0; background-color: #EADFCB; -webkit-font-smoothing: antialiased;">

<span class="preheader">Half price on every online course &amp; journey &mdash; closes at midnight tonight, Brussels time.</span>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #EADFCB;">
<tr><td align="center" style="padding: 24px 12px;">

<table role="presentation" class="wrapper" width="600" cellpadding="0" cellspacing="0" style="width: 600px; background-color: #F4ECDF; border-radius: 4px; overflow: hidden;">

<tr><td align="center" style="background-color: #A14826; padding: 11px 24px; font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 11px; letter-spacing: 1.3px; color: #F4ECDF; font-weight: 600; text-transform: uppercase;">&#10022;&nbsp;&nbsp;Half price closes at midnight tonight &mdash; Brussels time&nbsp;&nbsp;&#10022;</td></tr>

<tr><td class="pad" style="padding: 44px 44px 8px;">
  <p style="margin: 0 0 22px; font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 11px; letter-spacing: 2.5px; color: #A14826; font-weight: 600; text-transform: uppercase;"><span style="display: inline-block; width: 26px; height: 1px; background-color: #A14826; vertical-align: middle; margin-right: 12px;"></span>Final hours</p>
  <h1 class="h1" style="font-family: ''Spectral'', Georgia, ''Times New Roman'', serif; font-weight: 400; font-size: 40px; line-height: 1.12; color: #2A1B2A; margin: 0 0 26px;">The <em style="font-family: ''Cormorant Garamond'', Georgia, serif; font-style: italic; font-size: 1.05em; color: #C9603A;">last few hours</em></h1>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.7; color: #2A1B2A; margin: 0 0 16px;">Hello {{ subscriber.first_name | default: "there" }},</p>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.7; color: #2A1B2A; margin: 0 0 16px;">This is my last note about the sale. A few hours left now &mdash; it closes at midnight tonight, and after that everything goes back to full price.</p>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.7; color: #2A1B2A; margin: 0 0 16px;">If something in these emails stayed with you &mdash; a course, a journey, a small yes you haven&rsquo;t quite said out loud &mdash; the door is open at half price until midnight. Then I&rsquo;ll leave you be.</p>
</td></tr>

<tr><td style="padding: 30px 44px 0;" class="pad">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #4A2540; border-radius: 4px;">
    <tr><td style="padding: 38px 38px;" class="pad">
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 0 0 20px;"><tr>
        <td style="background-color: #C9603A; border-radius: 30px; padding: 9px 18px;"><span style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 15px; font-weight: 700; letter-spacing: 0.5px; color: #F4ECDF;">FINAL HOURS</span></td>
        <td style="padding-left: 14px; font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 11px; letter-spacing: 2.5px; color: #F2DCC9; font-weight: 600; text-transform: uppercase;">ends midnight tonight</td>
      </tr></table>
      <h2 class="offer-h" style="font-family: ''Spectral'', Georgia, ''Times New Roman'', serif; font-weight: 400; font-size: 31px; line-height: 1.18; color: #F4ECDF; margin: 0 0 18px;"><em style="font-family: ''Cormorant Garamond'', Georgia, serif; font-style: italic; font-size: 1.05em; color: #F2DCC9;">Everything, half price</em></h2>
      <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.7; color: #EADFCB; margin: 0 0 4px;"><strong style="font-weight: 600;">50% off</strong> every online course &amp; journey &mdash; the 12-Week Course, Certification, Grief, and all three journeys. Closes <strong style="font-weight: 600;">23:59 tonight, Brussels time.</strong> After that, full price returns.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 26px 0 6px;"><tr>
        <td style="background-color: #F4ECDF; border-radius: 32px;"><a href="https://songdance.co/courses?utm_source=broadcast&amp;utm_medium=email&amp;utm_campaign=sale_final_2026&amp;utm_content=15jul-pm_cta" style="display: inline-block; font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 14px; font-weight: 600; letter-spacing: 0.3px; color: #4A2540; padding: 15px 34px; text-decoration: none;">Take one last look &rarr;</a></td>
      </tr></table>
      <p style="font-family: ''Cormorant Garamond'', Georgia, serif; font-style: italic; font-size: 16px; line-height: 1.5; color: #F2DCC9; margin: 20px 0 0;">Whatever you choose, I&rsquo;m glad you&rsquo;re here.</p>
    </td></tr>
  </table>
</td></tr>

<tr><td class="pad" style="padding: 32px 44px 40px;">
  <p style="font-family: ''Cormorant Garamond'', Georgia, serif; font-style: italic; font-size: 18px; line-height: 1.5; color: #4A3848; margin: 0;">With love,<br>Jacob</p>
</td></tr>

<tr><td style="background-color: #EADFCB; padding: 32px 44px 34px;" class="pad">
  <img src="https://songdance.co/brand/logo-wordmark-dark.png" width="130" alt="Songdance" style="width: 130px; height: auto; margin: 0 0 18px;">
  <p style="font-family: ''Cormorant Garamond'', Georgia, serif; font-style: italic; font-size: 16px; line-height: 1.5; color: #7A6A78; margin: 0 0 18px;">The sound was always yours.</p>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 12px; line-height: 1.9; color: #A14826; margin: 0 0 16px;"><a href="https://songdance.co/what-is-svh" style="color: #A14826; text-decoration: none;">what is svh</a>&nbsp;&nbsp;&middot;&nbsp;&nbsp;<a href="https://songdance.co/courses" style="color: #A14826; text-decoration: none;">courses</a>&nbsp;&nbsp;&middot;&nbsp;&nbsp;<a href="https://songdance.co/events" style="color: #A14826; text-decoration: none;">events</a>&nbsp;&nbsp;&middot;&nbsp;&nbsp;<a href="https://songdance.co/about" style="color: #A14826; text-decoration: none;">about</a>&nbsp;&nbsp;&middot;&nbsp;&nbsp;<a href="https://songdance.co/reviews" style="color: #A14826; text-decoration: none;">reviews</a></p>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 11px; line-height: 1.7; color: #7A6A78; margin: 0 0 6px;">Not for you? <a href="{{ unsubscribe_url }}" style="color: #7A6A78; text-decoration: underline;">Unsubscribe</a> &mdash; you won&rsquo;t hear from this list again.</p>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 11px; line-height: 1.7; color: #9A8A78; margin: 0;">Songdance BV &middot; Beaupréstraat 13, 8310 Bruges, Belgium<br>BE0743575076</p>
</td></tr>

</table>

</td></tr>
</table>

</body>
</html>
', 'html', 'draft'
WHERE NOT EXISTS (SELECT 1 FROM broadcasts WHERE name = 'Sale · 15 Jul PM — final hours, closes at midnight (email 5 of 5)');
