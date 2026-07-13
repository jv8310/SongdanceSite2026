-- Reposition the two flagship courses in the 13 Jul "which course" email:
-- the Authentic Singing Journey is singing & mantras; the 12-Week Course is the
-- deep somatic work — the voice of the body and nervous-system regulation. The
-- original draft gave the somatic "voice of the body" framing to the singing
-- journey; this corrects it. UPDATEs the seeded draft in place, guarded on
-- status='draft'. Idempotent.

UPDATE broadcasts
SET body = '<!DOCTYPE html>
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
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.7; color: #2A1B2A; margin: 0 0 16px;">Want to <strong style="font-weight: 600;">sing</strong> &mdash; mantras, melody, the sheer pleasure of your own voice? That&rsquo;s the <a href="https://songdance.co/courses/authentic-singing?utm_source=broadcast&amp;utm_medium=email&amp;utm_campaign=sale_final_2026&amp;utm_content=13jul" style="color: #A14826; text-decoration: underline; text-underline-offset: 2px;">Authentic Singing Journey</a>. Want the <strong style="font-weight: 600;">deep work</strong> &mdash; the voice of the body, meeting what it holds, regulating your own nervous system through sound? The <a href="https://songdance.co/courses/12-week?utm_source=broadcast&amp;utm_medium=email&amp;utm_campaign=sale_final_2026&amp;utm_content=13jul" style="color: #A14826; text-decoration: underline; text-underline-offset: 2px;">12-Week Course</a>, the full Somatic Vocal Healing practice. Prefer to <strong style="font-weight: 600;">move</strong> &mdash; standing or seated, nothing to learn? The <a href="https://songdance.co/courses/magical-movement?utm_source=broadcast&amp;utm_medium=email&amp;utm_campaign=sale_final_2026&amp;utm_content=13jul" style="color: #A14826; text-decoration: underline; text-underline-offset: 2px;">Magical Movement Journey</a>. Carrying a <strong style="font-weight: 600;">loss or a big change</strong>? The <a href="https://songdance.co/courses/grief?utm_source=broadcast&amp;utm_medium=email&amp;utm_campaign=sale_final_2026&amp;utm_content=13jul" style="color: #A14826; text-decoration: underline; text-underline-offset: 2px;">Grief Course</a>, with Daniela. Or to meet the <strong style="font-weight: 600;">younger you</strong> &mdash; the <a href="https://songdance.co/courses/inner-child?utm_source=broadcast&amp;utm_medium=email&amp;utm_campaign=sale_final_2026&amp;utm_content=13jul" style="color: #A14826; text-decoration: underline; text-underline-offset: 2px;">Inner Child Healing Journey</a>.</p>
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
'
WHERE name = 'Sale · 13 Jul — which course is for you? (2 days left)' AND status = 'draft';
