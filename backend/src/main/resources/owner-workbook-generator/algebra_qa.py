#!/usr/bin/env python3
"""Bounded, non-evaluating symbolic QA for explicit lesson assertions.

SymPy receives only expression trees built by this parser, never untrusted Python
or parse_expr/eval input. Missing assertions are reported as missing coverage.
"""
import json
import re
import sys
from pathlib import Path
import sympy as s

SYMBOLS = {name: s.Symbol(name, real=True) for name in ('x', 'y', 'z', 'a', 'b', 'c', 'm', 'n')}
FUNCTIONS = {'sqrt': s.sqrt, 'sin': s.sin, 'cos': s.cos, 'exp': s.exp, 'log': s.log, 'abs': s.Abs}
TOKEN = re.compile(r'\s*(\d+(?:\.\d+)?|[A-Za-z]+|\*\*|[+\-*/^(),])')


def degree_bound(value):
    if value.is_Atom:
        return 1 if value.is_Symbol else 0
    if value.is_Add:
        return max(map(degree_bound, value.args))
    if value.is_Mul:
        return sum(map(degree_bound, value.args))
    if value.is_Pow and value.exp.is_Integer:
        return degree_bound(value.base) * abs(int(value.exp))
    return sum(map(degree_bound, value.args))


def bounded(value):
    if s.count_ops(value) > 120 or degree_bound(value) > 32:
        raise ValueError('Symbolic complexity limit exceeded')
    for number in value.atoms(s.Rational):
        if int(number.p).bit_length() > 4096 or int(number.q).bit_length() > 4096:
            raise ValueError('Numeric complexity limit exceeded')
    return value


def plain_tex(text):
    if not isinstance(text, str) or not text.strip() or len(text) > 2000:
        raise ValueError('Expression must contain 1..2000 characters')
    text = text.replace('−', '-').replace('×', '*').replace('·', '*')
    text = text.replace('÷', '/').replace('∶', '/').replace(':', '/')
    # Only complete TeX command names are aliases. For example \divide and
    # \colonize must remain unsupported, not become a different expression.
    text = re.sub(r'\\(?:div|colon)(?![A-Za-z])', '/', text)
    text = re.sub(r'\\(?:dfrac|tfrac)(?![A-Za-z])', lambda _: r'\frac', text)
    text = text.replace(r'\left', '').replace(r'\right', '').replace(r'\cdot', '*').replace(r'\times', '*')
    def group(pos):
        while pos < len(text) and text[pos].isspace():
            pos += 1
        if pos >= len(text) or text[pos] != '{':
            raise ValueError('TeX command requires a braced argument')
        end, depth = pos + 1, 1
        while end < len(text) and depth:
            depth += (text[end] == '{') - (text[end] == '}')
            end += 1
        if depth:
            raise ValueError('Unbalanced TeX group')
        return text[pos + 1:end - 1], end
    # Each expansion removes one command. Nested commands are handled recursively.
    for _ in range(100):
        match = re.search(r'\\(frac|sqrt)\b', text)
        if not match:
            break
        first, end = group(match.end())
        if match[1] == 'frac':
            second, end = group(end)
            replacement = f'(({plain_tex(first)})/({plain_tex(second)}))'
        else:
            replacement = f'sqrt({plain_tex(first)})'
        text = text[:match.start()] + replacement + text[end:]
    if '\\' in text:
        raise ValueError('Unsupported TeX command in algebra assertion')
    return text.replace('{', '(').replace('}', ')')


class Parser:
    def __init__(self, text):
        self.tokens = []
        self.denominators = []
        text = plain_tex(text).strip()
        pos = 0
        while pos < len(text):
            match = TOKEN.match(text, pos)
            if not match:
                raise ValueError('Unsupported algebra syntax')
            self.tokens.append(match[1])
            pos = match.end()
        if len(self.tokens) > 400:
            raise ValueError('Algebra assertion is too complex')
        self.pos = 0
        self.depth = 0

    def peek(self):
        return self.tokens[self.pos] if self.pos < len(self.tokens) else None

    def take(self):
        token = self.peek()
        self.pos += 1
        return token

    def expression(self, minimum=0):
        self.depth += 1
        if self.depth > 35:
            raise ValueError('Algebra nesting limit exceeded')
        token = self.take()
        if token in ('+', '-'):
            result = self.expression(25)
            if token == '-':
                result = -result
        elif token == '(':
            result = self.expression()
            if self.take() != ')':
                raise ValueError('Unbalanced parentheses')
        elif token in FUNCTIONS:
            if self.take() != '(':
                raise ValueError('Function needs parentheses')
            argument = self.expression()
            if self.take() != ')':
                raise ValueError('Function needs one argument')
            result = FUNCTIONS[token](argument)
        elif token in SYMBOLS:
            result = SYMBOLS[token]
        elif token and re.fullmatch(r'\d+(?:\.\d+)?', token):
            if len(token) > 30:
                raise ValueError('Numeric literal is too long')
            result = s.Rational(token)
        else:
            raise ValueError('Unknown symbol or invalid expression')
        while True:
            op = self.peek()
            implicit = op is not None and (op == '(' or op in SYMBOLS or op in FUNCTIONS)
            priority = 20 if implicit else {'+': 10, '-': 10, '*': 20, '/': 20, '^': 30, '**': 30}.get(op, -1)
            if priority < minimum:
                break
            if not implicit:
                self.take()
            right = self.expression(priority if op in ('^', '**') else priority + 1)
            if implicit or op == '*':
                result *= right
            elif op == '+':
                result += right
            elif op == '-':
                result -= right
            elif op == '/':
                if right == 0:
                    raise ValueError('Zero denominator')
                self.denominators.append(right)
                result /= right
            else:
                if not right.is_Integer or abs(right) > 12:
                    raise ValueError('Only integer powers from -12 to 12 are supported in QA')
                if degree_bound(result) * abs(int(right)) > 32:
                    raise ValueError('Power complexity limit exceeded')
                if result.is_Rational and max(int(result.p).bit_length(), int(result.q).bit_length()) * abs(int(right)) > 4096:
                    raise ValueError('Numeric power complexity limit exceeded')
                if right < 0:
                    self.denominators.append(result)
                result = result ** right
            bounded(result)
        self.depth -= 1
        return result

    def parse(self):
        value = self.expression()
        if self.pos != len(self.tokens) or value.has(s.zoo, s.nan, s.oo, -s.oo):
            raise ValueError('Invalid or non-finite expression')
        return value


