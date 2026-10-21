import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./ReaderRoot";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
