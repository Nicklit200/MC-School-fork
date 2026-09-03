import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { homePathForRole } from './auth/roleRoutes';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { ActivatePage } from './pages/ActivatePage';
import { TeachersPage } from './pages/admin/TeachersPage';
import { StudentsPage } from './pages/teacher/StudentsPage';
import { StudentDetailPage } from './pages/teacher/StudentDetailPage';
import { StudentHomeworksPage } from './pages/teacher/StudentHomeworksPage';
import { StudentDrivePage } from './pages/teacher/StudentDrivePage';
import { HomeworkDetailPage } from './pages/teacher/HomeworkDetailPage';
import { TeacherCardsDetailPage } from './pages/teacher/TeacherCardsDetailPage';
import { GroupsPage } from './pages/teacher/GroupsPage';
import { GroupDetailPage } from './pages/teacher/GroupDetailPage';
import { TodayPage } from './pages/student/TodayPage';
import { SessionPage } from './pages/student/SessionPage';
import { ResultPage } from './pages/student/ResultPage';
import { MyCardsPage } from './pages/student/MyCardsPage';
import { StudentCardsDetailPage } from './pages/student/StudentCardsDetailPage';
import { StudentHomeworksListPage } from './pages/student/StudentHomeworksListPage';
import { StudentHomeworkDetailPage } from './pages/student/StudentHomeworkDetailPage';
import { PdfHomeworkWithSubmissionPage } from './pages/student/PdfHomeworkWithSubmissionPage';
import { SettingsPage } from './pages/student/SettingsPage';
import { ParentPage } from './pages/parent/ParentPage';

export function App() {
  const { user, initializing } = useAuth();
  if (initializing) return null;

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/activate" element={<ActivatePage />} />

      <Route path="/teachers" element={<ProtectedRoute role="ADMIN"><Layout><TeachersPage /></Layout></ProtectedRoute>} />
      <Route path="/students" element={<ProtectedRoute role="TEACHER"><Layout><StudentsPage /></Layout></ProtectedRoute>} />
      <Route path="/students/:studentId" element={<ProtectedRoute role="TEACHER"><Layout><StudentDetailPage /></Layout></ProtectedRoute>} />
      <Route path="/students/:studentId/homeworks" element={<ProtectedRoute role="TEACHER"><Layout><StudentHomeworksPage /></Layout></ProtectedRoute>} />
      <Route path="/students/:studentId/drive" element={<ProtectedRoute role="TEACHER"><Layout><StudentDrivePage /></Layout></ProtectedRoute>} />
      <Route path="/teacher/students/:studentId/cards/:homeworkId" element={<ProtectedRoute role="TEACHER"><Layout><TeacherCardsDetailPage /></Layout></ProtectedRoute>} />
      <Route path="/teacher/students/:studentId/homeworks/:homeworkId" element={<ProtectedRoute role="TEACHER"><Layout><HomeworkDetailPage /></Layout></ProtectedRoute>} />
      <Route path="/groups" element={<ProtectedRoute role="TEACHER"><Layout><GroupsPage /></Layout></ProtectedRoute>} />
      <Route path="/groups/:groupId" element={<ProtectedRoute role="TEACHER"><Layout><GroupDetailPage /></Layout></ProtectedRoute>} />

      <Route path="/today" element={<ProtectedRoute role="STUDENT"><Layout><TodayPage /></Layout></ProtectedRoute>} />
      <Route path="/session/:sessionId" element={<ProtectedRoute role="STUDENT"><Layout><SessionPage /></Layout></ProtectedRoute>} />
      <Route path="/session/:sessionId/result" element={<ProtectedRoute role="STUDENT"><Layout><ResultPage /></Layout></ProtectedRoute>} />
      <Route path="/my-cards" element={<ProtectedRoute role="STUDENT"><Layout><MyCardsPage /></Layout></ProtectedRoute>} />
      <Route path="/my-cards/:homeworkId" element={<ProtectedRoute role="STUDENT"><Layout><StudentCardsDetailPage /></Layout></ProtectedRoute>} />
      <Route path="/homeworks" element={<Navigate to="/student/homeworks" replace />} />
      <Route path="/student/homeworks" element={<ProtectedRoute role="STUDENT"><Layout><StudentHomeworksListPage /></Layout></ProtectedRoute>} />
      <Route path="/student/homeworks/:homeworkId" element={<ProtectedRoute role="STUDENT"><Layout><StudentHomeworkDetailPage /></Layout></ProtectedRoute>} />
      <Route path="/student/homeworks/:homeworkId/worksheet" element={<ProtectedRoute role="STUDENT"><Layout><PdfHomeworkWithSubmissionPage /></Layout></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute role="STUDENT"><Layout><SettingsPage /></Layout></ProtectedRoute>} />

      <Route path="/parent" element={<ProtectedRoute role="PARENT"><Layout><ParentPage /></Layout></ProtectedRoute>} />
      <Route path="/parent/settings" element={<ProtectedRoute role="PARENT"><Layout><SettingsPage /></Layout></ProtectedRoute>} />

      <Route path="*" element={<Navigate to={user ? homePathForRole(user.role) : '/login'} replace />} />
    </Routes>
  );
}
