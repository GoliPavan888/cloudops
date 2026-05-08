import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  ArrowLeft,
  Download,
  Search,
  ShieldAlert,
  ShieldCheck,
  Users,
  UserCog,
  KeyRound,
  Clock3,
  BadgeCheck,
  BadgeAlert,
  ChevronRight,
  RefreshCw,
  Filter,
  Globe,
  Brain,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import Sidebar from "../components/Sidebar";

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
      <span className="max-w-[65%] break-all text-right text-sm text-slate-200">{value}</span>
    </div>
  );
}

function SummaryCard({ label, value, accent, icon: Icon }) {
  const accentClasses = {
    indigo: "border-indigo-500/30 bg-indigo-500/10 text-indigo-200",
    rose: "border-rose-500/30 bg-rose-500/10 text-rose-200",
    emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
    orange: "border-orange-500/30 bg-orange-500/10 text-orange-200",
    sky: "border-sky-500/30 bg-sky-500/10 text-sky-200",
  };
  return (
    <div className={`rounded-2xl border p-4 ${accentClasses[accent] || accentClasses.indigo}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-medium opacity-80">{label}</div>
        {Icon ? <Icon className="h-4 w-4 opacity-80" /> : null}
      </div>
      <div className="mt-2 text-3xl font-bold">{value}</div>
    </div>
  );
}

export default function IAMInventory() {
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [groups, setGroups] = useState([]);
  const [roles, setRoles] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [metrics, setMetrics] = useState({});
  const [activities, setActivities] = useState([]);
  const [security, setSecurity] = useState(null);
  const [search, setSearch] = useState("");
  const [regionFilter, setRegionFilter] = useState("all");
  const [mfaFilter, setMfaFilter] = useState("all");
  const [adminFilter, setAdminFilter] = useState("all");
  const [riskFilter, setRiskFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [entityFilter, setEntityFilter] = useState("all");
  const [sortKey, setSortKey] = useState("securityRiskScore");
  const [sortDir, setSortDir] = useState("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [activeTab, setActiveTab] = useState("General");
  const [loading, setLoading] = useState(false);

  const account = JSON.parse(localStorage.getItem("awsAccount") || "{}");
  const roleArn = localStorage.getItem("roleArn") || account.roleArn;

  useEffect(() => {
    if (roleArn) fetchIam();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleArn]);

  useEffect(() => {
    if (!selected || selected.entityType !== "User") return;
    fetchSelectedDetails(selected.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  async function fetchIam() {
    setLoading(true);
    try {
      const resp = await axios.post("/api/aws/iam", { roleArn, region: account.region });
      setUsers(resp.data.users || []);
      setGroups(resp.data.groups || []);
      setRoles(resp.data.roles || []);
      localStorage.setItem("awsIAMInventory", JSON.stringify(resp.data));
      const firstUser = (resp.data.users || [])[0];
      if (firstUser) setSelected({ entityType: "User", name: firstUser.userName });
    } catch (error) {
      console.error(error?.response?.data || error.message);
      setUsers([]);
      setGroups([]);
      setRoles([]);
    } finally {
      setLoading(false);
    }
  }

  async function fetchSelectedDetails(userName) {
    try {
      const [detailResp, metricsResp, activityResp, securityResp] = await Promise.all([
        axios.post(`/api/aws/iam/${encodeURIComponent(userName)}`, { roleArn, region: account.region }),
        axios.post(`/api/aws/iam/${encodeURIComponent(userName)}/metrics`, { roleArn, region: account.region }),
        axios.post(`/api/aws/iam/${encodeURIComponent(userName)}/activity`, { roleArn, region: account.region }),
        axios.post(`/api/aws/iam/${encodeURIComponent(userName)}/security`, { roleArn, region: account.region }),
      ]);
      setDetail(detailResp.data.detail || null);
      setMetrics(metricsResp.data.metrics || {});
      setActivities(activityResp.data.activities || []);
      setSecurity(securityResp.data.analysis || null);
    } catch (error) {
      console.error(error?.response?.data || error.message);
    }
  }

  const inventory = useMemo(() => {
    const userRows = users.map((user) => ({
      entityType: "User",
      name: user.userName,
      arn: user.arn,
      region: account.region || "global",
      accountId: user.accountId || account.accountId,
      risk: severityKind(user.securityRiskScore || 100),
      securityRiskScore: user.securityRiskScore || 100,
      mfa: user.mfaEnabled,
      admin: user.administratorAccess,
      active: !user.inactiveUser,
      accessKeys: user.accessKeys?.length || 0,
      updated: user.lastModifiedBy || user.lastConsoleLogin || user.passwordLastUsed || user.creationDate,
      raw: user,
    }));

    const groupRows = groups.map((group) => ({
      entityType: "Group",
      name: group.name,
      arn: group.arn,
      region: account.region || "global",
      accountId: account.accountId,
      risk: group.risk === "Critical" ? "critical" : "low",
      securityRiskScore: group.risk === "Critical" ? 20 : 95,
      mfa: null,
      admin: false,
      active: true,
      accessKeys: 0,
      updated: group.createDate,
      raw: group,
    }));

    const roleRows = roles.map((role) => ({
      entityType: "Role",
      name: role.name,
      arn: role.arn,
      region: account.region || "global",
      accountId: account.accountId,
      risk: role.risk === "Critical" ? "critical" : "low",
      securityRiskScore: role.risk === "Critical" ? 20 : 95,
      mfa: null,
      admin: role.name === "AdministratorAccess",
      active: true,
      accessKeys: 0,
      updated: role.createDate,
      raw: role,
    }));

    return [...userRows, ...groupRows, ...roleRows];
  }, [users, groups, roles, account.accountId, account.region]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = inventory.filter((item) => {
      if (entityFilter !== "all" && item.entityType.toLowerCase() !== entityFilter) return false;
      if (q && !`${item.name} ${item.arn}`.toLowerCase().includes(q)) return false;
      if (regionFilter !== "all" && item.region !== regionFilter) return false;
      if (riskFilter !== "all" && item.risk !== riskFilter) return false;
      if (adminFilter !== "all") {
        const admin = Boolean(item.admin);
        if ((adminFilter === "admin" && !admin) || (adminFilter === "nonadmin" && admin)) return false;
      }
      if (mfaFilter !== "all" && item.entityType === "User") {
        const hasMfa = Boolean(item.mfa);
        if ((mfaFilter === "enabled" && !hasMfa) || (mfaFilter === "disabled" && hasMfa)) return false;
      }
      if (statusFilter !== "all" && item.entityType === "User") {
        const isActive = Boolean(item.active);
        if ((statusFilter === "active" && !isActive) || (statusFilter === "inactive" && isActive)) return false;
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
  }, [inventory, search, regionFilter, riskFilter, adminFilter, mfaFilter, statusFilter, entityFilter, sortKey, sortDir]);

  useEffect(() => {
    setPage(1);
  }, [search, regionFilter, riskFilter, adminFilter, mfaFilter, statusFilter, entityFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const pageStart = (page - 1) * pageSize;
  const pagedItems = filteredItems.slice(pageStart, pageStart + pageSize);

  const selectedItem = detail || selected ? inventory.find((item) => item.name === selected?.name && item.entityType === selected?.entityType) || null : null;

  const summary = useMemo(() => {
    const userCount = users.length;
    const groupCount = groups.length;
    const roleCount = roles.length;
    const mfaCount = users.filter((user) => user.mfaEnabled).length;
    const adminCount = users.filter((user) => user.administratorAccess).length;
    const highRisk = users.filter((user) => ["critical", "high"].includes(severityKind(user.securityRiskScore || 100))).length;
    return { userCount, groupCount, roleCount, mfaCount, adminCount, highRisk, totalCost: 0 };
  }, [users, groups, roles]);

  function exportCsv() {
    const rows = filteredItems.map((item) => ({
      entityType: item.entityType,
      name: item.name,
      arn: item.arn,
      region: item.region,
      admin: item.admin ? "Yes" : "No",
      mfa: item.mfa ? "Enabled" : item.mfa === false ? "Disabled" : "-",
      securityRiskScore: item.securityRiskScore,
      risk: item.risk,
      active: item.active ? "Active" : "Inactive",
      accessKeys: item.accessKeys,
      updated: item.updated,
    }));

    const headers = Object.keys(rows[0] || {});
    const csv = [headers.join(","), ...rows.map((row) => headers.map((h) => JSON.stringify(row[h] ?? "")).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `iam-inventory-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const regionOptions = Array.from(new Set(inventory.map((item) => item.region).filter(Boolean))).sort();

  const selectedUser = selectedItem?.entityType === "User" ? (detail || selectedItem?.raw || null) : null;

  return (
    <div className="min-h-screen bg-[#070d1d] text-slate-100">
      <div className="flex min-h-screen">
        <Sidebar active="iam" accountId={account.accountId} region={account.region} />

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
                <h1 className="text-4xl font-bold tracking-tight">IAM Inventory</h1>
                <p className="mt-1 text-slate-400">
                  Identity and access intelligence for users, groups, and roles with security, activity, and governance analysis.
                </p>
              </div>
              <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-3 py-2 text-sm text-indigo-200">
                {summary.userCount} users
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-4 xl:grid-cols-5">
              <SummaryCard label="Users" value={summary.userCount} accent="indigo" icon={Users} />
              <SummaryCard label="Groups" value={summary.groupCount} accent="sky" icon={UserCog} />
              <SummaryCard label="Roles" value={summary.roleCount} accent="emerald" icon={Brain} />
              <SummaryCard label="MFA Enabled" value={summary.mfaCount} accent="orange" icon={ShieldCheck} />
              <SummaryCard label="High Risk" value={summary.highRisk} accent="rose" icon={ShieldAlert} />
            </div>
          </section>

          <section className="mt-6 grid grid-cols-12 gap-4">
            <div className="col-span-12 xl:col-span-8 rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl shadow-slate-950/40">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-semibold">IAM Entities</h2>
                  <p className="text-sm text-slate-400">Users, groups, and roles in a single searchable inventory.</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={fetchIam}
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
                      placeholder="Search identities, ARNs..."
                    />
                  </label>
                </div>

                <select value={entityFilter} onChange={(e) => setEntityFilter(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-indigo-500">
                  <option value="all">All entity types</option>
                  <option value="user">Users</option>
                  <option value="group">Groups</option>
                  <option value="role">Roles</option>
                </select>

                <select value={regionFilter} onChange={(e) => setRegionFilter(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-indigo-500">
                  <option value="all">All regions</option>
                  {regionOptions.map((region) => (
                    <option key={region} value={region}>{region}</option>
                  ))}
                </select>

                <select value={mfaFilter} onChange={(e) => setMfaFilter(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-indigo-500">
                  <option value="all">All MFA statuses</option>
                  <option value="enabled">MFA enabled</option>
                  <option value="disabled">MFA disabled</option>
                </select>

                <select value={adminFilter} onChange={(e) => setAdminFilter(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-indigo-500">
                  <option value="all">All access levels</option>
                  <option value="admin">Admin access</option>
                  <option value="nonadmin">Non-admin</option>
                </select>

                <select value={riskFilter} onChange={(e) => setRiskFilter(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-indigo-500">
                  <option value="all">All risk levels</option>
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-4">
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-indigo-500">
                  <option value="all">All user states</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>

                <div className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-300">
                  <Filter className="h-4 w-4 text-slate-500" />
                  Sort by
                </div>

                <select value={sortKey} onChange={(e) => setSortKey(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-indigo-500">
                  <option value="securityRiskScore">Risk</option>
                  <option value="name">Name</option>
                  <option value="entityType">Type</option>
                  <option value="region">Region</option>
                  <option value="accessKeys">Access Keys</option>
                  <option value="updated">Updated</option>
                </select>

                <button type="button" onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-200 transition hover:border-indigo-500">
                  {sortDir === "asc" ? "Ascending" : "Descending"}
                </button>
              </div>

              <div className="mt-4 overflow-auto rounded-xl border border-slate-800">
                <table className="min-w-full text-left text-sm">
                  <thead className="sticky top-0 z-10 bg-slate-950/95 text-slate-400 backdrop-blur">
                    <tr className="border-b border-slate-800">
                      <th className="px-3 py-3 font-medium">Identity</th>
                      <th className="px-3 py-3 font-medium">Type</th>
                      <th className="px-3 py-3 font-medium">Region</th>
                      <th className="px-3 py-3 font-medium">MFA</th>
                      <th className="px-3 py-3 font-medium">Admin</th>
                      <th className="px-3 py-3 font-medium">Keys</th>
                      <th className="px-3 py-3 font-medium">Risk</th>
                      <th className="px-3 py-3 font-medium">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedItems.length === 0 ? (
                      <tr>
                        <td className="px-3 py-8 text-center text-slate-400" colSpan={8}>No identities match the current filters.</td>
                      </tr>
                    ) : (
                      pagedItems.map((item) => {
                        const active = selected?.name === item.name && selected?.entityType === item.entityType;
                        return (
                          <tr
                            key={`${item.entityType}-${item.name}`}
                            onClick={() => setSelected({ entityType: item.entityType, name: item.name })}
                            className={`cursor-pointer border-b border-slate-800/80 transition ${active ? "bg-indigo-500/10" : "hover:bg-slate-800/40"}`}
                          >
                            <td className="px-3 py-3">
                              <div className="font-medium text-slate-100">{item.name}</div>
                              <div className="text-xs text-slate-500">{item.arn}</div>
                            </td>
                            <td className="px-3 py-3">{item.entityType}</td>
                            <td className="px-3 py-3">{item.region || "-"}</td>
                            <td className="px-3 py-3">{item.entityType === "User" ? (item.mfa ? "Enabled" : "Disabled") : "-"}</td>
                            <td className="px-3 py-3">{item.admin ? "Yes" : "No"}</td>
                            <td className="px-3 py-3">{item.entityType === "User" ? item.accessKeys : "-"}</td>
                            <td className="px-3 py-3">
                              <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-medium ${badgeClass(item.risk)}`}>
                                {item.entityType === "User" ? (item.raw?.securitySeverity || "Low") : item.risk === "critical" ? "Critical" : "Low"}
                              </span>
                            </td>
                            <td className="px-3 py-3">{formatDate(item.updated)}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 flex items-center justify-between text-sm text-slate-400">
                <div>
                  Showing {filteredItems.length === 0 ? 0 : pageStart + 1} to {Math.min(filteredItems.length, pageStart + pageSize)} of {filteredItems.length} identities
                </div>
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
                  <h2 className="text-2xl font-semibold">Identity Intelligence</h2>
                  <p className="text-sm text-slate-400">Deep user intelligence for the selected identity</p>
                </div>
                {selectedUser ? (
                  <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${badgeClass(severityKind(selectedUser.securityRiskScore || 100))}`}>
                    {selectedUser.securitySeverity || "Low"}
                  </span>
                ) : null}
              </div>

              {selectedItem ? (
                <div className="mt-4">
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                    <div className="text-sm text-slate-400">Selected Identity</div>
                    <div className="mt-1 flex items-start justify-between gap-3">
                      <div>
                        <div className="text-xl font-semibold text-slate-100">{selectedItem.name}</div>
                        <div className="text-xs text-slate-500 break-all">{selectedItem.arn}</div>
                      </div>
                      <button onClick={() => navigator.clipboard?.writeText(selectedItem.name)} className="rounded-lg border border-slate-700 p-2 text-slate-400 transition hover:text-white">
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {["General", "Permissions", "Access Keys", "Security", "Activity", "Resource Ownership", "Findings", "Compliance", "Audit Timeline"].map((tab) => (
                      <TabButton key={tab} active={activeTab === tab} onClick={() => setActiveTab(tab)}>{tab}</TabButton>
                    ))}
                  </div>

                  <div className="mt-4 space-y-4 max-h-[800px] overflow-y-auto">
                    {selectedItem.entityType !== "User" ? (
                      <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4 text-sm text-slate-400">
                        Detailed identity intelligence is available for IAM users. This {selectedItem.entityType.toLowerCase()} is included in the inventory for governance visibility.
                      </div>
                    ) : (
                      <>
                        {activeTab === "General" && (
                          <div className="grid gap-3">
                            <InfoRow label="User Name" value={selectedUser.userName} />
                            <InfoRow label="ARN" value={selectedUser.arn} />
                            <InfoRow label="AWS Account ID" value={selectedUser.accountId || account.accountId || "-"} />
                            <InfoRow label="User ID" value={selectedUser.userId} />
                            <InfoRow label="Creation Date" value={formatDate(selectedUser.creationDate)} />
                            <InfoRow label="Path" value={selectedUser.path || "/"} />
                            <InfoRow label="Tags" value={(selectedUser.tags || []).length ? selectedUser.tags.map((tag) => `${tag.key}:${tag.value}`).join(", ") : "-"} />
                            <InfoRow label="Console Access" value={selectedUser.consoleAccessEnabled ? "Enabled" : "Disabled"} />
                            <InfoRow label="Last Console Login" value={formatDate(selectedUser.lastConsoleLogin)} />
                            <InfoRow label="Password Last Used" value={formatDate(selectedUser.passwordLastUsed)} />
                            <InfoRow label="MFA" value={selectedUser.mfaEnabled ? "Enabled" : "Disabled"} />
                            <InfoRow label="Groups" value={(selectedUser.groups || []).join(", ") || "-"} />
                            <InfoRow label="Attached Roles" value={(selectedUser.attachedRoles || []).join(", ") || "-"} />
                          </div>
                        )}

                        {activeTab === "Permissions" && (
                          <div className="grid gap-3">
                            <InfoRow label="Attached Managed Policies" value={(selectedUser.attachedManagedPolicies || []).join(", ") || "-"} />
                            <InfoRow label="Inline Policies" value={(selectedUser.inlinePolicies || []).join(", ") || "-"} />
                            <InfoRow label="Group Permissions" value={(selectedUser.groupPermissions || []).join(", ") || "-"} />
                            <InfoRow label="Effective Permissions" value={(selectedUser.effectivePermissions || []).join(", ") || "-"} />
                            <InfoRow label="Administrator Access" value={selectedUser.administratorAccess ? "Detected" : "No"} />
                            <InfoRow label="Wildcard Permissions" value={selectedUser.wildcardPermissions ? "Detected" : "No"} />
                            <InfoRow label="Cross-account Access" value={selectedUser.crossAccountAccess ? "Detected" : "No"} />
                            <InfoRow label="AssumeRole Permissions" value={selectedUser.assumeRolePermissions ? "Detected" : "No"} />
                            <InfoRow label="Privilege Escalation Risks" value={selectedUser.privilegeEscalationRisks ? "Present" : "None"} />
                          </div>
                        )}

                        {activeTab === "Access Keys" && (
                          <div className="space-y-3">
                            {(selectedUser.accessKeys || []).length ? (
                              selectedUser.accessKeys.map((key) => (
                                <div key={key.accessKeyId} className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="font-medium text-slate-100">{key.accessKeyId}</div>
                                    <span className={`inline-flex rounded-full border px-2 py-1 text-xs ${key.status === "Active" ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300" : "border-slate-600 bg-slate-700/50 text-slate-200"}`}>{key.status}</span>
                                  </div>
                                  <div className="mt-2 grid gap-2 text-sm">
                                    <InfoRow label="Key Age" value={key.ageDays != null ? `${key.ageDays} days` : "-"} />
                                    <InfoRow label="Last Used Time" value={formatDate(key.lastUsedTime)} />
                                    <InfoRow label="Last Used Service" value={key.lastUsedService || "-"} />
                                    <InfoRow label="Last Used Region" value={key.lastUsedRegion || "-"} />
                                    <InfoRow label="Rotation Status" value={key.rotationStatus || "-"} />
                                  </div>
                                </div>
                              ))
                            ) : (
                              <div className="text-sm text-slate-400">No access keys found.</div>
                            )}
                          </div>
                        )}

                        {activeTab === "Security" && (
                          <div className="grid gap-3">
                            <InfoRow label="MFA Enforcement" value={selectedUser.mfaEnforcement ? "Enabled" : "Disabled"} />
                            <InfoRow label="Root Access Detection" value={selectedUser.rootAccessDetection ? "Detected" : "No"} />
                            <InfoRow label="Overprivileged Access" value={selectedUser.overprivilegedAccess ? "Detected" : "No"} />
                            <InfoRow label="Unused Credentials" value={selectedUser.unusedCredentials ? "Detected" : "No"} />
                            <InfoRow label="Inactive User" value={selectedUser.inactiveUser ? "Yes" : "No"} />
                            <InfoRow label="Password Policy Compliance" value={selectedUser.passwordPolicyCompliance || "-"} />
                            <InfoRow label="Console Login Activity" value={selectedUser.consoleLoginActivity || "-"} />
                            <InfoRow label="Failed Login Attempts" value={String(selectedUser.failedLoginAttempts || 0)} />
                            <InfoRow label="API Usage Activity" value={String(selectedUser.apiUsageActivity || 0)} />
                            <InfoRow label="Security Risk Score" value={`${selectedUser.securityRiskScore || 0}/100`} />
                            <InfoRow label="Compliance Status" value={selectedUser.complianceStatus?.status || "Unknown"} />
                          </div>
                        )}

                        {activeTab === "Activity" && (
                          <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-3 text-xs">
                              <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3"><div className="text-slate-400">API Calls</div><div className="mt-1 text-xl font-semibold">{(selectedUser.recentApiCalls || []).length}</div></div>
                              <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3"><div className="text-slate-400">Failed Logins</div><div className="mt-1 text-xl font-semibold">{selectedUser.failedLoginAttempts || 0}</div></div>
                              <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3"><div className="text-slate-400">Source IPs</div><div className="mt-1 text-xl font-semibold">{(selectedUser.sourceIps || []).length}</div></div>
                              <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3"><div className="text-slate-400">User Agents</div><div className="mt-1 text-xl font-semibold">{(selectedUser.userAgents || []).length}</div></div>
                            </div>

                            <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                              <div className="mb-2 text-xs text-slate-400">Login trend</div>
                              <MiniChart values={metrics.loginTrend?.map((point) => point.value) || []} color="#60a5fa" />
                            </div>
                            <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                              <div className="mb-2 text-xs text-slate-400">API usage trend</div>
                              <MiniChart values={metrics.apiUsageTrend?.map((point) => point.value) || []} color="#22c55e" />
                            </div>
                          </div>
                        )}

                        {activeTab === "Resource Ownership" && (
                          <div className="grid gap-3">
                            <InfoRow label="EC2 Instances Created" value={String(selectedUser.resourcesCreated?.ec2Instances || 0)} />
                            <InfoRow label="S3 Buckets Created" value={String(selectedUser.resourcesCreated?.s3Buckets || 0)} />
                            <InfoRow label="Lambda Functions Created" value={String(selectedUser.resourcesCreated?.lambdaFunctions || 0)} />
                            <InfoRow label="RDS Databases Created" value={String(selectedUser.resourcesCreated?.rdsDatabases || 0)} />
                            <InfoRow label="IAM Roles Created" value={String(selectedUser.resourcesCreated?.iamRoles || 0)} />
                            <InfoRow label="Policies Created" value={String(selectedUser.resourcesCreated?.policies || 0)} />
                          </div>
                        )}

                        {activeTab === "Findings" && (
                          <div className="space-y-3">
                            {(selectedUser.detections || []).length ? (
                              selectedUser.detections.map((finding) => (
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
                            <InfoRow label="Status" value={selectedUser.complianceStatus?.status || "Unknown"} />
                            <InfoRow label="Compliant" value={selectedUser.complianceStatus?.compliant ? "Yes" : "No"} />
                            <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                              <div className="mb-2 text-xs text-slate-400">Violations</div>
                              {(selectedUser.complianceStatus?.violations || []).length ? (
                                <ul className="list-disc space-y-1 pl-5 text-sm text-slate-200">
                                  {selectedUser.complianceStatus.violations.map((item) => <li key={item}>{item}</li>)}
                                </ul>
                              ) : (
                                <div className="text-sm text-emerald-300">No compliance violations detected.</div>
                              )}
                            </div>
                          </div>
                        )}

                        {activeTab === "Audit Timeline" && (
                          <div className="space-y-3">
                            <InfoRow label="Created By" value={selectedUser.createdBy || "-"} />
                            <InfoRow label="Source IP" value={selectedUser.sourceIp || "-"} />
                            <InfoRow label="Event Name" value={selectedUser.eventName || "-"} />
                            <InfoRow label="Event Time" value={formatDate(selectedUser.eventTime)} />
                            <InfoRow label="Last Modified By" value={selectedUser.lastModifiedBy || "-"} />
                            <InfoRow label="Assumed Role" value={selectedUser.assumedRole || "-"} />
                            <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                              <div className="mb-2 text-xs text-slate-400">Timeline</div>
                              <div className="max-h-72 space-y-2 overflow-y-auto">
                                {(activities || []).slice(0, 30).map((event) => (
                                  <div key={event.eventId || `${event.eventName}-${event.eventTime}`} className="rounded border border-slate-800 p-2">
                                    <div className="flex items-center justify-between gap-2 text-xs">
                                      <span className="font-medium text-slate-200">{event.eventName}</span>
                                      <span className="text-slate-500">{formatDate(event.eventTime)}</span>
                                    </div>
                                    <div className="mt-1 text-xs text-slate-400">{event.resource || event.resourceType || "-"}</div>
                                  </div>
                                ))}
                                {!activities?.length ? <div className="text-sm text-slate-400">No audit events found.</div> : null}
                              </div>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <div className="mt-8 rounded-xl border border-slate-800 bg-slate-950/40 p-4 text-sm text-slate-400">
                  Select an IAM user to view identity intelligence.
                </div>
              )}
            </div>
          </section>

          <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <h3 className="text-xl font-semibold text-slate-100">Identity Health Highlights</h3>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4">
              <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                <div className="text-xs text-slate-400">Admin users</div>
                <div className="mt-1 text-2xl font-bold text-rose-300">{summary.adminCount}</div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                <div className="text-xs text-slate-400">MFA enabled</div>
                <div className="mt-1 text-2xl font-bold text-emerald-300">{summary.mfaCount}</div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                <div className="text-xs text-slate-400">High risk users</div>
                <div className="mt-1 text-2xl font-bold text-orange-300">{summary.highRisk}</div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                <div className="text-xs text-slate-400">Roles / Groups</div>
                <div className="mt-1 text-2xl font-bold text-sky-300">{summary.roleCount + summary.groupCount}</div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-400">
              <span className="inline-flex items-center gap-1 rounded-full border border-slate-700 px-2 py-1"><Brain className="h-3.5 w-3.5" />Access intelligence</span>
              <span className="inline-flex items-center gap-1 rounded-full border border-slate-700 px-2 py-1"><ShieldAlert className="h-3.5 w-3.5" />Risk scoring</span>
              <span className="inline-flex items-center gap-1 rounded-full border border-slate-700 px-2 py-1"><Clock3 className="h-3.5 w-3.5" />CloudTrail attribution</span>
              <span className="inline-flex items-center gap-1 rounded-full border border-slate-700 px-2 py-1"><KeyRound className="h-3.5 w-3.5" />Access keys</span>
              <span className="inline-flex items-center gap-1 rounded-full border border-slate-700 px-2 py-1"><BadgeCheck className="h-3.5 w-3.5" />Compliance checks</span>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
