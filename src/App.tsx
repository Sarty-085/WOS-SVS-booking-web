import React, { useState, useEffect } from 'react';
import { 
  Bell, Shield, Terminal, Menu, X, Crown, CalendarDays, Lock, 
  Sparkles, CheckCircle, Smartphone, Laptop, Trash2, ShieldAlert
} from 'lucide-react';
import { 
  INITIAL_ALLIANCES, INITIAL_BOOKINGS, INITIAL_AUDIT_LOGS, 
  loadDailySlots, generateEmptySlots, CAMPAIGN_WEEKS 
} from './dataStore';
import { Alliance, Booking, Slot, AuditLog, EventType, StateEntity, AdminSession } from './types';
import LandingPage from './components/LandingPage';
import TitleBookingForm from './components/TitleBookingForm';
import AdminLoginCard from './components/AdminLoginCard';
import ScheduleAdminPage from './components/ScheduleAdminPage';
import { motion, AnimatePresence } from 'motion/react';

type NavigationTab = 'Landing' | 'Reservations' | 'Schedule' | 'Admin';

export default function App() {
  // Navigation
  const [activeTab, setActiveTab] = useState<NavigationTab>('Landing');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Multi-State partitioned tracking
  const [states, setStates] = useState<StateEntity[]>([]);
  const [selectedState, setSelectedState] = useState<StateEntity | null>(() => {
    const saved = localStorage.getItem('royal_slots_selected_state');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { return null; }
    }
    return null;
  });

  // Admin authentication states
  const [adminSession, setAdminSession] = useState<AdminSession | null>(() => {
    const saved = localStorage.getItem('royal_slots_admin_session');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { return null; }
    }
    return null;
  });

  // Core Database States
  const [alliances, setAlliances] = useState<Alliance[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [activeWeek, setActiveWeek] = useState<string>('w23');
  
  // Selected Event Scheduling day (Monday by default)
  const [selectedDay, setSelectedDay] = useState<EventType>('monday');

  // Admin state fields compatibility variables
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminUsername, setAdminUsername] = useState('admin');

  // Trigger notice states for custom UI alerts
  const [notifCount, setNotifCount] = useState(3);
  const [showNotifications, setShowNotifications] = useState(false);
  const [demoBannerOpen, setDemoBannerOpen] = useState(true);

  // Fetch available multi-state partitions on startup
  useEffect(() => {
    const fetchStates = async () => {
      try {
        const res = await fetch('/api/states');
        if (res.ok) {
          const list: StateEntity[] = await res.json();
          setStates(list);

          // Restore or select default state
          const savedStr = localStorage.getItem('royal_slots_selected_state');
          let parsed: StateEntity | null = null;
          if (savedStr) {
            try { parsed = JSON.parse(savedStr); } catch (e) {}
          }

          if (parsed) {
            const exists = list.find(s => s.id === parsed.id);
            if (exists) {
              setSelectedState(exists);
              localStorage.setItem('royal_slots_selected_state', JSON.stringify(exists));
            } else {
              setSelectedState(null);
              localStorage.removeItem('royal_slots_selected_state');
            }
          } else {
            setSelectedState(null);
          }
        }
      } catch (err) {
        console.error("Failed to load states:", err);
      }
    };
    fetchStates();

    // Load admin session state
    const savedAdminAuth = localStorage.getItem('royal_slots_admin_auth');
    if (savedAdminAuth === 'true' && adminSession) {
      setIsAdmin(true);
      setAdminUsername(adminSession.username);
    }
  }, []);

  // Fetch state-specific data whenever selection pivots
  useEffect(() => {
    const fetchStateData = async () => {
      if (!selectedState) return;
      try {
        const alliancesRes = await fetch(`/api/alliances?stateId=${selectedState.id}`);
        if (alliancesRes.ok) {
          const alls = await alliancesRes.json();
          setAlliances(alls);
        }

        const bookingsRes = await fetch(`/api/bookings?stateId=${selectedState.id}`);
        if (bookingsRes.ok) {
          const bks = await bookingsRes.json();
          setBookings(bks);
        }

        const auditRes = await fetch(`/api/audit-logs?stateId=${selectedState.id}`);
        if (auditRes.ok) {
          const logs = await auditRes.json();
          setAuditLogs(logs);
        }

        // Fetch active reservation week setting from DB
        const valRes = await fetch('/api/settings/active_week');
        if (valRes.ok) {
          const data = await valRes.json();
          if (data.value) {
            setActiveWeek(data.value);
          }
        }
      } catch (e) {
        console.error("Error loading state filtered data:", e);
      }
    };
    fetchStateData();
  }, [selectedState]);

  // Change active reservation week in database
  const handleChangeActiveWeek = async (newWeek: string) => {
    try {
      const response = await fetch('/api/settings/active_week', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: newWeek })
      });
      if (response.ok) {
        setActiveWeek(newWeek);
        addAuditLog(
          isAdmin ? adminUsername : 'System',
          'edit_alliance',
          `Operational horizon shifted to week: ${newWeek.toUpperCase()}`
        );
      }
    } catch (err) {
      console.error("Error setting active week:", err);
    }
  };

  // Log audit helper
  const addAuditLog = async (operator: string, action: AuditLog['action'], details: string) => {
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
      setAuditLogs(prev => [newLog, ...prev]);
    } catch (err) {
      console.error("Error saving audit log:", err);
    }
  };

  // --- ACTIONS REQUESTED BY USER ---

  // 1. Rename Alliance
  const handleRenameAlliance = async (id: string, name: string) => {
    const previous = alliances.find(a => a.id === id);
    try {
      const response = await fetch(`/api/alliances/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      if (!response.ok) {
        throw new Error("HTTP connection error updating alliance");
      }

      // Refetch from database
      const alliancesRes = await fetch(selectedState ? `/api/alliances?stateId=${selectedState.id}` : '/api/alliances');
      if (alliancesRes.ok) {
        const alls = await alliancesRes.json();
        setAlliances(alls);
      } else {
        setAlliances(alliances.map(all => all.id === id ? { ...all, name } : all));
      }

      addAuditLog(
        isAdmin ? adminUsername : 'System',
        'edit_alliance',
        `Renamed Alliance "${previous?.name || 'Unknown'}" (${previous?.tag}) to "${name}"`
      );
    } catch (err) {
      console.error(err);
      alert("Error saving renamed alliance to persistent DB.");
    }
  };

  // 2. Delete Alliance
  const handleDeleteAlliance = async (id: string) => {
    const target = alliances.find(a => a.id === id);
    if (!target) return;

    try {
      const response = await fetch(`/api/alliances/${id}`, { method: 'DELETE' });
      if (!response.ok) {
        throw new Error("HTTP error deleting alliance");
      }

      // Refetch to guarantee absolute sync
      const alliancesRes = await fetch(selectedState ? `/api/alliances?stateId=${selectedState.id}` : '/api/alliances');
      if (alliancesRes.ok) {
        const alls = await alliancesRes.json();
        setAlliances(alls);
      } else {
        setAlliances(alliances.filter(all => all.id !== id));
      }
      
      const remainingBookings = bookings.filter(b => b.allianceId !== id);
      setBookings(remainingBookings);

      addAuditLog(
        isAdmin ? adminUsername : 'System',
        'delete_alliance',
        `Deleted Alliance "${target.name}" (${target.tag}) which removed associated event slots.`
      );
    } catch (err) {
      console.error(err);
      alert("Error deleting alliance from database.");
    }
  };

  // 3. Create Alliance
  const handleAddAlliance = async (name: string, tag: string, color: string) => {
    if (alliances.some(all => all.tag.toLowerCase() === tag.toLowerCase())) {
      alert(`An alliance with the tag "${tag.toUpperCase()}" already exists!`);
      return;
    }

    const newAll = {
      id: `all-${Date.now()}`,
      name,
      tag: tag.toUpperCase(),
      color,
      stateId: selectedState?.id
    };

    try {
      const response = await fetch('/api/alliances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newAll)
      });
      if (!response.ok) {
        throw new Error("HTTP connection error adding alliance");
      }

      // Refetch to guarantee absolute sync
      const alliancesRes = await fetch(selectedState ? `/api/alliances?stateId=${selectedState.id}` : '/api/alliances');
      if (alliancesRes.ok) {
        const alls = await alliancesRes.json();
        setAlliances(alls);
      } else {
        setAlliances([...alliances, { id: newAll.id, name: newAll.name, tag: newAll.tag, color: newAll.color }]);
      }

      addAuditLog(
        isAdmin ? adminUsername : 'System',
        'create_alliance',
        `Launched New State Alliance Block: "${name}" [${tag.toUpperCase()}]`
      );
    } catch (err) {
      console.error(err);
      alert("Error saving new alliance to persistent DB.");
    }
  };

  // 4. Create / Register Booking Slot from form
  const handleAddBooking = async (bookingData: Omit<Booking, 'id' | 'timestamp'>) => {
    const newBooking: Booking = {
      id: `book-${Date.now()}`,
      ...bookingData,
      stateId: selectedState?.id || undefined,
      timestamp: new Date().toISOString()
    };

    try {
      const response = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newBooking)
      });
      if (!response.ok) {
        throw new Error("HTTP connection error adding booking");
      }
      const updated = [...bookings, newBooking];
      setBookings(updated);

      addAuditLog(
        'System Scheduler',
        'create_booking',
        `New Claim registered: Operator "${bookingData.playerName}" booked slot ${bookingData.slotId} for campaign ${bookingData.eventType.toUpperCase()}`
      );
    } catch (err) {
      console.error(err);
      alert("Error saving booking. Please try again.");
    }
  };

  // 5. Delete Booking
  const handleDeleteBooking = async (id: string) => {
    const target = bookings.find(b => b.id === id);
    if (!target) return;

    try {
      await fetch(`/api/bookings/${id}`, { method: 'DELETE' });
      const remaining = bookings.filter(b => b.id !== id);
      setBookings(remaining);

      addAuditLog(
        isAdmin ? adminUsername : 'System',
        'delete_booking',
        `Canceled Reservation: Player "${target.playerName}" evicted from Slot ${target.slotId} on event ${target.eventType.toUpperCase()}`
      );
    } catch (err) {
      console.error(err);
    }
  };

  // 6. Edit/Modify someone's booking slot
  const handleUpdateBookingSlot = async (bookingId: string, primarySlot: string, speedupDays: number, speedupHours: number) => {
    const previous = bookings.find(b => b.id === bookingId);
    if (!previous) return;

    const updatedScore = (speedupDays * 24 * 60) + (speedupHours * 60);

    try {
      await fetch(`/api/bookings/${bookingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slotId: primarySlot,
          speedupDays,
          speedupHours,
          score: updatedScore
        })
      });

      const modified = bookings.map(b => {
        if (b.id === bookingId) {
          return {
            ...b,
            slotId: primarySlot,
            speedupDays,
            speedupHours,
            score: updatedScore
          };
        }
        return b;
      });

      setBookings(modified);
      addAuditLog(
        isAdmin ? adminUsername : 'System',
        'edit_booking',
        `Slot Correction: Adjusted ${previous.playerName} to Slot "${primarySlot}" with priority weight ${updatedScore} DP.`
      );
    } catch (err) {
      console.error(err);
    }
  };

  // Multi-State Partition Registration and Management Actions
  const handleAddState = async (stateNumber: string) => {
    try {
      const res = await fetch('/api/states', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(adminSession?.token ? { 'Authorization': `Bearer ${adminSession.token}` } : {})
        },
        body: JSON.stringify({ stateNumber })
      });
      if (res.ok) {
        const newState = await res.json();
        setStates(prev => [...prev, newState]);
        if (!selectedState) {
          setSelectedState(newState);
          localStorage.setItem('royal_slots_selected_state', JSON.stringify(newState));
        }
        alert(`Successfully registered State ${stateNumber} partition boundaries.`);
      } else {
        const errData = await res.json();
        alert(errData.error || "Failed to register State partition.");
      }
    } catch (err) {
      console.error(err);
      alert("Error registering state partition.");
    }
  };

  const handleDeleteState = async (id: string) => {
    if (!confirm("Are you sure you want to permanently purge this State partition? All associated alliances, bookings, and sync credentials will be destroyed!")) {
      return;
    }
    try {
      const res = await fetch(`/api/states/${id}`, {
        method: 'DELETE',
        headers: {
          ...(adminSession?.token ? { 'Authorization': `Bearer ${adminSession.token}` } : {})
        }
      });
      if (res.ok) {
        setStates(prev => {
          const updated = prev.filter(s => s.id !== id);
          if (selectedState?.id === id) {
            if (updated.length > 0) {
              const fallback = updated.find(s => s.state_number === '1085') || updated[0];
              setSelectedState(fallback);
              localStorage.setItem('royal_slots_selected_state', JSON.stringify(fallback));
            } else {
              setSelectedState(null);
              localStorage.removeItem('royal_slots_selected_state');
            }
          }
          return updated;
        });
      } else {
        const errorData = await res.json();
        alert(errorData.error || "Failed to purge database state partition.");
      }
    } catch (err: any) {
      console.error(err);
      alert("Error purging state partition: " + err.message);
    }
  };

  const handleUpdateStateGoogleSheets = async (id: string, spreadsheetId: string, sheetName: string) => {
    try {
      const res = await fetch(`/api/states/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(adminSession?.token ? { 'Authorization': `Bearer ${adminSession.token}` } : {})
        },
        body: JSON.stringify({ googleSpreadsheetId: spreadsheetId, googleSheetName: sheetName })
      });
      if (res.ok) {
        setStates(prev => prev.map(s => s.id === id ? { ...s, google_spreadsheet_id: spreadsheetId, google_sheet_name: sheetName } : s));
        if (selectedState?.id === id) {
          const updatedState = { ...selectedState, google_spreadsheet_id: spreadsheetId, google_sheet_name: sheetName };
          setSelectedState(updatedState);
          localStorage.setItem('royal_slots_selected_state', JSON.stringify(updatedState));
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Admin Session Management
  const handleAdminLogin = (username: string, roleLevel: 'root' | 'state_admin' = 'state_admin', assignedStateId: string | null = null, token?: string) => {
    setIsAdmin(true);
    setAdminUsername(username);
    const sessionObj: AdminSession = { isAuthenticated: true, username, roleLevel, assignedStateId, token };
    setAdminSession(sessionObj);
    localStorage.setItem('royal_slots_admin_session', JSON.stringify(sessionObj));
    localStorage.setItem('royal_slots_admin_auth', 'true');
    localStorage.setItem('royal_slots_admin_user', username);

    // If restricted state-boundary admin is mapping, force focus selection
    if (roleLevel === 'state_admin' && assignedStateId) {
      const assigned = states.find(s => s.id === assignedStateId);
      if (assigned) {
        setSelectedState(assigned);
        localStorage.setItem('royal_slots_selected_state', JSON.stringify(assigned));
      }
    }

    setActiveTab('Schedule'); // Slide right to the scheduler dashboard on sign-in
    addAuditLog(username, 'slot_lock', `Clearance authenticated as ${roleLevel.toUpperCase()}. Session established on terminal host.`);
  };

  const handleAdminLogout = () => {
    addAuditLog(adminUsername, 'slot_unlock', `Session terminated. Clearance revoked from terminal host.`);
    setIsAdmin(false);
    setAdminSession(null);
    localStorage.removeItem('royal_slots_admin_session');
    localStorage.setItem('royal_slots_admin_auth', 'false');
    setActiveTab('Landing');
  };

  const handleBypassAuth = () => {
    handleAdminLogin('Sarthak_Admin', 'root', null, 'bypass_token');
  };

  // Compute live slots list for rendering based on current selectedDay and bookings of the active week only
  const filteredBookings = bookings.filter(b => (b.week || 'w23') === activeWeek);
  const currentSlotsList = loadDailySlots(selectedDay, filteredBookings);

  // Navigation redirectors
  const handleBookDayDirect = (day: EventType) => {
    setSelectedDay(day);
    setActiveTab('Reservations');
  };

  return (
    <div className="min-h-screen bg-[#020617] text-[#dce1fb] font-sans flex flex-col justify-between relative overflow-hidden bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900/40 via-[#020617] to-[#020617]">
      
      {/* GLOBAL DEMO BANNER REMOVED */}

      {/* HEADER NAVBAR CONTAINER */}
      <header className="sticky top-0 z-40 bg-[#020617]/75 backdrop-blur-md border-b border-slate-900">
        <div className="max-w-7xl mx-auto px-4 h-16 md:h-20 flex items-center justify-between">
          
          {/* Brand Name */}
          <div 
            onClick={() => { setActiveTab('Landing'); }}
            className="flex items-center gap-2 cursor-pointer group"
          >
            <div className="w-8 h-8 rounded-lg royal-gradient-btn flex items-center justify-center p-1.5 shadow-[0_0_15px_rgba(6,182,212,0.3)]">
              <CalendarDays className="text-white w-full h-full" />
            </div>
            <span className="font-heading text-xl font-extrabold text-white tracking-wider uppercase group-hover:text-cyan-400 transition-colors">
              Prep <span className="text-silver-cyan">Booking</span>
            </span>
          </div>

          {/* Center Links (Landing, Reservations, Schedule, Admin) */}
          <nav className="hidden md:flex items-center bg-slate-950/40 p-1.5 rounded-xl border border-slate-900">
            <button
              onClick={() => setActiveTab('Landing')}
              className={`px-4 py-2 rounded-lg text-xs font-semibold tracking-wider uppercase font-heading transition-all ${
                activeTab === 'Landing' 
                  ? 'text-cyan-400 font-black border-b border-cyan-400 py-1' 
                  : 'text-slate-400 hover:text-cyan-400'
              }`}
            >
              Landing
            </button>
            {selectedState && (
              <>
                <button
                  onClick={() => setActiveTab('Reservations')}
                  className={`px-4 py-2 rounded-lg text-xs font-semibold tracking-wider uppercase font-heading transition-all ${
                    activeTab === 'Reservations' 
                      ? 'text-cyan-400 font-black border-b border-cyan-400 py-1' 
                      : 'text-slate-400 hover:text-cyan-400'
                  }`}
                >
                  Reservations
                </button>
                <button
                  onClick={() => setActiveTab('Schedule')}
                  className={`px-4 py-2 rounded-lg text-xs font-semibold tracking-wider uppercase font-heading transition-all ${
                    activeTab === 'Schedule' 
                      ? 'text-cyan-400 font-black border-b border-cyan-400 py-1' 
                      : 'text-slate-400 hover:text-cyan-400'
                  }`}
                >
                  Schedule
                </button>
              </>
            )}
            <button
              onClick={() => setActiveTab('Admin')}
              className={`px-4 py-2 rounded-lg text-xs font-semibold tracking-wider uppercase font-heading transition-all flex items-center gap-1.5 ${
                activeTab === 'Admin' 
                  ? 'text-cyan-400 font-black border-b border-cyan-400 py-1' 
                  : 'text-slate-400 hover:text-cyan-400'
              }`}
            >
              <Shield className="w-3.5 h-3.5" />
              {isAdmin ? 'Admin Portal' : 'Admin'}
            </button>
          </nav>

          {/* Right Action buttons */}
          <div className="hidden md:flex items-center gap-3.5">
            {/* Notifications Bell */}
            <div className="relative">
              <button 
                onClick={() => {
                  setShowNotifications(!showNotifications);
                  setNotifCount(0);
                }}
                className="p-2 border border-slate-800 hover:bg-slate-900 rounded-lg text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                <Bell className="w-4 h-4" />
                {notifCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-[9px] font-mono font-bold text-white flex items-center justify-center animate-bounce">
                    {notifCount}
                  </span>
                )}
              </button>

              {/* Dropdown panel */}
              {showNotifications && (
                <div className="absolute right-0 mt-2.5 w-72 p-4 rounded-xl border border-slate-800 bg-[#070d1f] shadow-2xl text-left z-50">
                  <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider block border-b border-slate-850 pb-1.5 mb-2">TACTICAL NOTIFICATIONS</span>
                  <div className="flex flex-col gap-2.5 text-xs">
                    <div className="flex gap-2">
                      <CheckCircle className="w-3.5 h-3.5 text-cyan-400 shrink-0 mt-0.5" />
                      <p className="text-slate-300"><span className="font-bold text-white">Monday Construction:</span> Cycle is officially OPEN for pre-bookings.</p>
                    </div>
                    <div className="flex gap-2">
                      <ShieldAlert className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                      <p className="text-slate-300"><span className="font-bold text-white">Displacement notice:</span> Higher score elements displaced slot vectors at 09:30.</p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {isAdmin && (
              <div className="inline-flex items-center gap-1.5 bg-cyan-950/40 border border-cyan-500/30 text-cyan-300 font-mono text-[10px] px-3.5 py-2 rounded-xl h-9">
                <Shield className="w-3 h-3 text-cyan-400 animate-pulse" />
                <span>COMMANDER: AD ELEVATED</span>
              </div>
            )}
          </div>

          {/* Mobile hamburger menu toggle */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2 text-slate-400 hover:text-white border border-slate-900 rounded-lg"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>

        </div>

        {/* MOBILE MENU DROPDOWN */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-slate-900 bg-[#020617] p-4 flex flex-col gap-3 text-left">
            <button
              onClick={() => { setActiveTab('Landing'); setMobileMenuOpen(false); }}
              className={`py-2 px-3 text-sm font-semibold rounded ${activeTab === 'Landing' ? 'bg-sky-950/60 text-sky-450 font-bold' : 'text-slate-400'}`}
            >
              Landing Base
            </button>
            {selectedState && (
              <>
                <button
                  onClick={() => { setActiveTab('Reservations'); setMobileMenuOpen(false); }}
                  className={`py-2 px-3 text-sm font-semibold rounded ${activeTab === 'Reservations' ? 'bg-sky-950/60 text-sky-450 font-bold' : 'text-slate-400'}`}
                >
                  Reservations Form
                </button>
                <button
                  onClick={() => { setActiveTab('Schedule'); setMobileMenuOpen(false); }}
                  className={`py-2 px-3 text-sm font-semibold rounded ${activeTab === 'Schedule' ? 'bg-sky-950/60 text-sky-450 font-bold' : 'text-slate-400'}`}
                >
                  Scheduling Grid
                </button>
              </>
            )}
            <button
              onClick={() => { setActiveTab('Admin'); setMobileMenuOpen(false); }}
              className={`py-2 px-3 text-sm font-semibold rounded flex items-center gap-2 ${activeTab === 'Admin' ? 'bg-sky-950/60 text-sky-450' : 'text-slate-400'}`}
            >
              <Shield className="w-4 h-4" />
              Admin Portal
            </button>

            {isAdmin && (
              <div className="border-t border-slate-900 my-1 pt-3 flex flex-col gap-2">
                <div className="p-3 bg-cyan-950/15 border border-cyan-500/20 text-cyan-300 rounded-xl text-xs flex gap-2 font-mono items-center">
                  <span className="w-2 h-2 rounded bg-cyan-400 animate-ping" />
                  <span>Terminal Clearance: Master AD</span>
                </div>
              </div>
            )}
          </div>
        )}
      </header>

      {/* PRIMARY VIEWER CONTAINER */}
      <main className="flex-grow">
        <AnimatePresence mode="wait">
          {activeTab === 'Landing' && (
            <motion.div
              key="landing"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              transition={{ duration: 0.3 }}
            >
              <LandingPage 
                onNavigate={setActiveTab} 
                onBookDay={handleBookDayDirect}
                states={states}
                selectedState={selectedState}
                onSelectState={(st) => {
                  setSelectedState(st);
                  localStorage.setItem('royal_slots_selected_state', JSON.stringify(st));
                }}
                onAddState={handleAddState}
              />
            </motion.div>
          )}

          {activeTab === 'Reservations' && (
            <motion.div
              key="reservations"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
            >
              <TitleBookingForm 
                alliances={alliances} 
                onAddBooking={(b) => {
                  handleAddBooking(b);
                  setActiveTab('Schedule'); // Slide direct to Schedule grid to see their results
                }} 
                initialSelectedDay={selectedDay}
                activeWeek={activeWeek}
              />
            </motion.div>
          )}

          {activeTab === 'Schedule' && (
            <motion.div
              key="schedule"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.3 }}
            >
              <ScheduleAdminPage
                alliances={alliances}
                bookings={bookings}
                auditLogs={auditLogs}
                slots={currentSlotsList}
                selectedDay={selectedDay}
                isAdmin={isAdmin}
                adminUsername={adminUsername}
                adminSession={adminSession}
                states={states}
                selectedState={selectedState}
                onAddState={handleAddState}
                onUpdateStateGoogleSheets={handleUpdateStateGoogleSheets}
                onDeleteState={handleDeleteState}
                activeWeek={activeWeek}
                onChangeActiveWeek={handleChangeActiveWeek}
                onSetSelectedDay={setSelectedDay}
                onAddAlliance={handleAddAlliance}
                onRenameAlliance={handleRenameAlliance}
                onDeleteAlliance={handleDeleteAlliance}
                onDeleteBooking={handleDeleteBooking}
                onUpdateBookingSlot={handleUpdateBookingSlot}
                onLogoutAdmin={handleAdminLogout}
                onAddBooking={handleAddBooking}
              />
            </motion.div>
          )}

          {activeTab === 'Admin' && (
            <motion.div
              key="admin"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.3 }}
            >
              {isAdmin ? (
                // If logged in already, display the scheduling dashboard using correct context pointers
                <div className="max-w-4xl mx-auto py-12 px-4 text-center">
                  <div className="glass-panel p-8 rounded-2xl border border-cyan-500/20 max-w-xl mx-auto">
                    <Shield className="w-16 h-16 text-cyan-400 mx-auto mb-4 animate-pulse" />
                    <h3 className="font-heading text-2xl font-black text-white">ACCESS GRANTED</h3>
                    <p className="text-xs font-mono text-cyan-400 tracking-widest mt-1 uppercase mb-6">Master Console Terminal Online</p>
                    
                    <div className="p-4 rounded-xl bg-slate-950 border border-slate-900 text-left font-mono text-xs text-slate-300 mb-6 flex flex-col gap-2.5">
                      <p>• Terminal Name: <span className="text-white font-bold">{adminUsername}</span></p>
                      <p>• Permission Level: <span className="text-emerald-400 font-bold">Supreme Root Administrator [LEV 5]</span></p>
                      <p>• Alliance Control Panel: <span className="text-white font-bold">Enabled</span></p>
                      <p>• Overrides & Evictions: <span className="text-white font-bold">ACTIVE</span></p>
                    </div>

                    <div className="flex flex-col gap-3">
                      <button
                        onClick={() => setActiveTab('Schedule')}
                        className="w-full py-3 rounded-xl bg-[#081430] text-sky-400 border border-sky-500/30 hover:bg-sky-950/40 text-xs font-bold font-heading transition-colors block text-center"
                      >
                        Enter Scheduling Command Deck
                      </button>

                      <button
                        onClick={handleAdminLogout}
                        className="w-full py-3 rounded-xl border border-rose-500/30 text-rose-450 hover:bg-rose-950/15 text-xs font-bold font-heading transition-colors"
                      >
                        Disconnect Secure Session
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <AdminLoginCard 
                  onLoginSuccess={handleAdminLogin} 
                  onBypass={handleBypassAuth}
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* FOOTER BAR */}
      <footer className="border-t border-slate-900 py-6 md:py-10 bg-slate-950/40 text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="font-heading font-extrabold text-slate-400 uppercase tracking-wider text-sm">Prep Booking</span>
            <span className="text-slate-700">|</span>
            <p className="font-mono text-[11px]">Priority State Engine • UTC Time: 13:30</p>
          </div>

          <div className="flex items-center gap-6">
            <button 
              onClick={() => { setActiveTab('Landing'); }}
              className="hover:text-sky-300 transition-colors cursor-pointer"
            >
              System Map
            </button>
            <button 
              onClick={() => { setActiveTab('Schedule'); }}
              className="hover:text-sky-300 transition-colors cursor-pointer"
            >
              Control Deck
            </button>
            <a 
              href="https://discord.gg/AjEYdg8nyP" 
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-sky-300 transition-colors"
            >
              State Support
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
