import { StrictMode, Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { Toaster } from "@/components/ui/sonner";
import "./index.css";
import "./App.css";

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
