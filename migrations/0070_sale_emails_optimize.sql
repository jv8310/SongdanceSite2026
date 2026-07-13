-- Optimise the 4 "sale ends 15 July" broadcast drafts for conversion, and wire
-- their deadline mechanics. All edits are surgical replace()s against the seeded
-- bodies (0065 / 0067) and are guarded on status='draft', so a broadcast already
-- launched is left untouched. Idempotent-ish: re-running only re-appends if the
-- anchor is still present (it won't be after the first run inserts past it).
--
-- What changes, and why (marketing mechanics — not governed by the copy book,
-- but the voice still applies; the guarantee is about FIT, never an outcome):
--   1. Anchored prices — every email showed "half price" but never a number.
--      Struck → now (12-Week €650→€325, Grief €99→€49.50, Certification
--      €1,500→€750), with an honest "your own currency at checkout" note (EUR
--      and USD price points are identical, so the € figure is right for both).
--   2. A 30-day money-back guarantee line — it exists site-wide (guarantee.ts)
--      and was in none of the emails; it dissolves the hesitation the deadline
--      creates.
--   3. Installments named in the 14 Jul "locks now" email (the promo halves the
--      3× monthly too), reinforcing "buy now, begin whenever".
--   4. The Certification path added to the 13 Jul chooser (it was omitted).
--   5. audience_exclude_tags = 'prod_svh_9m' on all four, so people who already
--      own the Certification course don't get a "final hours" countdown for it.
--      (12-week owners are deliberately kept in — they're warm for grief /
--      journeys — and get a dedicated cert email instead; see 0071.)
--   6. stop_at on both 15 Jul sends (Brussels midnight = 2026-07-15T22:00:00Z)
--      so neither delivers after the deadline it names; urgent=1 on the PM
--      "final hours" send so the Asia/Pacific side (whose local morning is past
--      the deadline) is still reached before midnight rather than dropped.

-- ── Sale · 13 Jul — which course is for you? ────────────────────────────────
-- (a) add the Certification path to the chooser; (b) price map in the offer box;
-- (c) a guarantee chip above the sign-off; (d) exclude cert owners.
UPDATE broadcasts SET
  body = replace(
    replace(
      replace(
        body,
        'Inner Child Healing Journey</a>.',
        'Inner Child Healing Journey</a>. And if you feel called to <strong style="font-weight: 600;">carry this work to others</strong> &mdash; to be certified to facilitate it &mdash; there&rsquo;s the <a href="https://songdance.co/courses/certification?utm_source=broadcast&amp;utm_medium=email&amp;utm_campaign=sale_final_2026&amp;utm_content=13jul" style="color: #A14826; text-decoration: underline; text-underline-offset: 2px;">Certification path</a>.'
      ),
      'Brussels time. (Retreats aren&rsquo;t included.)</p>',
      'Brussels time. (Retreats aren&rsquo;t included.)</p>
      <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 15px; line-height: 1.9; color: #EADFCB; margin: 16px 0 0;">12-Week Course <span style="color: #C9A7BE; text-decoration: line-through;">&euro;650</span> &rarr; <strong style="color: #F4ECDF; font-weight: 600;">&euro;325</strong>&nbsp;&nbsp;&middot;&nbsp;&nbsp;Grief Course <span style="color: #C9A7BE; text-decoration: line-through;">&euro;99</span> &rarr; <strong style="color: #F4ECDF; font-weight: 600;">&euro;49.50</strong>&nbsp;&nbsp;&middot;&nbsp;&nbsp;Certification path <span style="color: #C9A7BE; text-decoration: line-through;">&euro;1,500</span> &rarr; <strong style="color: #F4ECDF; font-weight: 600;">&euro;750</strong>&nbsp;&nbsp;&middot;&nbsp;&nbsp;every journey, half price.</p>
      <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 12px; line-height: 1.6; color: #C9A7BE; margin: 8px 0 0;">Shown in euros &mdash; you&rsquo;ll see your own currency at checkout.</p>'
    ),
    '<tr><td class="pad" style="padding: 32px 44px 40px;">',
    '<tr><td class="pad" style="padding: 26px 44px 0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid rgba(161,72,38,0.28); border-radius: 6px;">
    <tr><td style="padding: 15px 20px; font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.65; color: #6A5A68;"><strong style="color: #2A1B2A; font-weight: 600;">30-day money-back guarantee.</strong> Give the course a real try; if within 30 days it isn&rsquo;t your path, write to us for a full refund &mdash; no forms, no reason needed.</td></tr>
  </table>
</td></tr>

<tr><td class="pad" style="padding: 32px 44px 40px;">'
  ),
  audience_exclude_tags = 'prod_svh_9m'
WHERE name = 'Sale · 13 Jul — which course is for you? (2 days left)'
  AND status = 'draft' AND body NOT LIKE '%your own currency at checkout%';

-- ── Sale · 14 Jul — ends tomorrow (half price locks now) ────────────────────
-- (a) name the installment option; (b) price map; (c) guarantee chip; (d) exclude.
UPDATE broadcasts SET
  body = replace(
    replace(
      replace(
        body,
        'holds the half price for whenever you&rsquo;re ready to begin.</p>',
        'holds the half price for whenever you&rsquo;re ready to begin. And you can pay in full or spread it over three monthly payments &mdash; either way, today&rsquo;s price is the price you keep.</p>'
      ),
      'Then it&rsquo;s back to full price.</p>',
      'Then it&rsquo;s back to full price.</p>
      <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 15px; line-height: 1.9; color: #EADFCB; margin: 16px 0 0;">12-Week Course <span style="color: #C9A7BE; text-decoration: line-through;">&euro;650</span> &rarr; <strong style="color: #F4ECDF; font-weight: 600;">&euro;325</strong>&nbsp;&nbsp;&middot;&nbsp;&nbsp;Grief Course <span style="color: #C9A7BE; text-decoration: line-through;">&euro;99</span> &rarr; <strong style="color: #F4ECDF; font-weight: 600;">&euro;49.50</strong>&nbsp;&nbsp;&middot;&nbsp;&nbsp;Certification path <span style="color: #C9A7BE; text-decoration: line-through;">&euro;1,500</span> &rarr; <strong style="color: #F4ECDF; font-weight: 600;">&euro;750</strong>&nbsp;&nbsp;&middot;&nbsp;&nbsp;every journey, half price.</p>
      <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 12px; line-height: 1.6; color: #C9A7BE; margin: 8px 0 0;">Shown in euros &mdash; you&rsquo;ll see your own currency at checkout.</p>'
    ),
    '<tr><td class="pad" style="padding: 32px 44px 40px;">',
    '<tr><td class="pad" style="padding: 26px 44px 0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid rgba(161,72,38,0.28); border-radius: 6px;">
    <tr><td style="padding: 15px 20px; font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.65; color: #6A5A68;"><strong style="color: #2A1B2A; font-weight: 600;">30-day money-back guarantee.</strong> Give the course a real try; if within 30 days it isn&rsquo;t your path, write to us for a full refund &mdash; no forms, no reason needed.</td></tr>
  </table>
</td></tr>

<tr><td class="pad" style="padding: 32px 44px 40px;">'
  ),
  audience_exclude_tags = 'prod_svh_9m'
WHERE name = 'Sale · 14 Jul — ends tomorrow (half price locks now)'
  AND status = 'draft' AND body NOT LIKE '%your own currency at checkout%';

-- ── Sale · 15 Jul AM — last day ─────────────────────────────────────────────
-- (a) compact price line; (b) guarantee chip; (c) exclude; (d) stop at deadline.
UPDATE broadcasts SET
  body = replace(
    replace(
      body,
      '(Retreats aren&rsquo;t included.)</em></p>',
      '(Retreats aren&rsquo;t included.)</em></p>
      <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 15px; line-height: 1.85; color: #EADFCB; margin: 14px 0 0;">The 12-Week Course <span style="color: #C9A7BE; text-decoration: line-through;">&euro;650</span> &rarr; <strong style="color: #F4ECDF; font-weight: 600;">&euro;325</strong>, the Grief Course <strong style="color: #F4ECDF; font-weight: 600;">&euro;49.50</strong>, and every journey half price &mdash; <span style="color: #C9A7BE;">your own currency at checkout.</span></p>'
    ),
    '<tr><td class="pad" style="padding: 32px 44px 40px;">',
    '<tr><td class="pad" style="padding: 26px 44px 0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid rgba(161,72,38,0.28); border-radius: 6px;">
    <tr><td style="padding: 15px 20px; font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.65; color: #6A5A68;"><strong style="color: #2A1B2A; font-weight: 600;">30-day money-back guarantee.</strong> Give the course a real try; if within 30 days it isn&rsquo;t your path, write to us for a full refund &mdash; no forms, no reason needed.</td></tr>
  </table>
</td></tr>

<tr><td class="pad" style="padding: 32px 44px 40px;">'
  ),
  audience_exclude_tags = 'prod_svh_9m',
  stop_at = '2026-07-15T22:00:00Z'
WHERE name = 'Sale · 15 Jul AM — last day, ends tonight at midnight'
  AND status = 'draft' AND body NOT LIKE '%your own currency at checkout%';

-- ── Sale · 15 Jul PM — final hours ──────────────────────────────────────────
-- (a) compact price line; (b) guarantee chip; (c) exclude; (d) stop at deadline;
-- (e) urgent=1 so the whole list is reached before midnight, not held to local
-- mornings that fall after the deadline.
UPDATE broadcasts SET
  body = replace(
    replace(
      body,
      'After that, full price returns.</p>',
      'After that, full price returns.</p>
      <p style="font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 15px; line-height: 1.85; color: #EADFCB; margin: 14px 0 0;">The 12-Week Course <span style="color: #C9A7BE; text-decoration: line-through;">&euro;650</span> &rarr; <strong style="color: #F4ECDF; font-weight: 600;">&euro;325</strong>, the Grief Course <strong style="color: #F4ECDF; font-weight: 600;">&euro;49.50</strong>, and every journey half price &mdash; <span style="color: #C9A7BE;">your own currency at checkout.</span></p>'
    ),
    '<tr><td class="pad" style="padding: 32px 44px 40px;">',
    '<tr><td class="pad" style="padding: 26px 44px 0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid rgba(161,72,38,0.28); border-radius: 6px;">
    <tr><td style="padding: 15px 20px; font-family: ''Figtree'', -apple-system, BlinkMacSystemFont, ''Segoe UI'', Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.65; color: #6A5A68;"><strong style="color: #2A1B2A; font-weight: 600;">30-day money-back guarantee.</strong> Give the course a real try; if within 30 days it isn&rsquo;t your path, write to us for a full refund &mdash; no forms, no reason needed.</td></tr>
  </table>
</td></tr>

<tr><td class="pad" style="padding: 32px 44px 40px;">'
  ),
  audience_exclude_tags = 'prod_svh_9m',
  stop_at = '2026-07-15T22:00:00Z',
  urgent = 1
WHERE name = 'Sale · 15 Jul PM — final hours, closes at midnight (email 4 of 4)'
  AND status = 'draft' AND body NOT LIKE '%your own currency at checkout%';
