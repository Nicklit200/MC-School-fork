import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { NotebookCameraPanel } from './NotebookCameraPanel';

export function NotebookCameraPage() {
  const { eventId = '' } = useParams();
  const { user } = useAuth();
  if (!user) return null;
  return <div style={{ maxWidth: 1500, margin: '0 auto', padding: 16 }}>
    <Link to={user.role === 'TEACHER' ? `/teacher/lessons/${encodeURIComponent(eventId)}` : '/student/lessons'}>← Назад к уроку</Link>
    <NotebookCameraPanel eventId={eventId} currentUserId={user.id} isTeacher={user.role === 'TEACHER'} />
  </div>;
}
