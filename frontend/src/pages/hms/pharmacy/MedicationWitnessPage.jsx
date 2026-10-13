import Navbar from "../../../components/Navbar";
import { MedicationLinks } from "./MedicationUI";
import { WitnessInbox } from "./MedicationWitness";
export default function MedicationWitnessPage() {
  return (
    <>
      <Navbar />
      <MedicationLinks />
      <main className="app-page medication-page">
        <h1>Independent clinical witnessing</h1>
        <WitnessInbox />
      </main>
    </>
  );
}
