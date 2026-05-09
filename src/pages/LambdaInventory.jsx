import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  ArrowLeft,
  Download,
  Search,
  ShieldAlert,
  Lock,
  Globe,
  ChartArea,
  Clock3,
  BadgeCheck,
  BadgeAlert,
  ChevronRight,
  RefreshCw,
  Filter,
  Zap,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import { useAWSConnection } from "../context/AWSConnectionContext.jsx";

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function formatMoney(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function badgeClass(kind) {
  if (kind === "critical") return "bg-rose-500/15 text-rose-300 border-rose-500/30";
  if (kind === "high") return "bg-orange-500/15 text-orange-300 border-orange-500/30";
  if (kind === "medium") return "bg-amber-500/15 text-amber-300 border-amber-500/30";
  if (kind === "low") return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
  return "bg-slate-700/60 text-slate-200 border-slate-600";
}

function severityKind(score) {
  if (score < 40) return "critical";
  if (score < 60) return "high";
  if (score < 80) return "medium";
  return "low";
}

function sparkPoints(values = [], width = 220, height = 70) {
  if (!values.length) return "";
  const points = values.filter((v) => v != null && !Number.isNaN(Number(v))).map(Number);
  if (!points.length) return "";
  const max = Math.max(...points);
  const min = Math.min(...points);
  const spread = Math.max(1, max - min);
  return points
    .map((value, index) => {
      const x = (index / Math.max(1, points.length - 1)) * width;
      const y = height - ((value - min) / spread) * height;
      return `${x},${y}`;
    })
    .join(" ");
}

function MiniChart({ values, color = "#60a5fa" }) {
  const pts = sparkPoints(values);
  return (
    <svg viewBox="0 0 220 70" className="h-[70px] w-full">
      {pts ? <polyline fill="none" stroke={color} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" points={pts} /> : null}
    </svg>
  );
}

function TabButton({ active, children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-3 py-2 text-sm transition ${active ? "bg-indigo-600/20 text-indigo-200" : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"}`}
    >
      {children}
    </button>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-slate-800/50 bg-slate-950/40 p-3">
      <span className="text-xs font-medium text-slate-400">{label}</span>
      <span className="max-w-[65%] text-right text-sm text-slate-200 break-all">{value}</span>
    </div>
  );
}

function SummaryCard({ label, value, accent }) {
  const accentClasses = {
    indigo: "border-indigo-500/30 bg-indigo-500/10 text-indigo-200",
    rose: "border-rose-500/30 bg-rose-500/10 text-rose-200",
    emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
    orange: "border-orange-500/30 bg-orange-500/10 text-orange-200",
    sky: "border-sky-500/30 bg-sky-500/10 text-sky-200",
  };
  return (
    <div className={`rounded-2xl border p-4 ${accentClasses[accent] || accentClasses.indigo}`}>
      <div className="text-xs font-medium opacity-80">{label}</div>
      <div className="mt-2 text-3xl font-bold">{value}</div>
    </div>
  );
}

export default function LambdaInventory() {
  const navigate = useNavigate();
  const { connectedRole } = useAWSConnection();
  const account = connectedRole || {};
  const roleArn = account.roleArn || "";
  const [functions, setFunctions] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [metrics, setMetrics] = useState({});
  const [activities, setActivities] = useState([]);
  const [security, setSecurity] = useState(null);
  const [search, setSearch] = useState("");
  const [regionFilter, setRegionFilter] = useState("all");
  const [runtimeFilter, setRuntimeFilter] = useState("all");
  const [riskFilter, setRiskFilter] = useState("all");
  const [triggerFilter, setTriggerFilter] = useState("all");
  const [publicFilter, setPublicFilter] = useState("all");
  const [sortKey, setSortKey] = useState("securityRiskScore");
  const [sortDir, setSortDir] = useState("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [activeTab, setActiveTab] = useState("General");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (roleArn) fetchFunctions();
  }, [roleArn, account.region]);

  useEffect(() => {
    if (!selected) return;
    fetchSelectedDetails(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  async function fetchFunctions() {
    setLoading(true);
    try {
      const resp = await axios.post("/api/aws/lambda", { roleArn, region: account.region });
      const items = resp.data.functions || [];
      setFunctions(items);
      if (items.length) setSelected(items[0].functionName);
      localStorage.setItem("awsLambdaFunctions", JSON.stringify(items));
    } catch (error) {
      console.error(error?.response?.data || error.message);
      setFunctions([]);
    } finally {
      setLoading(false);
    }
  }

  async function fetchSelectedDetails(functionName) {
    try {
      const [detailResp, metricsResp, activityResp, securityResp] = await Promise.all([
        axios.post(`/api/aws/lambda/${encodeURIComponent(functionName)}`, { roleArn, region: account.region }),
        axios.post(`/api/aws/lambda/${encodeURIComponent(functionName)}/metrics`, { roleArn, region: account.region }),
        axios.post(`/api/aws/lambda/${encodeURIComponent(functionName)}/activity`, { roleArn, region: account.region }),
        axios.post(`/api/aws/lambda/${encodeURIComponent(functionName)}/security`, { roleArn, region: account.region }),
      ]);
      setDetail(detailResp.data.detail || null);
      setMetrics(metricsResp.data.metrics || {});
      setActivities(activityResp.data.activities || []);
      setSecurity(securityResp.data.analysis || null);
    } catch (error) {
      console.error(error?.response?.data || error.message);
    }
  }

  const enrichedFunctions = useMemo(() => {
    return functions.map((fn) => ({
      ...fn,
      severityKind: severityKind(fn.securityRiskScore || 100),
      visibilityLabel: fn.publicFunctionUrl ? "Public" : "Private",
    }));
  }, [functions]);

  const filteredFunctions = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = enrichedFunctions.filter((fn) => {
      if (q && !`${fn.functionName} ${fn.runtime} ${fn.createdBy || ""} ${fn.handler || ""}`.toLowerCase().includes(q)) return false;
      if (regionFilter !== "all" && fn.region !== regionFilter) return false;
      if (runtimeFilter !== "all" && fn.runtime !== runtimeFilter) return false;
      if (riskFilter !== "all" && severityKind(fn.securityRiskScore || 100) !== riskFilter) return false;
      if (publicFilter !== "all") {
        if (publicFilter === "public" && !fn.publicFunctionUrl) return false;
        if (publicFilter === "private" && fn.publicFunctionUrl) return false;
      }
      if (triggerFilter !== "all") {
        const hasTrigger = (fn.triggers || []).some((trigger) => String(trigger || "").toLowerCase() === triggerFilter.toLowerCase());
        if (!hasTrigger) return false;
      }
      return true;
    });

    rows.sort((a, b) => {
      const aValue = a[sortKey];
      const bValue = b[sortKey];
      if (typeof aValue === "number" && typeof bValue === "number") {
        return sortDir === "asc" ? aValue - bValue : bValue - aValue;
      }
      return sortDir === "asc"
        ? String(aValue || "").localeCompare(String(bValue || ""))
        : String(bValue || "").localeCompare(String(aValue || ""));
    });

    return rows;
  }, [enrichedFunctions, search, regionFilter, runtimeFilter, riskFilter, triggerFilter, publicFilter, sortKey, sortDir]);

  useEffect(() => {
    setPage(1);
  }, [search, regionFilter, runtimeFilter, riskFilter, triggerFilter, publicFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredFunctions.length / pageSize));
  const pageStart = (page - 1) * pageSize;
  const pagedFunctions = filteredFunctions.slice(pageStart, pageStart + pageSize);

  const selectedFunction = detail || enrichedFunctions.find((fn) => fn.functionName === selected) || null;

  const summary = useMemo(() => {
    const total = enrichedFunctions.length;
    const publicCount = enrichedFunctions.filter((fn) => fn.publicFunctionUrl).length;
    const highRisk = enrichedFunctions.filter((fn) => ["critical", "high"].includes(fn.severityKind)).length;
    const monthlyCost = enrichedFunctions.reduce((sum, fn) => sum + Number(fn.cost?.estimatedMonthlyCost || 0), 0);
    return {
      total,
      publicCount,
      highRisk,
      monthlyCost,
      secureCount: enrichedFunctions.filter((fn) => fn.securitySeverity === "Low").length,
    };
  }, [enrichedFunctions]);

  if (!connectedRole) {
    return (
      <div className="min-h-screen bg-slate-950 text-white grid place-items-center p-6">
        <div className="max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center">
          <h1 className="text-2xl font-bold">No AWS account connected</h1>
          <p className="mt-2 text-sm text-slate-400">Reconnect AWS account to view Lambda inventory.</p>
          <button onClick={() => navigate("/")} className="mt-6 rounded-xl bg-indigo-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-indigo-400">
            Reconnect AWS account
          </button>
        </div>
      </div>
    );
  }

  function exportCsv() {
    const rows = filteredFunctions.map((fn) => ({
      functionName: fn.functionName,
      runtime: fn.runtime,
      region: fn.region,
      architecture: fn.architecture,
      memorySize: fn.memorySize,
      timeout: fn.timeout,
      invocationCount: fn.invocationCount,
      errorCount: fn.errorCount,
      successRate: Number(fn.successRate || 0).toFixed(2),
      throttles: fn.throttles,
      publicFunctionUrl: fn.publicFunctionUrl ? "Public" : "Private",
      securityRiskScore: fn.securityRiskScore,
      securitySeverity: fn.securitySeverity,
      estimatedMonthlyCost: Number(fn.cost?.estimatedMonthlyCost || 0).toFixed(4),
      lastModifiedTime: fn.lastModifiedTime,
    }));

    const headers = Object.keys(rows[0] || {});
    const csv = [
      headers.join(","),
      ...rows.map((row) => headers.map((h) => JSON.stringify(row[h] ?? "")).join(",")),
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `lambda-inventory-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const runtimeOptions = Array.from(new Set(enrichedFunctions.map((fn) => fn.runtime).filter(Boolean))).sort();
  const regionOptions = Array.from(new Set(enrichedFunctions.map((fn) => fn.region).filter(Boolean))).sort();
  const triggerOptions = Array.from(new Set(enrichedFunctions.flatMap((fn) => fn.triggers || []).filter(Boolean))).sort();

  return (
    <div className="min-h-screen bg-[#070d1d] text-slate-100">
      <div className="flex min-h-screen">
        <Sidebar active="lambda" accountId={account.accountId} region={account.region} />

        <main className="flex-1 px-7 py-5">
          <header className="flex items-center justify-between gap-4 border-b border-slate-800 pb-4">
            <button
              type="button"
              onClick={() => navigate("/dashboard")}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 transition hover:border-indigo-500/60 hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to dashboard
            </button>

            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span className="inline-flex items-center gap-1 rounded-full border border-slate-700 px-2 py-1">
                <Globe className="h-3.5 w-3.5" />
                {account.region || "us-east-1"}
              </span>
              <span className="inline-flex rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-emerald-300">
                {loading ? "Refreshing..." : "Live scan from connected account"}
              </span>
            </div>
          </header>

          <section className="mt-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-4xl font-bold tracking-tight">Lambda Inventory</h1>
                <p className="mt-1 text-slate-400">
                  Function-level serverless operations, security, activity, triggers, and cost intelligence.
                </p>
              </div>
              <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-3 py-2 text-sm text-indigo-200">
                {summary.total} functions
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-4 xl:grid-cols-5">
              <SummaryCard label="Functions" value={summary.total} accent="indigo" />
              <SummaryCard label="Public URLs" value={summary.publicCount} accent="rose" />
              <SummaryCard label="Secure" value={summary.secureCount} accent="emerald" />
              <SummaryCard label="High Risk" value={summary.highRisk} accent="orange" />
              <SummaryCard label="Est. Cost" value={formatMoney(summary.monthlyCost)} accent="sky" />
            </div>
          </section>

          <section className="mt-6 grid grid-cols-12 gap-4">
            <div className="col-span-12 xl:col-span-8 rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl shadow-slate-950/40">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-semibold">Lambda Functions</h2>
                  <p className="text-sm text-slate-400">Search, filter, sort, and open any function for full intelligence.</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={fetchFunctions}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 transition hover:border-indigo-500/60 hover:text-white"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Refresh
                  </button>
                  <button
                    type="button"
                    onClick={exportCsv}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 transition hover:border-indigo-500/60 hover:text-white"
                  >
                    <Download className="h-4 w-4" />
                    Export CSV
                  </button>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-6">
                <div className="xl:col-span-2">
                  <label className="relative block">
                    <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-500" />
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-indigo-500"
                      placeholder="Search function, runtime, owner..."
                    />
                  </label>
                </div>

                <select value={regionFilter} onChange={(e) => setRegionFilter(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-indigo-500">
                  <option value="all">All regions</option>
                  {regionOptions.map((region) => (
                    <option key={region} value={region}>{region}</option>
                  ))}
                </select>

                <select value={runtimeFilter} onChange={(e) => setRuntimeFilter(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-indigo-500">
                  <option value="all">All runtimes</option>
                  {runtimeOptions.map((runtime) => (
                    <option key={runtime} value={runtime}>{runtime}</option>
                  ))}
                </select>

                <select value={riskFilter} onChange={(e) => setRiskFilter(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-indigo-500">
                  <option value="all">All risk levels</option>
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>

                <select value={publicFilter} onChange={(e) => setPublicFilter(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-indigo-500">
                  <option value="all">All access</option>
                  <option value="public">Public</option>
                  <option value="private">Private</option>
                </select>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-4">
                <select value={triggerFilter} onChange={(e) => setTriggerFilter(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-indigo-500">
                  <option value="all">All trigger types</option>
                  {triggerOptions.map((trigger) => (
                    <option key={trigger} value={trigger}>{trigger}</option>
                  ))}
                </select>

                <div className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-300">
                  <Filter className="h-4 w-4 text-slate-500" />
                  Sort by
                </div>

                <select value={sortKey} onChange={(e) => setSortKey(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-indigo-500">
                  <option value="securityRiskScore">Risk</option>
                  <option value="functionName">Function name</option>
                  <option value="runtime">Runtime</option>
                  <option value="region">Region</option>
                  <option value="invocationCount">Invocations</option>
                  <option value="errorCount">Errors</option>
                  <option value="lastModifiedTime">Updated</option>
                </select>

                <button type="button" onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-200 transition hover:border-indigo-500">
                  {sortDir === "asc" ? "Ascending" : "Descending"}
                </button>
              </div>

              <div className="mt-4 overflow-auto rounded-xl border border-slate-800">
                <table className="min-w-full text-left text-sm">
                  <thead className="sticky top-0 z-10 bg-slate-950/95 text-slate-400 backdrop-blur">
                    <tr className="border-b border-slate-800">
                      <th className="px-3 py-3 font-medium">Function</th>
                      <th className="px-3 py-3 font-medium">Runtime</th>
                      <th className="px-3 py-3 font-medium">Region</th>
                      <th className="px-3 py-3 font-medium">Access</th>
                      <th className="px-3 py-3 font-medium">Invocations</th>
                      <th className="px-3 py-3 font-medium">Errors</th>
                      <th className="px-3 py-3 font-medium">Risk</th>
                      <th className="px-3 py-3 font-medium">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedFunctions.length === 0 ? (
                      <tr>
                        <td className="px-3 py-8 text-center text-slate-400" colSpan={8}>No functions match the current filters.</td>
                      </tr>
                    ) : (
                      pagedFunctions.map((fn) => {
                        const active = selected === fn.functionName;
                        return (
                          <tr
                            key={fn.functionName}
                            onClick={() => setSelected(fn.functionName)}
                            className={`cursor-pointer border-b border-slate-800/80 transition ${active ? "bg-indigo-500/10" : "hover:bg-slate-800/40"}`}
                          >
                            <td className="px-3 py-3">
                              <div className="font-medium text-slate-100">{fn.functionName}</div>
                              <div className="text-xs text-slate-500">{fn.handler}</div>
                            </td>
                            <td className="px-3 py-3">{fn.runtime || "-"}</td>
                            <td className="px-3 py-3">{fn.region || "-"}</td>
                            <td className="px-3 py-3">
                              <span className={`inline-flex rounded-full border px-2 py-1 text-xs ${fn.publicFunctionUrl ? "border-rose-500/30 bg-rose-500/15 text-rose-300" : "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"}`}>
                                {fn.publicFunctionUrl ? "Public" : "Private"}
                              </span>
                            </td>
                            <td className="px-3 py-3">{Number(fn.invocationCount || 0).toLocaleString()}</td>
                            <td className="px-3 py-3">{Number(fn.errorCount || 0).toLocaleString()}</td>
                            <td className="px-3 py-3">
                              <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-medium ${badgeClass(fn.severityKind)}`}>
                                {fn.securitySeverity || "Low"}
                              </span>
                            </td>
                            <td className="px-3 py-3">{formatDate(fn.lastModifiedTime)}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 flex items-center justify-between text-sm text-slate-400">
                <div>Showing {filteredFunctions.length === 0 ? 0 : pageStart + 1} to {Math.min(filteredFunctions.length, pageStart + pageSize)} of {filteredFunctions.length} functions</div>
                <div className="flex items-center gap-2">
                  <span>Rows</span>
                  <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-200">
                    <option value={10}>10</option>
                    <option value={20}>20</option>
                    <option value={50}>50</option>
                  </select>
                  <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} className="rounded-md border border-slate-700 px-2 py-1 disabled:opacity-40" disabled={page === 1}>Prev</button>
                  <span>{page}/{totalPages}</span>
                  <button type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} className="rounded-md border border-slate-700 px-2 py-1 disabled:opacity-40" disabled={page === totalPages}>Next</button>
                </div>
              </div>
            </div>

            <div className="col-span-12 xl:col-span-4 rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl shadow-slate-950/40">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-semibold">Function Intelligence</h2>
                  <p className="text-sm text-slate-400">Complete serverless profile for selected function</p>
                </div>
                {selectedFunction ? (
                  <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${badgeClass(severityKind(selectedFunction.securityRiskScore || 100))}`}>
                    {selectedFunction.securitySeverity || "Low"}
                  </span>
                ) : null}
              </div>

              {selectedFunction ? (
                <div className="mt-4">
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                    <div className="text-sm text-slate-400">Function</div>
                    <div className="mt-1 flex items-start justify-between gap-3">
                      <div>
                        <div className="text-xl font-semibold text-slate-100">{selectedFunction.functionName}</div>
                        <div className="text-xs text-slate-500 break-all">{selectedFunction.arn}</div>
                      </div>
                      <button onClick={() => navigator.clipboard?.writeText(selectedFunction.functionName)} className="rounded-lg border border-slate-700 p-2 text-slate-400 transition hover:text-white">
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {["General", "Networking", "Security", "Monitoring", "Logs", "Activity", "Findings", "Compliance", "Cost", "Triggers"].map((tab) => (
                      <TabButton key={tab} active={activeTab === tab} onClick={() => setActiveTab(tab)}>{tab}</TabButton>
                    ))}
                  </div>

                  <div className="mt-4 space-y-4 max-h-[800px] overflow-y-auto">
                    {activeTab === "General" && (
                      <div className="grid gap-3">
                        <InfoRow label="Function Name" value={selectedFunction.functionName} />
                        <InfoRow label="ARN" value={selectedFunction.arn} />
                        <InfoRow label="AWS Account ID" value={selectedFunction.awsAccountId || account.accountId || "-"} />
                        <InfoRow label="Region" value={selectedFunction.region} />
                        <InfoRow label="Runtime" value={selectedFunction.runtime} />
                        <InfoRow label="Runtime Version" value={selectedFunction.runtimeVersion} />
                        <InfoRow label="Handler" value={selectedFunction.handler} />
                        <InfoRow label="Description" value={selectedFunction.description || "-"} />
                        <InfoRow label="Architecture" value={selectedFunction.architecture} />
                        <InfoRow label="Memory Size" value={`${selectedFunction.memorySize || 0} MB`} />
                        <InfoRow label="Timeout" value={`${selectedFunction.timeout || 0} sec`} />
                        <InfoRow label="Ephemeral Storage" value={`${selectedFunction.ephemeralStorage || 0} MB`} />
                        <InfoRow label="Last Modified" value={formatDate(selectedFunction.lastModifiedTime)} />
                        <InfoRow label="Creation Time" value={formatDate(selectedFunction.creationTime)} />
                        <InfoRow label="Tags" value={(selectedFunction.tags || []).length ? selectedFunction.tags.map((t) => `${t.key}:${t.value}`).join(", ") : "-"} />
                        <InfoRow label="Function URL" value={selectedFunction.functionUrl || "Not configured"} />
                      </div>
                    )}

                    {activeTab === "Networking" && (
                      <div className="grid gap-3">
                        <InfoRow label="VPC Configuration" value={selectedFunction.vpcConfiguration ? "Enabled" : "Not configured"} />
                        <InfoRow label="Subnets" value={(selectedFunction.subnets || []).join(", ") || "-"} />
                        <InfoRow label="Security Groups" value={(selectedFunction.securityGroups || []).join(", ") || "-"} />
                        <InfoRow label="Internet Access" value={selectedFunction.internetAccess || "-"} />
                        <InfoRow label="Private/Public Access" value={selectedFunction.privatePublicAccess || "-"} />
                        <InfoRow label="API Gateway Integration" value={selectedFunction.apiGatewayIntegration ? "Detected" : "Not detected"} />
                        <InfoRow label="Event Sources" value={(selectedFunction.eventSources || []).map((s) => s.sourceType).join(", ") || "-"} />
                        <InfoRow label="Triggers" value={(selectedFunction.triggers || []).join(", ") || "-"} />
                        <InfoRow label="Connected Services" value={(selectedFunction.connectedServices || []).join(", ") || "-"} />
                      </div>
                    )}

                    {activeTab === "Security" && (
                      <div className="grid gap-3">
                        <InfoRow label="Execution IAM Role" value={selectedFunction.executionIamRole || "-"} />
                        <InfoRow label="Attached Permissions" value={[...(selectedFunction.attachedPermissions?.managedPolicies || []), ...(selectedFunction.attachedPermissions?.inlinePolicies || [])].join(", ") || "-"} />
                        <InfoRow label="Environment Variables" value={Object.keys(selectedFunction.environmentVariables || {}).length ? Object.keys(selectedFunction.environmentVariables || {}).join(", ") : "-"} />
                        <InfoRow label="KMS Encryption" value={selectedFunction.kmsEncryption || "Not configured"} />
                        <InfoRow label="Code Signing" value={selectedFunction.codeSigningStatus || "Disabled"} />
                        <InfoRow label="Public Function URL" value={selectedFunction.publicFunctionUrl ? "Detected" : "No"} />
                        <InfoRow label="Cross-account Access" value={selectedFunction.crossAccountAccess ? "Detected" : "No"} />
                        <InfoRow label="Secrets Exposure" value={selectedFunction.secretsExposureDetection ? `Detected (${(selectedFunction.exposedSecretKeys || []).join(", ")})` : "No"} />
                        <InfoRow label="Security Risk Score" value={`${selectedFunction.securityRiskScore || 0}/100`} />
                        <InfoRow label="Compliance Status" value={selectedFunction.complianceStatus?.status || "Unknown"} />
                      </div>
                    )}

                    {activeTab === "Monitoring" && (
                      <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-3 text-xs">
                          <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3"><div className="text-slate-400">Invocations</div><div className="mt-1 text-xl font-semibold">{Number(selectedFunction.invocationCount || 0).toLocaleString()}</div></div>
                          <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3"><div className="text-slate-400">Errors</div><div className="mt-1 text-xl font-semibold">{Number(selectedFunction.errorCount || 0).toLocaleString()}</div></div>
                          <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3"><div className="text-slate-400">Avg Duration</div><div className="mt-1 text-xl font-semibold">{Number(selectedFunction.avgDurationMs || 0).toFixed(1)} ms</div></div>
                          <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3"><div className="text-slate-400">Concurrency</div><div className="mt-1 text-xl font-semibold">{Number(selectedFunction.concurrentExecutions || 0).toLocaleString()}</div></div>
                          <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3"><div className="text-slate-400">Throttles</div><div className="mt-1 text-xl font-semibold">{Number(selectedFunction.throttles || 0).toLocaleString()}</div></div>
                          <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3"><div className="text-slate-400">Success Rate</div><div className="mt-1 text-xl font-semibold">{Number(selectedFunction.successRate || 100).toFixed(2)}%</div></div>
                        </div>

                        <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                          <div className="text-xs text-slate-400">Invocation trend</div>
                          <MiniChart values={metrics.invocations?.values || selectedFunction.performanceTrends?.invocations || []} color="#60a5fa" />
                        </div>
                        <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                          <div className="text-xs text-slate-400">Error trend</div>
                          <MiniChart values={metrics.errors?.values || selectedFunction.performanceTrends?.errors || []} color="#f97316" />
                        </div>
                        <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                          <div className="text-xs text-slate-400">Duration trend</div>
                          <MiniChart values={metrics.duration?.values || selectedFunction.performanceTrends?.duration || []} color="#22c55e" />
                        </div>
                      </div>
                    )}

                    {activeTab === "Logs" && (
                      <div className="space-y-3">
                        <InfoRow label="Log Group" value={selectedFunction.cloudWatchLogs?.logGroupName || "-"} />
                        <InfoRow label="Recent Streams" value={String((selectedFunction.cloudWatchLogs?.recentStreams || []).length)} />
                        <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                          <div className="mb-2 text-xs text-slate-400">Recent log lines</div>
                          {(selectedFunction.cloudWatchLogs?.recentEvents || []).length ? (
                            <div className="max-h-64 space-y-2 overflow-y-auto text-xs text-slate-300">
                              {(selectedFunction.cloudWatchLogs?.recentEvents || []).map((event, index) => (
                                <div key={`${event.timestamp}-${index}`} className="rounded border border-slate-800 p-2">
                                  <div className="text-slate-500">{formatDate(event.timestamp)}</div>
                                  <div className="mt-1 whitespace-pre-wrap break-all">{event.message}</div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="text-sm text-slate-400">No log events available.</div>
                          )}
                        </div>
                      </div>
                    )}

                    {activeTab === "Activity" && (
                      <div className="space-y-3">
                        <InfoRow label="Created By" value={selectedFunction.createdBy || "-"} />
                        <InfoRow label="Source IP" value={selectedFunction.sourceIp || "-"} />
                        <InfoRow label="Event Name" value={selectedFunction.eventName || "-"} />
                        <InfoRow label="Event Time" value={formatDate(selectedFunction.eventTime)} />
                        <InfoRow label="Last Modified By" value={selectedFunction.lastModifiedBy || "-"} />
                        <InfoRow label="Assumed Role" value={selectedFunction.assumedRole || "-"} />
                        <InfoRow label="User Agent" value={selectedFunction.userAgent || "-"} />

                        <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                          <div className="mb-2 text-xs text-slate-400">Activity timeline</div>
                          <div className="max-h-64 space-y-2 overflow-y-auto">
                            {(activities || []).slice(0, 25).map((event) => (
                              <div key={event.eventId || `${event.eventName}-${event.eventTime}`} className="rounded border border-slate-800 p-2">
                                <div className="flex items-center justify-between gap-2 text-xs">
                                  <span className="font-medium text-slate-200">{event.eventName}</span>
                                  <span className="text-slate-500">{formatDate(event.eventTime)}</span>
                                </div>
                                <div className="mt-1 text-xs text-slate-400">{event.username || "Unknown actor"} • {event.sourceIp || "-"}</div>
                              </div>
                            ))}
                            {!activities?.length ? <div className="text-sm text-slate-400">No activity events found.</div> : null}
                          </div>
                        </div>
                      </div>
                    )}

                    {activeTab === "Findings" && (
                      <div className="space-y-3">
                        {(selectedFunction.findings || security?.findings || []).length ? (
                          (selectedFunction.findings || security?.findings || []).map((finding) => (
                            <div key={finding} className="flex items-start gap-3 rounded-xl border border-orange-500/25 bg-orange-500/10 p-3">
                              <BadgeAlert className="mt-0.5 h-4 w-4 text-orange-300" />
                              <div className="text-sm text-orange-100">{finding}</div>
                            </div>
                          ))
                        ) : (
                          <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-3 text-sm text-emerald-200">No active findings detected.</div>
                        )}
                      </div>
                    )}

                    {activeTab === "Compliance" && (
                      <div className="space-y-3">
                        <InfoRow label="Status" value={selectedFunction.complianceStatus?.status || "Unknown"} />
                        <InfoRow label="Compliant" value={selectedFunction.complianceStatus?.compliant ? "Yes" : "No"} />
                        <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                          <div className="mb-2 text-xs text-slate-400">Violations</div>
                          {(selectedFunction.complianceStatus?.violations || []).length ? (
                            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-200">
                              {selectedFunction.complianceStatus.violations.map((item) => (
                                <li key={item}>{item}</li>
                              ))}
                            </ul>
                          ) : (
                            <div className="text-sm text-emerald-300">No compliance violations detected.</div>
                          )}
                        </div>
                      </div>
                    )}

                    {activeTab === "Cost" && (
                      <div className="space-y-3">
                        <InfoRow label="Estimated Monthly Cost" value={formatMoney(selectedFunction.cost?.estimatedMonthlyCost)} />
                        <InfoRow label="Invocation Cost" value={formatMoney(selectedFunction.cost?.invocationCost)} />
                        <InfoRow label="Duration Cost" value={formatMoney(selectedFunction.cost?.durationCost)} />
                        <InfoRow label="Request Cost" value={formatMoney(selectedFunction.cost?.requestCost)} />
                        <InfoRow label="Provisioned Concurrency Cost" value={formatMoney(selectedFunction.cost?.provisionedConcurrencyCost)} />
                        <InfoRow label="Idle Function Detection" value={selectedFunction.idleFunctionDetection ? "Potentially idle" : "Active"} />
                        <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                          <div className="mb-2 text-xs text-slate-400">Optimization suggestions</div>
                          {(selectedFunction.cost?.costOptimizationSuggestions || []).length ? (
                            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-200">
                              {selectedFunction.cost.costOptimizationSuggestions.map((item) => (
                                <li key={item}>{item}</li>
                              ))}
                            </ul>
                          ) : (
                            <div className="text-sm text-slate-400">No suggestions at this time.</div>
                          )}
                        </div>
                      </div>
                    )}

                    {activeTab === "Triggers" && (
                      <div className="space-y-3">
                        <InfoRow label="Trigger Count" value={String((selectedFunction.eventSources || []).length)} />
                        <InfoRow label="Connected Services" value={(selectedFunction.connectedServices || []).join(", ") || "-"} />
                        <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                          <div className="mb-2 text-xs text-slate-400">Trigger mappings</div>
                          {(selectedFunction.eventSources || []).length ? (
                            <div className="space-y-2">
                              {(selectedFunction.eventSources || []).map((source) => (
                                <div key={source.uuid || source.eventSourceArn} className="rounded border border-slate-800 p-2">
                                  <div className="text-sm text-slate-200">{source.sourceType}</div>
                                  <div className="mt-1 text-xs text-slate-500 break-all">{source.eventSourceArn}</div>
                                  <div className="mt-1 text-xs text-slate-400">State: {source.state || "Unknown"}</div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="text-sm text-slate-400">No event source mappings found.</div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="mt-8 rounded-xl border border-slate-800 bg-slate-950/40 p-4 text-sm text-slate-400">
                  Select a function to view its intelligence profile.
                </div>
              )}
            </div>
          </section>

          <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <h3 className="text-xl font-semibold text-slate-100">Serverless Health Highlights</h3>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4">
              <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                <div className="text-xs text-slate-400">Erroring functions</div>
                <div className="mt-1 text-2xl font-bold text-rose-300">{enrichedFunctions.filter((fn) => Number(fn.errorCount || 0) > 0).length}</div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                <div className="text-xs text-slate-400">Throttled functions</div>
                <div className="mt-1 text-2xl font-bold text-amber-300">{enrichedFunctions.filter((fn) => Number(fn.throttles || 0) > 0).length}</div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                <div className="text-xs text-slate-400">Public URL exposure</div>
                <div className="mt-1 text-2xl font-bold text-orange-300">{enrichedFunctions.filter((fn) => fn.publicFunctionUrl).length}</div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                <div className="text-xs text-slate-400">Compliant functions</div>
                <div className="mt-1 text-2xl font-bold text-emerald-300">{enrichedFunctions.filter((fn) => fn.complianceStatus?.compliant).length}</div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-400">
              <span className="inline-flex items-center gap-1 rounded-full border border-slate-700 px-2 py-1"><ChartArea className="h-3.5 w-3.5" />CloudWatch trends</span>
              <span className="inline-flex items-center gap-1 rounded-full border border-slate-700 px-2 py-1"><ShieldAlert className="h-3.5 w-3.5" />Risk scoring</span>
              <span className="inline-flex items-center gap-1 rounded-full border border-slate-700 px-2 py-1"><Clock3 className="h-3.5 w-3.5" />CloudTrail attribution</span>
              <span className="inline-flex items-center gap-1 rounded-full border border-slate-700 px-2 py-1"><Zap className="h-3.5 w-3.5" />Trigger intelligence</span>
              <span className="inline-flex items-center gap-1 rounded-full border border-slate-700 px-2 py-1"><Lock className="h-3.5 w-3.5" />Security posture</span>
              <span className="inline-flex items-center gap-1 rounded-full border border-slate-700 px-2 py-1"><BadgeCheck className="h-3.5 w-3.5" />Compliance checks</span>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
