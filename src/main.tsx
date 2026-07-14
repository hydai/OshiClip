import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import {
  applyUiPreferences,
  loadUiPreferences,
} from "./lib/uiPreferences";
import "./styles.css";

const initialUiPreferences = loadUiPreferences();
applyUiPreferences(initialUiPreferences);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App initialUiPreferences={initialUiPreferences} />
  </StrictMode>,
);
