CREATE TABLE student_groups (
    id UUID PRIMARY KEY,
    teacher_id UUID NOT NULL REFERENCES users(id),
    name VARCHAR(120) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX idx_student_groups_teacher_id ON student_groups(teacher_id);

CREATE TABLE student_group_members (
    id UUID PRIMARY KEY,
    group_id UUID NOT NULL REFERENCES student_groups(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT uq_student_group_member UNIQUE (group_id, student_id)
);

CREATE INDEX idx_student_group_members_group_id ON student_group_members(group_id);
CREATE INDEX idx_student_group_members_student_id ON student_group_members(student_id);
