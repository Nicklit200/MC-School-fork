CREATE TABLE monthly_plans (
    id UUID PRIMARY KEY,
    teacher_id UUID NOT NULL REFERENCES users(id),
    target_type VARCHAR(20) NOT NULL,
    target_id UUID NOT NULL,
    plan_month VARCHAR(7) NOT NULL,
    plan_json TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT chk_monthly_plan_target_type CHECK (target_type IN ('STUDENT', 'GROUP')),
    CONSTRAINT uq_monthly_plan_target UNIQUE (teacher_id, target_type, target_id, plan_month)
);
CREATE INDEX idx_monthly_plans_teacher_target
    ON monthly_plans(teacher_id, target_type, target_id, plan_month);
