ALTER TABLE kolin_worksheets ADD COLUMN parent_id uuid REFERENCES kolin_worksheets(id);
ALTER TABLE kolin_worksheets ADD COLUMN material_index integer;
ALTER TABLE kolin_worksheets ADD CONSTRAINT ck_kolin_material_parent CHECK (
    (parent_id IS NULL AND material_index IS NULL) OR
    (parent_id IS NOT NULL AND parent_id <> id AND material_index BETWEEN 0 AND 1)
);
CREATE UNIQUE INDEX uq_kolin_material_order ON kolin_worksheets(parent_id, material_index);
