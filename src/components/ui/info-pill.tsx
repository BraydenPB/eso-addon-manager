import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const infoPillVariants = cva(
  "inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-xs font-semibold transition-all duration-150",
  {
    variants: {
      color: {
        gold: "border-[#c4a44a]/20 bg-[#c4a44a]/[0.04] text-[#c4a44a]",
        sky: "border-sky-400/20 bg-sky-400/[0.04] text-sky-400",
        emerald: "border-emerald-400/20 bg-emerald-400/[0.04] text-emerald-400",
        amber: "border-amber-400/20 bg-amber-400/[0.04] text-amber-400",
        red: "border-red-400/20 bg-red-400/[0.04] text-red-400",
        violet: "border-violet-400/20 bg-violet-400/[0.04] text-violet-400",
        muted: "border-white/10 bg-white/[0.03] text-muted-foreground",
      },
    },
    defaultVariants: { color: "muted" },
  }
);

function InfoPill({
  className,
  color,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof infoPillVariants>) {
  return (
    <span data-slot="info-pill" className={cn(infoPillVariants({ color }), className)} {...props} />
  );
}

export { InfoPill, infoPillVariants };
