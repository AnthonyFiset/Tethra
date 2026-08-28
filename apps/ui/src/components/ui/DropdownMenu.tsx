import * as RadixDropdownMenu from "@radix-ui/react-dropdown-menu";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "../../lib/cn";

export const dropdownMenuContentClass =
  "z-[2147483001] min-w-[13rem] rounded-xl border border-line-strong bg-elevated p-1.5 shadow-2xl shadow-black/60";

type ContentProps = ComponentPropsWithoutRef<typeof RadixDropdownMenu.Content>;

export function DropdownMenuContent({
  className,
  ...rest
}: ContentProps): React.JSX.Element {
  return (
    <RadixDropdownMenu.Content
      className={cn(dropdownMenuContentClass, className)}
      {...rest}
    />
  );
}

type ItemProps = ComponentPropsWithoutRef<typeof RadixDropdownMenu.Item> & {
  icon?: ReactNode;
};

export function DropdownMenuItem({
  icon,
  className,
  children,
  ...rest
}: ItemProps): React.JSX.Element {
  return (
    <RadixDropdownMenu.Item
      className={cn(
        "flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-ui text-fg-muted outline-none select-none data-[highlighted]:bg-hover data-[highlighted]:text-fg [&>svg]:text-fg-subtle data-[highlighted]:[&>svg]:text-fg-muted",
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </RadixDropdownMenu.Item>
  );
}

export { RadixDropdownMenu as DropdownMenu };
