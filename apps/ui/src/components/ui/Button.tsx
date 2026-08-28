import type { ButtonHTMLAttributes, ReactNode } from "react";
import { forwardRef } from "react";
import { cn } from "../../lib/cn";

type Variant = "primary" | "ghost" | "subtle" | "danger";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-accent text-white border-transparent hover:bg-accent-hover active:bg-accent",
  ghost:
    "bg-transparent text-fg-muted border-transparent hover:bg-hover hover:text-fg",
  subtle: "bg-elevated text-fg border-line hover:bg-hover hover:border-line-strong",
  // Quiet destructive: red text on a normal surface — a solid red fill was
  // the loudest element on every page it appeared (DESIGN.md: the amber
  // agent-waiting banner is the ONE emphatic tint).
  danger:
    "border-line bg-elevated text-danger hover:border-danger/40 hover:bg-danger/10",
};

const SIZES: Record<Size, string> = {
  sm: "h-7 px-2.5 gap-1.5 text-micro",
  md: "h-8 px-3 gap-2 text-ui",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
}

export const Button = forwardRef(function Button(
  {
    variant = "subtle",
    size = "md",
    icon,
    className,
    children,
    ...rest
  }: ButtonProps,
  ref: React.ForwardedRef<HTMLButtonElement>,
): React.JSX.Element {
  return (
    <button
      {...rest}
      ref={ref}
      className={cn(
        "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md border font-medium transition-colors",
        "disabled:pointer-events-none disabled:opacity-45",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
    >
      {icon}
      {children}
    </button>
  );
});

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  variant?: Variant;
  size?: Size;
}

export function IconButton({
  label,
  variant = "ghost",
  size = "md",
  className,
  children,
  ...rest
}: IconButtonProps): React.JSX.Element {
  return (
    <button
      {...rest}
      aria-label={label}
      className={cn(
        "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md border transition-colors",
        "disabled:pointer-events-none disabled:opacity-45",
        VARIANTS[variant],
        size === "sm" ? "size-6" : "size-7",
        className,
      )}
    >
      {children}
    </button>
  );
}
