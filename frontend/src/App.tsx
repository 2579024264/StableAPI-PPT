import { useEffect, useRef, useState } from 'react';
import { BrowserRouter, HashRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Home } from './pages/Home';
import { Landing } from './pages/Landing';
import { History } from './pages/History';
import { OutlineEditor } from './pages/OutlineEditor';
import { DetailEditor } from './pages/DetailEditor';
import { SlidePreview } from './pages/SlidePreview';
import { SettingsPage } from './pages/Settings';
import { useProjectStore } from './store/useProjectStore';
import { useToast, AccessCodeGuard, DesktopTitleBar, UpdateChecker } from './components/shared';
import { getDesktopTopInset } from './components/shared/UpdateChecker';
import { isDesktop } from '@/utils';
import * as api from '@/api/endpoints';

const URL_API_KEY_LOCAL_STORAGE_KEY = 'stableapi-slides-api-key';
const DEFAULT_API_BASE_URL = 'https://stableapi.io/v1';
const DEFAULT_TEXT_MODEL = 'gemini-3.1-pro-preview';
const DEFAULT_IMAGE_MODEL = 'gemini-3-pro-image-preview';
const DEFAULT_IMAGE_CAPTION_MODEL = 'gemini-3.1-pro-preview';

const normalizeRouterBasename = (basePath?: string): string | undefined => {
  const raw = (basePath || '').trim();
  if (!raw || raw === '.' || raw === './' || raw === '/') return undefined;
  const withLeadingSlash = raw.startsWith('/') ? raw : `/${raw}`;
  return withLeadingSlash.replace(/\/+$/, '');
};

const UrlApiKeyBootstrap: React.FC<{ show: ReturnType<typeof useToast>['show'] }> = ({ show }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const processedRef = useRef(false);

  useEffect(() => {
    const inboundApiKey = new URLSearchParams(location.search).get('sk')?.trim() || '';
    if (!inboundApiKey || processedRef.current || location.pathname === '/settings') return;
    processedRef.current = true;

    const params = new URLSearchParams(location.search);
    params.delete('sk');
    const search = params.toString();
    navigate(
      { pathname: location.pathname, search: search ? `?${search}` : '', hash: location.hash },
      { replace: true }
    );

    localStorage.setItem(URL_API_KEY_LOCAL_STORAGE_KEY, inboundApiKey);
    api.updateSettings({
      ai_provider_format: 'openai',
      api_key: inboundApiKey,
      api_base_url: DEFAULT_API_BASE_URL,
      text_model: DEFAULT_TEXT_MODEL,
      image_model: DEFAULT_IMAGE_MODEL,
      image_caption_model: DEFAULT_IMAGE_CAPTION_MODEL,
    }).then((response) => {
      if (response.data) {
        sessionStorage.setItem('banana-settings', JSON.stringify(response.data));
        show({ message: '已从链接保存 API Key，并应用默认模型', type: 'success' });
      }
    }).catch((error: any) => {
      show({
        message: `链接中的 API Key 保存失败: ${error?.response?.data?.error?.message || error?.message || '未知错误'}`,
        type: 'error',
      });
    });
  }, [location, navigate, show]);

  return null;
};

function App() {
  const { currentProject, syncProject, error, setError } = useProjectStore();
  const { show, ToastContainer } = useToast();
  const [isUpdateVisible, setIsUpdateVisible] = useState(false);

  // 恢复项目状态
  useEffect(() => {
    const savedProjectId = localStorage.getItem('currentProjectId');
    if (savedProjectId && !currentProject) {
      syncProject();
    }
  }, [currentProject, syncProject]);

  // 显示全局错误
  useEffect(() => {
    if (error) {
      show({ message: error, type: 'error' });
      setError(null);
    }
  }, [error, setError, show]);


  return (
    <>
      <UpdateChecker onVisibilityChange={setIsUpdateVisible} />
      <div style={isDesktop ? { paddingTop: `${getDesktopTopInset(isUpdateVisible)}px` } : undefined}>
        <AccessCodeGuard>
          {(() => {
            const Router = isDesktop ? HashRouter : BrowserRouter;
            const basename = isDesktop ? undefined : normalizeRouterBasename(import.meta.env.VITE_PUBLIC_BASE_PATH);
            return (
              <Router basename={basename}>
                <UrlApiKeyBootstrap show={show} />
                <DesktopTitleBar />
                <Routes>
                  <Route path="/" element={<Home />} />
                  <Route path="/landing" element={<Landing />} />
                  <Route path="/history" element={<History />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="/project/:projectId/outline" element={<OutlineEditor />} />
                  <Route path="/project/:projectId/detail" element={<DetailEditor />} />
                  <Route path="/project/:projectId/preview" element={<SlidePreview />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
                <ToastContainer />
              </Router>
            );
          })()}
        </AccessCodeGuard>
      </div>
    </>
  );
}

export default App;
