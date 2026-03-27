import { cn } from "@/lib/utils";

function SectionHeader({ className, ...props }: React.ComponentProps<"h3">) {
  return (
    <h3
      data-slot="section-header"
      className={cn(
        "font-heading text-[11px] font-bold uppercase tracking-[0.05em] text-muted-foreground/60",
        className
      )}
      {...props}
    />
  );
}

export { SectionHeader };
