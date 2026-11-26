-- Replay the one confirmed failed 2026-11-26 Group 5 review after repairing
-- the AI response output budget. All committed pupil records remain intact;
-- PostLessonSkillReviewService skips pupils already processed.
-- Do NOT reschedule other failed classes or finished reviews.
UPDATE post_lesson_skill_review_jobs
SET state='QUEUED', attempts=0, worker_id=NULL, lease_until=NULL,
    failure_code=NULL, finished_at=NULL, updated_at=now()
WHERE class_id='4d2faf27-b180-4923-a8f8-26c53550b674'
  AND teacher_id='956688de-5022-438d-a86e-c780ee30921d'
  AND event_id='local-b980c831-8ba1-47f7-922c-f2cc88031ecf'
  AND state='FAILED';
