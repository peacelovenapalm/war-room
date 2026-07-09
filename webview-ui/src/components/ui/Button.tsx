import type { ButtonHTMLAttributes } from 'react';

const base = 'border-2 rounded-none cursor-pointer';

// Touch target floor (G6, BUILD-PLAN §G6 task 4): below the 640px `sm`
// breakpoint every size gets a 44x44px minimum hit area (Apple HIG / WCAG
// 2.5.5) via `max-sm:` overrides, so desktop's tighter pixel-art proportions
// are untouched. --spacing is repointed to 1px in index.css, so `44` below
// is exactly 44px, not the Tailwind default 4px-multiple scale.
const TOUCH_FLOOR =
  'max-sm:min-w-44 max-sm:min-h-44 max-sm:flex max-sm:items-center max-sm:justify-center';

const sizes = {
  sm: `py-1 px-8 text-sm ${TOUCH_FLOOR}`,
  md: `py-2 px-12 ${TOUCH_FLOOR}`,
  lg: `py-3 px-14 text-lg ${TOUCH_FLOOR}`,
  xl: `py-6 px-24 text-xl ${TOUCH_FLOOR}`,
  // min-w/min-h (not w/h) at mobile: several icon buttons (e.g. Modal's close
  // "x") sit in a flex row next to sibling content — a fixed `width` is a
  // flex-basis flex-shrink can compress below 44px, but explicit min-width
  // is a hard floor flex-shrink can't cross. shrink-0 belt-and-suspenders.
  icon: 'p-0 w-16 h-16 shrink-0 flex items-center justify-center max-sm:min-w-44 max-sm:min-h-44',
  icon_lg:
    'p-0 w-40 h-40 shrink-0 flex items-center justify-center max-sm:min-w-44 max-sm:min-h-44',
} as const;

const variants = {
  default: `${base} bg-btn-bg border-transparent hover:bg-btn-hover`,
  active: `${base} bg-active-bg border-accent`,
  disabled: `${base} bg-btn-bg border-transparent cursor-default opacity-[var(--btn-disabled-opacity)]`,
  accent: `${base} bg-accent! hover:bg-accent-bright! border-accent hover:border-accent-bright`,
  ghost: `${base} bg-transparent text-text-muted border-transparent hover:text-text`,
} as const;

type ButtonVariant = keyof typeof variants;
type ButtonSize = keyof typeof sizes;

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({
  variant = 'default',
  size = 'lg',
  className = '',
  ...props
}: ButtonProps) {
  return <button className={`${variants[variant]} ${sizes[size]} ${className}`} {...props} />;
}
