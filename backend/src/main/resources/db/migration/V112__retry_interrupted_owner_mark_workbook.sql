-- One-time operational recovery for the owner pilot lesson whose PDF
-- generation was interrupted by the 2026-11-17 backend redeploy.
-- Never creates PDFs, touches lesson materials, or changes any other pupil.
UPDATE owner_same_day_workbook_jobs
   SET state='QUEUED', attempts=1, error_code=NULL, updated_at=now()
 WHERE teacher_id='14e3c7c1-1fc8-41bd-858a-6c20efdd957a'::uuid
   AND event_id='local-e75a6be2-cece-45da-9073-3a85d4540146'
   AND lesson_date=DATE '2026-11-17'
   AND state='FAILED'
   AND error_code='IllegalStateException';
