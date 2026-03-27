import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const glassPanelVariants = cva(
  "rounded-xl backdrop-blur-lg [-webkit-backdrop-filter:blur(16px)] transition-shadow duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]",
  {
    variants: {
      variant: {
        primary:
          "bg-[rgba(15,23,42,0.84)] border border-white/[0.09] shadow-[0_8px_32px_rgba(0,0,0,0.32),inset_0_1px_0_rgba(255,255,255,0.05)]",
        default:
          "bg-[rgba(15,23,42,0.66)] border border-white/[0.06] shadow-[0_4px_16px_rgba(0,0,0,0.2)]",
        subtle: "bg-white/[0.02] border border-white/[0.04] shadow-none",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

function GlassPanel({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof glassPanelVariants>) {
  return (
    <div
      data-slot="glass-panel"
      className={cn(glassPanelVariants({ variant }), className)}
      {...props}
    />
  );
}

export { GlassPanel, glassPanelVariants };
