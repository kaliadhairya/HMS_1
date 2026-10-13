import MedicationAllergyPanel from "./MedicationAllergyPanel";
import MedicationFollowupPanel from "./MedicationFollowupPanel";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import Navbar from "../../../components/Navbar";
import MedicationOrderPanel from "./MedicationOrderPanel";
import { Field, MedicationLinks } from "../pharmacy/MedicationUI";
export default function MedicationOrdersPage() {
  const [search] = useSearchParams();
  const [patient, setPatient] = useState(search.get("patient_id") || ""),
    [encounter, setEncounter] = useState(search.get("encounter_id") || "");
  return (
    <>
      <Navbar />
      <MedicationLinks />
      <main className="app-page medication-page">
        <h1>Coded prescribing</h1>
        <div className="form-grid">
          <Field
            label="Patient ID"
            type="number"
            value={patient}
            onChange={(e) => setPatient(e.target.value)}
          />
          <Field
            label="Encounter ID"
            type="number"
            value={encounter}
            onChange={(e) => setEncounter(e.target.value)}
          />
        </div>
        {patient && (
          <MedicationAllergyPanel key={patient} patientId={patient} />
        )}
        <MedicationFollowupPanel patientId={patient} />
        <MedicationOrderPanel
          key={patient + ":" + encounter}
          patientId={patient}
          encounterId={encounter}
        />
      </main>
    </>
  );
}
