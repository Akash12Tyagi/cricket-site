-- Removes the placeholder/demo data used during development, now that real Cricsheet data is loaded.
-- Real teams with the same names (India, Australia) are kept; only the fake players, matches and stories go.
begin;
delete from matches where slug in ('india-vs-australia-1st-t20i-sample', 'coastal-comets-vs-highland-hawks-match-1-demo');
delete from user_follows where player_id in (select id from players where cricsheet_id is null and (slug ~ '^(india|australia)-player-[0-9]+$' or slug like 'coastal-comets-%' or slug like 'highland-hawks-%'));
delete from players where cricsheet_id is null and (slug ~ '^(india|australia)-player-[0-9]+$' or slug like 'coastal-comets-%' or slug like 'highland-hawks-%');
delete from teams where slug in ('coastal-comets', 'highland-hawks');
delete from series where slug in ('demo-premier-t20-2026', 'sample-t20i-series-2026');
delete from venues where slug in ('harbour-park', 'sample-cricket-ground');
delete from articles where slug in ('comets-hold-their-nerve-in-harbour-park-thriller', 'hawks-name-unchanged-squad-for-match-2');
delete from tags where slug in ('coastal-comets', 'highland-hawks') and not exists (select 1 from article_tags where tag_id = tags.id);
commit;
