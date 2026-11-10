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
});
