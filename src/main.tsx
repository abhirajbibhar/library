import ReactDOM from "react-dom/client";
import "./index.css";
import "@fontsource/open-sans/latin-400.css";
import "@fontsource/open-sans/latin-600.css";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);

// Installable app + instant start. Skipped in dev so hot reload isn't cached.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => console.warn("Service worker not registered:", err));
  });
}
