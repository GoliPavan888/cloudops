import { useEffect, useMemo, useState, useRef } from "react";
import axios from "axios";
import { ArrowLeft, CalendarDays, Copy, Server, ShieldCheck, Activity, Search, Download } from "lucide-react";
import { useNavigate } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import { useAWSConnection } from "../context/AWSConnectionContext.jsx";

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function formatUptime(hours) {
  if (hours == null) return "-";
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return `${days}d ${remHours}h`;
}

export default function EC2Inventory() {
  const navigate = useNavigate();
  const { connectedRole } = useAWSConnection();
  const account = connectedRole || {};
  const roleArn = account.roleArn || "";
  const [instances, setInstances] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [metrics, setMetrics] = useState({});
  const [activities, setActivities] = useState([]);
  const [securityAnalysis, setSecurityAnalysis] = useState(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState("launchTime");
  const [sortDir, setSortDir] = useState("desc");
  const [activeTab, setActiveTab] = useState("General");
  const pollingRef = useRef(null);

  useEffect(() => {
    const stored = JSON.parse(localStorage.getItem("awsEc2Instances") || "[]");
    setInstances(stored);
    if (stored.length) setSelectedId(stored[0].instanceId);

    // fetch live list from backend if roleArn present
    if (roleArn) fetchInstances(roleArn, account.region);
  }, [roleArn, account.region]);

  useEffect(() => {
    // when selection changes, fetch detail and start metrics polling
    if (!selectedId) return;
    if (!roleArn) return;

    fetchDetail(selectedId, roleArn, account.region);
    fetchActivities(selectedId, roleArn, account.region);
    fetchSecurity(selectedId, roleArn, account.region);
    fetchMetrics(selectedId, roleArn, account.region);

    // poll metrics every 30s
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = setInterval(() => fetchMetrics(selectedId, roleArn, account.region), 30000);
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [selectedId]);

  const selected = useMemo(
    () => instances.find((item) => item.instanceId === selectedId) || instances[0] || null,
    [instances, selectedId]
  );

  const copyText = async (value) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // ignore clipboard failures
    }
  };

  if (!connectedRole) {
    return (
      <div className="min-h-screen bg-slate-950 text-white grid place-items-center p-6">
        <div className="max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center">
          <h1 className="text-2xl font-bold">No AWS account connected</h1>
          <p className="mt-2 text-sm text-slate-400">Reconnect AWS account to view EC2 inventory.</p>
          <button onClick={() => navigate("/")} className="mt-6 rounded-xl bg-indigo-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-indigo-400">
            Reconnect AWS account
          </button>
        </div>
      </div>
    );
  }

  async function fetchInstances(roleArn, region) {
    setLoading(true);
    try {
      const resp = await axios.post("/api/aws/ec2", { roleArn, region });
      if (resp.data && resp.data.ec2Instances) {
        setInstances(resp.data.ec2Instances);
        localStorage.setItem("awsEc2Instances", JSON.stringify(resp.data.ec2Instances));
        if (!selectedId && resp.data.ec2Instances.length) setSelectedId(resp.data.ec2Instances[0].instanceId);
      }
    } catch (e) {
      console.error("fetchInstances failed", e?.response?.data || e.message);
    } finally {
      setLoading(false);
    }
  }

  async function fetchDetail(id, roleArn, region) {
    try {
      const resp = await axios.post(`/api/aws/ec2/${id}`, { roleArn, region });
      setDetail(resp.data.detail || null);
    } catch (e) {
      console.error("fetchDetail failed", e?.response?.data || e.message);
    }
  }

  async function fetchMetrics(id, roleArn, region) {
    try {
      const resp = await axios.post(`/api/aws/ec2/${id}/metrics`, { roleArn, region });
      setMetrics(resp.data.metrics || {});
    } catch (e) {
      console.error("fetchMetrics failed", e?.response?.data || e.message);
    }
  }

  async function fetchActivities(id, roleArn, region) {
    try {
      const resp = await axios.post(`/api/aws/ec2/${id}/activity`, { roleArn, region });
      setActivities(resp.data.activities || []);
    } catch (e) {
      console.error("fetchActivities failed", e?.response?.data || e.message);
    }
  }

  async function fetchSecurity(id, roleArn, region) {
    try {
      const resp = await axios.post(`/api/aws/ec2/${id}/security`, { roleArn, region });
      setSecurityAnalysis(resp.data.analysis || null);
    } catch (e) {
      console.error("fetchSecurity failed", e?.response?.data || e.message);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = instances.slice();
    if (q) list = list.filter((i) => (i.instanceName || "").toLowerCase().includes(q) || (i.instanceId || "").toLowerCase().includes(q));
    list.sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (!aVal && !bVal) return 0;
      if (!aVal) return 1;
      if (!bVal) return -1;
      if (sortKey === "launchTime") return sortDir === "desc" ? new Date(bVal) - new Date(aVal) : new Date(aVal) - new Date(bVal);
      if (aVal < bVal) return sortDir === "desc" ? 1 : -1;
      if (aVal > bVal) return sortDir === "desc" ? -1 : 1;
      return 0;
    });
    return list;
  }, [instances, search, sortKey, sortDir]);

  function exportCSV() {
    const cols = ["instanceName", "instanceId", "state", "instanceType", "region", "availabilityZone", "launchTime"];
    const rows = [cols.join(",")].concat(
      filtered.map((r) => cols.map((c) => `"${String(r[c] || "").replace(/"/g, '""')}"`).join(","))
    );
    const csv = rows.join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ec2-inventory-${new Date().toISOString()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function Sparkline({ values = [], color = "#60a5fa" }) {
    if (!values || values.length === 0) return <div className="text-slate-400">No data</div>;
    const max = Math.max(...values);
    const min = Math.min(...values);
    const w = 140;
    const h = 40;
    const pts = values.map((v, i) => {
      const x = (i / (values.length - 1 || 1)) * w;
      const y = h - ((v - min) / ((max - min) || 1)) * h;
      return `${x},${y}`;
    });
    return (
      <svg width={w} height={h} className="block">
        <polyline fill="none" stroke={color} strokeWidth="2" points={pts.join(" ")} />
      </svg>
    );
  }

  return (
    <div className="min-h-screen bg-[#070d1d] text-slate-100">
      <div className="flex min-h-screen">
        <Sidebar active="ec2" accountId={account.accountId} region={account.region} />

        <main className="flex-1 px-7 py-5">
          <header className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div>
              <button
                type="button"
                onClick={() => navigate("/dashboard")}
                className="inline-flex items-center gap-2 text-sm text-slate-300 hover:text-white"
              >
                <ArrowLeft className="h-4 w-4" /> Back to dashboard
              </button>
              <h1 className="mt-4 text-4xl font-bold tracking-tight">EC2 Inventory</h1>
              <p className="mt-1 text-slate-400">Live instances from the connected AWS account</p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm text-slate-300">
              {instances.length} instances discovered
            </div>
          </header>

          <section className="mt-6 grid grid-cols-12 gap-4">
            <div className="col-span-12 xl:col-span-8 rounded-2xl border border-slate-800 bg-slate-900 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-semibold">EC2 Instance Table</h2>
                  <p className="text-sm text-slate-400">Click a row to view the full instance details</p>
                </div>
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  <Server className="h-4 w-4" />
                  EC2
                </div>
              </div>

              <div className="mt-5 overflow-x-auto">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Search className="absolute left-2 top-2 h-4 w-4 text-slate-400" />
                      <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search by name or id"
                        className="pl-8 pr-3 py-2 rounded-md bg-slate-900 border border-slate-800 text-sm text-slate-200"
                      />
                    </div>
                    <select value={sortKey} onChange={(e) => setSortKey(e.target.value)} className="bg-slate-900 border border-slate-800 text-slate-300 text-sm py-2 px-2 rounded-md">
                      <option value="launchTime">Newest</option>
                      <option value="instanceName">Name</option>
                      <option value="instanceType">Type</option>
                      <option value="state">State</option>
                    </select>
                    <button onClick={() => setSortDir(sortDir === "desc" ? "asc" : "desc")} className="px-3 py-2 rounded-md bg-slate-800 text-sm text-slate-300">{sortDir === "desc" ? "Desc" : "Asc"}</button>
                  </div>

                  <div className="flex items-center gap-2">
                    <button onClick={exportCSV} className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white">
                      <Download className="h-4 w-4" /> Export CSV
                    </button>
                  </div>
                </div>

                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400">
                      <th className="py-3 font-medium">Instance Name</th>
                      <th className="py-3 font-medium">Instance ID</th>
                      <th className="py-3 font-medium">State</th>
                      <th className="py-3 font-medium">Type</th>
                      <th className="py-3 font-medium">Region</th>
                      <th className="py-3 font-medium">Zone</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr>
                        <td className="py-6 text-slate-400" colSpan={6}>
                          No EC2 instances match your filter or the connected account returned no instances.
                        </td>
                      </tr>
                    ) : (
                      filtered.map((instance) => (
                        <tr
                          key={instance.instanceId}
                          onClick={() => setSelectedId(instance.instanceId)}
                          className={`cursor-pointer border-b border-slate-800/80 transition hover:bg-slate-800/60 ${
                            selected?.instanceId === instance.instanceId ? "bg-slate-800/70" : ""
                          }`}
                        >
                          <td className="py-3 font-medium text-slate-100">{instance.instanceName || instance.resource}</td>
                          <td className="py-3 text-slate-300">{instance.instanceId}</td>
                          <td className="py-3 text-slate-300">{instance.state}</td>
                          <td className="py-3 text-slate-300">{instance.instanceType}</td>
                          <td className="py-3 text-slate-300">{instance.region}</td>
                          <td className="py-3 text-slate-300">{instance.availabilityZone}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="col-span-12 xl:col-span-4 rounded-2xl border border-slate-800 bg-slate-900 p-5">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-emerald-400" />
                <h2 className="text-2xl font-semibold">Instance Detail</h2>
              </div>
              {selected ? (
                <div className="mt-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="text-sm text-slate-400">Selected</div>
                      <div className="text-lg font-semibold">{selected.instanceName || selected.instanceId}</div>
                    </div>
                    <div className="text-sm text-slate-400">{selected.state}</div>
                  </div>

                  <div className="mt-4">
                    <div className="flex gap-2 flex-wrap">
                      {["General", "Networking", "Storage", "Monitoring", "Security", "Activity", "Cost"].map((t) => (
                        <button key={t} onClick={() => setActiveTab(t)} className={`px-3 py-1 rounded-md text-sm ${activeTab === t ? "bg-slate-800 text-white" : "bg-slate-900 text-slate-300"}`}>
                          {t}
                        </button>
                      ))}
                    </div>

                    <div className="mt-4 space-y-3">
                      {activeTab === "General" && (
                        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                          <div className="text-sm text-slate-400">General</div>
                          <div className="mt-2 grid grid-cols-2 gap-3">
                            <div>
                              <div className="text-xs text-slate-400">Instance ID</div>
                              <div className="text-slate-100">{selected.instanceId}</div>
                            </div>
                            <div>
                              <div className="text-xs text-slate-400">Type</div>
                              <div className="text-slate-100">{selected.instanceType}</div>
                            </div>
                            <div>
                              <div className="text-xs text-slate-400">AMI</div>
                              <div className="text-slate-100">{selected.amiId}</div>
                            </div>
                            <div>
                              <div className="text-xs text-slate-400">Launch Time</div>
                              <div className="text-slate-100">{formatDate(selected.launchTime)}</div>
                            </div>
                          </div>
                        </div>
                      )}

                      {activeTab === "Networking" && (
                        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                          <div className="text-sm text-slate-400">Networking</div>
                          <div className="mt-2 text-slate-100">
                            <div>Public IP: {selected.publicIp || "-"}</div>
                            <div>Private IP: {selected.privateIp || "-"}</div>
                            <div className="mt-2">Network Interfaces:</div>
                            <div className="mt-1 text-sm text-slate-300">
                              {(detail?.networkInterfaces || []).map((n) => (
                                <div key={n.NetworkInterfaceId} className="py-1">{n.NetworkInterfaceId} - {n.PrivateIpAddress} ({n.Status})</div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}

                      {activeTab === "Storage" && (
                        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                          <div className="text-sm text-slate-400">Storage</div>
                          <div className="mt-2 text-slate-100">
                            {(detail?.volumes || []).map((v) => (
                              <div key={v.VolumeId} className="py-1">{v.VolumeId} — {v.Size} GiB — {v.State}</div>
                            ))}
                            {!(detail?.volumes || []).length && <div className="text-slate-400">No volume details available.</div>}
                          </div>
                        </div>
                      )}

                      {activeTab === "Monitoring" && (
                        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                          <div className="text-sm text-slate-400">Monitoring (last 24h)</div>
                          <div className="mt-2">
                            <div className="flex items-center justify-between">
                              <div className="text-xs text-slate-400">CPU Utilization</div>
                              <div className="text-sm text-slate-200">{(metrics.cpu?.values?.[0] || "-")}</div>
                            </div>
                            <div className="mt-2"><Sparkline values={metrics.cpu?.values?.slice(0, 40).reverse() || []} /></div>

                            <div className="mt-3">
                              <div className="text-xs text-slate-400">Network In (sum)</div>
                              <div className="mt-1"><Sparkline values={metrics.netin?.values?.slice(0, 40).reverse() || []} color="#34d399" /></div>
                            </div>
                          </div>
                        </div>
                      )}

                      {activeTab === "Security" && (
                        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                          <div className="text-sm text-slate-400">Security Analysis</div>
                          <div className="mt-2 text-slate-100">
                            <div className="text-sm text-slate-300">Public Exposure</div>
                            {(securityAnalysis?.publicExposure || []).length ? (
                              (securityAnalysis.publicExposure || []).map((p, idx) => (
                                <div key={idx} className="py-1 text-sm">{p.groupId}: {p.protocol} {p.fromPort}-{p.toPort} open to {p.cidr}</div>
                              ))
                            ) : (
                              <div className="text-slate-400">No obvious public exposure detected.</div>
                            )}

                            <div className="mt-2 text-sm text-slate-300">SecurityHub Findings</div>
                            {(securityAnalysis?.securityFindings || []).length ? (
                              (securityAnalysis.securityFindings || []).map((f) => (
                                <div key={f.id} className="py-1 text-sm">{f.title} — Severity: {f.severity?.Label || "-"}</div>
                              ))
                            ) : (
                              <div className="text-slate-400">No SecurityHub findings related to this instance.</div>
                            )}
                          </div>
                        </div>
                      )}

                      {activeTab === "Activity" && (
                        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                          <div className="text-sm text-slate-400">CloudTrail Activity</div>
                          <div className="mt-2 text-slate-100">
                            {(activities || []).length === 0 ? (
                              <div className="text-slate-400">No recent activity found.</div>
                            ) : (
                              <div className="space-y-2 text-sm">
                                {(activities || []).slice(0, 10).map((a) => (
                                  <div key={a.eventId} className="border-b border-slate-800/40 pb-2">
                                    <div className="text-slate-200">{a.eventName}</div>
                                    <div className="text-slate-400 text-xs">{a.username} • {new Date(a.eventTime).toLocaleString()}</div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {activeTab === "Cost" && (
                        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                          <div className="text-sm text-slate-400">Cost Estimation</div>
                          <div className="mt-2 text-slate-100 text-sm">
                            <div>Account-level cost trend is available from the last scan.</div>
                            <div className="mt-2 text-slate-400">Per-instance cost estimation requires Cost Explorer with resource-level costs enabled. Use account Cost Explorer for precise billing details.</div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-6 text-slate-400">No EC2 instances available.</div>
              )}
            </div>
          </section>

          <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <div className="flex items-center gap-2 text-slate-300">
              <CalendarDays className="h-4 w-4" />
              Metadata
            </div>
            <p className="mt-2 text-sm text-slate-400">
              The page shows the EC2 instances returned from the connected account and keeps the selected instance detail in sync with the table.
            </p>
          </section>
        </main>
      </div>
    </div>
  );
}
