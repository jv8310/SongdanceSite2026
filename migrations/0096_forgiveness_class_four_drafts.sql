-- Class 4 of the Forgiveness Course is no longer "Forgiving separation": it is
-- "Living with forgiveness", tying the three classes together (Jacob, November
-- 2026). The page, the session list and the app follow src/lib/courses/forgiveness.ts
-- and FCClasses.astro; the two broadcast drafts seeded by 0093 and 0095 carry
-- the old line in their schedule table, so it is changed there too.
--
-- Drafts only: a broadcast that is sending, paused or done keeps what it sent.
-- REPLACE() changes nothing when the text is not there (a draft already edited
-- in the admin), so this is safe to run again.

UPDATE broadcasts
SET body = REPLACE(REPLACE(REPLACE(body,
      '>Forgiving separation</p>', '>Living with forgiveness</p>'),
      '>and what lies underneath both</p>', '>tying it all together</p>'),
      '>and what&rsquo;s underneath</p>', '>tying it all together</p>'),
    body_text = REPLACE(REPLACE(body_text,
      'Forgiving separation, and what lies underneath both', 'Living with forgiveness, tying it all together'),
      'Forgiving separation, and what''s underneath', 'Living with forgiveness, tying it all together')
WHERE status = 'draft'
  AND name IN (
    'The Forgiveness Course — registrations open (December 2026)',
    'The Forgiveness Course — forgiveness is a paradox (November 2026)'
  );


-- "Forgiveness is a paradox" (#17) becomes email 1 of the run-up (Jacob,
-- November 2026), and its third paradox no longer names separation: it is now
-- "Forgiveness isn't a finish line", which leads into class 4, Living with
-- forgiveness. docs/emails/forgiveness-paradox.broadcast.html + .txt carry the
-- same words. Draft only; a no-op once the text is gone.
UPDATE broadcasts
SET body = REPLACE(REPLACE(REPLACE(body,
      'At the very bottom, there may be nothing to forgive.',
      'Forgiveness isn&rsquo;t a finish line.'),
      'Go below every hurt, and below that, and you reach the oldest one: separation. Me over here, you over there. Underneath it is something that was never broken. But you can&rsquo;t skip to it. You only get there by walking through the first two.',
      'You don&rsquo;t forgive once and stay there. An anniversary, a phone call, a song on the radio, and it&rsquo;s back. That isn&rsquo;t failure. Each time it returns, it asks to be met again, a little more gently than the time before.'),
      'It is true that we are separate, and it is true that we are one, at the same time. Maybe in the softness of that paradox, there&rsquo;s also healing.',
      'Maybe forgiveness is less something you do once, and more a way of living.'),
    body_text = REPLACE(REPLACE(REPLACE(body_text,
      'III. At the very bottom, there may be nothing to forgive.',
      'III. Forgiveness isn''t a finish line.'),
      'Go below every hurt, and below that, and you reach the oldest one: separation. Me over here, you over there. Underneath it is something that was never broken. But you can''t skip to it. You only get there by walking through the first two.',
      'You don''t forgive once and stay there. An anniversary, a phone call, a song on the radio, and it''s back. That isn''t failure. Each time it returns, it asks to be met again, a little more gently than the time before.'),
      'It is true that we are separate, and it is true that we are one, at the same time. Maybe in the softness of that paradox, there''s also healing.',
      'Maybe forgiveness is less something you do once, and more a way of living.')
WHERE status = 'draft'
  AND name LIKE '%forgiveness is a paradox%';
