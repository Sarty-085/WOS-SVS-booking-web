import React, { useState, useEffect } from 'react';
import { Crown, Lock, User, Hash, Mail, Shield, Zap, Calendar, ClipboardCheck, BellRing } from 'lucide-react';
import { Alliance, Booking, EventType } from '../types';
import { CAMPAIGN_WEEKS } from '../dataStore';
import { motion } from 'motion/react';

interface TitleBookingFormProps {
  alliances: Alliance[];
  onAddBooking: (booking: Omit<Booking, 'id' | 'timestamp'>) => void;
  initialSelectedDay?: EventType;
  activeWeek?: string;
}

export default function TitleBookingForm({ alliances, onAddBooking, initialSelectedDay = 'monday', activeWeek = 'w23' }: TitleBookingFormProps) {
  // Input fields state
  const [playerName, setPlayerName] = useState('');
  const [userId, setUserId] = useState('');
  const [email, setEmail] = useState('');
  const [discordUsername, setDiscordUsername] = useState('');
  const [selectedAllianceId, setSelectedAllianceId] = useState('');
  const [eventType, setEventType] = useState<EventType>(initialSelectedDay);
  
  // Priority Speedups
  const [speedupDays, setSpeedupDays] = useState<number>(0);
  const [speedupHours, setSpeedupHours] = useState<number>(0);
  const [totalScore, setTotalScore] = useState<number>(0);

  // Slots matching requirements
  const [primarySlot, setPrimarySlot] = useState('09:00');
  const [backupSlot1, setBackupSlot1] = useState('09:30');
  const [backupSlot2, setBackupSlot2] = useState('10:00');
  const [backupSlot3, setBackupSlot3] = useState('10:30');
  const [autoAssign, setAutoAssign] = useState(true);

  // Success Feedback
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Auto calculate score
  useEffect(() => {
    const days = Math.max(0, speedupDays || 0);
    const hours = Math.max(0, speedupHours || 0);
    const score = (days * 24 * 60) + (hours * 60);
    setTotalScore(score);
  }, [speedupDays, speedupHours]);

  // Handle event tab switch
  useEffect(() => {
    if (initialSelectedDay) {
      setEventType(initialSelectedDay);
    }
  }, [initialSelectedDay]);

  // Generate 48 time intervals e.g. "00:00", "00:30"
  const timeIntervals: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 30) {
      const hh = h.toString().padStart(2, '0');
      const mm = m.toString().padStart(2, '0');
      timeIntervals.push(`${hh}:${mm}`);
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    // Validations
    if (!playerName.trim()) {
      setErrorMsg('In-Game Name is required.');
      return;
    }
    if (!userId.trim()) {
      setErrorMsg('In-Game User ID is required.');
      return;
    }
    if (email.trim() && !email.includes('@')) {
      setErrorMsg('If specified, the email address must be a valid email containing "@".');
      return;
    }
    if (!selectedAllianceId) {
      setErrorMsg('Please select your alliance affiliation.');
      return;
    }

    onAddBooking({
      playerName: playerName.trim(),
      userId: userId.trim(),
      email: email.trim(),
      discordUsername: discordUsername.trim(),
      allianceId: selectedAllianceId,
      eventType,
      speedupDays: speedupDays || 0,
      speedupHours: speedupHours || 0,
      score: totalScore,
      slotId: primarySlot,
      backupSlots: [backupSlot1, backupSlot2, backupSlot3].filter(s => s !== primarySlot),
      autoAssign
    });

    setSuccessMsg(`Imperial Slot booked successfully! Player "${playerName}" submitted allocation for ${eventType.toUpperCase()} at slot ${primarySlot}.`);
    
    // Reset form selectively
    setPlayerName('');
    setUserId('');
    setEmail('');
    setDiscordUsername('');
    setSpeedupDays(0);
    setSpeedupHours(0);
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 relative">
      {/* Decorative Blur Backgrounds */}
      <div className="absolute -top-10 right-20 w-[200px] h-[200px] bg-sky-500/10 rounded-full blur-[80px] pointer-events-none" />
      <div className="absolute bottom-1/2 left-10 w-[250px] h-[250px] bg-indigo-500/10 rounded-full blur-[100px] pointer-events-none" />

      {/* Header Container */}
      <div className="text-center md:text-left mb-8 border-b border-slate-800/80 pb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl md:text-4xl font-extrabold text-white mb-2 tracking-tight">
            Title Booking <span className="text-silver-cyan">Form</span>
          </h1>
          <p className="text-slate-400 text-sm">
            Secure your slot in the upcoming state vs state. High priority score listings always claim supreme authority.
          </p>
        </div>
        <div className="px-4 py-2 bg-slate-900 border border-slate-800 rounded-xl self-start md:self-center text-left">
          <p className="text-[10px] text-slate-400 font-mono uppercase tracking-widest">Active Horizon</p>
          <p className="text-xs font-bold font-mono text-sky-450 mt-0.5">
            {CAMPAIGN_WEEKS.find(w => w.id === activeWeek)?.label || activeWeek}
          </p>
        </div>
      </div>

      {successMsg && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 p-4 rounded-xl bg-emerald-950/65 border border-emerald-500/40 text-emerald-300 text-sm flex items-start gap-3"
        >
          <ClipboardCheck className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
          <span>{successMsg}</span>
        </motion.div>
      )}

      {errorMsg && (
        <div className="mb-6 p-4 rounded-xl bg-rose-950/65 border border-rose-500/40 text-rose-300 text-sm">
          {errorMsg}
        </div>
      )}

      {/* Main Form Box */}
      <form onSubmit={handleSubmit} className="glass-panel-heavy p-6 md:p-8 rounded-2xl flex flex-col gap-8">
        
        {/* Section 1: Player Information */}
        <div>
          <div className="flex items-center gap-2 mb-4 border-b border-slate-800/60 pb-2">
            <User className="w-4 h-4 text-sky-400" />
            <h3 className="font-heading font-semibold text-white uppercase text-xs tracking-wider">i. Player Information</h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Name */}
            <div>
              <label className="block text-xs font-mono text-slate-400 uppercase tracking-widest mb-1.5 font-bold">
                In-Game Name <span className="text-rose-500 font-extrabold text-sm font-sans">*</span>
              </label>
              <div className="relative">
                <User className="absolute left-3.5 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  id="form-ign"
                  type="text"
                  placeholder="e.g. FrostBite_7"
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-sky-500 rounded-xl py-3 pl-10 pr-4 text-sm text-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 transition-all font-sans"
                />
              </div>
            </div>

            {/* User ID */}
            <div>
              <label className="block text-xs font-mono text-slate-400 uppercase tracking-widest mb-1.5 font-bold">
                User ID <span className="text-rose-500 font-extrabold text-sm font-sans">*</span>
              </label>
              <div className="relative">
                <Hash className="absolute left-3.5 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  id="form-id"
                  type="text"
                  placeholder="e.g. 12345"
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-sky-500 rounded-xl py-3 pl-10 pr-4 text-sm text-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 transition-all font-sans"
                />
              </div>
            </div>

            {/* Contact Info (Email & Discord Username) */}
            <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className="block text-xs font-mono text-slate-400 uppercase tracking-widest mb-1.5 font-bold">
                  Email Address <span className="text-slate-500 font-normal lowercase italic pl-1">(optional)</span>
                </label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    id="form-email"
                    type="email"
                    placeholder="commander@gmail.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 focus:border-sky-500 rounded-xl py-3 pl-10 pr-4 text-sm text-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 transition-all font-sans"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-mono text-slate-400 uppercase tracking-widest mb-1.5 font-bold">
                  Discord Username <span className="text-slate-500 font-normal lowercase italic pl-1">(optional)</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 transform -translate-y-1/2 text-xs font-mono font-bold text-slate-500">@</span>
                  <input
                    id="form-discord"
                    type="text"
                    placeholder="e.g. i_am_dead_for_sure"
                    value={discordUsername}
                    onChange={(e) => setDiscordUsername(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 focus:border-sky-500 rounded-xl py-3 pl-10 pr-4 text-sm text-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 transition-all font-sans"
                  />
                </div>
              </div>

              <div className="md:col-span-2">
                <p className="text-[10.5px] text-slate-400 leading-relaxed font-sans font-medium">
                  🔒 Providing email and/or Discord username is <b>optional</b>. If supplied, they will be used by our automated notification bot to keep you instantly posted on slot overrides or scheduling confirmations directly.
                </p>
                <p className="text-[10px] text-amber-500/90 leading-relaxed font-sans font-semibold mt-1">
                  ⚠️ Discord reminders: Please ensure you enable <b>"Allow direct messages from server members"</b> in your Discord privacy settings so our notification bot can send you private reminder DMs.
                </p>
              </div>
            </div>

            {/* Alliance Selection */}
            <div className="md:col-span-2">
              <label className="block text-xs font-mono text-slate-400 uppercase tracking-widest mb-1.5 font-bold">
                Alliance Affiliation <span className="text-rose-500 font-extrabold text-sm font-sans">*</span>
              </label>
              <div className="relative mb-3">
                <Shield className="absolute left-3.5 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-500" />
                <select
                  id="form-alliance"
                  value={selectedAllianceId}
                  onChange={(e) => setSelectedAllianceId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-sky-500 rounded-xl py-3 pl-10 pr-4 text-sm text-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 transition-all appearance-none cursor-pointer"
                >
                  <option value="" className="bg-slate-950">Select Alliance...</option>
                  {alliances.map((alliance) => (
                    <option key={alliance.id} value={alliance.id} className="bg-slate-950">
                      {alliance.name} ({alliance.tag})
                    </option>
                  ))}
                </select>
              </div>

              {/* Alliance Row indicators requested in Prompt */}
              <div className="flex flex-wrap gap-3.5 mt-2.5 p-3 rounded-lg bg-slate-950/40 border border-slate-900">
                <span className="text-[10px] font-mono text-slate-400 uppercase tracking-widest font-bold self-center">Alliance tags:</span>
                {alliances.map((all) => (
                  <button
                    key={all.id}
                    type="button"
                    onClick={() => setSelectedAllianceId(all.id)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono border transition-all ${
                      selectedAllianceId === all.id
                        ? 'border-sky-400 bg-sky-950/30 text-white'
                        : 'border-slate-800 bg-slate-950/20 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: all.color }} />
                    {all.tag}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Section 2: Event Selection */}
        <div>
          <div className="flex items-center gap-2 mb-4 border-b border-slate-800/60 pb-2">
            <Calendar className="w-4 h-4 text-sky-400" />
            <h3 className="font-heading font-semibold text-white uppercase text-xs tracking-wider">ii. Event Selection</h3>
          </div>

          <div>
            <label className="block text-xs font-mono text-slate-400 uppercase tracking-widest mb-1.5 font-bold">Event Type</label>
            <select
              id="form-event-type"
              value={eventType}
              onChange={(e) => setEventType(e.target.value as EventType)}
              className="w-full bg-slate-950 border border-slate-800 focus:border-sky-500 rounded-xl py-3 px-4 text-sm text-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 transition-all appearance-none cursor-pointer"
            >
              <option value="monday" className="bg-slate-950">Monday (Construction Day)</option>
              <option value="tuesday" className="bg-slate-950">Tuesday (Research Day)</option>
              <option value="thursday" className="bg-slate-950">Thursday (Training Day)</option>
            </select>
          </div>
        </div>

        {/* Section 3: Priority Weighting */}
        <div>
          <div className="flex items-center gap-2 mb-4 border-b border-slate-800/60 pb-2">
            <Zap className="w-4 h-4 text-sky-400" />
            <h3 className="font-heading font-semibold text-white uppercase text-xs tracking-wider">iii. Priority Weighting</h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
            {/* Speedup inputs */}
            <div className="flex flex-col gap-4">
              <div>
                <label className="block text-xs font-mono text-slate-400 uppercase tracking-widest mb-1.5 font-bold">Speedup Days</label>
                <input
                  id="form-speedup-days"
                  type="number"
                  min="0"
                  max="365"
                  placeholder="0"
                  value={speedupDays === 0 ? '' : speedupDays}
                  onChange={(e) => setSpeedupDays(parseInt(e.target.value, 10) || 0)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-sky-500 rounded-xl py-3 px-4 text-sm text-white focus:outline-none font-sans"
                />
              </div>

              <div>
                <label className="block text-xs font-mono text-slate-400 uppercase tracking-widest mb-1.5 font-bold">Speedup Hours</label>
                <input
                  id="form-speedup-hours"
                  type="number"
                  min="0"
                  max="23"
                  placeholder="0"
                  value={speedupHours === 0 ? '' : speedupHours}
                  onChange={(e) => setSpeedupHours(parseInt(e.target.value, 10) || 0)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-sky-500 rounded-xl py-3 px-4 text-sm text-white focus:outline-none font-sans"
                />
              </div>
            </div>

            {/* Custom Priority weight calculated showcase */}
            <div className="h-full p-6 rounded-2xl bg-gradient-to-br from-slate-950 to-indigo-950/20 border border-cyan-500/20 flex flex-col justify-between items-center text-center relative overflow-hidden">
              <div className="absolute top-0 right-0 w-20 h-20 bg-cyan-400/5 rounded-full blur-[20px]" />
              
              <div className="text-xs font-mono text-slate-400 uppercase tracking-widest mb-2 font-bold">
                Priority Score Weight
              </div>

              <div className="my-auto py-2">
                <span className="text-xs text-slate-500 font-mono block">TOTAL MINUTES</span>
                <span className="text-4xl md:text-5xl font-heading font-black text-cyan-400 text-glow-accent tracking-tight">
                  {totalScore.toLocaleString()}
                </span>
              </div>

              <div className="mt-4 px-4 py-1.5 rounded-md border border-cyan-500/35 bg-cyan-950/30 text-[10px] font-mono text-cyan-300 font-black uppercase tracking-widest shadow-[0_0_12px_rgba(6,182,212,0.15)] glow-cyan">
                Priority Minutes Active
              </div>
            </div>
          </div>
        </div>

        {/* Section 4: Slot Allocation */}
        <div>
          <div className="flex items-center gap-2 mb-4 border-b border-slate-800/60 pb-2">
            <Crown className="w-4 h-4 text-sky-400" />
            <h3 className="font-heading font-semibold text-white uppercase text-xs tracking-wider">iv. Slot Allocation</h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            {/* Primary Slot */}
            <div>
              <label className="block text-[11px] font-mono text-slate-400 uppercase tracking-wider mb-1 font-bold">Primary Slot</label>
              <select
                id="form-primary-slot"
                value={primarySlot}
                onChange={(e) => setPrimarySlot(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg py-2.5 px-3 text-xs text-white focus:outline-none focus:ring-1 focus:ring-sky-500 font-mono"
              >
                {timeIntervals.map((t) => (
                  <option key={`p-${t}`} value={t}>{t}</option>
                ))}
              </select>
            </div>

            {/* Backup Slot 1 */}
            <div>
              <label className="block text-[11px] font-mono text-slate-400 uppercase tracking-wider mb-1 font-bold">Backup Slot 1</label>
              <select
                id="form-backup-1"
                value={backupSlot1}
                onChange={(e) => setBackupSlot1(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg py-2.5 px-3 text-xs text-white focus:outline-none focus:ring-1 focus:ring-sky-500 font-mono"
              >
                {timeIntervals.map((t) => (
                  <option key={`b1-${t}`} value={t}>{t}</option>
                ))}
              </select>
            </div>

            {/* Backup Slot 2 */}
            <div>
              <label className="block text-[11px] font-mono text-slate-400 uppercase tracking-wider mb-1 font-bold">Backup Slot 2</label>
              <select
                id="form-backup-2"
                value={backupSlot2}
                onChange={(e) => setBackupSlot2(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg py-2.5 px-3 text-xs text-white focus:outline-none focus:ring-1 focus:ring-sky-500 font-mono"
              >
                {timeIntervals.map((t) => (
                  <option key={`b2-${t}`} value={t}>{t}</option>
                ))}
              </select>
            </div>

            {/* Backup Slot 3 */}
            <div>
              <label className="block text-[11px] font-mono text-slate-400 uppercase tracking-wider mb-1 font-bold">Backup Slot 3</label>
              <select
                id="form-backup-3"
                value={backupSlot3}
                onChange={(e) => setBackupSlot3(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg py-2.5 px-3 text-xs text-white focus:outline-none focus:ring-1 focus:ring-sky-500 font-mono"
              >
                {timeIntervals.map((t) => (
                  <option key={`b3-${t}`} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Auto-assign Checkbox */}
          <div className="flex items-start gap-3 p-4 rounded-xl bg-slate-950/40 border border-slate-900 mt-2">
            <input
              id="form-auto-assign"
              type="checkbox"
              checked={autoAssign}
              onChange={(e) => setAutoAssign(e.target.checked)}
              className="mt-1 w-4 h-4 bg-slate-950 border border-slate-805 text-sky-500 rounded focus:ring-0 focus:outline-none cursor-pointer"
            />
            <div>
              <label htmlFor="form-auto-assign" className="block text-xs font-bold text-slate-200 cursor-pointer">
                Enable "Auto-assign" if selected slots are unavailable
              </label>
              <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                If both physical primary slot and all backup vectors are securely occupied by users with superior credentials, the engine will safely position you in the closest available time segment to prevent reservation exclusion.
              </p>
            </div>
          </div>
        </div>

        {/* Submit */}
        <button
          id="form-submit-btn"
          type="submit"
          className="w-full mt-3 flex items-center justify-center gap-2.5 py-4 rounded-xl font-heading font-semibold text-white royal-gradient-btn active:scale-95 transition-all shadow-lg shadow-blue-500/10 cursor-pointer"
        >
          <Crown className="w-5 h-5" />
          BOOK NOW
          <Lock className="w-4 h-4 opacity-75" />
        </button>

      </form>
    </div>
  );
}
