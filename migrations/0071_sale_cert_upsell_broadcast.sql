-- A 5th sale draft: the Certification path, sent only to people who already own
-- the 12-Week Course (Drip tag prod_SVH_12w → mirrored locally as prod_svh_12w).
-- They are the one warm audience for the certification at half price off list,
-- and they're deliberately KEPT IN the general sale sequence too (for grief /
-- journeys) — this is an extra, tailored send, not a replacement.
--
-- Targeting: include prod_svh_12w, exclude prod_svh_9m (so anyone who already
-- holds the certification — incl. bundle buyers, who carry both tags — is left
-- out; the exclude wins). format=html, status=draft — nothing sends until it is
-- launched by hand from /admin/broadcasts. Idempotent name guard.
--
-- Copy-book: facilitators HOLD SPACE, the person heals themselves — the pitch is
-- "learn to hold this for others", never "heal others". No outcome promises; the
-- guarantee is about fit. Prices: certification is 50% off its €1,500 list =
-- €750 during the promo (variant.ts pauses the mid-cohort price for the promo).

INSERT INTO broadcasts (name, subject, preheader, heading, body, format, status, audience_include_tags, audience_exclude_tags)
SELECT
  'Sale · Certification path — for 12-week graduates (half price to 15 July)',
  'You’ve done the 12-week — the certification is half price too',
  'You’ve walked the practice in your own body. The path to holding it for others is half price until Wednesday.',
  'Now — hold it for others?',
  '<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>You have done the 12-week — the certification is half price too</title>
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

<span class="preheader">You&rsquo;ve walked the practice in your own body. The path to holding it for others is half price until Wednesday.</span>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #EADFCB;">
<tr><td align="center" style="padding: 24px 12px;">

<table role="presentation" class="wrapper" width="600" cellpadding="0" cellspacing="0" style="width: 600px; background-color: #F4ECDF; border-radius: 4px; overflow: hidden;">

<tr><td align="center" style="background-color: #A14826; padding: 11px 24px; font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 11px; letter-spacing: 1.3px; color: #F4ECDF; font-weight: 600; text-transform: uppercase;">&#10022;&nbsp;&nbsp;The Certification path &mdash; half price, ends Wednesday 15 July&nbsp;&nbsp;&#10022;</td></tr>

<tr><td class="pad" style="padding: 44px 44px 8px;">
  <p style="margin: 0 0 22px; font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 11px; letter-spacing: 2.5px; color: #A14826; font-weight: 600; text-transform: uppercase;"><span style="display: inline-block; width: 26px; height: 1px; background-color: #A14826; vertical-align: middle; margin-right: 12px;"></span>For 12-week graduates</p>
  <h1 class="h1" style="font-family: ''Spectral'', Georgia, ''Times New Roman'', serif; font-weight: 400; font-size: 40px; line-height: 1.12; color: #2A1B2A; margin: 0 0 26px;">You&rsquo;ve walked it. Now &mdash; <em style="font-family: ''Cormorant Garamond'', Georgia, serif; font-style: italic; font-size: 1.05em; color: #C9603A;">hold it for others?</em></h1>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.7; color: #2A1B2A; margin: 0 0 16px;">Hello {{ subscriber.first_name | default: "there" }},</p>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.7; color: #2A1B2A; margin: 0 0 16px;">You&rsquo;ve already done the deep work &mdash; the twelve weeks, the practice, in your own body. So this note is just for you.</p>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.7; color: #2A1B2A; margin: 0 0 16px;">If people have begun asking you to sit with them &mdash; or you feel the quiet pull to hold this work for others &mdash; the <a href="https://songdance.co/courses/certification?utm_source=broadcast&amp;utm_medium=email&amp;utm_campaign=sale_final_2026&amp;utm_content=cert" style="color: #A14826; text-decoration: underline; text-underline-offset: 2px;">Certification path</a> is the next step. It&rsquo;s the practice you already know, learned again from the other side of the room: how to hold the space so the person in front of you can meet their own sound and do their own healing. You never carry it for them &mdash; you hold it steady while they do.</p>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.7; color: #2A1B2A; margin: 0 0 16px;">During the launch sale it&rsquo;s <strong style="font-weight: 600;">half price</strong> &mdash; and, like everything, only until <strong style="font-weight: 600;">Wednesday 15 July</strong>. After that it returns to full price.</p>
</td></tr>

<tr><td style="padding: 30px 44px 0;" class="pad">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #4A2540; border-radius: 4px;">
    <tr><td style="padding: 38px 38px;" class="pad">
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 0 0 20px;"><tr>
        <td style="background-color: #C9603A; border-radius: 30px; padding: 9px 18px;"><span style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 15px; font-weight: 700; letter-spacing: 0.5px; color: #F4ECDF;">50% OFF</span></td>
        <td style="padding-left: 14px; font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 11px; letter-spacing: 2.5px; color: #F2DCC9; font-weight: 600; text-transform: uppercase;">ends Wednesday</td>
      </tr></table>
      <h2 class="offer-h" style="font-family: ''Spectral'', Georgia, ''Times New Roman'', serif; font-weight: 400; font-size: 31px; line-height: 1.18; color: #F4ECDF; margin: 0 0 18px;">The <em style="font-family: ''Cormorant Garamond'', Georgia, serif; font-style: italic; font-size: 1.05em; color: #F2DCC9;">Certification path</em></h2>
      <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.7; color: #EADFCB; margin: 0 0 4px;">The full training to hold Somatic Vocal Healing for others. Half price until 23:59 Brussels time on <strong style="font-weight: 600;">Wednesday 15 July</strong>.</p>
      <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 15px; line-height: 1.85; color: #EADFCB; margin: 14px 0 0;">Certification path <span style="color: #C9A7BE; text-decoration: line-through;">&euro;1,500</span> &rarr; <strong style="color: #F4ECDF; font-weight: 600;">&euro;750</strong>. Pay in full, or over three or six months.</p>
      <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 12px; line-height: 1.6; color: #C9A7BE; margin: 6px 0 0;">Shown in euros &mdash; you&rsquo;ll see your own currency at checkout.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 26px 0 6px;"><tr>
        <td style="background-color: #F4ECDF; border-radius: 32px;"><a href="https://songdance.co/courses/certification?utm_source=broadcast&amp;utm_medium=email&amp;utm_campaign=sale_final_2026&amp;utm_content=cert_cta" style="display: inline-block; font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 14px; font-weight: 600; letter-spacing: 0.3px; color: #4A2540; padding: 15px 34px; text-decoration: none;">See the certification &rarr;</a></td>
      </tr></table>
      <p style="font-family: ''Cormorant Garamond'', Georgia, serif; font-style: italic; font-size: 16px; line-height: 1.5; color: #F2DCC9; margin: 20px 0 0;">The work already lives in you &mdash; this is learning to hold it for another.</p>
    </td></tr>
  </table>
</td></tr>

<tr><td class="pad" style="padding: 26px 44px 0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid rgba(161,72,38,0.28); border-radius: 6px;">
    <tr><td style="padding: 15px 20px; font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.65; color: #6A5A68;"><strong style="color: #2A1B2A; font-weight: 600;">30-day money-back guarantee.</strong> Begin the training; if within 30 days it isn&rsquo;t your path, write to us for a full refund &mdash; no forms, no reason needed.</td></tr>
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
</html>',
  'html', 'draft', 'prod_svh_12w', 'prod_svh_9m'
WHERE NOT EXISTS (
  SELECT 1 FROM broadcasts WHERE name = 'Sale · Certification path — for 12-week graduates (half price to 15 July)'
);
