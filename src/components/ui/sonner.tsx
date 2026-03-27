import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      toastOptions={{
        className: "!bg-[rgba(15,23,42,0.95)] !border-white/10 !text-foreground !backdrop-blur-lg",
      }}
      style={
        {
          "--normal-bg": "rgba(15, 23, 42, 0.95)",
          "--normal-text": "var(--foreground)",
          "--normal-border": "rgba(255, 255, 255, 0.1)",
          "--border-radius": "0.75rem",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
