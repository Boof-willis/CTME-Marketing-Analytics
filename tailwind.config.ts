import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // Near-black canvas matching the CTME (Crypto Tax Made Easy) brand.
        canvas: {
          DEFAULT: "#0A0A0F",
          900: "#0A0A0F",
          800: "#0e0e15",
          700: "#16161F",
        },
        panel: {
          DEFAULT: "#101017",
          light: "#16161F",
          border: "#26262e",
        },
        ink: {
          DEFAULT: "#f4f4f5",
          muted: "#a1a1aa",
          faint: "#71717a",
        },
        brand: {
          // CTME brand gold is the primary accent.
          gold: "#beb086",
          goldDark: "#a89b74",
          blue: "#3b82f6",
          meta: "#1d8cff",
          google: "#34a853",
          purple: "#8b5cf6",
          amber: "#f59e0b",
          cyan: "#22d3ee",
        },
        good: "#22c55e",
        bad: "#ef4444",
        // shadcn-style tokens used by the FunnelChart component (mapped to the
        // dashboard's dark theme via CSS variables in globals.css).
        foreground: "var(--foreground)",
        background: "var(--background)",
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 0 0 rgba(255,255,255,0.03) inset, 0 8px 24px -12px rgba(0,0,0,0.7)",
        glow: "0 0 0 1px rgba(190,176,134,0.35), 0 8px 30px -8px rgba(190,176,134,0.45)",
      },
      borderRadius: {
        xl: "0.9rem",
        "2xl": "1.15rem",
      },
    },
  },
  plugins: [],
};

export default config;
