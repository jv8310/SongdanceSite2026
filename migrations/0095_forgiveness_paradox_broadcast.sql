-- Seed a second Forgiveness Course broadcast as a DRAFT: "Forgiveness is a
-- paradox" — forgiveness with the body, through the voice, and with Daniela.
-- It appears in /admin/broadcasts ready to review, test-send and launch;
-- nothing sends until you launch it. Source of the words and markup:
-- docs/emails/forgiveness-paradox.broadcast.html (+ .txt for the plain-text
-- part); body and body_text below are those two files verbatim (quotes
-- doubled), so a change goes into both places.
--
-- It replaces, rather than follows, the launch draft of 0093 ("The Forgiveness
-- Course — registrations open (December 2026)"): send one of the two. 0093's
-- row is left exactly as it is (it may have been edited in the admin).
--
-- Audience: everyone sendable except
--   in-drip           the buyers mirrored from Drip, who get the Drip twin
--                     instead (CLAUDE.md, "Don't double-send with Drip");
--   prod_forgiveness  anyone already registered (they also carry in-drip,
--                     so this only says it out loud).
-- Unsubscribes and suppressions are left out by the send itself.
--
-- format='html': body IS the full email. The renderer substitutes
-- {{ subscriber.first_name | default: "there" }}, {{ subscriber.email | url_encode }}
-- (the checkout links arrive with the address filled in, as the abandoned-checkout
-- email's do) and {{ unsubscribe_url }}. The footer carries the postal address,
-- so ensureAddress adds nothing. The hero is public/email/forgiveness-hand-at-throat.jpg,
-- which deploys with this migration.
--
-- Idempotent via the NOT EXISTS name guard.

INSERT INTO broadcasts (name, subject, preheader, heading, body, body_text, format, status, audience_exclude_tags)
SELECT 'The Forgiveness Course — forgiveness is a paradox (November 2026)',
       'You can’t decide to forgive',
       'Forgiveness is a paradox. Four live sessions with Daniela and me, from 6 December: with the body, through the voice.',
       'Forgiveness is a paradox.',
       '<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>Forgiveness is a paradox</title>
<link href="https://fonts.googleapis.com/css2?family=Spectral:ital,wght@0,400;0,500;1,400&family=Cormorant+Garamond:ital,wght@1,400;1,500&family=Figtree:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  body { margin: 0; padding: 0; background-color: #EADFCB; }
  table { border-collapse: collapse; }
  img { display: block; border: 0; line-height: 100%; outline: none; text-decoration: none; }
  a { color: #A14826; text-decoration: none; }
  .preheader { display: none !important; visibility: hidden; opacity: 0; max-height: 0; overflow: hidden; mso-hide: all; }
  @media only screen and (max-width: 600px) {
    .wrapper { width: 100% !important; }
    .pad { padding-left: 26px !important; padding-right: 26px !important; }
    .h1 { font-size: 36px !important; line-height: 1.12 !important; }
    .h2 { font-size: 27px !important; line-height: 1.22 !important; }
    .lyric { font-size: 27px !important; }
    .offer-h { font-size: 29px !important; line-height: 1.2 !important; }
    .num { width: 44px !important; font-size: 30px !important; }
    .when { width: 78px !important; }
    .band img { width: 100% !important; }
  }
</style>
</head>
<body style="margin: 0; padding: 0; background-color: #EADFCB; -webkit-font-smoothing: antialiased;">

<span class="preheader">Forgiveness is a paradox. Four live sessions with Daniela and me, from 6 December: with the body, through the voice.&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</span>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #EADFCB;">
<tr><td align="center" style="padding: 24px 12px;">

<table role="presentation" class="wrapper" width="600" cellpadding="0" cellspacing="0" style="width: 600px; background-color: #F4ECDF; border-radius: 4px; overflow: hidden;">

<!-- HERO: a woman with her hand resting at her throat, the body and the voice -->
<tr><td style="padding: 0;">
  <a href="https://songdance.co/courses/forgiveness?utm_source=broadcast&amp;utm_medium=email&amp;utm_campaign=forgiveness_paradox&amp;utm_content=hero" style="text-decoration: none; display: block;"><img src="https://songdance.co/email/forgiveness-hand-at-throat.jpg" width="600" alt="A woman at dusk, her hand resting at her throat" style="width: 100%; height: auto; background-color: #4A3848;"></a>
</td></tr>

<!-- OPENING -->
<tr><td class="pad" style="padding: 46px 44px 8px;">
  <p style="margin: 0 0 22px; font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 11px; letter-spacing: 2.5px; color: #A14826; font-weight: 600; text-transform: uppercase;"><span style="display: inline-block; width: 26px; height: 1px; background-color: #A14826; vertical-align: middle; margin-right: 12px;"></span>The Forgiveness Course&nbsp;&middot; 6&ndash;16&nbsp;December</p>
  <h1 class="h1" style="font-family: ''Spectral'', Georgia, ''Times New Roman'', serif; font-weight: 400; font-size: 44px; line-height: 1.1; color: #2A1B2A; margin: 0 0 30px;">Forgiveness is a <em style="font-family: ''Cormorant Garamond'', Georgia, serif; font-style: italic; font-weight: 500; font-size: 1.05em; color: #C9603A;">paradox.</em></h1>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.7; color: #2A1B2A; margin: 0 0 16px;">Hello {{ subscriber.first_name | default: "there" }},</p>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.7; color: #2A1B2A; margin: 0 0 16px;">Everyone agrees forgiveness is good for you. Hardly anyone can do it on command.</p>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.7; color: #2A1B2A; margin: 0 0 16px;">You can decide to forgive. You can say the words and mean them, write the name on a slip of paper and burn it. And then one night, at three o&rsquo;clock, it&rsquo;s back: the tight jaw, the heat in the chest, the old conversation playing in your head.</p>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.7; color: #2A1B2A; margin: 0;">That isn&rsquo;t a weakness of character. It&rsquo;s the paradox at the heart of forgiveness, and once you see it, a lot of things start to make sense.</p>
</td></tr>

<!-- THREE PARADOXES -->
<tr><td class="pad" style="padding: 34px 44px 6px;">
  <p style="margin: 0 0 6px; font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 11px; letter-spacing: 2.5px; color: #A14826; font-weight: 600; text-transform: uppercase;">Three paradoxes</p>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-bottom: 1px solid #E2D5C1;">
    <tr>
      <td class="num" style="width: 56px; padding: 20px 0 22px; border-top: 1px solid #E2D5C1; vertical-align: top; font-family: ''Cormorant Garamond'', Georgia, serif; font-style: italic; font-weight: 500; font-size: 36px; line-height: 1; color: #C9603A;">I</td>
      <td style="padding: 20px 0 22px; border-top: 1px solid #E2D5C1; vertical-align: top;">
        <p style="font-family: ''Spectral'', Georgia, ''Times New Roman'', serif; font-size: 21px; line-height: 1.3; color: #2A1B2A; margin: 0 0 8px;">The harder you try, the further away it gets.</p>
        <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 15px; line-height: 1.7; color: #4A3848; margin: 0;">Forgiveness decided in the head stays in the head. The body was never asked. It still holds what happened: the anger, the grief, the shame. And a body that hasn&rsquo;t been heard doesn&rsquo;t sign anything.</p>
      </td>
    </tr>
    <tr>
      <td class="num" style="width: 56px; padding: 20px 0 22px; border-top: 1px solid #E2D5C1; vertical-align: top; font-family: ''Cormorant Garamond'', Georgia, serif; font-style: italic; font-weight: 500; font-size: 36px; line-height: 1; color: #C9603A;">II</td>
      <td style="padding: 20px 0 22px; border-top: 1px solid #E2D5C1; vertical-align: top;">
        <p style="font-family: ''Spectral'', Georgia, ''Times New Roman'', serif; font-size: 21px; line-height: 1.3; color: #2A1B2A; margin: 0 0 8px;">The way to forgiveness runs through unforgiveness.</p>
        <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 15px; line-height: 1.7; color: #4A3848; margin: 0;">So we don&rsquo;t start with forgiving. We start where you actually are: the resentment, the rage, the <em style="font-family: ''Cormorant Garamond'', Georgia, serif; font-style: italic; font-size: 1.25em; color: #2A1B2A;">never.</em> Not to keep it, and not to excuse what was done, but to give it a voice at last. Everything wants to be acknowledged before it can go away by itself.</p>
      </td>
    </tr>
    <tr>
      <td class="num" style="width: 56px; padding: 20px 0 24px; border-top: 1px solid #E2D5C1; vertical-align: top; font-family: ''Cormorant Garamond'', Georgia, serif; font-style: italic; font-weight: 500; font-size: 36px; line-height: 1; color: #C9603A;">III</td>
      <td style="padding: 20px 0 24px; border-top: 1px solid #E2D5C1; vertical-align: top;">
        <p style="font-family: ''Spectral'', Georgia, ''Times New Roman'', serif; font-size: 21px; line-height: 1.3; color: #2A1B2A; margin: 0 0 8px;">At the very bottom, there may be nothing to forgive.</p>
        <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 15px; line-height: 1.7; color: #4A3848; margin: 0 0 12px;">Go below every hurt, and below that, and you reach the oldest one: separation. Me over here, you over there. Underneath it is something that was never broken. But you can&rsquo;t skip to it. You only get there by walking through the first two.</p>
        <p style="font-family: ''Cormorant Garamond'', Georgia, serif; font-style: italic; font-size: 20px; line-height: 1.45; color: #4A3848; margin: 0;">It is true that we are separate, and it is true that we are one, at the same time. Maybe in the softness of that paradox, there&rsquo;s also healing.</p>
      </td>
    </tr>
  </table>
</td></tr>

<!-- LYRIC BAND -->
<tr><td style="padding: 34px 0 0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #2A1B2A;">
    <tr><td class="pad" align="center" style="padding: 44px 44px 46px; text-align: center;">
      <p class="lyric" style="font-family: ''Cormorant Garamond'', Georgia, serif; font-style: italic; font-weight: 400; font-size: 32px; line-height: 1.3; color: #F4ECDF; margin: 0;">The mind says <span style="color: #F2DCC9;">forgiven.</span><br>The body says <span style="color: #EBC9B5; font-weight: 500;">not yet.</span></p>
    </td></tr>
  </table>
</td></tr>

<!-- WITH THE BODY, THROUGH THE VOICE -->
<tr><td class="pad" style="padding: 44px 44px 6px;">
  <h2 class="h2" style="font-family: ''Spectral'', Georgia, ''Times New Roman'', serif; font-weight: 400; font-size: 30px; line-height: 1.2; color: #2A1B2A; margin: 0 0 22px;">So we forgive <em style="font-family: ''Cormorant Garamond'', Georgia, serif; font-style: italic; font-weight: 500; font-size: 1.05em; color: #C9603A;">with</em> the body, through the voice.</h2>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.7; color: #2A1B2A; margin: 0 0 16px;">That&rsquo;s why the Forgiveness Course doesn&rsquo;t ask you to forgive. It asks your body to take part, and the voice is how a body takes part.</p>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.7; color: #2A1B2A; margin: 0;">Not singing. Sounding: one honest tone, the sound of what is there right now. The sound of the anger you&rsquo;ve been polite about for years. The sound of the guilt you&rsquo;ve carried for something you did. Once it has a voice, it has been heard. And acknowledged things tend to leave on their own.</p>
</td></tr>

<!-- HO''OPONOPONO, SOUNDED -->
<tr><td class="pad" style="padding: 26px 44px 6px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #FAF5EA; border: 1px solid #E2D5C1; border-radius: 4px;">
    <tr><td style="padding: 26px 28px 26px;">
      <p style="margin: 0 0 12px; font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 11px; letter-spacing: 2.5px; color: #A14826; font-weight: 600; text-transform: uppercase;">Ho&rsquo;oponopono, sounded</p>
      <p style="font-family: ''Cormorant Garamond'', Georgia, serif; font-style: italic; font-weight: 500; font-size: 23px; line-height: 1.4; color: #2A1B2A; margin: 0 0 12px;">I&rsquo;m sorry. Please forgive me.<br>Thank you. I love you.</p>
      <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 15px; line-height: 1.7; color: #4A3848; margin: 0;">Four old Hawaiian phrases, said by millions as a mantra. In the course we don&rsquo;t only say them. We sound them, because the body has its own version of each.</p>
    </td></tr>
  </table>
</td></tr>

<!-- DANIELA -->
<tr><td style="padding: 40px 44px 4px;" class="pad band">
  <img src="https://songdance.co/email/forgiveness-daniela-and-jacob.jpg" width="512" alt="Daniela Hess and Jacob, smiling side by side" style="width: 100%; height: auto; border-radius: 4px; background-color: #4A3848;">
</td></tr>
<tr><td class="pad" style="padding: 26px 44px 6px;">
  <h2 class="h2" style="font-family: ''Spectral'', Georgia, ''Times New Roman'', serif; font-weight: 400; font-size: 30px; line-height: 1.2; color: #2A1B2A; margin: 0 0 20px;">And with my good friend <em style="font-family: ''Cormorant Garamond'', Georgia, serif; font-style: italic; font-weight: 500; font-size: 1.05em; color: #C9603A;">Daniela.</em></h2>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.7; color: #2A1B2A; margin: 0 0 16px;">I&rsquo;m holding these four sessions with Daniela Hess. She has guided forgiveness work, in groups and one to one, for twenty-five years, and she is one of the most unhurried people I know.</p>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.7; color: #2A1B2A; margin: 0 0 16px;">In the hardest stretch of my life, she was one of the two friends who stayed close. The Grief Course grew out of that time, and we made it together. This is the next one.</p>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.7; color: #2A1B2A; margin: 0;">She brings twenty-five years of forgiveness work. I bring the voice. Between us we hold the space; what happens in it is yours, in its own time.</p>
</td></tr>

<!-- THE FOUR SESSIONS -->
<tr><td class="pad" style="padding: 36px 44px 6px;">
  <p style="margin: 0 0 6px; font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 11px; letter-spacing: 2.5px; color: #A14826; font-weight: 600; text-transform: uppercase;">Four sessions &middot; live on Zoom</p>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-bottom: 1px solid #E2D5C1;">
    <tr>
      <td class="when" style="padding: 13px 0; border-top: 1px solid #E2D5C1; width: 96px; vertical-align: top;"><p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 11px; letter-spacing: 1.6px; text-transform: uppercase; color: #A14826; font-weight: 600; margin: 4px 0 0;">Sun 6 Dec</p></td>
      <td style="padding: 13px 0; border-top: 1px solid #E2D5C1; vertical-align: top;"><p style="font-family: ''Spectral'', Georgia, ''Times New Roman'', serif; font-size: 18px; line-height: 1.3; color: #2A1B2A; margin: 0;">The dynamics of forgiveness</p><p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.5; color: #6A5868; margin: 3px 0 0;">why &ldquo;just let it go&rdquo; doesn&rsquo;t work, and what does</p></td>
    </tr><tr>
      <td class="when" style="padding: 13px 0; border-top: 1px solid #E2D5C1; width: 96px; vertical-align: top;"><p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 11px; letter-spacing: 1.6px; text-transform: uppercase; color: #A14826; font-weight: 600; margin: 4px 0 0;">Wed 9 Dec</p></td>
      <td style="padding: 13px 0; border-top: 1px solid #E2D5C1; vertical-align: top;"><p style="font-family: ''Spectral'', Georgia, ''Times New Roman'', serif; font-size: 18px; line-height: 1.3; color: #2A1B2A; margin: 0;">Forgiving others</p><p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.5; color: #6A5868; margin: 3px 0 0;">naming the pain without condoning the act</p></td>
    </tr><tr>
      <td class="when" style="padding: 13px 0; border-top: 1px solid #E2D5C1; width: 96px; vertical-align: top;"><p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 11px; letter-spacing: 1.6px; text-transform: uppercase; color: #A14826; font-weight: 600; margin: 4px 0 0;">Sun 13 Dec</p></td>
      <td style="padding: 13px 0; border-top: 1px solid #E2D5C1; vertical-align: top;"><p style="font-family: ''Spectral'', Georgia, ''Times New Roman'', serif; font-size: 18px; line-height: 1.3; color: #2A1B2A; margin: 0;">Forgiving self</p><p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.5; color: #6A5868; margin: 3px 0 0;">meeting the parts of you that were pushed away</p></td>
    </tr><tr>
      <td class="when" style="padding: 13px 0; border-top: 1px solid #E2D5C1; width: 96px; vertical-align: top;"><p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 11px; letter-spacing: 1.6px; text-transform: uppercase; color: #A14826; font-weight: 600; margin: 4px 0 0;">Wed 16 Dec</p></td>
      <td style="padding: 13px 0; border-top: 1px solid #E2D5C1; vertical-align: top;"><p style="font-family: ''Spectral'', Georgia, ''Times New Roman'', serif; font-size: 18px; line-height: 1.3; color: #2A1B2A; margin: 0;">Forgiving separation</p><p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.5; color: #6A5868; margin: 3px 0 0;">and what lies underneath both</p></td>
    </tr>
  </table>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 15px; line-height: 1.7; color: #4A3848; margin: 16px 0 0;">Each session runs 19:00&ndash;21:00 Brussels time, and <a href="https://songdance.co/courses/forgiveness?utm_source=broadcast&amp;utm_medium=email&amp;utm_campaign=forgiveness_paradox&amp;utm_content=times#schedule" style="color: #A14826; text-decoration: underline; text-underline-offset: 2px;">the course page shows it in your own time</a>. Can&rsquo;t be there live? Every session is recorded, the replay is up within a day, and the replays are yours for life.</p>
</td></tr>

<tr><td class="pad" style="padding: 26px 44px 6px;">
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.7; color: #2A1B2A; margin: 0;">You don&rsquo;t need to have forgiven anything, or to want to yet. You don&rsquo;t need a good voice, or any experience with sounding. You can stay muted the whole time: soft counts, and a hum is a complete practice.</p>
</td></tr>

<!-- OFFER BOX -->
<tr><td style="padding: 36px 44px 0;" class="pad">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #4A2540; border-radius: 4px;">
    <tr><td style="padding: 40px 38px 38px;" class="pad">
      <p style="margin: 0 0 16px; font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 11px; letter-spacing: 2.5px; color: #E7C9B8; font-weight: 600; text-transform: uppercase;">The Forgiveness Course</p>
      <h2 class="offer-h" style="font-family: ''Spectral'', Georgia, ''Times New Roman'', serif; font-weight: 400; font-size: 32px; line-height: 1.18; color: #F4ECDF; margin: 0 0 20px;">Not ready to forgive? <em style="font-family: ''Cormorant Garamond'', Georgia, serif; font-style: italic; font-weight: 500; font-size: 1.05em; color: #F2DCC9;">Come anyway.</em></h2>
      <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.7; color: #EADFCB; margin: 0;">Four live sessions on Zoom with Daniela Hess and me: 6, 9, 13 and 16&nbsp;December 2026, 19:00&ndash;21:00 Brussels time. Lifetime access to the replays. &euro;147.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 28px 0 14px;"><tr>
        <td style="background-color: #F4ECDF; border-radius: 32px;"><a href="https://songdance.co/courses/forgiveness?utm_source=broadcast&amp;utm_medium=email&amp;utm_campaign=forgiveness_paradox&amp;utm_content=cta&amp;email={{ subscriber.email | url_encode }}#register" style="display: inline-block; font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 15px; font-weight: 600; letter-spacing: 0.3px; color: #4A2540; padding: 16px 34px; text-decoration: none;">Join the four sessions &rarr;</a></td>
      </tr></table>
      <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 13px; line-height: 1.6; color: #C9B4C3; margin: 0;">One payment. The page shows the price in your own currency.</p>
    </td></tr>
  </table>
</td></tr>

<!-- SIGN-OFF + P.S. -->
<tr><td class="pad" style="padding: 36px 44px 42px;">
  <p style="font-family: ''Cormorant Garamond'', Georgia, serif; font-style: italic; font-size: 20px; line-height: 1.5; color: #4A3848; margin: 0 0 28px;">With love,<br>Jacob</p>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 15px; line-height: 1.7; color: #4A3848; margin: 0;"><strong style="font-weight: 600; color: #2A1B2A;">P.S.</strong> If a name came to mind while you were reading, someone you can&rsquo;t forgive, or something you can&rsquo;t forgive yourself for: that isn&rsquo;t a reason to stay away. It&rsquo;s exactly where we begin, on Sunday 6&nbsp;December. <a href="https://songdance.co/courses/forgiveness?utm_source=broadcast&amp;utm_medium=email&amp;utm_campaign=forgiveness_paradox&amp;utm_content=ps&amp;email={{ subscriber.email | url_encode }}#register" style="color: #A14826; text-decoration: underline; text-underline-offset: 2px;">Save your place</a>.</p>
</td></tr>

<tr><td style="background-color: #EADFCB; padding: 32px 44px 34px;" class="pad">
  <img src="https://songdance.co/brand/logo-wordmark-dark.png" width="130" alt="Songdance" style="width: 130px; height: auto; margin: 0 0 18px;">
  <p style="font-family: ''Cormorant Garamond'', Georgia, serif; font-style: italic; font-size: 16px; line-height: 1.5; color: #7A6A78; margin: 0 0 18px;">Honoring what the words alone never reached.</p>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 12px; line-height: 1.9; color: #A14826; margin: 0 0 16px;"><a href="https://songdance.co/what-is-svh" style="color: #A14826; text-decoration: none;">what is svh</a>&nbsp;&nbsp;&middot;&nbsp;&nbsp;<a href="https://songdance.co/courses" style="color: #A14826; text-decoration: none;">courses</a>&nbsp;&nbsp;&middot;&nbsp;&nbsp;<a href="https://songdance.co/events" style="color: #A14826; text-decoration: none;">events</a>&nbsp;&nbsp;&middot;&nbsp;&nbsp;<a href="https://songdance.co/about" style="color: #A14826; text-decoration: none;">about</a></p>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 11px; line-height: 1.7; color: #7A6A78; margin: 0 0 6px;">Not for you? <a href="{{ unsubscribe_url }}" style="color: #7A6A78; text-decoration: underline;">Unsubscribe</a> &mdash; you won&rsquo;t hear from this list again.</p>
  <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 11px; line-height: 1.7; color: #9A8A78; margin: 0;">Songdance BV &middot; Beaupréstraat 13, 8310 Bruges, Belgium<br>BE0743575076</p>
</td></tr>

</table>

</td></tr>
</table>

</body>
</html>
',
       'Hello {{ subscriber.first_name | default: "there" }},

Everyone agrees forgiveness is good for you. Hardly anyone can do it on command.

You can decide to forgive. You can say the words and mean them, write the name on a slip of paper and burn it. And then one night, at three o''clock, it''s back: the tight jaw, the heat in the chest, the old conversation playing in your head.

That isn''t a weakness of character. It''s the paradox at the heart of forgiveness, and once you see it, a lot of things start to make sense.


THREE PARADOXES

I. The harder you try, the further away it gets.
Forgiveness decided in the head stays in the head. The body was never asked. It still holds what happened: the anger, the grief, the shame. And a body that hasn''t been heard doesn''t sign anything.

II. The way to forgiveness runs through unforgiveness.
So we don''t start with forgiving. We start where you actually are: the resentment, the rage, the "never". Not to keep it, and not to excuse what was done, but to give it a voice at last. Everything wants to be acknowledged before it can go away by itself.

III. At the very bottom, there may be nothing to forgive.
Go below every hurt, and below that, and you reach the oldest one: separation. Me over here, you over there. Underneath it is something that was never broken. But you can''t skip to it. You only get there by walking through the first two.

It is true that we are separate, and it is true that we are one, at the same time. Maybe in the softness of that paradox, there''s also healing.


The mind says forgiven. The body says not yet.


SO WE FORGIVE WITH THE BODY, THROUGH THE VOICE

That''s why the Forgiveness Course doesn''t ask you to forgive. It asks your body to take part, and the voice is how a body takes part.

Not singing. Sounding: one honest tone, the sound of what is there right now. The sound of the anger you''ve been polite about for years. The sound of the guilt you''ve carried for something you did. Once it has a voice, it has been heard. And acknowledged things tend to leave on their own.

We''ll also meet the four phrases of ho''oponopono: I''m sorry. Please forgive me. Thank you. I love you. Said by millions as a mantra. In the course we don''t only say them. We sound them, because the body has its own version of each.


AND WITH MY GOOD FRIEND DANIELA

I''m holding these four sessions with Daniela Hess. She has guided forgiveness work, in groups and one to one, for twenty-five years, and she is one of the most unhurried people I know.

In the hardest stretch of my life, she was one of the two friends who stayed close. The Grief Course grew out of that time, and we made it together. This is the next one.

She brings twenty-five years of forgiveness work. I bring the voice. Between us we hold the space; what happens in it is yours, in its own time.


FOUR SESSIONS, LIVE ON ZOOM

  Sun 6 Dec   The dynamics of forgiveness: why "just let it go" doesn''t work, and what does
  Wed 9 Dec   Forgiving others: naming the pain without condoning the act
  Sun 13 Dec  Forgiving self: meeting the parts of you that were pushed away
  Wed 16 Dec  Forgiving separation, and what lies underneath both

Each session runs 19:00-21:00 Brussels time; the course page shows it in your own time. Can''t be there live? Every session is recorded, the replay is up within a day, and the replays are yours for life.

You don''t need to have forgiven anything, or to want to yet. You don''t need a good voice, or any experience with sounding. You can stay muted the whole time: soft counts, and a hum is a complete practice.


Not ready to forgive? Come anyway.

The Forgiveness Course: four live sessions on Zoom with Daniela Hess and me, 6, 9, 13 and 16 December 2026. Lifetime access to the replays. EUR 147 (the page shows it in your own currency).

Join the four sessions:
https://songdance.co/courses/forgiveness?utm_source=broadcast&utm_medium=email&utm_campaign=forgiveness_paradox&utm_content=text&email={{ subscriber.email | url_encode }}#register

With love,
Jacob

P.S. If a name came to mind while you were reading, someone you can''t forgive, or something you can''t forgive yourself for: that isn''t a reason to stay away. It''s exactly where we begin, on Sunday 6 December.

--
Not for you? Unsubscribe: {{ unsubscribe_url }}
Songdance BV, Beaupréstraat 13, 8310 Bruges, Belgium
',
       'html', 'draft', 'in-drip,prod_forgiveness'
WHERE NOT EXISTS (SELECT 1 FROM broadcasts WHERE name = 'The Forgiveness Course — forgiveness is a paradox (November 2026)');
