import {
  ClipboardList, FilePen, Pill, BedDouble, Hospital, Search, CircleCheck, CalendarDays, Users, TriangleAlert,
  Wallet, Package, ChartColumn, Microscope, UserRound, Zap, LayoutDashboard, Inbox, CreditCard, TestTube,
  FileText, RefreshCw, ChartLine, AlarmClock, HeartPulse, Siren, Hourglass, Stethoscope, CircleX, ShieldCheck,
  Droplet, Settings, Ticket, Bell, Ban, Lock, Factory, Undo2, BedSingle, Trash2, Heart, Hammer, Pin, Pencil,
  KeyRound, Megaphone, Tag, Timer, Scale, Ambulance, ShoppingCart, PersonStanding, RotateCw, Link, FlaskConical,
  Monitor, Globe, Files, IdCard, Bug, Clock, Folder, Hand, PartyPopper, Mail,
} from 'lucide-react';

// Emoji used as icons across the app, drawn as one consistent line-icon set
const MAP = {
  '📋': ClipboardList, '📝': FilePen, '💊': Pill, '🛏️': BedDouble, '🛏': BedDouble, '🏥': Hospital, '🔍': Search,
  '🔎': Search, '✅': CircleCheck, '📅': CalendarDays, '🗓️': CalendarDays, '👥': Users, '👨‍👩‍👧‍👦': Users,
  '⚠️': TriangleAlert, '💰': Wallet, '📦': Package, '📊': ChartColumn, '🔬': Microscope, '👤': UserRound,
  '👩‍⚕️': UserRound, '👨‍⚕️': Stethoscope, '⚡': Zap, '🏠': LayoutDashboard, '📥': Inbox, '📭': Inbox, '📬': Inbox,
  '💳': CreditCard, '🧪': TestTube, '📄': FileText, '📑': Files, '🔄': RefreshCw, '↻': RotateCw, '📈': ChartLine,
  '⏰': AlarmClock, '❤️': HeartPulse, '💓': HeartPulse, '💛': Heart, '🚨': Siren, '⏳': Hourglass, '🩺': Stethoscope,
  '❌': CircleX, '🛡️': ShieldCheck, '🩸': Droplet, '⚙️': Settings, '🎫': Ticket, '🔔': Bell, '🚫': Ban,
  '🔐': Lock, '🔒': Lock, '🏭': Factory, '↩️': Undo2, '🛌': BedSingle, '🗑️': Trash2, '🗑': Trash2, '🔨': Hammer,
  '📌': Pin, '✏️': Pencil, '🔑': KeyRound, '📢': Megaphone, '🏷️': Tag, '⏱️': Timer, '⚖️': Scale, '🚑': Ambulance,
  '🛒': ShoppingCart, '🚶': PersonStanding, '🔗': Link, '🧫': FlaskConical, '🖥️': Monitor, '🌐': Globe,
  '🪪': IdCard, '🐛': Bug, '🕐': Clock, '🕒': Clock, '📁': Folder, '👋': Hand, '🎉': PartyPopper, '✉️': Mail,
};

export function hasGlyph(icon) {
  return typeof icon === 'string' && Boolean(MAP[icon.trim()]);
}

export default function Glyph({ icon, size = 18, strokeWidth = 1.9, className = 'glyph', ...rest }) {
  if (typeof icon !== 'string') return icon ?? null;
  const Icon = MAP[icon.trim()];
  if (!Icon) return <span className={className} aria-hidden="true">{icon}</span>;
  return <Icon size={size} strokeWidth={strokeWidth} className={className} aria-hidden="true" {...rest} />;
}
