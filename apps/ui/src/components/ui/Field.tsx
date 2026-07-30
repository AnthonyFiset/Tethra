import type { InputHTMLAttributes, ReactNode, Ref } from "react";
import { cn } from "../../lib/cn";

export const inputClass =
  "h-8 w-full rounded-md border border-line bg-base px-2.5 text-ui text-fg transition-colors placeholder:text-fg-subtle hover:border-line-strong focus:border-accent focus:outline-none disabled:opacity-45";

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: ReactNode;
  hint?: ReactNode;
  inputRef?: Ref<HTMLInputElement>;
  containerClassName?: string;
}

export function Field({
  label,
  hint,
  inputRef,
  containerClassName,
  className,
  ...rest
}: FieldProps): React.JSX.Element {
  return (
    <label className={cn("flex flex-col gap-1.5", containerClassName)}>
      <span className="text-micro font-medium text-fg-muted">{label}</span>
      <input ref={inputRef} {...rest} className={cn(inputClass, className)} />
      {hint && <span className="text-micro text-fg-subtle">{hint}</span>}
    </label>
  );
}

export function ErrorBanner({
  children,
}: {
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div
      role="alert"
      className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-micro text-danger"
      data-selectable
    >
      {children}
    </div>
  );
}
