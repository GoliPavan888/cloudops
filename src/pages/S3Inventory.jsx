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

export default function S3Inventory() {
  const navigate = useNavigate();
  const { connectedRole } = useAWSConnection();
  const account = connectedRole || {};
  const roleArn = account.roleArn || "";
  const [buckets, setBuckets] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [metrics, setMetrics] = useState({});
  const [activities, setActivities] = useState([]);
  const [security, setSecurity] = useState(null);
  const [search, setSearch] = useState("");
  const [regionFilter, setRegionFilter] = useState("all");
  const [riskFilter, setRiskFilter] = useState("all");
  const [encryptionFilter, setEncryptionFilter] = useState("all");
  const [publicFilter, setPublicFilter] = useState("all");
  const [sortKey, setSortKey] = useState("securityRiskScore");
  const [sortDir, setSortDir] = useState("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [activeTab, setActiveTab] = useState("General");
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (roleArn) fetchBuckets();
  }, [roleArn, account.region]);

  useEffect(() => {
    if (!selected) return;
    fetchSelectedDetails(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  async function fetchBuckets() {
    setLoading(true);
    setError(null);
    try {
      const resp = await axios.post("/api/aws/s3", { roleArn, region: account.region });
      const items = resp.data.buckets || [];
      setBuckets(items);
      if (items.length) setSelected(items[0].name);
      localStorage.setItem("awsS3Buckets", JSON.stringify(items));
    } catch (error) {
      const errorMsg = error?.response?.data?.message || error.message;
      console.error("Failed to fetch buckets:", errorMsg);
      setError(errorMsg);
      setBuckets([]);
    } finally {
      setLoading(false);
    }
  }

  async function fetchSelectedDetails(name) {
    if (!name || !roleArn) return;
    setDetailLoading(true);
    try {
      const [detailResp, metricsResp, activityResp, securityResp] = await Promise.all([
        axios.post(`/api/aws/s3/${name}`, { roleArn, region: account.region }).catch(() => ({ data: {} })),
        axios.post(`/api/aws/s3/${name}/metrics`, { roleArn, region: account.region }).catch(() => ({ data: {} })),
        axios.post(`/api/aws/s3/${name}/activity`, { roleArn, region: account.region }).catch(() => ({ data: {} })),
        axios.post(`/api/aws/s3/${name}/security`, { roleArn, region: account.region }).catch(() => ({ data: {} })),
      ]);
      setDetail(detailResp.data.detail || null);
      setMetrics(metricsResp.data.metrics || {});
      setActivities(activityResp.data.activities || []);
      setSecurity(securityResp.data.analysis || null);
    } catch (error) {
      console.error("Failed to fetch bucket details:", error?.response?.data || error.message);
      setDetail(null);
      setMetrics({});
      setActivities([]);
      setSecurity(null);
    } finally {
      setDetailLoading(false);
    }
  }

  const enrichedBuckets = useMemo(() => {
    return buckets.map((bucket) => {
      const sev = severityKind(bucket.securityRiskScore || 100);
      return {
        ...bucket,
        severityKind: sev,
        publicLabel: bucket.publicPolicy || bucket.publicACL ? "Public" : "Private",
        encryptionLabel: bucket.encryptionEnabled ? (bucket.sseType || "Enabled") : "Disabled",
      };
    });
  }, [buckets]);

  if (!connectedRole) {
    return (
      <div className="min-h-screen bg-slate-950 text-white grid place-items-center p-6">
        <div className="max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center">
          <h1 className="text-2xl font-bold">No AWS account connected</h1>
          <p className="mt-2 text-sm text-slate-400">Reconnect AWS account to view S3 buckets.</p>
          <button onClick={() => navigate("/")} className="mt-6 rounded-xl bg-indigo-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-indigo-400">
            Reconnect AWS account
          </button>
        </div>
      </div>
    );
  }

  const filteredBuckets = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = enrichedBuckets.filter((bucket) => {
      if (q && !`${bucket.name} ${bucket.region} ${bucket.owner || ""}`.toLowerCase().includes(q)) return false;
      if (regionFilter !== "all" && bucket.region !== regionFilter) return false;
      if (riskFilter !== "all" && severityKind(bucket.securityRiskScore || 100) !== riskFilter) return false;
      if (encryptionFilter !== "all") {
        const encrypted = Boolean(bucket.encryptionEnabled);
        if ((encryptionFilter === "encrypted" && !encrypted) || (encryptionFilter === "unencrypted" && encrypted)) return false;
      }
      if (publicFilter !== "all") {
        const isPublic = Boolean(bucket.publicACL || bucket.publicPolicy);
        if ((publicFilter === "public" && !isPublic) || (publicFilter === "private" && isPublic)) return false;
      }
      return true;
    });

    rows.sort((a, b) => {
      const aValue = a[sortKey];
      const bValue = b[sortKey];
      const direction = sortDir === "asc" ? 1 : -1;
      if (sortKey === "creationDate" || sortKey === "lastModifiedTime") {
        return (new Date(aValue || 0) - new Date(bValue || 0)) * direction;
      }
      if (typeof aValue === "number" || typeof bValue === "number") {
        return ((Number(aValue) || 0) - (Number(bValue) || 0)) * direction;
      }
      return String(aValue || "").localeCompare(String(bValue || "")) * direction;
    });

    return rows;
  }, [enrichedBuckets, search, regionFilter, riskFilter, encryptionFilter, publicFilter, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filteredBuckets.length / pageSize));
  const pagedBuckets = filteredBuckets.slice((page - 1) * pageSize, page * pageSize);
  const selectedBucket = detail || enrichedBuckets.find((bucket) => bucket.name === selected) || null;

  useEffect(() => {
    setPage(1);
  }, [search, regionFilter, riskFilter, encryptionFilter, publicFilter, sortKey, sortDir, pageSize]);

  function exportCSV() {
    const cols = ["name", "arn", "accountId", "region", "creationDate", "owner", "securityRiskScore", "securitySeverity", "encryptionEnabled", "publicPolicy", "publicACL", "totalObjectCount", "totalStorageSizeBytes", "lastModifiedTime", "complianceStatus"];
    const rows = [cols.join(",")].concat(
      filteredBuckets.map((bucket) => cols.map((col) => `"${String(bucket[col] ?? "").replace(/"/g, '""')}"`).join(","))
    );
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `s3-inventory-${new Date().toISOString()}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const overview = useMemo(() => {
    const total = enrichedBuckets.length;
    const publicBuckets = enrichedBuckets.filter((bucket) => bucket.publicPolicy || bucket.publicACL).length;
    const encryptedBuckets = enrichedBuckets.filter((bucket) => bucket.encryptionEnabled).length;
    const highRisk = enrichedBuckets.filter((bucket) => severityKind(bucket.securityRiskScore || 100) === "high" || severityKind(bucket.securityRiskScore || 100) === "critical").length;
    const estimatedCost = enrichedBuckets.reduce((sum, bucket) => sum + Number(bucket.cost?.estimatedMonthlyTotal || 0), 0);
    return { total, publicBuckets, encryptedBuckets, highRisk, estimatedCost };
  }, [enrichedBuckets]);

  const metricSeries = useMemo(() => {
    return {
      sizeBytes: metrics.sizeBytes?.values || [],
      numObj: metrics.numObj?.values || [],
      allRequests: metrics.allRequests?.values || [],
      getRequests: metrics.getRequests?.values || [],
      putRequests: metrics.putRequests?.values || [],
      bytesDownloaded: metrics.bytesDownloaded?.values || [],
      bytesUploaded: metrics.bytesUploaded?.values || [],
    };
  }, [metrics]);

  const activityTimeline = (detail?.activityTimeline || activities || []).slice(0, 20);
  const findings = security?.accessAnalyzerFindings || detail?.accessAnalyzerFindings || [];
  const complianceViolations = detail?.complianceStatus?.violations || [];
  const cost = detail?.cost || null;

  return (
    <div className="min-h-screen bg-[#070d1d] text-slate-100">
      <div className="flex min-h-screen">
        <Sidebar active="s3" accountId={account.accountId} region={account.region} />

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
                  <h1 className="text-4xl font-bold tracking-tight">S3 Inventory</h1>
                  <p className="mt-1 text-slate-400">Bucket intelligence, exposure analysis, activity, and cost view for the connected AWS account</p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm text-slate-300">
              <div className="flex items-center gap-2 text-slate-400">
                <Globe className="h-4 w-4" /> {account.region || "us-east-1"}
              </div>
              <div className="mt-1 text-lg font-semibold">{overview.total} buckets</div>
              <div className="text-xs text-slate-500">{loading ? "Refreshing..." : "Live scan from connected account"}</div>
            </div>
          </header>

          <section className="mt-6 grid grid-cols-2 gap-4 xl:grid-cols-5">
            <SummaryCard label="Buckets" value={overview.total} accent="indigo" />
            <SummaryCard label="Public" value={overview.publicBuckets} accent="rose" />
            <SummaryCard label="Encrypted" value={overview.encryptedBuckets} accent="emerald" />
            <SummaryCard label="High Risk" value={overview.highRisk} accent="orange" />
            <SummaryCard label="Est. Cost" value={formatMoney(overview.estimatedCost)} accent="sky" />
          </section>

          <section className="mt-6 grid grid-cols-12 gap-4">
            <div className="col-span-12 xl:col-span-8 rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl shadow-slate-950/40">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-semibold">S3 Buckets</h2>
                  <p className="text-sm text-slate-400">Search, filter, sort, and open any bucket for a full intelligence view.</p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={fetchBuckets} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-300 transition hover:bg-slate-800">
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
                    placeholder="Search buckets, owners, tags..."
                    className="w-full rounded-xl border border-slate-700 bg-slate-950/60 py-3 pl-10 pr-3 text-sm outline-none transition focus:border-indigo-500"
                  />
                </div>
                <select value={regionFilter} onChange={(event) => setRegionFilter(event.target.value)} className="rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-3 text-sm text-slate-200 outline-none">
                  <option value="all">All regions</option>
                  {[...new Set(enrichedBuckets.map((bucket) => bucket.region).filter(Boolean))].map((region) => (
                    <option key={region} value={region}>{region}</option>
                  ))}
                </select>
                <select value={riskFilter} onChange={(event) => setRiskFilter(event.target.value)} className="rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-3 text-sm text-slate-200 outline-none">
                  <option value="all">All risk levels</option>
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
                <select value={encryptionFilter} onChange={(event) => setEncryptionFilter(event.target.value)} className="rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-3 text-sm text-slate-200 outline-none">
                  <option value="all">All encryption</option>
                  <option value="encrypted">Encrypted</option>
                  <option value="unencrypted">Unencrypted</option>
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
                  <option value="name">Bucket name</option>
                  <option value="region">Region</option>
                  <option value="creationDate">Created</option>
                  <option value="lastModifiedTime">Last modified</option>
                  <option value="totalStorageSizeBytes">Size</option>
                  <option value="totalObjectCount">Objects</option>
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
                        <th className="px-4 py-3 font-medium">Bucket</th>
                        <th className="px-4 py-3 font-medium">Region</th>
                        <th className="px-4 py-3 font-medium">Public/Private</th>
                        <th className="px-4 py-3 font-medium">Encryption</th>
                        <th className="px-4 py-3 font-medium">Objects</th>
                        <th className="px-4 py-3 font-medium">Size</th>
                        <th className="px-4 py-3 font-medium">Risk</th>
                        <th className="px-4 py-3 font-medium">Updated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedBuckets.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="px-4 py-10 text-center text-slate-400">No buckets match the current filters.</td>
                        </tr>
                      ) : (
                        pagedBuckets.map((bucket) => (
                          <tr
                            key={bucket.name}
                            onClick={() => setSelected(bucket.name)}
                            className={`group cursor-pointer border-b border-slate-800/70 transition hover:bg-slate-800/50 ${selected === bucket.name ? "bg-slate-800/60" : ""}`}
                          >
                            <td className="px-4 py-4 align-top">
                              <div className="font-medium text-slate-100">{bucket.name}</div>
                              <div className="mt-1 text-xs text-slate-500">{bucket.owner || "Unknown owner"}</div>
                            </td>
                            <td className="px-4 py-4 align-top text-slate-300">{bucket.region || "-"}</td>
                            <td className="px-4 py-4 align-top">
                              <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${bucket.publicPolicy || bucket.publicACL ? "border-rose-500/30 bg-rose-500/15 text-rose-300" : "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"}`}>
                                {bucket.publicPolicy || bucket.publicACL ? "Public" : "Private"}
                              </span>
                            </td>
                            <td className="px-4 py-4 align-top text-slate-300">{bucket.encryptionEnabled ? bucket.sseType || "Enabled" : "Disabled"}</td>
                            <td className="px-4 py-4 align-top text-slate-300">{bucket.totalObjectCount ?? "-"}</td>
                            <td className="px-4 py-4 align-top text-slate-300">{formatBytes(bucket.totalStorageSizeBytes)}</td>
                            <td className="px-4 py-4 align-top">
                              <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${badgeClass(bucket.severityKind)}`}>{bucket.securitySeverity || "Low"}</span>
                            </td>
                            <td className="px-4 py-4 align-top text-slate-300">{formatDate(bucket.lastModifiedTime || bucket.creationDate)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between text-sm text-slate-400">
                <div>
                  Showing {pagedBuckets.length} of {filteredBuckets.length} buckets
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
                  <h2 className="text-2xl font-semibold">Bucket Intelligence</h2>
                  <p className="text-sm text-slate-400">Deep detail for the selected bucket</p>
                </div>
                {selectedBucket ? <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${badgeClass(severityKind(selectedBucket.securityRiskScore || 100))}`}>{selectedBucket.securitySeverity || "Low"}</span> : null}
              </div>

              {error && (
                <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">
                  <div className="font-medium">Error loading data</div>
                  <div className="mt-1 text-xs">{error}</div>
                </div>
              )}

              {selectedBucket ? (
                <div className="mt-4">
                  {detailLoading && (
                    <div className="mb-4 rounded-xl border border-slate-700 bg-slate-950/60 p-3 text-center text-sm text-slate-400">
                      Loading bucket details...
                    </div>
                  )}
                  
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                    <div className="text-sm text-slate-400">Bucket Name</div>
                    <div className="mt-1 flex items-start justify-between gap-3">
                      <div>
                        <div className="text-xl font-semibold text-slate-100">{selectedBucket.name}</div>
                        <div className="text-xs text-slate-500">{selectedBucket.arn}</div>
                      </div>
                      <button onClick={() => navigator.clipboard?.writeText(selectedBucket.name)} className="rounded-lg border border-slate-700 p-2 text-slate-400 transition hover:text-white">
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {[
                      "General",
                      "Permissions",
                      "Encryption",
                      "Monitoring",
                      "Activity",
                      "Findings",
                      "Compliance",
                      "Cost",
                    ].map((tab) => (
                      <TabButton key={tab} active={activeTab === tab} onClick={() => setActiveTab(tab)}>{tab}</TabButton>
                    ))}
                  </div>

                  <div className="mt-4 space-y-4 max-h-[800px] overflow-y-auto">
                    {activeTab === "General" && (
                      <div className="grid gap-3">
                        <InfoRow label="ARN" value={selectedBucket.arn} />
                        <InfoRow label="AWS Account ID" value={selectedBucket.accountId} />
                        <InfoRow label="Region" value={selectedBucket.region} />
                        <InfoRow label="Creation Date" value={formatDate(selectedBucket.creationDate)} />
                        <InfoRow label="Bucket Owner" value={selectedBucket.owner || "Unknown"} />
                        <InfoRow label="Tags" value={selectedBucket.tags?.length ? selectedBucket.tags.map((tag) => `${tag.key}:${tag.value}`).join(", ") : "-"} />
                        <InfoRow label="Storage Class" value={selectedBucket.storageClass || "Unknown"} />
                        <InfoRow label="Total Storage Size" value={formatBytes(selectedBucket.totalStorageSizeBytes)} />
                        <InfoRow label="Total Object Count" value={selectedBucket.totalObjectCount ?? "-"} />
                        <InfoRow label="Last Modified Time" value={formatDate(selectedBucket.lastModifiedTime)} />
                        <InfoRow label="Last Accessed Time" value={formatDate(selectedBucket.lastAccessedTime)} />
                      </div>
                    )}

                    {activeTab === "Permissions" && (
                      <div className="space-y-3">
                        <InfoRow label="Public Status" value={selectedBucket.publicPolicy || selectedBucket.publicACL ? "Public" : "Private"} />
                        <InfoRow label="Public Access Block" value={selectedBucket.publicAccessBlock ? "Configured" : "Missing"} />
                        <InfoRow label="ACL Permissions" value={selectedBucket.aclPermissions?.length ? `${selectedBucket.aclPermissions.length} grants` : "Not available"} />
                        <InfoRow label="Cross-account Access" value={selectedBucket.crossAccountAccess ? "Detected" : "Not detected"} />
                        <InfoRow label="Anonymous Access" value={selectedBucket.anonymousAccessDetection ? "Detected" : "Not detected"} />
                        <InfoRow label="Internet Exposure" value={selectedBucket.internetExposureDetection ? "Detected" : "Not detected"} />
                        <DetailBlock title="Bucket Policy" value={JSON.stringify(selectedBucket.bucketPolicy || {}, null, 2)} />
                        <DetailBlock title="Access Blocks" value={JSON.stringify(selectedBucket.publicAccessBlock || {}, null, 2)} />
                      </div>
                    )}

                    {activeTab === "Encryption" && (
                      <div className="space-y-3">
                        <InfoRow label="Encryption Enabled" value={selectedBucket.encryptionEnabled ? "Yes" : "No"} />
                        <InfoRow label="SSE Type" value={selectedBucket.sseType || "-"} />
                        <InfoRow label="KMS Key Information" value={selectedBucket.kmsKeyInfo || "-"} />
                        <InfoRow label="Versioning Enabled" value={selectedBucket.versioningEnabled ? "Yes" : "No"} />
                        <InfoRow label="Logging Enabled" value={selectedBucket.loggingEnabled ? "Yes" : "No"} />
                        <InfoRow label="Replication Enabled" value={selectedBucket.replicationEnabled ? "Yes" : "No"} />
                        <InfoRow label="Lifecycle Policies" value={selectedBucket.lifecycleEnabled ? "Configured" : "Not configured"} />
                        <DetailBlock title="Replication" value={JSON.stringify(selectedBucket.replication || {}, null, 2)} />
                        <DetailBlock title="Lifecycle" value={JSON.stringify(selectedBucket.lifecycle || [], null, 2)} />
                        <DetailBlock title="Logging" value={JSON.stringify(selectedBucket.logging || {}, null, 2)} />
                      </div>
                    )}

                    {activeTab === "Monitoring" && (
                      <div className="space-y-4">
                        <MiniMetricCard title="Storage Usage Trends" subtitle={formatBytes(selectedBucket.totalStorageSizeBytes)}>
                          <MiniChart values={metricSeries.sizeBytes.slice(-12)} color="#60a5fa" />
                        </MiniMetricCard>
                        <MiniMetricCard title="Object Growth Trends" subtitle={String(selectedBucket.totalObjectCount ?? "-")}>
                          <MiniChart values={metricSeries.numObj.slice(-12)} color="#34d399" />
                        </MiniMetricCard>
                        <MiniMetricCard title="Request Count" subtitle={String(metricSeries.allRequests[0] ?? 0)}>
                          <MiniChart values={metricSeries.allRequests.slice(-12)} color="#f59e0b" />
                        </MiniMetricCard>
                        <MiniMetricCard title="GET / PUT Requests" subtitle={`${metricSeries.getRequests[0] ?? 0} / ${metricSeries.putRequests[0] ?? 0}`}>
                          <MiniChart values={[...(metricSeries.getRequests.slice(-12) || []), ...(metricSeries.putRequests.slice(-12) || [])].slice(-12)} color="#c084fc" />
                        </MiniMetricCard>
                        <MiniMetricCard title="Data Transfer" subtitle={formatBytes((metricSeries.bytesDownloaded[0] || 0) + (metricSeries.bytesUploaded[0] || 0))}>
                          <MiniChart values={[...(metricSeries.bytesDownloaded.slice(-12) || []), ...(metricSeries.bytesUploaded.slice(-12) || [])].slice(-12)} color="#fb7185" />
                        </MiniMetricCard>
                      </div>
                    )}

                    {activeTab === "Activity" && (
                      <div className="space-y-3">
                        <InfoRow label="Created By" value={selectedBucket.createdBy || "-"} />
                        <InfoRow label="Source IP" value={selectedBucket.sourceIp || "-"} />
                        <InfoRow label="Event Name" value={selectedBucket.eventName || "-"} />
                        <InfoRow label="Event Time" value={formatDate(selectedBucket.creationDate || selectedBucket.lastModifiedTime)} />
                        <InfoRow label="Last Modified By" value={selectedBucket.lastModifiedBy || "-"} />
                        <InfoRow label="Assumed Role" value={selectedBucket.assumedRole || "-"} />
                        <InfoRow label="User Agent" value={selectedBucket.userAgent || "-"} />
                        <DetailBlock title="Bucket Activity Timeline" value={activityTimeline.length ? activityTimeline.map((entry) => `${formatDate(entry.eventTime)} | ${entry.eventName} | ${entry.username || "-"} | ${entry.sourceIp || "-"}`).join("\n") : "No CloudTrail activity available."} />
                        <DetailBlock title="Bucket Policy Changes" value={JSON.stringify(selectedBucket.bucketPolicyChanges || [], null, 2)} />
                        <DetailBlock title="Upload/Delete Activity" value={JSON.stringify(selectedBucket.uploadDeleteActivity || [], null, 2)} />
                        <DetailBlock title="Permission Changes" value={JSON.stringify(selectedBucket.permissionChanges || [], null, 2)} />
                      </div>
                    )}

                    {activeTab === "Findings" && (
                      <div className="space-y-3">
                        <InfoRow label="Security Risk Score" value={selectedBucket.securityRiskScore ?? 100} />
                        <InfoRow label="Security Severity" value={selectedBucket.securitySeverity || "Low"} />
                        <InfoRow label="Public Bucket Detection" value={selectedBucket.publicPolicy || selectedBucket.publicACL ? "Detected" : "Not detected"} />
                        <InfoRow label="Public Write Access" value={selectedBucket.publicPolicy ? "Potentially exposed" : "Not detected"} />
                        <InfoRow label="Missing Encryption" value={selectedBucket.encryptionEnabled ? "No" : "Yes"} />
                        <InfoRow label="Missing Logging" value={selectedBucket.loggingEnabled ? "No" : "Yes"} />
                        <InfoRow label="Missing Versioning" value={selectedBucket.versioningEnabled ? "No" : "Yes"} />
                        <InfoRow label="Open Bucket Policies" value={selectedBucket.publicPolicy ? "Yes" : "No"} />
                        <InfoRow label="Sensitive Exposure" value={selectedBucket.publicPolicy || selectedBucket.publicACL ? "Possible" : "Low"} />
                        <InfoRow label="Cross-account Risk" value={selectedBucket.crossAccountAccess ? "Detected" : "Not detected"} />
                        <InfoRow label="Compliance Violations" value={selectedBucket.complianceStatus?.violations?.length || 0} />
                        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                          <div className="text-sm text-slate-400">Detection & Findings</div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {(selectedBucket.detections || []).length ? selectedBucket.detections.map((item) => (
                              <span key={item} className="rounded-full border border-rose-500/30 bg-rose-500/10 px-3 py-1 text-xs text-rose-300">{item}</span>
                            )) : <span className="text-slate-500">No notable detections.</span>}
                          </div>
                        </div>
                        <DetailBlock title="Access Analyzer Findings" value={findings.length ? JSON.stringify(findings, null, 2) : "No findings returned."} />
                      </div>
                    )}

                    {activeTab === "Compliance" && (
                      <div className="space-y-3">
                        <InfoRow label="Compliance Status" value={selectedBucket.complianceStatus?.status || "Unknown"} />
                        <InfoRow label="Public Bucket Detection" value={selectedBucket.publicPolicy || selectedBucket.publicACL ? "Detected" : "Not detected"} />
                        <InfoRow label="Missing Encryption" value={selectedBucket.encryptionEnabled ? "No" : "Yes"} />
                        <InfoRow label="Missing Logging" value={selectedBucket.loggingEnabled ? "No" : "Yes"} />
                        <InfoRow label="Missing Versioning" value={selectedBucket.versioningEnabled ? "No" : "Yes"} />
                        <DetailBlock title="Compliance Violations" value={(complianceViolations || []).length ? complianceViolations.join("\n") : "No violations detected."} />
                      </div>
                    )}

                    {activeTab === "Cost" && (
                      <div className="space-y-3">
                        <InfoRow label="Estimated Monthly Storage Cost" value={formatMoney(cost?.estimatedMonthlyStorageCost)} />
                        <InfoRow label="Request Cost" value={formatMoney(cost?.requestCost)} />
                        <InfoRow label="Transfer Cost" value={formatMoney(cost?.transferCost)} />
                        <InfoRow label="Lifecycle Savings" value={formatMoney(cost?.lifecycleSavings)} />
                        <InfoRow label="Estimated Monthly Total" value={formatMoney(cost?.estimatedMonthlyTotal)} />
                        <InfoRow label="Unused Bucket Detection" value={Number(selectedBucket.totalObjectCount || 0) === 0 ? "Likely unused" : "In use"} />
                        <DetailBlock title="Cost Optimization Suggestions" value={(selectedBucket.costOptimizationSuggestions || []).length ? selectedBucket.costOptimizationSuggestions.join("\n") : "No suggestions available."} />
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="mt-6 rounded-2xl border border-dashed border-slate-700 bg-slate-950/50 p-6 text-slate-400">
                  Select a bucket to view its intelligence profile.
                </div>
              )}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, accent }) {
  const accentClasses = {
    indigo: "from-indigo-500/20 to-indigo-500/5 text-indigo-200 border-indigo-500/20",
    rose: "from-rose-500/20 to-rose-500/5 text-rose-200 border-rose-500/20",
    emerald: "from-emerald-500/20 to-emerald-500/5 text-emerald-200 border-emerald-500/20",
    orange: "from-orange-500/20 to-orange-500/5 text-orange-200 border-orange-500/20",
    sky: "from-sky-500/20 to-sky-500/5 text-sky-200 border-sky-500/20",
  };

  return (
    <div className={`rounded-2xl border bg-gradient-to-br p-4 shadow-lg shadow-slate-950/40 ${accentClasses[accent] || accentClasses.indigo}`}>
      <div className="text-sm text-slate-400">{label}</div>
      <div className="mt-2 text-3xl font-bold tracking-tight">{value}</div>
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-1 break-words text-sm text-slate-100">{value || "-"}</div>
    </div>
  );
}

function DetailBlock({ title, value }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
      <div className="text-sm text-slate-400">{title}</div>
      <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-slate-300">{value || "-"}</pre>
    </div>
  );
}

function MiniMetricCard({ title, subtitle, children }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 transition hover:-translate-y-0.5 hover:border-slate-700">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-slate-100">{title}</div>
          <div className="mt-1 text-xs text-slate-500">{subtitle}</div>
        </div>
        <div className="rounded-full border border-slate-700 bg-slate-900 p-2 text-slate-400">
          <ChartArea className="h-4 w-4" />
        </div>
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}
