-- Deduplicate historical receipts before enforcing one paid check per pupil ink revision.
WITH ranked AS (
    SELECT id,
           row_number() OVER (
             PARTITION BY class_id,teacher_id,student_id,board_id,page_number,pupil_ink_revision,analysis_version
             ORDER BY CASE state WHEN 'READY' THEN 0 WHEN 'RUNNING' THEN 1 ELSE 2 END,
                      created_at DESC,id DESC
           ) AS position
    FROM kolyn_page_analyses
)
DELETE FROM kolyn_page_analyses a
USING ranked r
WHERE a.id=r.id AND r.position>1;

CREATE UNIQUE INDEX uq_kolyn_page_analysis_pupil_revision
  ON kolyn_page_analyses
    (class_id,teacher_id,student_id,board_id,page_number,pupil_ink_revision,analysis_version);
