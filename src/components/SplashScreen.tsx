import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

export const SplashScreen: React.FC = () => {
  const { t } = useTranslation();
  const [exiting, setExiting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const exitTimer = window.setTimeout(() => setExiting(true), 2150);
    const doneTimer = window.setTimeout(() => setDone(true), 2550);
    return () => {
      window.clearTimeout(exitTimer);
      window.clearTimeout(doneTimer);
    };
  }, []);

  if (done) return null;

  return (
    <div
      aria-hidden="true"
      className={`fixed inset-0 z-[90] flex flex-col items-center justify-center overflow-hidden select-none bg-[#F8FAFC] text-[#0F172A] dark:bg-[#0F172A] dark:text-[#F8FAFC] transition-opacity duration-400 ease-out ${
        exiting ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
    >
      <div className="relative flex h-full w-full max-w-[390px] sm:max-w-lg flex-col items-center justify-center px-6">
        {/* Stage slightly above center */}
        <div className="relative flex h-[320px] w-full items-center justify-center -mt-10">
          {/* Continuous emerald ribbon stroke with subtle hand-made wobble */}
          <svg
            viewBox="0 0 360 300"
            fill="none"
            className="pointer-events-none absolute inset-0 h-full w-full"
          >
            <path
              d="M 46 66 C 85 52, 118 82, 152 68 C 202 48, 268 42, 304 72 C 334 96, 326 154, 290 176 C 244 204, 198 152, 180 144 C 154 132, 92 126, 62 152 C 34 176, 64 234, 108 230 C 148 226, 174 178, 180 146"
              stroke="#0FA678"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="980"
              strokeDashoffset="980"
              className="anim-ribbon-draw"
            />
          </svg>

          {/* 5 Scattered Flat Icons (2px rounded strokes) that straighten & tuck into center */}
          {/* 1. Coin (top-left) */}
          <div className="absolute left-[9%] top-[16%] text-[#0F172A]/75 dark:text-[#F8FAFC]/75 anim-settle-coin">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v10M9.5 10.5c0-1 1-1.5 2.5-1.5s2.5.5 2.5 1.5-1 1.5-2.5 1.5-2.5.5-2.5 1.5 1 1.5 2.5 1.5 2.5-.5 2.5-1.5" />
            </svg>
          </div>

          {/* 2. Bell (top-right) */}
          <div className="absolute right-[11%] top-[18%] text-[#0F172A]/75 dark:text-[#F8FAFC]/75 anim-settle-bell">
            <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            </svg>
          </div>

          {/* 3. Key-folder / Vault (mid-right) */}
          <div className="absolute right-[10%] top-[53%] text-[#0F172A]/75 dark:text-[#F8FAFC]/75 anim-settle-vault">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
              <circle cx="11" cy="13" r="1.5" />
              <path d="M12.5 13H16v1.5" />
            </svg>
          </div>

          {/* 4. Checkbox (mid-left) */}
          <div className="absolute left-[11%] top-[46%] text-[#0F172A]/75 dark:text-[#F8FAFC]/75 anim-settle-check">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="4" />
              <path d="m9 12 2 2 4-4" />
            </svg>
          </div>

          {/* 5. Note (lower-left) */}
          <div className="absolute left-[22%] bottom-[16%] text-[#0F172A]/75 dark:text-[#F8FAFC]/75 anim-settle-note">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
              <path d="M14 2v4a2 2 0 0 0 2 2h4" />
              <path d="M8 13h8M8 17h5" />
            </svg>
          </div>

          {/* Final Untouched Logo */}
          <div className="relative z-10 flex h-24 w-24 items-center justify-center anim-logo-settle">
            <img
              src="/logo.png"
              alt="LifeinOne"
              className="h-24 w-24 rounded-2xl object-contain drop-shadow-[0_10px_24px_rgba(15,23,42,0.08)]"
            />
          </div>
        </div>

        {/* App Name & Tagline ONLY */}
        <div className="mt-2 flex flex-col items-center text-center">
          <h1 className="font-display text-[30px] font-medium tracking-[-0.03em] text-[#0F172A] dark:text-[#F8FAFC] anim-settled-title">
            {t('appName')}
          </h1>
          <p className="mt-1.5 text-sm font-normal text-[#0F172A]/60 dark:text-[#F8FAFC]/65 anim-settled-tagline">
            All caught up.
          </p>
        </div>
      </div>
    </div>
  );
};
