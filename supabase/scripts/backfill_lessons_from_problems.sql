-- One-time backfill: synthesize a `lessons` row per `problems` row from content
-- that's already authored (explanation, solution_steps, common_errors). Purely
-- additive — never overwrites existing lessons (unique constraint on problem_id).
insert into lessons (problem_id, title, content, estimated_duration_minutes)
select
  p.id,
  left(p.question_text, 60) || case when length(p.question_text) > 60 then '...' else '' end as title,
  jsonb_build_object(
    'sections',
    (
      jsonb_build_array(
        jsonb_build_object(
          'type', 'explanation',
          'title', 'Explanation',
          'content', p.explanation
        ),
        jsonb_build_object(
          'type', 'walkthrough',
          'title', 'Step by Step',
          'steps', (
            select coalesce(
              jsonb_agg(
                case
                  when coalesce(step->>'math', '') <> ''
                    then (step->>'instruction') || ' - ' || (step->>'math')
                  else (step->>'instruction')
                end
                order by (step->>'step')::int
              ),
              '[]'::jsonb
            )
            from jsonb_array_elements(p.solution_steps) as step
          )
        )
      )
      ||
      case
        when jsonb_array_length(coalesce(p.common_errors, '[]'::jsonb)) > 0 then
          jsonb_build_array(
            jsonb_build_object(
              'type', 'insight',
              'title', 'Common Mistakes',
              'content', (
                select string_agg((err->>'error') || ': ' || (err->>'why'), E'\n')
                from jsonb_array_elements(p.common_errors) as err
              )
            )
          )
        else '[]'::jsonb
      end
    )
  ) as content,
  3 as estimated_duration_minutes
from problems p
where p.explanation is not null and p.explanation <> ''
  and not exists (select 1 from lessons l where l.problem_id = p.id)
on conflict (problem_id) do nothing;
