package com.mcschool.flashcard.lessons;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Compiles the checked task expression into student-facing math.
 * No model-supplied TeX, HTML, answer blanks or independent display expression
 * is accepted. This grammar is a bounded subset of algebra_qa.py's safe parser.
 * The existing algebra QA remains responsible for correctness and domain checks.
 */
final class PostLessonHomeworkMath {
    private static final Set<String> SYMBOLS = Set.of("x", "y", "z", "a", "b", "c", "m", "n");
    private static final Set<String> FUNCTIONS = Set.of("sqrt", "sin", "cos", "exp", "log", "abs");
    private static final Pattern TOKEN = Pattern.compile("\\s*(\\d+(?:\\.\\d+)?|[A-Za-z]+|\\*\\*|[+\\-*/^()])");
    private static final Pattern NUMBER = Pattern.compile("\\d+(?:\\.\\d+)?");
    private PostLessonHomeworkMath() {}

    static Map<String,Object> student(String expression, String kind, String variable) {
        if (expression == null || expression.isBlank() || expression.length() > 200)
            throw invalid();
        if ("equivalence".equals(kind)) {
            if (expression.contains("="))
                throw new IllegalArgumentException("HOMEWORK_CONTENT_EXPRESSION_EQUATION");
            if (!variable.isEmpty())
                throw new IllegalArgumentException("HOMEWORK_CONTENT_VARIABLE_UNEXPECTED");
            // Six server-owned handwriting lines follow this formula. An empty
            // right-hand side is deliberate; no proposed answer enters the page.
            return Map.of("latex", parse(expression).latex() + " =");
        }
        if ("solution".equals(kind)) {
            String[] sides = expression.split("=", -1);
            if (sides.length != 2 || !SYMBOLS.contains(variable))
                throw new IllegalArgumentException("HOMEWORK_CONTENT_EQUATION_INVALID");
            return Map.of("latex", parse(sides[0]).latex() + " = " + parse(sides[1]).latex());
        }
        throw new IllegalArgumentException("HOMEWORK_CONTENT_QA_KIND");
    }

    /** Canonical display identity, not algebraic simplification: two different
     * problems with the same answer must remain different exercises. */
    static String fingerprint(String source){
        if(source==null||source.isBlank()||source.length()>200)return "";
        try{
            String[] sides=source.split("=",-1);
            if(sides.length==1)return parse(sides[0]).latex().replaceAll("\\s+","");
            if(sides.length==2){
                String left=parse(sides[0]).latex().replaceAll("\\s+","");
                String right=parse(sides[1]).latex().replaceAll("\\s+","");
                return left.compareTo(right)<=0?left+"="+right:right+"="+left;
            }
        }catch(IllegalArgumentException ignored){}
        return "";
    }

    private static Node parse(String source) {
        Parser parser = new Parser(source);
        Node result = parser.expression(0);
        if (parser.peek() != null) throw invalid();
        return result;
    }

    private static IllegalArgumentException invalid() {
        return new IllegalArgumentException("HOMEWORK_CONTENT_EXPRESSION_SYNTAX");
    }

    private record Node(String op, String value, Node left, Node right) {
        private int priority() {
            return switch (op) {
                case "+", "-" -> 10;
                case "*", "/" -> 20;
                case "unary+", "unary-" -> 25;
                case "^" -> 30;
                default -> 100;
            };
        }

        private String child(Node node, int minimum) {
            String value = node.latex();
            return node.priority() < minimum ? "\\left(" + value + "\\right)" : value;
        }

        private String latex() {
            return switch (op) {
                case "atom" -> value;
                case "+" -> child(left,10) + " + " + child(right,10);
                case "-" -> child(left,10) + " - " + child(right,11);
                case "*" -> child(left,20) + " \\cdot " + child(right,20);
                case "/" -> "\\frac{" + left.latex() + "}{" + right.latex() + "}";
                case "unary+" -> "+" + child(left,25);
                case "unary-" -> "-" + child(left,25);
                case "^" -> "{" + child(left,31) + "}^{" + right.latex() + "}";
                case "sqrt" -> "\\sqrt{" + left.latex() + "}";
                case "abs" -> "\\left|" + left.latex() + "\\right|";
                case "sin", "cos", "exp", "log" -> "\\" + op + "\\left(" + left.latex() + "\\right)";
                default -> throw invalid();
            };
        }
    }

    private static final class Parser {
        private final List<String> tokens = new ArrayList<>();
        private int position;
        private int depth;

        private Parser(String source) {
            String text = source.strip().replace('−','-').replace('×','*').replace('·','*')
                    .replace('÷','/').replace('∶','/').replace(':','/');
            int offset = 0;
            Matcher matcher = TOKEN.matcher(text);
            while (offset < text.length()) {
                matcher.region(offset,text.length());
                if (!matcher.lookingAt()) throw invalid();
                String token = matcher.group(1);
                if (NUMBER.matcher(token).matches() && token.length() > 30) throw invalid();
                tokens.add(token);
                if (tokens.size() > 128) throw invalid();
                offset = matcher.end();
            }
        }

        private String peek() {
            return position < tokens.size() ? tokens.get(position) : null;
        }

        private String take() {
            String token = peek();
            if (token == null) throw invalid();
            position++;
            return token;
        }

        private Node expression(int minimum) {
            if (++depth > 35) throw invalid();
            String token = take();
            Node result;
            if ("+".equals(token) || "-".equals(token)) {
                result = new Node("unary" + token,null,expression(25),null);
            } else if ("(".equals(token)) {
                result = expression(0);
                if (!")".equals(take())) throw invalid();
            } else if (FUNCTIONS.contains(token)) {
                if (!"(".equals(take())) throw invalid();
                result = new Node(token,null,expression(0),null);
                if (!")".equals(take())) throw invalid();
            } else if (SYMBOLS.contains(token) || NUMBER.matcher(token).matches()) {
                result = new Node("atom",token,null,null);
            } else {
                throw invalid();
            }
            while (true) {
                String next = peek();
                boolean implicit = next != null && ("(".equals(next)
                        || SYMBOLS.contains(next) || FUNCTIONS.contains(next));
                int priority = implicit ? 20 : priority(next);
                if (priority < minimum) break;
                if (!implicit) take();
                boolean power = "^".equals(next) || "**".equals(next);
                Node right = expression(power ? priority : priority + 1);
                result = new Node(implicit ? "*" : power ? "^" : next,null,result,right);
            }
            depth--;
            return result;
        }

        private int priority(String op) {
            if (op == null) return -1;
            return switch (op) {
                case "+", "-" -> 10;
                case "*", "/" -> 20;
                case "^", "**" -> 30;
                default -> -1;
            };
        }
    }
}
