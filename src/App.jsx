import { BrowserRouter, Routes, Route } from "react-router-dom";
import ConnectAWS from "./pages/ConnectAWS";
import Dashboard from "./pages/Dashboard";
import UserDetails from "./pages/UserDetails";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ConnectAWS />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/user/:username" element={<UserDetails />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;