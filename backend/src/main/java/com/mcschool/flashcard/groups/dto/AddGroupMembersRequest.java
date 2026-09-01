package com.mcschool.flashcard.groups.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotEmpty;
import java.util.List;

/** Adds one or more students to an existing group by email. */
public record AddGroupMembersRequest(
        @NotEmpty List<@Email String> emails
) {
}
