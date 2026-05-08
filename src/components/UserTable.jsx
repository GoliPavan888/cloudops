import React from "react";
import { useState } from "react";

export default function UserTable({ users = [], onSelect }) {
  const [page, setPage] = useState(1);
  const per = 8;
  const pages = Math.max(1, Math.ceil(users.length / per));

  const visible = users.slice((page - 1) * per, page * per);

  return (
    <div>
      <div className="bg-slate-900 mt-4 rounded-2xl border border-slate-800 overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-800">
            <tr>
              <th className="text-left p-5">User Name</th>
              <th className="text-left p-5">Status</th>
              <th className="text-left p-5">Created On</th>
              <th className="text-left p-5">Last Access</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((u, i) => (
              <tr
                key={i}
                onClick={() => onSelect && onSelect(u)}
                className="border-t border-slate-800 hover:bg-slate-800 transition cursor-pointer"
              >
                <td className="p-5 text-blue-300">{u.userName}</td>
                <td className="p-5 text-slate-300">{u.status || "Active"}</td>
                <td className="p-5 text-slate-300">{u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "-"}</td>
                <td className="p-5 text-slate-300">{u.lastAccess ? new Date(u.lastAccess).toLocaleDateString() : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-end gap-2 mt-3 text-slate-300">
        <button
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          className="px-3 py-1 bg-slate-800 rounded"
        >
          Prev
        </button>
        <div>
          Page {page} / {pages}
        </div>
        <button
          onClick={() => setPage((p) => Math.min(pages, p + 1))}
          className="px-3 py-1 bg-slate-800 rounded"
        >
          Next
        </button>
      </div>
    </div>
  );
}
