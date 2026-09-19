import { useState } from 'react';
import { onlineClassesApi, type AnnotationTargetType } from '../../api/onlineClasses';
import { useI18n } from '../../i18n/I18nContext';
import type { TranslationKey } from '../../i18n/translations';
import { WhiteboardCanvas, type Tool } from './WhiteboardCanvas';
import { useAnnotationBoard } from './useAnnotationBoard';

const TOOLS: { tool: Tool; labelKey: TranslationKey }[] = [
  { tool: 'pen', labelKey: 'onlineClass.whiteboard.pen' },
  { tool: 'highlighter', labelKey: 'onlineClass.whiteboard.highlighter' },
  { tool: 'line', labelKey: 'onlineClass.whiteboard.line' },
  { tool: 'arrow', labelKey: 'onlineClass.whiteboard.arrow' },
  { tool: 'rect', labelKey: 'onlineClass.whiteboard.rect' },
  { tool: 'ellipse', labelKey: 'onlineClass.whiteboard.ellipse' },
  { tool: 'text', labelKey: 'onlineClass.whiteboard.text' },
  { tool: 'erase', labelKey: 'onlineClass.whiteboard.eraser' },
  { tool: 'laser', labelKey: 'onlineClass.whiteboard.laser' },
];

const COLORS = ['#111111', '#d62828', '#0353a4', '#2a9d8f', '#e9c46a'];

/**
 * Whiteboard, or an overlay on a shared screen.
 *
 * <p>The same component serves both: only the target type differs, which is
 * what keeps a later notebook-camera surface a matter of passing a different
 * `targetType`.
 */
export function WhiteboardPanel({
  classId,
  actorId,
  isHost,
  targetType = 'WHITEBOARD',
  targetId = 'board-1',
  sourceAspect = null,
  canAnnotate = true,
  onLaserMove,
}: {
  classId: string;
  actorId: string;
  isHost: boolean;
  targetType?: AnnotationTargetType;
  targetId?: string;
  sourceAspect?: number | null;
  canAnnotate?: boolean;
  onLaserMove?: (point: { x: number; y: number }) => void;
}) {
  const { t } = useI18n();
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState(COLORS[0]);
  const [strokeWidth, setStrokeWidth] = useState(0.004);
  const [saved, setSaved] = useState(false);

  const board = useAnnotationBoard({
    classId,
    targetType,
    targetId,
    actorId,
    isHost,
  });

  const saveSnapshot = async () => {
    const stage = document.querySelector<HTMLCanvasElement>('.whiteboard__surface canvas');
    if (!stage || !board.document) return;
    try {
      await onlineClassesApi.saveAnnotationSnapshot(
        classId,
        board.document.id,
        stage.toDataURL('image/png'),
      );
      setSaved(true);
    } catch {
      setSaved(false);
    }
  };

  return (
    <section className="whiteboard" aria-labelledby="whiteboard-title">
      <h3 id="whiteboard-title">{t('onlineClass.whiteboard')}</h3>

      {canAnnotate && (
        <div className="whiteboard__toolbar" role="toolbar" aria-label={t('onlineClass.whiteboard')}>
          {TOOLS.map((entry) => (
            <button
              key={entry.tool}
              type="button"
              onClick={() => setTool(entry.tool)}
              aria-pressed={tool === entry.tool}
              aria-label={t(entry.labelKey)}
            >
              {t(entry.labelKey)}
            </button>
          ))}

          <label>
            {t('onlineClass.whiteboard.color')}
            <select value={color} onChange={(event) => setColor(event.target.value)}>
              {COLORS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <label>
            {t('onlineClass.whiteboard.width')}
            <input
              type="range"
              min={1}
              max={20}
              value={Math.round(strokeWidth * 1000)}
              onChange={(event) => setStrokeWidth(Number(event.target.value) / 1000)}
            />
          </label>

          <button type="button" onClick={() => void board.undo()} disabled={!board.canUndo}>
            {t('onlineClass.whiteboard.undo')}
          </button>
          <button type="button" onClick={() => void board.redo()} disabled={!board.canRedo}>
            {t('onlineClass.whiteboard.redo')}
          </button>
          <button type="button" onClick={() => void board.clearMine()}>
            {t('onlineClass.whiteboard.clearMine')}
          </button>

          {isHost && (
            <>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(t('onlineClass.whiteboard.clearAllConfirm'))) {
                    void board.clearAll();
                  }
                }}
              >
                {t('onlineClass.whiteboard.clearAll')}
              </button>
              <button type="button" onClick={() => void saveSnapshot()}>
                {t('onlineClass.whiteboard.saveSnapshot')}
              </button>
            </>
          )}
        </div>
      )}

      <div role="status" aria-live="polite">
        {saved && <span>{t('onlineClass.whiteboard.saved')}</span>}
      </div>

      <WhiteboardCanvas
        shapes={[...board.shapes, ...board.previewShapes]}
        tool={tool}
        color={color}
        strokeWidth={strokeWidth}
        sourceAspect={sourceAspect}
        readOnly={!canAnnotate}
        onCommit={(shape, operationId) => void board.addShape(shape, operationId)}
        onDraftChange={(operationId, shape) => board.previewShape(operationId, shape)}
        remoteLaserPointers={board.remotePointers}
        onLaserMove={(point) => {
          board.sendLaserPointer(point);
          onLaserMove?.(point);
        }}
        onRequestText={() => window.prompt(t('onlineClass.whiteboard.textPrompt'))}
      />
    </section>
  );
}
