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
    expect(document.querySelector('.kolin-rich__fraction')).not.toBeNull();
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
    expect(formula).toHaveTextContent('4+6=10 см.');
    expect(view.container).not.toHaveTextContent('\\[');
    expect(view.container).not.toHaveTextContent('\\text{');
    expect(screen.getByText('Ответ:').tagName).toBe('STRONG');
  });

  it('handles display math on a single line and dollar-delimited math as well', () => {
    const view = render(<KolinRichText text={'\\[x^2=9\\]\n$$\\frac{1}{2}+\\text{ см}$$'} />);
    const formulas = view.container.querySelectorAll('.kolin-rich__formula');
    expect(formulas).toHaveLength(2);
    expect(formulas[0]).toHaveTextContent('x²=9');
    expect(formulas[1]).toHaveTextContent('см');
    expect(formulas[1].querySelector('.kolin-rich__fraction')).not.toBeNull();
  });

});
