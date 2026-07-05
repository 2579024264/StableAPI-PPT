import React from 'react';
import { cn } from '@/utils';

interface BrandLogoProps {
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
  className?: string;
  textClassName?: string;
}

const sizeClasses = {
  sm: 'h-8 w-8',
  md: 'h-10 w-10',
  lg: 'h-14 w-14',
};

const textSizeClasses = {
  sm: 'text-base',
  md: 'text-xl',
  lg: 'text-2xl',
};

export const BrandMark: React.FC<{ className?: string }> = ({ className }) => (
  <span
    className={cn(
      'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-gradient-to-br from-[#AD73F6] to-[#7B83FF] shadow-[0_10px_24px_-14px_rgba(123,131,255,0.75)]',
      className,
    )}
    aria-hidden="true"
  >
    <span className="absolute inset-0 bg-[radial-gradient(circle_at_25%_20%,rgba(255,255,255,0.55),transparent_32%),radial-gradient(circle_at_80%_85%,rgba(96,165,250,0.28),transparent_42%)]" />
    <svg viewBox="0 0 48 48" className="relative h-[68%] w-[68%]" fill="none">
      <path
        d="M12 32.5V15.5C12 13.6 13.6 12 15.5 12H33.5"
        stroke="white"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M18 36H32.5C34.4 36 36 34.4 36 32.5V20"
        stroke="white"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M19 25H30"
        stroke="white"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <circle cx="35" cy="13" r="3.5" fill="#F4F5FF" />
    </svg>
  </span>
);

export const BrandLogo: React.FC<BrandLogoProps> = ({
  size = 'md',
  showText = true,
  className,
  textClassName,
}) => (
  <div className={cn('inline-flex items-center gap-2.5', className)}>
    <BrandMark className={sizeClasses[size]} />
    {showText && (
      <span
        className={cn(
          'font-bold tracking-tight text-[#24264F] dark:text-foreground-primary',
          textSizeClasses[size],
          textClassName,
        )}
      >
        StableAPI幻灯片
      </span>
    )}
  </div>
);
