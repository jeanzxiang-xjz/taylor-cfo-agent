import { createRoot } from "react-dom/client";
import "../styles.css";
import "../vendor/gsap.min.js";
import App, { CRITICAL_IMAGE_URLS } from "./App.jsx";

document.body.classList.add("app-loading");

function preloadImage(src) {
  return new Promise((resolve) => {
    if (!src) {
      resolve();
      return;
    }
    const image = new Image();
    image.onload = async () => {
      try {
        await image.decode?.();
      } catch {
        /* 已经加载完成，decode 的支持度各家不同，失败可以忽略。 */
      }
      resolve();
    };
    image.onerror = () => resolve();
    image.src = src;
  });
}

// 开场动画在 motion.js 里等这个 Promise
window.cfoStaticReady = Promise.all(CRITICAL_IMAGE_URLS.map(preloadImage));

createRoot(document.getElementById("root")).render(<App />);

requestAnimationFrame(async () => {
  await import("./motion.js");
  await import("./legacy-controller.js");
});
