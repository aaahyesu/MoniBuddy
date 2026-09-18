import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { OverlayApp } from "./overlay/OverlayApp";
import "./index.css";
import "./styles.css";

const params = new URLSearchParams(window.location.search);
const mode = params.get("mode");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {mode === "overlay" ? <OverlayApp /> : <App />}
  </React.StrictMode>,
);
