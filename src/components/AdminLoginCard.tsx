import React, { useState } from 'react';
import { ShieldCheck, User, Lock, Eye, EyeOff, Terminal, KeyRound } from 'lucide-react';
import { motion } from 'motion/react';

interface AdminLoginCardProps {
  onLoginSuccess: (username: string) => void;
  onBypass?: () => void;
}

export default function AdminLoginCard({ onLoginSuccess, onBypass }: AdminLoginCardProps) {
  const [identifier, setIdentifier] = useState('');
  const [clearanceCode, setClearanceCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!identifier.trim()) {
      setErrorMsg('Identifier is required.');
      return;
    }
    if (!clearanceCode) {
      setErrorMsg('Clearance code is required.');
      return;
    }

    setLoading(true);

    // Simulate connection delay for premium terminal vibe
    setTimeout(() => {
      if (identifier.toLowerCase() === 'admin' && clearanceCode === '1337') {
        onLoginSuccess(identifier);
      } else {
        setErrorMsg('SECURE COCKPIT DENIED: Invalid identifier or clearance key.');
      }
      setLoading(false);
    }, 1000);
  };

  return (
    <div className="w-full max-w-md mx-auto px-4 py-12 relative">
      {/* Soft purply-cyan glowing background circles */}
      <div className="absolute -top-12 -left-12 w-64 h-64 bg-cyan-500/10 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute -bottom-12 -right-12 w-64 h-64 bg-purple-500/10 rounded-full blur-[100px] pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="glass-panel-heavy p-6 sm:p-8 rounded-2xl relative border border-cyan-500/30 glow-cyan"
      >
        {/* Terminal Header */}
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-14 h-14 rounded-full bg-slate-950 border border-cyan-500/50 flex items-center justify-center mb-4 shadow-[0_0_15px_rgba(6,182,212,0.3)]">
            <KeyRound className="w-6 h-6 text-cyan-400 animate-pulse" />
          </div>
          
          <h2 className="font-heading text-2xl font-black text-white tracking-wider glow-cyan-active px-3 py-1 bg-cyan-950/25 border border-cyan-500/10 rounded-lg">
            Royal <span className="text-silver-cyan">Slots</span>
          </h2>
          <p className="text-xs text-sky-400 font-mono tracking-widest mt-2 uppercase">
            Management Authority Access
          </p>
        </div>

        {errorMsg && (
          <motion.div 
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-5 p-3 rounded-xl bg-rose-950/60 border border-rose-500/40 text-rose-300 font-mono text-[11px] text-center"
          >
            {errorMsg}
          </motion.div>
        )}

        {/* Form */}
        <form onSubmit={handleLogin} className="flex flex-col gap-5 text-left">
          {/* FIELD 1: IDENTIFIER */}
          <div>
            <label className="block text-[10px] font-mono font-black text-cyan-400 tracking-widest uppercase mb-1.5">
              IDENTIFIER (Admin Username)
            </label>
            <div className="relative">
              <User className="absolute left-3.5 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                id="login-id"
                type="text"
                placeholder="Admin Username"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-xl py-3 pl-10 pr-4 text-sm text-white focus:outline-none font-sans"
              />
            </div>
          </div>

          {/* FIELD 2: CLEARANCE CODE */}
          <div>
            <label className="block text-[10px] font-mono font-black text-cyan-400 tracking-widest uppercase mb-1.5">
              CLEARANCE CODE
            </label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                id="login-code"
                type={showPassword ? 'text' : 'password'}
                placeholder="Clearance Key Code"
                value={clearanceCode}
                onChange={(e) => setClearanceCode(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-xl py-3 pl-10 pr-10 text-sm text-white focus:outline-none font-sans font-mono tracking-widest"
              />
              <button
                type="button"
                id="login-toggle-pw"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3.5 top-1/2 transform -translate-y-1/2 text-slate-500 hover:text-cyan-400 cursor-pointer"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Remember & reset */}
          <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 mt-1">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                id="login-remember"
                type="checkbox"
                defaultChecked
                className="w-3.5 h-3.5 bg-slate-950 border border-slate-800 text-cyan-500 rounded focus:ring-0 focus:outline-none cursor-pointer"
              />
              Remember terminal
            </label>
            
            <button
              type="button"
              id="login-forgot"
              onClick={() => setErrorMsg('SECURITY POLICY: Please contact a system administrator to request a credential reset.')}
              className="hover:text-cyan-300 transition-colors"
            >
              Request Reset
            </button>
          </div>

          {/* ESTABLISH CONNECTION Button */}
          <button
            id="login-submit-btn"
            type="submit"
            disabled={loading}
            className="w-full mt-3 py-3.5 rounded-xl font-heading font-bold text-white royal-gradient-btn active:scale-98 transition-all shadow-md shadow-cyan-500/10 cursor-pointer text-center text-xs tracking-wider"
          >
            {loading ? 'CALIBRATING SECURITY LAYERS...' : 'ESTABLISH CONNECTION'}
          </button>
        </form>
      </motion.div>
    </div>
  );
}
