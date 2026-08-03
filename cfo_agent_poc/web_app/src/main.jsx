import { createRoot } from "react-dom/client";
import "../styles.css";
import "../vendor/gsap.min.js";
import "../vendor/ScrollTrigger.min.js";
import App from "./App.jsx";

document.body.classList.add("app-loading");

createRoot(document.getElementById("root")).render(<App />);

requestAnimationFrame(async () => {
  await import("./motion.js");
  await import("./legacy-controller.js");
});
