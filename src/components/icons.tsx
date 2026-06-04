"use client";

import Image from "next/image";

// Brand marks. The platform logos use real PNG assets in /public; they accept a
// `size` prop so they can stand in for a LucideIcon where needed.

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
    <Image
      src="/google-ads-favicon.png"
      alt="Google Ads"
      width={size}
      height={size}
      className="object-contain"
      style={{ width: size, height: size }}
    />
  );
}

export function MetaMark({ size = 18 }: { size?: number }) {
  return (
    <Image
      src="/facebook-ads-icon.png"
      alt="Meta Ads"
      width={size}
      height={size}
      className="object-contain"
      style={{ width: size, height: size }}
    />
  );
}
