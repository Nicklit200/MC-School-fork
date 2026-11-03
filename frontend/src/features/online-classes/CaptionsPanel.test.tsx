import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n/I18nContext';
import { CaptionsPanel } from './CaptionsPanel';

const fixture = vi.hoisted(() => ({ entries: [] as { text: string; streamInfo: { id: string } }[] }));
vi.mock('@livekit/components-react', () => ({ useTranscriptions: () => fixture.entries }));

function panel(enabled = true) {
  return <I18nProvider><CaptionsPanel enabled={enabled} /></I18nProvider>;
}

beforeEach(() => { fixture.entries = []; localStorage.setItem('language', 'RU'); });
afterEach(cleanup);

describe('caption overlay visibility', () => {
  it('renders nothing when disabled even if speech entries exist', () => {
    fixture.entries = [{ text: 'Spoken words', streamInfo: { id: 'one' } }];
    const { container } = render(panel(false));
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('log')).not.toBeInTheDocument();
  });

  it('hides the entire section for no speech or whitespace without a waiting placeholder', () => {
    const { container, rerender } = render(panel());
    expect(container).toBeEmptyDOMElement();
    fixture.entries = [{ text: '', streamInfo: { id: 'empty' } }, { text: ' \n\t ', streamInfo: { id: 'blank' } }];
    rerender(panel());
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('log')).not.toBeInTheDocument();
    expect(screen.queryByText(/Ожидание речи|Warte auf Sprache/)).not.toBeInTheDocument();
  });

  it('keeps the latest four nonblank captions in the polite accessible log', () => {
    fixture.entries = Array.from({ length: 6 }, (_, index) => ({ text: `Phrase ${index + 1}`, streamInfo: { id: `${index}` } }));
    fixture.entries.push({ text: ' ', streamInfo: { id: 'blank-tail' } });
    const { container, rerender } = render(panel());
    const log = screen.getByRole('log');
    expect(log).toHaveAttribute('aria-live', 'polite');
    expect(log).toHaveAttribute('aria-atomic', 'false');
    expect(within(log).getAllByText(/^Phrase/).map(line => line.textContent)).toEqual(['Phrase 3', 'Phrase 4', 'Phrase 5', 'Phrase 6']);
    expect(screen.queryByText('Phrase 1')).not.toBeInTheDocument();
    const section = container.querySelector('section')!;
    expect(section).toHaveAttribute('aria-labelledby', 'captions-title');
    expect(container.querySelector('#captions-title')).toBeInTheDocument();
    fixture.entries = [];
    rerender(panel());
    expect(container).toBeEmptyDOMElement();
  });

  it('renders caption content as safe text', () => {
    const text = '<img src=x onerror=alert(1)><script>private()</script>';
    fixture.entries = [{ text, streamInfo: { id: 'unsafe-markup' } }];
    const { container } = render(panel());
    expect(screen.getByRole('log')).toHaveTextContent(text);
    expect(container.querySelector('img, script')).toBeNull();
  });
});
