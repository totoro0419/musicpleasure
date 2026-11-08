import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { loadStore } from "./store";
import App from "./App";
import "./style.css";
class Boundary extends React.Component<
  { children: React.ReactNode },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <main className="fatal">
        <h1>画面を読み込めませんでした</h1>
        <p>
          データは端末内に保持されています。ページを再読み込みしてください。
        </p>
        <button onClick={() => location.reload()}>再読み込み</button>
      </main>
    ) : (
      this.props.children
    );
  }
}
void loadStore();
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
    },
  },
});
createRoot(document.getElementById("root")!).render(
  <Boundary>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </Boundary>,
);
