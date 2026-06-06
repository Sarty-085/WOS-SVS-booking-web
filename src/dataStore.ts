import { Alliance, Booking, Slot, AuditLog, EventType } from './types';

export const INITIAL_ALLIANCES: Alliance[] = [
  { id: 'all-1', name: 'Bastion Throne', tag: 'BTN', color: '#ec4899' }, // pink
  { id: 'all-2', name: 'Shadow Spies', tag: 'SPY', color: '#a855f7' }, // purple
  { id: 'all-3', name: 'Dominion Coalition', tag: 'DNC', color: '#f97316' }, // orange
  { id: 'all-4', name: 'Blizzard Vanguard', tag: 'BAZ', color: '#3b82f6' }, // blue
  { id: 'all-5', name: 'Frozen Fellowship', tag: 'FzF', color: '#22c55e' }, // green
  { id: 'all-6', name: 'Royal Scepter', tag: 'ROYAL', color: '#06b6d4' } // cyan
];

// Generate 48 slots (30 min intervals starting from 00:00 to 23:30)
export function generateEmptySlots(): Slot[] {
  const slots: Slot[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 30) {
      const hh = h.toString().padStart(2, '0');
      const mm = m.toString().padStart(2, '0');
      const timeStr = `${hh}:${mm}`;
      slots.push({
        id: timeStr,
        time: timeStr,
        status: 'available'
      });
    }
  }
  return slots;
}

// Initial default bookings
export const INITIAL_BOOKINGS: Booking[] = [];

export const INITIAL_AUDIT_LOGS: AuditLog[] = [];

// Helper to construct slots status map for a given day based on bookings
export function loadDailySlots(eventType: EventType, bookings: Booking[]): Slot[] {
  const baseSlots = generateEmptySlots();
  
  // High-priority system locked slots (e.g., midnight maintenance, and active hours blocks)
  // Let's locks slots like 02:00-04:00 for system calibration & server restarts
  const lockedTimes = ['02:00', '02:30', '03:00', '03:30', '04:00'];
  
  baseSlots.forEach(slot => {
    if (lockedTimes.includes(slot.time)) {
      slot.status = 'locked';
    }
  });

  // Filter bookings for this day
  const dayBookings = bookings.filter(b => b.eventType === eventType);

  // Group bookings by slot. If multiple bookings land on the same slot, the one with the HIGHEST priority score gets it!
  // This behaves exactly like Sarthak displacing Alex. Let's simulate that logic:
  const appointments: { [slotId: string]: Booking[] } = {};
  dayBookings.forEach(booking => {
    const slotKey = booking.slotId;
    if (!appointments[slotKey]) {
      appointments[slotKey] = [];
    }
    appointments[slotKey].push(booking);
  });

  const activeAllottedBookingIds: string[] = [];

  // Sort and allot
  const sortedSlots = Object.keys(appointments).sort();
  sortedSlots.forEach(slotKey => {
    const candidates = appointments[slotKey].sort((a, b) => b.score - a.score);
    const winner = candidates[0]; // Winner takes the slot
    
    // Assign winner to primary slot
    const slot = baseSlots.find(s => s.id === slotKey);
    if (slot && slot.status === 'available') {
      slot.status = 'booked';
      slot.bookingId = winner.id;
      activeAllottedBookingIds.push(winner.id);
    }

    // Displaced candidates go to backups or auto-assign!
    for (let i = 1; i < candidates.length; i++) {
      const displaced = candidates[i];
      let resolved = false;

      // Try their designated backup slots in order
      for (const backupSlotId of displaced.backupSlots) {
        const bSlot = baseSlots.find(s => s.id === backupSlotId);
        if (bSlot && bSlot.status === 'available') {
          bSlot.status = 'booked';
          bSlot.bookingId = displaced.id;
          displaced.slotId = backupSlotId; // Dynamically updated for local view representation
          activeAllottedBookingIds.push(displaced.id);
          resolved = true;
          break;
        }
      }

      // If backups fail but auto-assign is on, find first available slot
      if (!resolved && displaced.autoAssign) {
        const firstAvailable = baseSlots.find(s => s.status === 'available' && s.id >= '08:00'); // Preferable standard daytime
        if (firstAvailable) {
          firstAvailable.status = 'booked';
          firstAvailable.bookingId = displaced.id;
          displaced.slotId = firstAvailable.id;
          activeAllottedBookingIds.push(displaced.id);
          resolved = true;
        }
      }
    }
  });

  // Apply other bookings that don't have competition
  dayBookings.forEach(booking => {
    if (!activeAllottedBookingIds.includes(booking.id)) {
      const targetSlot = baseSlots.find(s => s.id === booking.slotId);
      if (targetSlot && targetSlot.status === 'available') {
        targetSlot.status = 'booked';
        targetSlot.bookingId = booking.id;
        activeAllottedBookingIds.push(booking.id);
      } else {
        // Find backup slot
        let resolved = false;
        for (const backupId of booking.backupSlots) {
          const bSlot = baseSlots.find(s => s.id === backupId);
          if (bSlot && bSlot.status === 'available') {
            bSlot.status = 'booked';
            bSlot.bookingId = booking.id;
            booking.slotId = backupId;
            activeAllottedBookingIds.push(booking.id);
            resolved = true;
            break;
          }
        }
        
        // Find anywhere if autoAssign is true
        if (!resolved && booking.autoAssign) {
          const firstAvailable = baseSlots.find(s => s.status === 'available');
          if (firstAvailable) {
            firstAvailable.status = 'booked';
            firstAvailable.bookingId = booking.id;
            booking.slotId = firstAvailable.id;
            activeAllottedBookingIds.push(booking.id);
          }
        }
      }
    }
  });

  return baseSlots;
}
