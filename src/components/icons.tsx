"use client";

// Minimal brand-ish glyphs (lucide has no Google Ads mark). These accept a
// `size` prop so they can stand in for LucideIcon where needed.

export function SiGoogleads({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="none">
      <path
        d="M3 17.5 9.5 6a2 2 0 0 1 3.46 2L6.46 19.5A2 2 0 0 1 3 17.5Z"
        fill="currentColor"
        opacity="0.55"
      />
      <path
        d="M21 17.5 14.5 6a2 2 0 0 0-3.46 2l6.5 11.5A2 2 0 0 0 21 17.5Z"
        fill="currentColor"
      />
      <circle cx="6" cy="18.5" r="2.4" fill="currentColor" />
    </svg>
  );
}

export function GoogleMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <circle cx="6" cy="18" r="3" fill="#fbbc04" />
      <path d="M3 16 9 5.5a3 3 0 0 1 5.2 3L8.2 19a3 3 0 0 1-5.2-3Z" fill="#fbbc04" />
      <path d="M21 16 15 5.5a3 3 0 0 0-5.2 3L15.8 19a3 3 0 0 0 5.2-3Z" fill="#34a853" />
    </svg>
  );
}

export function MetaMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M3 14c0-3.5 1.7-6.5 4-6.5 1.6 0 2.7 1.4 3.8 3.4l1.2 2.2M21 14c0-3.5-1.7-6.5-4-6.5-1.6 0-2.7 1.4-3.8 3.4l-1.2 2.2"
        stroke="#1d8cff"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
