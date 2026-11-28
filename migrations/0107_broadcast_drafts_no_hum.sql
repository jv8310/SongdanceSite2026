-- Copy book, revised 28 November 2026 (Jacob): humming is not part of the
-- practice. The broadcast drafts that still offered a hum are corrected in
-- place, sentence by sentence, so anything edited by hand around them stays:
-- the Forgiveness run-up (3/6, 4/6, 6/6)
-- and the launch draft. Only DRAFTS are touched: a broadcast that was sent
-- keeps the words it went out with. The Black Friday drafts are rewritten
-- whole by migration 0106.
--
-- Sources: docs/emails/forgiveness-runup/build.mjs and the two
-- docs/emails/forgiveness-*.{html,txt} files, corrected the same way.

UPDATE broadcasts
   SET body = replace(replace(replace(replace(body,
         'and a hum is a complete practice', 'and one quiet tone is a complete practice'),
         'Then don&rsquo;t say it: hum it.', 'Then don&rsquo;t say it: sound it.'),
         'Then don''t say it: hum it.', 'Then don''t say it: sound it.'),
         'A hum counts, and so does', 'A soft tone counts, and so does'),
       body_text = replace(replace(replace(replace(body_text,
         'and a hum is a complete practice', 'and one quiet tone is a complete practice'),
         'Then don&rsquo;t say it: hum it.', 'Then don&rsquo;t say it: sound it.'),
         'Then don''t say it: hum it.', 'Then don''t say it: sound it.'),
         'A hum counts, and so does', 'A soft tone counts, and so does')
 WHERE status = 'draft'
   AND (body LIKE '%a hum is a complete practice%'
     OR body LIKE '%say it: hum it.%'
     OR body LIKE '%A hum counts, and so does%'
     OR body_text LIKE '%a hum is a complete practice%'
     OR body_text LIKE '%say it: hum it.%'
     OR body_text LIKE '%A hum counts, and so does%');
