import { ShieldCheck } from "lucide-react";
import axios from "axios";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Sidebar from "../components/Sidebar";

export default function ConnectAWS() {
  const [roleArn, setRoleArn] = useState("");
  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();

  const connectAWS = async () => {
    try {
      setLoading(true);

      const response = await axios.post(
        "/api/aws/connect",
        { roleArn }
      );

      localStorage.setItem("roleArn", roleArn);
      localStorage.setItem("awsUsers", JSON.stringify(response.data.users || []));
      localStorage.setItem("awsResources", JSON.stringify(response.data.resources || []));
      localStorage.setItem("resourcesByUser", JSON.stringify(response.data.resourcesByUser || {}));
      localStorage.setItem("awsMetrics", JSON.stringify(response.data.metrics || {}));
      localStorage.setItem("awsAccount", JSON.stringify(response.data.account || {}));

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
      <Sidebar />

      <div className="flex-1 p-10">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-4xl font-bold">Welcome to AWS Scanner</h1>
          <p className="text-slate-400 mt-3">To get started, create an IAM role and provide the Role ARN.</p>

          <div className="grid grid-cols-12 gap-6 mt-8">
            <div className="col-span-7 bg-slate-900 p-6 rounded-2xl border border-slate-800">
              <h3 className="font-semibold text-lg">Step 1: Create IAM Role</h3>
              <ol className="mt-4 list-decimal list-inside text-slate-300 space-y-2">
                <li>Open the IAM console and create a new role.</li>
                <li>Trusted entity: AWS account — use Account ID shown in sidebar.</li>
                <li>Attach ReadOnlyAccess managed policy.</li>
                <li>Copy the Role ARN from the role summary.</li>
              </ol>

              <div className="mt-6 bg-yellow-50/10 p-4 rounded text-sm text-yellow-200">Security note: This role uses read-only permissions and will not make changes to your account.</div>
            </div>

            <div className="col-span-5 bg-slate-900 p-6 rounded-2xl border border-slate-800">
              <div className="flex items-center gap-3">
                <ShieldCheck className="text-blue-400" />
                <h3 className="font-semibold text-lg">Provide Role ARN</h3>
              </div>

              <input
                type="text"
                value={roleArn}
                onChange={(e) => setRoleArn(e.target.value)}
                placeholder="arn:aws:iam::123456789012:role/AWSScannerReadOnlyRole"
                className="w-full mt-6 bg-slate-950 border border-slate-700 rounded-xl p-4 outline-none"
              />

              <div className="mt-3 text-slate-400 text-sm bg-slate-800 p-3 rounded">Example: arn:aws:iam::123456789012:role/AWSScannerReadOnlyRole</div>

              <button
                onClick={connectAWS}
                className="mt-6 w-full bg-blue-600 hover:bg-blue-700 px-6 py-3 rounded-xl font-semibold"
              >
                {loading ? "Connecting..." : "Connect to AWS"}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-4 mt-8">
            <div className="col-span-1 bg-slate-900 p-4 rounded-2xl border border-slate-800 text-center">
              <div className="text-lg font-semibold">Scan Users</div>
              <div className="text-sm text-slate-400 mt-2">Discover IAM users</div>
            </div>
            <div className="col-span-1 bg-slate-900 p-4 rounded-2xl border border-slate-800 text-center">
              <div className="text-lg font-semibold">Scan Resources</div>
              <div className="text-sm text-slate-400 mt-2">Find resources per user</div>
            </div>
            <div className="col-span-1 bg-slate-900 p-4 rounded-2xl border border-slate-800 text-center">
              <div className="text-lg font-semibold">Organize</div>
              <div className="text-sm text-slate-400 mt-2">Analyze by user</div>
            </div>
            <div className="col-span-1 bg-slate-900 p-4 rounded-2xl border border-slate-800 text-center">
              <div className="text-lg font-semibold">Maintain</div>
              <div className="text-sm text-slate-400 mt-2">Read-only access</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
