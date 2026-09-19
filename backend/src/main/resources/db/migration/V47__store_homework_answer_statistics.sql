ALTER TABLE homeworks
    ADD COLUMN final_correct_count INTEGER,
    ADD COLUMN final_answer_results_json TEXT;

UPDATE homeworks
SET final_correct_count = final_answer_count
WHERE final_answers_correct = TRUE
  AND final_answer_count IS NOT NULL;
