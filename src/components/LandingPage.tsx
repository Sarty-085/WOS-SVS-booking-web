import React, { useState } from 'react';
import { ArrowRight, Calendar, Info, Clock, Play, HelpCircle, ChevronRight, Sparkles, Star, ShieldAlert, MapPin, Plus } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { StateEntity } from '../types';

interface LandingPageProps {
  onNavigate: (page: string) => void;
  onBookDay: (day: 'monday' | 'tuesday' | 'thursday') => void;
  states: StateEntity[];
  selectedState: StateEntity | null;
  onSelectState: (state: StateEntity) => void;
  onAddState: (stateNumber: string) => Promise<void>;
}

export default function LandingPage({ 
  onNavigate, 
  onBookDay,
  states = [],
  selectedState = null,
  onSelectState,
  onAddState
}: LandingPageProps) {
  const [activeFaq, setActiveFaq] = useState<number | null>(null);
  
  // Local form for adding a new state
  const [newStateNum, setNewStateNum] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);

  const faqs = [
    {
      question: "How is priority score calculated?",
      answer: "The priority score is calculated in minutes based on speedup contributions. System Formula: Score = (Speedup Days × 24 × 60) + (Speedup Hours × 60). Higher score claimants always take historical precedence on contested slots."
    },
    {
      question: "What happens if I am displaced?",
      answer: "When a player with a higher Priority Score claims a slot, the dynamic displacement engine shifts you automatically to your designated Backup Slot 1, 2, or 3. If backups are occupied or you selected 'Auto-assign', you will be assigned to the closest open state slot."
    },
    {
      question: "Can I edit or cancel my slots?",
      answer: "Yes. Within the Prep Booking Schedule portal, operators or verified system administrators have clearance codes to rearrange, rename, delete, or override booking slots to preserve state cohesion."
    }
  ];

  if (!selectedState) {
    return (
      <div className="w-full min-h-screen flex items-center justify-center px-4 relative bg-[#020617]">
        {/* Decorative glows */}
        <div className="absolute top-1/4 left-1/4 w-[400px] h-[400px] bg-cyan-500/10 rounded-full blur-[100px] pointer-events-none" />
        <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-indigo-500/10 rounded-full blur-[100px] pointer-events-none" />

        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md glass-panel-heavy p-8 rounded-3xl border border-slate-800 text-center shadow-[0_0_50px_rgba(6,182,212,0.06)] relative z-10 text-slate-200"
        >
          <div className="w-16 h-16 rounded-2xl bg-cyan-950/80 border border-cyan-500/30 flex items-center justify-center text-cyan-400 mx-auto mb-6 shadow-[0_0_20px_rgba(6,182,212,0.15)]">
            <MapPin className="w-8 h-8" />
          </div>

          <h2 className="font-heading font-black text-2xl text-white tracking-tight mb-2">Select Your State</h2>
          <p className="text-sm text-slate-400 leading-relaxed mb-6">
            Welcome to the Multi-State Esports Scheduler. Enter your server partition or choose from active kingdoms below.
          </p>

          {/* Active States Selection Group */}
          <div className="space-y-2.5 max-h-[160px] overflow-y-auto mb-6 pr-1 text-left">
            <span className="text-[10px] font-mono text-slate-500 font-bold tracking-wider block uppercase">ACTIVE KINGDOMS</span>
            {states.map((st) => (
              <button
                key={st.id}
                onClick={() => onSelectState(st)}
                className="w-full p-3 rounded-xl border border-slate-800/80 bg-slate-900/20 hover:bg-slate-900/60 text-slate-250 hover:text-white flex items-center justify-between transition-all group hover:border-cyan-500/30 font-semibold text-sm cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-cyan-500 group-hover:animate-bounce" />
                  <span>State {st.state_number}</span>
                </div>
                <span className="text-[10px] font-mono text-slate-500 group-hover:text-cyan-400">CONNECT &rarr;</span>
              </button>
            ))}
            {states.length === 0 && (
              <div className="p-4 text-center text-xs italic text-slate-500 border border-dashed border-slate-800 rounded-xl">
                No active state partitions found. Initiate a new one below!
              </div>
            )}
          </div>

          {/* Fast On-The-Fly State Initialization */}
          <div className="border-t border-slate-900 pt-5">
            <span className="text-[10px] font-mono text-slate-500 font-bold tracking-wider block uppercase text-left mb-2.5">REGISTER NEW STATE SERVER</span>
            <form 
              onSubmit={async (e) => {
                e.preventDefault();
                const trimmed = newStateNum.trim();
                if (!trimmed) return;
                setIsRegistering(true);
                try {
                  await onAddState(trimmed);
                  setNewStateNum('');
                } catch (e) {}
                setIsRegistering(false);
              }}
              className="flex items-center gap-2"
            >
              <div className="relative flex-1">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[10px] font-mono font-bold text-slate-500">STATE</span>
                <input
                  type="number"
                  placeholder="E.g. 1127"
                  value={newStateNum}
                  onChange={(e) => setNewStateNum(e.target.value)}
                  className="w-full bg-[#050c18] border border-slate-800 focus:border-cyan-500/60 rounded-xl pl-16 pr-3 py-2 text-xs text-white outline-none transition-colors"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={isRegistering}
                className="px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition-all shadow-[0_0_15px_rgba(6,182,212,0.15)] flex items-center justify-center cursor-pointer shrink-0"
              >
                <Plus className="w-4 h-4" />
              </button>
            </form>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="w-full min-h-screen">
      {/* Hero Section */}
      <section className="relative pt-16 pb-24 md:py-32 px-4 max-w-7xl mx-auto">
        {/* Subtle decorative radial grid glows */}
        <div className="absolute -top-10 left-1/4 w-[350px] md:w-[600px] h-[350px] md:h-[600px] bg-sky-500/10 rounded-full blur-[100px] pointer-events-none" />
        <div className="absolute top-1/2 right-10 w-[250px] md:w-[450px] h-[250px] md:h-[450px] bg-indigo-500/5 rounded-full blur-[120px] pointer-events-none" />

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
           {/* Hero Left Column */}
          <div className="lg:col-span-7 flex flex-col items-start text-left z-10">
            {selectedState && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="inline-flex items-center gap-2.5 px-3.5 py-1.5 rounded-full border border-cyan-500/30 bg-cyan-950/30 text-cyan-400 font-mono text-[11px] font-bold tracking-wide mb-6"
              >
                <MapPin className="w-3.5 h-3.5" />
                <span>CONNECTED: STATE {selectedState.state_number}</span>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <button 
                  onClick={() => {
                    if (confirm(`Disconnect and swap State ${selectedState.state_number} for another State server partition?`)) {
                      localStorage.removeItem('royal_slots_selected_state');
                      window.location.reload();
                    }
                  }}
                  className="hover:underline text-slate-450 hover:text-white ml-2 cursor-pointer font-bold"
                >
                  (CHANGE)
                </button>
              </motion.div>
            )}

            <motion.h1 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.1 }}
              className="font-heading text-4xl sm:text-5xl md:text-6xl font-black text-white leading-tight tracking-tight mb-6"
            >
              Mark Your Spot and <br />
              <span className="text-silver-cyan">
                Dominate The Leaderboard!
              </span>
            </motion.h1>

            <motion.p 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.2 }}
              className="text-slate-300 text-lg md:text-xl leading-relaxed mb-8 max-w-xl"
            >
              Dominate the leaderboard and secure your reign. Our high-precision scheduling engine ensures that priority always takes its rightful place at the throne.
            </motion.p>

            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.3 }}
              className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto"
            >
              <button 
                id="hero-book-now"
                onClick={() => onNavigate('Reservations')}
                className="flex items-center justify-center gap-2 px-8 py-4 rounded-xl font-heading font-medium text-white royal-gradient-btn active:scale-95 transition-all shadow-lg shadow-sky-500/10 hover:shadow-sky-500/25 cursor-pointer"
              >
                Book Your Slot
                <ArrowRight className="w-5 h-5" />
              </button>
              
              <button 
                id="hero-view-schedule"
                onClick={() => onNavigate('Schedule')}
                className="flex items-center justify-center gap-2 px-8 py-4 rounded-xl font-heading font-medium text-slate-300 border border-slate-700/80 hover:border-cyan-500/40 hover:text-white bg-slate-900/30 hover:bg-slate-900/60 active:scale-95 transition-all cursor-pointer"
              >
                <Calendar className="w-5 h-5 text-sky-400" />
                View Schedule
              </button>
            </motion.div>
          </div>

          {/* Hero Right Column - Engine Visualizer */}
          <div className="lg:col-span-5 w-full z-10">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.8, delay: 0.2 }}
              className="glass-panel-heavy p-6 md:p-8 rounded-2xl relative overflow-hidden"
            >
              {/* Grid backdrop */}
              <div className="absolute inset-0 bg-cover bg-center opacity-10 pointer-events-none" style={{ backgroundImage: `radial-gradient(ellipse at center, rgba(56, 189, 248, 0.15) 0%, transparent 80%)` }} />
              
              <div className="flex items-center justify-between border-b border-slate-800/80 pb-4 mb-6">
                <div>
                  <h3 className="font-heading font-semibold text-lg text-white">Engine Visualizer</h3>
                  <p className="text-xs text-slate-400 font-mono">DISPLACEMENT SIMULATOR</p>
                </div>
                <div className="flex items-center gap-2 bg-emerald-950/60 border border-emerald-500/30 px-3 py-1 rounded-full">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                  <span className="text-[10px] font-mono font-bold text-emerald-400 tracking-wider">LIVE SIMULATION</span>
                </div>
              </div>

              {/* Slot Cards Cascade */}
              <div className="flex flex-col gap-4 relative">
                {/* Slot 1 */}
                <div className="glass-panel p-4 rounded-xl flex items-center justify-between border border-cyan-500/30 bg-cyan-950/20 shadow-cyan shadow-[inset_0_0_10px_rgba(6,182,212,0.1)]">
                  <div>
                    <span className="text-xs font-mono text-cyan-400 block font-bold">Slot 09:00</span>
                    <span className="text-base font-bold text-white tracking-wide">Dead</span>
                    <span className="text-xs text-slate-400 font-mono block">85d Priority Score</span>
                  </div>
                  <div className="w-10 h-10 rounded-full bg-cyan-950/60 border border-cyan-500/40 flex items-center justify-center">
                    <Star className="w-4 h-4 text-cyan-300 fill-cyan-400" />
                  </div>
                </div>

                {/* Arrow Connector */}
                <div className="flex justify-center -my-2 z-10">
                  <div className="w-8 h-8 rounded-full bg-slate-900 border border-slate-700 flex items-center justify-center shadow-lg">
                    <ArrowRight className="w-4 h-4 text-sky-400 transform rotate-90" />
                  </div>
                </div>

                {/* Slot 2 Booking (Alex - Reassigned) */}
                <div className="glass-panel p-4 rounded-xl flex items-center justify-between opacity-55 border-dashed border-slate-700 bg-slate-950/40">
                  <div>
                    <span className="text-xs font-mono text-slate-400 block font-bold">Slot 09:30</span>
                    <span className="text-base font-bold text-slate-300 tracking-wide">Alex</span>
                    <span className="text-xs text-slate-400 font-mono block">70d Priority Score</span>
                  </div>
                  <div>
                    <span className="text-xs italic text-amber-400/80 font-medium px-2.5 py-1 rounded-md bg-amber-950/30 border border-amber-500/20 uppercase tracking-widest">Reassigned</span>
                  </div>
                </div>

                {/* Message Banner */}
                <motion.div 
                  initial={{ x: 20, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  transition={{ delay: 0.5, type: 'spring' }}
                  className="mt-2 bg-sky-950/65 border border-sky-500/40 p-3 rounded-lg flex items-start gap-2.5 shadow-md shadow-sky-950/40"
                >
                  <Info className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-sky-300 text-left font-mono">
                    <span className="text-white font-bold">Chain displacement:</span> Dead displaced Alex via priority lead.
                  </p>
                </motion.div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Upcoming Event Windows */}
      <section className="py-20 px-4 max-w-7xl mx-auto border-t border-slate-900 bg-slate-950/20">
        <div className="text-center mb-16">
          <h2 className="font-heading text-3xl md:text-4xl font-extrabold text-white mb-4">
            State Event Windows
          </h2>
          <p className="text-slate-400 max-w-lg mx-auto">
            Schedule priority blocks corresponding to targeted state versus state activities. Keep your command updated.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Mon Card */}
          <motion.div 
            whileHover={{ y: -8 }}
            className="glass-panel rounded-2xl overflow-hidden flex flex-col justify-between border-sky-950"
          >
            {/* Schematic Illustration placeholder / decorative header */}
            <div className="h-32 bg-slate-950 relative flex items-center justify-center border-b border-slate-900 overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-b from-sky-950/20 to-slate-950" />
              {/* Construction-like wireframe */}
              <div className="w-20 h-20 border-2 border-sky-500/20 border-t-sky-500/70 rounded-md rotate-45 flex items-center justify-center animate-[spin_10s_linear_infinite]">
                <div className="w-12 h-12 border border-sky-400/30 rounded-md flex items-center justify-center">
                  <div className="w-6 h-6 border-2 border-dashed border-sky-300/40 rounded-full" />
                </div>
              </div>
              <span className="absolute bottom-2 right-3 text-[10px] font-mono text-sky-400 bg-sky-950/80 px-2 py-0.5 rounded border border-sky-400/20 font-bold">0x09F4</span>
            </div>

            <div className="p-6 flex-grow flex flex-col items-start text-left">
              <span className="text-xs font-mono font-bold text-sky-400 bg-sky-950/60 px-2.5 py-1 rounded-full border border-sky-500/20 tracking-wider mb-3">MONDAY</span>
              <h3 className="font-heading font-semibold text-xl text-white mb-2">Construction Day</h3>
              <p className="text-slate-300 text-sm leading-relaxed mb-6 flex-grow">
                Claim state infrastructure cells, activate structural boosts, and construct strategic defensive bastions.
              </p>
              <button 
                onClick={() => onBookDay('monday')}
                className="w-full text-center py-2.5 rounded-lg border border-sky-500/30 text-sky-400 hover:text-white hover:bg-sky-500/10 active:scale-98 transition-all font-heading font-medium text-sm"
              >
                Book Monday
              </button>
            </div>
          </motion.div>

          {/* Tue Card */}
          <motion.div 
            whileHover={{ y: -8 }}
            className="glass-panel rounded-2xl overflow-hidden flex flex-col justify-between border-purple-950"
          >
            {/* Research Day Illustration */}
            <div className="h-32 bg-slate-950 relative flex items-center justify-center border-b border-slate-900 overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-b from-purple-950/20 to-slate-950" />
              {/* Chip motherboard effect */}
              <div className="relative w-16 h-16 bg-purple-950/40 border border-purple-500/30 rounded flex items-center justify-center">
                <div className="w-8 h-8 rounded-full border-2 border-purple-400/60 flex items-center justify-center">
                  <div className="w-3 h-3 bg-purple-400 rounded-sm animate-pulse" />
                </div>
                <span className="absolute -top-3 left-4 w-0.5 h-3 bg-purple-500/30" />
                <span className="absolute -bottom-3 left-12 w-0.5 h-3 bg-purple-500/30" />
                <span className="absolute top-4 -left-3 w-3 h-0.5 bg-purple-500/30" />
                <span className="absolute top-12 -right-3 w-3 h-0.5 bg-purple-500/30" />
              </div>
              <span className="absolute bottom-2 right-3 text-[10px] font-mono text-purple-400 bg-purple-950/80 px-2 py-0.5 rounded border border-purple-400/20 font-bold">0xAE40</span>
            </div>

            <div className="p-6 flex-grow flex flex-col items-start text-left">
              <span className="text-xs font-mono font-bold text-purple-400 bg-purple-950/60 px-2.5 py-1 rounded-full border border-purple-500/20 tracking-wider mb-3">TUESDAY</span>
              <h3 className="font-heading font-semibold text-xl text-white mb-2">Research Day</h3>
              <p className="text-slate-300 text-sm leading-relaxed mb-6 flex-grow">
                Accelerate core technology trees. Apply massive intelligence bonuses to gain operational superiority over rival states.
              </p>
              <button 
                onClick={() => onBookDay('tuesday')}
                className="w-full text-center py-2.5 rounded-lg border border-purple-500/30 text-purple-400 hover:text-white hover:bg-purple-500/10 active:scale-98 transition-all font-heading font-medium text-sm"
              >
                Book Tuesday
              </button>
            </div>
          </motion.div>

          {/* Thu Card */}
          <motion.div 
            whileHover={{ y: -8 }}
            className="glass-panel rounded-2xl overflow-hidden flex flex-col justify-between border-emerald-950"
          >
            {/* Esports Arena illustration */}
            <div className="h-32 bg-slate-950 relative flex items-center justify-center border-b border-slate-900 overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-b from-emerald-950/20 to-slate-950" />
              {/* Battle stadium crosshair */}
              <div className="w-20 h-20 border border-emerald-500/30 rounded-full flex items-center justify-center relative">
                <div className="w-14 h-14 border border-dashed border-emerald-400/45 rounded-full flex items-center justify-center">
                  <div className="w-4 h-4 rounded-full bg-emerald-500/30" />
                </div>
                <div className="absolute w-22 h-0.5 bg-emerald-500/15" />
                <div className="absolute h-22 w-0.5 bg-emerald-500/15" />
              </div>
              <span className="absolute bottom-2 right-3 text-[10px] font-mono text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-400/20 font-bold">0x4D01</span>
            </div>

            <div className="p-6 flex-grow flex flex-col items-start text-left">
              <span className="text-xs font-mono font-bold text-emerald-400 bg-emerald-950/60 px-2.5 py-1 rounded-full border border-emerald-500/20 tracking-wider mb-3">THURSDAY</span>
              <h3 className="font-heading font-semibold text-xl text-white mb-2">Training Day</h3>
              <p className="text-slate-300 text-sm leading-relaxed mb-6 flex-grow">
                Mobilize infantry brigades, coordinate strategic combat simulation exercises, and unlock custom esports armaments.
              </p>
              <button 
                onClick={() => onBookDay('thursday')}
                className="w-full text-center py-2.5 rounded-lg border border-emerald-500/30 text-emerald-400 hover:text-white hover:bg-emerald-500/10 active:scale-98 transition-all font-heading font-medium text-sm"
              >
                Book Thursday
              </button>
            </div>
          </motion.div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="py-20 px-4 max-w-4xl mx-auto text-left">
        <div className="text-center mb-12">
          <HelpCircle className="w-10 h-10 text-sky-400 mx-auto mb-3" />
          <h2 className="font-heading text-3xl font-extrabold text-white mb-2">FAQ</h2>
          <p className="text-slate-400 text-sm">Everything you need to know about state-level strategic priority scheduling.</p>
        </div>

        <div className="flex flex-col gap-4">
          {faqs.map((faq, idx) => {
            const isOpen = activeFaq === idx;
            return (
              <div 
                key={idx}
                className="glass-panel rounded-xl overflow-hidden border border-slate-800 bg-slate-900/10"
              >
                <button
                  id={`faq-btn-${idx}`}
                  onClick={() => setActiveFaq(isOpen ? null : idx)}
                  className="w-full px-6 py-5 flex items-center justify-between text-left hover:bg-sky-950/15 transition-all focus:outline-none"
                >
                  <span className="font-heading font-medium text-white text-base md:text-lg">
                    {faq.question}
                  </span>
                  <ChevronRight 
                    className={`w-5 h-5 text-sky-400 transform transition-transform duration-300 ${isOpen ? 'rotate-90' : ''}`} 
                  />
                </button>
                
                <AnimatePresence>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.25 }}
                    >
                      <div className="px-6 pb-5 text-sm text-slate-300 leading-relaxed border-t border-slate-900 pt-3">
                        {faq.answer}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
