import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import AdminPanel from "./pages/AdminPanel.tsx";
import "./index.css";

// MPA 模式：uuid 从 URL 路径中提取（/<uuid>），由服务端在返回 admin.html 前保证格式
const uuid = window.location.pathname.split("/").filter(Boolean)[0] ?? "";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AdminPanel uuid={uuid} />
  </StrictMode>,
);
