import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  ArrowLeft,
  Download,
  Search,
  ShieldAlert,
  Lock,
  Globe,
  Server,
  ChartArea,
  Clock3,
  BadgeCheck,
  BadgeAlert,
  ChevronRight,
  RefreshCw,
  Filter,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import { useAWSConnection } from "../context/AWSConnectionContext.jsx";

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function formatBytes(bytes) {
  if (bytes == null || Number.isNaN(Number(bytes))) return "-";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let value = Number(bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
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
      <span className="text-right text-sm text-slate-200">{value}</span>
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

export default function RDSInventory() {
  const navigate = useNavigate();
  const { connectedRole } = useAWSConnection();
  const account = connectedRole || {};
  const roleArn = account.roleArn || "";
  const [databases, setDatabases] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [metrics, setMetrics] = useState({});
  const [activities, setActivities] = useState([]);
  const [security, setSecurity] = useState(null);
  const [search, setSearch] = useState("");
  const [regionFilter, setRegionFilter] = useState("all");
  const [engineFilter, setEngineFilter] = useState("all");
  const [riskFilter, setRiskFilter] = useState("all");
  const [publicFilter, setPublicFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortKey, setSortKey] = useState("securityRiskScore");
  const [sortDir, setSortDir] = useState("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [activeTab, setActiveTab] = useState("General");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (roleArn) fetchDatabases();
  }, [roleArn, account.region]);

  useEffect(() => {
    if (!selected) return;
    fetchSelectedDetails(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  async function fetchDatabases() {
    setLoading(true);
    try {
      const resp = await axios.post("/api/aws/rds", { roleArn, region: account.region });
      const items = resp.data.databases || [];
      setDatabases(items);
      if (items.length) setSelected(items[0].dbInstanceIdentifier);
      localStorage.setItem("awsRDSDatabases", JSON.stringify(items));
    } catch (error) {
      console.error(error?.response?.data || error.message);
      setDatabases([]);
    } finally {
      setLoading(false);
    }
  }

  async function fetchSelectedDetails(dbId) {
    try {
      const [detailResp, metricsResp, activityResp, securityResp] = await Promise.all([
        axios.post(`/api/aws/rds/${dbId}`, { roleArn, region: account.region }),
        axios.post(`/api/aws/rds/${dbId}/metrics`, { roleArn, region: account.region }),
        axios.post(`/api/aws/rds/${dbId}/activity`, { roleArn, region: account.region }),
        axios.post(`/api/aws/rds/${dbId}/security`, { roleArn, region: account.region }),
      ]);
      setDetail(detailResp.data.detail || null);
      setMetrics(metricsResp.data.metrics || {});
      setActivities(activityResp.data.activities || []);
      setSecurity(securityResp.data.analysis || null);
    } catch (error) {
      console.error(error?.response?.data || error.message);
    }
  }

  const enrichedDatabases = useMemo(() => {
    return databases.map((db) => {
      const sev = severityKind(db.securityRiskScore || 100);
      return {
        ...db,
        severityKind: sev,
        publicLabel: db.publiclyAccessible ? "Public" : "Private",
        encryptionLabel: db.storageEncrypted ? "Encrypted" : "Unencrypted",
      };
    });
  }, [databases]);

  const filteredDatabases = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = enrichedDatabases.filter((db) => {
      if (q && !`${db.dbInstanceIdentifier} ${db.engine} ${db.createdBy || ""}`.toLowerCase().includes(q)) return false;
      if (regionFilter !== "all" && db.region !== regionFilter) return false;
      if (engineFilter !== "all" && db.engine !== engineFilter) return false;
      if (riskFilter !== "all" && severityKind(db.securityRiskScore || 100) !== riskFilter) return false;
      if (publicFilter !== "all") {
        const isPublic = Boolean(db.publiclyAccessible);
        if ((publicFilter === "public" && !isPublic) || (publicFilter === "private" && isPublic)) return false;
      }
      if (statusFilter !== "all" && db.dbInstanceStatus !== statusFilter) return false;
      return true;
    });

    rows.sort((a, b) => {
      const aValue = a[sortKey];
      const bValue = b[sortKey];
      const direction = sortDir === "asc" ? 1 : -1;
      if (sortKey === "creationTime") {
        return (new Date(aValue || 0) - new Date(bValue || 0)) * direction;
      }
      if (typeof aValue === "number" || typeof bValue === "number") {
        return ((Number(aValue) || 0) - (Number(bValue) || 0)) * direction;
      }
      return String(aValue || "").localeCompare(String(bValue || "")) * direction;
    });

    return rows;
  }, [enrichedDatabases, search, regionFilter, engineFilter, riskFilter, publicFilter, statusFilter, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filteredDatabases.length / pageSize));
  const pagedDatabases = filteredDatabases.slice((page - 1) * pageSize, page * pageSize);
  const selectedDatabase = detail || enrichedDatabases.find((db) => db.dbInstanceIdentifier === selected) || null;

  useEffect(() => {
    setPage(1);
  }, [search, regionFilter, engineFilter, riskFilter, publicFilter, statusFilter, sortKey, sortDir, pageSize]);

  function exportCSV() {
    const cols = ["dbInstanceIdentifier", "arn", "engine", "dbInstanceClass", "dbInstanceStatus", "region", "endpoint", "port", "allocatedStorage", "multiAZ", "publiclyAccessible", "storageEncrypted", "securityRiskScore", "securitySeverity"];
    const rows = [cols.join(",")].concat(
      filteredDatabases.map((db) => cols.map((col) => `"${String(db[col] ?? "").replace(/"/g, '""')}"`).join(","))
    );
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `rds-inventory-${new Date().toISOString()}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const overview = useMemo(() => {
    const total = enrichedDatabases.length;
    const publicDatabases = enrichedDatabases.filter((db) => db.publiclyAccessible).length;
    const encryptedDatabases = enrichedDatabases.filter((db) => db.storageEncrypted).length;
    const highRisk = enrichedDatabases.filter((db) => severityKind(db.securityRiskScore || 100) === "high" || severityKind(db.securityRiskScore || 100) === "critical").length;
    const estimatedCost = enrichedDatabases.reduce((sum, db) => sum + Number(db.cost?.estimatedMonthlyCost || 0), 0);
    return { total, publicDatabases, encryptedDatabases, highRisk, estimatedCost };
  }, [enrichedDatabases]);

  const metricSeries = useMemo(() => {
    return {
      cpu: metrics.cpu?.values || [],
      memory: metrics.memory?.values || [],
      connections: metrics.connections?.values || [],
      freeStorage: metrics.freeStorage?.values || [],
      readIOPS: metrics.readIOPS?.values || [],
      writeIOPS: metrics.writeIOPS?.values || [],
      readThroughput: metrics.readThroughput?.values || [],
      writeThroughput: metrics.writeThroughput?.values || [],
    };
  }, [metrics]);

  const activityTimeline = (detail?.activityTimeline || activities || []).slice(0, 20);
  const detections = detail?.detections || [];
  const complianceViolations = detail?.complianceStatus?.violations || [];
  const cost = detail?.cost || null;

  if (!connectedRole) {
    return (
      <div className="min-h-screen bg-slate-950 text-white grid place-items-center p-6">
        <div className="max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center">
          <h1 className="text-2xl font-bold">No AWS account connected</h1>
          <p className="mt-2 text-sm text-slate-400">Reconnect AWS account to view RDS inventory.</p>
          <button onClick={() => navigate("/")} className="mt-6 rounded-xl bg-indigo-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-indigo-400">
            Reconnect AWS account
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#070d1d] text-slate-100">
      <div className="flex min-h-screen">
        <Sidebar active="rds" accountId={account.accountId} region={account.region} />

        <main className="flex-1 px-7 py-5">
          <header className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div>
              <button onClick={() => navigate("/dashboard")} className="inline-flex items-center gap-2 text-sm text-slate-300 transition hover:text-white">
                <ArrowLeft className="h-4 w-4" /> Back to dashboard
              </button>
              <div className="mt-3 flex items-center gap-3">
                <div className="rounded-2xl border border-indigo-500/30 bg-indigo-500/10 p-3 text-indigo-200">
                  <Server className="h-7 w-7" />
                </div>
                <div>
                  <h1 className="text-4xl font-bold tracking-tight">RDS Databases</h1>
                  <p className="mt-1 text-slate-400">Database intelligence, security analysis, activity, and cost view for the connected AWS account</p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm text-slate-300">
              <div className="flex items-center gap-2 text-slate-400">
                <Globe className="h-4 w-4" /> {account.region || "us-east-1"}
              </div>
              <div className="mt-1 text-lg font-semibold">{overview.total} databases</div>
              <div className="text-xs text-slate-500">{loading ? "Refreshing..." : "Live scan from connected account"}</div>
            </div>
          </header>

          <section className="mt-6 grid grid-cols-2 gap-4 xl:grid-cols-5">
            <SummaryCard label="Databases" value={overview.total} accent="indigo" />
            <SummaryCard label="Public" value={overview.publicDatabases} accent="rose" />
            <SummaryCard label="Encrypted" value={overview.encryptedDatabases} accent="emerald" />
            <SummaryCard label="High Risk" value={overview.highRisk} accent="orange" />
            <SummaryCard label="Est. Cost" value={formatMoney(overview.estimatedCost)} accent="sky" />
          </section>

          <section className="mt-6 grid grid-cols-12 gap-4">
            <div className="col-span-12 xl:col-span-8 rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl shadow-slate-950/40">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-semibold">RDS Instances</h2>
                  <p className="text-sm text-slate-400">Search, filter, sort, and open any database for a full intelligence view.</p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={fetchDatabases} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-300 transition hover:bg-slate-800">
                    <RefreshCw className="h-4 w-4" /> Refresh
                  </button>
                  <button onClick={exportCSV} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-emerald-500">
                    <Download className="h-4 w-4" /> Export CSV
                  </button>
                </div>
              </div>

              <div className="mt-4 grid gap-3 xl:grid-cols-5">
                <div className="relative xl:col-span-2">
                  <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-500" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search databases, engines..."
                    className="w-full rounded-xl border border-slate-700 bg-slate-950/60 py-3 pl-10 pr-3 text-sm outline-none transition focus:border-indigo-500"
                  />
                </div>
                <select value={regionFilter} onChange={(event) => setRegionFilter(event.target.value)} className="rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-3 text-sm text-slate-200 outline-none">
                  <option value="all">All regions</option>
                  {[...new Set(enrichedDatabases.map((db) => db.region).filter(Boolean))].map((region) => (
                    <option key={region} value={region}>{region}</option>
                  ))}
                </select>
                <select value={engineFilter} onChange={(event) => setEngineFilter(event.target.value)} className="rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-3 text-sm text-slate-200 outline-none">
                  <option value="all">All engines</option>
                  {[...new Set(enrichedDatabases.map((db) => db.engine).filter(Boolean))].map((engine) => (
                    <option key={engine} value={engine}>{engine}</option>
                  ))}
                </select>
                <select value={riskFilter} onChange={(event) => setRiskFilter(event.target.value)} className="rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-3 text-sm text-slate-200 outline-none">
                  <option value="all">All risk levels</option>
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
                <select value={publicFilter} onChange={(event) => setPublicFilter(event.target.value)} className="rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-3 text-sm text-slate-200 outline-none">
                  <option value="all">All exposure</option>
                  <option value="private">Private</option>
                  <option value="public">Public</option>
                </select>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-slate-400">
                <div className="flex items-center gap-2 rounded-full border border-slate-700 bg-slate-950/60 px-3 py-2">
                  <Filter className="h-4 w-4" />
                  <span>Sort by</span>
                </div>
                <select value={sortKey} onChange={(event) => setSortKey(event.target.value)} className="rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2 text-slate-200 outline-none">
                  <option value="securityRiskScore">Risk</option>
                  <option value="dbInstanceIdentifier">Database ID</option>
                  <option value="engine">Engine</option>
                  <option value="region">Region</option>
                  <option value="creationTime">Created</option>
                  <option value="allocatedStorage">Storage</option>
                </select>
                <button onClick={() => setSortDir(sortDir === "asc" ? "desc" : "asc")} className="rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2 text-slate-200 transition hover:bg-slate-800">
                  {sortDir === "asc" ? "Ascending" : "Descending"}
                </button>
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-slate-500">Rows</span>
                  <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))} className="rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2 text-slate-200 outline-none">
                    {[10, 20, 50].map((size) => <option key={size} value={size}>{size}</option>)}
                  </select>
                </div>
              </div>

              <div className="mt-5 overflow-hidden rounded-2xl border border-slate-800">
                <div className="max-h-[640px] overflow-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="sticky top-0 z-10 bg-slate-900">
                      <tr className="border-b border-slate-800 text-slate-400">
                        <th className="px-4 py-3 font-medium">Database ID</th>
                        <th className="px-4 py-3 font-medium">Engine</th>
                        <th className="px-4 py-3 font-medium">Class</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 font-medium">Region</th>
                        <th className="px-4 py-3 font-medium">Public/Private</th>
                        <th className="px-4 py-3 font-medium">Encryption</th>
                        <th className="px-4 py-3 font-medium">Risk</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedDatabases.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="px-4 py-10 text-center text-slate-400">No databases match the current filters.</td>
                        </tr>
                      ) : (
                        pagedDatabases.map((db) => (
                          <tr
                            key={db.dbInstanceIdentifier}
                            onClick={() => setSelected(db.dbInstanceIdentifier)}
                            className={`group cursor-pointer border-b border-slate-800/70 transition hover:bg-slate-800/50 ${selected === db.dbInstanceIdentifier ? "bg-slate-800/60" : ""}`}
                          >
                            <td className="px-4 py-4 align-top">
                              <div className="font-medium text-slate-100">{db.dbInstanceIdentifier}</div>
                              <div className="mt-1 text-xs text-slate-500">{db.arn ? db.arn.split(":").pop() : "Unknown"}</div>
                            </td>
                            <td className="px-4 py-4 align-top text-slate-300 font-medium">{db.engine || "-"}</td>
                            <td className="px-4 py-4 align-top text-slate-300">{db.dbInstanceClass || "-"}</td>
                            <td className="px-4 py-4 align-top">
                              <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${db.dbInstanceStatus === "available" ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300" : "border-amber-500/30 bg-amber-500/15 text-amber-300"}`}>
                                {db.dbInstanceStatus || "Unknown"}
                              </span>
                            </td>
                            <td className="px-4 py-4 align-top text-slate-300">{db.region || "-"}</td>
                            <td className="px-4 py-4 align-top">
                              <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${db.publiclyAccessible ? "border-rose-500/30 bg-rose-500/15 text-rose-300" : "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"}`}>
                                {db.publiclyAccessible ? "Public" : "Private"}
                              </span>
                            </td>
                            <td className="px-4 py-4 align-top text-slate-300">{db.storageEncrypted ? "Encrypted" : "Unencrypted"}</td>
                            <td className="px-4 py-4 align-top">
                              <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${badgeClass(db.severityKind)}`}>{db.securitySeverity || "Low"}</span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between text-sm text-slate-400">
                <div>
                  Showing {pagedDatabases.length} of {filteredDatabases.length} databases
                </div>
                <div className="flex items-center gap-2">
                  <button disabled={page === 1} onClick={() => setPage((current) => Math.max(1, current - 1))} className="rounded-lg border border-slate-700 px-3 py-2 text-slate-200 disabled:opacity-40">Previous</button>
                  <span className="rounded-lg border border-slate-700 px-3 py-2">Page {page} of {totalPages}</span>
                  <button disabled={page === totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))} className="rounded-lg border border-slate-700 px-3 py-2 text-slate-200 disabled:opacity-40">Next</button>
                </div>
              </div>
            </div>

            <div className="col-span-12 xl:col-span-4 rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl shadow-slate-950/40">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-semibold">Database Intelligence</h2>
                  <p className="text-sm text-slate-400">Deep detail for the selected database</p>
                </div>
                {selectedDatabase ? <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${badgeClass(severityKind(selectedDatabase.securityRiskScore || 100))}`}>{selectedDatabase.securitySeverity || "Low"}</span> : null}
              </div>

              {selectedDatabase ? (
                <div className="mt-4">
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                    <div className="text-sm text-slate-400">Database Identifier</div>
                    <div className="mt-1 flex items-start justify-between gap-3">
                      <div>
                        <div className="text-xl font-semibold text-slate-100">{selectedDatabase.dbInstanceIdentifier}</div>
                        <div className="text-xs text-slate-500">{selectedDatabase.arn}</div>
                      </div>
                      <button onClick={() => navigator.clipboard?.writeText(selectedDatabase.dbInstanceIdentifier)} className="rounded-lg border border-slate-700 p-2 text-slate-400 transition hover:text-white">
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {[
                      "General",
                      "Networking",
                      "Security",
                      "Monitoring",
                      "Activity",
                      "Findings",
                      "Compliance",
                      "Cost",
                      "Backups",
                    ].map((tab) => (
                      <TabButton key={tab} active={activeTab === tab} onClick={() => setActiveTab(tab)}>{tab}</TabButton>
                    ))}
                  </div>

                  <div className="mt-4 space-y-4 max-h-[800px] overflow-y-auto">
                    {activeTab === "General" && (
                      <div className="grid gap-3">
                        <InfoRow label="ARN" value={selectedDatabase.arn} />
                        <InfoRow label="AWS Account ID" value={selectedDatabase.accountId} />
                        <InfoRow label="Region" value={selectedDatabase.region} />
                        <InfoRow label="Availability Zone" value={selectedDatabase.availabilityZone} />
                        <InfoRow label="Engine" value={selectedDatabase.engine} />
                        <InfoRow label="Engine Version" value={selectedDatabase.engineVersion} />
                        <InfoRow label="Instance Class" value={selectedDatabase.dbInstanceClass} />
                        <InfoRow label="Status" value={selectedDatabase.dbInstanceStatus} />
                        <InfoRow label="Endpoint" value={selectedDatabase.endpoint || "-"} />
                        <InfoRow label="Port" value={selectedDatabase.port} />
                        <InfoRow label="Storage Type" value={selectedDatabase.storageType} />
                        <InfoRow label="Allocated Storage" value={`${selectedDatabase.allocatedStorage} GB`} />
                        <InfoRow label="Creation Time" value={formatDate(selectedDatabase.creationTime)} />
                        <InfoRow label="Multi-AZ" value={selectedDatabase.multiAZ ? "Enabled" : "Disabled"} />
                        <InfoRow label="Read Replicas" value={selectedDatabase.readReplicas?.length || 0} />
                      </div>
                    )}

                    {activeTab === "Networking" && (
                      <div className="grid gap-3">
                        <InfoRow label="VPC ID" value={selectedDatabase.vpcId || "-"} />
                        <InfoRow label="Subnet Group" value={selectedDatabase.subnetGroup || "-"} />
                        <InfoRow label="Publicly Accessible" value={selectedDatabase.publiclyAccessible ? "Yes" : "No"} />
                        <InfoRow label="Security Groups" value={selectedDatabase.securityGroups?.length || 0} />
                        {(selectedDatabase.securityGroups || []).map((sg, idx) => (
                          <InfoRow key={idx} label={`SG ${idx + 1}`} value={`${sg.id} (${sg.status})`} />
                        ))}
                      </div>
                    )}

                    {activeTab === "Security" && (
                      <div className="grid gap-3">
                        <InfoRow label="Storage Encryption" value={selectedDatabase.storageEncrypted ? "Enabled" : "Disabled"} />
                        <InfoRow label="KMS Key ID" value={selectedDatabase.kmsKeyId || "-"} />
                        <InfoRow label="IAM Database Auth" value={selectedDatabase.iamDatabaseAuthenticationEnabled ? "Enabled" : "Disabled"} />
                        <InfoRow label="Backup Enabled" value={selectedDatabase.backupRetentionPeriod ? "Yes" : "No"} />
                        <InfoRow label="Backup Retention Days" value={selectedDatabase.backupRetentionPeriod || 0} />
                        <InfoRow label="Deletion Protection" value={selectedDatabase.deletionProtection ? "Enabled" : "Disabled"} />
                        <InfoRow label="CloudWatch Logs" value={(selectedDatabase.enableCloudwatchLogsExports || []).join(", ") || "None"} />
                        <InfoRow label="Security Risk Score" value={`${selectedDatabase.securityRiskScore}/100`} />
                        <InfoRow label="Severity" value={selectedDatabase.securitySeverity || "Low"} />
                      </div>
                    )}

                    {activeTab === "Monitoring" && (
                      <div className="grid gap-3">
                        <div className="rounded-xl border border-slate-800/50 bg-slate-950/40 p-3">
                          <div className="text-xs font-medium text-slate-400">CPU Utilization (%)</div>
                          <MiniChart values={metricSeries.cpu} color="#f59e0b" />
                        </div>
                        <div className="rounded-xl border border-slate-800/50 bg-slate-950/40 p-3">
                          <div className="text-xs font-medium text-slate-400">Memory Usage (%)</div>
                          <MiniChart values={metricSeries.memory} color="#8b5cf6" />
                        </div>
                        <div className="rounded-xl border border-slate-800/50 bg-slate-950/40 p-3">
                          <div className="text-xs font-medium text-slate-400">Active Connections</div>
                          <MiniChart values={metricSeries.connections} color="#06b6d4" />
                        </div>
                        <div className="rounded-xl border border-slate-800/50 bg-slate-950/40 p-3">
                          <div className="text-xs font-medium text-slate-400">Free Storage (GB)</div>
                          <MiniChart values={metricSeries.freeStorage?.map((v) => (Number(v) || 0) / (1024 * 1024 * 1024))} color="#10b981" />
                        </div>
                        <div className="rounded-xl border border-slate-800/50 bg-slate-950/40 p-3">
                          <div className="text-xs font-medium text-slate-400">Read IOPS</div>
                          <MiniChart values={metricSeries.readIOPS} color="#3b82f6" />
                        </div>
                        <div className="rounded-xl border border-slate-800/50 bg-slate-950/40 p-3">
                          <div className="text-xs font-medium text-slate-400">Write IOPS</div>
                          <MiniChart values={metricSeries.writeIOPS} color="#ec4899" />
                        </div>
                      </div>
                    )}

                    {activeTab === "Activity" && (
                      <div className="space-y-2">
                        {activityTimeline.length === 0 ? (
                          <div className="rounded-xl border border-slate-800/50 bg-slate-950/40 p-4 text-center text-sm text-slate-400">No activity found</div>
                        ) : (
                          activityTimeline.map((event, idx) => (
                            <div key={idx} className="rounded-xl border border-slate-800/50 bg-slate-950/40 p-3 text-xs">
                              <div className="font-medium text-slate-200">{event.eventName}</div>
                              <div className="mt-1 text-slate-500">{event.username || "Unknown"} at {formatDate(event.eventTime)}</div>
                            </div>
                          ))
                        )}
                      </div>
                    )}

                    {activeTab === "Findings" && (
                      <div className="space-y-2">
                        {detections.length === 0 ? (
                          <div className="rounded-xl border border-slate-800/50 bg-slate-950/40 p-4 text-center text-sm text-slate-400">No findings detected</div>
                        ) : (
                          detections.map((finding, idx) => (
                            <div key={idx} className="flex items-start gap-3 rounded-xl border border-orange-500/30 bg-orange-500/10 p-3">
                              <BadgeAlert className="h-4 w-4 mt-1 text-orange-400 flex-shrink-0" />
                              <div className="text-sm text-orange-200">{finding}</div>
                            </div>
                          ))
                        )}
                      </div>
                    )}

                    {activeTab === "Compliance" && (
                      <div className="grid gap-3">
                        <InfoRow label="Status" value={selectedDatabase.complianceStatus?.status || "Unknown"} />
                        {(complianceViolations || []).length > 0 && (
                          <div className="space-y-2">
                            <div className="text-xs font-medium text-slate-400">Violations</div>
                            {complianceViolations.map((violation, idx) => (
                              <div key={idx} className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{violation}</div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {activeTab === "Cost" && (
                      <div className="grid gap-3">
                        {cost && (
                          <>
                            <InfoRow label="Est. Monthly Cost" value={formatMoney(cost.estimatedMonthlyCost)} />
                            <InfoRow label="Instance Cost" value={formatMoney(cost.instanceCost)} />
                            <InfoRow label="Backup Storage Cost" value={formatMoney(cost.backupStorageCost)} />
                            <InfoRow label="IOPS Cost" value={formatMoney(cost.iopsCost)} />
                            <InfoRow label="Storage Cost" value={formatMoney(cost.storageCost)} />
                            {(cost.costOptimizationSuggestions || []).length > 0 && (
                              <div className="space-y-2 mt-2">
                                <div className="text-xs font-medium text-slate-400">Optimization Suggestions</div>
                                {cost.costOptimizationSuggestions.map((suggestion, idx) => (
                                  <div key={idx} className="rounded-xl border border-sky-500/30 bg-sky-500/10 p-3 text-sm text-sky-200">{suggestion}</div>
                                ))}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}

                    {activeTab === "Backups" && (
                      <div className="grid gap-3">
                        <InfoRow label="Backup Retention" value={`${selectedDatabase.backupRetentionPeriod || 0} days`} />
                        <InfoRow label="Preferred Backup Window" value={selectedDatabase.preferredBackupWindow || "-"} />
                        <InfoRow label="Preferred Maintenance Window" value={selectedDatabase.preferredMaintenanceWindow || "-"} />
                        <InfoRow label="Latest Restorable Time" value={formatDate(selectedDatabase.latestRestorableTime) || "-"} />
                        {selectedDatabase.readReplicas && selectedDatabase.readReplicas.length > 0 && (
                          <div className="space-y-2">
                            <div className="text-xs font-medium text-slate-400">Read Replicas</div>
                            {selectedDatabase.readReplicas.map((replica, idx) => (
                              <div key={idx} className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-3 text-sm text-indigo-200">{replica}</div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="mt-4 rounded-xl border border-slate-800/50 bg-slate-950/40 p-10 text-center">
                  <p className="text-sm text-slate-400">Select a database to view details</p>
                </div>
              )}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
