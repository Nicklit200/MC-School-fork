package com.mcschool.flashcard.users.dto;

import jakarta.validation.constraints.NotNull;
import java.util.UUID;

public record AssignStudentTeacherRequest(@NotNull UUID teacherId) {}
