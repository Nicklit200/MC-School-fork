package com.mcschool.flashcard.liveclasses;

import java.util.Optional;
import java.util.UUID;

/**
 * Naming rule for a student's private board: the whiteboard surface whose
 * target id is {@code personal-<ownerUserId>}.
 *
 * <p>Privacy is enforced by the annotation service from this id, never from
 * anything the client claims: only the owner and the class's teacher may open,
 * read, write or list such a document.
 */
public final class PersonalBoard {

    static final String PREFIX = "personal-";
    private static final String WORKBOOK_PREFIX = "personal-workbook-";

    private PersonalBoard() {
    }

    public static boolean isPersonal(String targetId) {
        return targetId != null && targetId.startsWith(PREFIX);
    }

    public static String targetIdFor(UUID ownerId) {
        return PREFIX + ownerId;
    }

    /** A student's assigned worksheet has its own document and annotation scope. */
    public static String workbookTargetIdFor(UUID ownerId) {
        return WORKBOOK_PREFIX + ownerId;
    }

    public static boolean isWorkbook(String targetId) {
        return targetId != null && targetId.startsWith(WORKBOOK_PREFIX);
    }

    /** The owner, or empty when the id merely looks personal but is malformed. */
    public static Optional<UUID> ownerOf(String targetId) {
        if (!isPersonal(targetId)) {
            return Optional.empty();
        }
        try {
            String prefix = isWorkbook(targetId) ? WORKBOOK_PREFIX : PREFIX;
            String suffix = targetId.substring(prefix.length());
            UUID owner = UUID.fromString(suffix);
            return owner.toString().equals(suffix) ? Optional.of(owner) : Optional.empty();
        } catch (IllegalArgumentException e) {
            return Optional.empty();
        }
    }
}
