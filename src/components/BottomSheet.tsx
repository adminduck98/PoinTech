import { useEffect, useRef, type ReactNode } from 'react';
import { Portal } from './Portal';

interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

export const BottomSheet = ({ isOpen, onClose, title, children }: BottomSheetProps) => {
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <Portal>
      <div className="fixed inset-0 z-[9999]" style={{ pointerEvents: 'auto' }}>
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-[color:var(--overlay)] backdrop-blur-md animate-fade-in"
          onClick={onClose}
        />

        {/* Sheet */}
        <div
          ref={sheetRef}
          className="absolute bottom-0 left-0 right-0 bg-surface-elevated rounded-t-[1.75rem] border-t border-border-subtle shadow-float animate-slide-in-up max-h-[70dvh] flex flex-col"
        >
          {/* Handle */}
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 rounded-full bg-border-strong" />
          </div>

          {/* Header */}
          {title && (
            <div className="px-4 pb-3 border-b border-border-subtle">
              <h3 className="text-base font-bold text-text">
                {title}
              </h3>
            </div>
          )}

          {/* Content */}
          <div className="overflow-y-auto overscroll-contain px-2 py-2 flex-1">
            {children}
          </div>
        </div>
      </div>
    </Portal>
  );
};
