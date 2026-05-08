import { useLocation, useNavigate } from "react-router-dom";
import { LayoutDashboard, Server, Database, Cloud, Brain, ShieldCheck, FileText, Boxes, Layers3 } from "lucide-react";

const sections = [
	{ key: "dashboard", label: "Dashboard", icon: LayoutDashboard, path: "/dashboard" },
	{ key: "ec2", label: "EC2 Instances", icon: Server, path: "/ec2" },
	{ key: "s3", label: "S3 Buckets", icon: Cloud, path: "/s3" },
	{ key: "rds", label: "RDS Databases", icon: Database, path: "/rds" },
	{ key: "lambda", label: "Lambda Functions", icon: Brain, path: "/dashboard" },
	{ key: "iam", label: "IAM", icon: ShieldCheck, path: "/dashboard" },
	{ key: "logs", label: "CloudWatch Logs", icon: FileText, path: "/dashboard" },
	{ key: "dynamo", label: "DynamoDB", icon: Boxes, path: "/dashboard" },
	{ key: "sqs", label: "SQS Queues", icon: Layers3, path: "/dashboard" }
];

export default function Sidebar({ active = "dashboard", accountId, region }) {
	const navigate = useNavigate();
	const location = useLocation();

	const activeKey = active === "dashboard" && location.pathname.includes("/ec2") ? "ec2" : active;

	return (
		<aside className="w-[260px] border-r border-slate-800 bg-[#0a1225] p-5">
			<div className="flex items-center gap-3 border-b border-slate-800 pb-4">
				<div className="h-10 w-10 rounded-xl bg-indigo-500/90 text-white font-bold grid place-items-center">CS</div>
				<div>
					<h2 className="text-lg font-semibold">Console Sensei</h2>
					<p className="text-xs text-slate-400">Cloud Ops</p>
				</div>
			</div>

			<div className="mt-5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm">
				{accountId || "AWS Account"}
			</div>

			<nav className="mt-6 space-y-2">
				{sections.map((item) => {
					const Icon = item.icon;
					const isActive = activeKey === item.key;
					return (
						<button
							key={item.key}
							onClick={() => navigate(item.path)}
							className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 text-left transition ${
								isActive ? "bg-indigo-600/20 text-indigo-300" : "text-slate-300 hover:bg-slate-900"
							}`}
						>
							<Icon className="h-4 w-4" />
							<span>{item.label}</span>
						</button>
					);
				})}
			</nav>

			<div className="mt-10 rounded-xl border border-slate-800 bg-[#0b152d] p-3">
				<p className="text-xs text-slate-400">Region</p>
				<p className="mt-1 font-medium">{region || "us-east-1"}</p>
				<p className="mt-3 text-xs text-emerald-400">Connected</p>
			</div>
		</aside>
	);
}
