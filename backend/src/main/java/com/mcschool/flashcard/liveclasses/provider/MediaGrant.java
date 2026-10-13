package com.mcschool.flashcard.liveclasses.provider;

/**
 * Publishing rights for one participant token.
 *
 * <p>Deliberately has no room-admin or room-record flag: those are never granted
 * to a browser client. Moderation and recording are performed by the backend
 * using server credentials.
 */
public record MediaGrant(
        boolean canPublishCamera,
        boolean canPublishMicrophone,
        boolean canPublishScreenShare,
        boolean canPublishData,
        boolean canSubscribe
) {

    /** The owning teacher: may publish everything. */
    public static MediaGrant host() {
        return new MediaGrant(true, true, true, true, true);
    }

    /** A student; screen sharing follows the class-level setting. */
    public static MediaGrant student(boolean screenShareAllowed) {
        return new MediaGrant(true, true, screenShareAllowed, true, true);
    }

    public boolean canPublishAnything() {
        return canPublishCamera || canPublishMicrophone || canPublishScreenShare || canPublishData;
    }
}
