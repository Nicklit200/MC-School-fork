-- One-time, evidence-gated backfill of the most recent attended lesson per
-- active student in the last 45 days. This is NOT a blanket mastery increment.
-- The normal worker validates authored writing / authenticated speech, applies
-- the school's conservative scoring threshold and records idempotent evidence.
-- No absent pupil and no demo-only or teacher-only room may be processed.
-- Existing jobs/processed pupil rows are never modified or replayed.
WITH attendance AS (
    SELECT c.id AS class_id,c.teacher_id,c.event_id,c.scheduled_start_at,
           s.id AS student_id,
           ROW_NUMBER() OVER (
              PARTITION BY s.id
              ORDER BY c.scheduled_start_at DESC,c.actual_end_at DESC,c.id DESC
           ) AS student_lesson_rank
    FROM online_classes c
    JOIN users s ON s.teacher_id=c.teacher_id
       AND s.role='STUDENT' AND s.status='ACTIVE' AND NOT s.archived
    WHERE c.status='ENDED'
      AND (c.student_id IS NOT NULL OR c.group_id IS NOT NULL)
      AND c.actual_end_at IS NOT NULL
      AND c.actual_end_at >= now()-INTERVAL '45 days'
      AND c.actual_end_at <= now()
      AND c.scheduled_start_at <= now()
      AND c.event_id IS NOT NULL AND btrim(c.event_id)<>''
      AND (
          EXISTS (
              SELECT 1 FROM online_class_participants p
              WHERE p.class_id=c.id AND p.user_id=s.id
                AND p.class_role='STUDENT' AND p.first_joined_at IS NOT NULL
          )
          OR EXISTS (
              SELECT 1 FROM online_class_annotation_events ev
              JOIN online_class_annotation_documents doc ON doc.id=ev.document_id
              WHERE doc.class_id=c.id AND doc.target_type='WHITEBOARD'
                AND doc.target_id IN (
                    'personal-'||s.id::text,
                    'personal-workbook-'||s.id::text
                )
                AND ev.actor_id=s.id AND ev.layer_owner_id=s.id
                AND ev.operation_type IN ('ADD','UPDATE')
          )
          OR EXISTS (
              SELECT 1 FROM online_class_transcript_segments seg
              WHERE seg.class_id=c.id AND seg.user_id=s.id
                AND length(btrim(seg.text))>0
          )
      )
),
ready AS (
    SELECT a.class_id,a.teacher_id,a.event_id,a.student_id
    FROM attendance a
    WHERE a.student_lesson_rank=1
      AND NOT EXISTS (
          SELECT 1 FROM post_lesson_skill_review_students done
          WHERE done.class_id=a.class_id AND done.student_id=a.student_id
      )
      AND (
          -- A PDF alone proves nothing; this requires authenticated pupil ink.
          (
              EXISTS (
                  SELECT 1 FROM completed_lesson_documents d
                  WHERE d.class_id=a.class_id AND d.teacher_id=a.teacher_id
                    AND d.board_id IN (
                        'personal-'||a.student_id::text,
                        'personal-workbook-'||a.student_id::text
                    )
              )
              AND EXISTS (
                  SELECT 1 FROM online_class_annotation_events ev
                  JOIN online_class_annotation_documents doc ON doc.id=ev.document_id
                  WHERE doc.class_id=a.class_id AND doc.target_type='WHITEBOARD'
                    AND doc.target_id IN (
                        'personal-'||a.student_id::text,
                        'personal-workbook-'||a.student_id::text
                    )
                    AND ev.actor_id=a.student_id AND ev.layer_owner_id=a.student_id
                    AND ev.operation_type IN ('ADD','UPDATE')
              )
          )
          OR EXISTS (
              SELECT 1 FROM online_class_transcript_segments seg
              WHERE seg.class_id=a.class_id AND seg.user_id=a.student_id
                AND length(btrim(seg.text))>0
          )
      )
      -- Never replace an existing job snapshot, including failed/pending jobs:
      -- they have their own durable retry / audit lifecycle.
      AND NOT EXISTS (
          SELECT 1 FROM post_lesson_skill_review_jobs j
          WHERE j.class_id=a.class_id
      )
),
batches AS (
    SELECT class_id,teacher_id,event_id,
           jsonb_agg(student_id::text ORDER BY student_id) AS roster_json,
           count(*)::integer AS pupil_count
    FROM ready
    GROUP BY class_id,teacher_id,event_id
)
INSERT INTO post_lesson_skill_review_jobs
    (class_id,teacher_id,event_id,roster_json,total_students)
SELECT class_id,teacher_id,event_id,roster_json,pupil_count
FROM batches
WHERE pupil_count BETWEEN 1 AND 25
ON CONFLICT(class_id) DO NOTHING;
