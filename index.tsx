import React from "react";
import ReactDOM from "react-dom/client";
const App = React.lazy(() => import("./App"));
const PublicQuiz = React.lazy(() => import("./components/quiz/PublicQuiz"));
const Battle = React.lazy(() => import("./components/quiz/Battle"));
import "./quiz.css";
const path = window.location.pathname;
const quiz = path.match(/^\/quiz\/([A-Za-z0-9_-]+)\/?$/);
const battle = path.match(/^\/battle(?:\/([A-Za-z0-9]+))?\/?$/);
try {
  if (JSON.parse(localStorage.getItem("briefly_dark_mode") || "false"))
    document.documentElement.classList.add("dark");
} catch {}
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <React.Suspense
      fallback={
        <div className="q-public q-card" role="status">
          Opening your learning space…
        </div>
      }
    >
      {quiz ? (
        <PublicQuiz shareId={quiz[1]} />
      ) : battle ? (
        <Battle code={battle[1] || ""} />
      ) : (
        <App />
      )}
    </React.Suspense>
  </React.StrictMode>,
);
