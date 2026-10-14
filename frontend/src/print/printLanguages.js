// Second language on patient printouts (completion C2). English stays on the
// page as the reference text; the chosen language is printed beside it so a
// patient can read their medicines. Translations here are patient-facing
// clinical text: each language is marked with its review status, and a
// language is only added after the hospital's language/clinical review.
// Indian scripts print with the bundled/system Noto fonts (see printFonts).

export const PRINT_LANGUAGES = {
  hi: {
    name: 'हिन्दी (Hindi)',
    lang: 'hi',
    reviewed: false, // Draft by the HMS team: needs the hospital's language review before use with patients.
    labels: {
      patientName: 'रोगी का नाम',
      patientId: 'रोगी आईडी',
      date: 'तारीख',
      ageGender: 'आयु / लिंग',
      contact: 'संपर्क',
      diagnosis: 'निदान',
      notes: 'टिप्पणी',
      medicine: 'दवा',
      type: 'प्रकार',
      dose: 'खुराक',
      route: 'कैसे लें',
      frequency: 'कब लें',
      days: 'दिन',
      instructions: 'निर्देश',
      signature: 'डॉक्टर के हस्ताक्षर',
      prescription: 'पर्चा',
    },
    slots: { morning: 'सुबह', noon: 'दोपहर', evening: 'शाम', night: 'रात' },
    asNeeded: 'ज़रूरत होने पर',
    days: (n) => `${n} दिन`,
  },
};

// "1-0-1" -> "morning 1, night 1" in the chosen language; null if it is not
// in the dotted form (free text is printed as written).
export function explainFrequency(frequency, language) {
  const L = PRINT_LANGUAGES[language];
  if (!L || !frequency) return null;
  const f = String(frequency).trim();
  if (/^sos$/i.test(f)) return L.asNeeded;
  const parts = f.split('-');
  if (!(parts.length === 3 || parts.length === 4) || parts.some((p) => !/^\d+(\.\d+)?$|^½$|^1\/2$/.test(p))) return null;
  const names = parts.length === 3 ? ['morning', 'noon', 'night'] : ['morning', 'noon', 'evening', 'night'];
  const out = parts.map((p, i) => (p === '0' ? null : `${L.slots[names[i]]} ${p}`)).filter(Boolean);
  return out.length ? out.join(', ') : null;
}
