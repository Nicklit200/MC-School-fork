-- Undo/redo as first-class operations.
--
-- Modelling undo as a new operation, rather than deleting the original row,
-- keeps the stream append-only: a late joiner replaying from revision 0 sees
-- the undo in the same order everyone else did, and nothing has to rewrite
-- history. Redo is the symmetric re-application.
--
-- Both carry {"targetOperationId": "<uuid>"} and no geometry.

ALTER TABLE online_class_annotation_events
    DROP CONSTRAINT online_class_annotation_events_type_check;

ALTER TABLE online_class_annotation_events
    ADD CONSTRAINT online_class_annotation_events_type_check
    CHECK (operation_type IN ('ADD', 'UPDATE', 'ERASE', 'CLEAR_LAYER', 'CLEAR_ALL', 'UNDO', 'REDO'));
