import React, { useEffect, useRef, useState } from 'react';

interface LottieBadgeProps {
  animationData: Record<string, unknown>;
  size?: number;
  loop?: boolean;
  className?: string;
  fallback?: React.ReactNode;
}

/**
 * Lightweight, lazy-loaded SVG Lottie player.
 * Dynamically imports lottie_light so it never bloats the initial app bundle,
 * and respects prefers-reduced-motion automatically.
 */
export const LottieBadge: React.FC<LottieBadgeProps> = ({
  animationData,
  size = 56,
  loop = false,
  className = '',
  fallback = null,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let destroyed = false;
    let anim: { destroy: () => void; goToAndStop: (v: number, isFrame?: boolean) => void; totalFrames: number } | null = null;

    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    void import('lottie-web/build/player/lottie_light').then((mod) => {
      if (destroyed || !containerRef.current) return;
      const lottie = mod.default;
      anim = lottie.loadAnimation({
        container: containerRef.current,
        renderer: 'svg',
        loop: prefersReduced ? false : loop,
        autoplay: !prefersReduced,
        animationData,
      });
      if (prefersReduced && anim) {
        anim.goToAndStop(Math.max(0, (anim.totalFrames || 60) - 1), true);
      }
      setLoaded(true);
    });

    return () => {
      destroyed = true;
      anim?.destroy();
    };
  }, [animationData, loop]);

  return (
    <div
      aria-hidden="true"
      className={`relative inline-flex items-center justify-center shrink-0 ${className}`}
      style={{ width: size, height: size }}
    >
      {!loaded && fallback ? (
        <div className="absolute inset-0 flex items-center justify-center">{fallback}</div>
      ) : null}
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
};
