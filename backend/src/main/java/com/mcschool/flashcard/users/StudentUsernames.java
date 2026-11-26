package com.mcschool.flashcard.users;

import com.mcschool.flashcard.common.ConflictException;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import java.text.Normalizer;
import java.util.Locale;
import org.springframework.dao.DataIntegrityViolationException;

public final class StudentUsernames {
    private StudentUsernames() {}

    // Transliterate names rather than translating them. Old usernames remain valid.
    public static String base(String fullName) {
        String first = fullName == null || fullName.isBlank()
                ? "student" : fullName.strip().split("\\s+")[0];
        StringBuilder out = new StringBuilder();
        for (char c : first.toLowerCase(Locale.ROOT).toCharArray()) {
            out.append(switch (c) {
                case 'а' -> "a"; case 'б' -> "b"; case 'в' -> "v"; case 'г', 'ґ' -> "g";
                case 'д' -> "d"; case 'е', 'э' -> "e"; case 'ё' -> "yo"; case 'є' -> "ye";
                case 'ж' -> "zh"; case 'з' -> "z"; case 'и', 'і' -> "i"; case 'ї' -> "yi";
                case 'й' -> "y"; case 'к' -> "k"; case 'л' -> "l"; case 'м' -> "m";
                case 'н' -> "n"; case 'о' -> "o"; case 'п' -> "p"; case 'р' -> "r";
                case 'с' -> "s"; case 'т' -> "t"; case 'у' -> "u"; case 'ф' -> "f";
                case 'х' -> "kh"; case 'ц' -> "ts"; case 'ч' -> "ch"; case 'ш' -> "sh";
                case 'щ' -> "shch"; case 'ъ', 'ь' -> ""; case 'ы' -> "y";
                case 'ю' -> "yu"; case 'я' -> "ya"; case 'ў' -> "u";
                case 'ß' -> "ss"; case 'ł' -> "l"; case 'ø' -> "o"; case 'æ' -> "ae";
                default -> String.valueOf(c);
            });
        }
        String cleaned = Normalizer.normalize(out.toString(), Normalizer.Form.NFKD)
                .replaceAll("[^a-z0-9]", "");
        if (cleaned.isEmpty() || !Character.isLetter(cleaned.charAt(0))) cleaned = "student" + cleaned;
        return cleaned.substring(0, Math.min(40, cleaned.length()));
    }

    public static void change(User student, String username, UserRepository users) {
        if (student.getRole() != Role.STUDENT || student.isArchived() || student.isTrialGuest()) {
            throw new ResourceNotFoundException("Student not found");
        }
        String normalized = username.trim();
        if (!normalized.matches("[A-Za-z][A-Za-z0-9._-]{2,59}")) {
            throw new org.springframework.web.server.ResponseStatusException(
                    org.springframework.http.HttpStatus.BAD_REQUEST, "Login must use Latin letters, numbers, dots, underscores or hyphens (3–60 characters)");
        }
        // Login lookup is case-insensitive across every account role.
        users.findByUsernameIgnoreCase(normalized)
                .filter(other -> !other.getId().equals(student.getId()))
                .ifPresent(other -> { throw new ConflictException("USERNAME_TAKEN", "Username already exists"); });
        student.assignUsername(normalized);
        try {
            users.saveAndFlush(student);
        } catch (DataIntegrityViolationException ex) {
            // The database uniqueness constraint also protects concurrent edits.
            throw new ConflictException("USERNAME_TAKEN", "Username already exists");
        }
    }
}
