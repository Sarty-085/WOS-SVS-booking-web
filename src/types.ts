export interface Alliance {
  id: string;
  name: string;
  tag: string;
  color: string; // e.g., 'pink' | 'purple' | 'orange' | 'blue' | 'green'
}

export type EventType = 'monday' | 'tuesday' | 'thursday';

export interface Booking {
  id: string;
  playerName: string;
  userId: string;
  email: string;
  discordUsername?: string;
  allianceId: string; // references Alliance
  eventType: EventType;
  speedupDays: number;
  speedupHours: number;
  score: number; // Priority score calculated as total minutes
  slotId: string; // Target slot e.g. "09:30"
  backupSlots: string[]; // Backup slots
  autoAssign: boolean;
  timestamp: string;
  week?: string;
}

export type SlotStatus = 'available' | 'booked' | 'locked';

export interface Slot {
  id: string; // e.g. "08:00", "23:30"
  time: string;
  status: SlotStatus;
  bookingId?: string; // References Booking if status is booked
  isRecent?: boolean; // Highlight recently altered slots
}

export interface AuditLog {
  id: string;
  operator: string;
  action: 'create_booking' | 'delete_booking' | 'edit_booking' | 'create_alliance' | 'edit_alliance' | 'delete_alliance' | 'slot_lock' | 'slot_unlock';
  details: string;
  timestamp: string;
}

export interface AdminSession {
  isAuthenticated: boolean;
  username: string;
}
