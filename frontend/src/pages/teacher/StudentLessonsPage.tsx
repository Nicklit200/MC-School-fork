import { Navigate, useParams } from 'react-router-dom';

/** Keep saved lesson-history links working after merging both sections. */
export function StudentLessonsPage() {
  const { studentId = '' } = useParams();
  return <Navigate to={`/students/${encodeURIComponent(studentId)}/homeworks`} replace />;
}
