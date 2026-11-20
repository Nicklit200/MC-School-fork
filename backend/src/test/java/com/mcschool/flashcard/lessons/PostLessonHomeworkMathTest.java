package com.mcschool.flashcard.lessons;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

import static org.junit.jupiter.api.Assertions.*;

class PostLessonHomeworkMathTest {
    private final ObjectMapper json = new ObjectMapper();

    private String math(String expression) {
        return (String) PostLessonHomeworkMath.student(expression,"equivalence","").get("latex");
    }

    @Test void ordinaryFractionKeepsItsOriginalNumbersAndServerAddsTheAnswerArea() {
        assertEquals("\\frac{18}{24} =",math("18/24"));
        assertEquals("\\frac{1}{2} + \\frac{1}{4} =",math("1/2+1/4"));
    }

    @Test void compoundFractionsPreserveNumeratorDenominatorAndGrouping() {
        assertEquals("\\frac{3 \\cdot x - 2}{4} =",math("(3*x-2)/4"));
        assertEquals("\\frac{\\frac{3 \\cdot x - 2}{4}}{\\frac{3}{8}} =",
                math("((3*x-2)/4)/(3/8)"));
        assertEquals("x - \\left(y + z\\right) =",math("x-(y+z)"));
        assertEquals("2 \\cdot \\left(x + 3\\right) =",math("2(x+3)"));
        assertEquals("\\frac{a}{b \\cdot c} =",math("a/(b*c)"));
        assertEquals("\\frac{a}{b} \\cdot c =",math("a/b*c"));
        // An explicit product must never look like the mixed number 2 1/3.
        assertEquals("2 \\cdot \\frac{1}{3} =",math("2*(1/3)"));
    }

    @Test void unaryMinusAndRightAssociativePowersMatchTheAlgebraParser() {
        assertEquals("-{x}^{2} =",math("-x^2"));
        assertEquals("{\\left(-x\\right)}^{2} =",math("(-x)^2"));
        assertEquals("{x}^{{2}^{3}} =",math("x^2^3"));
        assertEquals("{x}^{-2} =",math("x**-2"));
    }

    @Test void solutionDisplaysTheEquationAndDoesNotGenerateASecondEqualsSign() {
        assertEquals("2 \\cdot x + 3 = 7",
                PostLessonHomeworkMath.student("2x+3=7","solution","x").get("latex"));
        assertThrows(IllegalArgumentException.class,
                () -> PostLessonHomeworkMath.student("2*x+3=7=9","solution","x"));
        assertThrows(IllegalArgumentException.class,
                () -> PostLessonHomeworkMath.student("2*x+3=7","equivalence",""));
    }

    @Test void onlyTheQaParsersSymbolsAndFunctionsAreAccepted() {
        assertEquals("\\sqrt{9} + \\left|-2\\right| =",math("sqrt(9)+abs(-2)"));
        assertEquals("\\sin\\left(x\\right) + \\cos\\left(x\\right) =",math("sin(x)+cos(x)"));
        assertEquals("\\log\\left(2\\right) + \\exp\\left(0\\right) =",math("log(2)+exp(0)"));
        for (String invalid : List.of("sqrt(1,2)","sum(x)","q+1","xy+1","sin x","1 7/12"))
            assertThrows(IllegalArgumentException.class,() -> math(invalid),invalid);
    }

    @Test void commonUnicodeOperatorsCompileWithoutPassingThroughModelTex() {
        assertEquals("\\frac{3}{4} + 2 \\cdot x - 1 =",math("3÷4+2·x−1"));
        assertEquals("\\frac{1}{2} =",math("1:2"));
        for (String unsafe : List.of("\\frac{1}{2}","\\href{url}{x}","<script>x</script>",
                "__import__('os')","x;1", "x_1", "x=3"))
            assertThrows(IllegalArgumentException.class,() -> math(unsafe),unsafe);
    }

    @Test void malformedOrExcessivelyNestedContentIsRejectedBeforeRendering() {
        for (String invalid : List.of("", "()", "(x", "x)", "x+", "*x", "1..2", "sqrt()"))
            assertThrows(IllegalArgumentException.class,() -> math(invalid),invalid);
        assertThrows(IllegalArgumentException.class,() -> math("(".repeat(40)+"x"+")".repeat(40)));
        assertThrows(IllegalArgumentException.class,() -> math("1".repeat(31)));
        assertThrows(IllegalArgumentException.class,() -> math("x+".repeat(100)+"1"));
    }

    @Test void missingOrConflictingLegacyDisplayTokensCannotBreakOrAlterTheTask() throws Exception {
        Map<String,Object> task = new LinkedHashMap<>(Map.of(
                "title","Berechne.","description","Zeige deine Schritte.",
                "expression","1/2+1/4","answer","3/4","kind","equivalence","variable",""));
        Map<String,Object> content = new LinkedHashMap<>(Map.of(
                "topic","Brüche", "subtitle","Übe das Addieren.",
                "hint","Erweitere auf einen gemeinsamen Nenner.","tasks",List.of(task)));
        String withoutDisplay = PostLessonHomeworkMch3Template.fromContent(json,content,1,7,"Testschüler");
        // An older provider may still return mathTokens, including a different
        // problem or the final answer. None of them is part of the contract now.
        task.put("mathTokens",List.of("99","=","3/4"));
        task.put("solutionText","An unchecked private explanation.");
        assertEquals(withoutDisplay,
                PostLessonHomeworkMch3Template.fromContent(json,content,1,7,"Testschüler"));
        Map<?,?> document = json.readValue(withoutDisplay,Map.class);
        String studentJson = json.writeValueAsString(document.get("workbookPages"));
        assertFalse(studentJson.contains("3/4"));
        assertFalse(studentJson.contains("99"));
        assertTrue(studentJson.contains("writeLines"));
        Map<?,?> qa = (Map<?,?>)document.get("qa");
        Map<?,?> check = (Map<?,?>)((List<?>)qa.get("algebra")).get(0);
        assertEquals("1/2+1/4",check.get("expression"));
        assertEquals("3/4",check.get("answer"));
    }

    @Test void equationRequiresUniqueLinearSolutionQaAndKeepsAnswerPrivate() throws Exception {
        Map<String,Object> task = Map.of(
                "title","Löse die Gleichung.","description","Zeige deine Schritte.",
                "expression","2*x+3=17","answer","7","kind","solution","variable","x");
        Map<String,Object> content = Map.of(
                "topic","Gleichungen", "subtitle","Bestimme die Unbekannte.",
                "hint","Führe auf beiden Seiten dieselbe Umformung aus.","tasks",List.of(task));
        Map<?,?> document = json.readValue(
                PostLessonHomeworkMch3Template.fromContent(json,content,1,7,"Testschüler"),Map.class);
        Map<?,?> page = (Map<?,?>)((List<?>)document.get("workbookPages")).get(0);
        Map<?,?> exercise = (Map<?,?>)((List<?>)page.get("blocks")).get(1);
        Map<?,?> row = (Map<?,?>)((List<?>)exercise.get("rows")).get(0);
        assertEquals("2 \\cdot x + 3 = 17",((Map<?,?>)row.get("math")).get("latex"));
        Map<?,?> qa = (Map<?,?>)document.get("qa");
        Map<?,?> check = (Map<?,?>)((List<?>)qa.get("algebra")).get(0);
        assertEquals("linearSolution",check.get("kind"));
        assertEquals("2*x+3=17",check.get("equation"));
        assertEquals(Map.of("x","7"),check.get("solution"));
    }
}
