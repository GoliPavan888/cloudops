import { useLocation, useNavigate } from "react-router-dom";
import { useMemo, useState } from "react";
import { ChevronDown, LayoutDashboard, Server, Database, Cloud, Brain, ShieldCheck, FileText, Boxes, Layers3 } from "lucide-react";
import { useAWSConnection } from "../context/AWSConnectionContext.jsx";

const sections = [
	{ key: "dashboard", label: "Dashboard", icon: LayoutDashboard, path: "/dashboard" },
	{ key: "ec2", label: "EC2 Instances", icon: Server, path: "/ec2" },
	{ key: "s3", label: "S3 Buckets", icon: Cloud, path: "/s3" },
	{ key: "rds", label: "RDS Databases", icon: Database, path: "/rds" },
	{ key: "lambda", label: "Lambda Functions", icon: Brain, path: "/lambda" },
	{ key: "iam", label: "IAM", icon: ShieldCheck, path: "/iam" },
	{ key: "logs", label: "CloudWatch Logs", icon: FileText, path: "/logs" },
	{ key: "dynamodb", label: "DynamoDB", icon: Database, path: "/dynamodb" },
	{ key: "sqs", label: "SQS Queues", icon: Layers3, path: "/sqs" }
];

export default function Sidebar({ active = "dashboard", accountId, region }) {
	const navigate = useNavigate();
	const location = useLocation();
	const { connectedRole, disconnectAWS } = useAWSConnection();
	const [showAccountMenu, setShowAccountMenu] = useState(false);

	const activeKey = active === "dashboard" && location.pathname.includes("/ec2") ? "ec2" : active;
	const displayAccountId = accountId || connectedRole?.accountId || "AWS Account";
	const displayRegion = region || connectedRole?.region || "us-east-1";
	const connectedAt = connectedRole?.connectedAt ? new Date(connectedRole.connectedAt).toLocaleString() : "-";
	const accountLabel = connectedRole?.accountAlias || connectedRole?.accountId || "AWS Account";
	const environmentType = connectedRole?.environmentType || "Development";
	const connectionHealth = connectedRole?.connectionHealth || "Connected";
	const roleName = connectedRole?.roleName || "UnknownRole";
	const assumedRoleArn = connectedRole?.assumedRoleArn || connectedRole?.roleArn || "";
	const accounts = connectedRole?.accounts || [];

	const envStyles = useMemo(
		() => ({
			Production: "border-red-500/30 bg-red-500/10 text-red-200",
			Development: "border-sky-500/30 bg-sky-500/10 text-sky-200",
			Sandbox: "border-amber-500/30 bg-amber-500/10 text-amber-200",
			Security: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
		}),
		[]
	);

	const statusStyles = useMemo(
		() => ({
			Connected: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
			"Identity Mismatch": "border-amber-500/30 bg-amber-500/10 text-amber-200",
			Unknown: "border-slate-500/30 bg-slate-500/10 text-slate-200",
		}),
		[]
	);

	return (
		<aside className="w-[260px] border-r border-slate-800 bg-[#0a1225] p-5">
			<div className="flex items-center gap-3 border-b border-slate-800 pb-4">
				<div className="h-10 w-10 rounded-xl bg-indigo-500/90 text-white font-bold grid place-items-center">CS</div>
				<div>
					<h2 className="text-lg font-semibold">Console Sensei</h2>
					<p className="text-xs text-slate-400">Cloud Ops</p>
				</div>
			</div>

			<div className="mt-5 rounded-2xl border border-slate-700 bg-slate-950/70 p-3 shadow-lg shadow-black/20">
				<div className="flex items-start justify-between gap-3">
					<div>
						<div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">AWS Connection</div>
						<div className="mt-1 text-sm font-semibold text-white">AWS | {accountLabel}</div>
						<div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
							<span>{displayRegion}</span>
							<span>•</span>
							<span>{roleName}</span>
						</div>
					</div>
					<button
						type="button"
						onClick={() => setShowAccountMenu((value) => !value)}
						className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-300 transition hover:border-slate-500 hover:text-white"
					>
						Switcher
						<ChevronDown className={`h-3.5 w-3.5 transition ${showAccountMenu ? "rotate-180" : ""}`} />
					</button>
				</div>

				<div className="mt-3 flex flex-wrap gap-2">
					<span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${envStyles[environmentType] || envStyles.Development}`}>
						{environmentType}
					</span>
					<span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusStyles[connectionHealth] || statusStyles.Connected}`}>
						{connectionHealth}
					</span>
				</div>

				<div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-400">
					<div className="rounded-lg border border-slate-800 bg-slate-900/60 px-2.5 py-2">
						<div className="text-slate-500">Account</div>
						<div className="mt-1 truncate text-slate-100">{displayAccountId}</div>
					</div>
					<div className="rounded-lg border border-slate-800 bg-slate-900/60 px-2.5 py-2">
						<div className="text-slate-500">Region</div>
						<div className="mt-1 text-slate-100">{displayRegion}</div>
					</div>
				</div>

				<div className="mt-3 text-xs text-slate-500">Connected: {connectedAt}</div>

				{showAccountMenu && (
					<div className="mt-3 rounded-xl border border-slate-800 bg-slate-900/80 p-2">
						<div className="px-2 py-1 text-[11px] uppercase tracking-[0.2em] text-slate-500">Account Switcher</div>
						{accounts.length > 0 ? (
							<div className="mt-2 space-y-1">
								{accounts.map((item) => (
									<button key={item.accountId || item.roleArn} type="button" className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-2 text-left text-xs text-slate-200 transition hover:border-sky-500/40 hover:bg-slate-900">
										<div className="font-medium">{item.accountAlias || item.accountId || "AWS Account"}</div>
										<div className="mt-0.5 text-slate-500">{item.region || displayRegion}</div>
									</button>
								))}
							</div>
						) : (
							<div className="px-2 py-2 text-xs text-slate-500">Single-account view. Multi-account switching will appear here.</div>
						)}
					</div>
				)}

				<div className="mt-3 text-[11px] text-slate-500 break-all">Assumed role: {assumedRoleArn}</div>
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
				<p className="text-xs text-slate-400">Connection Health</p>
				<p className="mt-1 font-medium text-white">{connectionHealth}</p>
				<p className="mt-3 text-xs text-slate-400">Active region</p>
				<p className="mt-1 text-sm text-slate-100">{displayRegion}</p>
				<button
					onClick={disconnectAWS}
					className="mt-4 w-full rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-200 transition hover:bg-red-500/20"
				>
					Disconnect AWS
				</button>
			</div>
		</aside>
	);
}
