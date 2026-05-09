import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import api from "../services/api";
import { Search, Download, Bell, ShieldAlert, MessageSquare, Layers3, Clock3, Repeat2, ArrowRightLeft, AlertTriangle } from "lucide-react";
import Sidebar from "../components/Sidebar";
import { useAWSConnection } from "../context/AWSConnectionContext.jsx";

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!value) return "0 B";
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), sizes.length - 1);
  return `${(value / Math.pow(1024, index)).toFixed(2)} ${sizes[index]}`;
}

function SeverityPill({ severity }) {
  const style =
    severity === "Critical"
      ? "bg-red-500/15 text-red-300 border-red-500/30"
      : severity === "High"
        ? "bg-orange-500/15 text-orange-300 border-orange-500/30"
        : severity === "Medium"
          ? "bg-yellow-500/15 text-yellow-300 border-yellow-500/30"
          : "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";

  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${style}`}>{severity || "Low"}</span>;
}

function StatCard({ label, value, tone = "slate" }) {
  const toneMap = {
    slate: "from-slate-900 to-slate-950 border-slate-800",
    blue: "from-sky-950 to-slate-950 border-sky-900/50",
    emerald: "from-emerald-950 to-slate-950 border-emerald-900/50",
    amber: "from-amber-950 to-slate-950 border-amber-900/50",
    red: "from-red-950 to-slate-950 border-red-900/50",
  };

  return (
    <div className={`rounded-2xl border bg-gradient-to-br p-5 ${toneMap[tone] || toneMap.slate}`}>
      <div className="text-sm text-slate-400">{label}</div>
      <div className="mt-2 text-3xl font-bold text-white">{value}</div>
    </div>
  );
}

function TimelineItem({ item }) {
  return (
    <div className="flex gap-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
      <div className="mt-1 h-2.5 w-2.5 rounded-full bg-sky-400" />
      <div className="min-w-0">
        <div className="text-sm font-semibold text-slate-100">{item.eventName || item.action || "Activity"}</div>
        <div className="text-xs text-slate-400">{formatDate(item.eventTime || item.timestamp)}</div>
        <div className="mt-1 text-xs text-slate-300">{item.username || item.sourceIp || item.summary || "CloudTrail activity recorded"}</div>
      </div>
    </div>
  );
}

export default function SQSInventory() {
  const { connectedRole } = useAWSConnection();
  const [queues, setQueues] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [selectedQueue, setSelectedQueue] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [filterRegion, setFilterRegion] = useState("all");
  const [filterEncryption, setFilterEncryption] = useState("all");
  const [filterRisk, setFilterRisk] = useState("all");
  const [filterDlq, setFilterDlq] = useState("all");
  const [filterActivity, setFilterActivity] = useState("all");
  const [sortBy, setSortBy] = useState("name");
  const [showDrawer, setShowDrawer] = useState(false);
  const [activeTab, setActiveTab] = useState("general");
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    fetchQueues();
  }, [refreshToken]);

  useEffect(() => {
    const timer = setInterval(() => setRefreshToken((value) => value + 1), 45000);
    return () => clearInterval(timer);
  }, []);

  const roleArn = connectedRole?.roleArn || "";
  const region = connectedRole?.region || "us-east-1";
  const accountId = connectedRole?.accountId || "";

  async function fetchQueues() {
    try {
      setLoading(true);
      if (!roleArn) {
        throw new Error("roleArn required");
      }
      console.log("[SQS Frontend] Fetching queues for region:", region);
      const response = await api.post("/aws/sqs", { roleArn, region });
      
      // Safely handle response
      const fetchedQueues = response.data?.queues || [];
      const fetchedStats = response.data?.stats || {};
      
      console.log("[SQS Frontend] Successfully fetched", fetchedQueues.length, "queues");
      setQueues(fetchedQueues);
      setStats(fetchedStats);
      
      if (!selectedQueue && fetchedQueues.length > 0) {
        setSelectedQueue(fetchedQueues[0]);
      }
    } catch (error) {
      console.error("[SQS Frontend] Error fetching queues:", {
        message: error?.message,
        responseData: error?.response?.data,
        status: error?.response?.status,
        details: error?.response?.data?.message || "Unknown error",
      });
      setQueues([]);
      setStats({});
    } finally {
      setLoading(false);
    }
  }

  async function openQueue(queue) {
    try {
      setDetailLoading(true);
      if (!roleArn) {
        throw new Error("roleArn required");
      }
      console.log("[SQS Frontend] Fetching detail for queue:", queue.queueName);
      const response = await api.post(`/aws/sqs/${encodeURIComponent(queue.queueName)}`, { roleArn, region });
      const fetchedDetail = response.data?.detail || queue;
      setSelectedQueue(fetchedDetail);
      setShowDrawer(true);
      setActiveTab("general");
    } catch (error) {
      console.error("[SQS Frontend] Error fetching queue detail:", {
        message: error?.message,
        responseData: error?.response?.data,
        status: error?.response?.status,
        details: error?.response?.data?.message || "Unknown error",
      });
    } finally {
      setDetailLoading(false);
    }
  }

  const filteredQueues = useMemo(() => {
    return queues
      .filter((queue) => {
        const name = queue.queueName || "";
        const matchesSearch = name.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesType = filterType === "all" || queue.queueType === filterType;
        const matchesRegion = filterRegion === "all" || queue.region === filterRegion;
        const matchesEncryption =
          filterEncryption === "all" ||
          (filterEncryption === "enabled" ? queue.security?.encrypted : !queue.security?.encrypted);
        const matchesRisk = filterRisk === "all" || queue.security?.severity?.toLowerCase() === filterRisk.toLowerCase();
        const matchesDlq =
          filterDlq === "all" ||
          (filterDlq === "enabled" ? queue.messageDetails?.deadLetterQueue : !queue.messageDetails?.deadLetterQueue);
        const matchesActivity =
          filterActivity === "all" ||
          (filterActivity === "active" ? (queue.monitoring?.sent || 0) + (queue.monitoring?.received || 0) > 0 : true);
        return matchesSearch && matchesType && matchesRegion && matchesEncryption && matchesRisk && matchesDlq && matchesActivity;
      })
      .sort((a, b) => {
        switch (sortBy) {
          case "cost":
            return (b.cost?.totalMonthlyCost || 0) - (a.cost?.totalMonthlyCost || 0);
          case "messages":
            return (b.messageDetails?.approximateNumberOfMessages || 0) - (a.messageDetails?.approximateNumberOfMessages || 0);
          case "age":
            return (b.messageDetails?.oldestMessageAge || 0) - (a.messageDetails?.oldestMessageAge || 0);
          case "risk":
            return (a.security?.score || 0) - (b.security?.score || 0);
          default:
            return (a.queueName || "").localeCompare(b.queueName || "");
        }
      });
  }, [queues, searchTerm, filterType, filterRegion, filterEncryption, filterRisk, filterDlq, filterActivity, sortBy]);

  const regions = useMemo(() => [...new Set(queues.map((queue) => queue.region).filter(Boolean))], [queues]);

  const exportCsv = () => {
    const rows = [
      [
        "Queue Name",
        "Type",
        "Region",
        "Billing",
        "Encrypted",
        "DLQ",
        "Messages",
        "In Flight",
        "Oldest Age",
        "Risk",
        "Monthly Cost",
      ],
      ...filteredQueues.map((queue) => [
        queue.queueName,
        queue.queueType,
        queue.region,
        queue.billingMode || "-",
        queue.security?.encrypted ? "Yes" : "No",
        queue.messageDetails?.deadLetterQueue ? "Yes" : "No",
        queue.messageDetails?.approximateNumberOfMessages || 0,
        queue.messageDetails?.messagesInFlight || 0,
        queue.messageDetails?.oldestMessageAge || 0,
        queue.security?.severity || "Low",
        queue.cost?.totalMonthlyCost || 0,
      ]),
    ];

    const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sqs-queues.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const cardForSeverity = (severity) =>
    severity === "Critical"
      ? "red"
      : severity === "High"
        ? "amber"
        : severity === "Medium"
          ? "blue"
          : "emerald";

  if (loading) {
    return <div className="min-h-screen bg-[#070d1d] text-white p-8">Loading SQS queues...</div>;
  }

  if (!connectedRole) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-900 text-white">
        <div className="rounded-2xl border border-slate-800 bg-slate-950 p-8 text-center">
          <div className="text-2xl font-bold">No AWS account connected</div>
          <div className="mt-2 text-sm text-slate-400">Reconnect AWS account to view SQS queues.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#070d1d] text-slate-100">
      <div className="flex min-h-screen">
        <Sidebar active="sqs" accountId={selectedQueue?.accountId || accountId} region={region} />

        <main className="flex-1 px-7 py-5">
          <header className="flex flex-col gap-4 border-b border-slate-800 pb-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h1 className="text-4xl font-bold tracking-tight">Amazon SQS Monitoring</h1>
              <p className="mt-1 text-slate-400">Queue intelligence, message health, security posture, and cost visibility</p>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={fetchQueues}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-sm transition hover:border-sky-500/50 hover:bg-slate-800"
              >
                <Repeat2 className="h-4 w-4" />
                Refresh
              </button>
              <button
                onClick={exportCsv}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-sm transition hover:border-sky-500/50 hover:bg-slate-800"
              >
                <Download className="h-4 w-4" />
                CSV Export
              </button>
            </div>
          </header>

          <section className="mt-6 grid grid-cols-2 gap-4 xl:grid-cols-6">
            <StatCard label="Total Queues" value={stats.totalQueues || 0} tone="slate" />
            <StatCard label="FIFO Queues" value={stats.fifoQueues || 0} tone="blue" />
            <StatCard label="Encrypted" value={stats.encryptedQueues || 0} tone="emerald" />
            <StatCard label="DLQ Enabled" value={stats.dlqEnabled || 0} tone="amber" />
            <StatCard label="High Risk" value={stats.highRiskQueues || 0} tone="red" />
            <StatCard label="Est. Monthly Cost" value={`$${(stats.estimatedMonthlyCost || 0).toFixed(2)}`} tone="slate" />
          </section>

          <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-950/60 p-4 shadow-2xl shadow-slate-950/20">
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-3 2xl:grid-cols-6">
              <div className="relative xl:col-span-2 2xl:col-span-2">
                <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-500" />
                <input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search by queue name..."
                  className="w-full rounded-xl border border-slate-700 bg-slate-900 py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-sky-500"
                />
              </div>

              <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm outline-none">
                <option value="all">All Queue Types</option>
                <option value="Standard">Standard</option>
                <option value="FIFO">FIFO</option>
              </select>

              <select value={filterRegion} onChange={(e) => setFilterRegion(e.target.value)} className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm outline-none">
                <option value="all">All Regions</option>
                {regions.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>

              <select value={filterEncryption} onChange={(e) => setFilterEncryption(e.target.value)} className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm outline-none">
                <option value="all">All Encryption</option>
                <option value="enabled">Enabled</option>
                <option value="disabled">Disabled</option>
              </select>

              <select value={filterRisk} onChange={(e) => setFilterRisk(e.target.value)} className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm outline-none">
                <option value="all">All Risk Levels</option>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>

              <select value={filterDlq} onChange={(e) => setFilterDlq(e.target.value)} className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm outline-none">
                <option value="all">All DLQ States</option>
                <option value="enabled">DLQ Enabled</option>
                <option value="disabled">DLQ Disabled</option>
              </select>

              <select value={filterActivity} onChange={(e) => setFilterActivity(e.target.value)} className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm outline-none">
                <option value="all">All Activity</option>
                <option value="active">Active Queues</option>
              </select>

              <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm outline-none xl:col-span-2 2xl:col-span-2">
                <option value="name">Sort by Name</option>
                <option value="cost">Sort by Cost</option>
                <option value="messages">Sort by Messages</option>
                <option value="age">Sort by Age</option>
                <option value="risk">Sort by Risk</option>
              </select>
            </div>
          </section>

          <section className="mt-6 overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/60">
            <div className="max-h-[560px] overflow-auto">
              <table className="w-full border-separate border-spacing-0">
                <thead className="sticky top-0 z-10 bg-slate-950/95 backdrop-blur">
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                    <th className="px-5 py-4">Queue</th>
                    <th className="px-5 py-4">Type</th>
                    <th className="px-5 py-4">Region</th>
                    <th className="px-5 py-4">Messages</th>
                    <th className="px-5 py-4">In Flight</th>
                    <th className="px-5 py-4">Age</th>
                    <th className="px-5 py-4">DLQ</th>
                    <th className="px-5 py-4">Security</th>
                    <th className="px-5 py-4">Cost</th>
                    <th className="px-5 py-4">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredQueues.length > 0 ? (
                    filteredQueues.map((queue) => (
                      <tr
                        key={queue.queueName}
                        className="cursor-pointer border-t border-slate-900/80 transition hover:bg-slate-900/70"
                        onClick={() => openQueue(queue)}
                      >
                        <td className="px-5 py-4">
                          <div className="font-medium text-slate-100">{queue.queueName}</div>
                          <div className="mt-1 text-xs text-slate-400">{queue.queueUrl}</div>
                        </td>
                        <td className="px-5 py-4 text-sm text-slate-300">{queue.queueType}</td>
                        <td className="px-5 py-4 text-sm text-slate-300">{queue.region}</td>
                        <td className="px-5 py-4 text-sm text-slate-300">{queue.messageDetails?.approximateNumberOfMessages || 0}</td>
                        <td className="px-5 py-4 text-sm text-slate-300">{queue.messageDetails?.messagesInFlight || 0}</td>
                        <td className="px-5 py-4 text-sm text-slate-300">{Math.round(queue.messageDetails?.oldestMessageAge || 0)}s</td>
                        <td className="px-5 py-4 text-sm text-slate-300">{queue.messageDetails?.deadLetterQueue ? queue.messageDetails?.dlqName || "Enabled" : "No DLQ"}</td>
                        <td className="px-5 py-4">
                          <SeverityPill severity={queue.security?.severity} />
                        </td>
                        <td className="px-5 py-4 text-sm font-semibold text-amber-300">${(queue.cost?.totalMonthlyCost || 0).toFixed(2)}</td>
                        <td className="px-5 py-4 text-sm text-sky-300">View</td>
                      </tr>
                    ))
                  ) : queues.length === 0 ? (
                    <tr>
                      <td className="px-5 py-16 text-center" colSpan={10}>
                        <div className="flex flex-col items-center gap-2 text-slate-400">
                          <MessageSquare className="h-8 w-8 opacity-50" />
                          <div className="font-medium">No SQS queues found</div>
                          <div className="text-xs">This AWS account has no SQS queues</div>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    <tr>
                      <td className="px-5 py-16 text-center text-slate-400" colSpan={10}>
                        No queues match the current filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </main>
      </div>

      {showDrawer && selectedQueue && (
        <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={() => setShowDrawer(false)}>
          <div className="ml-auto h-full w-full max-w-6xl overflow-hidden border-l border-slate-800 bg-[#081122] shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between border-b border-slate-800 px-6 py-5">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-2xl font-bold text-white">{selectedQueue.queueName}</h2>
                  <SeverityPill severity={selectedQueue.security?.severity} />
                </div>
                <p className="mt-1 text-sm text-slate-400">{selectedQueue.queueUrl}</p>
              </div>
              <button onClick={() => setShowDrawer(false)} className="rounded-full border border-slate-700 bg-slate-900 p-2 text-slate-300 transition hover:bg-slate-800">
                ✕
              </button>
            </div>

            <div className="flex gap-2 overflow-x-auto border-b border-slate-800 px-4 py-3 text-sm">
              {[
                ["general", "General"],
                ["messages", "Messages"],
                ["security", "Security"],
                ["monitoring", "Monitoring"],
                ["activity", "Activity"],
                ["integrations", "Integrations"],
                ["findings", "Findings"],
                ["compliance", "Compliance"],
                ["cost", "Cost"],
                ["dlq", "Dead Letter Queue"],
              ].map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setActiveTab(key)}
                  className={`rounded-full px-4 py-2 transition ${activeTab === key ? "bg-sky-500/15 text-sky-300" : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"}`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="h-[calc(100%-140px)] overflow-auto px-6 py-6">
              {detailLoading ? (
                <div className="text-slate-400">Loading queue intelligence...</div>
              ) : (
                <div className="space-y-6">
                  {activeTab === "general" && (
                    <div className="grid gap-4 lg:grid-cols-2">
                      <StatCard label="Queue Type" value={selectedQueue.queueType} tone="blue" />
                      <StatCard label="Creation Date" value={formatDate(selectedQueue.creationDate)} tone="slate" />
                      <StatCard label="Visibility Timeout" value={`${selectedQueue.visibilityTimeout || 0}s`} tone="slate" />
                      <StatCard label="Retention Period" value={`${selectedQueue.messageRetentionPeriod || 0}s`} tone="slate" />
                      <StatCard label="Delay Seconds" value={`${selectedQueue.delaySeconds || 0}s`} tone="slate" />
                      <StatCard label="Max Message Size" value={formatBytes(selectedQueue.maximumMessageSize)} tone="slate" />
                    </div>
                  )}

                  {activeTab === "messages" && (
                    <div className="grid gap-4 lg:grid-cols-4">
                      <StatCard label="Messages" value={selectedQueue.messageDetails?.approximateNumberOfMessages || 0} tone="blue" />
                      <StatCard label="In Flight" value={selectedQueue.messageDetails?.messagesInFlight || 0} tone="amber" />
                      <StatCard label="Delayed" value={selectedQueue.messageDetails?.delayedMessages || 0} tone="emerald" />
                      <StatCard label="Oldest Age" value={`${Math.round(selectedQueue.messageDetails?.oldestMessageAge || 0)}s`} tone="red" />
                    </div>
                  )}

                  {activeTab === "security" && (
                    <div className="grid gap-4 lg:grid-cols-2">
                      <StatCard label="Security Score" value={`${selectedQueue.security?.score || 0}/100`} tone={cardForSeverity(selectedQueue.security?.severity)} />
                      <StatCard label="Encryption" value={selectedQueue.security?.encrypted ? "Enabled" : "Disabled"} tone={selectedQueue.security?.encrypted ? "emerald" : "red"} />
                      <StatCard label="DLQ" value={selectedQueue.messageDetails?.deadLetterQueue ? "Enabled" : "Disabled"} tone={selectedQueue.messageDetails?.deadLetterQueue ? "emerald" : "red"} />
                      <StatCard label="Cross-account Access" value={selectedQueue.security?.crossAccountAccess ? "Detected" : "Not Detected"} tone={selectedQueue.security?.crossAccountAccess ? "amber" : "emerald"} />
                      <div className="lg:col-span-2 rounded-2xl border border-slate-800 bg-slate-950/50 p-5">
                        <h3 className="text-lg font-semibold">Security Findings</h3>
                        <div className="mt-4 space-y-2 text-sm text-slate-300">
                          {(selectedQueue.security?.findings || []).map((finding, index) => (
                            <div key={index} className="flex items-start gap-2 rounded-lg border border-slate-800 bg-slate-900/50 p-3">
                              <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-400" />
                              <span>{finding}</span>
                            </div>
                          ))}
                          {!selectedQueue.security?.findings?.length && <div className="text-slate-400">No findings detected.</div>}
                        </div>
                      </div>
                    </div>
                  )}

                  {activeTab === "monitoring" && (
                    <div className="grid gap-4 lg:grid-cols-4">
                      <StatCard label="Messages Sent" value={selectedQueue.monitoring?.sent || 0} tone="blue" />
                      <StatCard label="Messages Received" value={selectedQueue.monitoring?.received || 0} tone="blue" />
                      <StatCard label="Messages Deleted" value={selectedQueue.monitoring?.deleted || 0} tone="emerald" />
                      <StatCard label="Empty Receives" value={selectedQueue.monitoring?.emptyReceives || 0} tone="amber" />
                      <StatCard label="Failed Processing" value={selectedQueue.monitoring?.failedProcessing || 0} tone="red" />
                      <StatCard label="Consumer Health" value={selectedQueue.monitoring?.consumerHealth || "Idle"} tone="slate" />
                      <StatCard label="Processing Rate" value={`${Math.round(selectedQueue.monitoring?.processingRate || 0)}%`} tone="emerald" />
                      <StatCard label="Queue Latency" value={`${Math.round(selectedQueue.monitoring?.oldestAge || 0)}s`} tone="amber" />
                    </div>
                  )}

                  {activeTab === "activity" && (
                    <div className="space-y-3">
                      {(selectedQueue.activity || []).slice(0, 12).map((item) => <TimelineItem key={item.eventId || `${item.eventName}-${item.eventTime}`} item={item} />)}
                      {!selectedQueue.activity?.length && <div className="text-slate-400">No recent CloudTrail activity found.</div>}
                    </div>
                  )}

                  {activeTab === "integrations" && (
                    <div className="grid gap-4 lg:grid-cols-2">
                      <StatCard label="Lambda Triggers" value={(selectedQueue.integrations?.lambdaTriggers || []).length} tone="blue" />
                      <StatCard label="SNS Subscriptions" value={(selectedQueue.integrations?.snsSubscriptions || []).length} tone="slate" />
                      <StatCard label="EventBridge Integrations" value={(selectedQueue.integrations?.eventBridgeIntegrations || []).length} tone="slate" />
                      <StatCard label="Connected Services" value={(selectedQueue.integrations?.connectedServices || []).length} tone="emerald" />
                    </div>
                  )}

                  {activeTab === "findings" && (
                    <div className="space-y-2">
                      {(selectedQueue.findings || []).map((finding, index) => (
                        <div key={index} className="rounded-xl border border-slate-800 bg-slate-950/50 p-4 text-sm text-slate-200">
                          {finding}
                        </div>
                      ))}
                      {!selectedQueue.findings?.length && <div className="text-slate-400">No high-risk findings detected.</div>}
                    </div>
                  )}

                  {activeTab === "compliance" && (
                    <div className="grid gap-4 lg:grid-cols-2">
                      <StatCard label="Compliance Status" value={selectedQueue.security?.severity === "Low" ? "Pass" : "Review"} tone={selectedQueue.security?.severity === "Low" ? "emerald" : "amber"} />
                      <StatCard label="Public Access" value={selectedQueue.security?.publicAccess ? "Detected" : "Not Detected"} tone={selectedQueue.security?.publicAccess ? "red" : "emerald"} />
                    </div>
                  )}

                  {activeTab === "cost" && (
                    <div className="grid gap-4 lg:grid-cols-4">
                      <StatCard label="Monthly Cost" value={`$${(selectedQueue.cost?.totalMonthlyCost || 0).toFixed(2)}`} tone="amber" />
                      <StatCard label="Request Cost" value={`$${(selectedQueue.cost?.requestCost || 0).toFixed(2)}`} tone="blue" />
                      <StatCard label="Payload Transfer" value={`$${(selectedQueue.cost?.payloadTransferCost || 0).toFixed(2)}`} tone="slate" />
                      <StatCard label="Encryption Cost" value={`$${(selectedQueue.cost?.encryptionCost || 0).toFixed(2)}`} tone="emerald" />
                    </div>
                  )}

                  {activeTab === "dlq" && (
                    <div className="space-y-4">
                      <StatCard label="DLQ Status" value={selectedQueue.messageDetails?.deadLetterQueue ? "Enabled" : "Disabled"} tone={selectedQueue.messageDetails?.deadLetterQueue ? "emerald" : "red"} />
                      <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-5 text-sm text-slate-300">
                        <div className="text-slate-400">DLQ Name</div>
                        <div className="mt-1 font-medium text-white">{selectedQueue.messageDetails?.dlqName || "Not configured"}</div>
                      </div>
                      <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-5 text-sm text-slate-300">
                        <div className="text-slate-400">Redrive Policy</div>
                        <pre className="mt-2 overflow-auto rounded-xl bg-slate-900 p-4 text-xs text-slate-200">{JSON.stringify(selectedQueue.messageDetails?.redrivePolicy || {}, null, 2)}</pre>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
