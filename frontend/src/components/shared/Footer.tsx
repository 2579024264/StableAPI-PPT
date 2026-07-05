import React from 'react';
import { BookOpen, Scale } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const DOCS_URL = 'https://docs.bananaslides.online';
const LICENSE_URL = 'https://www.gnu.org/licenses/agpl-3.0.html';

export const Footer: React.FC = () => {
  const currentYear = new Date().getFullYear();
  const { i18n } = useTranslation();
  const docsLabel = i18n.language?.startsWith('zh') ? '文档' : 'Docs';
  const licenseLabel = i18n.language?.startsWith('zh') ? '开源协议' : 'License';

  return (
    <footer className="relative w-full py-6 px-4 mt-auto">
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-6 text-sm text-gray-500 dark:text-foreground-tertiary">
          {/* Copyright */}
          <div className="flex items-center gap-1.5">
            <span>© {currentYear}</span>
            <span className="font-medium bg-gradient-to-r from-[#AD73F6] to-[#7B83FF] bg-clip-text text-transparent">
              StableAPI幻灯片
            </span>
          </div>

          {/* Divider - 仅在大屏显示 */}
          <span className="hidden sm:inline text-gray-300 dark:text-border-primary">·</span>

          <a
            href={LICENSE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5"
          >
            <Scale size={16} />
            <span>{licenseLabel}: AGPL-3.0</span>
          </a>

          <span className="hidden sm:inline text-gray-300 dark:text-border-primary">·</span>

          <a
            href={DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5"
          >
            <BookOpen size={16} />
            <span>{docsLabel}</span>
          </a>
        </div>
      </div>
    </footer>
  );
};
