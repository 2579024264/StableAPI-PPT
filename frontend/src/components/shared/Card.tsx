import React from 'react';
import { cn } from '@/utils';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  hoverable?: boolean;
}

export const Card: React.FC<CardProps> = ({
  children,
  hoverable = false,
  className,
  ...props
}) => {
  return (
    <div
      className={cn(
        'bg-white/95 dark:bg-background-secondary rounded-card shadow-md border border-border-primary',
        hoverable && 'hover:shadow-lg hover:border-banana-500 transition-all duration-200 cursor-pointer',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
};
