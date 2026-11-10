import unittest
from algebra_qa import validate, verify_document, parse


class AlgebraTests(unittest.TestCase):
    def test_school_division_aliases_and_fraction_variants(self):
        for operator in [r'\div', r'\colon', '÷', '∶', ':']:
            with self.subTest(operator=operator):
                result = validate({'kind': 'expressionValue',
                                   'expression': rf'\frac{{2}}{{7}} {operator} \frac{{1}}{{14}}'})
                self.assertEqual(result['answer'], '4')
        self.assertEqual(validate({'kind': 'expressionValue',
                                  'expression': r'\dfrac{2}{3} \div \tfrac{1}{6}'})['answer'], '4')
        self.assertEqual(validate({'kind': 'expressionValue', 'expression': r'1 \div2'})['answer'], '1/2')

    def test_division_aliases_keep_precedence_and_left_associativity(self):
        for expression, expected in [('6:3:2', '1'), ('6:(3:2)', '4'),
                                     ('1/2 + 3/4 : (3/2)', '1'),
                                     ('(1/2+3/4):(5/2)', '1/2')]:
            with self.subTest(expression=expression):
                self.assertEqual(validate({'kind': 'expressionValue', 'expression': expression})['answer'], expected)

    def test_division_aliases_reject_zero_and_preserve_original_domain(self):
        for expression in [r'\frac{2}{3} \div \frac{0}{1}', r'2 \colon (1-1)', '2÷0', '2∶0', '2:0']:
            with self.subTest(expression=expression), self.assertRaisesRegex(ValueError, 'Zero denominator'):
                validate({'kind': 'expressionValue', 'expression': expression})
        assertion = {'kind': 'expressionValue', 'expression': r'x \div x'}
        with self.assertRaisesRegex(ValueError, 'Missing domain'):
            validate(assertion)
        assertion['restrictions'] = ['x != 0']
        self.assertEqual(validate(assertion)['answer'], '1')

    def test_division_aliases_never_accept_command_prefixes_or_injections(self):
        for expression in [r'2 \divide 3', r'2 \division 3', r'2 \colonize 3',
                           r'\dfracx{1}{2}', r'\tfractal{1}{2}', r'\href{https://example.com}{2}',
                           r'2 \div __import__("os")', r'\require{html}']:
            with self.subTest(expression=expression), self.assertRaises(ValueError):
                validate({'kind': 'expressionValue', 'expression': expression})

    def test_mixed_fraction_notation_is_a_sum_not_implicit_multiplication(self):
        # A valid mixed number contains a whole number plus a positive fraction.
        for expression in [r'1\frac{7}{12}', r'1 \frac{7}{12}',
                           r'1\,\frac{7}{12}', r'1\ \frac{7}{12}',
                           r'1\dfrac{7}{12}', r'1\tfrac{7}{12}', '1 7/12']:
            with self.subTest(expression=expression):
                self.assertEqual(parse(expression)[0], parse('19/12')[0])
                self.assertTrue(validate({'kind': 'equivalence', 'expression': expression,
                                          'answer': r'\frac{19}{12}'})['passed'])
                with self.assertRaisesRegex(ValueError, 'not equivalent'):
                    validate({'kind': 'equivalence', 'expression': expression,
                              'answer': '7/12'})

    def test_negative_mixed_fractions_and_explicit_multiplication(self):
        for expression in [r'-1\frac{7}{12}', r'-1\,\frac{7}{12}', '-1 7/12']:
            with self.subTest(expression=expression):
                self.assertEqual(validate({'kind': 'expressionValue',
                                           'expression': expression})['answer'], '-19/12')
        for expression in [r'2*\frac{3}{4}', r'2\cdot\frac{3}{4}',
                           r'x\frac{3}{4}', '2(3/4)']:
            with self.subTest(expression=expression):
                self.assertTrue(validate({'kind': 'equivalence', 'expression': expression,
                                          'answer': 'x*3/4' if expression.startswith('x') else '3/2'})['passed'])
        with self.assertRaisesRegex(ValueError, 'Zero denominator'):
            parse(r'1\frac{2}{0}')
        with self.assertRaises(ValueError):
            parse(r'1\frac{x}{12}\evil')

    def test_teacher_solutions_with_mixed_numbers_are_checked(self):
        document = {
            'qa': {'algebra': [{'kind': 'equivalence', 'expression': r'1\frac{7}{12}',
                                'answer': r'\frac{19}{12}'}]},
            'teacherPages': [{'blocks': [{'type': 'solutions', 'items': [
                {'label': '7a', 'math': {'latex': r'1\frac{7}{12}=\frac{19}{12}'}},
                {'label': '7b', 'math': {'latex': r'-1\frac{7}{12}=-\frac{19}{12}'}},
            ]}]}],
        }
        valid = verify_document(document)
        self.assertTrue(valid['passed'], valid)
        self.assertEqual(valid['teacherNumericSolutions']['checked'], 2)
        document['teacherPages'][0]['blocks'][0]['items'][0]['math']['latex'] = r'1\frac{7}{12}=\frac{7}{12}'
        invalid = verify_document(document)
        self.assertFalse(invalid['passed'])
        self.assertEqual(invalid['teacherNumericSolutions']['failed'][0]['position'], 1)

    def test_binomial_equivalence(self):
        self.assertTrue(validate({'kind': 'equivalence', 'expression': '(x+3)^2', 'answer': 'x^2+6x+9'})['passed'])

    def test_tex_fraction_and_domain(self):
        item = {'kind': 'equivalence', 'expression': r'\frac{x^2-9}{x-3}', 'answer': 'x+3', 'restrictions': ['x != 3']}
        self.assertTrue(validate(item)['passed'])
        item['restrictions'] = []
        with self.assertRaisesRegex(ValueError, 'Missing domain'):
            validate(item)

    def test_correct_and_incorrect_substitution(self):
        item = {'kind': 'solution', 'equation': '2x-1=5-x', 'solution': {'x': 2}}
        self.assertTrue(validate(item)['passed'])
        item['solution']['x'] = 3
        with self.assertRaises(ValueError):
            validate(item)

    def test_linear_tasks_require_the_complete_unique_solution(self):
        self.assertTrue(validate({'kind': 'linearSolution', 'equation': '2x-1=5-x',
                                  'solution': {'x': 2}})['passed'])
        self.assertTrue(validate({'kind': 'linearSolution', 'equation': r'\frac{x}{2}+1=2',
                                  'solution': {'x': 2}})['passed'])
        for equation, solution in [('x^2=4', {'x': 2}), ('x=x', {'x': 2}),
                                   ('x+1=x', {'x': 2}), ('x+y=2', {'x': 1, 'y': 1}),
                                   ('x=2', {'x': 2, 'y': 3}), ('x=2', {'x': 3})]:
            with self.subTest(equation=equation), self.assertRaises(ValueError):
                validate({'kind': 'linearSolution', 'equation': equation, 'solution': solution})

    def test_linear_tasks_keep_original_domain_and_restrictions(self):
        for equation, restrictions in [('(x^2-1)/(x-1)=2', []), ('x=2', ['x != 2'])]:
            with self.subTest(equation=equation), self.assertRaises(ValueError):
                validate({'kind': 'linearSolution', 'equation': equation,
                          'solution': {'x': 1 if not restrictions else 2}, 'restrictions': restrictions})

    def test_original_denominator_before_simplification(self):
        with self.assertRaisesRegex(ValueError, 'domain'):
            validate({'kind': 'solution', 'equation': '(x^2-9)/(x-3)=6', 'solution': {'x': 3}})

    def test_fraction_values_derive_exact_answers_from_conditions_only(self):
        for expression, answer in [('1/2+1/4', '3/4'), ('3/5+4/7', '41/35'),
                                   ('7/8-1/4', '5/8'), ('2/3*9/10', '3/5'),
                                   ('5/6/(10/9)', '3/4')]:
            with self.subTest(expression=expression):
                result = validate({'kind': 'expressionValue', 'expression': expression})
                self.assertTrue(result['passed'])
                self.assertEqual(result['answer'], answer)
                # A discarded model answer cannot influence derivation. The
                # new kind never treats an answer field as an assertion.
                self.assertEqual(validate({'kind': 'expressionValue', 'expression': expression,
                                           'answer': '999'})['answer'], answer)
                with self.assertRaises(ValueError):
                    validate({'kind': 'equivalence', 'expression': expression, 'answer': '999'})

    def test_derived_values_keep_original_domain_and_are_finite_real(self):
        item = {'kind': 'expressionValue', 'expression': '(x^2-9)/(x-3)', 'restrictions': ['x != 3']}
        self.assertEqual(validate(item)['answer'], 'x + 3')
        item['restrictions'] = []
        with self.assertRaisesRegex(ValueError, 'Missing domain'):
            validate(item)
        for expression in ['1/0', 'sqrt(-1)', 'log(0)', 'sqrt(x)', 'log(x)']:
            with self.subTest(expression=expression), self.assertRaises(ValueError):
                validate({'kind': 'expressionValue', 'expression': expression})

    def test_linear_values_derive_the_unique_root_without_a_proposed_answer(self):
        for equation, answer in [('2x-1=5-x', '2'), ('x/2+1=2', '2'), ('3x=1', '1/3')]:
            with self.subTest(equation=equation):
                result = validate({'kind': 'linearValue', 'equation': equation})
                self.assertEqual((result['variable'], result['answer']), ('x', answer))
                self.assertTrue(result['passed'])
        with self.assertRaisesRegex(ValueError, 'Declared variable'):
            validate({'kind': 'linearValue', 'equation': 'y=2', 'variable': 'x'})
        for equation, restrictions in [('x^2=4', []), ('x=x', []), ('x+1=x', []),
                                       ('x+y=2', []), ('(x^2-1)/(x-1)=2', []), ('x=2', ['x != 2'])]:
            with self.subTest(equation=equation), self.assertRaises(ValueError):
                validate({'kind': 'linearValue', 'equation': equation, 'restrictions': restrictions})

    def test_derived_document_results_keep_assertion_order_for_private_answers(self):
        result = verify_document({'qa': {'algebra': [
            {'kind': 'expressionValue', 'expression': '1/2+1/4'},
            {'kind': 'linearValue', 'equation': '3x=1'}]}})
        self.assertTrue(result['passed'])
        self.assertEqual(result['checked'], 2)
        self.assertEqual([(item['index'], item['answer']) for item in result['results']], [(0, '3/4'), (1, '1/3')])

    def test_wrong_teacher_answer_is_not_hidden_by_unrelated_correct_assertion(self):
        document = {
            'qa': {'algebra': [{'kind': 'equivalence', 'expression': '1+1', 'answer': '2'}]},
            'teacherPages': [{'blocks': [{'type': 'solutions', 'items': [
                {'label': '1a', 'math': {'latex': '2+2=5'}},
            ]}]}],
        }
        result = verify_document(document)
        self.assertFalse(result['passed'])
        self.assertEqual(result['checked'], 1)
        self.assertEqual(result['teacherNumericSolutions']['checked'], 1)
        self.assertEqual(result['teacherNumericSolutions']['failed'][0]['position'], 1)

    def test_mathjax_fractions_and_nested_teacher_solutions_are_verified(self):
        document = {
            'qa': {'algebra': [{'kind': 'equivalence', 'expression': '3/4', 'answer': '3/4'}]},
            'teacherPages': [{'blocks': [{'type': 'grid', 'children': [
                {'type': 'solutions', 'items': [
                    {'label': '1a', 'math': {'latex': r'\frac{1}{2}+\frac{1}{4}=\frac{3}{4}'}},
                    {'label': '1b', 'math': ['6', '+', '8', '+', '10', '=', '24']},
                ]}
            ]}]}],
        }
        result = verify_document(document)
        self.assertTrue(result['passed'])
        self.assertEqual(result['teacherNumericSolutions'], {'checked': 2, 'failed': []})

    def test_symbolic_equation_is_not_mistaken_for_identity(self):
        document = {
            'qa': {'algebra': [{'kind': 'solution', 'equation': '2*x+3=7', 'solution': {'x': 2}}]},
            'teacherPages': [{'blocks': [{'type': 'solutions', 'items': [
                {'label': '1a', 'math': {'latex': '2x+3=7'}},
            ]}]}],
        }
        result = verify_document(document)
        self.assertTrue(result['passed'])
        self.assertEqual(result['teacherNumericSolutions']['checked'], 0)

    def test_rejects_wrong_equivalence(self):
        with self.assertRaises(ValueError):
            validate({'kind': 'equivalence', 'expression': '(x+3)^2', 'answer': 'x^2+9'})

    def test_safe_parser_and_bounds(self):
        for expression in ["__import__('os').system('whoami')", 'x.__class__', '2^100000', 'x^x', '(((((2^12)^12)^12)^12)^12)', '((x^12)^12)^12', '(' * 100 + 'x' + ')' * 100]:
            with self.subTest(expression=expression), self.assertRaises(ValueError):
                parse(expression)

    def test_rejects_empty_domain_disguised_as_restriction(self):
        for restriction in ['0 != 0', 'x-x != 0']:
            with self.assertRaises(ValueError):
                validate({'kind': 'equivalence', 'expression': '(x^2-9)/(x-3)', 'answer': 'x+3', 'restrictions': [restriction]})

    def test_nested_assertion_and_missing_coverage(self):
        self.assertEqual(verify_document({})['checked'], 0)
        result = verify_document({'teacherPages': [{'blocks': [{'type': 'grid', 'children': [
            {'validation': {'kind': 'solution', 'equation': 'x=2', 'solution': {'x': 2}}}]}]}]})
        self.assertEqual(result['checked'], 1)
        self.assertTrue(result['passed'])


if __name__ == '__main__':
    unittest.main()
