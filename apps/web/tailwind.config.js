/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#f8f6f1",
        "paper-deep": "#f0ece4",
        ink: "#171514",
        "ink-soft": "#38322d",
        muted: "#746a61",
        line: "#ddd5ca",
        accent: "#9e1b32",
        "accent-soft": "#f6e7e9",
        "accent-ink": "#6f1020",
        danger: "#a3242c",
        "danger-soft": "#f8e8e8",
        ok: "#2f5d46",
        "ok-soft": "#e8f0ea",
        gold: "#8b6b2e",
        "gold-soft": "#f3eddf",
      },
      fontFamily: {
        sans: [
          "Segoe UI",
          "Helvetica Neue",
          "Arial",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
        serif: [
          "Georgia",
          "Iowan Old Style",
          "Palatino Linotype",
          "Palatino",
          "Times New Roman",
          "serif",
        ],
        mono: ["Consolas", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        card: "0 1px 0 rgba(23, 21, 20, 0.04), 0 10px 24px -26px rgba(23, 21, 20, 0.35)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "bar-1": {
          "0%, 100%": { transform: "scaleY(0.35)" },
          "50%": { transform: "scaleY(1)" },
        },
        "bar-2": {
          "0%, 100%": { transform: "scaleY(0.8)" },
          "50%": { transform: "scaleY(0.3)" },
        },
        "bar-3": {
          "0%, 100%": { transform: "scaleY(0.55)" },
          "50%": { transform: "scaleY(0.95)" },
        },
      },
      animation: {
        "fade-up": "fade-up 400ms ease-out both",
        "bar-1": "bar-1 900ms ease-in-out infinite",
        "bar-2": "bar-2 1.1s ease-in-out infinite",
        "bar-3": "bar-3 800ms ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
