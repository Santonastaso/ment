-- Make the empty accumulator's UUID array type explicit. This preserves the
-- latest role/privacy payload changes made by earlier migrations.
do $migration$
declare
  original_definition text;
  revised_definition text;
begin
  select pg_get_functiondef('public.get_matches_for(text, integer, integer, boolean)'::regprocedure)
  into original_definition;

  revised_definition := replace(
    original_definition,
    E'v_seen uuid[] := ''{}'';',
    E'v_seen uuid[] := ''{}''::uuid[];'
  );

  if revised_definition = original_definition then
    raise exception 'get_matches_for UUID accumulator initializer was not found';
  end if;

  execute revised_definition;
end;
$migration$;