def parse(text):
    parser = Parser(text)
    return parser.parse(), parser.denominators


def restrictions(raw):
    if not isinstance(raw, list) or len(raw) > 20:
        raise ValueError('restrictions must be a list with at most 20 exclusions')
    values = []
    for text in raw:
        if not isinstance(text, str):
            raise ValueError('Restriction must be text, for example x != 3')
        pair = re.split(r'!=|≠|\\ne(?:q)?\b', text)
        if len(pair) != 2:
            raise ValueError('Only explicit != domain exclusions are supported')
        left, _ = parse(pair[0])
        right, _ = parse(pair[1])
        exclusion = s.simplify(left - right)
        if not exclusion.free_symbols or exclusion == 0:
            raise ValueError('Restriction must exclude a meaningful variable value')
        values.append(exclusion)
    return values


def real_poles(denominators):
    result = set()
    for denominator in denominators:
        symbols = denominator.free_symbols
        if len(symbols) != 1:
            if symbols:
                raise ValueError('Domain validation supports one variable per denominator')
            continue
        variable = next(iter(symbols))
        if not denominator.is_polynomial(variable) or s.degree(denominator, variable) > 4:
            raise ValueError('Domain validation requires polynomial denominators of degree <= 4')
        for root in s.solveset(denominator, variable, domain=s.S.Reals):
            result.add((variable, root))
    return result


def canonical_answer(value):
    """Exact output from a bounded expression tree, never a proposed AI answer."""
    value = bounded(s.simplify(value))
    if value.has(s.zoo, s.nan, s.oo, -s.oo) or value.is_real is False:
        raise ValueError('Derived answer is not a finite real expression')
    symbols = value.free_symbols
    # Rational functions are real on their original denominator domain. Other
    # forms must be provably real and finite, not an unchecked sqrt/log domain.
    rational = bool(symbols) and value.is_rational_function(*symbols)
    if not rational and (value.is_real is not True or value.is_finite is not True):
        raise ValueError('Derived answer has an unsupported real or finite domain')
    answer = s.sstr(value).replace('Abs(', 'abs(')
    # Keep outputs inside the same safe parser language and complexity budget.
    parsed, _ = parse(answer)
    if s.simplify(parsed - value) != 0:
        raise ValueError('Derived answer cannot be represented exactly')
    return answer


