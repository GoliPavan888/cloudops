import React, { useState, useEffect } from "react";
import { ChevronDown, Search, Filter, AlertTriangle, Lock, TrendingUp, Database } from "lucide-react";
import api from "../services/api";
import { useAWSConnection } from "../context/AWSConnectionContext.jsx";

export default function DynamoDBInventory() {
  const { connectedRole } = useAWSConnection();
  const [tables, setTables] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [selectedTable, setSelectedTable] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterBillingMode, setFilterBillingMode] = useState("all");
  const [filterSecurity, setFilterSecurity] = useState("all");
  const [sortBy, setSortBy] = useState("name");
  const [showDetailPanel, setShowDetailPanel] = useState(false);
  const [activeTab, setActiveTab] = useState("general");

  useEffect(() => {
    if (!connectedRole) return;
    fetchDynamoDBTables();
  }, [connectedRole]);

  const fetchDynamoDBTables = async () => {
    try {
      setLoading(true);
      const response = await api.post("/aws/dynamodb", { roleArn: connectedRole?.roleArn, region: connectedRole?.region });
      setTables(response.data.tables || []);
      setStats(response.data.stats || {});
    } catch (error) {
      console.error("Failed to fetch DynamoDB tables:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectTable = async (table) => {
    try {
      const response = await api.post(`/aws/dynamodb/${encodeURIComponent(table.tableName)}`, { roleArn: connectedRole?.roleArn, region: connectedRole?.region });
      setSelectedTable(response.data.detail);
      setShowDetailPanel(true);
      setActiveTab("general");
    } catch (error) {
      console.error("Failed to fetch table details:", error);
    }
  };

  const filteredTables = tables
    .filter((t) => {
      const matchesSearch = t.tableName.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesBilling = filterBillingMode === "all" || t.billingMode === filterBillingMode;
      const matchesSecurity =
        filterSecurity === "all" || t.security?.severity?.toLowerCase() === filterSecurity.toLowerCase();
      return matchesSearch && matchesBilling && matchesSecurity;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case "cost":
          return (b.cost?.totalMonthlyCost || 0) - (a.cost?.totalMonthlyCost || 0);
        case "size":
          return (b.tableSize || 0) - (a.tableSize || 0);
        case "items":
          return (b.itemCount || 0) - (a.itemCount || 0);
        default:
          return a.tableName.localeCompare(b.tableName);
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

  const getStatusColor = (status) => {
    switch (status) {
      case "ACTIVE":
        return "bg-green-900/30 text-green-300 border-green-700";
      case "CREATING":
        return "bg-blue-900/30 text-blue-300 border-blue-700";
      case "DELETING":
        return "bg-red-900/30 text-red-300 border-red-700";
      default:
        return "bg-slate-700/50 text-slate-300 border-slate-600";
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
        <div className="text-white">Loading DynamoDB Tables...</div>
      </div>
    );
  }

  if (!connectedRole) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-900 text-white">
        <div className="rounded-2xl border border-slate-800 bg-slate-950 p-8 text-center">
          <div className="text-2xl font-bold">No AWS account connected</div>
          <div className="mt-2 text-sm text-slate-400">Reconnect AWS account to view DynamoDB tables.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white p-6">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">DynamoDB Database Monitoring</h1>
        <p className="text-slate-400">Enterprise table analytics and operational intelligence</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <div className="text-slate-400 text-sm mb-1">Total Tables</div>
          <div className="text-2xl font-bold">{stats.totalTables || 0}</div>
        </div>
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <div className="text-slate-400 text-sm mb-1">Encrypted Tables</div>
          <div className="text-2xl font-bold text-green-400">{stats.encryptedTables || 0}</div>
        </div>
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <div className="text-slate-400 text-sm mb-1">High Risk</div>
          <div className="text-2xl font-bold text-red-400">{stats.highRiskTables || 0}</div>
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
              placeholder="Search tables..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-slate-700 rounded border border-slate-600 text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
            />
          </div>
          <select
            value={filterBillingMode}
            onChange={(e) => setFilterBillingMode(e.target.value)}
            className="px-4 py-2 bg-slate-700 rounded border border-slate-600 text-white focus:outline-none focus:border-blue-500"
          >
            <option value="all">All Billing Modes</option>
            <option value="PROVISIONED">Provisioned</option>
            <option value="PAY_PER_REQUEST">On-Demand</option>
          </select>
          <select
            value={filterSecurity}
            onChange={(e) => setFilterSecurity(e.target.value)}
            className="px-4 py-2 bg-slate-700 rounded border border-slate-600 text-white focus:outline-none focus:border-blue-500"
          >
            <option value="all">All Security Levels</option>
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
            <option value="items">Sort by Items</option>
          </select>
        </div>
      </div>

      {/* Tables List */}
      <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-900 border-b border-slate-700">
              <tr>
                <th className="px-6 py-3 text-left text-sm font-semibold">Table Name</th>
                <th className="px-6 py-3 text-left text-sm font-semibold">Status</th>
                <th className="px-6 py-3 text-left text-sm font-semibold">Billing</th>
                <th className="px-6 py-3 text-left text-sm font-semibold">Items</th>
                <th className="px-6 py-3 text-left text-sm font-semibold">Size</th>
                <th className="px-6 py-3 text-left text-sm font-semibold">R/W Errors</th>
                <th className="px-6 py-3 text-left text-sm font-semibold">Security</th>
                <th className="px-6 py-3 text-left text-sm font-semibold">Cost</th>
                <th className="px-6 py-3 text-left text-sm font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredTables.length === 0 ? (
                <tr>
                  <td colSpan="9" className="px-6 py-8 text-center text-slate-400">
                    No tables found
                  </td>
                </tr>
              ) : (
                filteredTables.map((table) => (
                  <tr
                    key={table.tableName}
                    className="border-b border-slate-700 hover:bg-slate-700/50 cursor-pointer transition"
                    onClick={() => handleSelectTable(table)}
                  >
                    <td className="px-6 py-4">
                      <div className="font-mono text-sm text-blue-400">{table.tableName}</div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded text-xs font-semibold border ${getStatusColor(table.status)}`}>
                        {table.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm">{table.billingMode === "PAY_PER_REQUEST" ? "On-Demand" : "Provisioned"}</td>
                    <td className="px-6 py-4 text-sm">{table.itemCount.toLocaleString()}</td>
                    <td className="px-6 py-4 text-sm">{formatBytes(table.tableSize)}</td>
                    <td className="px-6 py-4 text-sm">
                      {table.metrics.totalErrors > 0 ? (
                        <span className="text-red-400 font-semibold">{table.metrics.totalErrors}</span>
                      ) : (
                        <span className="text-green-400">0</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <span className={`px-2 py-1 rounded text-xs font-semibold border ${getSeverityColor(table.security?.severity)}`}>
                        {table.security?.severity}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-yellow-400 font-semibold">
                      ${table.cost?.totalMonthlyCost?.toFixed(2)}
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
      {showDetailPanel && selectedTable && (
        <div className="fixed inset-0 bg-black/60 z-40 overflow-auto" onClick={() => setShowDetailPanel(false)}>
          <div
            className="bg-slate-800 border border-slate-700 rounded-lg m-6 max-w-5xl mx-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close Button */}
            <div className="flex justify-between items-center p-6 border-b border-slate-700">
              <h2 className="text-2xl font-bold">{selectedTable.tableName}</h2>
              <button onClick={() => setShowDetailPanel(false)} className="text-slate-400 hover:text-white text-2xl">
                ×
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-slate-700 overflow-x-auto">
              {["general", "indexes", "security", "monitoring", "activity", "streams", "findings", "cost"].map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-3 whitespace-nowrap font-semibold border-b-2 transition ${
                    activeTab === tab ? "border-blue-500 text-white" : "text-slate-400 hover:text-white border-b-2 border-transparent"
                  }`}
                >
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>

            {/* Tab Content */}
            <div className="p-6 space-y-4 max-h-96 overflow-auto">
              {activeTab === "general" && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-slate-400 text-sm">Table ARN</label>
                      <div className="font-mono text-sm text-blue-300 break-all">{selectedTable.arn}</div>
                    </div>
                    <div>
                      <label className="text-slate-400 text-sm">Account ID</label>
                      <div className="font-mono text-sm">{selectedTable.accountId}</div>
                    </div>
                    <div>
                      <label className="text-slate-400 text-sm">Region</label>
                      <div className="font-mono text-sm">{selectedTable.region}</div>
                    </div>
                    <div>
                      <label className="text-slate-400 text-sm">Status</label>
                      <div className="font-mono text-sm">{selectedTable.status}</div>
                    </div>
                    <div>
                      <label className="text-slate-400 text-sm">Creation Date</label>
                      <div className="font-mono text-sm">{new Date(selectedTable.creationTime).toLocaleDateString()}</div>
                    </div>
                    <div>
                      <label className="text-slate-400 text-sm">Billing Mode</label>
                      <div className="font-mono text-sm">{selectedTable.billingMode}</div>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-slate-700">
                    <h3 className="font-semibold mb-3">Capacity & Usage</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-slate-700/50 rounded p-3">
                        <div className="text-slate-400 text-sm">Item Count</div>
                        <div className="text-2xl font-bold">{selectedTable.itemCount.toLocaleString()}</div>
                      </div>
                      <div className="bg-slate-700/50 rounded p-3">
                        <div className="text-slate-400 text-sm">Table Size</div>
                        <div className="text-2xl font-bold">{formatBytes(selectedTable.tableSize)}</div>
                      </div>
                      {selectedTable.billingMode === "PROVISIONED" && (
                        <>
                          <div className="bg-slate-700/50 rounded p-3">
                            <div className="text-slate-400 text-sm">Read Capacity</div>
                            <div className="text-2xl font-bold">{selectedTable.readCapacity} RCU</div>
                          </div>
                          <div className="bg-slate-700/50 rounded p-3">
                            <div className="text-slate-400 text-sm">Write Capacity</div>
                            <div className="text-2xl font-bold">{selectedTable.writeCapacity} WCU</div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="pt-4 border-t border-slate-700">
                    <h3 className="font-semibold mb-3">Schema</h3>
                    <div className="space-y-2">
                      {selectedTable.keySchema?.map((key, idx) => (
                        <div key={idx} className="flex justify-between items-center bg-slate-700/50 p-2 rounded">
                          <span className="text-slate-300">{key.AttributeName}</span>
                          <span className="text-slate-400 text-sm">{key.KeyType}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "indexes" && (
                <div className="space-y-4">
                  {selectedTable.globalSecondaryIndexes?.length > 0 && (
                    <div>
                      <h3 className="font-semibold mb-3">Global Secondary Indexes</h3>
                      {selectedTable.globalSecondaryIndexes.map((gsi, idx) => (
                        <div key={idx} className="bg-slate-700/50 rounded p-4 mb-3">
                          <div className="font-semibold mb-2">{gsi.indexName}</div>
                          <div className="grid grid-cols-2 gap-2 text-sm text-slate-300">
                            <div>Status: {gsi.status}</div>
                            <div>Items: {gsi.itemCount || 0}</div>
                            <div>Size: {formatBytes(gsi.sizeBytes)}</div>
                            <div>
                              Capacity: {gsi.readCapacity} RCU / {gsi.writeCapacity} WCU
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {selectedTable.localSecondaryIndexes?.length > 0 && (
                    <div>
                      <h3 className="font-semibold mb-3">Local Secondary Indexes</h3>
                      {selectedTable.localSecondaryIndexes.map((lsi, idx) => (
                        <div key={idx} className="bg-slate-700/50 rounded p-4 mb-3">
                          <div className="font-semibold mb-2">{lsi.indexName}</div>
                          <div className="text-sm text-slate-300">Size: {formatBytes(lsi.sizeBytes)}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {selectedTable.globalSecondaryIndexes?.length === 0 && selectedTable.localSecondaryIndexes?.length === 0 && (
                    <p className="text-slate-400">No indexes defined</p>
                  )}
                </div>
              )}

              {activeTab === "security" && (
                <div className="space-y-4">
                  <div className="flex gap-4 items-center">
                    <div className={`px-3 py-2 rounded border ${getSeverityColor(selectedTable.security?.severity)}`}>
                      {selectedTable.security?.severity}
                    </div>
                    <div className="text-sm">
                      <div className="font-semibold">Risk Score: {selectedTable.security?.score}/100</div>
                      <div className="text-slate-400">Encryption: {selectedTable.encrypted ? "✓ Enabled" : "✗ Disabled"}</div>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-slate-700">
                    <h3 className="font-semibold mb-3">Security Controls</h3>
                    <div className="space-y-2">
                      <div className="flex justify-between items-center bg-slate-700/50 p-2 rounded">
                        <span>Encryption at Rest</span>
                        <span className={selectedTable.encrypted ? "text-green-400" : "text-red-400"}>
                          {selectedTable.encrypted ? "✓" : "✗"}
                        </span>
                      </div>
                      <div className="flex justify-between items-center bg-slate-700/50 p-2 rounded">
                        <span>Point-in-Time Recovery</span>
                        <span className={selectedTable.pitrEnabled ? "text-green-400" : "text-red-400"}>
                          {selectedTable.pitrEnabled ? "✓" : "✗"}
                        </span>
                      </div>
                      <div className="flex justify-between items-center bg-slate-700/50 p-2 rounded">
                        <span>Deletion Protection</span>
                        <span className={selectedTable.deletionProtected ? "text-green-400" : "text-red-400"}>
                          {selectedTable.deletionProtected ? "✓" : "✗"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {selectedTable.security?.findings?.length > 0 && (
                    <div className="pt-4 border-t border-slate-700">
                      <h3 className="font-semibold mb-3 flex items-center gap-2">
                        <AlertTriangle size={18} className="text-yellow-400" />
                        Findings
                      </h3>
                      <ul className="space-y-2">
                        {selectedTable.security.findings.map((finding, idx) => (
                          <li key={idx} className="flex items-start gap-2 text-sm">
                            <span className="text-yellow-400 mt-1">•</span>
                            <span>{finding}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {activeTab === "monitoring" && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-slate-700/50 rounded p-3">
                      <div className="text-slate-400 text-sm">Read Throttles (7d)</div>
                      <div className="text-2xl font-bold">{selectedTable.metrics?.readThrottles || 0}</div>
                    </div>
                    <div className="bg-slate-700/50 rounded p-3">
                      <div className="text-slate-400 text-sm">Write Throttles (7d)</div>
                      <div className="text-2xl font-bold">{selectedTable.metrics?.writeThrottles || 0}</div>
                    </div>
                    <div className="bg-slate-700/50 rounded p-3">
                      <div className="text-slate-400 text-sm">Consumed Read Capacity</div>
                      <div className="text-2xl font-bold">{selectedTable.metrics?.consumedReadCapacity || 0}</div>
                    </div>
                    <div className="bg-slate-700/50 rounded p-3">
                      <div className="text-slate-400 text-sm">Consumed Write Capacity</div>
                      <div className="text-2xl font-bold">{selectedTable.metrics?.consumedWriteCapacity || 0}</div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "activity" && (
                <div className="space-y-4">
                  {selectedTable.activity?.length > 0 ? (
                    <div className="space-y-2">
                      {selectedTable.activity.slice(0, 10).map((event, idx) => (
                        <div key={idx} className="bg-slate-700/50 rounded p-3 text-sm">
                          <div className="font-semibold text-blue-300">{event.eventName}</div>
                          <div className="text-slate-400">{new Date(event.eventTime).toLocaleString()}</div>
                          {event.username && <div className="text-slate-300">User: {event.username}</div>}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-slate-400">No activity found</p>
                  )}
                </div>
              )}

              {activeTab === "streams" && (
                <div className="space-y-4">
                  <div className="bg-slate-700/50 rounded p-3">
                    <div className="text-slate-400 text-sm">DynamoDB Streams</div>
                    <div className="font-semibold">{selectedTable.streamStatus || "DISABLED"}</div>
                  </div>
                  {selectedTable.streamArn && (
                    <div className="bg-slate-700/50 rounded p-3">
                      <div className="text-slate-400 text-sm">Stream ARN</div>
                      <div className="font-mono text-xs text-blue-300 break-all">{selectedTable.streamArn}</div>
                    </div>
                  )}
                  {selectedTable.ttlAttribute && (
                    <div className="bg-slate-700/50 rounded p-3">
                      <div className="text-slate-400 text-sm">TTL Attribute</div>
                      <div className="font-semibold">{selectedTable.ttlAttribute}</div>
                    </div>
                  )}
                </div>
              )}

              {activeTab === "findings" && (
                <div className="space-y-4">
                  {selectedTable.security?.risks?.length > 0 ? (
                    <ul className="space-y-2">
                      {selectedTable.security.risks.map((risk, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-sm">
                          <span className="text-red-400 mt-1">⚠</span>
                          <span>{risk}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-green-400">No critical risks found</p>
                  )}
                </div>
              )}

              {activeTab === "cost" && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-slate-700/50 rounded p-3">
                      <div className="text-slate-400 text-sm">Read Capacity Cost</div>
                      <div className="text-xl font-bold">${selectedTable.cost?.readCost?.toFixed(2) || "0.00"}/mo</div>
                    </div>
                    <div className="bg-slate-700/50 rounded p-3">
                      <div className="text-slate-400 text-sm">Write Capacity Cost</div>
                      <div className="text-xl font-bold">${selectedTable.cost?.writeCost?.toFixed(2) || "0.00"}/mo</div>
                    </div>
                    <div className="bg-slate-700/50 rounded p-3">
                      <div className="text-slate-400 text-sm">Storage Cost</div>
                      <div className="text-xl font-bold">${selectedTable.cost?.storageCost?.toFixed(2) || "0.00"}/mo</div>
                    </div>
                    <div className="bg-slate-700/50 rounded p-3">
                      <div className="text-slate-400 text-sm">Index Cost</div>
                      <div className="text-xl font-bold">${selectedTable.cost?.indexCost?.toFixed(2) || "0.00"}/mo</div>
                    </div>
                  </div>
                  <div className="mt-4 pt-4 border-t border-slate-700">
                    <div className="text-lg font-bold text-yellow-400">
                      Total: ${selectedTable.cost?.totalMonthlyCost?.toFixed(2) || "0.00"}/month
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
