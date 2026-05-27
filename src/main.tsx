import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
// Side-effecting native-plugin bootstrap. Configures @capacitor/keyboard
// resize behavior and registers the auth deep-link listener when the
// app is running inside a Capacitor WebView. No-ops on the web.
import "./lib/native-init";

createRoot(document.getElementById("root")!).render(<App />);
