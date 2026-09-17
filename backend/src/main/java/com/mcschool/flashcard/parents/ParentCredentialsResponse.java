package com.mcschool.flashcard.parents;

public record ParentCredentialsResponse(
        ParentAccountResponse parent,
        String temporaryPassword
) {}
