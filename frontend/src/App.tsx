import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import Dashboard from '@/pages/Dashboard';
import EditorPage from '@/pages/EditorPage';
import { ThemeProvider } from '@/theme/ThemeContext';
import { LanguageProvider } from '@/i18n';
import { ToastContainer } from '@/components/ui/Toast';

function App() {
  return (
    <LanguageProvider>
      <ThemeProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/project" element={<Dashboard />} />
            <Route path="/project/:projectId" element={<EditorPage />} />
            <Route path="*" element={<Navigate to="/project" replace />} />
          </Routes>
        </BrowserRouter>
        <ToastContainer />
      </ThemeProvider>
    </LanguageProvider>
  );
}

export default App;
