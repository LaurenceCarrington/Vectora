import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { VectoraWorkspace } from "./components/VectoraWorkspace";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <VectoraWorkspace />
  </StrictMode>,
);
