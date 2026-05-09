import React, { useState, useEffect } from "react";
import { ChevronDown, Search, Filter, AlertTriangle, Lock, TrendingUp, Database } from "lucide-react";
import api from "../services/api";
import { useAWSConnection } from "../context/AWSConnectionContext.jsx";

export default function CloudWatchLogs() {
  const { connectedRole } = useAWSConnection();
  const [logGroups, setLogGroups] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [selectedLog, setSelectedLog] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterSeverity, setFilterSeverity] = useState("all");
  const [sortBy, setSortBy] = useState("name");
  const [showDetailPanel, setShowDetailPanel] = useState(false);

  useEffect(() => {
    if (!connectedRole) return;
    fetchCloudWatchLogs();
  }, [connectedRole]);

  const fetchCloudWatchLogs = async () => {
    try {
      setLoading(true);
      const response = await api.post("/aws/logs", { roleArn: connectedRole?.roleArn, region: connectedRole?.region });
      setLogGroups(response.data.logGroups || []);
      setStats(response.data.stats || {});
    } catch (error) {
      console.error("Failed to fetch CloudWatch Logs:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectLog = async (logGroup) => {
    try {
      const response = await api.post(`/aws/logs/${encodeURIComponent(logGroup.logGroupName)}`, { roleArn: connectedRole?.roleArn, region: connectedRole?.region });
      setSelectedLog(response.data.detail);
      setShowDetailPanel(true);
    } catch (error) {
      console.error("Failed to fetch log group details:", error);
    }
  };

  const filteredLogs = logGroups
    .filter((lg) => {
      const matchesSearch = lg.logGroupName.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesSeverity =
        filterSeverity === "all" || lg.security?.severity?.toLowerCase() === filterSeverity.toLowerCase();
      return matchesSearch && matchesSeverity;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case "cost":
          return (b.cost?.totalMonthlyCost || 0) - (a.cost?.totalMonthlyCost || 0);
        case "size":
          return (b.storedBytes || 0) - (a.storedBytes || 0);
        case "events":
          return (b.analysis?.totalLogEvents || 0) - (a.analysis?.totalLogEvents || 0);
        default:
          return a.logGroupName.localeCompare(b.logGroupName);
      }
    });

  const getSeverityColor = (severity) => {
    switch (severity) {
      case "Critical":
        return "bg-red-900/30 text-red-300 border-red-700";
      case "High":
        return "bg-orange-900/30 text-orange-300 border-orange-700";
      case "Medium":
        return "bg-yellow-900/30 text-yellow-300 border-yellow-700";
      default:
        return "bg-green-900/30 text-green-300 border-green-700";
    }
  };

  const formatBytes = (bytes) => {
    if (!bytes) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-900">
        <div className="text-white">Loading CloudWatch Logs...</div>
      </div>
    );
  }

  if (!connectedRole) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-900 text-white">
        <div className="rounded-2xl border border-slate-800 bg-slate-950 p-8 text-center">
          <div className="text-2xl font-bold">No AWS account connected</div>
          <div className="mt-2 text-sm text-slate-400">Reconnect AWS account to view CloudWatch Logs.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white p-6">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">CloudWatch Logs Monitoring</h1>
        <p className="text-slate-400">Enterprise log analytics and observability dashboard</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <div className="text-slate-400 text-sm mb-1">Total Log Groups</div>
          <div className="text-2xl font-bold">{stats.totalLogGroups || 0}</div>
        </div>
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <div className="text-slate-400 text-sm mb-1">With Encryption</div>
          <div className="text-2xl font-bold">{stats.withEncryption || 0}</div>
        </div>
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <div className="text-slate-400 text-sm mb-1">High Risk</div>
          <div className="text-2xl font-bold text-red-400">{stats.highRisk || 0}</div>
        </div>
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <div className="text-slate-400 text-sm mb-1">Est. Monthly Cost</div>
          <div className="text-2xl font-bold text-yellow-400">${stats.estimatedMonthlyCost?.toFixed(2) || "0.00"}</div>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 mb-6">
        <div className="flex gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-3 text-slate-500" size={20} />
            <input
              type="text"
              placeholder="Search log groups..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-slate-700 rounded border border-slate-600 text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
            />
          </div>
          <select
            value={filterSeverity}
            onChange={(e) => setFilterSeverity(e.target.value)}
            className="px-4 py-2 bg-slate-700 rounded border border-slate-600 text-white focus:outline-none focus:border-blue-500"
          >
            <option value="all">All Severities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="px-4 py-2 bg-slate-700 rounded border border-slate-600 text-white focus:outline-none focus:border-blue-500"
          >
            <option value="name">Sort by Name</option>
            <option value="cost">Sort by Cost</option>
            <option value="size">Sort by Size</option>
            <option value="events">Sort by Events</option>
          </select>
        </div>
      </div>

      {/* Log Groups Table */}
      <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-900 border-b border-slate-700">
              <tr>
                <th className="px-6 py-3 text-left text-sm font-semibold">Log Group Name</th>
                <th className="px-6 py-3 text-left text-sm font-semibold">Source</th>
                <th className="px-6 py-3 text-left text-sm font-semibold">Streams</th>
                <th className="px-6 py-3 text-left text-sm font-semibold">Size</th>
                <th className="px-6 py-3 text-left text-sm font-semibold">Errors</th>
                <th className="px-6 py-3 text-left text-sm font-semibold">Security</th>
                <th className="px-6 py-3 text-left text-sm font-semibold">Cost</th>
                <th className="px-6 py-3 text-left text-sm font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan="8" className="px-6 py-8 text-center text-slate-400">
                    No log groups found
                  </td>
                </tr>
              ) : (
                filteredLogs.map((lg) => (
                  <tr
                    key={lg.logGroupName}
                    className="border-b border-slate-700 hover:bg-slate-700/50 cursor-pointer transition"
                    onClick={() => handleSelectLog(lg)}
                  >
                    <td className="px-6 py-4">
                      <div className="font-mono text-sm text-blue-400">{lg.logGroupName}</div>
                    </td>
                    <td className="px-6 py-4 text-sm">{lg.source}</td>
                    <td className="px-6 py-4 text-sm">{lg.logStreamCount}</td>
                    <td className="px-6 py-4 text-sm">{formatBytes(lg.storedBytes)}</td>
                    <td className="px-6 py-4 text-sm">
                      <span className={lg.analysis?.errorCount > 0 ? "text-red-400 font-semibold" : ""}>
                        {lg.analysis?.errorCount || 0}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <span className={`px-2 py-1 rounded text-xs font-semibold border ${getSeverityColor(lg.security?.severity)}`}>
                        {lg.security?.severity}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-yellow-400 font-semibold">
                      ${lg.cost?.totalMonthlyCost?.toFixed(2)}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <button className="text-blue-400 hover:text-blue-300 font-semibold">View</button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail Panel */}
      {showDetailPanel && selectedLog && (
        <div className="fixed inset-0 bg-black/60 z-40 overflow-auto" onClick={() => setShowDetailPanel(false)}>
          <div
            className="bg-slate-800 border border-slate-700 rounded-lg m-6 max-w-4xl mx-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close Button */}
            <div className="flex justify-between items-center p-6 border-b border-slate-700">
              <h2 className="text-2xl font-bold">{selectedLog.logGroupName}</h2>
              <button
                onClick={() => setShowDetailPanel(false)}
                className="text-slate-400 hover:text-white text-2xl"
              >
                ×
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-slate-700">
              <button className="px-6 py-3 border-b-2 border-blue-500 font-semibold">General</button>
              <button className="px-6 py-3 text-slate-400 hover:text-white">Log Streams</button>
              <button className="px-6 py-3 text-slate-400 hover:text-white">Analytics</button>
              <button className="px-6 py-3 text-slate-400 hover:text-white">Security</button>
              <button className="px-6 py-3 text-slate-400 hover:text-white">Cost</button>
              <button className="px-6 py-3 text-slate-400 hover:text-white">Findings</button>
            </div>

            {/* General Tab Content */}
            <div className="p-6 space-y-4 max-h-96 overflow-auto">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-slate-400 text-sm">Log Group ARN</label>
                  <div className="font-mono text-sm text-blue-300 break-all">{selectedLog.arn}</div>
                </div>
                <div>
                  <label className="text-slate-400 text-sm">Account ID</label>
                  <div className="font-mono text-sm">{selectedLog.accountId}</div>
                </div>
                <div>
                  <label className="text-slate-400 text-sm">Region</label>
                  <div className="font-mono text-sm">{selectedLog.region}</div>
                </div>
                <div>
                  <label className="text-slate-400 text-sm">Source Service</label>
                  <div className="font-mono text-sm">{selectedLog.source}</div>
                </div>
                <div>
                  <label className="text-slate-400 text-sm">Creation Date</label>
                  <div className="font-mono text-sm">{selectedLog.creationTime ? new Date(selectedLog.creationTime).toLocaleDateString() : "N/A"}</div>
                </div>
                <div>
                  <label className="text-slate-400 text-sm">Retention Period</label>
                  <div className="font-mono text-sm">{selectedLog.retentionInDays}</div>
                </div>
                <div>
                  <label className="text-slate-400 text-sm">Stored Size</label>
                  <div className="font-mono text-sm">{formatBytes(selectedLog.storedBytes)}</div>
                </div>
                <div>
                  <label className="text-slate-400 text-sm">Log Streams</label>
                  <div className="font-mono text-sm">{selectedLog.logStreamCount}</div>
                </div>
              </div>

              {/* Analytics Section */}
              <div className="mt-6 pt-6 border-t border-slate-700">
                <h3 className="font-semibold mb-3">Log Analytics</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-slate-700/50 rounded p-3">
                    <div className="text-slate-400 text-sm">Total Events</div>
                    <div className="text-2xl font-bold">{selectedLog.analysis?.totalLogEvents || 0}</div>
                  </div>
                  <div className="bg-slate-700/50 rounded p-3">
                    <div className="text-slate-400 text-sm">Error Count</div>
                    <div className="text-2xl font-bold text-red-400">{selectedLog.analysis?.errorCount || 0}</div>
                  </div>
                  <div className="bg-slate-700/50 rounded p-3">
                    <div className="text-slate-400 text-sm">Warning Count</div>
                    <div className="text-2xl font-bold text-yellow-400">{selectedLog.analysis?.warningCount || 0}</div>
                  </div>
                  <div className="bg-slate-700/50 rounded p-3">
                    <div className="text-slate-400 text-sm">Failed Auth</div>
                    <div className="text-2xl font-bold text-orange-400">{selectedLog.analysis?.failedAuthAttempts || 0}</div>
                  </div>
                </div>
              </div>

              {/* Security Section */}
              <div className="mt-6 pt-6 border-t border-slate-700">
                <h3 className="font-semibold mb-3 flex items-center gap-2">
                  <Lock size={18} />
                  Security Assessment
                </h3>
                <div className="flex gap-4 items-center">
                  <div className={`px-3 py-2 rounded border ${getSeverityColor(selectedLog.security?.severity)}`}>
                    {selectedLog.security?.severity}
                  </div>
                  <div className="text-sm">
                    <div className="font-semibold">Risk Score: {selectedLog.security?.score}/100</div>
                    <div className="text-slate-400">Encryption: {selectedLog.kmsKeyId ? "✓ Enabled" : "✗ Disabled"}</div>
                  </div>
                </div>
              </div>

              {/* Cost Section */}
              <div className="mt-6 pt-6 border-t border-slate-700">
                <h3 className="font-semibold mb-3 flex items-center gap-2">
                  <TrendingUp size={18} />
                  Cost Analysis
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-slate-400 text-sm">Ingestion Cost</div>
                    <div className="text-xl font-bold">${selectedLog.cost?.ingestionCost?.toFixed(2)}/month</div>
                  </div>
                  <div>
                    <div className="text-slate-400 text-sm">Storage Cost</div>
                    <div className="text-xl font-bold">${selectedLog.cost?.storageCost?.toFixed(2)}/month</div>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-slate-700">
                  <div className="text-lg font-bold text-yellow-400">
                    Total: ${selectedLog.cost?.totalMonthlyCost?.toFixed(2)}/month
                  </div>
                </div>
              </div>

              {/* Findings */}
              {selectedLog.findings && selectedLog.findings.length > 0 && (
                <div className="mt-6 pt-6 border-t border-slate-700">
                  <h3 className="font-semibold mb-3 flex items-center gap-2">
                    <AlertTriangle size={18} className="text-red-400" />
                    Findings
                  </h3>
                  <ul className="space-y-2">
                    {selectedLog.findings.map((finding, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-sm">
                        <span className="text-red-400 mt-1">•</span>
                        <span>{finding}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
