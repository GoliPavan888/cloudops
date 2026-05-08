import { ShieldCheck } from "lucide-react";
import axios from "axios";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

export default function ConnectAWS() {
  const [roleArn, setRoleArn] = useState("");
  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();

  const connectAWS = async () => {
    try {
      setLoading(true);

      const response = await axios.post(
        "http://localhost:5000/api/aws/connect",
        { roleArn }
      );

      // ✅ Save Role ARN before navigating
      localStorage.setItem("roleArn", roleArn);

      // ✅ Save discovered users
      localStorage.setItem("awsUsers", JSON.stringify(response.data.users));
      localStorage.setItem("awsEc2Instances", JSON.stringify(response.data.ec2Instances || []));
      localStorage.setItem("awsAccount", JSON.stringify(response.data.account || {}));
      localStorage.setItem("awsMetrics", JSON.stringify(response.data.metrics || {}));

      navigate("/dashboard");
    } catch (error) {
      console.error(error);
      alert("AWS Connection Failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white flex">
      {/* Sidebar */}
      <div className="w-64 bg-slate-900 p-6 border-r border-slate-800">
        <h1 className="text-2xl font-bold text-blue-400">AWS Scanner</h1>
        <div className="mt-10 space-y-4">
          <button className="w-full bg-blue-600 py-3 rounded-xl">Get Started</button>
          <button className="w-full bg-slate-800 py-3 rounded-xl">Dashboard</button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 p-10">
        <div className="max-w-5xl mx-auto">
          <h1 className="text-4xl font-bold">Connect Your AWS Account</h1>
          <p className="text-slate-400 mt-3">
            Create a read-only IAM role and provide the ARN.
          </p>

          {/* Steps */}
          <div className="grid grid-cols-3 gap-6 mt-10">
            <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800">
              <div className="bg-blue-600 w-10 h-10 rounded-full flex items-center justify-center">1</div>
              <h2 className="text-xl font-semibold mt-4">Create IAM Role</h2>
              <p className="text-slate-400 mt-2">Create a cross-account read-only role.</p>
            </div>

            <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800">
              <div className="bg-blue-600 w-10 h-10 rounded-full flex items-center justify-center">2</div>
              <h2 className="text-xl font-semibold mt-4">Provide ARN</h2>
              <p className="text-slate-400 mt-2">Paste the IAM Role ARN here.</p>
            </div>

            <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800">
              <div className="bg-blue-600 w-10 h-10 rounded-full flex items-center justify-center">3</div>
              <h2 className="text-xl font-semibold mt-4">Start Scan</h2>
              <p className="text-slate-400 mt-2">Scan users and AWS resources.</p>
            </div>
          </div>

          {/* ARN Input */}
          <div className="bg-slate-900 mt-10 p-8 rounded-2xl border border-slate-800">
            <div className="flex items-center gap-3">
              <ShieldCheck className="text-blue-400" />
              <h2 className="text-2xl font-semibold">AWS Role ARN</h2>
            </div>

            <input
              type="text"
              value={roleArn}
              onChange={(e) => setRoleArn(e.target.value)}
              placeholder="arn:aws:iam::123456789012:role/AWSScannerRole"
              className="w-full mt-6 bg-slate-950 border border-slate-700 rounded-xl p-4 outline-none"
            />

            <button
              onClick={connectAWS}
              className="mt-6 bg-blue-600 hover:bg-blue-700 px-8 py-4 rounded-xl font-semibold"
            >
              {loading ? "Connecting..." : "Connect AWS"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
