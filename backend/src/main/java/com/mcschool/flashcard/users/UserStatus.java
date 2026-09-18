package com.mcschool.flashcard.users;

public enum UserStatus {
    /** Account was created by an admin/teacher; the owner has not set a password yet. */
    INVITED,
    /** The account is active and can use the platform normally. */
    ACTIVE,
    /**
     * Temporarily inactive student. Historical lessons, homework, cards and
     * relationships stay intact, but authentication and automatic work stop.
     */
    INACTIVE
}
