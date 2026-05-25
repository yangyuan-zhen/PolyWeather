import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        /* Legacy shadcn/ui HSL tokens */
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: "hsl(var(--card))",
        "card-foreground": "hsl(var(--card-foreground))",
        primary: "hsl(var(--primary))",
        "primary-foreground": "hsl(var(--primary-foreground))",
        secondary: "hsl(var(--secondary))",
        "secondary-foreground": "hsl(var(--secondary-foreground))",
        accent: "hsl(var(--accent))",
        "accent-foreground": "hsl(var(--accent-foreground))",
        border: "hsl(var(--border))",

        /* PolyWeather Design Tokens — direct CSS var refs */
        "pw-bg": {
          base: "var(--color-bg-base)",
          raised: "var(--color-bg-raised)",
          overlay: "var(--color-bg-overlay)",
          card: "var(--color-bg-card)",
          input: "var(--color-bg-input)",
        },
        "pw-text": {
          primary: "var(--color-text-primary)",
          secondary: "var(--color-text-secondary)",
          muted: "var(--color-text-muted)",
          disabled: "var(--color-text-disabled)",
        },
        "pw-accent": {
          primary: "var(--color-accent-primary)",
          secondary: "var(--color-accent-secondary)",
          tertiary: "var(--color-accent-tertiary)",
        },
        "pw-signal": {
          success: "var(--color-signal-success)",
          warning: "var(--color-signal-warning)",
          danger: "var(--color-signal-danger)",
          info: "var(--color-signal-info)",
        },
      },
      fontFamily: {
        data: ["var(--font-data)"],
        display: ["var(--font-display)"],
        mono: ["var(--font-mono)"],
      },
      spacing: {
        "pw-1": "var(--space-1)",
        "pw-2": "var(--space-2)",
        "pw-3": "var(--space-3)",
        "pw-4": "var(--space-4)",
        "pw-5": "var(--space-5)",
        "pw-6": "var(--space-6)",
        "pw-8": "var(--space-8)",
      },
      borderRadius: {
        "pw-sm": "var(--radius-sm)",
        "pw-md": "var(--radius-md)",
        "pw-lg": "var(--radius-lg)",
        "pw-xl": "var(--radius-xl)",
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(0, 224, 164, 0.15), 0 8px 32px rgba(8, 47, 73, 0.5)",
        "glow-accent": "var(--shadow-glow-accent)",
        "glow-secondary": "var(--shadow-glow-secondary)",
        "elevation-1": "var(--shadow-elevation-1)",
        "elevation-2": "var(--shadow-elevation-2)",
        "elevation-3": "var(--shadow-elevation-3)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(20px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        gradient: {
          "0%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
          "100%": { backgroundPosition: "0% 50%" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards",
        "fade-in": "fade-in 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards",
        gradient: "gradient 8s ease infinite",
      },
    },
  },
  plugins: [],
};

export default config;
