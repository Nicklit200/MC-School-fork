package com.mcschool.flashcard.study;

import com.mcschool.flashcard.cards.Card;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Component;

/**
 * Builds up to four answer options for a card during a session (PRD 4.1/4.3):
 * the correct answer plus up to three "distractors" — wrong options taken at
 * random from the correct answers of the session's <i>other</i> cards, unless
 * the teacher supplied this card's own wrong answers.
 *
 * <p>If the other cards do not provide three <i>distinct</i> wrong answers (e.g.
 * several cards share an answer) the question is shown with fewer options rather
 * than failing. A single plain card therefore has only its correct answer.
 */
@Component
public class DistractorGenerator {

    static final int MAX_OPTIONS = 4;
    static final int MAX_DISTRACTORS = MAX_OPTIONS - 1;

    /**
     * @param card        the card being asked
     * @param studentCards all of the student's cards (including {@code card})
     * @return the correct answer plus up to three distractors, shuffled
     */
    public List<String> buildOptions(Card card, List<Card> studentCards) {
        String correct = card.getCorrectAnswer();
        if (card.hasSavedWrongAnswers()) {
            List<String> options = new ArrayList<>(List.of(correct, card.getWrongAnswer1(),
                    card.getWrongAnswer2(), card.getWrongAnswer3()));
            Collections.shuffle(options);
            return options;
        }

        // Distinct answers from the other cards, excluding the correct one.
        Set<String> distinctWrongAnswers = new LinkedHashSet<>();
        for (Card other : studentCards) {
            if (!other.getId().equals(card.getId()) && !other.getCorrectAnswer().equals(correct)) {
                distinctWrongAnswers.add(other.getCorrectAnswer());
            }
        }

        List<String> distractorPool = new ArrayList<>(distinctWrongAnswers);
        Collections.shuffle(distractorPool);

        List<String> options = new ArrayList<>();
        options.add(correct);
        distractorPool.stream().limit(MAX_DISTRACTORS).forEach(options::add);
        Collections.shuffle(options);
        return options;
    }
}
