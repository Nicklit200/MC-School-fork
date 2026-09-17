package com.mcschool.flashcard.groups.dto;

import com.fasterxml.jackson.annotation.JsonAlias;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import java.util.List;
import java.util.UUID;

/** Adds one or more existing students to a group by student id. */
public record AddGroupMembersRequest(
        @JsonAlias("emails") @NotEmpty List<@NotNull UUID> studentIds
) {
}
