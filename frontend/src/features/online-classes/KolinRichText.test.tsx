import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { KolinRichText, parseKolinBlocks } from './KolinRichText';

describe('Kolyn rich explanation renderer', () => {
  it('renders meaningful success, error and caution labels with separate styles', () => {
    render(<KolinRichText text={'## Проверка\\n✅ Правильно: $2+3=5$\\n❌ Ошибка: пропущен знак минус\\n💡 Совет: повторите правило\\n⚠️ Не удалось проверить: рукопись размыта'.replace(/\\n/g, '\n')} />);
    expect(screen.getByText('Проверка')).toBeInTheDocument();
    expect(screen.getByText(/Правильно:/).closest('.kolin-rich__callout')).toHaveClass('kolin-rich__callout--correct');
    expect(screen.getByText(/Ошибка:/).closest('.kolin-rich__callout')).toHaveClass('kolin-rich__callout--incorrect');
    expect(screen.getByText(/Совет:/).closest('.kolin-rich__callout')).toHaveClass('kolin-rich__callout--tip');
    expect(screen.getByText(/Не удалось проверить:/).closest('.kolin-rich__callout')).toHaveClass('kolin-rich__callout--warning');
  });
  it('displays model-provided markup as inert text', () => {
    const view = render(<KolinRichText text={'<img src=x onerror=alert(1)>\n<script>alert(2)</script>'} />);
    expect(view.container.querySelector('img,script')).toBeNull();
    expect(view.container).toHaveTextContent('<img src=x onerror=alert(1)>');
  });
  it('preserves numbered steps, math expressions and fraction formatting', () => {
    render(<KolinRichText text={'1. Сначала раскрываем скобки\n2. Далее проверяем $\\frac{1}{2}+x$'} />);
    expect(screen.getByText('1.')).toBeInTheDocument();
    expect(screen.getByText('2.')).toBeInTheDocument();
    expect(document.querySelector('.katex .mfrac')).not.toBeNull();
  });
  it('keeps plain responses as paragraphs', () => {
    expect(parseKolinBlocks('Просто ответ.')).toEqual([{ kind: 'paragraph', text: 'Просто ответ.' }]);
  });
  it('renders the actual multi-line formula syntax used for Mark homework without raw delimiters', () => {
    const source = [
      '### Марк, страница 1, задание № 1',
      '1. **Складываем меньшие стороны:**',
      '\\[',
      ' 4+6=10\\text{ см}.',
      '\\]',
      '**Ответ:** треугольник не существует.',
    ].join('\n');
    const view = render(<KolinRichText text={source} />);
    expect(screen.getByText('Марк, страница 1, задание № 1').tagName).toBe('H4');
    expect(screen.getByText('Складываем меньшие стороны:').tagName).toBe('STRONG');
    const formula = view.container.querySelector('.kolin-rich__formula');
    expect(formula).not.toBeNull();
    expect(formula?.querySelector('.katex-html')).toHaveTextContent(/4\+6=10/);
    expect(view.container).not.toHaveTextContent('\\[');
    expect(formula?.querySelector('.katex-html')).not.toHaveTextContent('\\text{');
    expect(screen.getByText('Ответ:').tagName).toBe('STRONG');
  });

  it('handles display math on a single line and dollar-delimited math as well', () => {
    const view = render(<KolinRichText text={'\\[x^2=9\\]\n$$\\frac{1}{2}+\\text{ см}$$'} />);
    const formulas = view.container.querySelectorAll('.kolin-rich__formula');
    expect(formulas).toHaveLength(2);
    expect(formulas[0].querySelector('.katex .msupsub')).not.toBeNull();
    expect(formulas[1]).toHaveTextContent('см');
    expect(formulas[1].querySelector('.katex .mfrac')).not.toBeNull();
  });

  it('typesets Vitalina feedback with separate error, correct answer and hint', () => {
    const source = [
      'Задание 04. (p-5)²',
      '❌ Ошибка: первый шаг $p^2-2\\times p\\times(-5)+25$ неверен.',
      '✅ Правильно:',
      '\\[',
      '(p-5)^2=p^2+2\\cdot p\\cdot(-5)+(-5)^2',
      '=p^2-10p+25',
      '\\]',
      '💡 Совет: подставить $b=-5$ в $(a+b)^2=a^2+2ab+b^2$.',
    ].join('\n');
    const view = render(<KolinRichText text={source} />);
    const good = view.container.querySelector('.kolin-rich__callout--correct');
    expect(good?.querySelector('.katex-display .katex-html')).not.toBeNull();
    expect(good?.querySelector('.katex-html')).toHaveTextContent('10p');
    expect(view.container.querySelector('.kolin-rich__callout--incorrect .katex')).not.toBeNull();
    expect(view.container.querySelectorAll('.kolin-rich__callout--tip .katex')).toHaveLength(2);
    expect(view.container.querySelector('.kolin-rich__math-fallback')).toBeNull();
  });

  it('typesets an aligned equation, roots, fractions and inline formulas', () => {
    const source = [
      '\\[\\begin{aligned}x^2+2x+1&=(x+1)^2\\\\x&=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}\\end{aligned}\\]',
      'Inline: \\(\\frac{3}{4}\\) and $\\sqrt{9}=3$.',
    ].join('\n');
    const view = render(<KolinRichText text={source} />);
    expect(view.container.querySelectorAll('.katex-html').length).toBeGreaterThanOrEqual(3);
    expect(view.container.querySelector('.katex-display .mfrac')).not.toBeNull();
    expect(view.container.querySelector('.katex-display .sqrt')).not.toBeNull();
    expect(view.container.querySelector('.kolin-rich__math-fallback')).toBeNull();
  });

  it('does not allow AI formulas to inject HTML, images or dangerous links', () => {
    const source = [
      '$\\href{javascript:alert(1)}{\\text{click}}$',
      '\\[<img src=x onerror=alert(1)>\\]',
    ].join('\n');
    const view = render(<KolinRichText text={source} />);
    expect(view.container.querySelector('a,img,script,iframe')).toBeNull();
  });


  it('renders the multiline single-dollar fraction chain from worksheet feedback', () => {
    const source = [
      'Далее:',
      '$\\frac{3(2x+3)+2(x-1)}{12}',
      '=\\frac{6x+9+2x-2}{12}',
      '=\\frac{8x+7}{12}$.',
      '**Правильный ответ:** $\\frac{8x+7}{12}$.',
    ].join('\n');
    const view = render(<KolinRichText text={source} />);
    const formula = view.container.querySelector('.katex-display .katex-html');
    expect(formula?.querySelectorAll('.mfrac')).toHaveLength(3);
    expect(view.container.querySelector('.kolin-rich__math-fallback')).toBeNull();
    expect(formula).not.toHaveTextContent('\\frac');
  });

  it('renders multiline parenthesized math inside colored feedback', () => {
    const view = render(<KolinRichText text={'✅ Верно:\n\\(\\frac{1}{2}+\\frac{1}{4}\n=\\frac{3}{4}\\)'} />);
    expect(view.container.querySelectorAll('.kolin-rich__callout--correct .katex-display .mfrac')).toHaveLength(3);
    expect(view.container.querySelector('.kolin-rich__math-fallback')).toBeNull();
  });

  it('preserves plain text and existing inline math', () => {
    expect(parseKolinBlocks('Price $10\nPrice $20')).toEqual([{ kind: 'paragraph', text: 'Price $10\nPrice $20' }]);
    const view = render(<KolinRichText text={'$2+3=5$ and $\\frac{1}{2}$'} />);
    expect(view.container.querySelectorAll('.katex')).toHaveLength(2);
    expect(view.container.querySelector('.katex-display')).toBeNull();
  });

});
