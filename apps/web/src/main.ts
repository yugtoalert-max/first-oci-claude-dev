import "./style.css";
import { resolveApiBaseUrl } from "./api/base-url";
import { startApp } from "./app";

const root = document.getElementById("app");
if (!root) throw new Error("#app is missing in index.html");

startApp(root, { baseUrl: resolveApiBaseUrl(import.meta.env), storage: sessionStorage });
