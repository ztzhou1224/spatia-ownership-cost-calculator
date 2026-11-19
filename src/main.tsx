import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { PrivacyPage } from "./Privacy";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {location.pathname.replace(/\/+$/, "") === "/privacy" ? <PrivacyPage /> : <App />}
  </StrictMode>,
);
