import React from "react";
import { Home, Users, Box, Clock, Settings, LogOut } from "lucide-react";
import { Link, useLocation } from "react-router-dom";

export default function Sidebar() {
  const location = useLocation();

  const nav = [
    { to: "/", label: "Dashboard", icon: Home },
    { to: "/users", label: "Users", icon: Users },
    { to: "/resources", label: "Resources", icon: Box },
    { to: "/history", label: "Scan History", icon: Clock },
    { to: "/settings", label: "Settings", icon: Settings },
  ];

  return (
    <aside className="w-64 bg-slate-900 p-6 border-r border-slate-800 min-h-screen flex flex-col justify-between">
      <div>
        <h1 className="text-2xl font-bold text-blue-400">AWS Scanner</h1>

        <nav className="mt-10 space-y-2">
          {nav.map((n) => {
            const Icon = n.icon;
            const active = location.pathname === n.to;
            return (
              <Link
                key={n.to}
                to={n.to}
                className={`flex items-center gap-3 p-3 rounded-lg hover:bg-slate-800 transition ${
                  active ? "bg-slate-800" : ""
                }`}
              >
                <Icon className="w-5 h-5 text-slate-300" />
                <span className="text-slate-100">{n.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="text-slate-300">
        <div className="bg-slate-800 p-4 rounded-lg mb-4">
          <div className="text-xs text-slate-400">Connected Account</div>
          <div className="font-medium mt-2">Account: 123456789012</div>
          <div className="text-xs text-slate-400">Region: us-east-1</div>
          <div className="text-xs text-green-400 mt-2">● Connected</div>
        </div>

        <div className="flex items-center gap-2">
          <LogOut className="w-4 h-4" />
          <button className="text-sm text-slate-300">Log out</button>
        </div>
      </div>
    </aside>
  );
}
