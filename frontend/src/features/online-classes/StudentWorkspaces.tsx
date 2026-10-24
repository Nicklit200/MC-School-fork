import { useState, type ReactNode } from 'react';
import type { NotebookCamera } from '../../api/notebookCameras';
import { NotebookCameraViewer, type NotebookCameraVideoSource } from '../notebook-camera/NotebookCameraViewer';
import { personalBoardId } from './boards';
import type { RosterStudent } from './useStudentRoster';

interface StudentSurfaceProps {
  student: RosterStudent;
  camera?: NotebookCamera;
  visible: boolean;
  compact: boolean;
  onOpen: () => void;
  onOverview: () => void;
  showOverview: boolean;
  renderBoard: (studentId: string, active: boolean, compact: boolean) => ReactNode;
  renderCameraBoard: (studentId: string, active: boolean, compact: boolean, source: NotebookCameraVideoSource | null) => ReactNode;
}

function StudentSurface({ student, camera, visible, compact, onOpen, onOverview, showOverview, renderBoard, renderCameraBoard }: StudentSurfaceProps) {
  const [media, setMedia] = useState<{ cameraId: string; available: boolean } | null>(null);
  const [video, setVideo] = useState<{ cameraId: string; source: NotebookCameraVideoSource } | null>(null);
  const [boardVisited, setBoardVisited] = useState(false);
  const [cameraBoardVisited, setCameraBoardVisited] = useState(false);
  const source = camera && video?.cameraId === camera.cameraId ? video.source : null;
  const hasVideo = Boolean(source && camera && media?.cameraId === camera.cameraId && media.available);
  // A hidden viewer continues listening for the phone to start again. Switching
  // between the overview and one pupil only changes this same surface's layout.
  const boardNeeded = visible && !hasVideo;
  if (boardNeeded && !boardVisited) setBoardVisited(true);
  if (visible && hasVideo && !cameraBoardVisited) setCameraBoardVisited(true);

  return <section className="student-workspace" hidden={!visible} aria-label={`Работа ученика: ${student.displayName}`}>
    <div className="online-class-room__student-tile-header">
      <strong>{student.displayName}</strong>
      <span className="student-workspace__kind">{hasVideo ? 'Камера тетради' : 'Доска'}</span>
      {compact ? <button type="button" onClick={onOpen}>Открыть</button>
        : showOverview && <button type="button" onClick={onOverview}>Все ученики</button>}
    </div>
    <div className="student-workspace__content">
      {boardVisited && <div className="student-workspace__board" hidden={hasVideo}>
        {renderBoard(student.userId, boardNeeded, compact)}
      </div>}
      {cameraBoardVisited && <div className="student-workspace__camera-board" hidden={!hasVideo}>
        {renderCameraBoard(student.userId, visible && hasVideo, compact, hasVideo ? source : null)}
      </div>}
      {camera && <div className={`student-workspace__camera${hasVideo ? '' : ' student-workspace__camera--waiting'}`}>
        <NotebookCameraViewer
          key={camera.cameraId}
          cameraId={camera.cameraId}
          ownerId={camera.ownerId}
          // The board projects video and ink together. This viewer only paints
          // a frame when geometry changes, avoiding a second live render loop.
          active={false}
          presentation="board"
          compact={compact}
          title={`Тетрадь ученика: ${student.displayName}`}
          onVideoAvailableChange={available => setMedia(previous =>
            previous?.cameraId === camera.cameraId && previous.available === available
              ? previous : { cameraId: camera.cameraId, available })}
          onBoardVideoChange={next => setVideo(previous => {
            if (!next) return previous?.cameraId === camera.cameraId ? null : previous;
            return previous?.cameraId === camera.cameraId && previous.source.video === next.video
              && previous.source.width === next.width && previous.source.height === next.height
              && previous.source.view === next.view && previous.source.rawVideo === next.rawVideo
              ? previous : { cameraId: camera.cameraId, source: next };
          })}
        />
      </div>}
    </div>
  </section>;
}

export function StudentWorkspaces({ students, camerasByOwner, activeBoard, overview, visible, onSelect, onOverview, renderBoard, renderCameraBoard }: {
  students: RosterStudent[];
  camerasByOwner: Map<string, NotebookCamera>;
  activeBoard: string;
  overview: boolean;
  visible: boolean;
  onSelect: (boardId: string) => void;
  onOverview: () => void;
  renderBoard: StudentSurfaceProps['renderBoard'];
  renderCameraBoard: StudentSurfaceProps['renderCameraBoard'];
}) {
  const [visited, setVisited] = useState<Set<string>>(() => new Set());
  const shown = new Set(visible ? overview ? students.slice(0, 4).map(student => student.userId)
    : students.filter(student => personalBoardId(student.userId) === activeBoard).map(student => student.userId) : []);
  const newVisits = [...shown].filter(id => !visited.has(id));
  if (newVisits.length) setVisited(previous => new Set([...previous, ...newVisits]));

  return <div className={`student-workspaces${overview ? ' student-workspaces--overview' : ''}`}
    hidden={!visible} aria-label={overview ? 'Доски и тетради всех учеников' : 'Работа выбранного ученика'}>
    {students.filter(student => visited.has(student.userId) || shown.has(student.userId) || camerasByOwner.has(student.userId)).map(student =>
      <StudentSurface key={student.userId}
        student={student} camera={camerasByOwner.get(student.userId)}
        visible={shown.has(student.userId)} compact={overview}
        onOpen={() => onSelect(personalBoardId(student.userId))}
        onOverview={onOverview} showOverview={students.length > 1}
        renderBoard={renderBoard} renderCameraBoard={renderCameraBoard}
      />)}
    {overview && students.length === 0 && <p className="online-class-room__student-grid-empty">Пока нет учеников</p>}
  </div>;
}
