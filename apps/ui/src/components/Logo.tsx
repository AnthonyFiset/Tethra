import { cn } from "../lib/cn";

interface LogoProps {
  variant?: "mark" | "lockup";
  size?: number;
  className?: string;
}

export function Logo({
  variant = "mark",
  size = 20,
  className,
}: LogoProps): React.JSX.Element {
  return (
    <span
      className={cn("inline-flex items-center gap-2 text-accent", className)}
      aria-label="Tethra"
    >
      <svg
        viewBox="0 0 64 64"
        width={size}
        height={size}
        aria-hidden="true"
        className="block shrink-0"
      >
        <path
          fill="currentColor"
          d="M10 12c0-3 2-5 5-5h22l-8 10H10v-5Zm31-5h12c3 0 5 2 5 5s-2 5-5 5H33L41 7ZM29 23l9-11v35c0 3-1 5-4 7l-8 5V27l3-4Z"
        />
      </svg>
      {variant === "lockup" && (
        <span className="text-ui font-semibold tracking-tight text-fg">
          Tethra
        </span>
      )}
    </span>
  );
}