def validate(assertion):
    if not isinstance(assertion, dict):
        raise ValueError('Algebra assertion must be an object')
    excluded = restrictions(assertion.get('restrictions', []))
    kind = assertion.get('kind')
    if kind == 'expressionValue':
        expression, _ = parse(assertion['expression'])
        answer = canonical_answer(expression)
        # Reuse the existing equivalence and original-domain proof. In
        # particular cancellation still requires the visible exclusion.
        validate({'kind': 'equivalence', 'expression': assertion['expression'],
                  'answer': answer, 'restrictions': assertion.get('restrictions', [])})
        return {'kind': kind, 'passed': True, 'answer': answer}
    elif kind == 'relationValue':
        sides = assertion['relation'].split('=')
        if len(sides) != 2:
            raise ValueError('Relation must have exactly one equals sign')
        left, _ = parse(sides[0])
        right, _ = parse(sides[1])
        if left.free_symbols or right.free_symbols:
            raise ValueError('Relation tasks must be numeric')
        difference = bounded(s.simplify(left - right))
        if difference.has(s.zoo, s.nan, s.oo, -s.oo):
            raise ValueError('Relation is not finite')
        return {'kind': kind, 'passed': True, 'answer': 'true' if difference == 0 else 'false'}
    elif kind == 'linearValue':
        sides = assertion['equation'].split('=')
        if len(sides) != 2:
            raise ValueError('Equation must have exactly one equals sign')
        left, _ = parse(sides[0])
        right, _ = parse(sides[1])
        variables = left.free_symbols | right.free_symbols
        if len(variables) != 1:
            raise ValueError('A linear task must contain exactly one variable')
        variable = next(iter(variables))
        if 'variable' in assertion and assertion['variable'] != str(variable):
            raise ValueError('Declared variable does not match the visible linear equation')
        difference = bounded(s.cancel(left - right))
        if not difference.is_polynomial(variable) or s.degree(difference, variable) != 1:
            raise ValueError('A linear task requires a nonconstant affine difference')
        polynomial = s.Poly(difference, variable)
        answer = canonical_answer(-polynomial.TC() / polynomial.LC())
        validate({'kind': 'linearSolution', 'equation': assertion['equation'],
                  'solution': {str(variable): answer}, 'restrictions': assertion.get('restrictions', [])})
        return {'kind': kind, 'passed': True, 'variable': str(variable), 'answer': answer}
    elif kind == 'equivalence':
        expression, denominators = parse(assertion['expression'])
        answer, answer_denominators = parse(assertion['answer'])
        if s.count_ops(expression) + s.count_ops(answer) > 120:
            raise ValueError('Symbolic complexity limit exceeded')
        if s.simplify(expression - answer) != 0:
            raise ValueError('Expressions are not equivalent')
        changed_domain = real_poles(denominators) ^ real_poles(answer_denominators)
        for variable, pole in changed_domain:
            if not any(s.simplify(item.subs(variable, pole)) == 0 for item in excluded):
                raise ValueError(f'Missing domain restriction: {variable} != {pole}')
    elif kind in ('solution', 'linearSolution'):
        sides = assertion['equation'].split('=')
        if len(sides) != 2:
            raise ValueError('Equation must have exactly one equals sign')
        left, ld = parse(sides[0])
        right, rd = parse(sides[1])
        solution = assertion.get('solution')
        if not isinstance(solution, dict) or not solution:
            raise ValueError('Solution must map variables to values')
        if kind == 'linearSolution':
            variables = left.free_symbols | right.free_symbols
            if len(variables) != 1:
                raise ValueError('A linear task must contain exactly one variable')
            variable = next(iter(variables))
            if set(solution) != {str(variable)}:
                raise ValueError('A linear task must supply exactly its own variable')
            difference = bounded(s.cancel(left - right))
            if not difference.is_polynomial(variable) or s.degree(difference, variable) != 1:
                raise ValueError('A linear task requires a nonconstant affine difference')
            polynomial = s.Poly(difference, variable)
            root = s.simplify(-polynomial.TC() / polynomial.LC())
            proposed, _ = parse(str(solution[str(variable)]))
            if root.is_real is not True or proposed.free_symbols or s.simplify(proposed - root) != 0:
                raise ValueError('Answer is not the unique real solution of the linear task')
        values = {}
        for name, raw in solution.items():
            if name not in SYMBOLS:
                raise ValueError('Unknown solution variable')
            value, _ = parse(str(raw))
            if value.free_symbols or value.is_real is not True:
                raise ValueError('Solution values must be real constants')
            values[SYMBOLS[name]] = value
        if (left.free_symbols | right.free_symbols) - values.keys():
            raise ValueError('Solution omits an equation variable')
        if any(s.simplify(d.subs(values)) == 0 for d in ld + rd + excluded):
            raise ValueError('Solution violates the original domain or an exclusion')
        residual = s.simplify((left - right).subs(values))
        if residual != 0 or residual.has(s.zoo, s.nan, s.oo, -s.oo):
            raise ValueError('Solution does not satisfy the original equation')
    else:
        raise ValueError('Unknown algebra assertion kind')
    return {'kind': kind, 'passed': True}


def verify_document(document):
    assertions = list(document.get('qa', {}).get('algebra', []))
    def walk(node, depth=0):
        if depth > 40:
            raise ValueError('Document nesting limit exceeded')
        if isinstance(node, dict):
            if 'validation' in node:
                assertions.append(node['validation'])
            for key, item in node.items():
                if key not in ('qa', 'validation'):
                    walk(item, depth + 1)
        elif isinstance(node, list):
            for item in node:
                walk(item, depth + 1)
    walk(document)
    if len(assertions) > 120:
        raise ValueError('At most 120 algebra assertions are allowed')
    results = []
    for index, assertion in enumerate(assertions):
        try:
            results.append({'index': index, **validate(assertion)})
        except (ValueError, KeyError, TypeError, NotImplementedError) as error:
            results.append({'index': index, 'passed': False, 'error': str(error)})
    return {'passed': all(item['passed'] for item in results), 'checked': len(results),
            'coverage': 'explicit assertions only' if results else 'no algebra assertions supplied', 'results': results}


if __name__ == '__main__':
    try:
        document = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
        result = verify_document(document)
    except Exception as error:
        result = {'passed': False, 'checked': 0, 'error': str(error)}
    print(json.dumps(result, ensure_ascii=True))
    sys.exit(0 if result['passed'] else 1)
