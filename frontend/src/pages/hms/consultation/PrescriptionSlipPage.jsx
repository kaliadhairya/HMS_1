import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import api from '../../../api/axios';
import { useAuth } from '../../../context/AuthContext';
import Navbar from '../../../components/Navbar';
import './PrescriptionSlip.css';

const emptyItem = () => ({
  medicine_id: null,
  medicine_name: '',
  generic_name: '',
  dose: '1',
  dose_unit: 'Tablet',
  route: 'Oral',
  frequency: '1-0-1',
  duration_days: '5',
  instructions: 'After food',
});

const MEDICINE_TYPE_OPTIONS = [
  { value: 'Tablet',             category: 'Oral' },
  { value: 'Capsule',            category: 'Oral' },
  { value: 'Syrup',              category: 'Oral' },
  { value: 'Suspension',         category: 'Oral' },
  { value: 'Solution',           category: 'Oral' },
  { value: 'Sachet',             category: 'Oral' },
  { value: 'Gargle',             category: 'Oral' },
  { value: 'Injection',          category: 'Injectable' },
  { value: 'Shots',              category: 'Injectable' },
  { value: 'Ointment',           category: 'Topical' },
  { value: 'Cream',              category: 'Topical' },
  { value: 'Gel',                category: 'Topical' },
  { value: 'Lotion',             category: 'Topical' },
  { value: 'Shampoo',            category: 'Topical' },
  { value: 'Patch',              category: 'Topical' },
  { value: 'Drops',              category: 'Drops & Spray' },
  { value: 'Eye Drops',          category: 'Drops & Spray' },
  { value: 'Ear Drops',          category: 'Drops & Spray' },
  { value: 'Nasal Drops',        category: 'Drops & Spray' },
  { value: 'Spray',              category: 'Drops & Spray' },
  { value: 'Inhaler',            category: 'Respiratory' },
  { value: 'Nebulizer Solution', category: 'Respiratory' },
  { value: 'Powder',             category: 'Other' },
  { value: 'Suppository',        category: 'Other' },
];

const MEDICINE_TYPE_VALUES = MEDICINE_TYPE_OPTIONS.map((o) => o.value);

const DAY_PICKER_OPTIONS = Array.from({ length: 30 }, (_, index) => String(index + 1));

const DOSE_OPTIONS = ['1/2', '1', '1.5', '2'];
const CUSTOM_DOSE_VALUE = '__custom_dose__';

const FREQUENCY_OPTIONS = [
  { value: '1-0-0', label: 'Morning only' },
  { value: '0-1-0', label: 'Noon only' },
  { value: '0-0-1', label: 'Night only' },
  { value: '1-0-1', label: 'Morning + Evening' },
  { value: '1-1-1', label: 'Morning + Noon + Night' },
  { value: '1-1-1-1', label: 'Morning + Noon + Evening + Night' },
  { value: 'SOS', label: 'SOS / As needed' },
];
const CUSTOM_FREQUENCY_VALUE = '__custom_frequency__';

const INSTRUCTION_OPTIONS = [
  'After food',
  'Before food',
  'With food',
  'Empty stomach',
  'At bedtime',
  'After breakfast',
  'After lunch',
  'After dinner',
  'Before breakfast',
  'Before lunch',
  'Before dinner',
  'As directed',
];

const CUSTOM_INSTRUCTION_VALUE = '__custom_instruction__';

function getDoseSelectValue(value) {
  const cleanValue = String(value || '').trim();
  if (!cleanValue) return CUSTOM_DOSE_VALUE;
  return DOSE_OPTIONS.includes(cleanValue) ? cleanValue : CUSTOM_DOSE_VALUE;
}

function getFrequencySelectValue(value) {
  const cleanValue = String(value || '').trim();
  if (!cleanValue) return CUSTOM_FREQUENCY_VALUE;
  const matched = FREQUENCY_OPTIONS.find((option) => {
    const optionValue = option.value.toLowerCase();
    const optionLabel = option.label.toLowerCase();
    const currentValue = cleanValue.toLowerCase();
    return optionValue === currentValue || optionLabel === currentValue;
  });
  return matched ? matched.value : CUSTOM_FREQUENCY_VALUE;
}

function getInstructionSelectValue(value) {
  const cleanValue = String(value || '').trim();
  if (!cleanValue) return CUSTOM_INSTRUCTION_VALUE;
  return INSTRUCTION_OPTIONS.find((option) => option.toLowerCase() === cleanValue.toLowerCase()) || CUSTOM_INSTRUCTION_VALUE;
}

function getRouteForMedicineType(type) {
  if (type === 'Injection') return 'IV/IM';
  if (type === 'Shots') return 'IM/SC';
  if (['Ointment', 'Cream', 'Gel', 'Lotion', 'Shampoo'].includes(type)) return 'Topical';
  if (['Drops', 'Eye Drops', 'Ear Drops', 'Nasal Drops', 'Spray'].includes(type)) return 'Local';
  if (['Inhaler', 'Nebulizer Solution'].includes(type)) return 'Inhalation';
  if (type === 'Suppository') return 'Rectal';
  if (type === 'Patch') return 'Transdermal';
  return 'Oral';
}

function resolveMedicineType(value, fallback = 'Tablet') {
  if (!value) return fallback;
  return MEDICINE_TYPE_VALUES.find((type) => type.toLowerCase() === String(value).toLowerCase()) || fallback;
}

function getMedicineTypeOption(value) {
  return MEDICINE_TYPE_OPTIONS.find((o) => o.value === value) || { value, category: 'Other' };
}

