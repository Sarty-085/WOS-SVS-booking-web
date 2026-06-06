import React, { useState } from 'react';
import { ArrowRight, Calendar, Info, Clock, Play, HelpCircle, ChevronRight, Sparkles, Star, ShieldAlert } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface LandingPageProps {
  onNavigate: (page: string) => void;
  onBookDay: (day: 'monday' | 'tuesday' | 'thursday') => void;
}

export default function LandingPage({ onNavigate, onBookDay }: LandingPageProps) {
  const [activeFaq, setActiveFaq] = useState<number | null>(null);

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
      answer: "Yes. Within the Royal Schedule portal, operators or verified system administrators have clearance codes to rearrange, rename, delete, or override booking slots to preserve state cohesion."
    }
  ];

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
            <motion.h1 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.1 }}
              className="font-heading text-4xl sm:text-5xl md:text-6xl font-black text-white leading-tight tracking-tight mb-6"
            >
              Your Aid To <br />
              <span className="text-silver-cyan">
                The Supreme Presidency
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
