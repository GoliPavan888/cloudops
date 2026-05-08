import React from "react";
import { Search, Repeat } from "lucide-react";

export default function Topbar({ onScan }) {
  return (
    <div className="flex items-center justify-between mb-6">
      <div className="flex items-center gap-4">
        <div className="text-2xl font-semibold">Scan AWS</div>
        <div className="relative">
          <Search className="absolute left-3 top-3 text-slate-400" />
          <input
            placeholder="Search users..."
            className="pl-10 pr-4 py-2 rounded-lg bg-slate-800 text-slate-200 border border-slate-700"
          />
        </div>
      </div>

      <div className="flex items-center gap-4">
        <button
          onClick={onScan}
          className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg flex items-center gap-2"
        >
          <Repeat /> Scan AWS
        </button>
      </div>
    </div>
  );
}
