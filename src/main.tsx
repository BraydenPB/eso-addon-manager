import { StrictMode, Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { Toaster } from "@/components/ui/sonner";
import "./index.css";
import "./App.css";

// Catch fatal errors that occur before React mounts (CSP violations, script
// load failures, etc.) and display them instead of a blank white screen.
function showFatalError(msg: string) {
  const root = document.getElementById("root");
  if (!root) return;
  root.innerHTML = `<div style="padding:32px;color:#ef4444;font-family:monospace;white-space:pre-wrap">
    <h1 style="color:#fff;margin-bottom:16px">Fatal Error</h1>
    <p>${msg}</p>
    <p style="margin-top:16px;opacity:0.5">Try restarting the application.</p>
  </div>`;
}

window.addEventListener("error", (e) => {
  console.error("Global error:", e.error ?? e.message);
  if (!document.getElementById("root")?.children.length) {
    showFatalError(e.message);
  }
});

window.addEventListener("unhandledrejection", (e) => {
  console.error("Unhandled rejection:", e.reason);
  if (!document.getElementById("root")?.children.length) {
    showFatalError(String(e.reason));
  }
});

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{ padding: 32, color: "#ef4444", fontFamily: "monospace", whiteSpace: "pre-wrap" }}
        >
          <h1 style={{ color: "#fff", marginBottom: 16 }}>React Error</h1>
          <p>{this.state.error.message}</p>
          <pre style={{ marginTop: 16, fontSize: 12, opacity: 0.7 }}>{this.state.error.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
      <Toaster position="bottom-right" richColors />
    </ErrorBoundary>
  </StrictMode>
);
