import { BrandMark } from './Logo';
import { useEffect, useState } from 'react';

interface SplashScreenProps {
  onComplete: () => void;
}

export const SplashScreen = ({ onComplete }: SplashScreenProps) => {
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<'logo' | 'loading' | 'exit'>('logo');

  useEffect(() => {
    const t1 = setTimeout(() => setPhase('loading'), 600);
    return () => clearTimeout(t1);
  }, []);

  useEffect(() => {
    if (phase !== 'loading') return;
    const interval = setInterval(() => {
      setProgress((p) => {
        if (p >= 100) {
          clearInterval(interval);
          setPhase('exit');
          setTimeout(onComplete, 400);
          return 100;
        }
        return p + Math.random() * 18 + 7;
      });
    }, 80);
    return () => clearInterval(interval);
  }, [phase, onComplete]);

  return (
    <div
      className={`fixed inset-0 z-[9999] bg-bg flex flex-col items-center justify-center transition-opacity duration-400 ${
        phase === 'exit' ? 'opacity-0' : 'opacity-100'
      }`}
    >
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-[60%] w-[340px] h-[340px] rounded-full bg-accent/25 blur-[100px]" />
      <div className="absolute bottom-[-80px] left-[-60px] w-[260px] h-[260px] rounded-full bg-accent-2/15 blur-[90px]" />

      <div className="relative z-10 flex flex-col items-center">
        <div
          className={`transition-all duration-700 ease-out ${
            phase === 'logo'
              ? 'opacity-0 scale-75 translate-y-4'
              : 'opacity-100 scale-100 translate-y-0'
          }`}
        >
          <div className="w-[88px] h-[88px] rounded-[1.75rem] gradient-brand flex items-center justify-center shadow-accent ring-1 ring-white/20 mb-6 mx-auto">
            <BrandMark size={46} className="text-white" />
          </div>

          <h1 className="font-display text-[28px] font-semibold text-text tracking-[0.03em] text-center">
            POINT <span className="text-gradient-brand">TECH</span>
          </h1>
          <p className="eyebrow mt-2 text-center">
            technology
          </p>
        </div>

        <div
          className={`mt-10 w-48 transition-all duration-500 ${
            phase === 'logo' ? 'opacity-0' : 'opacity-100'
          }`}
        >
          <div className="h-[3px] bg-surface-inset rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-200 ease-out bg-gradient-to-r from-accent to-accent-2 shadow-[0_0_12px_rgb(var(--accent))]"
              style={{
                width: `${Math.min(progress, 100)}%`,
              }}
            />
          </div>
        </div>
      </div>

      <p
        className={`absolute bottom-10 text-[11px] text-text-tertiary transition-opacity duration-500 ${
          phase === 'logo' ? 'opacity-0' : 'opacity-100'
        }`}
      >
        POINT TECH v1.0
      </p>
    </div>
  );
};
