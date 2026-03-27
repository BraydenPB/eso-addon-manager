import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all duration-150 outline-none select-none active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-gradient-to-b from-[#d4b45a] to-[#c4a44a] text-[#0b1220] font-semibold border-[#c4a44a]/50 shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_1px_3px_rgba(0,0,0,0.3)] hover:from-[#dcc06a] hover:to-[#cdb050] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_0_12px_rgba(196,164,74,0.3),0_2px_6px_rgba(0,0,0,0.3)] focus-visible:ring-3 focus-visible:ring-[#c4a44a]/40",
        outline:
          "bg-white/[0.04] border-white/[0.1] text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] hover:bg-white/[0.08] hover:border-white/[0.15] aria-expanded:bg-white/[0.08] aria-expanded:border-white/[0.15] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        secondary:
          "bg-white/[0.06] border-white/[0.08] text-foreground hover:bg-white/[0.1] hover:border-white/[0.12] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        ghost:
          "text-foreground/70 hover:text-foreground hover:bg-white/[0.06] aria-expanded:bg-white/[0.06] aria-expanded:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        destructive:
          "bg-red-500/[0.08] text-red-400 border-red-500/20 hover:bg-red-500/[0.15] hover:border-red-500/30 hover:shadow-[0_0_12px_rgba(239,68,68,0.15)] focus-visible:border-red-500/40 focus-visible:ring-3 focus-visible:ring-red-500/20",
        link: "text-primary underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
