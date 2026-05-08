import { useEffect, useMemo, useState } from "react";
import {
  Search,
  Bell,
  UserCircle2,
  Database,
  HardDrive,
  ShieldAlert,
  Globe2,
  Coins,
  Server,
  Box,
  Zap,
  Brain,
  KeyRound,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import Sidebar from "../components/Sidebar";

function formatMoney(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function formatMonth(isoDate) {
  if (!isoDate) return "-";
  const date = new Date(`${isoDate}T00:00:00Z`);
  return date.toLocaleString("en-US", { month: "short" });
}

function MiniLineChart({ points }) {
  const width = 700;
  const height = 260;
  const padding = 26;

  const normalized = useMemo(() => {
    if (!points.length) return [];
    const values = points.map((p) => p.amount || 0);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const spread = Math.max(1, max - min);

    return points.map((p, i) => {
      const x = padding + (i * (width - padding * 2)) / Math.max(1, points.length - 1);
      const y = height - padding - (((p.amount || 0) - min) / spread) * (height - padding * 2);
      return { ...p, x, y };
    });
  }, [points]);

  const path = normalized
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`)
    .join(" ");

  return (
    <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-[260px]">
        <defs>
          <linearGradient id="lineFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4f87ff" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#4f87ff" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {[0, 1, 2, 3].map((n) => {
          const y = padding + (n * (height - padding * 2)) / 3;
          return (
            <line
              key={n}
              x1={padding}
              y1={y}
              x2={width - padding}
              y2={y}
              stroke="#1f2a44"
              strokeDasharray="4 6"
            />
          );
        })}

        {normalized.length > 1 && (
          <>
            <path d={`${path} L${normalized[normalized.length - 1].x},${height - padding} L${padding},${height - padding} Z`} fill="url(#lineFill)" />
            <path d={path} fill="none" stroke="#4f87ff" strokeWidth="3" strokeLinecap="round" />
          </>
        )}

        {normalized.map((p) => (
          <circle key={p.month} cx={p.x} cy={p.y} r="4" fill="#4f87ff" />
        ))}
      </svg>

      <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
        {points.map((p) => (
          <span key={p.month}>{formatMonth(p.month)}</span>
        ))}
      </div>
    </div>
  );
}

function FindingsDonut({ findings }) {
  const slices = [
    { label: "Critical", value: findings.critical || 0, color: "#ef4444" },
    { label: "High", value: findings.high || 0, color: "#f97316" },
    { label: "Medium", value: findings.medium || 0, color: "#f59e0b" },
    { label: "Low", value: findings.low || 0, color: "#3b82f6" },
    { label: "Info", value: findings.informational || 0, color: "#94a3b8" },
  ];

  const total = slices.reduce((sum, s) => sum + s.value, 0);
  let cumulative = 0;
  const gradient = slices
    .map((s) => {
      const start = total === 0 ? 0 : (cumulative / total) * 100;
      cumulative += s.value;
      const end = total === 0 ? 0 : (cumulative / total) * 100;
      return `${s.color} ${start}% ${end}%`;
    })
    .join(", ");

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <h3 className="text-xl font-semibold text-slate-100">Security Findings</h3>
      <p className="text-slate-400 text-sm mt-1">{total} total findings</p>

      <div className="mt-6 flex items-center justify-center">
        <div
          className="h-40 w-40 rounded-full"
          style={{
            background: `conic-gradient(${gradient || "#334155 0% 100%"})`,
          }}
        >
          <div className="m-[22px] h-[116px] w-[116px] rounded-full bg-[#0b1225] border border-slate-700" />
        </div>
      </div>

      <div className="mt-6 space-y-2">
        {slices.map((s) => (
          <div key={s.label} className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2 text-slate-300">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
              {s.label}
            </div>
            <div className="font-semibold text-slate-100">{s.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-2xl border border-slate-800 bg-slate-900 p-4 text-left transition hover:border-indigo-500/50 hover:bg-slate-900/80"
    >
      <div className="inline-flex rounded-lg bg-slate-800 p-2">
        <Icon className="h-5 w-5 text-sky-400" />
      </div>
      <p className="mt-3 text-sm text-slate-400">{label}</p>
      <p className="mt-1 text-3xl font-bold text-slate-100">{value}</p>
    </button>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [resources, setResources] = useState([]);
  const [metrics, setMetrics] = useState({
    totalUsers: 0,
    totalResources: 0,
    activeRegions: 0,
    serviceBreakdown: {},
    costTrend: [],
    securityFindings: { critical: 0, high: 0, medium: 0, low: 0, informational: 0 },
  });
  const [account, setAccount] = useState({});

  useEffect(() => {
    setUsers(JSON.parse(localStorage.getItem("awsUsers") || "[]"));
    setResources(JSON.parse(localStorage.getItem("awsResources") || "[]"));
    setMetrics(JSON.parse(localStorage.getItem("awsMetrics") || "{}"));
    setAccount(JSON.parse(localStorage.getItem("awsAccount") || "{}"));
  }, []);

  const costSeries = metrics.costTrend || [];
  const latestCost = costSeries.length ? costSeries[costSeries.length - 1].amount : 0;

  const serviceBreakdown = metrics.serviceBreakdown || {};
  const resourceRows = Object.entries(serviceBreakdown)
    .sort((a, b) => b[1] - a[1])
    .map(([service, count]) => ({ service, count }));

  return (
    <div className="min-h-screen bg-[#070d1d] text-slate-100">
      <div className="flex min-h-screen">
        <Sidebar active="dashboard" accountId={account.accountId} region={account.region} />

        <main className="flex-1 px-7 py-5">
          <header className="flex items-center justify-between gap-4 border-b border-slate-800 pb-4">
            <div className="relative w-[380px] max-w-full">
              <Search className="absolute left-3 top-3 h-4 w-4 text-slate-500" />
              <input
                className="w-full rounded-xl border border-slate-700 bg-slate-900 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-indigo-500"
                placeholder="Search resources, costs, alerts..."
                readOnly
              />
            </div>

            <div className="flex items-center gap-3 text-sm">
              <span className="text-emerald-400">AWS</span>
              <span className="text-slate-500">|</span>
              <span className="text-slate-300">prod-main</span>
              <button className="rounded-full bg-slate-900 p-2 border border-slate-700">
                <Bell className="h-4 w-4" />
              </button>
              <button className="rounded-full bg-indigo-500/20 p-2 border border-indigo-400/30">
                <UserCircle2 className="h-4 w-4 text-indigo-300" />
              </button>
            </div>
          </header>

          <section className="mt-6">
            <h1 className="text-4xl font-bold tracking-tight">Operations Dashboard</h1>
            <p className="mt-1 text-slate-400">Real-time AWS infrastructure intelligence</p>

            <div className="mt-5 grid grid-cols-2 gap-4 xl:grid-cols-4 2xl:grid-cols-8">
              <MetricCard icon={Coins} label="Monthly Cost" value={formatMoney(latestCost)} />
              <MetricCard icon={Database} label="Active Resources" value={metrics.totalResources || 0} />
              <MetricCard icon={HardDrive} label="IAM Users" value={metrics.totalUsers || users.length} onClick={() => navigate("/iam")} />
              <MetricCard
                icon={ShieldAlert}
                label="Security Findings"
                value={
                  (metrics.securityFindings?.critical || 0) +
                  (metrics.securityFindings?.high || 0) +
                  (metrics.securityFindings?.medium || 0) +
                  (metrics.securityFindings?.low || 0) +
                  (metrics.securityFindings?.informational || 0)
                }
              />
              <MetricCard icon={Globe2} label="Active Regions" value={metrics.activeRegions || 0} />
              <MetricCard icon={Box} label="S3 Buckets" value={serviceBreakdown.S3 || 0} onClick={() => navigate("/s3")} />
              <MetricCard icon={Server} label="EC2 Instances" value={serviceBreakdown.EC2 || 0} onClick={() => navigate("/ec2")} />
              <MetricCard icon={Database} label="RDS Databases" value={serviceBreakdown.RDS || 0} onClick={() => navigate("/rds")} />
              <MetricCard icon={Brain} label="Lambda Functions" value={serviceBreakdown.Lambda || 0} onClick={() => navigate("/lambda")} />
            </div>
          </section>

          <section className="mt-6 grid grid-cols-12 gap-4">
            <div className="col-span-12 xl:col-span-8 rounded-2xl border border-slate-800 bg-slate-900 p-5">
              <h3 className="text-2xl font-semibold">Cloud Spend Trend</h3>
              <p className="text-sm text-slate-400">AWS monthly unblended cost</p>
              <MiniLineChart points={costSeries} />
            </div>

            <div className="col-span-12 xl:col-span-4">
              <FindingsDonut
                findings={metrics.securityFindings || { critical: 0, high: 0, medium: 0, low: 0, informational: 0 }}
              />
            </div>
          </section>

          <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-2xl font-semibold">AWS Service Inventory</h3>
              <span className="text-xs text-slate-400">{resources.length} resources discovered</span>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="py-3 font-medium">Service</th>
                    <th className="py-3 font-medium">Count</th>
                    <th className="py-3 font-medium">Sample Type</th>
                  </tr>
                </thead>
                <tbody>
                  {resourceRows.length === 0 ? (
                    <tr>
                      <td className="py-4 text-slate-400" colSpan={3}>
                        No service resources found in current scan.
                      </td>
                    </tr>
                  ) : (
                    resourceRows.map((row) => {
                      const sample = resources.find((r) => r.service === row.service);
                      return (
                        <tr key={row.service} className="border-b border-slate-800/80">
                          <td className="py-3">
                            <div className="flex items-center gap-2">
                              <KeyRound className="h-4 w-4 text-indigo-300" />
                              {row.service}
                            </div>
                          </td>
                          <td className="py-3 font-semibold">{row.count}</td>
                          <td className="py-3 text-slate-300">{sample?.type || "-"}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