function getMedicineTypeCategoryClass(category) {
  return String(category || 'Other').toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

/* ── Custom Unit Dropdown Component ── */
function UnitDropdown({ value, onChange, rowIndex }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const searchInputRef = useRef(null);
  const listRef = useRef(null);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const [menuPos, setMenuPos] = useState(null);

  const current = getMedicineTypeOption(value);

  const filtered = useMemo(() => {
    if (!search.trim()) return MEDICINE_TYPE_OPTIONS;
    const q = search.toLowerCase();
    return MEDICINE_TYPE_OPTIONS.filter(
      (o) => o.value.toLowerCase().includes(q) || o.category.toLowerCase().includes(q)
    );
  }, [search]);

  // Group filtered options by category
  const grouped = useMemo(() => {
    const map = new Map();
    for (const opt of filtered) {
      if (!map.has(opt.category)) map.set(opt.category, []);
      map.get(opt.category).push(opt);
    }
    return map;
  }, [filtered]);

  // Flatten for keyboard navigation
  const flatList = useMemo(() => {
    const list = [];
    for (const [, items] of grouped) list.push(...items);
    return list;
  }, [grouped]);

  const calcPosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const pad = 8;
    const menuWidth = Math.max(rect.width, 240);
    const menuMaxHeight = 340;
    const availableBelow = window.innerHeight - rect.bottom - pad;
    const availableAbove = rect.top - pad;
    const openAbove = availableBelow < menuMaxHeight && availableAbove > availableBelow;
    const top = openAbove
      ? Math.max(pad, rect.top - Math.min(menuMaxHeight, availableAbove) - 6)
      : rect.bottom + 6;
    const maxH = openAbove
      ? Math.min(menuMaxHeight, availableAbove - 6)
      : Math.min(menuMaxHeight, availableBelow - 6);
    // Center horizontally on trigger, but clamp to viewport
    let left = rect.left + rect.width / 2 - menuWidth / 2;
    left = Math.max(pad, Math.min(left, window.innerWidth - menuWidth - pad));
    setMenuPos({ top, left, width: menuWidth, maxHeight: maxH });
  }, []);

  const closeDropdown = useCallback(() => {
    setOpen(false);
    setSearch('');
    setHighlightIdx(-1);
    setMenuPos(null);
  }, []);

  // Close on outside click (works across portal boundary)
  useEffect(() => {
    if (!open) return undefined;
    const handler = (e) => {
      if (
        triggerRef.current?.contains(e.target) ||
        menuRef.current?.contains(e.target)
      ) return;
      closeDropdown();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, closeDropdown]);

  // Position on open + reposition on scroll/resize
  useEffect(() => {
    if (!open) return undefined;
    calcPosition();
    const reposition = () => calcPosition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open, calcPosition]);

  // Focus search on open
  useEffect(() => {
    if (open && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [open]);

  // Scroll highlighted into view
  useEffect(() => {
    if (highlightIdx < 0 || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-unit-idx="${highlightIdx}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [highlightIdx]);

  const handleSelect = (val) => {
    onChange(val);
    closeDropdown();
  };

  const handleKeyDown = (e) => {
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      closeDropdown();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx((prev) => (prev < flatList.length - 1 ? prev + 1 : 0));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx((prev) => (prev > 0 ? prev - 1 : flatList.length - 1));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightIdx >= 0 && highlightIdx < flatList.length) {
        handleSelect(flatList[highlightIdx].value);
      }
    }
  };

  const menuContent = open && menuPos && typeof document !== 'undefined' ? createPortal(
    <div
      ref={menuRef}
      className="unit-dropdown-menu"
      style={{
        position: 'fixed',
        top: menuPos.top,
        left: menuPos.left,
        width: menuPos.width,
        maxHeight: menuPos.maxHeight,
      }}
      onKeyDown={handleKeyDown}
    >
      <div className="unit-dropdown-search-wrap">
        <svg className="unit-dropdown-search-icon" width="14" height="14" viewBox="0 0 14 14" fill="none">
          <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.3" />
          <path d="M9.5 9.5L12.5 12.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
        <input
          ref={searchInputRef}
          type="text"
          className="unit-dropdown-search"
          placeholder="Search type..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setHighlightIdx(0); }}
          autoComplete="off"
        />
      </div>

      <div className="unit-dropdown-list" ref={listRef} role="listbox">
        {flatList.length === 0 && (
          <div className="unit-dropdown-empty">No matches found</div>
        )}
        {Array.from(grouped.entries()).map(([category, items]) => (
          <div key={category} className="unit-dropdown-group">
            <div className="unit-dropdown-group-label">{category}</div>
            {items.map((opt) => {
              const globalIdx = flatList.indexOf(opt);
              const isActive = opt.value === value;
              const isHighlighted = globalIdx === highlightIdx;
              return (
                <button
                  type="button"
                  key={opt.value}
                  data-unit-idx={globalIdx}
                  className={`unit-dropdown-option ${
                    isActive ? 'unit-dropdown-option--active' : ''
                  } ${isHighlighted ? 'unit-dropdown-option--highlighted' : ''}`}
                  onClick={() => handleSelect(opt.value)}
                  role="option"
                  aria-selected={isActive}
                >
                  <span
                    className={`unit-dropdown-type-mark unit-dropdown-type-mark--${getMedicineTypeCategoryClass(opt.category)}`}
                    aria-hidden="true"
                  >
                    {opt.value.charAt(0)}
                  </span>
                  <span className="unit-dropdown-option-label">{opt.value}</span>
                  {isActive && (
                    <svg className="unit-dropdown-check" width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M3 7.5L5.5 10L11 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <div className="unit-dropdown" onKeyDown={handleKeyDown}>
      <button
        type="button"
        ref={triggerRef}
        className={`unit-dropdown-trigger ${open ? 'unit-dropdown-trigger--open' : ''}`}
        onClick={() => setOpen((prev) => !prev)}
        id={`unit-dropdown-trigger-${rowIndex}`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span
          className={`unit-dropdown-type-mark unit-dropdown-type-mark--${getMedicineTypeCategoryClass(current.category)}`}
          aria-hidden="true"
        >
          {current.value?.charAt(0) || 'T'}
        </span>
        <span className="unit-dropdown-trigger-label">{current.value}</span>
        <span className={`unit-dropdown-chevron ${open ? 'unit-dropdown-chevron--open' : ''}`}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
      {menuContent}
    </div>
  );
}

function getPatientTypeMeta(type) {
  if (type === 'corporate_employee') return { label: '🏢 Corporate', bg: 'rgba(16, 185, 129, 0.12)', color: '#059669', border: 'rgba(16,185,129,0.2)' };
  if (type === 'cisf_employee') return { label: '🛡️ CISF', bg: 'rgba(99, 102, 241, 0.12)', color: '#4f46e5', border: 'rgba(99,102,241,0.2)' };
  return { label: '👤 General', bg: 'rgba(59, 130, 246, 0.12)', color: '#2563eb', border: 'rgba(59,130,246,0.2)' };
}

function formatPatientId(patient) {
  if (!patient) return '-';
  return patient.uhid || `ID-${patient.id}`;
}

function formatPatientMeta(patient) {
  if (!patient) return '';
  return `${patient.age || '-'} Yrs / ${patient.gender || '-'}`;
}

function formatPrescriptionDate(value) {
  if (!value) return 'Recent visit';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Recent visit';
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function normalizeHistoryDuration(value) {
  if (value === null || value === undefined || value === '') return '5';
  const match = String(value).match(/\d+/);
  return match ? match[0] : String(value);
}

function buildRepeatedMedicineItem(item) {
  const medicineName = String(item?.medicine_name || item?.generic_name || '').trim();
  const doseUnit = item?.dose_unit || 'Tablet';
  return {
    medicine_id: item?.medicine_id || null,
    medicine_name: medicineName,
    generic_name: item?.generic_name || medicineName,
    dose: item?.dose || item?.dosage || '1',
    dose_unit: doseUnit,
    route: item?.route || getRouteForMedicineType(doseUnit),
    frequency: item?.frequency || '1-0-1',
    duration_days: normalizeHistoryDuration(item?.duration_days || item?.duration),
    instructions: item?.instructions || 'After food',
  };
}

export default function PrescriptionSlipPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const printRef = useRef(null);
  const inlineInputRefs = useRef({});
  const daysInputRefs = useRef({});
  const daysPickerRef = useRef(null);

  const [patientQuery, setPatientQuery] = useState('');
  const [patientResults, setPatientResults] = useState([]);
  const [patientLookupLoading, setPatientLookupLoading] = useState(false);
  const [showPatientResults, setShowPatientResults] = useState(false);
  const [patient, setPatient] = useState(null);

  const [diagnosis, setDiagnosis] = useState('');
  const [notes, setNotes] = useState('');
  const [prescriptionItems, setPrescriptionItems] = useState([emptyItem()]);
  const [medicineQuery, setMedicineQuery] = useState('');
  const [medicineResults, setMedicineResults] = useState([]);
  const [medicineLookupLoading, setMedicineLookupLoading] = useState(false);
  const [showMedicineResults, setShowMedicineResults] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [encounterId, setEncounterId] = useState(null);
  const [prescriptionId, setPrescriptionId] = useState(null);
  const [medicationHistory, setMedicationHistory] = useState([]);
  const [medicationHistoryLoading, setMedicationHistoryLoading] = useState(false);

  const [searchParams] = useSearchParams();
  const paramPatientId = searchParams.get('patientId');
  const paramEncounterId = searchParams.get('encounterId');

  const loadMedicationHistory = useCallback(async (selectedPatientId) => {
    if (!selectedPatientId) {
      setMedicationHistory([]);
      setMedicationHistoryLoading(false);
      return;
    }

    setMedicationHistoryLoading(true);
    try {
      const res = await api.get(`/hms/prescriptions/patient/${selectedPatientId}`);
      const list = Array.isArray(res.data) ? res.data : res.data?.data || [];
      setMedicationHistory(list.filter((prescription) => Array.isArray(prescription.items) && prescription.items.length > 0));
    } catch (error) {
      console.error('Failed to load medication history:', error);
      setMedicationHistory([]);
    } finally {
      setMedicationHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      // If encounterId is present, we are editing, so prevent patient selection from resetting the form
      if (paramPatientId) {
        await loadPatientFromParam(paramPatientId, !!paramEncounterId);
      }
      if (paramEncounterId) {
        setEncounterId(paramEncounterId);
        await loadPrescription(paramEncounterId);
      }
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramPatientId, paramEncounterId]);

  useEffect(() => {
    if (!patient?.id) {
      setMedicationHistory([]);
      setMedicationHistoryLoading(false);
      return;
    }
    loadMedicationHistory(patient.id);
  }, [patient?.id, loadMedicationHistory]);

  const previousMedicationHistory = useMemo(() => medicationHistory
    .filter((prescription) => {
      const samePrescription = prescriptionId && Number(prescription.id) === Number(prescriptionId);
      const sameEncounter = encounterId && Number(prescription.encounter_id) === Number(encounterId);
      return !samePrescription && !sameEncounter;
    })
    .filter((prescription) => Array.isArray(prescription.items) && prescription.items.some((item) => String(item.medicine_name || item.generic_name || '').trim()))
    .slice(0, 3), [medicationHistory, prescriptionId, encounterId]);

  const loadPrescription = async (encId) => {
    try {
      const res = await api.get(`/hms/prescriptions/encounter/${encId}`);
      if (res.data) {
        setPrescriptionId(res.data.id || res.data.ID);
        // Load diagnosis and items
        if (res.data.diagnosis) setDiagnosis(res.data.diagnosis);
        if (res.data.items && res.data.items.length > 0) {
          setPrescriptionItems(res.data.items.map((item) => ({
            medicine_id: item.medicine_id || null,
            medicine_name: item.medicine_name || '',
            generic_name: item.generic_name || '',
            dose: item.dose || item.dosage || '',
            dose_unit: item.dose_unit || 'Tablet',
            route: item.route || 'Oral',
            frequency: item.frequency || '1-0-1',
            duration_days: item.duration_days || '5',
            instructions: item.instructions || 'After food',
          })));
        }
      }
    } catch (err) {
      console.log('No existing prescription found for this encounter, starting fresh.');
    }
  };

  const loadPatientFromParam = async (id, preventReset = false) => {
    try {
      const res = await api.get(`/patients/hms/${id}`);
      // The /patients/hms/:id endpoint returns { success, data: { ...patient } }
      const patientData = res.data?.data || res.data?.patient;
      if (res.data?.success && patientData) {
        handleSelectPatient(patientData, preventReset);
      }
    } catch (err) {
      console.error('Failed to load patient from param:', err);
      toast.error('Failed to load patient data');
    }
  };

  useEffect(() => {
    const q = patientQuery.trim();
    if (q.length < 2 || patient?.name === q || patient?.uhid === q) {
      setPatientResults([]);
      return undefined;
    }

    const timeoutId = window.setTimeout(async () => {
      setPatientLookupLoading(true);
      try {
        const results = [];
        const normalized = q.toUpperCase();

        if (/^\d+$/.test(q)) {
          try {
            const directRes = await api.get(`/patients/hms/${q}`);
            if (directRes.data?.success && directRes.data.patient) {
              results.push(directRes.data.patient);
            }
          } catch (error) {
            if (error?.response?.status !== 404) {
              throw error;
            }
          }
        }

        const searchRes = await api.get(`/patients/hms/search?q=${encodeURIComponent(q)}`);
        const quickMatches = Array.isArray(searchRes.data?.data) ? searchRes.data.data : [];

        const seen = new Set();
        const merged = [...results, ...quickMatches].filter((entry) => {
          if (!entry?.id) return false;
          if (seen.has(entry.id)) return false;
          seen.add(entry.id);
          return true;
        });

        merged.sort((a, b) => {
          const aStarts = String(a.uhid || a.name || '').toUpperCase().startsWith(normalized);
          const bStarts = String(b.uhid || b.name || '').toUpperCase().startsWith(normalized);
          if (aStarts !== bStarts) return aStarts ? -1 : 1;
          return Number(b.id) - Number(a.id);
        });

        setPatientResults(merged.slice(0, 8));
        setShowPatientResults(true);
      } catch (error) {
        console.error(error);
        toast.error('Failed to search patients');
      } finally {
        setPatientLookupLoading(false);
      }
    }, 300);

    return () => window.clearTimeout(timeoutId);
  }, [patientQuery, patient]);

  // RxTerms API helper
  const searchRxTerms = async (term) => {
    try {
      const res = await fetch(`https://clinicaltables.nlm.nih.gov/api/rxterms/v3/search?terms=${encodeURIComponent(term)}&maxList=10`);
      const data = await res.json();
      // data = [totalCount, [displayNames], null, [[name1],[name2],...]]
      const names = Array.isArray(data[1]) ? data[1] : [];
      return names;
    } catch {
      return [];
    }
  };

  useEffect(() => {
    const q = medicineQuery.trim();
    if (q.length < 2) {
      setMedicineResults([]);
      return undefined;
    }

    const timeoutId = window.setTimeout(async () => {
      setMedicineLookupLoading(true);
      try {
        // Try local DB first
        const res = await api.get(`/hms/medicines/search?q=${encodeURIComponent(q)}`);
        const localResults = Array.isArray(res.data) ? res.data : [];
        
        // Also fetch from RxTerms API
        const rxNames = await searchRxTerms(q);
        const rxResults = rxNames.map((name, i) => ({
          id: `rx-${i}`,
          genericName: name,
          formulation: '',
          strength: '',
          strengthUnit: '',
          _isRxTerm: true,
        }));

        // Merge: local first, then RxTerms (deduplicated)
        const localNames = new Set(localResults.map(m => (m.genericName || '').toUpperCase()));
        const merged = [
          ...localResults,
          ...rxResults.filter(r => !localNames.has(r.genericName.toUpperCase()))
        ];

        setMedicineResults(merged);
        setShowMedicineResults(true);
      } catch (error) {
        console.error(error);
        // Fallback to RxTerms only
        const rxNames = await searchRxTerms(q);
        if (rxNames.length > 0) {
          setMedicineResults(rxNames.map((name, i) => ({
            id: `rx-${i}`, genericName: name, formulation: '', strength: '', strengthUnit: '', _isRxTerm: true,
          })));
          setShowMedicineResults(true);
        }
      } finally {
        setMedicineLookupLoading(false);
      }
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [medicineQuery]);

  // Inline autocomplete for each medicine row
  const [inlineSuggestions, setInlineSuggestions] = useState({});
  const [activeInlineIdx, setActiveInlineIdx] = useState(null);
  const [inlineDropdownPosition, setInlineDropdownPosition] = useState(null);
  const [activeDaysPickerIdx, setActiveDaysPickerIdx] = useState(null);
  const [daysPickerPosition, setDaysPickerPosition] = useState(null);

  const positionInlineDropdown = (index) => {
    const input = inlineInputRefs.current[index];
    if (!input) return;

    const rect = input.getBoundingClientRect();
    const viewportPadding = 12;
    const width = Math.min(
      480,
      Math.max(260, Math.min(window.innerWidth - viewportPadding * 2, Math.max(340, rect.width)))
    );
    const maxLeft = Math.max(viewportPadding, window.innerWidth - width - viewportPadding);
    const left = Math.min(Math.max(viewportPadding, rect.left), maxLeft);
    const availableBelow = window.innerHeight - rect.bottom - viewportPadding;
    const availableAbove = rect.top - viewportPadding;
    const openAbove = availableBelow < 180 && availableAbove > availableBelow;
    const availableSpace = openAbove ? availableAbove : availableBelow;
    const maxHeight = Math.max(140, Math.min(260, availableSpace - 8));
    const top = openAbove
      ? Math.max(viewportPadding, rect.top - maxHeight - 6)
      : rect.bottom + 6;

    setInlineDropdownPosition({ top, left, width, maxHeight });
  };

  const positionDaysPicker = (index) => {
    const input = daysInputRefs.current[index];
    if (!input) return;

    const rect = input.getBoundingClientRect();
    const viewportPadding = 12;
    const width = 230;
    const maxLeft = Math.max(viewportPadding, window.innerWidth - width - viewportPadding);
    const left = Math.min(Math.max(viewportPadding, rect.left + rect.width - width), maxLeft);
    const pickerHeight = 236;
    const availableBelow = window.innerHeight - rect.bottom - viewportPadding;
    const availableAbove = rect.top - viewportPadding;
    const openAbove = availableBelow < pickerHeight && availableAbove > availableBelow;
    const top = openAbove
      ? Math.max(viewportPadding, rect.top - pickerHeight - 6)
      : rect.bottom + 6;

    setDaysPickerPosition({ top, left, width });
  };

  const openDaysPicker = (index) => {
    setActiveDaysPickerIdx(index);
    window.requestAnimationFrame(() => positionDaysPicker(index));
  };

  const closeDaysPicker = () => {
    setActiveDaysPickerIdx(null);
    setDaysPickerPosition(null);
  };

  const selectDurationDays = (index, days) => {
    updateItem(index, 'duration_days', days);
    closeDaysPicker();
  };

  const handleInlineMedicineSearch = (index, value) => {
    updateItem(index, 'medicine_name', value);
    if (value.trim().length < 2) {
      setInlineSuggestions(prev => ({ ...prev, [index]: [] }));
      setActiveInlineIdx(null);
      setInlineDropdownPosition(null);
      return;
    }
    setActiveInlineIdx(index);
    window.requestAnimationFrame(() => positionInlineDropdown(index));
    // Debounced search
    clearTimeout(window[`_inlineTimer_${index}`]);
    window[`_inlineTimer_${index}`] = setTimeout(async () => {
      const names = await searchRxTerms(value.trim());
      setInlineSuggestions(prev => ({ ...prev, [index]: names }));
      window.requestAnimationFrame(() => positionInlineDropdown(index));
    }, 300);
  };

  const selectInlineSuggestion = (index, name) => {
    setActiveInlineIdx(null);
    setInlineDropdownPosition(null);
    setInlineSuggestions(prev => ({ ...prev, [index]: [] }));
    setPrescriptionItems((items) => {
      const nextItems = [...items];
      nextItems[index] = {
        ...nextItems[index],
        medicine_name: name,
        generic_name: name || nextItems[index]?.generic_name || '',
      };
      return nextItems;
    });
  };

  useEffect(() => {
    const suggestions = activeInlineIdx !== null ? inlineSuggestions[activeInlineIdx] : null;
    if (!suggestions?.length) {
      setInlineDropdownPosition(null);
      return undefined;
    }

    positionInlineDropdown(activeInlineIdx);
    const handleReposition = () => positionInlineDropdown(activeInlineIdx);
    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, true);

    return () => {
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
    };
  }, [activeInlineIdx, inlineSuggestions]);

  useEffect(() => {
    if (activeDaysPickerIdx === null) return undefined;

    positionDaysPicker(activeDaysPickerIdx);
    const handleReposition = () => positionDaysPicker(activeDaysPickerIdx);
    const handlePointerDown = (event) => {
      const input = daysInputRefs.current[activeDaysPickerIdx];
      if (input?.contains(event.target) || daysPickerRef.current?.contains(event.target)) return;
      closeDaysPicker();
    };

    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, true);
    document.addEventListener('mousedown', handlePointerDown);

    return () => {
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [activeDaysPickerIdx]);

  const validItems = useMemo(
    () => prescriptionItems.filter((item) => item.medicine_name.trim()),
    [prescriptionItems]
  );

  const resetPrescriptionState = () => {
    setEncounterId(null);
    setPrescriptionId(null);
    setDiagnosis('');
    setNotes('');
    setPrescriptionItems([emptyItem()]);
    setPreviewMode(false);
  };

  const handleSelectPatient = (selectedPatient, preventReset = false) => {
    setPatient(selectedPatient);
    setPatientQuery(selectedPatient.uhid || selectedPatient.name || selectedPatient.patient_name || String(selectedPatient.id));
    setShowPatientResults(false);
    if (!preventReset) resetPrescriptionState();
  };

  const updateItem = (index, field, value) => {
    setPrescriptionItems((items) => {
      const nextItems = [...items];
      nextItems[index] = { ...nextItems[index], [field]: value };
      return nextItems;
    });
  };

  const updateMedicineType = (index, type) => {
    setPrescriptionItems((items) => {
      const nextItems = [...items];
      nextItems[index] = {
        ...nextItems[index],
        dose_unit: type,
        route: getRouteForMedicineType(type),
      };
      return nextItems;
    });
  };

  const clearMedicineDraftFlag = (item) => {
    const { _isGlobalMedicineDraft, ...rest } = item;
    return rest;
  };

  const removeGlobalMedicineDraft = () => {
    setPrescriptionItems((items) => {
      const draftIndex = items.findIndex((item) => item._isGlobalMedicineDraft);
      if (draftIndex < 0) return items;
      if (items.length === 1) return [emptyItem()];
      return items.filter((_, itemIndex) => itemIndex !== draftIndex);
    });
  };

  const appendRepeatedMedicines = (sourceItems, successMessage) => {
    const repeatedItems = sourceItems
      .map(buildRepeatedMedicineItem)
      .filter((item) => item.medicine_name);

    if (repeatedItems.length === 0) {
      toast.error('No medicines found to repeat');
      return;
    }

    setActiveInlineIdx(null);
    setInlineDropdownPosition(null);
    closeDaysPicker();
    setMedicineQuery('');
    setMedicineResults([]);
    setShowMedicineResults(false);

    setPrescriptionItems((items) => {
      const cleanItems = items.map((item) => clearMedicineDraftFlag(item));
      const hasSingleBlankRow = cleanItems.length === 1 && !String(cleanItems[0].medicine_name || '').trim();
      return hasSingleBlankRow ? repeatedItems : [...cleanItems, ...repeatedItems];
    });

    toast.success(successMessage);
  };

  const repeatPreviousMedicine = (item) => {
    appendRepeatedMedicines([item], 'Medicine repeated from history');
  };

  const repeatPreviousPrescription = (prescription) => {
    appendRepeatedMedicines(prescription.items || [], 'Previous prescription repeated');
  };

  const syncMedicineQueryToRow = (value) => {
    const medicineName = value.trimStart();

    if (!medicineName.trim()) {
      removeGlobalMedicineDraft();
      return;
    }

    setPrescriptionItems((items) => {
      const nextItems = [...items];
      let targetIndex = nextItems.findIndex((item) => item._isGlobalMedicineDraft);

      if (targetIndex < 0) {
        targetIndex = nextItems.findIndex((item) => !item.medicine_name.trim());
      }

      const currentItem = targetIndex >= 0 ? nextItems[targetIndex] : emptyItem();
      const draftItem = {
        ...currentItem,
        medicine_id: null,
        medicine_name: medicineName,
        generic_name: medicineName,
        _isGlobalMedicineDraft: true,
      };

      if (targetIndex >= 0) {
        nextItems[targetIndex] = draftItem;
        return nextItems;
      }

      return [...nextItems, draftItem];
    });
  };

  const handleMedicineQueryChange = (value) => {
    setMedicineQuery(value);
    setShowMedicineResults(true);
    syncMedicineQueryToRow(value);
  };

  const commitMedicineQueryRow = () => {
    setPrescriptionItems((items) => items.map((item) => (
      item._isGlobalMedicineDraft ? clearMedicineDraftFlag(item) : item
    )));
    setMedicineQuery('');
    setMedicineResults([]);
    setShowMedicineResults(false);
  };

  const removeRow = (index) => {
    setActiveInlineIdx(null);
    setInlineDropdownPosition(null);
    closeDaysPicker();
    setPrescriptionItems((items) => {
      if (items.length === 1) return [emptyItem()];
      return items.filter((_, itemIndex) => itemIndex !== index);
    });
  };

  const addMedicineFromSearch = (medicine) => {
    const displayName = [medicine.genericName, medicine.strength, medicine.strengthUnit]
      .filter(Boolean)
      .join(' ');

    setPrescriptionItems((items) => {
      const nextItems = [...items];
      const draftIndex = nextItems.findIndex((item) => item._isGlobalMedicineDraft);
      const firstBlankIndex = draftIndex >= 0
        ? draftIndex
        : nextItems.findIndex((item) => !item.medicine_name.trim());
      const currentItem = firstBlankIndex >= 0
        ? clearMedicineDraftFlag(nextItems[firstBlankIndex])
        : emptyItem();
      const medicineType = resolveMedicineType(medicine.formulation, currentItem.dose_unit || 'Tablet');

      const nextValue = {
        ...currentItem,
        medicine_id: medicine.id,
        medicine_name: displayName || medicine.genericName || '',
        generic_name: medicine.genericName || '',
        dose_unit: medicineType,
        route: getRouteForMedicineType(medicineType),
      };

      if (firstBlankIndex >= 0) {
        nextItems[firstBlankIndex] = nextValue;
        return nextItems;
      }

      return [...nextItems, nextValue];
    });

    setMedicineQuery('');
    setMedicineResults([]);
    setShowMedicineResults(false);
  };

  const buildPayloadItems = () =>
    validItems.map((item) => ({
      medicine_id: item.medicine_id || null,
      medicine_name: String(item.medicine_name || '').trim(),
      generic_name: item.generic_name != null ? String(item.generic_name).trim() : null,
      dose: item.dose != null ? String(item.dose).trim() : null,
      dose_unit: item.dose_unit != null ? String(item.dose_unit).trim() : null,
      route: item.route != null ? String(item.route).trim() : null,
      frequency: item.frequency != null ? String(item.frequency).trim() : null,
      duration_days: item.duration_days != null ? String(item.duration_days).trim() : null,
      instructions: item.instructions != null ? String(item.instructions).trim() : null,
    }));

  const ensurePrescriptionShell = async () => {
    let currentEncounterId = encounterId;
    let currentPrescriptionId = prescriptionId;

    if (!currentEncounterId) {
      const encounterRes = await api.post('/hms/encounters', {
        patient_id: patient.id,
        encounter_type: 'OPD',
        chief_complaint: diagnosis || null,
      });
      currentEncounterId = encounterRes.data.id;
      setEncounterId(currentEncounterId);
    }

    if (!currentPrescriptionId) {
      const prescriptionRes = await api.post('/hms/prescriptions', {
        encounter_id: currentEncounterId,
        patient_id: patient.id,
        diagnosis: diagnosis || null,
        status: 'Consulted',
        type: 'OPD',
      });
      currentPrescriptionId = prescriptionRes.data.id;
      setPrescriptionId(currentPrescriptionId);
    }

    return { currentEncounterId, currentPrescriptionId };
  };

  const handleSave = async () => {
    if (!patient) {
      toast.error('Select a patient first');
      return null;
    }

    if (!diagnosis || !diagnosis.trim()) {
      toast.error('Diagnosis / Clinical Impression is required');
      return null;
    }

    if (validItems.length === 0) {
      toast.error('Add at least one medicine');
      return null;
    }

    setSaving(true);
    try {
      const { currentEncounterId, currentPrescriptionId } = await ensurePrescriptionShell();

      await api.put(`/hms/encounters/${currentEncounterId}`, {
        chief_complaint: diagnosis || null,
        current_medications: notes || null,
      });

      await api.put(`/hms/prescriptions/${currentPrescriptionId}/items`, {
        items: buildPayloadItems(),
        status: 'Consulted',
      });

      // Mark the prescription status as Consulted
      await api.patch(`/hms/prescriptions/${currentPrescriptionId}/status`, {
        status: 'Consulted',
      });

      loadMedicationHistory(patient.id);
      toast.success('Prescription saved');
      return currentPrescriptionId;
    } catch (error) {
      console.error(error);
      toast.error('Failed to save prescription');
      return null;
    } finally {
      setSaving(false);
    }
  };

  const handlePreview = async () => {
    if (!patient) {
      toast.error('Select a patient first');
      return;
    }

    if (!diagnosis || !diagnosis.trim()) {
      toast.error('Diagnosis / Clinical Impression is required');
      return;
    }

    if (validItems.length === 0) {
      toast.error('Add at least one medicine');
      return;
    }

    setPreviewMode(true);
  };

  const handlePrint = async () => {
    const savedId = prescriptionId || (await handleSave());
    if (!savedId) return;
    setPreviewMode(true);
    setTimeout(() => {
      window.print();
    }, 100);
  };

  return (
    <>
      {!previewMode && <Navbar />}
      <div className={`prescription-slip-container ${previewMode ? 'preview-mode' : ''}`}>
      {!previewMode ? (
        <div className="no-print prescription-workbench">
          
          {/* ── LEFT COLUMN ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            
            {/* ── Premium Header ── */}
            <div className="hms-page-header" style={{ marginBottom: 0, marginTop: 8 }}>
              <div>
                <h1>
                  <span className="header-icon" style={{ background: 'rgba(96,165,250,0.12)', borderColor: 'rgba(96,165,250,0.25)' }}>💊</span>
                  Electronic Prescription
                </h1>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: 6, marginLeft: 56 }}>
                  Search for a patient, add medicines, and generate a printable prescription slip.
                </p>
              </div>
            </div>

            {/* ── Patient Search Card ── */}
            <div className="card prescription-toolbar" style={{ padding: '20px 24px', flexDirection: 'column', gap: '16px', alignItems: 'stretch' }}>
              <div className="toolbar-search" style={{ width: '100%' }}>
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 22, height: 22, borderRadius: 6, background: 'rgba(59,130,246,0.1)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem' }}>🔍</span>
                Find Registered Patient
              </label>
              <div className="toolbar-search-input">
                <input
                  type="text"
                  className="form-input"
                  placeholder="Search by patient ID, UHID, or name"
                  value={patientQuery}
                  onChange={(event) => {
                    setPatientQuery(event.target.value);
                    setShowPatientResults(true);
                  }}
                  onFocus={() => setShowPatientResults(true)}
                />
                {patientLookupLoading && <div className="spinner toolbar-spinner" />}
              </div>
              {showPatientResults && patientResults.length > 0 && (
                <div className="search-dropdown">
                  {patientResults.map((result) => (
                    <button
                      type="button"
                      key={result.id}
                      className="search-item search-item-button"
                      onClick={() => handleSelectPatient(result)}
                    >
                      <strong>{result.name || result.patient_name || '-'}</strong>
                      <span>{formatPatientId(result)} • {formatPatientMeta(result)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── Patient & Clinical Details Card ── */}
          <div className="card prescription-editor-panel">
            <div className="editor-section-header">
              <span className="section-icon" style={{ background: 'rgba(16,185,129,0.1)' }}>👤</span>
              Patient & Clinical Details
            </div>
            <div className="editor-body">
              <div className="editor-grid" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div className="editor-field">
                  <label className="form-label">Selected Patient</label>
                  <div className="patient-summary">
                    {patient ? (
                      <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                          <div className="patient-summary-name" style={{ margin: 0 }}>{patient.name}</div>
                          <span style={{
                            padding: '3px 10px', borderRadius: 8, fontSize: '0.7rem', fontWeight: 700,
                            background: getPatientTypeMeta(patient.patientType).bg,
                            color: getPatientTypeMeta(patient.patientType).color,
                            border: `1px solid ${getPatientTypeMeta(patient.patientType).border}`,
                            letterSpacing: '0.04em', textTransform: 'uppercase',
                          }}>
                            {getPatientTypeMeta(patient.patientType).label}
                          </span>
                        </div>
                        <div className="patient-summary-meta">
                          <span>{formatPatientId(patient)}</span>
                          <span>{formatPatientMeta(patient)}</span>
                          {patient.patientType === 'corporate_employee' && patient.empNumber && (
                            <span style={{ fontWeight: 600 }}>Emp: {patient.empNumber}</span>
                          )}
                          {patient.patientType === 'corporate_employee' && patient.relationship && patient.relationship !== 'Self' && (
                            <span style={{ fontWeight: 600, color: '#d97706' }}>Relation: {patient.relationship}</span>
                          )}
                          {patient.patientType === 'corporate_employee' && patient.employee_name && patient.relationship !== 'Self' && (
                            <span style={{ fontWeight: 600, color: '#059669' }}>Emp Name: {patient.employee_name}</span>
                          )}
                          {patient.patientType === 'corporate_employee' && (!patient.relationship || patient.relationship === 'Self') && (
                            <span style={{ fontWeight: 600, color: '#059669' }}>Self</span>
                          )}
                          {patient.patientType !== 'corporate_employee' && (
                            <span>{patient.phoneNumber || 'No phone'}</span>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="patient-summary-empty">🔍 Search and select a patient above to begin.</div>
                    )}
                  </div>
                </div>

                <div className="editor-field">
                  <label className="form-label">
                    Diagnosis / Clinical Impression <span style={{ color: 'var(--red)', fontWeight: 'bold' }}>*</span>
                  </label>
                  <textarea
                    className="form-textarea"
                    rows={3}
                    value={diagnosis}
                    onChange={(event) => setDiagnosis(event.target.value)}
                    placeholder="Enter diagnosis or working impression"
                  />
                </div>

                <div className="editor-field editor-field-full">
                  <label className="form-label">Doctor Notes</label>
                  <textarea
                    className="form-textarea"
                    rows={2}
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder="Additional notes for patient or pharmacy"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── RIGHT COLUMN ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', minWidth: 0 }}>
          
          {/* ── Action Buttons Card ── */}
          <div className="card" style={{ display: 'flex', justifyContent: 'flex-end', padding: '16px 24px' }}>
            <div className="toolbar-actions">
              <button className="btn btn-ghost" onClick={() => navigate(-1)}>← Back</button>
              <button className="btn btn-outline" onClick={handlePreview} style={{ borderColor: 'rgba(139,92,246,0.3)', color: '#7c3aed' }}>👁️ Preview</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? '⏳ Saving...' : '💾 Save Prescription'}
              </button>
              <button className="btn" onClick={handlePrint} disabled={saving} style={{ background: 'rgba(16,185,129,0.1)', color: '#059669', border: '1px solid rgba(16,185,129,0.25)', fontWeight: 700 }}>
                🖨️ Print
              </button>
            </div>
          </div>

          {/* ── Medicine Section Card ── */}
          <div className="card prescription-editor-panel prescription-medicine-panel">
            <div className="editor-section-header" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '16px', marginBottom: '16px' }}>
              <span className="section-icon" style={{ background: 'rgba(139,92,246,0.1)' }}>💊</span>
              Prescription & Medicines
            </div>
            
            <div className="editor-body" style={{ padding: 0 }}>
              {/* ── Medicine Lookup ── */}
              <div className="medicine-lookup-row" style={{ padding: '0 24px 20px' }}>
              <div className="medicine-lookup-box">
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 22, height: 22, borderRadius: 6, background: 'rgba(139,92,246,0.1)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem' }}>💊</span>
                  Add Medicine
                </label>
                <div className="toolbar-search-input">
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Search medicine by generic or brand name"
                    value={medicineQuery}
                    onChange={(event) => handleMedicineQueryChange(event.target.value)}
                    onFocus={() => setShowMedicineResults(true)}
                    onBlur={() => window.setTimeout(() => commitMedicineQueryRow(), 160)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && medicineQuery.trim()) {
                        event.preventDefault();
                        commitMedicineQueryRow();
                      }
                    }}
                  />
                  {medicineLookupLoading && <div className="spinner toolbar-spinner" />}
                </div>
                {showMedicineResults && medicineResults.length > 0 && (
                  <div className="search-dropdown">
                    {medicineResults.map((medicine) => (
                      <button
                        type="button"
                        key={medicine.id}
                        className="search-item search-item-button"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          addMedicineFromSearch(medicine);
                        }}
                      >
                        <strong>{medicine.genericName}</strong>
                        <span>
                          {medicine._isRxTerm ? '🌐 RxTerms' : [medicine.formulation, medicine.strength, medicine.strengthUnit].filter(Boolean).join(' ')}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {patient && (
              <div className="medication-history-panel">
                <div className="medication-history-header">
                  <div>
                    <div className="medication-history-title">Previous Medication</div>
                    <div className="medication-history-subtitle">Repeat prior medicines into this prescription when clinically appropriate.</div>
                  </div>
                  {previousMedicationHistory.length > 0 && (
                    <span className="medication-history-count">{previousMedicationHistory.length} recent</span>
                  )}
                </div>

                {medicationHistoryLoading ? (
                  <div className="medication-history-empty">
                    <span className="spinner medication-history-spinner" />
                    Loading medication history...
                  </div>
                ) : previousMedicationHistory.length === 0 ? (
                  <div className="medication-history-empty">No previous medicines found for this patient.</div>
                ) : (
                  <div className="medication-history-list">
                    {previousMedicationHistory.map((historyPrescription) => (
                      <article className="medication-history-card" key={historyPrescription.id}>
                        <div className="medication-history-card-head">
                          <div className="medication-history-date-block">
                            <strong>{formatPrescriptionDate(historyPrescription.created_at || historyPrescription.updated_at)}</strong>
                            <span>{historyPrescription.doctor_name || 'Doctor'} · {historyPrescription.items?.length || 0} medicines</span>
                          </div>
                          <button
                            type="button"
                            className="history-repeat-all-btn"
                            onClick={() => repeatPreviousPrescription(historyPrescription)}
                          >
                            Repeat all
                          </button>
                        </div>

                        <div className="history-medicine-list">
                          {(historyPrescription.items || []).map((historyItem, historyIndex) => {
                            const medicineName = historyItem.medicine_name || historyItem.generic_name || 'Medicine';
                            const meta = [
                              [historyItem.dose, historyItem.dose_unit].filter(Boolean).join(' '),
                              historyItem.frequency,
                              historyItem.duration_days ? `${historyItem.duration_days} days` : null,
                              historyItem.instructions,
                            ].filter(Boolean).join(' · ');
                            return (
                              <div className="history-medicine-row" key={`${historyPrescription.id}-${historyItem.id || historyIndex}`}>
                                <div className="history-medicine-text">
                                  <strong title={medicineName}>{medicineName}</strong>
                                  <span title={meta}>{meta || 'Previous prescription item'}</span>
                                </div>
                                <button
                                  type="button"
                                  className="history-repeat-item-btn"
                                  onClick={() => repeatPreviousMedicine(historyItem)}
                                >
                                  Repeat
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Medicine Editor ── */}
            <div className="prescription-medicine-list" role="list">
              {prescriptionItems.map((item, index) => (
                  <article className="prescription-medicine-card" key={index + '-' + (item.medicine_id || 'manual')} role="listitem">
                    <div className="medicine-card-header">
                      <div className="medicine-card-count" aria-hidden="true">{index + 1}</div>
                      <div className="medicine-card-title-field">
                        <label className="medicine-field-label">Medicine</label>
                        <div className="medicine-name-input-wrap">
                          <input
                            ref={(element) => {
                              if (element) inlineInputRefs.current[index] = element;
                              else delete inlineInputRefs.current[index];
                            }}
                            type="text"
                            className="form-input medicine-name-input"
                            value={item.medicine_name}
                            onChange={(event) => handleInlineMedicineSearch(index, event.target.value)}
                            onBlur={() => setTimeout(() => setActiveInlineIdx(null), 200)}
                            onFocus={() => {
                              if (inlineSuggestions[index]?.length) {
                                setActiveInlineIdx(index);
                                window.requestAnimationFrame(() => positionInlineDropdown(index));
                              }
                            }}
                            placeholder="Type medicine name..."
                            autoComplete="off"
                          />
                        </div>
                      </div>
                      <button
                        type="button"
                        className="medicine-card-remove"
                        onClick={() => removeRow(index)}
                        aria-label="Remove medicine row"
                        title="Remove medicine"
                      >
                        ×
                      </button>
                    </div>

                    <div className="medicine-card-grid">
                      <div className="medicine-field medicine-field-dose">
                        <label className="medicine-field-label">Dose</label>
                        <select
                          className="form-input prescription-select dose-select"
                          value={getDoseSelectValue(item.dose)}
                          onChange={(event) => {
                            const nextValue = event.target.value;
                            updateItem(index, 'dose', nextValue === CUSTOM_DOSE_VALUE ? '' : nextValue);
                          }}
                        >
                          {DOSE_OPTIONS.map((option) => (
                            <option key={option} value={option}>{option}</option>
                          ))}
                          <option value={CUSTOM_DOSE_VALUE}>Customized</option>
                        </select>
                        {getDoseSelectValue(item.dose) === CUSTOM_DOSE_VALUE && (
                          <input
                            type="text"
                            className="form-input dose-custom-input"
                            value={item.dose || ''}
                            onChange={(event) => updateItem(index, 'dose', event.target.value)}
                            placeholder="Type dose"
                          />
                        )}
                      </div>

                      <div className="medicine-field medicine-field-unit">
                        <label className="medicine-field-label">Type / Unit</label>
                        <UnitDropdown
                          value={item.dose_unit || 'Tablet'}
                          onChange={(val) => updateMedicineType(index, val)}
                          rowIndex={index}
                        />
                      </div>

                      <div className="medicine-field medicine-field-route">
                        <label className="medicine-field-label">Route</label>
                        <input
                          type="text"
                          className="form-input"
                          value={item.route}
                          onChange={(event) => updateItem(index, 'route', event.target.value)}
                          placeholder="Oral"
                        />
                      </div>

                      <div className="medicine-field medicine-field-days">
                        <label className="medicine-field-label">Days</label>
                        <input
                          ref={(element) => {
                            if (element) daysInputRefs.current[index] = element;
                            else delete daysInputRefs.current[index];
                          }}
                          type="number"
                          min="1"
                          className="form-input"
                          value={item.duration_days}
                          onChange={(event) => updateItem(index, 'duration_days', event.target.value)}
                          onClick={() => openDaysPicker(index)}
                          onFocus={() => openDaysPicker(index)}
                          placeholder="5"
                        />
                      </div>

                      <div className="medicine-field medicine-field-frequency">
                        <label className="medicine-field-label">Frequency</label>
                        <select
                          className="form-input prescription-select frequency-select"
                          value={getFrequencySelectValue(item.frequency)}
                          onChange={(event) => {
                            const nextValue = event.target.value;
                            updateItem(index, 'frequency', nextValue === CUSTOM_FREQUENCY_VALUE ? '' : nextValue);
                          }}
                        >
                          {FREQUENCY_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label} ({option.value})</option>
                          ))}
                          <option value={CUSTOM_FREQUENCY_VALUE}>Customized</option>
                        </select>
                        {getFrequencySelectValue(item.frequency) === CUSTOM_FREQUENCY_VALUE && (
                          <input
                            type="text"
                            className="form-input frequency-custom-input"
                            value={item.frequency || ''}
                            onChange={(event) => updateItem(index, 'frequency', event.target.value)}
                            placeholder="Type frequency"
                          />
                        )}
                      </div>

                      <div className="medicine-field medicine-field-instructions">
                        <label className="medicine-field-label">Instructions</label>
                        <select
                          className="form-input instruction-select"
                          value={getInstructionSelectValue(item.instructions)}
                          onChange={(event) => {
                            const nextValue = event.target.value;
                            updateItem(index, 'instructions', nextValue === CUSTOM_INSTRUCTION_VALUE ? '' : nextValue);
                          }}
                        >
                          {INSTRUCTION_OPTIONS.map((option) => (
                            <option key={option} value={option}>{option}</option>
                          ))}
                          <option value={CUSTOM_INSTRUCTION_VALUE}>Customized</option>
                        </select>
                        {getInstructionSelectValue(item.instructions) === CUSTOM_INSTRUCTION_VALUE && (
                          <input
                            type="text"
                            className="form-input instruction-custom-input"
                            value={item.instructions || ''}
                            onChange={(event) => updateItem(index, 'instructions', event.target.value)}
                            placeholder="Type custom instruction"
                          />
                        )}
                      </div>
                    </div>
                  </article>
              ))}
            </div>
            </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="no-print preview-controls card" style={{ display: 'flex', gap: 12, justifyContent: 'center', padding: 16 }}>
          <button className="btn btn-secondary" onClick={() => setPreviewMode(false)}>← Back to Edit</button>
          <button className="btn btn-accent" onClick={handlePrint}>🖨️ Print Prescription</button>
        </div>
      )}

      {!previewMode && activeInlineIdx !== null && inlineDropdownPosition && inlineSuggestions[activeInlineIdx]?.length > 0 && typeof document !== 'undefined' && createPortal(
        <div
          className="inline-medicine-suggestions"
          style={{
            top: inlineDropdownPosition.top,
            left: inlineDropdownPosition.left,
            width: inlineDropdownPosition.width,
            maxHeight: inlineDropdownPosition.maxHeight,
          }}
        >
          {inlineSuggestions[activeInlineIdx].map((name, si) => (
            <button
              type="button"
              key={`${name}-${si}`}
              className="inline-medicine-suggestion"
              onMouseDown={(event) => {
                event.preventDefault();
                selectInlineSuggestion(activeInlineIdx, name);
              }}
              title={name}
            >
              <span>💊</span>
              <span>{name}</span>
            </button>
          ))}
        </div>,
        document.body
      )}

      {activeDaysPickerIdx !== null && daysPickerPosition && typeof document !== 'undefined' && createPortal(
        <div
          ref={daysPickerRef}
          className="days-picker-popover"
          style={{
            top: daysPickerPosition.top,
            left: daysPickerPosition.left,
            width: daysPickerPosition.width,
          }}
        >
          <div className="days-picker-title">Days</div>
          <div className="days-picker-grid">
            {DAY_PICKER_OPTIONS.map((day) => (
              <button
                type="button"
                key={day}
                className={`days-picker-option ${String(prescriptionItems[activeDaysPickerIdx]?.duration_days || '') === day ? 'active' : ''}`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  selectDurationDays(activeDaysPickerIdx, day);
                }}
              >
                {day}
              </button>
            ))}
          </div>
        </div>,
        document.body
      )}

      {(previewMode || saving) && (
        <div className="prescription-slip-paper" ref={printRef}>
          <div className="slip-header" style={{ position: 'relative' }}>
            <img 
              src="/logo.png" 
              alt="HMS Logo" 
              style={{ 
                position: 'absolute', 
                left: 0, 
                top: -10, 
                width: 130, 
                height: 130, 
                objectFit: 'contain' 
              }} 
            />
            <h2>HMS HOSPITAL</h2>
            <h3>HEALTHCARE EXCELLENCE CENTER</h3>
            <div className="slip-title">ELECTRONIC PRESCRIPTION</div>
          </div>

          <table className="slip-table">
            <tbody>
              <tr>
                <td className="label">Patient ID</td>
                <td className="value">{formatPatientId(patient)}</td>
                <td className="label">Date</td>
                <td className="value">
                  {new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                </td>
              </tr>
              <tr>
                <td className="label">Patient Name</td>
                <td className="value">{patient?.name || '________________________________'}</td>
                <td className="label">{patient?.patientType === 'corporate_employee' ? 'Employee Name' : ''}</td>
                <td className="value">{patient?.patientType === 'corporate_employee' ? (patient?.employee_name || '________________') : ''}</td>
              </tr>
              <tr>
                <td className="label">Age / Gender</td>
                <td className="value">{formatPatientMeta(patient) || '________________'}</td>
                <td className="label">{patient?.patientType === 'corporate_employee' ? 'Emp No.' : 'Contact'}</td>
                <td className="value">
                  {patient?.patientType === 'corporate_employee'
                    ? `${patient.empNumber || '-'}${patient.relationship && patient.relationship !== 'Self' ? ` (${patient.relationship})` : ' (Self)'}`
                    : (patient?.phoneNumber || '________________')}
                </td>
              </tr>
              <tr className="diagnosis-row">
                <td className="label">Diagnosis</td>
                <td className="value" colSpan="3">{diagnosis || '________________________________________________________________'}</td>
              </tr>
              <tr>
                <td className="label">Notes</td>
                <td className="value" colSpan="3">{notes || '________________________________________________________________'}</td>
              </tr>
            </tbody>
          </table>

          <div className="prescription-body">
            <table className="prescription-items-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>TYPE</th>
                  <th>MEDICINE</th>
                  <th>DOSE</th>
                  <th>ROUTE</th>
                  <th>FREQUENCY</th>
                  <th>DAYS</th>
                  <th>INSTRUCTIONS</th>
                </tr>
              </thead>
              <tbody>
                {validItems.length > 0 ? (
                  validItems.map((item, index) => (
                    <tr key={`${item.medicine_name}-${index}`}>
                      <td>{index + 1}</td>
                      <td>{item.dose_unit || '-'}</td>
                      <td>{item.medicine_name}</td>
                      <td>{item.dose || '-'}</td>
                      <td>{item.route || '-'}</td>
                      <td>{item.frequency || '-'}</td>
                      <td>{item.duration_days || '-'}</td>
                      <td>{item.instructions || '-'}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="8" className="empty-prescription-row">
                      No medicines added yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="slip-footer">
            <div className="doctor-sig">
              <p>_______________________</p>
              <p>Doctor's Signature</p>
              <p><small>{user?.name || 'Doctor'}</small></p>
            </div>
          </div>
        </div>
      )}
    </div>

    </>
  );
}
