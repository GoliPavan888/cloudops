import { BrowserRouter, Routes, Route } from "react-router-dom";
import ConnectAWS from "./pages/ConnectAWS";
import Dashboard from "./pages/Dashboard";
import EC2Inventory from "./pages/EC2Inventory";
import S3Inventory from "./pages/S3Inventory";
import RDSInventory from "./pages/RDSInventory";
import UserDetails from "./pages/UserDetails";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ConnectAWS />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/ec2" element={<EC2Inventory />} />
        <Route path="/s3" element={<S3Inventory />} />
        <Route path="/rds" element={<RDSInventory />} />
        <Route path="/user/:username" element={<UserDetails />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;