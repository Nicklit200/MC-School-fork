import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HomeworkMathText, homeworkMathSegments, plainMathToLatex } from './HomeworkMathText';

describe('teacher homework mathematical typography', () => {
  it('renders slash fractions as stacked math in the exercise and answers', () => {
    const { container } = render(<HomeworkMathText value="-1/2+3/4-(-1/4), вычислить" />);
    // A compound expression may be split into multiple KaTeX spans; the
    // important contract is that all three fractions render mathematically.
    expect(container.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(1);
    expect(container.querySelectorAll('mfrac')).toHaveLength(3);
    expect(container).toHaveTextContent('вычислить');
    // KaTeX's accessible MathML annotation intentionally contains TeX source;
    // check the rendered math nodes, not hidden annotation textContent.
    expect(container.querySelectorAll('mfrac')).toHaveLength(3);
  });

  it('preserves explanatory prose while typesetting the calculation', () => {
    const { container } = render(<HomeworkMathText value="1/2, так как -4/8+6/8+2/8=4/8" />);
    expect(container.querySelectorAll('mfrac')).toHaveLength(5);
    expect(container).toHaveTextContent('так как');
  });

  it('supports radicals, powers, Greek symbols, inequalities and multiplication', () => {
    const { container } = render(<HomeworkMathText value="√(x^2+9)+sqrt(16) ≥ π×2" />);
    expect(container.querySelectorAll('msqrt')).toHaveLength(2);
    expect(container.querySelectorAll('msup')).toHaveLength(1);
    expect(container.querySelector('.katex')).not.toBeNull();
  });

  it('renders explicit LaTeX input without treating it as executable HTML', () => {
    const { container } = render(<HomeworkMathText value={'Решение: \\(\\frac{1}{2}+\\sqrt{9}\\)'} />);
    expect(container.querySelectorAll('mfrac')).toHaveLength(1);
    expect(container.querySelectorAll('msqrt')).toHaveLength(1);
    expect(container).toHaveTextContent('Решение:');
    const attack = render(<HomeworkMathText value={'\\(\\href{javascript:alert(1)}{click}\\)'} />);
    expect(attack.container.querySelector('a[href^="javascript:"]')).toBeNull();
  });

  it('keeps ordinary explanation as text without creating math markup', () => {
    const { container } = render(<HomeworkMathText value="Необходимо повторить правило сложения дробей." />);
    expect(container.querySelector('.katex')).toBeNull();
    expect(screen.getByText('Необходимо повторить правило сложения дробей.')).toBeInTheDocument();
  });

  it('does not remove unfamiliar input on a KaTeX parse error', () => {
    const { container } = render(<HomeworkMathText value={'\\(\\badCommand{123}\\)'} />);
    expect(container).toHaveTextContent('\\(\\badCommand{123}\\)');
  });

  it('converts common raw fractional and square-root notations without calculating answers', () => {
    expect(plainMathToLatex('1/2+3/4')).toBe('\\frac{1}{2}+\\frac{3}{4}');
    expect(plainMathToLatex('sqrt(9)+√(16)')).toBe('\\sqrt{9}+\\sqrt{16}');
    expect(plainMathToLatex('x^2')).toBe('x^2');
    const parts = homeworkMathSegments('1/2, так как 2/4');
    expect(parts.filter(p => p.kind === 'math')).toHaveLength(2);
  });
});
