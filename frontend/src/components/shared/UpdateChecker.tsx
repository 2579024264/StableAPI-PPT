import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useT } from '@/hooks/useT';
import { DESKTOP_TITLEBAR_HEIGHT, DESKTOP_UPDATE_BANNER_HEIGHT, isDesktop } from '@/utils';

interface UpdateInfo {
  version: string;
  notes: string;
  url: string;
}

const updateI18n = {
  zh: { newVersion: '新版本', available: '可用', download: '前往下载' },
  en: { newVersion: 'New version', available: 'available', download: 'Download' },
};

interface UpdateCheckerProps {
  onVisibilityChange?: (visible: boolean) => void;
}

export function UpdateChecker({ onVisibilityChange }: UpdateCheckerProps) {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const onVisibilityChangeRef = useRef(onVisibilityChange);
  const t = useT(updateI18n);
  const isVisible = isDesktop && !!update && !dismissed;

  useEffect(() => {
    onVisibilityChangeRef.current = onVisibilityChange;
  });

  useEffect(() => {
    if (!isDesktop) return;

    const timer = setTimeout(async () => {
      try {
        const result = await (window as any).electronAPI.checkForUpdates();
        if (result) setUpdate(result);
      } catch {
        // silently ignore update check failures
      }
    }, 5000);

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    onVisibilityChangeRef.current?.(isVisible);
  }, [isVisible]);

  if (!isVisible || !update || dismissed) return null;

  return (
    <div
      className="fixed left-0 right-0 z-40 flex items-center justify-center px-4 py-1.5"
      style={{
        top: DESKTOP_TITLEBAR_HEIGHT,
        background: 'linear-gradient(135deg, #F0EDFF, #ECEFFF)',
        borderBottom: '1px solid rgba(123, 131, 255, 0.22)',
        minHeight: DESKTOP_UPDATE_BANNER_HEIGHT,
      }}
    >
      <div className="flex items-center gap-3 text-sm text-[#343667]">
        <span className="font-medium">
          {t('newVersion')} v{update.version} {t('available')}
        </span>
        <button
          onClick={() => (window as any).electronAPI.openExternal(update.url)}
          className="px-3 py-1 rounded-lg text-xs font-medium bg-gradient-to-r from-[#AD73F6] to-[#7B83FF] text-white hover:brightness-105 transition-colors"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {t('download')}
        </button>
        <button
          onClick={() => setDismissed(true)}
          className="p-1 rounded-full hover:bg-banana-100 transition-colors"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <X size={14} className="text-banana-700" />
        </button>
      </div>
    </div>
  );
}

export function getDesktopTopInset(showingUpdateBanner: boolean): number {
  return DESKTOP_TITLEBAR_HEIGHT + (showingUpdateBanner ? DESKTOP_UPDATE_BANNER_HEIGHT : 0);
}
