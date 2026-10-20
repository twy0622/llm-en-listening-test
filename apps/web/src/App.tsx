import { Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import Admin from "./pages/Admin";
import Exam from "./pages/Exam";
import History from "./pages/History";
import Home from "./pages/Home";
import Results from "./pages/Results";

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/exam" element={<Exam />} />
        <Route path="/results/:attemptId" element={<Results />} />
        <Route path="/history" element={<History />} />
        <Route path="/admin" element={<Admin />} />
        <Route
          path="*"
          element={
            <div className="mx-auto max-w-xl px-6 py-24 text-center">
              <p className="label text-accent">404</p>
              <h1 className="mt-3 text-4xl">This page is out of earshot.</h1>
              <a className="btn-primary mt-8" href="/">
                Back to practice
              </a>
            </div>
          }
        />
      </Routes>
    </Layout>
  );
}
