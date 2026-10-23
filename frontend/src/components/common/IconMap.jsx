import React from 'react';
import {
  LayoutDashboard, AlertTriangle, Users, FolderKanban, FileBarChart,
  Bell, History, Monitor, Settings, Clock, CalendarCheck, Search,
  ChevronDown, X, Filter, Download, Play, Square, RefreshCcw,
  CheckCircle2, Circle, ShieldAlert, Wifi, WifiOff, TimerReset,
  Building2, User, ArrowRight, ArrowUpRight, ArrowDownRight, Info, Menu,
} from 'lucide-react';

export const ICONS = {
  LayoutDashboard, AlertTriangle, Users, FolderKanban, FileBarChart,
  Bell, History, Monitor, Settings, Clock, CalendarCheck, Search,
  ChevronDown, X, Filter, Download, Play, Square, RefreshCcw,
  CheckCircle2, Circle, ShieldAlert, Wifi, WifiOff, TimerReset,
  Building2, User, ArrowRight, ArrowUpRight, ArrowDownRight, Info, Menu,
};

export default function Icon({ name, size = 16, ...props }) {
  const Cmp = ICONS[name];
  if (!Cmp) return null;
  return <Cmp size={size} {...props} />;
}
