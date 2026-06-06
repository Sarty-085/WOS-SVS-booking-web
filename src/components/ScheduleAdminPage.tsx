import React, { useState, useEffect } from 'react';
import { 
  Shield, Users, FileText, CalendarDays, BarChart2, Plus, Lock, Unlock, 
  Trash2, Edit, Check, RefreshCw, Layers, Sparkles, LogOut, Clock, Play, MapPin, CheckCircle
} from 'lucide-react';
import { Alliance, Booking, Slot, AuditLog, EventType, SlotStatus } from '../types';
import { loadDailySlots } from '../dataStore';
import { motion, AnimatePresence } from 'motion/react';

interface ScheduleAdminPageProps {
  alliances: Alliance[];
  bookings: Booking[];
  auditLogs: AuditLog[];
  slots: Slot[];
  selectedDay: EventType;
  isAdmin: boolean;
  adminUsername: string;
  onSetSelectedDay: (day: EventType) => void;
  onAddAlliance: (name: string, tag: string, color: string) => void;
  onRenameAlliance: (id: string, name: string) => void;
  onDeleteAlliance: (id: string) => void;
  onDeleteBooking: (id: string) => void;
  onUpdateBookingSlot: (bookingId: string, primarySlot: string, speedupDays: number, speedupHours: number) => void;
  onLogoutAdmin: () => void;
  onAddBooking: (booking: Omit<Booking, 'id' | 'timestamp'>) => void;
}

type AdminTab = 'Dashboard' | 'Bookings' | 'Audit Logs' | 'Google Sheets Sync' | 'Alliances' | 'Weeks';

