package com.mcschool.flashcard.cards;

import com.mcschool.flashcard.cards.dto.ImportPreviewResponse;
import com.mcschool.flashcard.cards.dto.ParsedCard;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Component;

@Component
public class CardImportParser {
    private static final int MAX_QUESTION_LENGTH = 1000;
    private static final int MAX_ANSWER_LENGTH = 500;
    private static final String QUESTION_SEPARATOR = "->";
    private static final String ANSWER_SEPARATOR = "|";

    public ImportPreviewResponse parse(String rawText, String questionAnswerSeparator, String cardSeparator) {
        List<ParsedCard> cards = new ArrayList<>();
        List<String> warnings = new ArrayList<>();
        String[] rawCards = splitLiterally(rawText, cardSeparator);
        for (int i = 0; i < rawCards.length; i++) {
            String entry = rawCards[i].strip();
            if (entry.isEmpty()) continue;
            int lineNumber = i + 1;
            int separatorIndex = entry.indexOf(QUESTION_SEPARATOR);
            if (separatorIndex < 0) {
                warnings.add("Line " + lineNumber + ": skipped (missing -> separator): " + preview(entry));
                continue;
            }
            String question = entry.substring(0, separatorIndex).strip();
            String answersText = entry.substring(separatorIndex + QUESTION_SEPARATOR.length()).strip();
            if (question.isEmpty()) {
                warnings.add("Line " + lineNumber + ": skipped (empty question): " + preview(entry));
                continue;
            }
            String[] rawParts = splitLiterally(answersText, ANSWER_SEPARATOR);
            if (rawParts.length != 4 && rawParts.length != 5) {
                warnings.add("Line " + lineNumber + ": skipped (expected 4 answers and optional time like 15t): " + preview(entry));
                continue;
            }
            List<String> answers = new ArrayList<>();
            boolean hasBlankAnswer = false;
            for (int a = 0; a < 4; a++) {
                String answer = rawParts[a].strip();
                if (answer.isEmpty()) hasBlankAnswer = true;
                answers.add(answer);
            }
            if (hasBlankAnswer) {
                warnings.add("Line " + lineNumber + ": skipped (answers must be non-empty): " + preview(entry));
                continue;
            }
            Integer timeLimitSeconds = null;
            if (rawParts.length == 5) {
                String timePart = rawParts[4].strip().toLowerCase();
                if (!timePart.matches("\\d{1,4}t")) {
                    warnings.add("Line " + lineNumber + ": skipped (time must look like 15t): " + preview(entry));
                    continue;
                }
                int parsedTime = Integer.parseInt(timePart.substring(0, timePart.length() - 1));
                if (parsedTime < 1 || parsedTime > 3600) {
                    warnings.add("Line " + lineNumber + ": skipped (time must be 1-3600 seconds): " + preview(entry));
                    continue;
                }
                timeLimitSeconds = parsedTime;
            }
            Set<String> distinctAnswers = new LinkedHashSet<>(answers);
            if (distinctAnswers.size() != 4) {
                warnings.add("Line " + lineNumber + ": skipped (all 4 answers must be different): " + preview(entry));
                continue;
            }
            boolean tooLong = question.length() > MAX_QUESTION_LENGTH || answers.stream().anyMatch(a -> a.length() > MAX_ANSWER_LENGTH);
            if (tooLong) {
                warnings.add("Line " + lineNumber + ": skipped (question or answer too long): " + preview(entry));
                continue;
            }
            cards.add(new ParsedCard(question, answers.get(0), answers.get(1), answers.get(2), answers.get(3), timeLimitSeconds));
        }
        return new ImportPreviewResponse(cards, warnings);
    }

    private static String[] splitLiterally(String text, String separator) {
        return text.split(java.util.regex.Pattern.quote(separator), -1);
    }

    private static String preview(String entry) {
        return entry.length() <= 60 ? entry : entry.substring(0, 60) + "…";
    }
}
