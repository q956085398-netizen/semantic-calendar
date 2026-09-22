import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export default function App() {
  const [status, setStatus] = useState("桌面工作区已就绪");

  async function verifyIpc() {
    try {
      const message = await invoke<string>("greet", {
        name: "Semantic Calendar",
      });
      setStatus(message);
    } catch {
      setStatus("浏览器预览模式：Tauri IPC 仅在桌面壳中可用");
    }
  }

  return (
    <main className="shell">
      <section className="hero" aria-labelledby="app-title">
        <p className="eyebrow">Semantic Calendar · v0.1 bootstrap</p>
        <h1 id="app-title">语义日历</h1>
        <p className="subtitle">
          本地优先的桌面日历。当前工单建立 React、TypeScript、Tauri 与最小 IPC
          链路。
        </p>
        <button type="button" onClick={verifyIpc}>
          验证桌面 IPC
        </button>
        <output aria-live="polite">{status}</output>
      </section>
    </main>
  );
}
