import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter as Router } from "react-router-dom";
import App from "./App.jsx";
import "@fortawesome/fontawesome-free/css/all.min.css";
import "boxicons/css/boxicons.min.css";

//import * as sw from './src/dist/sw.js';

createRoot(document.getElementById("root")).render(
  <Router>
    <App />
  </Router>,
);

//sw.unregister();

import { registerSW } from "virtual:pwa-register";

registerSW({
  onOfflineReady() {
    console.log("App ready to work offline");
  },
  onNeedRefresh() {
    console.log("New update available");
  },
});
