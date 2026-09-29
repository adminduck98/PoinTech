/**
 * Build a colour value that Tailwind can apply an opacity modifier to.
 *
 * `rgb(var(--x) / <alpha-value>)` lets `bg-accent`, `bg-accent/20` and
 * `border-border/30` all resolve; the placeholder is replaced with `1` when no
 * modifier is present.
 */
const withAlpha = (variable) => `rgb(var(${variable}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Colours are declared in index.css as space-separated RGB channels
        // ("26 26 26") rather than hex, so Tailwind can substitute an alpha
        // value. With a plain `var(--x)` string it cannot compute opacity, and
        // every modifier — bg-accent/5, border-border/30, text-text-inverse/80,
        // dark:bg-surface-muted/50 — silently produced no CSS at all.
        bg: withAlpha('--bg'),
        surface: {
          DEFAULT: withAlpha('--bg-surface'),
          muted: withAlpha('--bg-muted'),
          elevated: withAlpha('--bg-elevated'),
          inset: withAlpha('--bg-inset'),
          // Numeric aliases: the codebase reaches for surface-100…900 in ~30
          // places (spinners, dividers, hover states) and got nothing back.
          50: withAlpha('--bg-surface'),
          100: withAlpha('--bg-muted'),
          200: withAlpha('--bg-inset'),
          400: withAlpha('--text-tertiary'),
          700: withAlpha('--text-secondary'),
          800: withAlpha('--text'),
          900: withAlpha('--text'),
        },
        text: {
          DEFAULT: withAlpha('--text'),
          secondary: withAlpha('--text-secondary'),
          tertiary: withAlpha('--text-tertiary'),
          inverse: withAlpha('--text-inverse'),
          'on-accent': withAlpha('--text-on-accent'),
        },
        accent: {
          DEFAULT: withAlpha('--accent'),
          hover: withAlpha('--accent-hover'),
          muted: withAlpha('--accent-muted'),
          subtle: withAlpha('--accent-subtle'),
          2: withAlpha('--accent-2'),
          deep: withAlpha('--accent-deep'),
        },
        border: {
          DEFAULT: withAlpha('--border'),
          subtle: withAlpha('--border-subtle'),
          strong: withAlpha('--border-strong'),
        },
        success: { DEFAULT: withAlpha('--success'), light: withAlpha('--success-bg'), dark: withAlpha('--success') },
        warning: { DEFAULT: withAlpha('--warning'), light: withAlpha('--warning-bg'), dark: withAlpha('--warning') },
        danger: { DEFAULT: withAlpha('--danger'), light: withAlpha('--danger-bg'), dark: withAlpha('--danger') },
        info: { DEFAULT: withAlpha('--info'), light: withAlpha('--info-bg'), dark: withAlpha('--info') },
        skeleton: withAlpha('--skeleton'),
        glass: 'var(--glass-bg)',
      },
      fontFamily: {
        // Poppins had no Cyrillic, so every Russian string silently fell back
        // to whatever system font the device had. Manrope covers Cyrillic and
        // Uzbek Latin; Unbounded is the wide "tech" display face for hero
        // headlines and the wordmark — also with Cyrillic.
        sans: ['Manrope Variable', 'Manrope', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
        display: ['Unbounded Variable', 'Unbounded', 'Manrope Variable', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'SF Mono', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }],
      },
      // Used across the app but absent from the default scales.
      spacing: {
        '4.5': '1.125rem',
      },
      borderWidth: {
        '3': '3px',
      },
      transitionDuration: {
        '400': '400ms',
      },
      // Tailwind's default opacity scale steps by 5; these values are used for
      // very faint decorative washes and near-opaque sheets and would otherwise
      // resolve to nothing.
      opacity: {
        '2': '0.02',
        '4': '0.04',
        '6': '0.06',
        '8': '0.08',
        '98': '0.98',
      },
      borderRadius: {
        '4xl': '2rem',
        '5xl': '2.5rem',
      },
      boxShadow: {
        'sm': 'var(--shadow-sm)',
        'DEFAULT': 'var(--shadow)',
        'card': 'var(--shadow)',
        'card-hover': 'var(--shadow-md)',
        'elevated': 'var(--shadow-md)',
        'float': 'var(--shadow-lg)',
        'glow': '0 0 20px -5px var(--ring-accent)',
        'glow-lg': '0 0 40px -10px var(--ring-accent)',
        'accent': 'var(--shadow-accent)',
        'lit': 'var(--edge-highlight), var(--shadow)',
      },
      ringColor: {
        DEFAULT: 'var(--ring)',
        accent: 'var(--ring-accent)',
      },
      borderColor: {
        // --border is now RGB channels, so it needs rgb() like the others.
        DEFAULT: withAlpha('--border'),
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-out',
        'fade-in-up': 'fadeInUp 0.5s ease-out',
        'fade-in-down': 'fadeInDown 0.4s ease-out',
        'scale-in': 'scaleIn 0.3s ease-out',
        'slide-in-right': 'slideInRight 0.3s ease-out',
        'slide-in-up': 'slideInUp 0.4s ease-out',
        'slide-up': 'slideInUp 0.4s ease-out',
        'bounce-in': 'bounceIn 0.5s cubic-bezier(0.68, -0.55, 0.265, 1.55)',
        'shimmer': 'shimmer 2s infinite linear',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
        'float': 'float 3s ease-in-out infinite',
        'wiggle': 'wiggle 0.5s ease-in-out',
        'heart-pulse': 'heartPulse 0.3s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeInDown: {
          '0%': { opacity: '0', transform: 'translateY(-12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.9)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        slideInRight: {
          '0%': { opacity: '0', transform: 'translateX(24px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        slideInUp: {
          '0%': { opacity: '0', transform: 'translateY(100%)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        bounceIn: {
          '0%': { transform: 'scale(0)' },
          '50%': { transform: 'scale(1.15)' },
          '100%': { transform: 'scale(1)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.5' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-8px)' },
        },
        wiggle: {
          '0%, 100%': { transform: 'rotate(0deg)' },
          '25%': { transform: 'rotate(-3deg)' },
          '75%': { transform: 'rotate(3deg)' },
        },
        heartPulse: {
          '0%': { transform: 'scale(1)' },
          '30%': { transform: 'scale(1.3)' },
          '100%': { transform: 'scale(1)' },
        },
      },
      backdropBlur: {
        xs: '2px',
      },
    },
  },
  plugins: [],
};