export default function ScheduleAdminPage({
  alliances,
  bookings,
  auditLogs,
  slots,
  selectedDay,
  isAdmin,
  adminUsername,
  onSetSelectedDay,
  onAddAlliance,
  onRenameAlliance,
  onDeleteAlliance,
  onDeleteBooking,
  onUpdateBookingSlot,
  onLogoutAdmin,
  onAddBooking
}: ScheduleAdminPageProps) {
  // Sidebar tabs
  const [activeAdminTab, setActiveAdminTab] = useState<AdminTab>('Dashboard');
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatusMsg, setSyncStatusMsg] = useState('');

  // Service Account settings state
  const [googleSpreadsheetId, setGoogleSpreadsheetId] = useState('');
  const [googleSaJson, setGoogleSaJson] = useState('');
  const [isSaConfigured, setIsSaConfigured] = useState(false);
  const [saEmail, setSaEmail] = useState<string | null>(null);
  const [showJsonInput, setShowJsonInput] = useState(false);
  const [copied, setCopied] = useState(false);

  // Email notifications (SMTP) settings state
  const [adminNotificationEmail, setAdminNotificationEmail] = useState('');
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('');
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPass, setSmtpPass] = useState('');
  const [smtpFrom, setSmtpFrom] = useState('');
  const [isSmtpConfigured, setIsSmtpConfigured] = useState(false);
  const [showSmtpPassInput, setShowSmtpPassInput] = useState(false);

  // Fetch setup details from the background API
  const fetchSheetsStats = async () => {
    try {
      const res = await fetch('/api/google-sheets/stats');
      if (res.ok) {
        const data = await res.json();
        setGoogleSpreadsheetId(data.spreadsheetId || '');
        setIsSaConfigured(data.isConfigured || false);
        setSaEmail(data.serviceAccountEmail || null);
        setAdminNotificationEmail(data.adminNotificationEmail || '');
        setSmtpHost(data.smtpHost || 'smtp.gmail.com');
        setSmtpPort(data.smtpPort || '465');
        setSmtpUser(data.smtpUser || '');
        setSmtpFrom(data.smtpFrom || '');
        setIsSmtpConfigured(data.isSmtpConfigured || false);
      }
    } catch (err) {
      console.error("Error loading sheets statistics:", err);
    }
  };

  useEffect(() => {
    if (isAdmin) {
      fetchSheetsStats();
    }
  }, [isAdmin]);

  const handleSaveSheetsSettings = async () => {
    setIsSyncing(true);
    setSyncStatusMsg("Saving settings to PostgreSQL database...");
    try {
      // 1. Save spreadsheet ID
      await fetch('/api/settings/google_spreadsheet_id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: googleSpreadsheetId.trim() })
      });

      // 2. Save JSON key if provided
      if (googleSaJson.trim()) {
        try {
          JSON.parse(googleSaJson);
        } catch (e: any) {
          alert("Malformed JSON structure! Please verify you copied the entire Google Service Account Credentials JSON key. \n\nDetails: " + e.message);
          setIsSyncing(false);
          setSyncStatusMsg("");
          return;
        }

        await fetch('/api/settings/google_service_account_json', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: googleSaJson.trim() })
        });
        setGoogleSaJson('');
        setShowJsonInput(false);
      }

      // 3. Save admin notification email
      await fetch('/api/settings/admin_notification_email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: (adminNotificationEmail || '').trim() })
      });

      // 4. Save SMTP server settings
      await fetch('/api/settings/smtp_host', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: (smtpHost || '').trim() })
      });

      await fetch('/api/settings/smtp_port', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: (smtpPort || '').trim() })
      });

      await fetch('/api/settings/smtp_user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: (smtpUser || '').trim() })
      });

      await fetch('/api/settings/smtp_from', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: (smtpFrom || '').trim() })
      });

      if (smtpPass.trim()) {
        await fetch('/api/settings/smtp_pass', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: smtpPass.trim() })
        });
        setSmtpPass('');
        setShowSmtpPassInput(false);
      }

      await fetchSheetsStats();
      addAdminAuditLog("Admin", "slot_lock", "Updated background Google Registry Sync & Nodemailer SMTP parameters.");
      alert("System Registry & notification configuration saved successfully! If proper SMTP credentials are set, emails will trigger in the background.");
      setSyncStatusMsg("Saved successfully!");
    } catch (err: any) {
      alert("Failed storing parameters: " + err.message);
      setSyncStatusMsg("Error saving parameters");
    } finally {
      setIsSyncing(false);
    }
  };

  const handleManualSyncNow = async () => {
    setIsSyncing(true);
    setSyncStatusMsg("Triggering server-side Google Sheets Sync agent...");
    try {
      const res = await fetch('/api/google-sheets/sync', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        addAdminAuditLog("Admin", "edit_booking", "Initiated manual server sync registry slots live to Google Sheets.");
        alert("Success! Placed all schedule registrations onto your private Google Sheet.");
        setSyncStatusMsg("Successfully synchronized!");
      } else {
        alert("Verification failed: " + (data.message || "Unknown error occurred."));
        setSyncStatusMsg("Sync skipped: " + (data.message || "Unknown"));
      }
    } catch (err: any) {
      alert("Error reaching Sheets sync agent: " + err.message);
      setSyncStatusMsg("Error: " + err.message);
    } finally {
      setIsSyncing(false);
    }
  };

  const addAdminAuditLog = async (operator: string, action: AuditLog['action'], details: string) => {
    const newLog: AuditLog = {
      id: `log-${Date.now()}`,
      operator,
      action,
      details,
      timestamp: new Date().toISOString()
    };
    try {
      await fetch('/api/audit-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newLog)
      });
    } catch(err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (!isAdmin && activeAdminTab !== 'Dashboard' && activeAdminTab !== 'Weeks') {
      setActiveAdminTab('Dashboard');
    }
  }, [activeAdminTab, isAdmin]);
  
  // Selected slot state for interactive highlights
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);

  // New Alliance Form State
  const [newAllName, setNewAllName] = useState('');
  const [newAllTag, setNewAllTag] = useState('');
  const [newAllColor, setNewAllColor] = useState('#ec4899');

  // Edit Alliance Inline State
  const [editingAllianceId, setEditingAllianceId] = useState<string | null>(null);
  const [editingAllianceName, setEditingAllianceName] = useState('');

  // Quick Alliance Color Presets
  const colorPresets = [
    { name: 'pink', value: '#ec4899' },
    { name: 'purple', value: '#a855f7' },
    { name: 'orange', value: '#f97316' },
    { name: 'blue', value: '#3b82f6' },
    { name: 'green', value: '#22c55e' },
    { name: 'cyan', value: '#06b6d4' },
    { name: 'red', value: '#f43f5e' },
    { name: 'yellow', value: '#eab308' }
  ];

  // Slot Editor Modal Side-Drawer State (for admin slot correction)
  const [selectedBookingForEdit, setSelectedBookingForEdit] = useState<Booking | null>(null);
  const [editSlotId, setEditSlotId] = useState('');
  const [editDays, setEditDays] = useState(0);
  const [editHours, setEditHours] = useState(0);

  // Quick book slot state
  const [quickBookTime, setQuickBookTime] = useState<string | null>(null);
  const [qbName, setQbName] = useState('');
  const [qbUserId, setQbUserId] = useState('');
  const [qbAllianceId, setQbAllianceId] = useState(alliances[0]?.id || '');

  // Synchronize qbAllianceId state once alliances list loads in background
  useEffect(() => {
    if (!qbAllianceId && alliances.length > 0) {
      setQbAllianceId(alliances[0].id);
    }
  }, [alliances, qbAllianceId]);

  // System refresh state
  const [lastRefreshed, setLastRefreshed] = useState('Just now');
  useEffect(() => {
    const interval = setInterval(() => {
      setLastRefreshed(`${Math.floor(Math.random() * 5) + 1} mins ago`);
    }, 45000);
    return () => clearInterval(interval);
  }, []);

  // Tick-tock state for dynamic UTC countdowns
  const [nowUtc, setNowUtc] = useState(new Date());
  useEffect(() => {
    const interval = setInterval(() => {
      setNowUtc(new Date());
    }, 15000); // update every 15 seconds
    return () => clearInterval(interval);
  }, []);

  const getDayBookingPercentage = (day: EventType) => {
    const daySlots = loadDailySlots(day, bookings);
    const bookedCount = daySlots.filter(s => s.status === 'booked').length;
    const totalPlayableSlots = daySlots.filter(s => s.status !== 'locked').length;
    if (totalPlayableSlots === 0) return 0;
    return Math.round((bookedCount / totalPlayableSlots) * 100);
  };

  const getCommenceCountdownText = (targetDayNum: number) => {
    const currentUtcDay = nowUtc.getUTCDay();
    
    // If today is the target day, it means it already commenced today at 00:00 UTC
    if (currentUtcDay === targetDayNum) {
      return "commenced today (ongoing)";
    }

    let daysDiff = targetDayNum - currentUtcDay;
    if (daysDiff < 0) {
      daysDiff += 7;
    } else if (daysDiff === 0) {
      daysDiff += 7;
    }

    // Target date at 00:00 UTC on that target day
    const targetDate = new Date(Date.UTC(
      nowUtc.getUTCFullYear(),
      nowUtc.getUTCMonth(),
      nowUtc.getUTCDate() + daysDiff,
      0, 0, 0, 0
    ));

    const diffMs = targetDate.getTime() - nowUtc.getTime();
    if (diffMs <= 0) {
      return "commenced today (ongoing)";
    }

    const totalHours = Math.floor(diffMs / (1000 * 60 * 60));
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;

    if (days > 0) {
      return `commences in ${days}d ${hours}h`;
    } else if (hours > 0) {
      return `commences in ${hours} hours`;
    } else {
      const mins = Math.floor(diffMs / (1000 * 60));
      return `commences in ${mins} mins`;
    }
  };

  // Compute stats based on current database
  const getBookingCount = (day: EventType) => {
    return bookings.filter(b => b.eventType === day).length;
  };

  const getWeekText = () => "Week 42: Oct 23 - Oct 29";

  const getAllianceByBooking = (allianceId: string) => {
    return alliances.find(a => a.id === allianceId);
  };

  // Handler for renaming alliance
  const startEditingAlliance = (all: Alliance) => {
    setEditingAllianceId(all.id);
    setEditingAllianceName(all.name);
  };

  const saveEditingAlliance = (id: string) => {
    if (editingAllianceName.trim()) {
      onRenameAlliance(id, editingAllianceName.trim());
      setEditingAllianceId(null);
    }
  };

  // Submit quick booking
  const handleQuickBookSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!qbName.trim() || !quickBookTime) return;

    onAddBooking({
      playerName: qbName.trim(),
      userId: qbUserId.trim() || 'MOCK_ID',
      email: `${qbName.toLowerCase()}@alliances.net`,
      allianceId: qbAllianceId || alliances[0]?.id || '',
      eventType: selectedDay,
      speedupDays: 1,
      speedupHours: 0,
      score: 1440,
      slotId: quickBookTime,
      backupSlots: [],
      autoAssign: true
    });

    // Reset
    setQbName('');
    setQbUserId('');
    setQuickBookTime(null);
  };

  // Opens booking details or editor
  const handleSlotClick = (slot: Slot) => {
    setSelectedSlotId(slot.id);

    if (slot.status === 'booked' && slot.bookingId) {
      const bObj = bookings.find(b => b.id === slot.bookingId);
      if (bObj) {
        setSelectedBookingForEdit(bObj);
        setEditSlotId(bObj.slotId);
        setEditDays(bObj.speedupDays);
        setEditHours(bObj.speedupHours);
      }
    } else if (slot.status === 'available') {
      setSelectedBookingForEdit(null);
      if (isAdmin) {
        setQuickBookTime(slot.time);
      }
    }
  };

  // Saves Admin-modified reservation slot
  const handleSaveModifiedSlot = () => {
    if (selectedBookingForEdit) {
      onUpdateBookingSlot(selectedBookingForEdit.id, editSlotId, editDays, editHours);
      setSelectedBookingForEdit(null);
    }
  };

  // Formats time strings and backup representation
  const formatTimeIntervals = () => {
    const arr = [];
    for (let h = 0; h < 24; h++) {
      for (let m = 0; m < 60; m += 30) {
        arr.push(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`);
      }
    }
    return arr;
  };

  return (
    <div className="w-full max-w-7xl mx-auto px-4 py-6" id="dashboard-main-container">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* SIDEBAR: Admin System Controller */}
        <div className="lg:col-span-3 flex flex-col gap-6 lg:sticky lg:top-8">
          <div className="glass-panel p-5 rounded-2xl border border-slate-800 bg-slate-900/40">
            {/* Controller Header */}
            <div className="flex items-center gap-3 border-b border-slate-800/80 pb-4 mb-5">
              <div className="w-10 h-10 rounded-xl bg-cyan-950/50 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
                <Shield className="w-5 h-5" />
              </div>
              <div className="text-left">
                <span className="text-[10px] font-mono text-cyan-400 font-extrabold uppercase tracking-widest block">System Controller</span>
                <h2 className="font-heading font-black text-white text-base">
                  {isAdmin ? 'Admin Portal' : 'Royal Client View'}
                </h2>
              </div>
            </div>

            {/* Sidebar menu links with active design requested */}
            <nav className="flex flex-col gap-1 text-left">
              {(['Dashboard', 'Bookings', 'Audit Logs', 'Google Sheets Sync', 'Alliances', 'Weeks'] as AdminTab[])
                .filter((t) => isAdmin || t === 'Dashboard' || t === 'Weeks')
                .map((tab) => {
                const isActive = activeAdminTab === tab;
                let IconComp = BarChart2;
                if (tab === 'Bookings') IconComp = CalendarDays;
                if (tab === 'Audit Logs') IconComp = FileText;
                if (tab === 'Google Sheets Sync') IconComp = RefreshCw;
                if (tab === 'Alliances') IconComp = Users;
                if (tab === 'Weeks') IconComp = Layers;

                return (
                  <button
                    key={tab}
                    id={`sidebar-tab-${tab.toLowerCase().replace(' ', '-')}`}
                    onClick={() => setActiveAdminTab(tab)}
                    className={`flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-heading font-medium tracking-wide transition-all relative ${
                      isActive 
                        ? 'bg-slate-900 text-cyan-400 font-bold border-l-2 border-cyan-500 pl-3.5 shadow-[inset_0_0_12px_rgba(6,182,212,0.15)]' 
                        : 'text-slate-400 hover:text-cyan-400 hover:bg-slate-900/40'
                    }`}
                  >
                    <IconComp className={`w-4 h-4 ${isActive ? 'text-cyan-400' : 'text-slate-500'}`} />
                    {tab}
                    {tab === 'Audit Logs' && auditLogs.length > 0 && (
                      <span className="ml-auto text-[10px] font-mono bg-indigo-950 text-indigo-300 border border-indigo-500/20 px-2 py-0.5 rounded-full font-bold">
                        {auditLogs.length}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>

            {/* Admin Profile state */}
            <div className="mt-6 pt-4 border-t border-slate-800/80 flex flex-col gap-3">
              <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-900 flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-[11px] font-bold font-mono text-slate-300">
                  {isAdmin ? 'AD' : 'GU'}
                </div>
                <div className="text-left overflow-hidden">
                  <p className="text-xs text-white font-bold truncate">
                    {isAdmin ? adminUsername : 'Guest Commander'}
                  </p>
                  <p className="text-[10px] font-mono text-slate-500 uppercase tracking-widest leading-none">
                    {isAdmin ? 'Clearance Lev 5' : 'Observation Mode'}
                  </p>
                </div>
              </div>

              {isAdmin ? (
                <button
                  id="admin-logout-btn"
                  onClick={onLogoutAdmin}
                  className="w-full py-2 rounded-lg border border-rose-500/30 text-rose-400 hover:bg-rose-550 hover:bg-rose-955/20 text-xs font-semibold font-heading flex items-center justify-center gap-2 transition-all cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Terminate Admin Connection
                </button>
              ) : (
                <p className="text-[10px] font-mono text-slate-500 text-center italic">
                  Authenticate via Admin link for write authorization.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* MAIN PANEL CONTENT AREA */}
        <div className="lg:col-span-9 flex flex-col gap-6">
          
          {/* TOP HEADER CONTROLS */}
          <div className="glass-panel p-4 md:p-6 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4 text-left border-slate-800">
            <div>
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                <span className="text-xs font-mono text-slate-400 uppercase tracking-wider">Operational Horizon:</span>
                <div className="inline-flex items-center gap-2 px-3 py-1 bg-slate-950 rounded-lg border border-slate-800">
                  <select 
                    id="week-selector"
                    className="bg-transparent text-xs font-mono font-bold text-sky-400 focus:outline-none cursor-pointer appearance-none pr-4 relative"
                    defaultValue="w42"
                  >
                    <option value="w42" className="bg-slate-950 text-white">{getWeekText()}</option>
                    <option value="w43" className="bg-slate-950 text-slate-400">Week 43: Oct 30 - Nov 05</option>
                  </select>
                </div>
                <span className="text-[10px] bg-emerald-950 font-bold text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded font-mono">OPEN</span>
              </div>
              <p className="text-xs text-slate-400 font-mono">
                System state active. Last structural updates: {lastRefreshed}
              </p>
            </div>

            <div className="flex items-center gap-2 self-start md:self-center">
              <button 
                id="system-refresh-btn"
                onClick={() => setLastRefreshed('Just now')}
                className="p-2.5 rounded-lg border border-slate-800 bg-slate-900/30 text-slate-400 hover:text-sky-400 hover:border-sky-500/20 transition-all cursor-pointer flex items-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                <span className="text-xs font-mono">SYNC ENGINE</span>
              </button>
            </div>
          </div>

          {/* DYNAMIC STATS SUMMARY CARDS (GRID OF 3) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 text-left">
            {/* CONSTRUCTION STAT */}
            {(() => {
              const monPct = getDayBookingPercentage('monday');
              return (
                <div className="glass-panel p-5 rounded-2xl border border-sky-500/10 relative overflow-hidden">
                  <span className="text-[10px] font-mono text-sky-400 font-bold block mb-1">CONSTRUCTION BOOKINGS</span>
                  <div className="flex justify-between items-baseline mb-2">
                    <h4 className="text-2xl font-heading font-black text-white">{monPct}%</h4>
                    <span className="text-[10px] font-mono text-sky-500 bg-sky-950/40 px-1.5 py-0.5 rounded border border-sky-400/15">MON ACTIVE</span>
                  </div>
                  <div className="w-full bg-slate-950 rounded-full h-1.5 mb-3.5">
                    <div className="bg-sky-400 h-1.5 rounded-full transition-all duration-500" style={{ width: `${monPct}%` }} />
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed font-mono capitalize">{getCommenceCountdownText(1)}</p>
                </div>
              );
            })()}

            {/* RESEARCH STAT */}
            {(() => {
              const tuePct = getDayBookingPercentage('tuesday');
              return (
                <div className="glass-panel p-5 rounded-2xl border border-purple-500/10 relative overflow-hidden">
                  <span className="text-[10px] font-mono text-purple-400 font-bold block mb-1">RESEARCH BOOKINGS</span>
                  <div className="flex justify-between items-baseline mb-2">
                    <h4 className="text-2xl font-heading font-black text-white">{tuePct}%</h4>
                    <span className="text-[10px] font-mono text-purple-500 bg-purple-950/40 px-1.5 py-0.5 rounded border border-purple-400/15">TUE CONTEXT</span>
                  </div>
                  <div className="w-full bg-slate-950 rounded-full h-1.5 mb-3.5">
                    <div className="bg-purple-500 h-1.5 rounded-full transition-all duration-500" style={{ width: `${tuePct}%` }} />
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed font-mono capitalize">{getCommenceCountdownText(2)}</p>
                </div>
              );
            })()}

            {/* TRAINING STAT */}
            {(() => {
              const thuPct = getDayBookingPercentage('thursday');
              return (
                <div className="glass-panel p-5 rounded-2xl border border-emerald-500/10 relative overflow-hidden">
                  <span className="text-[10px] font-mono text-emerald-400 font-bold block mb-1">TRAINING BOOKINGS</span>
                  <div className="flex justify-between items-baseline mb-2">
                    <h4 className="text-2xl font-heading font-black text-white">{thuPct}%</h4>
                    <span className="text-[10px] font-mono text-emerald-500 bg-emerald-950/40 px-1.5 py-0.5 rounded border border-emerald-400/15">THU COHORT</span>
                  </div>
                  <div className="w-full bg-slate-950 rounded-full h-1.5 mb-3.5">
                    <div className="bg-emerald-500 h-1.5 rounded-full transition-all duration-500" style={{ width: `${thuPct}%` }} />
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed font-mono capitalize">{getCommenceCountdownText(4)}</p>
                </div>
              );
            })()}
          </div>

          {/* DYNAMIC TAB RENDERS */}
          {activeAdminTab === 'Dashboard' && (
            <div className="flex flex-col gap-6">
              
              {/* SCHEDULER CONTROLS / DAY TABS */}
              <div className="glass-panel p-5 rounded-2xl border border-slate-800 text-left">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 border-b border-slate-850 pb-4">
                  <div>
                    <h3 className="font-heading font-extrabold text-xl text-white">Scheduler Registry</h3>
                    <p className="text-xs text-slate-400">Click a slot card to view allocations or administer adjustments.</p>
                  </div>

                  {/* Day tabs selection container matching prompt */}
                  <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800 self-start md:self-center">
                    <button
                      id="tab-monday-day"
                      onClick={() => onSetSelectedDay('monday')}
                      className={`px-4 py-2 rounded-lg text-xs font-heading font-bold transition-all ${
                        selectedDay === 'monday' 
                          ? 'bg-cyan-950/40 text-cyan-400 shadow-md border-b-2 border-cyan-400 font-black' 
                          : 'text-slate-400 hover:text-cyan-400'
                      }`}
                    >
                      Monday ({getBookingCount('monday')})
                    </button>
                    <button
                      id="tab-tuesday-day"
                      onClick={() => onSetSelectedDay('tuesday')}
                      className={`px-4 py-2 rounded-lg text-xs font-heading font-bold transition-all ${
                        selectedDay === 'tuesday' 
                          ? 'bg-cyan-950/40 text-cyan-400 shadow-md border-b-2 border-cyan-400 font-black' 
                          : 'text-slate-400 hover:text-cyan-400'
                      }`}
                    >
                      Tuesday ({getBookingCount('tuesday')})
                    </button>
                    <button
                      id="tab-thursday-day"
                      onClick={() => onSetSelectedDay('thursday')}
                      className={`px-4 py-2 rounded-lg text-xs font-heading font-bold transition-all ${
                        selectedDay === 'thursday' 
                          ? 'bg-cyan-950/40 text-cyan-400 shadow-md border-b-2 border-cyan-400 font-black' 
                          : 'text-slate-400 hover:text-cyan-400'
                      }`}
                    >
                      Thursday ({getBookingCount('thursday')})
                    </button>
                  </div>
                </div>

                {/* SLOT GRID (48 SLOTS LAYOUT) */}
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3.5">
                  {slots.map((slot) => {
                    const isSelected = selectedSlotId === slot.id;
                    const bookingObj = slot.bookingId ? bookings.find(b => b.id === slot.bookingId) : null;
                    const allianceObj = bookingObj ? getAllianceByBooking(bookingObj.allianceId) : null;

                    return (
                      <div
                        key={slot.id}
                        id={`slot-card-${slot.id.replace(':', '-')}`}
                        onClick={() => handleSlotClick(slot)}
                        className={`p-3.5 rounded-xl cursor-pointer relative transition-all flex flex-col justify-between h-28 select-none text-left ${
                          slot.status === 'locked'
                            ? 'bg-slate-950/30 border border-slate-900/60 opacity-55 cursor-not-allowed'
                            : slot.status === 'booked'
                              ? 'bg-[#071329] border border-cyan-950 hover:border-cyan-700/60 shadow-[inset_0_0_8px_rgba(6,182,212,0.05)]'
                              : 'bg-slate-900/10 border border-slate-800/40 hover:border-slate-700 hover:bg-slate-900/30'
                        } ${
                          isSelected ? 'glow-cyan-active' : ''
                        }`}
                      >
                        {/* Time top-left */}
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-[11px] text-slate-400 font-bold">{slot.time}</span>
                          
                          {/* Top-right badges/dots */}
                          {slot.status === 'booked' && (
                            <span className="text-[8px] font-mono font-bold bg-sky-950 border border-sky-400/30 px-1.5 py-0.5 rounded text-sky-300">
                              BOOKED
                            </span>
                          )}

                          {slot.status === 'locked' && (
                            <Lock className="w-3 h-3 text-slate-500" />
                          )}

                          {isSelected && slot.status !== 'locked' && (
                            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping pulse-glow" />
                          )}
                        </div>

                        {/* Middle status indicator text */}
                        <div className="my-auto">
                          {slot.status === 'booked' && bookingObj ? (
                            <div>
                              <p className="text-white text-xs font-bold truncate leading-tight">
                                {bookingObj.playerName}
                              </p>
                              {allianceObj && (
                                <p className="text-[9px] font-mono uppercase tracking-widest text-slate-400 mt-0.5 truncate flex items-center gap-1">
                                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: allianceObj.color }} />
                                  ALLIANCE: {allianceObj.tag}
                                </p>
                              )}
                            </div>
                          ) : slot.status === 'locked' ? (
                            <div className="text-center py-2 text-slate-600 font-mono text-[10px] tracking-widest flex flex-col items-center gap-1 font-bold">
                              <span>SYSTEM LOCK</span>
                            </div>
                          ) : (
                            <div className="text-center py-2 flex flex-col items-center gap-0.5 text-slate-500 hover:text-slate-350">
                              <Plus className="w-4 h-4 opacity-40" />
                              <span className="text-[9px] font-mono tracking-wider font-extrabold text-slate-450 uppercase">AVAILABLE</span>
                            </div>
                          )}
                        </div>

                        {/* Bottom alignment indicator scores (Priority minutes) */}
                        <div className="flex justify-between items-center mt-1">
                          {slot.status === 'booked' && bookingObj ? (
                            <span className="text-[9px] font-mono text-cyan-400 font-extrabold tracking-wider bg-cyan-950/40 border border-cyan-500/10 px-1.5 py-0.5 rounded">
                              {bookingObj.score.toLocaleString()} SCORE
                            </span>
                          ) : (
                            <span className="text-[9px] font-mono text-slate-600">--</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* LEGEND BAR */}
                <div className="mt-8 pt-5 border-t border-slate-900 flex flex-wrap gap-5 justify-center md:justify-start">
                  <div className="flex items-center gap-1.5 text-xs font-mono text-slate-400">
                    <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                    <span>Booked</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs font-mono text-slate-400">
                    <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse" />
                    <span>Recently Changed</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs font-mono text-slate-400">
                    <span className="w-2.5 h-2.5 rounded-full bg-slate-600" />
                    <span>Available</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs font-mono text-slate-400">
                    <Lock className="w-3.5 h-3.5 text-slate-500" />
                    <span>Admin Locked</span>
                  </div>
                </div>
              </div>

              {/* QUICK BOOK SIDEBAR DRAWER PANEL (If Admin has clicked an available slot) */}
              <AnimatePresence>
                {quickBookTime && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="glass-panel p-6 rounded-2xl border border-cyan-500/25 bg-slate-950/60 text-left"
                  >
                    <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
                      <div>
                        <h4 className="font-heading font-black text-white text-base">Quick-Reserve Slot</h4>
                        <p className="text-xs text-cyan-400 font-mono">TIME SLOT BOUND: {quickBookTime}</p>
                      </div>
                      <button 
                        onClick={() => setQuickBookTime(null)}
                        className="text-slate-500 hover:text-white font-bold px-2 py-1 text-sm border border-slate-800 rounded bg-slate-950"
                      >
                        Escape
                      </button>
                    </div>

                    <form onSubmit={handleQuickBookSubmit} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                      <div>
                        <label className="block text-[10px] font-mono text-slate-400 uppercase tracking-widest mb-1">Commander IGN</label>
                        <input
                          id="qb-ign"
                          type="text"
                          required
                          placeholder="e.g. Sarthak"
                          value={qbName}
                          onChange={(e) => setQbName(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg py-2 px-3 text-xs text-white focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-mono text-slate-400 uppercase tracking-widest mb-1">User Identification ID</label>
                        <input
                          id="qb-uid"
                          type="text"
                          placeholder="User ID (optional)"
                          value={qbUserId}
                          onChange={(e) => setQbUserId(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg py-2 px-3 text-xs text-white focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-mono text-slate-400 uppercase tracking-widest mb-1">Alliance Core</label>
                        <select
                          id="qb-alliance"
                          value={qbAllianceId}
                          onChange={(e) => setQbAllianceId(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg py-2 px-3 text-xs text-white focus:outline-none"
                        >
                          {alliances.map((all) => (
                            <option key={`qb-${all.id}`} value={all.id}>{all.name} ({all.tag})</option>
                          ))}
                        </select>
                      </div>

                      <button
                        id="qb-submit-btn"
                        type="submit"
                        className="px-4 py-2.5 rounded-lg royal-gradient-btn font-heading font-black text-xs uppercase tracking-wider transition-all cursor-pointer"
                      >
                        Commit Reservation
                      </button>
                    </form>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* ACTIVE SLOT DETAILS EDITOR CABINET (Available to Admin) */}
              <AnimatePresence>
                {selectedBookingForEdit && (
                  <motion.div
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 15 }}
                    className="glass-panel p-6 rounded-2xl border border-sky-400/40 bg-slate-950/90 text-left relative"
                  >
                    <div className="absolute top-2 right-2 flex gap-2">
                      <button 
                        onClick={() => setSelectedBookingForEdit(null)}
                        className="text-slate-400 hover:text-white px-2.5 py-1 font-mono text-[10px] border border-slate-800 rounded-md bg-slate-950"
                      >
                        CLOSE CABINET
                      </button>
                    </div>

                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-4 mb-5">
                      <div>
                        <h4 className="font-heading font-extrabold text-lg text-white">Active Slot Supervisor</h4>
                        <p className="text-xs text-cyan-400 font-mono">Booking record: {selectedBookingForEdit.playerName} (UID: {selectedBookingForEdit.userId})</p>
                      </div>
                      
                      <div className="flex gap-2">
                        {isAdmin && (
                          <button
                            id="admin-delete-booking-btn"
                            onClick={() => {
                              onDeleteBooking(selectedBookingForEdit.id);
                              setSelectedBookingForEdit(null);
                            }}
                            className="bg-rose-950/40 border border-rose-500/30 text-rose-400 hover:bg-rose-950/85 px-4 py-2 rounded-lg text-xs font-semibold font-heading flex items-center gap-1.5 transition-all"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Evict / Cancel Booking
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                      {/* Re-allot Time Slot */}
                      <div>
                        <label className="block text-[10px] font-mono text-slate-400 uppercase tracking-widest mb-1">Re-allot Time Slot</label>
                        <select
                          id="editor-allot-slot"
                          disabled={!isAdmin}
                          value={editSlotId}
                          onChange={(e) => setEditSlotId(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg py-2 px-3 text-xs text-white focus:outline-none"
                        >
                          {formatTimeIntervals().map((t) => (
                            <option key={`edit-${t}`} value={t}>{t}</option>
                          ))}
                        </select>
                      </div>

                      {/* Modify Days Speedup */}
                      <div>
                        <label className="block text-[10px] font-mono text-slate-400 uppercase tracking-widest mb-1">Days speedup score</label>
                        <input
                          id="editor-days"
                          disabled={!isAdmin}
                          type="number"
                          placeholder="Days"
                          value={editDays}
                          onChange={(e) => setEditDays(parseInt(e.target.value, 10) || 0)}
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg py-2 px-3 text-xs text-white focus:outline-none"
                        />
                      </div>

                      {/* Modify Hours Speedup */}
                      <div>
                        <label className="block text-[10px] font-mono text-slate-400 uppercase tracking-widest mb-1">Hours speedup score</label>
                        <input
                          id="editor-hours"
                          disabled={!isAdmin}
                          type="number"
                          placeholder="Hours"
                          value={editHours}
                          onChange={(e) => setEditHours(parseInt(e.target.value, 10) || 0)}
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg py-2 px-3 text-xs text-white focus:outline-none"
                        />
                      </div>

                      {isAdmin ? (
                        <button
                          id="admin-save-booking-btn"
                          onClick={handleSaveModifiedSlot}
                          className="px-4 py-2.5 rounded-lg royal-gradient-btn font-heading font-black text-xs uppercase tracking-wider transition-all text-center cursor-pointer"
                        >
                          Commit Override
                        </button>
                      ) : (
                        <p className="text-[10px] text-slate-500 font-mono italic p-2 border border-slate-850 bg-slate-900/10 rounded">
                          Write overrides locked. Authentication required.
                        </p>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

            </div>
          )}

          {/* TAB 2: BOOKINGS LIST (Audit and edit list) */}
          {activeAdminTab === 'Bookings' && (
            <div className="glass-panel p-6 rounded-2xl border border-slate-800 text-left">
              <div className="border-b border-slate-800 pb-4 mb-5">
                <h3 className="font-heading font-extrabold text-xl text-white">All Booked Claims</h3>
                <p className="text-xs text-slate-400">Total live bookings: {bookings.length} reservations across training, construction, and research campaigns.</p>
              </div>

              {bookings.length === 0 ? (
                <div className="py-12 text-center text-slate-500 text-sm font-mono">No reservations active on this server domain.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-slate-300 text-sm">
                    <thead>
                      <tr className="border-b border-slate-800 text-[10px] font-mono text-slate-400 uppercase tracking-wider">
                        <th className="py-3 px-4 text-left font-bold">Commander IGN</th>
                        <th className="py-3 px-4 text-left font-bold">Alliance Name</th>
                        <th className="py-3 px-4 text-left font-bold">Target Campaign</th>
                        <th className="py-3 px-4 text-left font-bold">Target Slot</th>
                        <th className="py-3 px-4 text-left font-bold">Backup Options</th>
                        <th className="py-3 px-4 text-right font-bold">Claim Priority Score</th>
                        {isAdmin && <th className="py-3 px-4 text-right font-bold">Clearance Actions</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {bookings.map((booking) => {
                        const alliance = getAllianceByBooking(booking.allianceId);
                        return (
                          <tr key={booking.id} className="border-b border-slate-900 hover:bg-slate-900/10 transition-colors">
                            <td className="py-3.5 px-4 font-bold text-white max-w-[150px] truncate">
                              {booking.playerName}
                              <span className="block font-mono text-[9px] text-slate-500 font-normal">ID: {booking.userId}</span>
                            </td>
                            <td className="py-3.5 px-4 font-mono text-xs">
                              {alliance ? (
                                <span className="inline-flex items-center gap-1 bg-slate-950 px-2 py-0.5 rounded border border-slate-800 text-slate-300">
                                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: alliance.color }} />
                                  {alliance.tag}
                                </span>
                              ) : (
                                <span className="text-slate-500">None</span>
                              )}
                            </td>
                            <td className="py-3.5 px-4 font-mono text-xs uppercase tracking-wider text-sky-450 font-bold">
                              {booking.eventType}
                            </td>
                            <td className="py-3.5 px-4 font-mono font-bold text-cyan-300 text-xs">
                              {booking.slotId}
                            </td>
                            <td className="py-3.5 px-4 font-mono text-[10px] text-slate-400">
                              {booking.backupSlots.length > 0 ? booking.backupSlots.join(', ') : 'None'}
                            </td>
                            <td className="py-3.5 px-4 text-right font-mono font-black text-cyan-400">
                              {booking.score.toLocaleString()} DP
                            </td>
                            {isAdmin && (
                              <td className="py-3.5 px-4 text-right">
                                <div className="inline-flex gap-2">
                                  <button
                                    onClick={() => {
                                      setSelectedBookingForEdit(booking);
                                      setEditSlotId(booking.slotId);
                                      setEditDays(booking.speedupDays);
                                      setEditHours(booking.speedupHours);
                                      setActiveAdminTab('Dashboard');
                                    }}
                                    className="p-1 px-2.5 rounded border border-slate-800 hover:border-sky-500 text-sky-400 bg-slate-950 font-mono text-[10px] hover:text-white transition-colors cursor-pointer"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    onClick={() => onDeleteBooking(booking.id)}
                                    className="p-1 border border-slate-800 hover:bg-rose-950/20 text-rose-500 rounded hover:border-rose-500 transition-colors cursor-pointer"
                                    title="Cancel claim"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: AUDIT LOGS */}
          {activeAdminTab === 'Audit Logs' && (
            <div className="glass-panel p-6 rounded-2xl border border-slate-800 text-left">
              <div className="border-b border-slate-800 pb-4 mb-5">
                <h3 className="font-heading font-extrabold text-xl text-white">System Audit Trail</h3>
                <p className="text-xs text-slate-400 font-mono">REALTIME SECURE STATE TRANSITIONAL RECORDS</p>
              </div>

              <div className="flex flex-col gap-3">
                {auditLogs.map((log) => (
                  <div key={log.id} className="p-3.5 rounded-lg bg-slate-950/70 border border-slate-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-left">
                    <div className="flex items-start gap-3">
                      <div className="w-2 h-2 rounded-full bg-cyan-400 mt-1.5 shrink-0" />
                      <div>
                        <p className="text-sm text-slate-200 leading-relaxed font-sans font-medium">
                          {log.details}
                        </p>
                        <div className="flex gap-2 text-[10px] font-mono text-slate-500 mt-1 uppercase items-center">
                          <span className="font-bold text-sky-400">OPERATOR: {log.operator}</span>
                          <span>•</span>
                          <span>ACTION: {log.action}</span>
                        </div>
                      </div>
                    </div>
                    <span className="font-mono text-[9px] text-slate-500 whitespace-nowrap self-start sm:self-center">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 4: ALLIANCES MANAGER (rename, delete, create, list) */}
          {activeAdminTab === 'Alliances' && (
            <div className="flex flex-col gap-6 text-left">
              <div className="glass-panel p-6 rounded-2xl border border-slate-800">
                <div className="border-b border-slate-800 pb-4 mb-6">
                  <h3 className="font-heading font-extrabold text-xl text-white">Alliances Ledger</h3>
                  <p className="text-xs text-slate-400">Add, rename, or delete registered State alliance blocks.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
                  
                  {/* Ledger list */}
                  <div className="flex flex-col gap-3">
                    <span className="text-[10px] font-mono text-slate-400 uppercase tracking-widest font-bold">Registered Alliances ({alliances.length})</span>
                    
                    {alliances.map((all) => (
                      <div 
                        key={all.id}
                        className="p-3.5 rounded-xl bg-slate-950/50 border border-slate-900 flex items-center justify-between gap-4"
                      >
                        <div className="flex items-center gap-3 flex-grow">
                          <span className="w-3.5 h-3.5 rounded-full shrink-0" style={{ backgroundColor: all.color }} />
                          
                          {editingAllianceId === all.id ? (
                            <input
                              id={`all-edit-input-${all.id}`}
                              type="text"
                              value={editingAllianceName}
                              onChange={(e) => setEditingAllianceName(e.target.value)}
                              className="bg-slate-900 border border-cyan-500 rounded px-2 py-1 text-xs text-white focus:outline-none w-full font-sans"
                            />
                          ) : (
                            <div>
                              <span className="font-bold text-white text-sm">
                                {all.name}
                              </span>
                              <span className="text-[10px] font-mono text-slate-500 uppercase block font-black">
                                TAG ID: {all.tag}
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Admin triggers */}
                        <div className="flex items-center gap-2">
                          {editingAllianceId === all.id ? (
                            <button
                              id={`all-save-${all.id}`}
                              onClick={() => saveEditingAlliance(all.id)}
                              className="p-1 bg-emerald-950/80 border border-emerald-500/40 text-emerald-400 rounded cursor-pointer"
                              title="Save alliance name"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            isAdmin && (
                              <button
                                id={`all-edit-btn-${all.id}`}
                                onClick={() => startEditingAlliance(all)}
                                className="p-1 hover:border-sky-500 border border-slate-800 text-sky-400 rounded cursor-pointer"
                                title="Rename Alliance"
                              >
                                <Edit className="w-3.5 h-3.5" />
                              </button>
                            )
                          )}

                          {isAdmin && (
                            <button
                              id={`all-delete-btn-${all.id}`}
                              onClick={() => onDeleteAlliance(all.id)}
                              className="p-1 hover:border-rose-500 border border-slate-800 text-rose-500 rounded cursor-pointer"
                              title="Delete Alliance"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* High Quality CREATE ALLIANCE box */}
                  <div className="p-5 rounded-2xl bg-slate-950/40 border border-slate-900 flex flex-col gap-4 text-left">
                    <span className="text-[10px] font-mono text-cyan-400 uppercase tracking-widest font-black block border-b border-slate-900 pb-2">Create New Alliance</span>
                    
                    <div>
                      <label className="block text-[10px] font-mono text-slate-400 uppercase tracking-wider mb-1 font-bold">Alliance Full Name</label>
                      <input
                        id="new-alliance-name"
                        type="text"
                        placeholder="e.g. Blizzard Vanguard"
                        value={newAllName}
                        onChange={(e) => setNewAllName(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-lg py-2 px-3 text-xs text-white focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-mono text-slate-400 uppercase tracking-wider mb-1 font-bold">Alliance Short Tag (3-4 Cap Characters)</label>
                      <input
                        id="new-alliance-tag"
                        type="text"
                        maxLength={5}
                        placeholder="e.g. BAZ"
                        value={newAllTag}
                        onChange={(e) => setNewAllTag(e.target.value.toUpperCase())}
                        className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-lg py-2 px-3 text-xs text-white focus:outline-none font-mono tracking-widest"
                      />
                    </div>

                    {/* Color dot picks */}
                    <div>
                      <label className="block text-[10px] font-mono text-slate-400 uppercase tracking-wider mb-1 text-left font-bold">Alliance Visual Color Accent</label>
                      <div className="flex flex-wrap gap-2.5 mt-1.5">
                        {colorPresets.map((colorObj) => (
                          <button
                            key={colorObj.value}
                            type="button"
                            onClick={() => setNewAllColor(colorObj.value)}
                            className={`w-6 h-6 rounded-full border transition-transform cursor-pointer relative flex items-center justify-center ${
                              newAllColor === colorObj.value ? 'scale-125 border-white ring-1 ring-cyan-500/30' : 'border-slate-800 hover:scale-110'
                            }`}
                            style={{ backgroundColor: colorObj.value }}
                            title={colorObj.name}
                          >
                            {newAllColor === colorObj.value && (
                              <Check className="w-3 h-3 text-[#020617] font-black" />
                            )}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Submit Button */}
                    {isAdmin ? (
                      <button
                        id="alliance-create-btn"
                        onClick={() => {
                          if (newAllName.trim() && newAllTag.trim()) {
                            onAddAlliance(newAllName.trim(), newAllTag.trim(), newAllColor);
                            setNewAllName('');
                            setNewAllTag('');
                          }
                        }}
                        className="w-full mt-2 py-3.5 rounded-lg royal-gradient-btn font-heading font-black text-xs uppercase tracking-wider transition-all cursor-pointer"
                      >
                        Launch State Alliance Block
                      </button>
                    ) : (
                      <p className="text-[10px] text-slate-500 font-mono italic p-3 border border-slate-900 bg-slate-950/60 rounded text-center">
                        Alliance creation is locked for Observation guests.
                      </p>
                    )}
                  </div>

                </div>
              </div>
            </div>
          )}

          {/* TAB 5: WEEKS */}
          {activeAdminTab === 'Weeks' && (
            <div className="glass-panel p-6 rounded-2xl border border-slate-800 text-left">
              <div className="border-b border-slate-800 pb-4 mb-5">
                <h3 className="font-heading font-extrabold text-xl text-white">Scheduling Cycle Timelines</h3>
                <p className="text-xs text-slate-400 font-mono">CAMPAIGN WEEKS REGISTERED IN DATABASE</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl border border-cyan-500/20 bg-cyan-950/10 flex justify-between items-center">
                  <div>
                    <h4 className="font-bold text-white text-sm">Week 42: Oct 23 - Oct 29</h4>
                    <p className="text-xs text-slate-400 mt-1 font-mono">Current active state reservation window</p>
                  </div>
                  <span className="text-[10px] font-mono font-bold bg-emerald-950 border border-emerald-500/20 px-2 py-1 rounded text-emerald-400">ACTIVE</span>
                </div>

                <div className="p-4 rounded-xl border border-slate-850 bg-slate-950/40 opacity-70 flex justify-between items-center">
                  <div>
                    <h4 className="font-bold text-slate-350 text-sm">Week 43: Oct 30 - Nov 05</h4>
                    <p className="text-xs text-slate-500 mt-1 font-mono">Pre-seeding locks open in 3 days</p>
                  </div>
                  <span className="text-[10px] font-mono font-bold bg-indigo-950 border border-indigo-505/20 px-2 py-1 rounded text-indigo-400 text-slate-400">QUEUED</span>
                </div>
              </div>
            </div>
          )}

          {/* TAB 6: GOOGLE SHEETS SYNC DESIGNER (ADMIN ONLY VIEW) */}
          {activeAdminTab === 'Google Sheets Sync' && isAdmin && (
            <div className="glass-panel p-6 rounded-2xl border border-emerald-500/20 text-left bg-gradient-to-r from-slate-950 via-[#0a1c33] to-slate-950 relative overflow-hidden mb-1 shadow-[0_0_25px_rgba(16,185,129,0.06)] animate-fade-in">
              <div className="absolute top-0 right-0 w-48 h-48 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />
              
              <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6 pb-5 border-b border-slate-900">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-emerald-950/70 border border-emerald-500/35 flex items-center justify-center text-emerald-400 shrink-0 shadow-[0_0_15px_rgba(16,185,129,0.15)]">
                    <RefreshCw className={`w-5.5 h-5.5 ${isSyncing ? 'animate-spin text-emerald-300' : ''}`} />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-heading font-extrabold text-[#f1f5f9] text-lg">Google Sheets Registry Automator</h3>
                      <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border uppercase tracking-wider ${
                        isSaConfigured 
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25 shadow-[0_0_10px_rgba(16,185,129,0.05)]' 
                          : 'bg-amber-500/10 text-amber-400 border-amber-500/25 animate-pulse'
                      }`}>
                        {isSaConfigured ? 'Secured Server Sync Active' : 'Setup Required'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 max-w-xl mt-1.5 leading-relaxed">
                      Say goodbye to broken browser popups and iframe restrictions! Slot changes now sync securely in the background using a dedicated Google Service Account. Your sheet is kept private and accessible only to you and the sync agent.
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2.5 items-center justify-start lg:justify-end shrink-0">
                  {googleSpreadsheetId && isSaConfigured && (
                    <a
                      href={`https://docs.google.com/spreadsheets/d/${googleSpreadsheetId}/edit`}
                      target="_blank"
                      rel="noreferrer"
                      className="px-4 py-2 rounded-xl border border-slate-800 hover:border-slate-700 bg-slate-950/60 text-[#cbd5e1] hover:text-white text-xs font-semibold transition-all flex items-center gap-2 shadow-sm"
                    >
                      <FileText className="w-4 h-4 text-emerald-400" />
                      Open Online Registry
                    </a>
                  )}
                  <button
                    onClick={handleManualSyncNow}
                    disabled={isSyncing || !isSaConfigured || !googleSpreadsheetId}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-extrabold transition-all shadow-[0_0_15px_rgba(16,185,129,0.25)] flex items-center gap-2"
                  >
                    <CheckCircle className="w-4 h-4" />
                    Sync Records Now
                  </button>
                </div>
              </div>

              {/* SERVICE ACCOUNT DIRECTIONS & CREDENTIALS */}
              <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Step instructions */}
                <div className="flex flex-col gap-3.5 pr-2">
                  <h4 className="text-xs font-mono font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-emerald-500" /> Setup & Security Instructions
                  </h4>
                  
                  <ul className="text-xs text-slate-400 space-y-3 leading-relaxed">
                    <li className="flex items-start gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-slate-900 border border-slate-800 text-slate-300 flex items-center justify-center font-mono font-bold shrink-0 text-[10px]">1</span>
                      <div>
                        <strong className="text-slate-200">Share your spreadsheet:</strong> Go to your Google Sheet, click Share, paste the system service account email below (Editor permission) and click Send.
                      </div>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-slate-900 border border-slate-800 text-slate-300 flex items-center justify-center font-mono font-bold shrink-0 text-[10px]">2</span>
                      <div>
                        <strong className="text-slate-200">Input Sheet details:</strong> Grab your Spreadsheet ID from its URL and input it below, along with your credentials JSON (if updating).
                      </div>
                    </li>
                  </ul>

                  {saEmail ? (
                    <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-900 mt-1 flex flex-col gap-1.5 relative">
                      <span className="text-[10px] font-mono font-bold text-slate-500 uppercase">SYSTEM DELEGATE EMAIL:</span>
                      <div className="flex items-center justify-between gap-2.5">
                        <code className="text-xs font-mono text-[#a7f3d0] break-all select-all font-semibold">{saEmail}</code>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(saEmail);
                            setCopied(true);
                            setTimeout(() => setCopied(false), 2000);
                          }}
                          className="text-[10px] font-mono px-2 py-1 rounded bg-[#092212] border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500 hover:text-white transition-colors cursor-pointer shrink-0"
                        >
                          {copied ? 'Copied!' : 'Copy'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="p-3 text-[11px] bg-amber-950/20 rounded-xl border border-amber-500/10 text-amber-400/90 leading-normal">
                      ℹ️ Credentials JSON isn't set up yet. Paste your Service Account key file content in the credential settings below to generate your system delegate email.
                    </div>
                  )}
                </div>

                {/* Settings inputs */}
                <div className="bg-slate-950/40 p-5 rounded-2xl border border-slate-900 flex flex-col gap-4">
                  <h4 className="text-xs font-mono font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-cyan-500" /> Registry Parameters
                  </h4>

                  {/* Sheet ID Input */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-mono text-slate-400 font-bold uppercase block">Google Spreadsheet ID:</label>
                    <input
                      type="text"
                      value={googleSpreadsheetId}
                      onChange={(e) => setGoogleSpreadsheetId(e.target.value)}
                      placeholder="E.g. 1sU5AasK_1Wp9RzFfHdf98v2..."
                      className="w-full bg-[#050c18] border border-slate-800 focus:border-cyan-500/60 rounded-xl px-3 py-2 text-xs text-white font-mono placeholder-slate-600 outline-none transition-colors"
                    />
                    <span className="text-[9px] text-slate-500">Extracted from spreadsheet URL: <code className="text-slate-400">/spreadsheets/d/[SPEADSHEET_ID_HERE]/edit</code></span>
                  </div>

                  {/* Credentials JSON Key */}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex justify-between items-center">
                      <label className="text-[10px] font-mono text-slate-400 font-bold uppercase">Service Account JSON Key:</label>
                      <button
                        type="button"
                        onClick={() => setShowJsonInput(!showJsonInput)}
                        className="text-[10px] text-cyan-400 hover:underline cursor-pointer"
                      >
                        {showJsonInput ? 'Cancel' : isSaConfigured ? 'Change credentials key' : 'Add credentials key'}
                      </button>
                    </div>

                    {showJsonInput ? (
                      <textarea
                        rows={4}
                        value={googleSaJson}
                        onChange={(e) => setGoogleSaJson(e.target.value)}
                        placeholder='Paste entire {"type": "service_account", ...} JSON file content here'
                        className="w-full bg-[#050c18] border border-slate-850 focus:border-cyan-500/60 rounded-xl p-2.5 text-[10px] text-green-400 font-mono placeholder-slate-700 outline-none transition-all resize-y"
                      />
                    ) : (
                      <div className="w-full bg-slate-950 border border-slate-900 text-slate-500 text-[11px] font-mono rounded-xl px-3 py-2 text-center select-none italic">
                        {isSaConfigured ? '🔒 Encrypted key configured in secure database' : '❌ No private key provided'}
                      </div>
                    )}
                  </div>

                  {/* Divider */}
                  <div className="h-[1px] bg-slate-900/60 my-2" />

                  {/* SMTP Integration Section */}
                  <h4 className="text-xs font-mono font-bold text-slate-350 uppercase tracking-wider flex items-center gap-1.5 pt-1">
                    📬 SMTP Email Dispatcher Setup
                  </h4>

                  {/* Admin Notification Email */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-mono text-slate-400 font-bold uppercase block">Admin Notification Email:</label>
                    <input
                      type="email"
                      value={adminNotificationEmail}
                      onChange={(e) => setAdminNotificationEmail(e.target.value)}
                      placeholder="E.g. admin@yourdomain.com"
                      className="w-full bg-[#050c18] border border-slate-800 focus:border-cyan-500/60 rounded-xl px-3 py-2 text-xs text-white font-mono placeholder-slate-600 outline-none transition-colors"
                    />
                    <span className="text-[9px] text-slate-500">The supreme admin receives real-time reports when a displacement conflict occurs.</span>
                  </div>

                  {/* SMTP Host and Port */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="flex flex-col gap-1.5 col-span-2">
                      <label className="text-[10px] font-mono text-slate-400 font-bold uppercase block">SMTP Host:</label>
                      <input
                        type="text"
                        value={smtpHost}
                        onChange={(e) => setSmtpHost(e.target.value)}
                        placeholder="smtp.gmail.com"
                        className="w-full bg-[#050c18] border border-slate-800 focus:border-cyan-500/60 rounded-xl px-3 py-2 text-xs text-white font-mono placeholder-slate-600 outline-none transition-colors"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-mono text-slate-400 font-bold uppercase block">SMTP Port:</label>
                      <input
                        type="text"
                        value={smtpPort}
                        onChange={(e) => setSmtpPort(e.target.value)}
                        placeholder="465"
                        className="w-full bg-[#050c18] border border-slate-800 focus:border-cyan-500/60 rounded-xl px-3 py-2 text-xs text-white font-mono placeholder-slate-600 outline-none transition-colors"
                      />
                    </div>
                  </div>

                  {/* SMTP Username */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-mono text-slate-400 font-bold uppercase block">SMTP Username / Email Address:</label>
                    <input
                      type="text"
                      value={smtpUser}
                      onChange={(e) => setSmtpUser(e.target.value)}
                      placeholder="E.g. naiksarthak920@gmail.com"
                      className="w-full bg-[#050c18] border border-slate-800 focus:border-cyan-500/60 rounded-xl px-3 py-2 text-xs text-white font-mono placeholder-slate-600 outline-none transition-colors"
                    />
                  </div>

                  {/* Friendly From Address */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-mono text-slate-400 font-bold uppercase block">Display Sender name:</label>
                    <input
                      type="text"
                      value={smtpFrom}
                      onChange={(e) => setSmtpFrom(e.target.value)}
                      placeholder='E.g. SVS Booking <naiksarthak920@gmail.com>'
                      className="w-full bg-[#050c18] border border-slate-800 focus:border-cyan-500/60 rounded-xl px-3 py-2 text-xs text-white font-mono placeholder-slate-600 outline-none transition-colors"
                    />
                  </div>

                  {/* App Password */}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex justify-between items-center">
                      <label className="text-[10px] font-mono text-slate-400 font-bold uppercase">SMTP / Gmail App Password:</label>
                      <button
                        type="button"
                        onClick={() => setShowSmtpPassInput(!showSmtpPassInput)}
                        className="text-[10px] text-cyan-400 hover:underline cursor-pointer"
                      >
                        {showSmtpPassInput ? 'Cancel' : isSmtpConfigured ? 'Change Password' : 'Add Password'}
                      </button>
                    </div>

                    {showSmtpPassInput ? (
                      <input
                        type="password"
                        value={smtpPass}
                        onChange={(e) => setSmtpPass(e.target.value)}
                        placeholder="Enter SMTP password or Gmail App Password"
                        className="w-full bg-[#050c18] border border-slate-800 focus:border-cyan-500/60 rounded-xl px-3 py-2 text-xs text-white font-mono placeholder-slate-600 outline-none transition-colors"
                      />
                    ) : (
                      <div className="w-full bg-slate-950 border border-slate-900 text-slate-500 text-[11px] font-mono rounded-xl px-3 py-2 text-center select-none italic">
                        {isSmtpConfigured ? '🔑 SMTP password configured & active' : '❌ SMTP inactive (emails disabled)'}
                      </div>
                    )}
                    <span className="text-[9px] text-slate-500">Requires a valid SMTP credential. For standard Gmail addresses, configure Google 2-Step Verification, generate a 16-character <b>App Password</b>, and configure host <b>smtp.gmail.com</b> with Port <b>465</b>.</span>
                  </div>

                  {/* Action button */}
                  <div className="flex items-center justify-between gap-3 pt-3">
                    <span className="text-[10px] font-mono text-slate-400 font-bold tracking-tight">
                      {syncStatusMsg && <span className="text-slate-350">{syncStatusMsg}</span>}
                    </span>
                    <button
                      onClick={handleSaveSheetsSettings}
                      disabled={isSyncing}
                      className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-30 disabled:cursor-not-allowed text-white text-xs font-bold transition-all shadow-[0_0_15px_rgba(6,182,212,0.15)] flex items-center gap-1.5"
                    >
                      Save Configuration Settings
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>

      </div>
    </div>
  );
}
